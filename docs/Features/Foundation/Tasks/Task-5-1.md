# Task 5-1 — The microphone boundary and the capture spine

_Phase 5, task 1 of 4. Authored 2026-08-17 against `4369954`._

---

## Source Of Truth

| Document | Owns |
|---|---|
| [`Phase-5-Overview.md`](Phase-5-Overview.md) | The phase's ground facts, D4 results, D159–D162, the purity contract |
| [`../Phase-5-VoicePlan.md`](../Phase-5-VoicePlan.md) §4, §9 | The forced architecture and the state machine — **authoritative on design** |
| [`../ImplementationSpecs/ImplementationSpec-5-1.md`](../ImplementationSpecs/ImplementationSpec-5-1.md) | Exact contents, insertion points, runtime verification |
| `CLAUDE.md` | The renderer never spawns processes; all IPC typed and Zod-validated in main |
| `roadmap.md` §6 | **D1** (Zod in main only) · **D14** (plain objects across the bridge) · **D162** (the permission policy) · **F79**, **F80** |

---

## Initial Starting Point — verified 2026-08-17 at `4369954`

| Fact | Value |
|---|---|
| `IpcChannel` keys | **97** — asserted twice, `ipc.test.ts:3462` and `:3840` |
| `ipcMain.handle(` | **87** |
| Voice code anywhere in `src/` | **ZERO** — no `getUserMedia`, no `AudioWorklet`, no `services/voice.ts` |
| Permission handlers | **NEITHER installed.** grep over `src/` for `setPermissionRequestHandler\|setPermissionCheckHandler` returns nothing |
| `app.whenReady()` | `src/main/index.ts:321` |
| `createWindow()` | `src/main/index.ts:153`; `webPreferences` carries `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`, `preload: …/preload/index.js` |
| `registerIpc(` call | `src/main/index.ts:721` |
| Preload shape | Zod-free typed forwarder over `ipcRenderer.invoke(IpcChannel.X, …)` — `src/preload/index.ts` |
| CSP | `src/renderer/index.html`, `http-equiv` **:7**, `content` **:8** — no `connect-src`, no `wasm-unsafe-eval`, no `media-src` |

---

## Goal

Install Chorus's **microphone permission policy**, then build the capture half of
the voice pipeline: the renderer opens the microphone, resamples to **16 kHz mono**
in an `AudioWorklet`, and streams PCM frames to main over a bounded, typed
channel. **Main receives frames and does nothing with them but count and bound
them.** No transcription, no hotkey, no overlay, no injection — those are 5-2,
5-3 and 5-3 respectively.

The task exists as its own commit because it is **the security boundary plus the
one architectural shape the phase cannot change later**: voice is the first
feature in which the renderer is a bulk binary *producer*, and D14 meets a
payload it has never been tested against.

---

## ⚠ The measured fact that makes the ordering non-negotiable

**F79: Electron 43.1.1 grants the microphone silently, today, in this codebase.**
Measured 2026-08-17 in a real Electron process with no handler installed —
exactly reproducing `src/main/` at `4369954`: `getUserMedia({audio:true})`
**resolved in 147 ms**, opened a real device, and exposed the device label.

The VoicePlan called this out as unverified and warned that assuming "it
approves" is the D4 failure mode. It approves — but it is now a **measurement**,
and it means the boundary is **open right now** rather than "open once we add
capture". Therefore:

> **The permission handlers land in this commit, and they land BEFORE the first
> line of capture code — not merely in the same task.** A reviewer should be able
> to check out this commit, delete the renderer half, and still have a hardened
> app.

**⚠ AND IT TAKES BOTH HANDLERS.** Electron's own documentation for
`setPermissionRequestHandler` says: *"you must also implement
`setPermissionCheckHandler` to get complete permission handling. Most web APIs
do a permission check and then make a permission request if the check is
denied."* Installing only the request handler yields a policy with a hole that
**testing the happy path will not reveal** — the check path silently bypasses it.

---

## Exact Scope

**Create:**

| File | Purpose |
|---|---|
| `src/main/services/voiceCore.ts` | **Pure.** Frame-envelope validation helpers, the bounded-queue policy (`admitFrame`), Float32→Int16 PCM conversion. No `electron`, no `fs`, no clock. |
| `src/main/services/voiceCore.test.ts` | Unit tests for the above |
| `src/main/services/voice.ts` | The main-side capture sink: owns one capture session at a time, applies `voiceCore`'s queue policy, emits state. **No transcription in this task.** |
| `src/main/services/voice.test.ts` | Unit tests with every effect injected |
| `src/renderer/src/voice/capture.ts` | Renderer capture: `getUserMedia` → `AudioContext({sampleRate:16000})` → `AudioWorkletNode` → frames over the preload surface |
| `src/renderer/src/voice/pcm-worklet.js` | **The worklet processor, as a real file.** See F80 below. |

