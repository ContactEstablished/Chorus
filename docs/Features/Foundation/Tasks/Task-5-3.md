# Task 5-3 — Activation, overlay, target, injection ⭐ **the phase milestone**

_Phase 5, task 3 of 4. Authored 2026-08-17 against `4369954`._

---

## Source Of Truth

| Document | Owns |
|---|---|
| [`Phase-5-Overview.md`](Phase-5-Overview.md) | Ground facts, the `uiohook-napi` D4 result, the purity contract |
| [`../Phase-5-VoicePlan.md`](../Phase-5-VoicePlan.md) §6, §7, §9, §10 | The PTY destination, activation models, state machine, failure modes — **authoritative on design** |
| [`../ImplementationSpecs/ImplementationSpec-5-3.md`](../ImplementationSpecs/ImplementationSpec-5-3.md) | Exact window options, key handling, insertion points |
| `roadmap.md` §6 | **D73** (the mock is the authority) · **D132/D156** (Fleet Switcher, split out) · **D160** (direct-to-prompt only) |
| `Plan.md:54` | `uiohook-napi` is in the **locked stack** — pre-approved, no dependency question to ask |

---

## Initial Starting Point — verified 2026-08-17 at `4369954`

| Fact | Value |
|---|---|
| `uiohook-napi` | **1.5.5** · `prebuildify --napi` + `node-gyp-build` · `prebuilds/win32-x64/uiohook-napi.node` **ships** · installs in **3 s with zero compilation** |
| ABI | The **identical `.node`** loads under Node `modules 127` **and** Electron 43.1.1 `modules 148` — **no rebuild, ever**, the `node-pty` case |
| Proven functionally | In a **real Electron main process**, alongside Chromium's message loop: **keydown AND keyup** captured from genuine OS input |
| ⚠ Export name | **`uIOhook`** — *lowercase `h`*. `uIOHook` is `undefined` and fails at runtime, not at typecheck-time in JS |
| API | `.start()` `.stop()` `.on(event, cb)` `.keyTap()` `.keyToggle()` · `EventType.EVENT_KEY_PRESSED` / `EVENT_KEY_RELEASED` · `UiohookKey` **124** entries · ships `index.d.ts` · MIT |
| Injection channel | `IpcChannel.SessionWrite` = `'session:write'`, `src/shared/ipc.ts:23` |
| Runtime dependencies | **8** → **9** after this task (the only dependency Phase 5 adds) |
| `MIGRATIONS.length` | **20**, and it stays there (D161) |

> **✅ THE PHASE'S SHAPE-CHANGING RISK IS ALREADY RETIRED.** The roadmap marked
> this probe *"do this first"* because a missing prebuild would have changed what
> Phase 5 *is*. It is not missing, it needs no rebuild, **and it was driven to a
> real captured keystroke rather than merely loaded** — because "the module
> imports" and "the hook works" are two different claims, and only the second one
> is the feature.

---

## Goal

Make the feature real. Add push-to-talk over `uiohook-napi` and click-to-talk as
its equal, paint an always-on-top recording overlay that is visible **while
another application owns the foreground**, put a ring on the pane that will
receive the text, and write the transcript into that pane with `session:write`
— **and never press Enter.**

**This task meets the phase milestone.**

---

## ⚠ The milestone, stated so it can be failed

> Hold the hotkey **while an IDE owns the foreground**, speak a sentence, release.
> The overlay is visible throughout without stealing focus. The transcript
> appears **at the `❯` prompt of the ringed pane** — and **nothing is submitted.**
> The user presses Enter themselves, or edits first, or clears the line.

If any clause is unmet the milestone is unmet. In particular: *"it worked when
Chorus was focused"* is **not** this milestone — a hotkey that needs Chorus
focused solves a problem nobody has (VoicePlan §7.1).

---

## Exact Scope

**Create:**

| File | Purpose |
|---|---|
| `src/main/services/hotkeyCore.ts` | **Pure.** Chord parsing/formatting, the press/release state machine, the hold-vs-toggle decision, Tab-cycle target selection. No `uiohook`, no `electron`. |
| `src/main/services/hotkeyCore.test.ts` | Unit tests — this is where the activation logic is actually proven |
| `src/main/services/hotkey.ts` | The thin impure wrapper around `uIOhook`; **load failure is a first-class outcome, not a throw** |
| `src/main/services/voiceOverlay.ts` | The always-on-top overlay `BrowserWindow`'s lifecycle |
| `src/renderer/src/voice/VoiceOverlay.vue` | The overlay's contents — state, level, target name, elapsed |
| `src/renderer/src/voice/overlay.html` | The overlay window's entry point, carrying **the same CSP as `index.html`** |

