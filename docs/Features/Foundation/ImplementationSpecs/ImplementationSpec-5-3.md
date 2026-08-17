# Implementation Spec 5-3 — Activation, overlay, target, injection

_Normative companion to [`../Tasks/Task-5-3.md`](../Tasks/Task-5-3.md).
Written 2026-08-17 against `4369954`. ⭐ This is the milestone task._

---

## §0 — The dependency, and what the D4 pass already settled

```
npm install uiohook-napi        # 1.5.5 — runtime deps 8 -> 9
```

Pre-approved: `Plan.md:54` names `uiohook-napi (true keydown/keyup)` in the
**locked stack**, so `CLAUDE.md`'s *"ask before adding dependencies not named in
the stack"* does not bite.

**Measured 2026-08-17 — do not re-litigate, but DO re-confirm the install log:**

- `"prebuild": "prebuildify --napi"`, `"install": "node-gyp-build"`, sole
  dependency `node-gyp-build`. **N-API.**
- `prebuilds/win32-x64/uiohook-napi.node` ships; install took **3 s with zero
  compilation** — no `node-gyp`, no MSVC.
- The **same `.node`** loaded under Node `modules 127` **and** Electron 43.1.1
  `modules 148`.
- In a **real Electron main process**, `keydown` **and** `keyup` were captured
  from genuine OS input.

⚠ **If the install log shows `node-gyp` running, stop.** That means the prebuild
did not match and you are compiling — a different situation from the one this
phase was planned against, and it changes the packaging story.

### The export name, which is the single likeliest silent failure

```ts
import { uIOhook, UiohookKey, EventType } from 'uiohook-napi'
// ⚠ LOWERCASE `h`: uIOhook. `uIOHook` is undefined.
// In TS the wrong casing fails at compile time; in any JS interop, a dynamic
// import, or a destructure with a fallback it does NOT — it yields undefined
// and the hotkey silently never fires, which reads as "the hook is broken"
// rather than "the identifier is wrong". Measured 2026-08-17.
```

---

## §1 — `hotkeyCore.ts` (new, pure) — where activation is actually proven

`uiohook` cannot be unit-tested (it needs a real OS input stack), so **all
activation logic lives here**, behind a pure interface, and the impure wrapper
in §2 stays thin enough to review by eye.

```ts
export type Activation = 'hold' | 'toggle'
export type HotkeyEvent = { kind: 'down' | 'up'; keycode: number }

export function reduce(state: CaptureState, ev: HotkeyEvent, mode: Activation): CaptureState
export function parseChord(s: string): Chord | null
export function formatChord(c: Chord): string
export function nextTarget(targets: TargetId[], current: TargetId | null): TargetId | null
```

Required semantics, each with a test:

| Case | Expected |
|---|---|
| hold: down → up | `listening` → `finalizing` |
| hold: **key repeat** (down, down, down, up) | ONE session. ⚠ Windows auto-repeat fires `down` continuously while held — the reducer must ignore repeats, not open a session per repeat |
| toggle: down/up, down/up | `listening` then `finalizing` — the second **down** ends it; the intervening `up` is inert |
| toggle: key **held** | does **not** double-fire |
| start while `listening` | **refused**, not queued, not replacing |
| `nextTarget` | stable order, wraps, no-op with one pane |
| `parseChord` on garbage | `null` — refused, never coerced to a default |

⚠ **The key-repeat case is the one most likely to be missed and is guaranteed to
occur**: every held key on Windows produces a stream of `down` events.

---

## §2 — `hotkey.ts` (new, impure and thin)

```ts
// ⚠ LOADING IS AN OUTCOME, NOT AN ASSUMPTION.
// VoicePlan §10 lists "the native hotkey hook fails to load" as a real failure
// mode. If it throws into boot, a native-module problem becomes a dead app —
// and the app has a fully working alternative (click-to-talk) sitting right
// there. Return the outcome; let the UI say PTT is unavailable.
export function startHotkeys(): { ok: true } | { ok: false; reason: string }
```

**Stop the hook on every exit path**, including `before-quit`:

```ts
// ⚠ A GLOBAL LOW-LEVEL KEYBOARD HOOK MUST NOT OUTLIVE THE PROCESS.
// This is a system-wide hook. Leaking it is worse than leaking a file handle:
// it observes every keystroke the user makes in every application.
```

---

## §3 — The overlay window

```ts
new BrowserWindow({
  width, height,
  frame: false,
  transparent: true,
  resizable: false,
  movable: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  focusable: false,        // ⚠ THE LOAD-BEARING ONE
  show: false,
  webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false }
})
win.setAlwaysOnTop(true, 'screen-saver')
win.setVisibleOnAllWorkspaces(true)
```

```
⚠ `focusable: false` IS THE POINT OF THE WHOLE FEATURE, NOT A POLISH DETAIL.
PTT exists to dictate at a Chorus pane WHILE AN IDE OWNS THE FOREGROUND
(VoicePlan §7.1). An overlay that activates:
  (a) takes focus from the editor the user is reading — the exact thing they
      were avoiding by not alt-tabbing;
  (b) changes what "the focused pane" means MID-CAPTURE, which can move the
      dictation target out from under the ring the user is looking at.
Show it with `showInactive()`, never `show()`.
```

Use the same CSP as `src/renderer/index.html` in `overlay.html`. **Do not widen
it** for the overlay — a second window with a laxer policy is a policy hole with
a nice UI on it.

The overlay shows: state, a live input level, the **target pane's name**, and
elapsed time. It must never show transcript text — it is on top of every
application, including whatever the user is screen-sharing.

