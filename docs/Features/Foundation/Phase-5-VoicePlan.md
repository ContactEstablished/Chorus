# Phase 5 — Voice Input: design plan

**Status:** PRE-KICKOFF DESIGN. Authored 2026-08-12, against the codebase at
`e1afe89`. **No code, no dependencies, no migration were written by the session
that produced this document.**

**Authority:** this document is subordinate to `roadmap.md` (§2's authority
split: the roadmap wins on current status) and supersedes `Plan.md` §9 on the
points D136 names. It exists so that Phase 5's `/phase-kickoff` starts from
settled design questions rather than re-deriving them.

**Provenance.** Matthew authored a requirements document with another model —
`Voice-Input-Feature-Requirements.md`, dated 2026-08-12, drafted in the TaxApp
repo — and asked for it to be integrated here. **A faithful copy lives at
[`Investigations/Voice-Input-Feature-Requirements-source.md`](Investigations/Voice-Input-Feature-Requirements-source.md)
so the original survives independently of this translation.** This document is
not that document. The source is written for a generic multi-tenant web
application; Chorus is a local-first, single-user, Windows-only Electron app
whose dictation target is a **pseudoterminal running an autonomous coding
agent**. §3 records every place that difference changes an answer.

**⚠ Every D4 fact in §12 was obtained 2026-08-12 and MUST be re-verified at
execution time.** Phase 5 has not been kicked off, Phase 6 is still open ahead of
it, and CLAUDE.md's standing rule is explicit that native-module and CLI facts
move fast.

---

## 1. Why this phase needs a plan before its kickoff

Voice is in the product one-liner (`Plan.md:4`) and specified at `Plan.md` §9,
but **zero code exists** — verified 2026-08-12: no `uiohook-napi`, no whisper
binding, no `getUserMedia` call, no `services/voice.ts`, and no
`setPermissionRequestHandler` anywhere in `src/main/`. The only voice artifacts
in the tree are the design mock, a settings nav entry that `SettingsView.vue`
**deliberately does not render** (D76 forbids a nav row with nothing behind it),
and the app's unrelated "seven voices" metaphor for agents.

Four things would otherwise be discovered at the worst moment:

1. **The source requirements assume an app-owned text field. Chorus writes into
   a PTY it does not own** (§6). Half the review-and-edit model in the source
   §11 is unbuildable against a terminal buffer, and the half that is buildable
   needs a surface the mock does not draw.
2. **The renderer cannot do the transcription and main cannot do the capture**
   (§4). The split is forced by Chromium, not chosen, and it makes voice the
   first feature that streams bulk binary renderer → main.
3. **The shipped CSP would break two of the three obvious implementations**
   (§4.2) — the same `EvalError` shape as D1, in a third registry.
4. **Electron currently grants microphone access silently** (§4.3). No
   permission handler is installed, so the default-approve behavior is live
   today.

---

## 2. What the source document gets right, and is adopted wholesale

These are adopted without amendment and are not re-argued at kickoff:

- **The original transcript is the source of truth.** AI never silently replaces
  what the user said. Every refined version is labeled, reversible, and stored
  beside the original rather than over it.
- **Three refinement levels** — Verbatim, Clean up, Organize — with Clean up as
  the default and Verbatim always available.
- **Refinement must not invent.** Names, numbers, dates, monetary amounts,
  identifiers and quoted language survive verbatim; unclear passages are marked,
  not guessed; the speaker's uncertainty is preserved.
- **Refinement failure falls back to the original transcript** and never loses
  it.
- **The recording state is never ambiguous**, is never communicated by colour
  alone, and is announced to assistive technology.
- **Microphone access ends the moment recording stops or is cancelled.**
- **Raw audio is not retained by default.**
- **Nothing is submitted without explicit confirmation** (see §6.3 — in Chorus
  this rule is load-bearing for safety, not politeness).
