# Implementation Spec 5-1 — The microphone boundary and the capture spine

_Normative companion to [`../Tasks/Task-5-1.md`](../Tasks/Task-5-1.md).
Written 2026-08-17 against `4369954`. Every line number was checked this session._

---

## §0 — Install the boundary before you write the feature

**Order is the content of this task.** The commit must be readable as: *policy,
then capture*. A reviewer who deletes everything under `src/renderer/src/voice/`
must still be left with a hardened app.

### The insertion point, exactly

`src/main/index.ts`:

- Imports are at **:1–29**; `app, shell, powerMonitor, BrowserWindow` come from
  `electron` at **:1**. **Add `session` to that existing import** — do not add a
  second `from 'electron'` line.
- `app.whenReady().then(async () => {` opens at **:321**.
- `registerIpc(` is called at **:721**.
- `createWindow(restoringSessions)` is called at **:822**.

**Install both handlers immediately after `setAppUserModelId` / `ensureDevToastShortcut`
(≈:325–326) — i.e. at the very top of `whenReady`, hundreds of lines before the
window exists.** Placing it there is not fastidiousness: `createWindow` is what
makes a renderer capable of asking, and a policy installed after it is a policy
with a window of exposure in it.

```ts
// ⚠ BOTH HANDLERS, AND BEFORE ANY WINDOW EXISTS (D162).
//
// F79, measured 2026-08-17: with NO handler installed, Electron 43.1.1 grants
// getUserMedia({audio:true}) SILENTLY — resolved in 147 ms, opened a real
// device, exposed its label. The VoicePlan flagged the default as unverified
// and warned that assuming "it approves" is the D4 failure mode. It approves.
// So this is not hardening in advance of a feature; it is closing a boundary
// that is open at HEAD.
//
// ⚠ AND IT TAKES BOTH. Electron's own docs for setPermissionRequestHandler:
// "you must also implement setPermissionCheckHandler to get complete permission
// handling. Most web APIs do a permission check and then make a permission
// request if the check is denied." One handler is a policy with a hole that
// testing the happy path will never reveal.
session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
  const ok = permission === 'media' && isOwnOrigin(details)
  if (!ok) logger.info({ permission }, '[voice] permission request refused')
  callback(ok)
})
session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => {
  const ok = permission === 'media' && isOwnOrigin({ requestingUrl: origin })
  if (!ok) logger.info({ permission }, '[voice] permission check refused')
  return ok
})
```

### `isOwnOrigin` — and why it is not `() => true`

The app loads from `http://localhost:<port>` under `electron-vite dev` and from
`file://` when packaged. **Both must be accepted and nothing else.** Write it as
a small exported predicate with its own unit tests, in `voiceCore.ts`:

- dev: the renderer's dev-server origin
- packaged: the `file://` app root
- **everything else, including any origin an agent could cause to be loaded:
  false**

⚠ **Log the permission NAME and never the URL.** A requesting URL can carry
query content; the phase's purity contract forbids that class of leak, and this
is the first place it could happen.

---

## §1 — `src/main/services/voiceCore.ts` (new, pure)

No `electron`, no `fs`, no `child_process`, no clock. Everything here is unit
testable, and it is where the parts that can be proven actually get proven.

### Exports

```ts
export const VOICE_SAMPLE_RATE = 16_000
export const VOICE_FRAME_SAMPLES = 1_024          // ~64 ms at 16 kHz
export const VOICE_QUEUE_MAX_FRAMES = 1_875       // ~120 s — see the bound note

export function isOwnOrigin(details: { requestingUrl?: string }): boolean
export function toInt16(samples: Float32Array): Int16Array
export function admitFrame(state: QueueState, frame: FrameEnvelope): AdmitResult
```

### `toInt16` — clamp, never wrap

```ts
// ⚠ CLAMP RATHER THAN WRAP. Web Audio nominally yields [-1, 1] but does NOT
// guarantee it — a gain stage or a hot microphone overshoots, and `x * 32768`
// on an overshoot wraps a loud sample to the OPPOSITE sign. That is audible as
// a click and, worse, it is audible to whisper as a consonant.
const v = Math.max(-1, Math.min(1, samples[i]))
out[i] = v < 0 ? v * 0x8000 : v * 0x7fff
```