---

## §4 — Target, ring, and the write

### Target

Defaults to the focused pane; shown **before the user speaks** (`Plan.md` §7
lists this under glanceability); cycled with **Tab while held** (the mock's own
words: *"hold tab while dictating to cycle targets"*).

⚠ **The ring and the focus are different things and will diverge.**
`src/renderer/src/attention/reporter.ts:11–22` records **three separately
verified reasons** not to use `viewStore.focusedSessionId` as an instrument, and
**all three bite this feature**:

1. **It survives blur, minimize and process exit** — it is persisted state
   telling the filmstrip which pane to render full-size next boot. Dictation
   needs an *instantaneous* fact.
2. **Grid mode never updates it.** `TerminalPane` emits `focus` from a real
   textarea listener and `FilmstripRenderer` forwards it, but `LayoutRenderer`
   binds no `@focus`, so the emit is dropped — *"CONFIDENTLY WRONG and therefore
   worse than missing."* In grid mode the ring would point at whichever pane was
   last focused **in the filmstrip**.
3. **It is never FK-checked (F4) and legitimately names a deleted session** —
   which is the target-death case below, arriving through the front door.

**The dictation target is therefore its own state**: seeded from the DOM-focus
walk at capture start, then owned by this feature for the capture's lifetime.
**Do not read `focusedSessionId` mid-capture, and do not re-resolve at write
time.**

### The write

```ts
// ⚠ EXACTLY ONE session:write, AND NO TRAILING NEWLINE. EVER.
// Enter in an agent pane starts an autonomous process that edits files and runs
// commands, on a sentence that may have been misheard. `Plan.md` §9's
// no-auto-Enter default is a SAFETY RULE here, not a UX preference.
// A trailing "\r" or "\n" IS pressing Enter.
await sessions.write(targetId, transcript)   // no newline, no chunking, one call
```

### Target death

```
⚠ LOSING THE TARGET DOES NOT CANCEL THE CAPTURE (VoicePlan §7.3, §9).
The pane can be killed, exited, closed, or have its project archived (Phase 3h
refuses launches into archived projects) while transcription is still running.
Required:
  - the transcript SURVIVES and is surfaced in-app for recovery;
  - it is NEVER written to whichever pane inherited focus — silently
    redirecting a user's words into a different agent is the worst outcome this
    feature can produce, and it is the default behaviour if the target is
    re-resolved at write time rather than captured at start time;
  - and NOT via a toast (ToastEnabled=0 — proven dead on this machine).
```

**Resolve the target once, at capture start. Hold the id. Validate it still
exists at write time and route to recovery if not.**

---

## §5 — Verification

### Deterministic

```
npm run typecheck                                # 0
npx vitest run                                   # count printed; NEVER --reporter=basic
npm run grep:secrets                             # clean

node -e "const d=require('./package.json').dependencies;console.log(Object.keys(d).length,'uiohook-napi' in d)"   # 9 true
ls node_modules/uiohook-napi/prebuilds/win32-x64/uiohook-napi.node               # exists
grep -rn "uIOHook" src/                                                          # ZERO (capital H)
grep -rni "fleet" src/                                                           # ZERO (D156)
grep -rnE "\\\\r|\\\\n" src/main/services/voice.ts                               # review EVERY hit
git diff src/renderer/index.html                                                 # EMPTY
```

### Runtime — the milestone lives here

1. **⭐ THE MILESTONE.** Open an IDE, give it foreground. Hold the hotkey,
   speak a sentence, release. Capture: a screenshot showing the **overlay
   visible over the IDE**, and the resulting text at the ringed pane's `❯`.
2. **Nothing submitted.** Photograph the pane: text on the input line, agent
   still at its prompt, no execution. **This is the safety claim and it is
   photographic.**
3. **Focus never stolen.** Confirm the IDE keeps foreground for the whole
   capture and the caret does not move. Sample `GetForegroundWindow()` through
   the capture rather than trusting a single reading — other desktop apps steal
   foreground mid-run on this machine (F29's corollary).
4. **Key repeat.** Hold the key for ~5 s: **one** capture, not dozens.
5. **Click-to-talk with the hook dead.** Force the load failure (rename the
   `.node`), restart: PTT reports unavailable, **click-to-talk still dictates
   end to end.** The accessibility path may not depend on the native module.
6. **Ring ≠ focus.** With ≥3 panes, Tab the ring to a pane that is *not* focused.
   The text must land in the **ringed** one.
7. **Target death.** Kill the ringed pane mid-transcription: transcript
   preserved and surfaced; **no other pane receives it**. Check every pane.
8. **No leaked hook.** Quit; confirm no stray process and that keystrokes in
   other apps are no longer observed.

⚠ **Drive the OS input with `keybd_event`, not CDP.** F29: CDP-injected input is
invisible to the Windows input stack — it would not reach a global hook at all,
and a probe built on it would report a working feature as broken (or worse, a
broken one as working).

### What a reviewer should distrust

- `show()` anywhere the overlay is displayed — it must be `showInactive()`.
- `focusable` omitted, on the theory that `alwaysOnTop` is enough. It is not.
- The target read from `viewStore.focusedSessionId` at **write** time.
- Any `\n` or `\r` reaching `session:write`.
- Key-repeat handling that was reasoned about rather than held down for 5 s.
- Click-to-talk sitting downstream of the hook's load.
- `uIOhook.stop()` on the happy path only.
- A milestone claim where Chorus had the foreground — that is not the milestone.
