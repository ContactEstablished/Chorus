# Task 5-1 — Execution Prompt (paste into a fresh session)

_Authored 2026-08-17 against `2068b70`. Everything needed is in this file; it assumes no memory of
the conversation that produced it._

You are the **Coordinator** for **Chorus Phase 5 — Voice Input, Task 5-1**.

- **Repo root:** `C:\Projects\ContactEstablished\Chorus`
- **Expected branch: `main`.** Confirm it; **do not switch branches without instruction.**
- **Expected HEAD: `2068b70`** ("Close the memory work and plan how voice input gets built").
  If HEAD has moved, **re-measure every counter in this document before using it** — see GATE 2.

---

## ⚠ GATE 0 — THE TREE IS CLEAN, AND THAT IS DIFFERENT FROM LAST PHASE

`git status --porcelain` at authoring time: **empty.** The Phase 5 planning documents and the
architect pass that preceded them were committed in `2068b70`, deliberately, **so that this task's
commit contains source files and nothing else.**

```bash
git status --porcelain     # expect NO output
git log --oneline -1       # expect 2068b70
```

- **If you find modified or untracked files, they are not yours.** List them in your report, **do not
  revert them, do not stage them, do not commit them.**
- `_verify/` is gitignored working evidence. **Never stage anything under it.** Put this task's
  evidence in `_verify/5-1/`.
- **This document itself will be untracked** when you read it. Same rule.

**Your commit contains source files and nothing else.**

---

## ⚠ GATE 1 — ENVIRONMENT, AND THE TWO FALSE GREENS IT PRODUCES

**`node_modules` in this repo has been found EMPTY at the start of two separate past sessions.** It
is **one shared directory**: every worktree junctions into
`C:\Projects\ContactEstablished\Chorus\node_modules`, so emptying it removes typecheck and vitest
from every worktree at once.

```bash
npm ci                          # not `npm install` — ci installs the lockfile exactly
npm run rebuild:better-sqlite3  # the /Od workaround; .npmrc documents why
```

**⚠ FALSE GREEN #1, WHICH HAS FIRED TWICE.** With the toolchain gone, `npm run typecheck` fails with
`'tsc' is not recognized` — which contains **no `error TS`**, so a grep for the compiler's error
string reports a clean pass. **Check the EXIT CODE, and grep for the toolchain's own failure, not
only for `error TS`.**

**⚠ FALSE GREEN #2, MEASURED 2026-08-16 AND NEWER THAN MOST OF THIS REPO'S LORE.**

```bash
npx vitest run --reporter=basic     # ☠ NEVER RUN THIS
```

The `basic` reporter was **removed in vitest 4.1.10**. The run dies inside
`loadCustomReporterModule` with `ERR_LOAD_URL` having executed **zero tests** — **and exits `0`.**
A caller checking the exit code records a green suite that never ran.

> **The rule both false greens teach: assert on the SUCCESS SIGNAL — a test count you can read —
> never on the exit code alone and never on the absence of an error string.**

---

## ⚠ GATE 2 — THE BASELINE, MEASURED AT `2068b70`

Re-run these yourself before touching code. **Do not quote them from this document** — the whole
point of G6 is that a counter is a measurement with a date on it.

| Gate | Expected at `2068b70` |
|---|---|
| `npm run typecheck` | **0 errors**, node + web, exit 0 |
| `npx vitest run` | **2230 passed / 2230, across 66 files** |
| `npm run grep:secrets` | **clean, 6 patterns** |
| `IpcChannel` keys | **97** — asserted twice, `src/shared/ipc.test.ts:3462` and `:3840` |
| `ipcMain.handle(` | **87** |
| Event channels (declared, never handled) | **10** — 87 + 10 = 97 closes exactly |
| `sqliteTable(` | **19** |
| `MIGRATIONS.length` | **20** — next free `v21`, **and this task claims nothing** |
| Runtime dependencies | **8** — **this task adds none** |

```bash
npm run typecheck
npx vitest run
npm run grep:secrets

# ⚠ PARSE, DO NOT GREP. The MIGRATIONS array's inter-element comments contain
# backticks, so a character scanner reads a comment as a template literal and
# every count after it is garbage (a naive scan returns 171).
node -e "const ts=require('typescript'),fs=require('fs');const p='src/main/services/storage.ts';const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);let i=null;const w=n=>{if(ts.isVariableDeclaration(n)&&n.name.text==='MIGRATIONS')i=n.initializer;ts.forEachChild(n,w)};w(sf);console.log('MIGRATIONS.length =',i.elements.length)"

# IpcChannel — the AST count is authoritative; the regex below happens to agree at 97
node -e "const ts=require('typescript'),fs=require('fs');const p='src/shared/ipc.ts';const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);let i=null;const w=n=>{if(ts.isVariableDeclaration(n)&&n.name.text==='IpcChannel')i=n.initializer;ts.forEachChild(n,w)};w(sf);while(i&&(ts.isAsExpression(i)||ts.isSatisfiesExpression(i)))i=i.expression;console.log('IpcChannel keys =',i.properties.filter(p=>ts.isPropertyAssignment(p)).length)"
```