### The queue bound, and why it is stated in seconds

`VOICE_QUEUE_MAX_FRAMES` is derived from a **duration**, not chosen as a round
number: 120 s of 16 kHz mono at 1024 samples/frame. **Write the derivation in
the constant's comment**, because a bare `1875` is exactly the kind of number a
later reader "tidies".

`admitFrame` returns `{ admit: true }` or `{ admit: false, reason: 'queue-full' | 'stale-session' | 'bad-sequence' }`.
**It never throws** — a dropped frame is a normal outcome that must be counted
and surfaced, not an exception that unwinds a capture.

---

## §2 — The wire (`src/shared/ipc.ts`)

### Channels

| Channel | Shape | Direction |
|---|---|---|
| `voice:capture-start` | `invoke` | renderer → main |
| `voice:capture-frame` | **`send`** | renderer → main |
| `voice:capture-stop` | `invoke` | renderer → main |
| `voice:state` | event | main → renderer |

### ⚠ `voice:capture-frame` is the app's first non-`invoke` renderer→main channel

Use `ipcRenderer.send` / `ipcMain.on`. **Not `invoke`**: at ~16 frames/second
every frame would allocate a promise and await a main round trip, for a reply
nobody reads.

Add this comment at the channel definition, because it changes an accounting
invariant that currently closes exactly:

```ts
/* ⚠ SEND-SHAPED, NOT INVOKE-SHAPED, AND IT MAKES THE CHANNEL TALLY
   THREE-CATEGORY FOR THE FIRST TIME.
   At 4369954 the tally closed exactly: 97 channels = 87 ipcMain.handle( + 10
   main->renderer event channels. This channel is renderer->main and NOT
   handled, so from now on:
       total = handle() + main->renderer events + renderer->main sends
   `ipc.test.ts` asserts only the total, so nothing breaks today — which is
   exactly why it is written here rather than left for whoever next tries to
   reconcile 87 + 10 and finds it no longer adds up. */
```

### The envelope schema, and the deliberate limit of its validation

```ts
export const voiceFrameSchema = z.object({
  captureId: z.uuid(),
  seq: z.number().int().nonnegative(),
  sampleRate: z.literal(16_000),
  sampleCount: z.number().int().positive().max(4096),
  samples: z.instanceof(Int16Array)   // see the note below
})
```

```ts
/* ⚠ THE ENVELOPE IS FULLY VALIDATED; THE SAMPLE PAYLOAD IS LENGTH- AND
   TYPE-CHECKED, NOT ELEMENT-VALIDATED — AND THAT IS A DECLARED POSITION,
   NOT A D1 EXEMPTION.
   D1 requires every IPC payload be Zod-validated in main. Element-validating
   1,024 samples 16 times a second would spend more time in Zod than in the
   transcriber, for a check that cannot fail meaningfully: an Int16Array's
   elements are Int16 by construction. What CAN be wrong is the envelope —
   the sample rate, the sequence, the declared length against the real one —
   and all three are checked. `sampleCount` is cross-checked against
   `samples.length` in main; a disagreement is a dropped frame, not a throw. */
```

⚠ **D14 check:** an `Int16Array` crosses the structured clone boundary
natively — but it must be a **real** `Int16Array`, not a Pinia/reactive proxy
around one. The renderer builds it fresh per frame inside the capture module and
hands it straight to `send`. **Never** store a frame in a reactive store and
forward it from there; that is D14's failure mode and it has no compile-time
signal.

---

## §3 — `src/main/services/voice.ts` (new)

One capture at a time. `startCapture` while a capture is live **refuses** and
returns the refusal — it does not queue and does not silently replace. VoicePlan
§7.2 requires that overlapping activations be structurally impossible; a refusal
at the single owner is what makes it structural.

State surfaced on `voice:state`: `ready | listening | finalizing | failed`.
(`refining`, `ready-for-review` and `inserted` arrive with 5-4 / 5-3.)