- The state machine of source §6.3, the failure-mode list of source §13, and the
  accessibility requirements of source §15, all of which survive translation
  essentially intact (§9, §10).

---

## 3. Translation rules — where Chorus differs from the source's assumptions

| Source assumes | Chorus is | Consequence |
|---|---|---|
| Multi-tenant web app | Single-user desktop app | No tenant identifier in the data model. |
| A browser matrix to test | One Chromium, Windows-only (v1 boundary) | Source §21's "tested on every supported browser and device category" collapses to one target; the **microphone device** matrix replaces it and is the real variable. |
| Destination is a form field | Destination is a **PTY running an agent** | §6. The largest translation. |
| Submitting sends a message | Submitting **starts an autonomous agent that executes code** | §6.3. Auto-send is a safety rule, not a preference. |
| Audio may go to a vendor by default | Local-first (`Plan.md` principle 1) | §5. A fully offline path is guaranteed, not optional. |
| Server-side keys | BYOK, keys never leave main (D33) | §4.2. Cloud STT and LLM refinement both run in main. |
| Product analytics pipeline | No telemetry egress, ever | §8.3. Source §18's metrics are permitted **only** as local counters. |
| "Avoid a system-wide shortcut" (source §6.2) | A global hotkey **is the feature** | §7.1. Deliberate, narrow override — recorded rather than silently taken. |
| Meetings, multiple speakers, voice identity | Solo developer dictating prompts | Stays a non-goal, as it already is in source §3. |

---

## 4. The architecture the constraints force

### 4.1 Capture is in the renderer; transcription is in main. This is not a choice.

`getUserMedia` is a Chromium API. **The main process has no microphone access
at all** — there is no Node or Electron API that opens an audio device. So the
capture half of this feature can only live in the renderer.

Meanwhile CLAUDE.md forbids the renderer from spawning processes, D33 forbids
credentials from reaching the renderer, and the CSP (§4.2) forbids the renderer
from reaching the network. So the transcription half can only live in main.

The resulting pipeline is fixed:

```
renderer                      │ main
──────────────────────────────┼──────────────────────────────────────
getUserMedia → AudioWorklet   │
  → 16 kHz mono PCM chunks    │
  → IPC ──────────────────────┼→ VoiceService
                              │    ├─ local: whisper.cpp child process
                              │    └─ cloud: fetch + vault-decrypted key
                              │  → transcript
  ←───────────────────────────┼──  IPC
composer / target pane        │
```

**⚠ This makes voice the first feature in which the renderer is a bulk binary
producer, and D14 applies in a direction it has never been tested in.** Every
prior renderer → main payload has been a small plain object. Audio is chunked
`Float32Array`/`Int16Array` at 16 kHz. Two obligations follow, and both belong in
the kickoff rather than being discovered mid-task:

- **Zod cannot validate a megabyte of samples per chunk** the way D1 validates
  the rest of the bridge. The frame envelope (session id, sequence number,
  sample rate, chunk length) is validated; the sample payload is **length-checked
  and type-checked, not element-validated**. Say so explicitly in the contract so
  nobody reads it as a D1 exemption.
- **Backpressure is a real failure mode.** A stalled transcriber must drop or
  bound the queue rather than grow it without limit, and the recording UI must
  reflect that it has stopped keeping up.

### 4.2 The shipped CSP breaks two of the three obvious implementations