**Edit:**

| File | Change |
|---|---|
| `src/main/index.ts` | Install **both** permission handlers on `session.defaultSession` inside `whenReady`, **before `createWindow`**; construct the voice service and pass it to `registerIpc` |
| `src/main/ipc.ts` | The `voice:*` handlers |
| `src/shared/ipc.ts` | The `voice:*` channels and their Zod schemas |
| `src/shared/ipc.test.ts` | Re-count **both** `IpcChannel` assertions from the merged tree (G6) |
| `src/preload/index.ts` | The typed forwarder for the new channels |

**Nothing else.**

---

## ⚠ Two traps pre-recorded, both measured this kickoff

### F80 — the worklet must be a FILE. A `blob:` worklet is blocked by the shipped CSP.

Measured 2026-08-17 under the app's real CSP:

- `audioWorklet.addModule('./pcm-worklet.js')` — **OK**
- `audioWorklet.addModule(URL.createObjectURL(new Blob([…])))` — **`AbortError`**

Generating the processor source as a blob at runtime is the *common* pattern in
AudioWorklet examples and it **will fail here**. `default-src 'self'` has no
`blob:` in it, and per the phase's purity contract **the CSP is not widened** —
the worklet ships as a file that Vite emits into the bundle.

This is **D1's lesson on its fourth registry** (Zod-in-preload → `connect-src` →
`wasm-unsafe-eval` → now `blob:` worklets): *the answer to "the CSP blocks this"
is to change the code, not the policy.*

### The frame channel is the first renderer→main channel that is not an `invoke`.

Audio frames are fire-and-forget bulk. They must **not** be `ipcRenderer.invoke`
— every frame would allocate a promise and await a main-process round trip at
~62 frames/second.

⚠ **This breaks a counting invariant that currently closes exactly.** At
`4369954`: **97 channels = 87 `ipcMain.handle(` + 10 main→renderer event
channels.** A `send`-shaped renderer→main channel is a **third** category, so
after this task the reconciliation is `97 + N = handles + events + sends`.
`ipc.test.ts` asserts only the total, so **no existing test breaks** — which is
exactly why this must be written down rather than discovered by the next person
who tries to reconcile the numbers and finds they no longer add up.

---

## Non-Goals

- **No transcription.** No whisper, no model, no child process. Frames are
  counted and dropped. (5-2.)
- **No hotkey and no `uiohook-napi` dependency.** Capture is started and stopped
  by a temporary dev-only trigger. (5-3.)
- **No overlay window, no dictation target, no target ring.** (5-3.)
- **No `session:write`. Nothing reaches any agent in this task.** (5-3.)
- **No refinement, no LLM, no `createApiSession`.** (5-4.)
- **No settings UI and no new nav entry** — D76 forbids a nav row with nothing
  behind it, and after this task there is still nothing behind it. (5-4.)
- **No migration.** `MIGRATIONS.length` stays **20**; `v21` is not claimed (D161).
  If this task believes it needs one, **stop and raise it**.
- **No CSP change.** Not `blob:`, not `media-src`, not `connect-src`.
- **No transcript or audio content in any log**, at any level.
- **Do not revert or commit the pre-existing uncommitted changes** to
  `docs/Features/Foundation/roadmap.md`, `docs/Plan.md`, or the untracked
  `Architect-Pass-Prompt-6a-Close.md`. They are the 2026-08-16 architect pass.

---

## Dependencies

**None.** This is the phase's first task.

---

## Step-by-step Work

1. **Install the permission policy first, and commit nothing before it works.**
   In `whenReady`, before `createWindow`: `session.defaultSession
   .setPermissionRequestHandler` and `.setPermissionCheckHandler`, allowing
   `'media'` **only** for the app's own origin and returning `false` for
   everything else. Log each denial once, by permission name — **never** with a
   URL that could carry query content.
2. **Prove the policy before building on it.** Re-run the F79 probe shape against
   the app: a non-media permission (e.g. `geolocation`) must now be refused, and
   `'media'` from the app's own origin must still resolve.
3. **`voiceCore.ts` (pure) before any wiring.** `admitFrame(state, frame)`
   returning admit/drop plus the reason; `toInt16(Float32Array)`; envelope
   field validation. Unit-test the queue bound with a stalled consumer.
4. **The channels and schemas** in `src/shared/ipc.ts`. The envelope is fully
   Zod-validated; the sample payload is **length- and type-checked, not
   element-validated** — and the schema carries a comment saying so, so it is
   never read as a D1 exemption.
5. **`voice.ts`** — one capture session at a time; a second start refuses rather
   than overlapping (VoicePlan §7.2 makes this structural, not defensive).