**Edit:**

| File | Change |
|---|---|
| `package.json` | `uiohook-napi` — **the only dependency Phase 5 adds** (8 → 9) |
| `src/main/index.ts` | Construct the hotkey service and overlay; stop the hook on `before-quit` |
| `src/main/services/voice.ts` | Target ownership, injection through `session:write`, the target-died recovery path |
| `src/main/ipc.ts` | Target selection and overlay channels |
| `src/shared/ipc.ts` + `ipc.test.ts` | New channels; **re-count both assertions from the merged tree** (G6) |
| `src/renderer/src/…` (pane chrome) | The dictation **target ring** |

---

## ⚠ Four traps, three of them measured and one structural

1. **`uIOhook`, not `uIOHook`.** Lowercase `h`. The wrong casing is `undefined`
   at runtime — it does not fail at build time, and the symptom is "the hotkey
   silently does nothing", which reads as a hook problem rather than a typo.
2. **The overlay must not take focus.** An always-on-top window that activates
   **defeats the entire feature**: PTT exists to dictate while an IDE has the
   foreground, and stealing focus mid-dictation both moves the user's caret and
   changes which pane "focused" means. The window is `alwaysOnTop`,
   `skipTaskbar`, **non-focusable**, and never calls `show()` in a way that
   activates.
3. **The hook can fail to load, and click-to-talk must survive it** (VoicePlan
   §10). If `uiohook` does not load, **PTT is unavailable and the feature still
   works** through click-to-talk. This is not defensive coding — click-to-talk is
   the **accessibility path** (VoicePlan §7.2: a sustained hold is exactly the
   interaction a motor-impaired user cannot perform), so a build where PTT is the
   only route is a broken build even when the hook loads.
4. **The target pane can die mid-flight** — killed, exited, closed, or its
   project archived (Phase 3h refuses launches into archived projects). The
   transcript **must survive the loss of its target**, and must **never** be
   written into whichever pane inherited focus. Losing the target does not
   cancel the capture; it moves the result to recovery (VoicePlan §7.3, §9).

---

## Non-Goals

- **No auto-Enter. Not as a default, not as a setting, not behind a flag.**
  Pressing Enter starts an autonomous process that edits files and runs commands
  on a possibly mis-transcribed sentence. A "Stop and send" opt-in is **out of
  this task entirely**; if it ships at all it is a later decision with its own
  ruling.
- **No composer, no mode toggle, no "restore the original" UI** (D160). Text
  goes to the prompt; the agent's line editor is the review surface.
- **No Fleet Switcher** (D156). This task builds the always-on-top plumbing that
  a later Fleet Switcher would inherit — **it does not build a second overlay.**
- **No refinement** (5-4). The text injected here is the raw transcript.
- **No settings UI.** The hotkey is configurable *in principle*; the surface that
  configures it is 5-4's (D76).
- **No migration** (D161); **no CSP widening**; **no transcript in logs**.
- **No `globalShortcut`.** Electron's own API fires on press and cannot express
  hold-to-talk — which is the entire reason `Plan.md:54` locks `uiohook-napi`.
- **Do not revert or commit** the pre-existing uncommitted doc changes.

---

## Dependencies

**Task 5-2** — a working offline transcript is what this task delivers to a pane.

---

## Step-by-step Work

1. **`hotkeyCore.ts` first, pure and fully tested.** Press/release → capture
   start/stop; hold vs toggle; the Tab-cycle order; the refusal of overlapping
   sessions. **This is where activation correctness is proven**, because the
   `uiohook` half cannot be unit-tested.
2. **`hotkey.ts`** — a thin wrapper. `start()` returns a typed *outcome*
   (`loaded` / `failed(reason)`), never throws into boot. Stop the hook on
   `before-quit`; a global OS hook outliving the app is a real hazard.
3. **The overlay window**, non-focusable and always-on-top, created **hidden**
   and shown on capture. Verify it does not appear in the taskbar or alt-tab.
4. **Target selection**: default to the focused pane, show the ring **before the
   user speaks** (`Plan.md` §7 lists this under glanceability), cycle with Tab
   while held.
5. **Injection** through `session:write` — and *only* `session:write`, so it
   takes the one path every other write takes.
6. **Recovery**: target died → the transcript is preserved and surfaced in-app,
   never discarded and never redirected.
7. **Re-count `IpcChannel`** from the merged tree.

---

## Test Expectations

**`hotkeyCore.test.ts` carries the weight:**

- Hold: press → `listening`, release → `finalizing`. A repeat press while
  listening does **not** open a second session.