Verified 2026-08-12, `src/renderer/index.html:7`:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self' data:
```

- **No `connect-src` directive**, so it inherits `default-src 'self'` — **the
  renderer cannot call OpenAI, Deepgram, or any STT vendor directly.** Cloud
  transcription must be a main-process `fetch`. This constraint and D33 happen
  to demand the same thing, which is why it is cheap to obey.
- **`script-src 'self'` carries no `wasm-unsafe-eval`**, so **a whisper WASM
  build running in the renderer would throw**, exactly as Zod-in-preload did
  under D1. whisper.cpp therefore runs in **main**, as a native addon or a child
  process — which is also where CLAUDE.md wants process ownership to be.
- **No `media-src`**, so if any future surface plays recorded audio back through
  an `<audio>` element from a `blob:` URL, that directive must be added
  deliberately. Nothing in the v1 scope plays audio back; recorded per §8.2, so
  the omission is not mistaken for an oversight later.

**The lesson is D1's, on its third registry: a CSP that is right for the app is
routinely wrong for the next library, and the answer is to move the work to
main rather than to widen the policy.**

### 4.3 There is no microphone policy at all, and installing one takes two handlers

`grep -rn "setPermissionRequestHandler\|setPermissionCheckHandler" src/main/`
returns **nothing** (verified 2026-08-12). Nothing asks for the microphone
today, so nothing is granted — but **the app has no stated position on what it
would do if something asked**, and the first `getUserMedia` call in the renderer
resolves against Electron's built-in default rather than against a Chorus rule.

**⚠ What that default actually is was NOT verified by this pass and must not be
assumed.** Electron 43.1.1's own shipped typings (`node_modules/electron/electron.d.ts:13239`)
describe how to *set* the handlers and say nothing about the behavior when none
is set. The folk answer is "it approves"; that is training-data memory, it is
exactly what CLAUDE.md's D4 rule exists to stop, and it is on the §12 list to be
measured. **The requirement does not depend on the answer** — a security
boundary with an unverified default is a boundary to close either way.

**Phase 5 installs the policy before it writes its first capture line**, allowing
`media` only for the app's own origin and denying every other permission
outright.

**⚠ AND IT TAKES BOTH HANDLERS, WHICH IS THE PART MOST LIKELY TO BE MISSED.**
Verified from the same typings, `setPermissionRequestHandler`'s own
documentation: *"you must also implement `setPermissionCheckHandler` to get
complete permission handling. Most web APIs do a permission check and then make
a permission request if the check is denied."* Installing only the request
handler produces a policy with a hole in it that testing the happy path will not
reveal. Both handler signatures accept `'media'`.

This is a security-surface change on a hardened boundary and is one of the
reasons the phase carries a **[CR]** marker (§11).

---

## 5. The offline floor, and what the two engines cost

`Plan.md` principle 1 is local-first, and the stack table already commits to
whisper.cpp local as the **default** with a cloud toggle. This plan makes the
guarantee explicit and names its edges:

- **Verbatim + local whisper is a fully offline path: no network, no key, no
  vendor, no LLM.** That combination is the privacy floor and must remain
  reachable in one setting change. A user who never leaves it has a working
  feature.
- **Clean up and Organize require an LLM**, which means a BYOK API call on the
  user's own key. The moment refinement is enabled, transcript text leaves the
  machine. **That is a disclosure obligation** (source §12) and it must be stated
  where the mode is chosen, not buried in settings.
- **Cloud STT sends the audio itself**, which is a strictly larger disclosure
  than refinement. Off by default.

**Refinement reuses `apiSession.ts` (`createApiSession`) — the same BYOK path
the council runs on — rather than growing a second provider client**, and its
spend must ride the existing `usage_records` telemetry so voice does not become
an unmetered hole in the per-credential cost rollups Phase 7 reports. **⚠ Note
the known defect it inherits:** the council's own cost capture under-reports its
final turn because the key-usage read fires before the vendor settles it. Voice
refinement is a single short turn and will hit that same race proportionally
harder.

---

## 6. The destination is a PTY, and it changes the review model

This is the deepest translation and the one most likely to be got wrong by a
kickoff reading only the source document.

### 6.1 Chorus cannot retract what it has written

Text reaches an agent through `session:write` (`IpcChannel.SessionWrite`,
verified 2026-08-12). Once written, those bytes belong to the child process's
line editor. **Chorus cannot un-write them, re-render them, or diff them.**

Therefore every feature in source §11 that implies *replacing text already
delivered* — switch between Original / Cleaned / Organized, restore the
original, re-run refinement in another mode, see which version was AI-refined —
**is only possible before the write**, in a surface Chorus owns.

### 6.2 Two shapes, and the mock only draws one

- **Direct-to-prompt (what the mock draws).** Release the key; the transcript
  lands at the agent's `❯` prompt; the agent's own line editor is the review
  surface; the user presses Enter when satisfied. **This is sufficient for
  Verbatim and adequate for Clean up**, and it is the cheapest correct thing.
- **Composer-first (what version-switching requires).** The transcript lands in
  a Chorus-owned input with the mode controls, the original/refined toggle, and
  an explicit Insert. Only then does `session:write` fire.

**The mock — which D73 makes the authority — draws the first and not the
second.** A composer is therefore *beyond* the authority rather than a
reading of it, and D137 records that admitting one is a deliberate extension,
staged after the direct path works. **D76 governs the order: build the direct
path, then build the composer when the modes it compares actually exist.**

### 6.3 Auto-send is a safety rule here, not a preference

Source §11 says voice should not automatically submit a form. The Chorus
analogue is worse: pressing Enter in an agent pane **starts an autonomous
process that edits files and runs commands** against a real repository, on a
transcript that may have been misheard.

`Plan.md` §9 already says **no auto-Enter by default**, with auto-send as a
setting. This plan keeps that and hardens the reasoning: the default is not a
UX preference to be tuned later, it is the thing standing between a
mis-transcribed sentence and an agent acting on it. Any "Stop and send" opt-in
must state what it does in those terms. Whether it is refused outright on
agent-locked sessions is a kickoff question (§11).

---

## 7. Controls, targeting, and the two activation models

### 7.1 Push-to-talk stays global, and that is a deliberate override

Source §6.2 recommends avoiding a system-wide shortcut unless explicitly
enabled. **Chorus overrides this narrowly**, because the entire value of PTT
here is dictating at a pane while looking at an IDE that owns the foreground —
a shortcut that only works when Chorus is focused solves a problem nobody has.
`Plan.md`'s stack table already commits to `uiohook-napi` for exactly this
reason: Electron's own `globalShortcut` fires on press and cannot express
*hold-to-talk*.

The spirit of the source's caution is honored instead by: the hotkey is
**configurable**, it is **disable-able**, it is **shown in settings**, and the
recording indicator is global and unmissable while it is held.

### 7.2 Click-to-talk is admitted as a first-class second mode

The source asks for both; the mock and `Plan.md` describe only hold-to-talk.
Both ship (D136). Click-to-toggle is the accessible path — source §15 requires
the feature be usable without holding a key, and a sustained hold is exactly the
interaction a motor-impaired user cannot perform. **Treating click-to-talk as
the accessibility path rather than as a convenience is what makes it
non-negotiable.** Optional stop-after-silence applies to the toggle mode.

Repeated activations must not open overlapping capture sessions (source §6.2) —
the state machine in §9 makes that structural rather than defensive.

### 7.3 The dictation target: the mock wins, and `Plan.md` is corrected

`Plan.md` §9 says the transcript is inserted into **"the focused pane's
stdin."** The Phase 5 feature line, the roadmap entry and the mock all describe
an explicit **dictation target with a ring**, and the mock adds *"hold tab while
dictating to cycle targets."* These are not the same rule.

**Resolved by D73 — the mock is the authority.** There is an explicit dictation
target; it **defaults** to the focused pane; it is shown by a visible ring
**before** the user speaks (`Plan.md` §7 already lists this under
glanceability); and it is cycled with Tab while the key is held. `Plan.md` §9 is
corrected rather than left to contradict its own phase line.

> **Corrected by D166 (2026-08-19):** the ring is painted **only while a capture
> is running**, not before. Once the F87 fix made the target always resolve, the
> idle ring became a permanent red outline around one pane and was reported as
> a defect. The target is still named before speech by the overlay's
> *"dictating into …"* line; the rest of this section stands.

**⚠ The target must survive the thing that will break it:** the pane the ring
points at can be closed, killed, or exited while transcription is still running
(source §13's "destination field removed while processing"). The transcript must
survive the loss of its target and be recoverable — never silently discarded,
and never written to whichever pane inherited focus.

---

## 8. Persistence, settings, and metrics

### 8.1 What is stored

Source §17 proposes a full session record. Translated: **one row per voice
session**, holding session id, target session id, start/stop timestamps,
duration, engine used (local/cloud) and language, transcription status, the
**original transcript**, refined versions **each with its mode**, post-refinement
user edits, an error *category* (never transcript content), and retention state.
Tenant identity drops out; device identifiers are held only as far as "which
microphone", never as a stable hardware id.

**Original and refined transcripts are stored in separate columns or rows. One
never overwrites the other** — the source's clearest rule, and the one the data
model exists to enforce.

**⚠ Two schema traps are already known and must be handled at kickoff, not
found:**
- **`MIGRATIONS.length` was 18 at `e1afe89`, so the next free version *looks
  like* v19 — and per G6 that number must be recomputed at the moment of
  writing, against `main`, and stopped on divergence.** The roadmap records this
  going wrong twice on migration versions already, once shipping a silent
  runtime failure.
- **Any enforced FK to `projects(id)` or `sessions(id)` is a change to
  `deleteProject`.** Phase 6 discovered this the expensive way: a new table's
  `REFERENCES projects(id)` would have thrown `SQLITE_CONSTRAINT_FOREIGNKEY`
  through the whole purge. If voice sessions reference a project or a session,
  the purge grows a step **in the same commit as the table**.

### 8.2 Retention

Raw audio is **not retained by default** and is deleted as soon as
transcription completes or is cancelled. Transcripts are held under at least the
rules that apply to typed input. **Transcript text must never reach ordinary
application logs** — the same discipline as G4's secret grep, applied to a new
category of sensitive content, and worth its own grep at kickoff.

### 8.3 Metrics are local-only

Source §18's metric list is useful and is adopted **as local counters only**.
Chorus has no telemetry egress and Phase 5 does not introduce one. Recording
content is never used for analytics.

### 8.4 Settings

Source §16's list translates directly and becomes the first real occupant of the
**"Voice & dictation"** settings section that the mock draws and
`SettingsView.vue` currently withholds. **That withholding is the precedent to
follow, not to overturn:** the nav entry appears when the settings behind it
exist, exactly as "Agent lock" earned its entry. Settings follow the
`agent-lock:*` channel pattern — a dedicated channel group, not a generic
key/value bag.

---

## 9. State machine

Source §6.3 is adopted intact, with Chorus's names:

`ready → requesting-permission → listening → finalizing → refining →
ready-for-review → inserted`

with `cancelled` and `failed(recoverable)` reachable from every state after
`ready`, and `paused` only if pausing ships. Two Chorus-specific rules:

- **`listening` implies a live dictation target.** Losing the target does not
  cancel the capture; it moves the result to recovery (§7.3).
- **The transition into `inserted` is the irreversible one** (§6.1). Everything
  the user may want to undo must happen before it.

---

## 10. Failure modes that are Chorus-specific

Source §13 is adopted wholesale. These are the ones the source could not know
about, and they are the ones most likely to be missed:

- **The target pane dies mid-transcription** — killed, exited, closed, or its
  project archived (Phase 3h makes archived projects refuse launches).
- **The app quits or the window closes while recording.** Source §6.1's "warn
  before navigating away" becomes a quit/close guard.
- **whisper.cpp's model is missing on first use.** `Plan.md` §9 commits to
  downloading `small.en` to `%APPDATA%` on first use — so the first dictation a
  user ever attempts is also a download that can fail, be slow, or be offline.
  **The first-run path is the one most likely to be tested least.**
- **The native hotkey hook fails to load.** `uiohook-napi` is a native module;
  if it does not load, PTT is unavailable and click-to-talk must still work.
- **Another application holds the microphone**, which on Windows is common and
  silent.
- **The dev machine's own hostile conditions** already recorded in this
  program: OS toasts are disabled outright, so **no voice error may rely on a
  toast to be seen** — the in-app surface is the only one that reliably exists.

---

## 11. Open questions for kickoff, and the CR gate

**Phase 5 meets the Council Review trigger criteria on two independent counts** —
a new security-sensitive surface (microphone capture, an explicit Electron
permission handler, a new audio egress path) and a hard-to-reverse shape (the
renderer → main bulk binary channel). **It carries a `[CR]` marker and G5
applies.**

Questions to settle at kickoff or put to the council:

1. **Direct-to-prompt only for v1, or composer-first from the start?** (§6.2.)
   The mock says direct; the mode-comparison requirements need a composer.
2. **Is "Stop and send" refused outright on agent-locked sessions**, or merely
   defaulted off everywhere? (§6.3.)
3. **Streaming interim text or finalize-on-release?** The mock draws a
   `transcribing…` pill, which reads as finalize-on-release; the source wants
   interim text within 1–2 s. Local whisper makes streaming meaningfully harder
   than cloud does.
4. **Where does the recovered transcript go when its target dies?** (§7.3.)
5. **Does the audio frame channel get its own preload surface**, or ride the
   existing one? (§4.1 — this is the D14/D1 boundary question.)
6. **Does a voice session row reference `sessions(id)` at all**, given §8.1's FK
   trap and that a transcript outliving its pane is a feature, not a leak?

## 12. D4 verification list — re-check ALL of this at execution time

Nothing below was assumed from training memory; nothing below should be trusted
by the kickoff either. Verified 2026-08-12 unless marked.

| Fact | Verified how | Status |
|---|---|---|
| No voice code, deps, or `getUserMedia` in the tree | grep across `src/`, `package.json` | **VERIFIED** |
| Neither permission handler is installed in main | grep `src/main/` | **VERIFIED** |
| **Both** handlers are required for complete coverage | Electron 43.1.1 typings, `electron.d.ts:13239` | **VERIFIED (from the tool's own docs)** |
| **What Electron 43 does when NO handler is set** | — | **NOT VERIFIED — measure it, do not assume.** The typings do not say. Assuming "it approves" is the D4 failure mode. |
| CSP text at `src/renderer/index.html:7` | read | **VERIFIED** |
| `IpcChannel` has 86 members | counted the object at `src/shared/ipc.ts:14–528` | **VERIFIED** — recount per G6 |
| `MIGRATIONS.length` = 18 | parsed `src/main/services/storage.ts` | **VERIFIED** — recount per G6 |
| `session:write` is the injection channel | `src/shared/ipc.ts:23` | **VERIFIED** |
| `apiSession.ts` / `createApiSession` exists as the BYOK path | grep `src/main/services/` | **VERIFIED** |
| `SettingsView.vue` withholds the Voice nav entry | read, lines 14–21 and 59–64 | **VERIFIED** |
| **`uiohook-napi` ships usable Windows prebuilds for this Electron ABI** | — | **NOT VERIFIED — do this first.** The program has been burned both ways: node-pty's prebuilds needed no rebuild, better-sqlite3 needed a `/Od` source build. Assume neither. |
| **whisper.cpp's Windows distribution shape** (native addon vs bundled exe vs build-from-source) and `small.en` model size/URL | — | **NOT VERIFIED.** Determines whether the installer grows and whether first-run downloads are avoidable. |
| Cloud STT vendor API shapes (OpenAI, Deepgram) | — | **NOT VERIFIED.** CLAUDE.md's rule applies: check the vendor's own docs at execution time. |
| Chromium's `AudioWorklet` behavior under this Electron version at 16 kHz mono | — | **NOT VERIFIED.** Resampling from the device rate is the likely real work. |