---

## Goal

Install Chorus's **microphone permission policy**, then build the **capture half** of the voice
pipeline: the renderer opens the microphone, resamples to **16 kHz mono** in an `AudioWorklet`, and
streams PCM frames to main over a bounded, typed channel. **Main receives frames and does nothing
with them but count and bound them.**

**No transcription, no hotkey, no overlay, no injection.** Those are Tasks 5-2, 5-3 and 5-3.

**The prime constraint on this task is ORDERING:** the commit must read as *policy, then capture*. A
reviewer who deletes everything under `src/renderer/src/voice/` must still be left with a **hardened
app**.

---

## ⚠ THE MEASUREMENT THAT MAKES THE ORDERING NON-NEGOTIABLE — F79

**F79 (recorded 2026-08-17):** measured in a real Electron 43.1.1 process (Chrome 150.0.7871.114)
whose main script installs **neither** permission handler — i.e. reproducing `src/main/` exactly as
you will find it:

```
navigator.mediaDevices.getUserMedia({ audio: true })
  -> RESOLVED in 147 ms
  -> 1 live audio track, device label exposed, native sampleRate 48000, channelCount 1
```

`Phase-5-VoicePlan.md` §4.3 flagged this behaviour as **NOT VERIFIED** and warned that assuming *"it
approves"* is the D4 failure mode. **It approves.** The finding is not "the guess was right" — it is
that **the boundary is open at HEAD.** Chorus ships today with no stated microphone position.

**⚠ AND IT TAKES BOTH HANDLERS.** Electron's own `setPermissionRequestHandler` documentation:

> *"you must also implement `setPermissionCheckHandler` to get complete permission handling. Most web
> APIs do a permission check and then make a permission request if the check is denied."*

Installing only the request handler leaves a hole that **testing the happy path cannot reveal**,
because the happy path is the one that goes through the handler you installed.

---

## ⚠ THE SECOND MEASUREMENT THAT CONSTRAINS THE CODE — F80

Measured 2026-08-17 under the app's **own** CSP, copied verbatim from `src/renderer/index.html:8`:

```
audioWorklet.addModule('./worklet.js')                        ->  OK
audioWorklet.addModule(URL.createObjectURL(new Blob([...])))  ->  AbortError, BLOCKED
```

`default-src 'self'` carries **no `blob:`**. **Generating the worklet processor source as a blob at
runtime is the common AudioWorklet idiom and it fails here**, with a generic `AbortError` naming
neither the CSP nor the directive.

**The worklet ships as a FILE that Vite emits as an asset. The CSP is NOT widened.** This is D1's
lesson on its fourth registry (Zod-in-preload `EvalError` → missing `connect-src` → missing
`wasm-unsafe-eval` → now `blob:` worklets): *the answer to "the CSP blocks this library" is to change
the code, never the policy.*

**✅ One worry the same probe RETIRED:** `new AudioContext({ sampleRate: 16000 })` is **honoured
exactly** — device native rate **48000**, default context **48000**. Chromium resamples for you.
`Phase-5-VoicePlan.md`'s expectation that *"resampling from the device rate is the likely real work"*
does **not** hold. **Assert the honoured rate at runtime anyway**, and fail loudly if a future
Electron stops honouring it — shipping 48 kHz audio to a transcriber expecting 16 kHz does not
error, it just transcribes badly.

---

## Ground yourself first — read before editing

**In this order. There is no workflow-kit directory in this repo (`.codex/workflows/subagents/` does
not exist); this document is the workflow.**

1. `CLAUDE.md` — the locked stack and the non-negotiable architecture rules.
2. [`Phase-5-Overview.md`](Phase-5-Overview.md) — the phase's ground facts, the D4 results, D159–D162,
   and the **purity contract** every Phase 5 task inherits.
3. [`Task-5-1.md`](Task-5-1.md) — scope, non-goals, acceptance criteria.
4. [`../ImplementationSpecs/ImplementationSpec-5-1.md`](../ImplementationSpecs/ImplementationSpec-5-1.md)
   — **normative**: exact insertion points, code shapes, and the comments that must be present.