6. **The renderer half**: `pcm-worklet.js` as a file, `capture.ts` around it,
   `AudioContext({sampleRate:16000})` — which the D4 pass measured as **honoured
   exactly**, so no manual resampler is needed.
7. **Backpressure**: when the queue is full, drop and **surface it** — the
   recording state must be able to say it has stopped keeping up.
8. **Re-count `IpcChannel` from the merged tree** and update both assertions.

---

## Test Expectations

**Unit (vitest), all in `voiceCore.test.ts` / `voice.test.ts`:**

- `admitFrame` admits up to the bound, drops beyond it, and reports the drop.
- A stalled consumer does not grow memory without limit.
- `toInt16` clamps out-of-range values rather than wrapping.
- Envelope validation rejects: wrong sample rate, non-monotonic sequence
  numbers, a payload whose length disagrees with its declared length.
- A second `voice:start` while one is live is **refused**, not queued.
- Round-trip: N frames in, N accounted for as admitted + dropped, never lost.

**Expect roughly +25 to +40 tests.** The suite baseline is **2230 / 66 files**;
re-measure rather than assuming this figure.

⚠ **What unit tests cannot reach here, and must not be claimed:** the permission
handlers, `getUserMedia`, the `AudioWorklet`, and the real sample rate. All four
are runtime gates below.

---

## Verification Commands

```
npm run typecheck                 # 0, node + web
npx vitest run                    # >= 2230 + new; NEVER --reporter=basic (dead reporter, exits 0)
npm run grep:secrets              # clean, 6 patterns

# Both handlers exist, and the request handler is not alone (D162)
grep -rn "setPermissionRequestHandler\|setPermissionCheckHandler" src/main/    # expect BOTH

# The worklet is a file, not a blob (F80)
grep -rn "createObjectURL" src/renderer/src/voice/                             # expect ZERO

# No CSP widening
git diff src/renderer/index.html                                               # expect EMPTY

# No migration was taken (D161)
node -e "const ts=require('typescript'),fs=require('fs');const p='src/main/services/storage.ts';const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);let i=null;const w=n=>{if(ts.isVariableDeclaration(n)&&n.name.text==='MIGRATIONS')i=n.initializer;ts.forEachChild(n,w)};w(sf);console.log('MIGRATIONS.length =',i.elements.length)"   # expect 20

# No audio or transcript content in logs
grep -rn "logger\." src/main/services/voice*.ts                                # review every hit by hand
```

### Runtime gates (G2) — none of these can be met by a passing test

1. **The policy denies.** With the app running, a non-`media` permission request
   is refused and logged once.
2. **The policy allows.** `media` from the app's own origin resolves, and the
   device is **released** the moment capture stops (`track.readyState === 'ended'`).
3. **16 kHz is real.** The live `AudioContext.sampleRate` reads **16000** while
   the device's own rate is 48000 — recorded from the running app, not from the
   D4 probe.
4. **Frames arrive.** Speaking for ~5 s produces a plausible frame count in main
   at 16 kHz mono, with sequence numbers contiguous.
5. **Backpressure is observable.** With the consumer artificially stalled, the
   queue **bounds** and the drop is surfaced rather than silently swallowed.

---

## Acceptance Criteria

- [ ] **Both** permission handlers installed, in `whenReady`, **before**
      `createWindow`; non-media permissions refused.
- [ ] Deleting the entire renderer half of this commit still leaves the app
      hardened — the boundary does not depend on the feature.
- [ ] `AudioContext` reports **16000** in the running app.
- [ ] The worklet loads from a **file**; `createObjectURL` appears nowhere under
      `src/renderer/src/voice/`.
- [ ] The frame envelope is Zod-validated in **main**; the sample payload is
      length/type-checked with a comment stating that this is deliberate.
- [ ] A second concurrent capture is refused.
- [ ] The queue is bounded and drops are reported.
- [ ] `IpcChannel` re-counted from the merged tree; **both** assertions updated.
- [ ] `MIGRATIONS.length` still **20**.
- [ ] `src/renderer/index.html` **byte-identical**.
- [ ] typecheck 0 · vitest green with a **printed count** · `grep:secrets` clean.
- [ ] The three pre-existing uncommitted doc changes are untouched.

---

## Review Checklist

- **Read the permission handlers first.** Are *both* present? Does the check
  handler deny by default rather than mirroring the request handler's allow?
- Does the allow-list key on the **app's own origin**, or would any page in any
  window get the microphone?
- Is the device **released** on every exit path — stop, cancel, error, window
  close — or only on the happy one?
- Is the sample payload's "not element-validated" status **stated in the schema
  file**, or does it merely happen to be true?
- Is the frame channel `send`-shaped rather than `invoke`-shaped, and is the
  three-category channel accounting written down?
- Does any log line carry audio, a transcript, or a device label?
- Did the implementer **re-count** `IpcChannel`, or add a delta to 97?