**Frames are counted and dropped in this task.** Say so in the file's docblock,
so the next reader does not go looking for the consumer:

```ts
/* ⚠ THIS TASK DELIBERATELY DISCARDS EVERY FRAME AFTER COUNTING IT.
   The sink exists so the capture path, the bound and the backpressure signal
   can be proven on their own, before a transcriber's latency is in the
   picture. Task 5-2 replaces the discard with the WAV assembly. Reverting
   this commit removes the microphone boundary too, which is why the two ship
   together. */
```

---

## §4 — The renderer half

### `src/renderer/src/voice/pcm-worklet.js` — a FILE, and it must stay one

```js
// ⚠ THIS IS A FILE ON PURPOSE. F80, measured 2026-08-17 under the app's own CSP:
//   audioWorklet.addModule('./pcm-worklet.js')  -> OK
//   audioWorklet.addModule(blob: URL)           -> AbortError, BLOCKED
// `default-src 'self'` carries no blob:, and the phase's purity contract
// forbids widening the CSP (D1's lesson, fourth registry). Generating the
// processor source as a blob is the common AudioWorklet pattern and it fails
// here. Vite must emit this as an asset; do not inline it.
registerProcessor('pcm-capture', class extends AudioWorkletProcessor { /* … */ })
```

Ensure Vite emits it as a real asset (`?url` import or `publicDir`), and
**verify the packaged build**, not only dev — an asset that resolves under the
dev server and 404s when packaged is the same class of bug as 5-2's binary path.

### `src/renderer/src/voice/capture.ts`

```ts
const ctx = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE })
```

⚠ **No manual resampler.** Measured 2026-08-17: `new AudioContext({sampleRate:16000})`
is **honoured exactly** on this machine, while the device's native rate is
**48000** and a default context is also 48000 — Chromium resamples for us. The
VoicePlan guessed that "resampling from the device rate is the likely real
work"; it is not. **Assert the honoured rate at runtime anyway** and fail loudly
if a future Electron stops honouring it, rather than shipping 48 kHz audio to a
transcriber expecting 16 kHz — which does not error, it just transcribes badly.

**Release the device on every exit path** — stop, cancel, error, window close.
`track.stop()` on each track, then assert `readyState === 'ended'`. The source
document's rule is that microphone access ends the moment recording does, and
"ended" is the only observable proof.

---

## §5 — Verification

### Deterministic

```
npm run typecheck                                    # 0
npx vitest run                                       # count printed; NEVER --reporter=basic
npm run grep:secrets                                 # clean

grep -rn "setPermissionRequestHandler\|setPermissionCheckHandler" src/main/   # BOTH
grep -rn "createObjectURL" src/renderer/src/voice/                            # ZERO
git diff src/renderer/index.html                                              # EMPTY
```

### Runtime — in this order

1. **Deny path first.** From devtools in the running app, request a non-media
   permission (`navigator.geolocation.getCurrentPosition`). It must be
   **refused**, with one log line naming the permission and **no URL**.
2. **Allow path.** `getUserMedia({audio:true})` resolves; then stop the tracks
   and confirm `readyState === 'ended'` for each.
3. **Rate.** Log the live `ctx.sampleRate` — must read **16000** against a
   device rate of 48000. Record both.
4. **Frames.** Speak ~5 s; main reports a frame count consistent with
   ~16 frames/s, sequence numbers contiguous from 0.
5. **Backpressure.** Stall the sink artificially; the queue **bounds** at
   `VOICE_QUEUE_MAX_FRAMES`, drops are counted, and the state surfaces that it
   stopped keeping up. Memory must be flat while dropping — watch it, do not
   assume it.
6. **Second capture refused** while one is live.
7. **Packaged build**: the worklet asset resolves.

### What a reviewer should distrust

- A permission handler that returns `true` for `'media'` **without** an origin
  check — that is the pre-task behaviour with extra steps.
- Only one of the two handlers present.
- `sampleCount` accepted without being cross-checked against `samples.length`.
- A frame path that touches a Pinia store (D14).
- A `track.stop()` on the happy path only.
- Any claim that the rate is 16 kHz that comes from the D4 probe rather than
  from this build.