5. [`../Phase-5-VoicePlan.md`](../Phase-5-VoicePlan.md) §4 and §9 — **authoritative on design**: the
   forced renderer/main split and the state machine. ⚠ Its §12 D4 table is **stale**; the Overview
   carries the re-measurement.
6. `docs/Features/Foundation/roadmap.md` §6 — read **D1**, **D14**, **D155**, **D160**, **D161**,
   **D162**, **F79**, **F80**.

**Code to read before editing (line numbers verified 2026-08-17 at `2068b70`):**

| Where | What |
|---|---|
| `src/main/index.ts:1` | the `electron` import — **add `session` to this existing line**, do not add a second import |
| `src/main/index.ts:321` | `app.whenReady().then(async () => {` opens |
| `src/main/index.ts:325` | `setAppUserModelId` — the handlers go immediately after here |
| `src/main/index.ts:153` | `function createWindow(...)`; its `webPreferences` carries `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false` |
| `src/main/index.ts:721` | `registerIpc(` is called |
| `src/main/index.ts:822` | `createWindow(restoringSessions)` is called — **hundreds of lines after the handlers must be installed** |
| `src/renderer/index.html:7–8` | the CSP: `http-equiv` at `:7`, `content` at `:8` |
| `src/preload/index.ts` | the Zod-free typed forwarder pattern over `ipcRenderer.invoke(IpcChannel.X, …)` |
| `src/shared/ipc.ts:14` | `IpcChannel` opens |
| `src/main/services/git.ts` | the house pattern for a service with every effect injected |

---

## ⚠ STEP 1 — REPRODUCE F79 BEFORE YOU CLOSE IT

**Do this first, and put the output in `_verify/5-1/f79-before.txt`.** You are about to install a
security boundary; you need the "before" reading to prove you moved anything.

Run the dev app, open devtools on the renderer, and evaluate:

```js
await navigator.mediaDevices.getUserMedia({ audio: true })
  .then(s => { const t = s.getAudioTracks()[0]; const r = { ok: true, label: t.label, settings: t.getSettings() }; s.getTracks().forEach(x => x.stop()); return r })
  .catch(e => ({ ok: false, name: e.name, message: e.message }))
```

**Expected before your change: `ok: true`.** If it is already `false`, **stop and report** — someone
has installed a policy since this document was written, and the task's premise has changed.

---

## Implementation scope

**Create:**

| File | Purpose |
|---|---|
| `src/main/services/voiceCore.ts` | **Pure.** `isOwnOrigin`, `toInt16`, `admitFrame`, the constants. No `electron`, no `fs`, no clock. |
| `src/main/services/voiceCore.test.ts` | Unit tests |
| `src/main/services/voice.ts` | The main-side capture sink: one session at a time, queue policy, state emission |
| `src/main/services/voice.test.ts` | Unit tests, every effect injected |
| `src/renderer/src/voice/capture.ts` | `getUserMedia` → `AudioContext({sampleRate:16000})` → `AudioWorkletNode` → frames |
| `src/renderer/src/voice/pcm-worklet.js` | **The processor, as a real file** (F80) |

**Edit:**

| File | Change |
|---|---|
| `src/main/index.ts` | **Both** permission handlers on `session.defaultSession`, at the top of `whenReady`; construct the voice service; pass it to `registerIpc` |
| `src/main/ipc.ts` | The `voice:*` handlers |
| `src/shared/ipc.ts` | The `voice:*` channels and Zod schemas |
| `src/shared/ipc.test.ts` | **Re-count both assertions from the merged tree** |
| `src/preload/index.ts` | The typed forwarder |

**Nothing else.**

### Binding rules

- **D162 (2026-08-17, RESOLVED):** *"The microphone permission policy is installed BEFORE the first
  capture line, and it takes BOTH handlers."* Allow `'media'` **only** for the app's own origin;
  deny every other permission outright. `isOwnOrigin` must accept the dev-server origin **and** the
  packaged `file://` root, and **nothing else** — `() => true` is the pre-task behaviour with extra
  steps.
- **Log the permission NAME, never the URL.** A requesting URL can carry query content.
- **F80:** the worklet is a file. `createObjectURL` must appear **nowhere** under
  `src/renderer/src/voice/`.
- **D1 + the declared limit:** the frame **envelope** is fully Zod-validated in **main**; the sample
  payload is **length- and type-checked, not element-validated** — and the schema file must **say so
  in a comment**, so it is never read as a D1 exemption. `sampleCount` is cross-checked against
  `samples.length`; a disagreement is a **dropped frame**, not a throw.
