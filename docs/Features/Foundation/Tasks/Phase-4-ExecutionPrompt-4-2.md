# Phase 4 — Execution Prompt (Task 4-2)

_Generated 2026-08-13 against `main` at `253a495`. Paste the body below into a **fresh** conversation._

> **⚠ THIS IS THE PHASE'S HEADLINE SURFACE AND THE FIRST THING TO RENDER TASK 4-1's `reason`.** Task 4-1 put the field on the wire and deliberately drew nothing. This task draws it.
>
> **⚠ IT ALSO MOVES `IpcChannel` 86 → 88, THE COUNTER F54 RECORDS COLLIDING FOUR TIMES.** G6 applies in full: re-read the figure from the merged tree, and **grep for the assertions rather than seeking to a remembered line — they moved once already during Task 4-1.**

---

## PROMPT BODY — copy everything below this line

---

You are the **Coordinator** for Chorus **Phase 4 — Notifications, Task 4-2: The Attention Inbox**.

Repository root: `C:\Projects\ContactEstablished\Chorus`
Expected branch: **`main`** — confirm with `git branch --show-current`. **Do not switch or create a branch without instruction.**
Expected HEAD at start: **`253a495`** ("Record what the first notifications task taught us"). If HEAD differs, **re-verify every line number and count below before relying on it.**

## 1. Goal

Build an ordered, cross-project queue of every session that currently needs a human — agent, project, session label, reason, and how long it has been waiting — navigable with `j`/`k`, opened and closed with a key, where `Enter` **focuses the real pane**.

**Oldest first**, because the whole job of this surface is to surface the longest-ignored thing in the app.

A pure core in main, two IPC channels, one Vue overlay. **No migration. No new dependency. No change to the hook spine.**

## 2. Ground yourself first — read before editing

**Documents:**