- Toggle: press → `listening`, second press → `finalizing`; a *held* key in
  toggle mode does not double-fire.
- Tab cycles targets in a stable order and wraps; Tab with one pane is a no-op.
- Chord parse/format round-trips; an unparseable chord is refused, not coerced.
- The full state machine reaches `cancelled` and `failed(recoverable)` from
  every state after `ready`.

**`voice.test.ts` additions:**

- Target dies during `finalizing` → transcript preserved, **zero** `session:write`
  calls, recovery surfaced.
- Injection calls `session:write` exactly once, with **no trailing `\r`/`\n`**.
- Hook-load failure → PTT reports unavailable, click-to-talk path unaffected.

**Expect roughly +45 to +65 tests.**

---

## Verification Commands

```
npm run typecheck                 # 0
npx vitest run                    # >= 5-2's total + new; NEVER --reporter=basic
npm run grep:secrets              # clean

# The dependency is the ONLY one this phase adds
node -e "const d=require('./package.json').dependencies;console.log(Object.keys(d).length, 'uiohook-napi' in d)"   # expect 9 true

# It needs no rebuild — the prebuild is used as shipped
ls node_modules/uiohook-napi/prebuilds/win32-x64/uiohook-napi.node

# Correct export casing (the silent-failure trap)
grep -rn "uIOHook" src/                 # expect ZERO hits (capital H is wrong)
grep -rn "uIOhook" src/main/services/hotkey.ts   # expect the import

# NOTHING auto-submits
grep -rnE "session:write|SessionWrite" src/main/services/voice.ts
grep -rnE "\\\\r|\\\\n|Enter" src/main/services/voice.ts    # review EVERY hit by hand

# No second overlay, no Fleet Switcher (D156)
grep -rni "fleet" src/                  # expect ZERO

# No migration, no CSP change
git diff src/renderer/index.html        # expect EMPTY
```

### Runtime gates (G2) — the milestone lives here

1. **⭐ The milestone, driven exactly as worded above**, with a screenshot or
   recording showing the overlay visible **while another app is foreground**.
2. **Nothing is submitted.** After injection the agent is **still at its prompt**,
   with the text sitting on the input line unexecuted. Photograph it.
3. **Focus is not stolen.** The foreground application keeps focus for the whole
   capture; the caret does not move.
4. **Click-to-talk works with the hook disabled.** Force the load failure; PTT
   reports unavailable, click-to-talk still dictates end to end.
5. **The ring is on the right pane, before speech.** With ≥3 panes, Tab cycles it
   and the text lands in the ringed pane — not the focused one, when they differ.
6. **Target death.** Kill the ringed pane mid-transcription: the transcript is
   preserved and surfaced; **no** other pane receives it.
7. **The hook does not outlive the app.** After quit, no stray global hook —
   confirm the process tree is clean.

---

## Acceptance Criteria

- [ ] ⭐ Milestone driven and evidenced under `_verify/5-3/`.
- [ ] Overlay visible with another app foreground; **focus never stolen**; not in
      taskbar or alt-tab.
- [ ] **Zero** auto-submission on any path.
- [ ] Click-to-talk fully functional **with `uiohook` unavailable**.
- [ ] Ring shown **before** speech; Tab cycles; text lands in the **ringed** pane.
- [ ] Target death preserves the transcript and misdirects it nowhere.
- [ ] `uiohook-napi` used **from its prebuild** — no `node-gyp` in the install log.
- [ ] Runtime deps **9**; `MIGRATIONS.length` **20**; `index.html` byte-identical.
- [ ] `IpcChannel` re-counted from the merged tree; both assertions updated.
- [ ] No transcript text in any log.
- [ ] typecheck 0 · vitest green with a printed count · `grep:secrets` clean.

---

## Review Checklist

- **Check the export casing.** `uIOhook`. A capital `H` typechecks and silently
  does nothing.
- Is the overlay genuinely non-focusable, or merely `alwaysOnTop`? Ask for the
  window options and the foreground evidence.
- Is click-to-talk a **peer** of PTT, or a fallback bolted on? If the hook loading
  is on its critical path, it is the second thing and the accessibility
  requirement is unmet.
- Does the transcript reach `session:write` **without** a trailing newline —
  and is there exactly one write?
- If the ringed pane and the focused pane differ, which one gets the text? The
  answer must be the **ringed** one, and it must be tested.
- Is `uIOhook.stop()` called on **every** exit path, including crash-adjacent
  ones? A leaked global keyboard hook is worse than a leaked file handle.
- Did the implementer **re-count** `IpcChannel` rather than add a delta?