- **D14:** the `Int16Array` must be built fresh per frame in the capture module and handed straight
  to `send`. **Never store a frame in a Pinia/reactive store and forward it from there** — a Vue
  proxy fails structured clone with *"An object could not be cloned"* and there is **no compile-time
  signal**.
- **`voice:capture-frame` is `send`-shaped, not `invoke`-shaped** — at ~16 frames/second `invoke`
  would allocate a promise and await a main round trip per frame, for a reply nobody reads. ⚠ **It
  is this app's first renderer→main non-`invoke` channel**, so the channel tally becomes
  three-category: `total = handle() + main→renderer events + renderer→main sends`. `ipc.test.ts`
  asserts only the total so nothing breaks — **write the note at the channel definition anyway**, per
  the spec.
- **`toInt16` clamps, never wraps.** Web Audio does not guarantee `[-1, 1]`; a hot microphone
  overshoots and `x * 32768` flips a loud sample to the opposite sign.
- **The queue bound is expressed as a DURATION in its comment**, not as a bare number.
- **Release the device on every exit path** — stop, cancel, error, window close — and assert
  `track.readyState === 'ended'`.

---

## Strict non-goals

- **No transcription, no whisper, no model, no child process.** Frames are counted and dropped.
- **No `uiohook-napi`, no hotkey.** Capture is started/stopped by a temporary dev-only trigger.
- **No overlay window, no dictation target, no target ring.**
- **No `session:write`.** Nothing reaches any agent in this task.
- **No refinement, no LLM, no `createApiSession`.**
- **No settings UI and no new nav entry** — **D76** forbids a nav row with nothing behind it, and
  after this task there is still nothing behind it.