- `CLAUDE.md` — locked architecture. Sessions live in main; all IPC Zod-validated **in main only**; no new dependencies without asking.
- `docs/Features/Foundation/Tasks/Task-4-2.md` — **governs scope.**
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-4-2.md` — **governs exact contents.** Where the two disagree on *scope* the task doc wins; on *contents* the spec wins.
- `docs/Features/Foundation/Tasks/Phase-4-Overview.md` — **§3 (what the Inbox shows and what it does NOT — read this before writing a single line of template)**, §5 (constraints), §7 (the dirty-tree rule).
- `docs/Features/Foundation/Tasks/Task-4-1.md` — the `reason` field this surface exists to display, and the measurement that moved `Notification` into `permission`.
- `docs/design/v2/Chorus Attention Inbox.dc.html` — the mock, and **the authority under D73 for layout, wording and keys.** It is **not** the authority for the preview panel; see §8.
- `docs/Features/Foundation/roadmap.md` — §5 (ground facts, most recent block first) and findings **F47**, **F54**, **F56**, **F58**, **F59**, **F68**, **F69**; §6 decisions **D145**, **D146**, **D130**, **D83**, **D73**, **D14**, gates **G1–G4**, **G6**.

**Code anchors — inspect each and report any that moved. All re-measured at `253a495`:**

| Anchor | What is there |
|---|---|
| `src/main/services/attentionRollup.ts:30` | `export interface RollupSession` — **structurally typed, 4 fields; widening the accessor needs no edit here** |
| `src/main/services/attentionRollup.ts:135` | `if (session.status === 'running') {` — **the exclusion this task copies** |
| `src/main/services/attentionRollup.ts:127` | *"collapsing them would force one caller to discard half the answer"* — why the rail and the Inbox stay separate |
| `src/main/services/storage.ts:1629` | `getAllSessionStates()` — 4 fields today; gains `agent`, `name`, `title` |
| `src/main/services/storage.ts:1049` | `listProjects(): ProjectRecord[]` |
| `src/main/db/schema.ts:68` | `export const sessions = sqliteTable('sessions', {` — `agent` at **`:73`**, `title` at **`:79`**, `name` at **`:86`**. **All three columns already exist: no migration.** |
| `src/main/ipc.ts:4042` | `function computeProjectAttention(): ProjectAttentionList {` — **the precedent to model on** |
| `src/main/ipc.ts:4063` | `let lastAttentionJson = '[]'` — the push-only-when-changed guard |
| `src/main/ipc.ts:4091` | `function schedulePushProjectAttention(): void {` — **the `setImmediate` deferral, and its comment above is load-bearing (see §6)** |
| `src/main/ipc.ts:4009` | `schedulePushProjectAttention()` inside `agentEvents.onActivity` (the callback opens at `:4000`) |
| `src/main/ipc.ts:4033` | `schedulePushProjectAttention()` inside `sessions.onExit` (opens at `:4029`) |
| `src/main/ipc.ts:4143` | `ipcMain.handle(IpcChannel.ProjectAttentionList, …)` — the cold-read precedent |
| `src/shared/ipc.ts:54` | `ProjectAttentionList: 'project:attention-list',` — **put the two new channel entries beside this so the attention family stays contiguous** |
| `src/shared/ipc.ts:615` | `export const agentKindSchema = z.enum(['claude', 'codex', 'kimi', 'opencode'])` — **use this, not `z.string()`** |
| `src/shared/ipc.ts:1847` | `export const needsYouReasonSchema` — Task 4-1's field |
| `src/shared/ipc.ts:1864` | `export const stateSinceSchema` — and the comment above it on why an instant beats an age |
| `src/shared/ipc.ts:1897` | `export const sessionActivityListResponseSchema` — **put the new schemas after this block** |
| `src/preload/index.ts:529` | `onProjectAttention` · `getProjectAttention` at **`:537`** — **copy this pair exactly** |
| `src/main/services/attentionCore.ts:177` | `if (i.overlayOpen) return 'overhead'` — **why `anyOverlayOpen` is not optional** |
| `src/main/services/notifications.ts:11` | `const AGENT_LABELS: Record<AgentKind, string>` — the precedent for exhaustive agent maps |
| `src/renderer/src/App.vue:430` | `const anyOverlayOpen = computed(` — **the edit that gets forgotten** |
| `src/renderer/src/App.vue:569` | `overlayOpen: anyOverlayOpen.value` — fed to main's attention tracker |
| `src/renderer/src/App.vue:650` | `focusSession: (id) => viewStore.setFocused(id),` — the call `Enter` must reach |
| `src/renderer/src/components/CommandPalette.vue` | **218 lines — the overlay precedent.** `Escape` at `:52`, `ArrowDown` at `:56`, `role="dialog"` at `:94`, `aria-modal` at `:95` |

> **⚠ EVERY LINE NUMBER IN `Task-4-2.md`'s AND `ImplementationSpec-4-2.md`'s OWN TABLES WAS MEASURED AT `00f0f0d` AND SEVERAL ARE NOW STALE.** The table above supersedes them. The notable drifts: `agentEvents.ts` `snapshot()` **`:311` → `:353`**; `computeProjectAttention` **`:4041` → `:4042`**; `lastAttentionJson` **`:4060` → `:4063`**; `attentionRollup.ts`'s running guard **`:121` → `:135`**; `stateSinceSchema` **`:1837` → `:1864`**; the schema insertion point **`:1878` → `:1897`**; `CommandPalette.vue`'s dialog attributes **`:90/:94` → `:94/:95`**. `storage.ts:1629`/`:1049`, all three `App.vue` anchors, `schema.ts`, `attentionCore.ts:177` and `notifications.ts:11` are **unchanged**.

**Git checks to run before editing:**

```bash
git branch --show-current      # expect: main
git log -1 --format="%h %s"    # expect: 253a495 …
git status --porcelain
```

**⚠ MEASURE YOUR OWN TEST BASELINE BEFORE EDITING.** The figure below was measured at `253a495`; run `npm test` yourself first and compare against **your** number.

## 3. Ground facts, verified at `253a495`

| Fact | Value | How to check |
|---|---|---|
| `IpcChannel` | **86** → must become **88** | asserted twice in `src/shared/ipc.test.ts` at **3442** and **3820** — ⚠ **grep, do not seek** |
| `MIGRATIONS.length` | **19** — must still read 19 when you finish | ⚠ **PARSE the array, never grep it** — see the warning below |
| `sqliteTable(` | **18** | in `src/main/db/schema.ts` only |
| vitest | **2010 passed / 2010, across 59 files** | `npm test`, exit 0 |
| typecheck | **0 errors** (node + web) | `npm run typecheck`, exit 0 |
| secret-grep | clean, 6 patterns | `npm run grep:secrets` |
| Highest decision | **D146** | roadmap §6 |
| Highest finding | **F69** | roadmap §5 |

> **⚠ THE MIGRATION COUNT MUST BE PARSED, NEVER GREPPED — A NAIVE COUNT RETURNS 171.** The comments between the array elements contain backticks (e.g. `` `title: text('title')` `` at `storage.ts:196`), so any character-scanner treats a comment as a template literal and every count after it is garbage. Use the TypeScript compiler's AST. **This task takes no migration, so the number must still read 19 when you finish.**

> **⚠ THE TEST BASELINE IN `Task-4-2.md` SAYS "1977 / 58" AND IS STALE.** Task 4-1 added 33 tests and one file. **Your floor is 2010 / 59.**

## 4. Pre-existing changes — DO NOT REVERT, STAGE, OR COMMIT THESE

`git status --porcelain` at generation time:

```
?? CLAUDE-PROJECT-MARKER.txt
```

**That file is a scratch marker (`claude-can-write-here`), not project content. Leave it exactly where it is.** Stage by explicit path; never `git add -A`, never `git add .`. This list is a snapshot — read `git status` yourself rather than trusting it.

## 5. Implementation scope — files owned, nothing else

| File | Change |
|---|---|
| `src/main/services/attentionInboxCore.ts` | **Create.** Pure: session rows + activity records + project names → the ordered list. No `fs`, no clock, no Electron. |
| `src/main/services/attentionInboxCore.test.ts` | **Create.** |
| `src/main/services/storage.ts` | **Edit.** Widen `getAllSessionStates()` with `agent`, `name`, `title`. **No migration.** |
| `src/shared/ipc.ts` | **Edit.** Two channels + their schemas. **86 → 88.** |
| `src/shared/ipc.test.ts` | **Edit.** Both `toHaveLength` assertions → **88**; schema shape tests. |
| `src/main/ipc.ts` | **Edit.** The compute, the handler, and the push. |
| `src/preload/index.ts` | **Edit.** The invoke + event subscription pair. **No Zod in preload.** |
| `src/renderer/src/components/AttentionInbox.vue` | **Create.** |
| `src/renderer/src/App.vue` | **Edit.** Mount it, register its key, **and add it to `anyOverlayOpen`**. |

**Nothing else.** No migration, no adapter file, **no `agentEvents.ts` or `agentEventsCore.ts` change**, no npm dependency.

> **⚠ `ImplementationSpec-4-2.md` §4 SAYS "Preload: expose the invoke and the event subscription" BUT `Task-4-2.md`'s SCOPE TABLE OMITS `src/preload/index.ts`.** The spec is right and the omission is a slip: the renderer cannot reach a channel that the contextBridge does not expose. **`src/preload/index.ts` IS in scope**, and it is listed above. Report this in your final summary so the task doc gets corrected.

### The reason vocabulary — as shipped by Task 4-1

| `reason` | Events behind it | Row phrase (spec §5.1) |
|---|---|---|
| `permission` | `PermissionRequest`, `Elicitation`, **`Notification`** | `is asking permission` |
| `stopped` | `Stop`, `StopFailure` | `finished and is waiting` |
| `notice` | `TeammateIdle` | `has something to tell you` |

> **⚠ `notice` HAS EXACTLY ONE MEMBER, AND D146 FLAGS WHAT THAT MEANS FOR YOU: you are building a case you will almost certainly never see on screen.** Build it anyway — it is on the wire and a missing branch is a blank cell — but **do not spend runtime-gate time trying to manufacture a `TeammateIdle`**, and do not report its absence as a failure.

## 6. ⚠ THE THINGS THIS TASK GETS QUIETLY WRONG

**1. The exit-path race — do not re-derive it, copy it and cite it.** `ipc.ts:4091`'s deferral comment was **found by running the app, not by reading it**: `SessionManager`'s exit fan-out is a `Set` whose order its own source says is *"not contractual"*, and the listener that persists `status='exited'` is registered **after** `registerIpc`. A synchronous recompute therefore reads a table that has not caught up, produces a list that still contains the dead session, **matches the equality guard, and the correction never arrives.** The Inbox has the identical hazard and needs the identical `setImmediate` deferral.

**2. Three exclusions, each one line, each needing a test rather than a comment.**
- **Only `running` sessions.** An exited session's amber is stale in-memory state for an agent that is already gone. **F59 sharpens this for the Inbox**: a session healed to `exited` shows an empty pane beside a complete mirror on disk, so listing it as "waiting" sends the user to a pane that cannot answer.
- **No activity record at all = absent.** `codex`, `kimi` and `opencode` carry `hooks: null` and never report. **A three-state agent is not a calm one — it is an unknown one.** They must not appear as permanently-calm rows, must not carry a null reason, and **must not be counted in the "N waiting" tally.** The natural `sessions.map(...)` includes them by default, which is exactly why this is asserted.
- **`needs-you` with a null `reason` = skip, never guess.** Task 4-1 makes `reason` non-null for every `needs-you`; if one arrives null that is an upstream bug, and inventing `'stopped'` for it is the D83 failure.

**3. Ordering must be total and stable.** Ascending by `since`, ties broken by `sessionId`. An unstable sort reshuffles the list under the user's `j`/`k` cursor — worse than a wrong order, because it moves the target mid-keystroke.

**4. The age ticks off ONE clock.** `since` is an absolute instant. Render `now - since` against **one** `ref` driven by **one** interval for the whole list — never one timer per row — and **stop the interval when the Inbox closes.**

**5. Clamp the selection when the list shrinks.** A push can remove the selected row while the user is on it; an unclamped index renders blank and swallows the next `Enter`.

**6. `anyOverlayOpen` (`App.vue:430`) is not optional.** It feeds `overlayOpen` at `:569`, and `attentionCore.ts:177` returns `'overhead'` when it is true. **Miss it and every second spent reading the Inbox is billed as active work on whichever session held DOM focus** — telemetry that is confidently wrong.

**7. The open key rides the capture phase.** A focused xterm consumes keys before they bubble; follow the Ctrl+K precedent's reasoning at `App.vue:435` and `preventDefault` to steal the combination. **Pick one that is not already meaningful inside `claude` or `codex`, and say in the commit which you chose and why.**

## 7. Resolved decisions — quote them in code comments where they bite

- **D145 (RESOLVED 2026-08-13)** — the `agent_events` bus is **not** built. No table, no migration. The Inbox reads the **current** state, exactly like the rail.
- **D146 (RESOLVED 2026-08-13)** — the reason vocabulary as shipped, including `Notification` → `permission` and the constraints in §5 above.
- **D130** — the hook listener's read surface does not widen without an explicit decision with a security argument. **Every field the mock's preview panel draws is one D130 refuses to read.**
- **D83** — *"omit it, or give it a source — never fake it."*
- **D73** — the mock is the authority for layout, wording and keys.
- **D14** — IPC payloads crossing the bridge must be **plain objects**; Pinia/reactive values fail structured clone at runtime with no compile-time signal. Snapshot before sending.
- **F47** — session rows exist in the dev database whose `project_id` names no project, **with an enforced foreign key that should have made it impossible.** A core that indexes blindly throws there and blanks the whole Inbox for one bad row.

## 8. Strict non-goals

- **⚠ NO PREVIEW TEXT.** The mock draws the agent's message, the tool call and the numbered prompt options. **Every one is a hook-body field D130 refuses to read.** A preview could be built from the pane's own post-scrub ring buffer with no D130 widening — **and it is still omitted, because F58 measured those buffers to be TUI repaint streams, not transcripts** (44,958 non-blank lines, 14 unique, 3,211× duplication). **AN IMPLEMENTER WHO FINDS A WAY TO SHOW THE PROMPT TEXT HAS NOT FOUND A BONUS** — they have found the preview spike a later phase owes a measurement to. **Record it as a finding; do not ship it.**
- **No inline answering, no `session:write`.** `Enter` focuses the pane; the user answers where the prompt actually is.
- **No notification centre** — that is Task 4-3. The Inbox shows what needs you **now**; the centre shows what **fired**.
- **No policy.** The Inbox lists everything waiting, unfiltered.
- **No persistence, no table, no migration.** `MIGRATIONS.length` stays **19**; `sqliteTable(` stays **18**.
- **No change to `agentEvents.ts` or `agentEventsCore.ts`.** Task 4-1 finished with them; this task is a **consumer**. Both must be byte-identical.
- **No change to `attentionRollup.ts`** — including not "tidying" it to acknowledge the three new fields on the widened accessor. `RollupSession` is structurally typed and needs no edit.
- **No tray, no toast, no OS surface.** Task 4-4.
- **No new dependency** for the list or the keyboard handling. The palette does both in 218 lines of plain Vue.
- **Do not revert, stage, or commit the §4 file.**

## 9. Required workflow

There is **no workflow kit** in this repo (no `.codex/workflows/subagents/`), so the coordinator pattern is followed manually:

1. **Ground** — read §2's documents and inspect every code anchor **before editing**. Report any line number that moved.
2. **Spec review** — re-read `ImplementationSpec-4-2.md` and confirm your plan matches. Task doc wins on scope; spec wins on contents.
3. **⚠ RE-READ THE CHANNEL COUNTER FIRST (G6/F54).** `grep -n "toHaveLength(" src/shared/ipc.test.ts`. **If it is not 86, STOP** — a sibling branch has claimed channels and F54's fifth collision is in progress. Reconcile before adding.
4. **Measure your own test baseline BEFORE editing.**
5. **Implement.**
6. **Code-quality review** — review your own diff against `Task-4-2.md`'s Review Checklist, item by item. Fix what fails.
7. **Verification** — run everything in §10, in full. **Run, don't just compile (G2).**
8. **One intentional narrated commit (G3)** — a concise title, then a description a non-technical reader understands first and a technical reader second. Stage by explicit path. **Code only.**
9. **Do not push and do not open a PR** unless explicitly asked.

## 10. Verification commands

Run from the repo root.

### Build gates

```bash
npm run typecheck      # G1 — expect 0 errors, node + web
npm test               # compare against YOUR measured baseline, floor 2010 / 59
npm run grep:secrets   # G4 — expect clean
```

### Counters

```bash
grep -n "toHaveLength(88)" src/shared/ipc.test.ts   # expect exactly two hits, BOTH updated
grep -c "sqliteTable(" src/main/db/schema.ts        # expect 18
```

`MIGRATIONS.length` must still be **19** — **parse it, do not grep it** (§3).

### Structural proofs — prove the non-goals, do not assert them

```bash
git diff --name-only                                    # no migration, no adapter
git diff --stat src/main/services/agentEvents.ts        # EMPTY — byte-identical
git diff --stat src/main/services/agentEventsCore.ts    # EMPTY
git diff --stat src/main/services/attentionRollup.ts    # EMPTY
```

Grep your own diff for any read of a hook body, any ring-buffer read, and any `session:write` (D130 / the preview non-goal).

### Runtime gates (G2 — measure the app, do not reason about it)

**⚠ AGAINST A COPY OF THE DEV DB IN A THROWAWAY `--user-data-dir`. THE INSTALLED APP'S (`%APPDATA%\chorus-app`) MUST NEVER BE OPENED.** Copy `chorus.db`, `chorus.db-wal`, `chorus.db-shm` **and `Local State`** (the OSCrypt key — without it every pre-existing credential blob is undecryptable) from `%APPDATA%\chorus` into a temp dir, and launch with `--user-data-dir=<that dir>`.

`_verify/4-1/launch-4-1.ps1` is a working launcher for exactly this (it rebuilds `ComSpec` and `PATH` from the registry first, then invokes `electron-vite` directly so npm does not eat the `--` passthrough). `_verify/4-1/cdp41.js` is a dependency-free CDP driver (`eval` / `shot` / `typefile` / `enter`) against `--remote-debugging-port=9222`. **Copy both into `_verify/4-2/` rather than editing them in place.**

**⚠ THE BRIDGE IS FROZEN — DO NOT PATCH IT.** To capture payloads, *subscribe* through the exposed API instead: `window.chorus.onInboxChanged(e => window.__cap.push(e))` from a CDP `Runtime.evaluate` registers an additional listener and returns an unsubscribe. Reassigning a method on `window.chorus` fails **silently**.

1. Two `claude` panes in **two different projects**, both driven to waiting — one to a **permission prompt** (ask for a shell command that is not pre-approved; `systeminfo | findstr /B /C:"OS Name"` works and Claude Code refuses to run it unprompted), one to a **completed turn**. Open the Inbox: **both listed, oldest first, correct project names, correct reason phrases, ages advancing.**
2. A `codex` pane running alongside: **absent from the list AND from the "N waiting" count.**
3. **Answer one pane. Its row disappears without a manual refresh** — this proves the push, which the cold read alone does not.
4. **Kill** a listed session. Its row disappears, and — the §6.1 hazard — **verify the list is correct on the FIRST push, not after a second event corrects it. Watch the actual payloads, not the screen.**
5. `Enter` on a row **focuses that pane** — CDP-assert the focused session or photograph it. **Not "verified" — say what you saw.**
6. `Escape` closes; `overlayOpen` goes false. **Confirm main's tracker classified the time as `overhead` while it was open** and back afterwards.
7. Quit every session: the empty state renders **"All voices working." / "nothing needs you"** (D73 wording, verbatim).
8. **The F59 case, driven deliberately:** get a session healed to `exited` while an activity record is still in memory for it. It must be **absent**.

Keep the captures under `_verify/4-2/`.

### The negative control — worth the two minutes

Temporarily drop the `status !== 'running'` guard and confirm exited sessions **do** appear. Then restore it. Three of the four exclusions are one-line `continue`s that a passing suite would not miss if they were subtly wrong; **drive at least one of them in both directions.**

## 11. Findings this task inherits

- **F69** — `Notification` arrives **~6 s into a permission block** and, since D146, classifies as `permission`. **The consequence for you: with both facts unchanged the edge trigger SUPPRESSES it, so `onActivity` is not a nag counter and never will be.** Do not build anything that expects a second event during a block.
- **F68** — one full-suite run failed a single unattributed test and never reproduced across 18 runs. **If a run fails once, capture the reporter output to a file BEFORE re-running** — losing the name is what made it unresolvable.
- **F59** — history is replayed only for sessions `restore()` actually relaunches, so a session healed to `exited` shows an empty pane beside a complete mirror. **This is why exited sessions are not Inbox items.**
- **F58** — pane ring buffers are TUI repaint streams, not transcripts. **This is why there is no preview.**
- **F56 / F67** — the edge trigger sits upstream of every listener, so tool counts and sub-agent counts are structurally unobservable from `onActivity`. Do not try to derive either.
- **F54** — the channel counter has collided four times across parallel branches. **You are moving it.**
- **F47** — session rows exist whose `project_id` names no project. **Your core must not throw on one.**

## 12. Failure honesty clause

If any verification command fails — including for an unrelated environment reason (a native-module ABI mismatch, a locked database, a missing CLI, a flaky test) — **capture the exact output verbatim, explain what you believe caused it, and do not claim success.** A partial pass reported as a pass is worse than a clean failure, because the next task builds on it. If a runtime gate cannot be run, **say so explicitly and name what was skipped.**

**F66 is in this repository because two adapter classifiers looked correct, matched nothing against real terminal bytes, and would have shipped an entire recovery path as dead code.** Do not claim a runtime behaviour works because the code reads correctly.

## 13. Final report — required format

**Status:** one of `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`

Then:

1. **Files changed** — every path, created/edited marked.
2. **Build results** — typecheck, `npm test` with file and test counts **compared to YOUR measured baseline**, `grep:secrets`.
3. **Runtime results** — what you actually did and observed for each of the eight gates in §10. Not "verified" — say what you saw, and attach the evidence. **Include the two project names and the two `since` values that prove the ordering.**
4. **The negative control** — state whether you ran it and what happened when the `running` guard was dropped.
5. **Review outcomes** — `Task-4-2.md`'s Review Checklist, item by item, pass/fail.
6. **Non-goals confirmation** — explicitly confirm: `IpcChannel` is **88** with **both** assertions updated and the starting figure **re-read from the merged tree**; `MIGRATIONS.length` still **19** (parsed); `sqliteTable(` still **18**; `agentEvents.ts`, `agentEventsCore.ts` and `attentionRollup.ts` byte-identical; no preview text, no ring-buffer read, no `session:write`; no Zod in preload; no npm dependency; the §4 file untouched.
7. **The open key** — which combination you chose, and why it does not collide with `claude` or `codex`.
8. **Residual risks and findings** — anything Task 4-3 should own. **The highest finding is currently F69, so propose F70 or later**, and the highest decision is **D146**. Report the `src/preload/index.ts` scope-table omission noted in §5 so `Task-4-2.md` can be corrected.
9. **Final `git status --porcelain`**, with confirmation that only intended code paths were staged.

---

## END OF PROMPT BODY

---

## Coordinator notes (not part of the prompt)

- **Task 4-2 is second of four.** After it lands, Task 4-3 is the notification policy (the first consumer of `reason` for a decision rather than a label) and Task 4-4 is the tray/OS surface. **`ToastEnabled=0` on this machine blocks all OS toasts, which is why the in-app centre is first-class and why 4-4 is last.**
- **The counter is the thing to watch.** This task takes `IpcChannel` 86 → 88. If a sibling branch lands channels first, the prompt's §3 figure is wrong and §9 step 3 is what catches it.
- **`Task-4-2.md`'s own line-number table and its "1977 / 58" baseline are stale** — both are superseded by §2 and §3 of this prompt. The task doc's scope table also omits `src/preload/index.ts`; §5 corrects it.
- **The 4-1 harness is reusable.** `_verify/4-1/launch-4-1.ps1` and `cdp41.js` work as-is; the only new trick this task needs is subscribing through the frozen bridge rather than patching it.
