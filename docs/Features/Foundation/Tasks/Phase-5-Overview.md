# Phase 5 — Voice Input — kickoff overview

_Decomposed 2026-08-17 against the verified codebase at `4369954`. Four tasks,
four paired implementation specs. Settles **D159–D162** and records **F79–F80**._

---

## The one thing to read before this document

[`Phase-5-VoicePlan.md`](../Phase-5-VoicePlan.md) is **authoritative on design**
and is not restated here. It was authored 2026-08-12 against `e1afe89` — **two
phases and +218 tests ago** — so its *design* stands and **every number in its
§12 D4 table is stale**. This document carries the re-measurement.

The roadmap entry (§7, Phase 5) is authoritative on **scope and status**, which
**D155**, **D156** and this kickoff's **D159–D161** have narrowed since the plan
was written. Where the plan and this document disagree about *what ships*, this
document wins; where they disagree about *how it should behave*, the plan wins.

---

## Verified ground facts — every one measured 2026-08-17 at `4369954`

**Nothing below is inherited from the plan or the roadmap.** Where a re-measure
contradicts an earlier document, the earlier figure is shown struck.

| Fact | Value | How |
|---|---|---|
| `IpcChannel` keys | **97** (~~86~~) | AST-parsed, 0 spreads; asserted twice at `ipc.test.ts` **:3462**, **:3840** |
| `ipcMain.handle(` | **87** | AST-parsed |
| Event channels (declared, never handled) | **10**, enumerated | 87 + 10 = 97 closes exactly |
| `MIGRATIONS.length` | **20** (~~18~~) — next free **`v21`** | AST-parsed `storage.ts:171`; dev DB `MAX(version)` agrees; no sibling branch claims v21 |
| `sqliteTable(` | **19** | AST-parsed `schema.ts` |
| Runtime dependencies | **8** | `package.json` |
| vitest baseline | **2230 / 2230 across 66 files** (~~2012 / 59~~) | `npx vitest run`, exit 0 |
| typecheck | **0**, node + web | `npm run typecheck` |
| `grep:secrets` | clean, 6 patterns | `npm run grep:secrets` |
| Voice code in the tree | **ZERO** — still true | grep: no `uiohook`, no `whisper`, no `getUserMedia`, no `services/voice.ts`, no `AudioWorklet` |
| Permission handlers in main | **NEITHER is installed** — still true | grep `setPermissionRequestHandler\|setPermissionCheckHandler` over `src/` returns nothing |
| CSP | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:` | `src/renderer/index.html`, `http-equiv` at **:7**, `content` at **:8** |
| Injection channel | `SessionWrite: 'session:write'` | `src/shared/ipc.ts:23` |
| BYOK entry point | `createApiSession(spec: ApiLaunchSpec, deps: ApiSessionDeps): ApiSessionHandle` | `src/main/services/apiSession.ts:290` |
| Settings channel-group precedent | `agent-lock:pin-status` / `-set` / `-clear` | `src/shared/ipc.ts:66`, `:70`, `:73` |
| `SettingsView.vue` withholds the Voice nav row | **confirmed** — two entries render (Providers & keys, Agent lock); the docblock at **:15–19** names Voice as one of five withheld mock sections under **D76** | read |
| `deleteProject` purge | **transactional, 10 steps**, `storage.ts:1279` | step **7b** was added *"in the same commit as the table"* for `project_memory`'s enforced FK — the precedent **D161 makes moot for this phase** |

---

### D4 pass — run 2026-08-17, and it is why this kickoff could be written

The roadmap marked the `uiohook-napi` probe **"do this first"** because a missing
prebuild changes the phase's *shape*, not its schedule. It was run first.

| Probe | Result |
|---|---|
| **`uiohook-napi` 1.5.5 build shape** | `"prebuild": "prebuildify --napi"` + `"install": "node-gyp-build"`, sole dependency `node-gyp-build` — **N-API prebuilds** |
| **Windows prebuild present** | ✅ `prebuilds/win32-x64/uiohook-napi.node` ships. Installed in **3 s, zero compilation, no MSVC, no node-gyp** |
| **ABI** | ✅ The **identical `.node` file** loads under Node `modules 127` **and** Electron 43.1.1 `modules 148` |
| **Functional, in a real Electron main process** | ✅ **keydown AND keyup** captured from genuine OS input (`keybd_event` SHIFT), alongside Chromium's message loop |
| **API surface** | Export is **`uIOhook`** — *lowercase h* · `.start()` `.stop()` `.on()` `.keyTap()` `.keyToggle()` · `EVENT_KEY_PRESSED` / `EVENT_KEY_RELEASED` · `UiohookKey` 124 entries · ships its own `index.d.ts` · MIT |
| **Electron mic default with NO handler** | ⚠ **GRANTED SILENTLY in 147 ms**, real device opened, device label exposed → **F79** |
| **`AudioContext({sampleRate:16000})`** | ✅ **Honoured exactly.** Device native rate **48000**, default context **48000** — Chromium resamples for us |
| **`audioWorklet.addModule('./worklet.js')`** | ✅ OK from a same-origin file |
| **`audioWorklet.addModule(blob:…)`** | ⚠ **BLOCKED — `AbortError`** under the shipped CSP → **F80** |
| **whisper.cpp Windows distribution** | ✅ v**1.9.2** (2026-08-04) ships **`whisper-bin-x64.zip`** — 7.9 MB zipped / **19.9 MB unpacked, 37 entries**. `whisper-cli.exe` **0.46 MB** + `whisper.dll` 1.3 MB + `ggml-base.dll` + `ggml-cpu-*.dll` runtime CPU dispatch. **No source build, no node-gyp, no ABI coupling** |
| **Model sizes (live HEAD requests)** | `tiny.en` **74.1 MB** · `base.en` **141.1 MB** · `small.en` **465.0 MB** · `medium.en` **1462.7 MB** |

> **✅ THE HEADLINE D4 ANSWER: `uiohook-napi` NEEDS NO REBUILD.** It is the
> **node-pty** case, not the **better-sqlite3** case, and the roadmap was right
> to insist the two be told apart by measurement rather than by expectation.
> **The `.node` file is not merely present — it was loaded under Electron's real
> ABI and then made to capture a real OS keystroke**, because a prebuild that
> loads and a hook that works are two different claims.
>
> **⚠ AND ONE INTERMEDIATE FINDING OF THIS PASS WAS WRONG, RECORDED BECAUSE THE
> CORRECTION IS THE USEFUL PART.** A first sweep of whisper.cpp's release assets
> reported *"Win32 only — no x64 Windows binary"*, which would have been a real
> problem. It was a **filter bug**: the asset is named `whisper-bin-x64.zip`,
> with no `win`/`windows` in the name, so a `/win|windows/i` filter misses the
> most-downloaded Windows asset in the release (24,823 downloads against
> Win32's 773). **The lesson is F77's, one phase later: a conclusion resting on
> "the search returned nothing" has assumed its corpus.**

---

## The decisions this kickoff settles — D159 … D162

Full text in the roadmap §6. Summarised here because every task depends on them.

- **D159 — `base.en` (141 MB) is v1's default model; `small.en` (465 MB) is an
  opt-in upgrade in settings. `Plan.md` §9 is corrected.** The plan committed to
  small.en before anyone had measured it; at 465 MB **the first dictation a user
  ever attempts is also a 465 MB download that can fail, be slow, or meet an
  offline machine** — the plan's own §10 names first-run as "the path most
  likely to be tested least". base.en is **3.3× smaller** and adequate for
  close-mic English dictation, which is the entire v1 use case.
- **D160 — v1 is DIRECT-TO-PROMPT ONLY. No composer.** The transcript lands at
  the agent's `❯` prompt and the agent's own line editor is the review surface.
  This is what the mock draws, so **D73** makes it the authority; **D137**
  already staged the composer *after* the direct path; and **D76**'s precedent
  is to build the thing before the surface that compares it. Mode switching and
  "restore the original" are therefore **out of v1 by construction**, not by
  omission — they are unbuildable after the write (VoicePlan §6.1).
- **D161 — v1 PERSISTS NO TRANSCRIPTS. Spend metering only, and it takes no
  migration.** D157 requires `onUsage` wired and persisted; that is satisfied on
  the existing spend surface. **`MIGRATIONS.length` stays 20 and `v21` stays
  free.** ⚠ **This retires BOTH schema traps the VoicePlan pre-recorded** (§8.1):
  the next-free-version hazard cannot fire because no version is claimed, and
  the `deleteProject` FK trap cannot fire because no table references
  `projects(id)` or `sessions(id)`. Transcripts live in memory for the duration
  of a dictation. **The source document's clearest rule — the original is never
  overwritten — still binds**; it is enforced in memory rather than in SQLite.
- **D162 — the microphone permission policy is installed BEFORE the first
  capture line, and it takes BOTH handlers.** `setPermissionRequestHandler` and
  `setPermissionCheckHandler`, allowing `'media'` only for the app's own origin
  and denying every other permission outright. **F79 makes this urgent rather
  than tidy: Electron 43.1.1 grants the microphone silently today**, measured,
  in 147 ms, with no handler installed. Electron's own docs say the request
  handler alone leaves a hole *"most web APIs do a permission check and then
  make a permission request if the check is denied"* — so installing one is a
  policy with a gap that testing the happy path will not reveal.

### Decisions taken by the coordinator without asking, and why

- **Finalize-on-release, not streaming interim text** (VoicePlan §11 Q3). The
  mock draws a `transcribing…` pill, which reads as finalize-on-release, and
  **D73 makes the mock the authority**; local whisper makes streaming
  meaningfully harder than cloud does, and cloud is out (**D155**). Revisit when
  an engine that streams cheaply is in scope.
- **The mic overlay is a separate always-on-top `BrowserWindow`, not an in-window
  element.** It follows from the requirement rather than from preference: PTT
  exists to dictate *while another application owns the foreground* (VoicePlan
  §7.1), so an indicator painted inside the main window is invisible exactly
  when it is needed. This is the always-on-top plumbing **D156** said the Fleet
  Switcher would later inherit.

---

## The tasks

**Sequential, not parallel** — all four touch `src/shared/ipc.ts`, and 5-2/5-3/5-4
each build on the previous task's runtime surface.

| # | Task | Ends somewhere demonstrable | Depends on |
|---|---|---|---|
| **[5-1](Task-5-1.md)** | **The microphone boundary and the capture spine** — both permission handlers first, then `getUserMedia` → `AudioWorklet` at 16 kHz mono → bounded frame queue → main | Speak, and main reports N frames at 16 kHz; every non-media permission is refused | None |
| **[5-2](Task-5-2.md)** | **Local transcription** — `whisper-cli.exe` as a child process, `base.en` resolution and first-run download | **The offline floor**: speak, and main produces a transcript with no network, no key, no LLM | 5-1 |
| **[5-3](Task-5-3.md)** | **Activation, overlay, target, injection** — `uiohook-napi` PTT + click-to-talk, always-on-top overlay, dictation target ring, `session:write` with **no auto-Enter** | **⭐ THE PHASE MILESTONE**: hold the key while an IDE owns the foreground, speak, text appears in the targeted pane, nothing is sent | 5-2 |
| **[5-4](Task-5-4.md)** | **Refinement and settings** — Verbatim / Clean up / Organize over `createApiSession` with `onUsage` metered, and the "Voice & dictation" settings section | Clean up produces better text than Verbatim on the same audio; spend is recorded; the settings nav row earns its place under D76 | 5-3 |

---

## The purity contract for this phase

Every task inherits these. They are **non-goals, enforced in each task's own
Non-Goals section**, not aspirations.

1. **No cloud STT.** Audio never leaves the machine in v1 (**D155**). No STT
   vendor client, no `connect-src` widening, no audio in any `fetch` body.
2. **No composer, no mode-switching UI, no "restore the original" affordance**
   after the write (**D160**). They are unbuildable against a PTY (VoicePlan §6.1).
3. **No migration. `MIGRATIONS.length` stays 20; `v21` is NOT claimed** (**D161**).
   A task that believes it needs a migration must **stop and raise it**, per G6.
4. **No Fleet Switcher** (**D156**). The always-on-top plumbing 5-3 builds is
   general, but no second overlay ships.
5. **No auto-Enter, ever, by default.** Pressing Enter in an agent pane starts an
   autonomous process that edits files and runs commands on a possibly
   mis-transcribed sentence. This is a **safety rule, not a UX preference**.
6. **No transcript text in any log**, at any level. This is G4's discipline
   applied to a new category of sensitive content, and it gets its own grep.
7. **No telemetry egress.** Metrics, if any, are local counters (**VoicePlan §8.3**).
8. **The CSP is not widened.** If a library needs `wasm-unsafe-eval`, `blob:` or
   `connect-src`, **the work moves to main** — D1's lesson, now on its fourth
   registry (**F80**).
9. **No OS toast may be the only way an error is seen.** Toasts are proven dead
   on this machine (`ToastEnabled=0`).

---

## Verification every task runs

```
npm run typecheck          # 0, node + web
npx vitest run             # >= 2230, and NEVER with --reporter=basic (see below)
npm run grep:secrets       # clean, 6 patterns
```

Plus the phase's own gate, which every task from 5-2 onward runs:

```
# No transcript text may reach a log. Run against a real dictation's output.
grep -rniE "transcript|utterance" src/main/services/voice*.ts | grep -i "logger\."
```

> **⚠ NEVER RUN THE SUITE AS `npx vitest run --reporter=basic`.** That reporter
> was removed in vitest 4.1.10; the run dies in `loadCustomReporterModule` with
> `ERR_LOAD_URL` having executed **zero tests** — **and exits `0`.** Measured
> 2026-08-16. Assert on the printed test **count**, never on the exit code alone
> and never on the absence of an error string. This is the same false-green
> shape as the empty-`node_modules` `'tsc' is not recognized` incident.

**And G2 applies in full: run the app, speak into it.** Every task from 5-2
onward has a runtime gate that cannot be met by a passing unit test — this phase
is about a microphone, an OS-level hook, and a child process, none of which
vitest can reach.

---

## ⚠ Pre-existing working-tree state at kickoff

At the moment of decomposition the tree carries **uncommitted work that is not
this phase's**:

```
 M docs/Features/Foundation/roadmap.md    <- the 2026-08-16 architect pass (D154-D158, F77-F78)
 M docs/Plan.md                           <- the same pass's usage_records correction
?? docs/Features/Foundation/Tasks/Architect-Pass-Prompt-6a-Close.md
```

**Do not revert, stash, or "clean up" any of it.** ⚠ **And it should be
committed BEFORE Phase 5 execution begins**, for a reason this roadmap has a
scar from: **D139–D142 were once numbered on top of D135–D138 while those lived
only in uncommitted Phase 5 roadmap edits**, and the pass had to write a
collision contingency. **D159–D162 and F79–F80 are in exactly that state right
now** — they exist only in the working tree, so a fresh clone of `main` still
sees D153 / F76 as the ceiling.