- **No migration.** `MIGRATIONS.length` stays **20**; `v21` is **not** claimed (**D161**, 2026-08-17:
  *"Phase 5 v1 persists no transcripts: spend metering only — and the phase therefore takes no
  migration at all."*). **If you believe you need one, STOP and report.**
- **No CSP change.** Not `blob:`, not `media-src`, not `connect-src`.
- **No new runtime dependency.** `package.json` `dependencies` stays at **8**.
- **No transcript or audio content in any log**, at any level.
- **No cloud anything** (**D155**, 2026-08-17: cloud STT is out of v1).

---

## Required workflow

1. **Gates 0, 1 and 2 first.** Record your own baseline before touching code.
2. **Step 1's F79 reproduction.** Stop and report if the "before" reading is already `false`.
3. Read the grounding list in order.
4. **Install the permission policy and prove it works BEFORE writing any capture code.** This is the
   task's prime constraint, and it should be visible in how you sequence the work.
5. Implement as a **coordinator**: worker pass → **spec-compliance review clause by clause** →
   **code-quality review** → resolve findings → verification → commit narration.
6. **One intentional commit (G3)**, house style: a concise title, then a plain-language description a
   non-technical reader can follow **first**, technical detail second. **Quote F79's measurement in
   the message** — that Electron grants the microphone silently today is the reason this task exists
   in this order.
7. **Do not push and do not open a PR unless explicitly asked.**
8. If any instruction here conflicts with `CLAUDE.md`, **`CLAUDE.md` wins** — say so in your report.

---

## Verification — run these, do not reason about them

### Build gates

```bash
npm run typecheck          # exit 0 — check the EXIT CODE, not just for "error TS"
npx vitest run             # >= 2230 across >= 66 files, plus your new cases. NEVER --reporter=basic
npm run grep:secrets       # clean, 6 patterns
git diff -- package.json   # MUST BE EMPTY (no new dependency)
```

### Counter gates — what this task must and must not move

```bash
# MUST NOT MOVE
node -e "const ts=require('typescript'),fs=require('fs');const p='src/main/services/storage.ts';const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);let i=null;const w=n=>{if(ts.isVariableDeclaration(n)&&n.name.text==='MIGRATIONS')i=n.initializer;ts.forEachChild(n,w)};w(sf);console.log(i.elements.length)"   # 20
grep -c "sqliteTable(" src/main/db/schema.ts                                                     # 19
git diff src/renderer/index.html                                                                 # EMPTY

# MUST MOVE, AND MUST BE RE-COUNTED FROM THE MERGED TREE — never deltaed from 97
node -e "const ts=require('typescript'),fs=require('fs');const p='src/shared/ipc.ts';const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);let i=null;const w=n=>{if(ts.isVariableDeclaration(n)&&n.name.text==='IpcChannel')i=n.initializer;ts.forEachChild(n,w)};w(sf);while(i&&(ts.isAsExpression(i)||ts.isSatisfiesExpression(i)))i=i.expression;console.log('IpcChannel keys =',i.properties.filter(p=>ts.isPropertyAssignment(p)).length)"
grep -n "toHaveLength(" src/shared/ipc.test.ts | grep -i ipcchannel      # BOTH assertions updated
```

> **⚠ G6, and this repo has paid for it four times.** `IpcChannel` is a **sum over every branch in
> flight**. Three separate branches once landed at 78, 84 and 80 while the merged truth was 86 —
> every one internally consistent and green on its own. **Re-count after the merge; never add your
> delta to what the file said when you branched.**

### Structural gates

```bash
# BOTH handlers — one is a policy with a hole in it (D162)
grep -rn "setPermissionRequestHandler\|setPermissionCheckHandler" src/main/

# The worklet is a file, not a blob (F80)
grep -rn "createObjectURL" src/renderer/src/voice/          # ZERO

# The pure core stays pure
grep -nE "from 'fs'|from 'node:fs'|from 'electron'" src/main/services/voiceCore.ts   # ZERO

# No audio/transcript content in logs — review EVERY hit by hand
grep -rn "logger\." src/main/services/voice*.ts
```

### ⚠ Runtime drive — the task is not done until this has been OBSERVED, not compiled

**Environment notes for this machine, so you do not lose an hour:**

- Use the **dev** build. **Kill the dev instance by command line (`*9222*`), never by process name** —
  killing `electron.exe` by name takes out the user's real installed Chorus and its database.
- Prefer **CDP on `--remote-debugging-port 9222`** for driving the window.
- **OS toasts are dead on this machine** (`ToastEnabled=0`, every toast failing
  `HRESULT: -2143420140`). No error may rely on one to be seen.

Drive these **in this order** and put the evidence in `_verify/5-1/`:

1. **DENY path first.** Request a non-media permission and confirm it is **refused**, with one log
   line naming the permission and **no URL**:
   ```js
   await new Promise(r => navigator.geolocation.getCurrentPosition(() => r('GRANTED'), e => r('DENIED: ' + e.message)))
   ```
2. **ALLOW path.** Re-run Step 1's `getUserMedia` snippet: still `ok: true`, then **every track
   `readyState === 'ended'`** after stop.
3. **RATE.** Log the live `AudioContext.sampleRate` from the running app — must read **16000**
   against a device rate of **48000**. Record both. *(A number quoted from this document is not
   evidence.)*
4. **FRAMES.** Speak ~5 s; main reports a frame count consistent with ~16 frames/second, with
   **contiguous sequence numbers from 0**.
5. **BACKPRESSURE.** Stall the sink artificially. The queue **bounds**, drops are **counted and
   surfaced**, and **memory stays flat while dropping** — watch it in the task manager, do not assume.
6. **SECOND CAPTURE REFUSED** while one is live.
7. **THE REVERT TEST — this is the task's prime constraint, made checkable.** Stash the entire
   `src/renderer/src/voice/` directory, rebuild, and confirm the app **still refuses non-media
   permissions**. Restore it afterwards.

---

## Failure honesty clause

If a verification command fails for an unrelated environment reason, **capture the exact output,
explain it, and do not claim success.** If you cannot drive a runtime gate, **say which one and why**
— this program's roadmap records phases whose value came precisely from a gap being named rather
than rounded up. A `DONE_WITH_CONCERNS` with an honest gap is worth more than a `DONE` that will be
found out.

**Specifically: do not report a green suite you did not see a test COUNT for.**

---

## Final reporting requirements

Report, in this order:

1. **Status:** `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`.
2. **Files changed**, with a one-line purpose each. Confirm the six created and five edited files and
   **nothing else**.
3. **Build results**: typecheck exit code, the vitest **count** and file count, `grep:secrets`.
4. **Counter results**: `IpcChannel` before → after (**re-counted, not deltaed**), and confirmation
   that `MIGRATIONS.length` is **20**, `sqliteTable(` is **19**, `package.json` diff is empty and
   `index.html` is byte-identical.
5. **Runtime results — what you actually OBSERVED**, for all seven drives, including the measured
   `AudioContext.sampleRate`, the device rate, the frame count, and the revert test's outcome.
6. **F79 before/after readings**, quoted.
7. **Review outcomes**: what the spec-compliance and code-quality passes found, and how each finding
   was resolved. **Declare any deviation from the spec rather than absorbing it** — a spec that
   quietly diverges stops being a spec.
8. **Non-goals confirmation**: state explicitly that no transcription, hotkey, overlay, injection,
   refinement, settings row, migration, CSP change or new dependency landed.
9. **Residual risks** and anything the next task (5-2) inherits.
10. **Final `git status --porcelain`** and the commit SHA.
