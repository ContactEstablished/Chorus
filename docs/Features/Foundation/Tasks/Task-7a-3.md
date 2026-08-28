# Task 7a-3 — Launch presets, "how many", and batch launch

_Phase 7a, task 3 of 3. Authored 2026-08-26 against `3c70e87`, in parallel with Task 7a-1 and Task
7a-2 — **so every `file:line` below is a kickoff-day pointer and is RE-TAKEN AT PICKUP.** Concretely:
7a-1 deletes `LaunchDialog.vue`'s `codes` map at `:608`, so everything after it in that file has
moved by the time this task starts; 7a-2 adds `shell` to `agentKindSchema` and `staticRegistry`, so
`AgentKind` has six members rather than five. **An implementer who trusts a stale line number here
will edit the wrong line.**_

## Source Of Truth

| Document | Owns |
|---|---|
| `roadmap.md` §6 — **D186** | The ruling this task executes: the four preset shapes as implemented, the **Solo rule**, the partner-selection rule, sequential batching, stop-on-first-failure. Read it before the first edit; every judgement below is downstream of it |
| `roadmap.md` §6 — **D189** (b)/(c)/(g) · **D174** · **D26 Q1/Q4** · **D76** · **D22** · **D39**/**D163** · **D43** · **D160** · **D180(g)** | The preset table's origin · the one-line append all launch paths share · what happens to a swarm's worktrees afterwards · never render a fact the app cannot source · why the reviewer is a label · why no agent spawns another · the orthogonal axis saved profiles already own · no auto-Enter · no new global hotkey |
| `roadmap.md` §5 — **F104** | The pane cap checked against an unwritten layout. **This task is what makes it reachable, and it owns BOTH mitigations** |
| `roadmap.md` §5 — **F84**, and **D160** beside it | Why the "TASK — optional" first-prompt field is **blocked**, not deferred for taste. The single most important Non-Goal on this page |
| [`Phase-7a-Overview.md`](Phase-7a-Overview.md) | The phase's verified ground facts, the purity contract, the milestone — **use its table, never a number recalled from a decision row** |
| [`../ImplementationSpecs/ImplementationSpec-7a-3.md`](../ImplementationSpecs/ImplementationSpec-7a-3.md) | Exact insertion points, the module's shape, the payload rules, the UI strings, the runtime drive |
| `src/shared/layout.ts:1`–`:16` and `src/shared/agentNames.ts` | **The precedent for a pure shared module the renderer imports.** 255 and 79 lines, **zero imports each**, and `layout.ts`'s header records WHY. `src/shared/layout.test.ts` and `src/renderer/src/stores/layout.test.ts` are the test precedent |
| `src/main/services/launchProfiles.ts:9`–`:26` | The split this task copies one directory over: *"Everything in this module is a DECISION; everything in storage.ts is rows-in-rows-out; everything in ipc.ts is wiring."* `launchPresets.ts` is the decision half of the launch **shape**; `LaunchDialog.vue` is the wiring |

## Initial Starting Point — verified 2026-08-26 at `3c70e87`

Every line number below was opened and checked in this authoring session. **They move under 7a-1 and
7a-2 — re-take them; the FACTS are what this table is for.**

| Fact | Where | Value |
|---|---|---|
| Tree | `git status` | `HEAD` `3c70e87`, branch `chorus/Chorus/2be8b104`, identical to `main` and `origin/main`. Working tree: **`M .mcp.json`** (a line-ending artifact, no content change) · **`M docs/Features/Foundation/roadmap.md`** (this kickoff's architect pass) · **untracked: this kickoff's own six documents**. **Non-Goals forbids reverting, staging or committing any of them** |
| Gates | `npm run typecheck` · `npx vitest run` · `npm run grep:secrets` | **0** · **2969 / 79 in the main checkout** but **2941 / 78 + one uncollected file in a clean worktree** (**F103**) · clean, 6 patterns. **There is no `lint` script** |
| **⚠ F103 — the test number is checkout-local** | `codeIndexCore.test.ts:42` reads `_verify/6a-2/log-name-only.txt`; `_verify/` is gitignored at **`.gitignore:165`** and `git ls-files _verify` returns **0** | **2941 / 78 is the EXPECTED baseline in a worktree.** It arrives as an `ENOENT` collection error, not a test failure. **Do not "fix" it**, do not copy the fixture in — it belongs to whichever task stands up CI (Phase 7) |
| **⚠ A worktree has no `node_modules`** | — | Junction `C:\Projects\ContactEstablished\Chorus\node_modules` in **before** any gate — without it `tsc` is *"not recognized"* and the gate reports a **false green**. **Remove the junction afterwards**, or an `npm install` here writes into the main checkout |
| Migration | `MIGRATIONS` declared at `storage.ts:175`, **AST-parsed to 22** this session (the Overview's table cites `:171`; the number is what matters and both agree on **22**) | **This task authors none.** `MIGRATIONS.length` stays **22**, AST-parsed, **never grepped** |
| `IpcChannel` | `src/shared/ipc.ts` | **110 keys, AST-counted.** This task adds **none** |
| `LaunchDialog.vue` | — | **1593 lines.** `interface AgentCard` `:52` · `const selected = ref<AgentKind \| null>` `:62` · the absent-not-disabled standing rule `:158`–`:167` · `HIDDEN_AGENTS` `:512` · `toAgentCards` `:514` · `onMounted` `:525` (five parallel IPC calls, then a **non-awaited** `detectClis(true)` re-probe swapped in at `:560`–`:570` behind an `alive` flag) · `cancel()` `:595` · `codes` `:608` (**deleted by 7a-1**) · `MODES`/`modeLabels`/`modeNotes` `:619`–`:635` · **`submit()` `:711`–`:779`** · the agent grid `:872`, `v-for="a in agents"` `:874`, the tile `:882` · the footer `:1252`–`:1271` · `.launch-grid-3` `:1326` · `.launch-agent-tile` `:1378` |
| **⚠ `submit()` builds ONE payload with a spread discipline that is load-bearing** | `LaunchDialog.vue:724`–`:767` | `...(x ? {k:x} : {})` on every optional field, so **an untouched control sends no field at all**. It is what D90's rank 0, D179, `effort`, `permission_mode` and the authored identity all rest on. **PRESERVE IT VERBATIM — the loop WRAPS this payload, it does not rewrite it.** On success it emits `launched` once at `:772`; on `'ok' in res` it sets `error.value = res.reason` and returns |
| **⚠ `App.onLaunched` CLOSES THE DIALOG** | `App.vue:854` `onLaunched(payload: { agent: AgentKind; snapshot: AttachResponse })` → `sessionStore.attached` → **`layout.appendLaunchedLeaf(snapshot.sessionId)` `:887`** → `viewStore.setFocused(...)` `:891` → **`dialogOpen.value = false` `:892`** → `void projectStore.load()` | `dialogOpen` declared `:65`, opened `:300`, bound `@launched="onLaunched"` at `:994`. **See fact 1 below — this single line is what a batch breaks on** |
| The layout store | `stores/layout.ts` | `appendLaunchedLeaf` `:65`–`:72` · `schedulePersist` `:82`–`:88` (**`setTimeout(…, 500)`**) · **`persistNow(projectId: string, tree: LayoutJson \| null)` at `:89` — TWO ARGUMENTS, not nullary** · the `layout:set` handler in main is **synchronous** (`ipc.ts:3875`, `(_event, payload): void`) |
| The view store | `stores/view.ts:47` | `setMode(mode: ViewMode)`; modes are `'filmstrip' \| 'grid'` |
| The pane cap | `main/ipc.ts:366` `const LAUNCH_PANE_CAP = 16` (module-local, **not exported**); the check at `:1669`–`:1676` — `storage.getPaneLayout(p.id)` then `collectSessionIds(layout.root).length`, refusing at `>= 16` with *"Pane cap reached (16 per project)"* | Its own comment: *"Soft pane cap (spec §6): a pathological layout cannot fork dozens of agent processes. Panes = layout leaves for this project. Applies to every mode — a worktree launch adds a pane too."* **Soft — which is what makes F104 a hole rather than a crash** |
| The mutual-exclusion refusal | `main/ipc.ts:1697`–`:1699` | *"Pick a launch profile or a credential, not both."* |
| **⚠ Main refuses a profile whose agent differs** | `main/ipc.ts:1728`–`:1729` | `` `That launch profile is for ${profile.agent}, not ${req.agent}.` `` — **measured, not assumed. See fact 3** |
| The `new-worktree` branch | `main/ipc.ts:1898`–`:1974` | Creates the session row **FIRST** (**F16**: FKs are enforced and the worktree journal row references `session_id`), then `worktrees.createWorktree(row.id, mainRepoRoot, baseBranch)`, then `storage.activateWorktreeForSession(...)` in ONE transaction, then spawns **in** the worktree. Refuses a non-git cwd at `:1902` with `` `Not a git repository: ${req.cwd}` `` |
| Worktree placement | `services/worktrees.ts:35`–`:53` | `<repo-parent>\.chorus\<repo-name>\wt-<shortId>` on branch `chorus/<repo-name>/<shortId>`; `git worktree add` runs under **`GIT_CHECKOUT_TIMEOUT_MS = 10 * 60_000`** (`services/git.ts:46`, `:268`) |
| The wire | `src/shared/ipc.ts` | `launchRequestSchema` `:1143`–`:1237` · `workspaceModeSchema` `:1081` = three members · **`suggestMode(repoRoot, liveSessionsInRepo)` `:1133`–`:1136`** — `current-tree` for a non-git root, `new-worktree` when `liveSessionsInRepo >= 1`, else `current-tree` · `launchContextResponseSchema` `:1544`–`:1573` carries `suggestedMode`, `liveSessionsInRepo`, `worktrees`, `launchProfiles`, `lastLaunchProfileId`, `usedAgentNames` · `permissionModeSchema` `:990`–`:996` is **five members spanning two adapters' ladders** · `AGENT_NAME_MAX` 40 / `AGENT_DESCRIPTION_MAX` 50 · the **`PIN_MIN_LENGTH` precedent**: *"DECLARED HERE, IN SHARED, AND IMPORTED BY MAIN — never the reverse"* |
| The grid | `GridRenderer.vue:117`–`:118` | `repeat(auto-fit, minmax(min(var(--pane-min-w), 100%), 1fr))` over `grid-auto-rows: minmax(var(--pane-min-h), 1fr)` — **N panes already wrap by window width (D174); nothing in this task lays anything out** |
| Test precedent | `stores/layout.test.ts` | Pinia + fake timers + a stubbed `window.chorus.setLayout`. `appendLaunchedLeaf`'s existing cases are at `:62`, `:78`, `:89`, `:105` |
| **⚠ `.vue` component tests** | — | **None exist in this repository.** The dialog's behaviour is covered by the runtime drive, not by tests. Say so plainly rather than inventing a first one here |

### ⚠ Five facts that will cost a session if they are not believed

1. **⚠ `App.onLaunched` CLOSES THE DIALOG ON THE FIRST SUCCESS (`App.vue:892`), SO A BATCH WRITTEN
   WITHOUT TOUCHING IT UNMOUNTS ITS OWN PROGRESS UI AFTER SLOT 1.** The loop would keep running —
   the async function survives its component — but the user would watch panes appear with no
   progress line, no per-row ticks, and **nowhere for slot 3's failure to render**. Every visible
   promise this task makes (`Launching 2 of 4…`, the row ticks, *"2 of 4 launched"*, the inline
   reason) is unreachable until that line moves.

   **The fix is a second emit, not a flag on the first.** `submit()` emits `launched` once per
   success **exactly as today** — so `onLaunched` keeps running unchanged per session — and emits
   **`done` once at the end of the batch, only when at least one session started**. `App.vue`
   removes `dialogOpen.value = false` from `onLaunched` and binds the close (and the grid switch) to
   `done`. **A batch where nothing started emits nothing and the dialog stays open with its reason**,
   which is the existing failure behaviour preserved exactly.

2. **⚠ F104 — THE PANE CAP IS CHECKED AGAINST A LAYOUT THAT HAS NOT BEEN WRITTEN YET, AND THIS TASK
   IS WHAT MAKES IT REACHABLE.** `session:launch` counts panes from the **persisted** layout
   (`ipc.ts:1669`–`:1676`) while the renderer persists on a **500 ms debounce**
   (`stores/layout.ts:82`–`:88`). Today the dialog launches exactly one session per press, so no two
   launches can share a debounce window. A batch of 6 starting from 14 panes **reaches 20 against a
   cap of 16** — every launch in it measures the world as it was before the batch began.

   **TAKE BOTH MITIGATIONS, NOT ONE.** They are not redundant, they answer different failures:
   - the **renderer clamps the offered count** to the remaining budget, so the impossible option is
     never rendered (**absent, not disabled**) — this is what the user sees;
   - the **layout is flushed between launches** so main's own check is **correct** rather than merely
     unreachable — this is what protects the cap when the count came from anywhere else (a second
     window, a stale tree, a future caller).

   Flushing a 500 ms debounce for ≤ 6 sequential, discrete, user-initiated launches costs nothing the
   debounce was protecting against: **it exists for drag-resize storms, and there are no splitters
   left to drag** (`stores/layout.ts`'s own header records that `applyRatio` went with them).

3. **⚠ THE PER-AGENT CONTROLS TRAVEL ONLY ON SLOTS RUNNING THE PICKED AGENT — AND THE FAILURE IS
   MEASURED, NOT HYPOTHETICAL.** D186 says model, effort and permission are chosen once and apply to
   the whole batch. That sentence is about **Solo and Swarm, where every slot is the picked agent.**
   Pair's partner and Workbench's shell are a **different** agent, and forwarding those fields to
   them is wrong three separate ways:

   - `main/ipc.ts:1728`–`:1729` **refuses outright**: *"That launch profile is for codex, not
     claude."* A Pair that forwarded `launch_profile_id` would stop the batch at slot 2 and report
     *"1 of 2 launched"* — a self-inflicted partial failure on the happy path;
   - `permissionModeSchema` (`shared/ipc.ts:990`) is **one enum spanning two ladders** — `plan` is
     claude's, `full-access` is codex's (**D183**) — so a mode chosen for the builder is at best
     meaningless and at worst applied to a rung the partner does not have;
   - a **model id** is route-scoped (D90 rank 0). Handing claude's model string to codex is a broken
     launch that fails at the provider, minutes later, where nothing points back here.
   - and **D185** requires main to refuse a `shell` launch carrying a credential at all.

   **So: `model`, `effort`, `model_effort`, `permission_mode`, `launch_profile_id` and
   `credential_profile_id` are emitted ONLY for slots whose agent equals the picked agent.** For a
   different-agent slot they are **omitted entirely** — which drops that launch onto the adapter's
   own declared defaults, i.e. byte-identical to what an untouched dialog would send for that agent.
   The dialog says so in one line beside the preset row; it does **not** grow a per-slot matrix.

4. **⚠ SOLO AT COUNT 1 MUST SEND A PAYLOAD BYTE-IDENTICAL TO TODAY'S DIALOG. THAT IS THE MILESTONE'S
   SECOND CLAUSE AND IT IS THE REGRESSION THAT MATTERS MOST.** Every preset is new surface a user can
   ignore; Solo is the path they already use. The mechanism is not vigilance, it is structure:
   **`planLaunches` returns exactly one row for Solo at 1, that row overrides `agent` with the
   value already selected and `workspace_mode` with the mode already chosen, and every other field in
   the `:724`–`:767` literal is untouched.** The `...(x ? {k:x} : {})` spreads are preserved
   character for character. A phase that ships four working presets and a changed Solo payload has
   failed — so the drive captures the payload and compares it, rather than asserting it looks right.

5. **⚠ `src/shared/launchPresets.ts` HAS NO RUNTIME IMPORTS, AND THE REASON IS A SILENT FAILURE.**
   `src/shared/layout.ts:1`–`:16` records it: the renderer runs under a CSP with **no
   `unsafe-eval`**, so **a Zod import in a shared module the renderer pulls in throws `EvalError`**
   — and D1's own history is that this fails *quietly*, dropping events rather than erroring
   visibly. `layout.ts` (255 lines) and `agentNames.ts` (79 lines) are both pure with zero imports,
   and they are the precedent. **A type-only `import type` is permitted and is erased at build time;
   a value import of `shared/ipc` is not** — the spec's §1 gives the source-text guard that keeps
   this true after the next edit.

   And the sibling half: **this repository has NO `.vue` component tests at all**, so
   `launchPresets.test.ts` is not "a nice extra" — **it is where this feature's correctness lives.**
   Everything a test can reach goes in the module; the dialog is left with rendering and a loop, and
   is proved by the drive.

## Goal

**One press of Launch starts a *shape* of work.** Today `LaunchDialog.vue` builds one
`LaunchRequest`, `session:launch` creates one row, `SessionManager.spawn` starts one PTY and
`App.onLaunched` appends one leaf — **exactly one agent per press**. Everything downstream already
handles N panes: `GridRenderer` wraps them by window width (D174), the layout tree is an ordered
list, and `suggestMode()` already advises a new worktree the moment a second session writes the same
repo. **Only the front door is single-file, and this task widens it.**

When this lands, four presets exist — **Solo · Pair · Workbench · Swarm** — a count row appears for
the two whose size is the user's to choose, a **Will launch** strip shows every planned session
*before* Launch is pressed, and `submit()` walks the plan **sequentially**, emitting `launched` once
per success so `App.onLaunched` runs unchanged per session.

**The shape lives in a pure module, not in the `.vue` file, and that is the whole design.** A
`.vue` file cannot be tested in this repository; `src/shared/launchPresets.ts` can be tested
exhaustively — every preset × every count × missing partner × missing shell × the picked agent being
the shell itself. That is the same split `launchProfiles.ts` draws one directory over: *"Everything
in this module is a DECISION; … everything in ipc.ts is wiring."*

**And it adds nothing to main.** No IPC channel, no migration, no dependency, no change to
`session:launch`. Worktree-per-swarm-agent comes entirely free from `workspace_mode:
'new-worktree'`, which already creates a worktree, a branch and a journal row per launch. **If this
task finds itself designing a bulk-launch primitive, it has taken a wrong turn.**

## Exact Scope

**Create**

- `src/shared/launchPresets.ts` — the preset table, `planLaunches()`, the partner rule, the count
  helper, the role labels, the batch-outcome sentence. **Zero runtime imports.**
- `src/shared/launchPresets.test.ts` — the exhaustive matrix. **This is where the feature's
  correctness lives.**

**Edit**

- `src/shared/ipc.ts` — **`LAUNCH_PANE_CAP` is declared here** and exported, in the shape and for the
  reason `PIN_MIN_LENGTH` states at `:1108`–`:1121`: *"DECLARED HERE, IN SHARED, AND IMPORTED BY
  MAIN — never the reverse."* The renderer must clamp against the same 16 main enforces, and a
  second literal is a drift the user would meet as a refused launch. **No new `IpcChannel` key; the
  count stays 110.**
- `src/main/ipc.ts` — delete the module-local `const LAUNCH_PANE_CAP = 16` at `:366` and import it.
  **No other change; the cap check at `:1669`–`:1676` is untouched.**
- `src/renderer/src/stores/layout.ts` — `appendLaunchedLeaf` **writes through** instead of
  scheduling (F104 mitigation 2).
- `src/renderer/src/stores/layout.test.ts` — the F104 regression guard: a launched leaf is persisted
  **without advancing the timers**.
- `src/renderer/src/components/LaunchDialog.vue` — the preset row, the count row, the Will-launch
  strip, the batch loop in `submit()`, the progress label, and the new `done` emit.
- `src/renderer/src/App.vue` — `onLaunched` loses `dialogOpen.value = false`; a new `onLaunchDone`
  closes the dialog and switches to grid when more than one session started.

**Nothing else.** In particular: nothing under `src/main/adapters/`, no schema file, no preload
method, no store beyond `layout.ts`.

## Non-Goals

- **⚠ THE "TASK — optional" FIRST-PROMPT FIELD IS BLOCKED, NOT DEFERRED FOR TASTE, AND IT IS THE ONE
  ITEM A FUTURE IMPLEMENTER MUST NOT REDISCOVER.** The reference screenshot has one and the v2 mock
  draws one. Chorus **cannot honestly build it yet**. **F84** measured that `session:write` into an
  agent still starting up **succeeds and the text is silently lost** — main reported `inserted`,
  logged 107 characters, and **nothing appeared in the pane**. The fix needs a **per-adapter
  readiness signal that no adapter declares**, and Tasks 5-3 and 5-4 each deferred that decision on
  purpose. **D160** separately makes no-auto-Enter a **safety rule, not a preference**. And a
  **staggered batch launch is the exact condition F84 was measured under** — six agents starting at
  once, each with its own warm-up — so a task field here would drop its text more often than
  anywhere else in the app. **A field that silently loses what the user typed is worse than no field
  at all.** It belongs to whichever task first declares agent readiness, and **this is not that
  task**.
- **A read-only workspace mode.** Deferred since **D22**; `workspaceModeSchema` has three members and
  the v2 mock draws a fourth that does not exist. **Pair's reviewer is a LABEL** — it writes the same
  tree as the builder, the preset picks a different *tool* and sets the session `description`, and
  stops there. **The blurb must say so** rather than implying a sandbox.
- **Agent-driven spawning or layout.** **§8's first bullet and D39 bar them in full**, and **D163**
  restates that they *"remain barred in full."* A human presses Launch once and gets N panes; no
  agent spawns, stops, resumes or steers another. **D39's own text points here**, naming *"launch
  each agent as its own top-level Chorus session (N concurrent PTYs, each with its own worktree and
  controls)"* as the honest path to per-agent isolation — Swarm is a shortcut to the thing D39
  endorsed, not an approach to the thing it barred.
- **Candidate features C1 (peer messaging) and C2 (sub-agent visibility).** **D163** admits them for
  consideration and bars building toward them without a kickoff that places them: *"no task doc, no
  spec, no small enabling commit riding another phase."* Nothing here rides them.
- **A new global hotkey.** **D180(g)**: the hotkey listener is capture-phase and `preventDefault`s,
  so anything it binds is **stolen from every agent terminal**. Preset selection is dialog-local
  keyboard handling inside the existing focus trap (`onKeydown`, `:782`), which is not that.
- **User-authored presets.** Hardcoded in v1. **Saved launch profiles (D43) own the orthogonal
  per-agent axis** — model, effort, credential, permission — and a preset is the *shape of the
  fan-out*. **Do not merge the two surfaces:** the dialog already renders a profile chip row, and a
  second chip row that looked the same but meant something else would read as one control.
- **Per-slot settings matrices.** Fact 3 above narrows which controls travel; it does not open a
  second control per slot.
- **Auto-merge of swarm branches** (§8), and **any cleanup of a swarm's worktrees.** **D26 Q1/Q4
  already govern them and need no new work**: a worktree outlives its session, a clean close offers
  removal, a dirty one detaches into `WorktreePanel`'s retained list, and **branches are never
  auto-deleted**.
- **No bulk-append primitive, and no second launch entry point.** **D174(b)** collapsed all three
  launch paths onto the single line `layout.appendLaunchedLeaf(id)` *"so they can no longer disagree
  about where a session lands"*. **A batch is N sequential trips through that same line, in order.**
- **No new IPC channel, no migration, no dependency.** `IpcChannel` stays **110**, `MIGRATIONS.length`
  stays **22** (AST-parsed from `storage.ts:175`, **never grepped**), runtime deps stay **9**.
  **A task that finds it needs one has found a design problem, not a number — stop and raise it.**
- **No cost estimate on the footer.** The mock prints *"est. ~$0.40–0.90 / task at deep"* and the
  footer comment at `:1245`–`:1251` already records why Chorus omits it (**F35**: attribution is
  account-scoped and after the fact). **Swarm makes that temptation stronger and the answer is
  unchanged** — the Will-launch strip is an honest count of *sessions and checkouts*, not of dollars.
- **⚠ Do not revert, stage, commit or delete unrelated working-tree changes.** `.mcp.json` (a
  line-ending artifact) and `roadmap.md` (this kickoff's architect pass) are modified at pickup, and
  this kickoff's own six documents are untracked. **Report anything else you find; absorb nothing.**

## Dependencies

**Both of this phase's other tasks, and both are hard.**

- **Task 7a-1 — vendor marks.** The Will-launch strip renders **`AgentMark`** per row. Before 7a-1
  lands there is no such component, and `LaunchDialog.vue` still carries the `codes` map at `:608`
  that 7a-1 deletes. **Do not build the strip against `codes`** — it will be gone. **⚠ Its prop is
  `name`, not `agent`** (`defineProps<{ name: AgentMarkName; size?: number }>()`, and
  `AgentMarkName = AgentKind | 'shell'`), so a slot's agent assigns with no cast.
- **Task 7a-2 — `shell` as an agent kind.** Workbench's second slot is `agent: 'shell'`. Before 7a-2
  lands, `agentKindSchema` has five members and `'shell'` does not typecheck, `staticRegistry` has no
  adapter to spawn, `DETECTED_TOOLS` never probes it (so no Terminal card exists to select), and the
  credential refusal D185 requires does not exist. **Workbench cannot be built, let alone driven,
  until 7a-2 is merged.** **⚠ And reuse 7a-2's named list of kinds that take no suggested name** —
  the batch's per-slot naming must not be the one path that leaves a person's name on a Terminal.

**Ships as its own single narrated commit, in its own execution session** (Matthew's choice,
2026-08-26), so it is independently reviewable and independently revertable.

**No approval gate.** D186 was resolved by Matthew on 2026-08-26 and this task executes it. What it
does **not** license is re-deciding the Solo rule or the partner rule at the keyboard: both were
taken explicitly, with their alternatives named, and are quoted in §1 of the spec.

## Step-by-step Work

1. **Run §0 of the spec before writing a line.** Junction `node_modules`; re-take the gate baseline
   **in this checkout** (expect 2941 / 78 — F103); AST-count `MIGRATIONS` (**22**) and `IpcChannel`
   (**110**); confirm **7a-1 and 7a-2 are merged** (`AgentMark.vue` exists, `agentKindSchema` has six
   members including `shell`, `staticRegistry` agrees — **F25**'s trap is armed when they disagree);
   and **re-take every `file:line` in the table above**, because 7a-1 deleted `codes` and shifted
   everything below it.
2. **Write `src/shared/launchPresets.ts` first, and write its test beside it.** The module is the
   decision; the dialog is the wiring. Doing it in this order is not a style preference — it is the
   only way to know the Solo rule and the partner rule are right **before** they are wired into a
   surface no test can reach. **Zero runtime imports** (fact 5); `import type` only, and add the
   source-text guard from §1 so a later value import fails a test rather than the CSP.
3. **Move `LAUNCH_PANE_CAP` to `shared/ipc.ts`** and import it in `main/ipc.ts`. **Pure relocation —
   the cap check itself does not change.** The `PIN_MIN_LENGTH` docblock is the template for the
   comment: declared in shared, imported by main, never the reverse, because a second copy drifts in
   the direction that matters (a renderer offering what main refuses).
4. **`stores/layout.ts`: `appendLaunchedLeaf` writes through** (F104 mitigation 2), falling back to
   `schedulePersist()` when there is no `projectId`. Add the guard test. **⚠ The debounce is not
   removed** — `removeLeaf` keeps it, because closing panes really can arrive in bursts.
5. **`LaunchDialog.vue` — the state and the plan.** `preset`, `count`, `rowStates`, `progressIndex`;
   a `plan` computed calling `planLaunches(...)`; a `remainingBudget` computed reading
   `collectSessionIds(layout.tree.root).length` against the imported cap. **The plan is a computed,
   not a field written on submit** — the strip must show what will happen *before* Launch is pressed,
   which is the whole point of the strip.
6. **`LaunchDialog.vue` — the batch loop.** `submit()` walks `plan.value` **sequentially**, awaiting
   each launch. **Never `Promise.all`**: `git worktree add` contends on the repository's index, and
   each worktree launch already awaits a checkout under a **10-minute** timeout
   (`services/git.ts:46`). Six parallel `worktree add`s against one index is a lock fight whose
   failure mode is a hung dialog. On `'ok' in res`: record the reason, mark the row failed, **break**.
   **Never unwind a session that started.**
7. **`LaunchDialog.vue` — the surface.** The preset row **above PROFILES** (the mock's placement);
   the count row for `solo` and `swarm` only — **absent, not disabled**, for Pair and Workbench,
   whose size shows as a badge on the card instead; the workspace-mode cards render **only for
   `solo`**, because every other preset's shape names the mode and a control the plan ignores is a
   control that lies (the argument `:1120`–`:1128` already makes about the deselect branch); the
   **Will launch** strip at the foot, one row per planned session, **omitted rather than rendered
   empty** (**D76**).
8. **`App.vue`.** Remove `dialogOpen.value = false` from `onLaunched`; add `onLaunchDone` bound to
   the dialog's new `done` event, which closes the dialog and calls `viewStore.setMode('grid')` when
   more than one session started. **Flag the grid switch as a judgement call in the code comment and
   say why:** a swarm of four landing in filmstrip shows you **one** pane, which defeats the preset
   the user just chose.
9. **Run every gate, then the seven-step runtime drive.** **A compiled feature is not a delivered
   one** (roadmap §3, step 4), and steps (1) and (7) — Solo's byte-identical payload and the
   non-git refusal — are the two that decide this task.

## Test Expectations

**⚠ `src/shared/launchPresets.test.ts` IS WHERE THIS FEATURE'S CORRECTNESS LIVES, BECAUSE THIS REPO
HAS NO `.vue` COMPONENT TESTS AT ALL.** Nothing here mounts a dialog; nothing here can. Every rule
that can be stated as a function of inputs is in the module, and every one of them is asserted:

**The shapes — every preset × every count**

- `solo` at 1 → **exactly one row**: the picked agent, `workspaceMode` = the mode passed in, `role`
  `null`, `description` `null`. **This is the byte-identity case and it is asserted first**;
- **`solo` at 3 → row 1 at the passed mode, rows 2 and 3 at `new-worktree`** (D186's Solo rule),
  with the reason in the test's own comment: by the time agent 2 launches, another live session IS
  writing the repo, which is the condition `suggestMode()` already keys on
  (`liveSessionsInRepo >= 1`). **This assertion is the one that would silently revert** if someone
  "simplified" Solo to N × the chosen mode;
- `solo` at 1 with the passed mode `existing-worktree` → one row, mode preserved (the user's
  worktree pick still works); **`solo` at 3 with `existing-worktree` → rows 2 and 3 are
  `new-worktree`**, because a second session cannot attach a worktree the first now owns;
- `pair` → **exactly two rows regardless of count** (`count: 5` still yields 2): builder = picked
  agent, `role: 'builder'`, `description: null`; then the partner, `role: 'reviewer'`, with the
  preset's own short description. **Both `current-tree`**;
- `workbench` → two rows regardless of count: picked agent then **`shell`**, both `current-tree`;
- `swarm` at N → **N rows, every one `new-worktree`**, every one the picked agent;
- **counts clamp**: `0` and `-1` yield 1 row, `99` yields `MAX_LAUNCH_COUNT` (6) — asserted against
  the exported constant, never against a literal `6` retyped in the test.

**The partner rule**

- partner = the **first installed, non-hidden agent that is not the builder**, from the fixed order
  `claude → codex → grok → opencode` — asserted for every builder in that order;
- **`shell` and `kimi` can never be a partner even when installed**, because they are absent from
  `PARTNER_ORDER` by construction;
- **⚠ the drift guard**: every member of `agentKindSchema.options` is either in `PARTNER_ORDER` or in
  a named exclusion set (`shell`, `kimi`), asserted against the **imported** schema — so the next
  agent kind fails this test until someone decides, in writing, whether it can review;
- **no second installed agent → `planLaunches` returns `[]` and `presetDisabledReason` returns a
  sentence.** An empty plan is the honest representation of *"this shape cannot be built here"*: the
  strip omits itself (**D76**) and Launch disables, both keyed off the same emptiness;
- with the shell missing, `workbench` behaves the same way.

**The edges**

- **the picked agent IS `shell`**: `workbench` yields two Terminals and `pair` pairs a Terminal with
  the first ordinary agent. Both are legal, both are visible in the strip, and **neither is special-
  cased** — the test pins the behaviour so nobody adds a rule for it later;
- **slot 0 is always the user's**: for every preset and every count, `plan[0].description === null`
  and `plan[0].role` is `null` or `'builder'`. This is what lets the dialog give slot 0 the typed
  name and note and give later slots their own;
- **every authored description fits the wire cap**: asserted as `<= AGENT_DESCRIPTION_MAX`
  **imported from `shared/ipc`** — the module itself may not import it (fact 5), so the **test** is
  where the two numbers are tied together, and there is no second literal anywhere;
- `offeredCounts(budget)`: `0 → [1]` (a renderer that offered nothing would be inventing a refusal
  main owns, and main's inline reason is the better message), `2 → [1,2]`, `99 → [1..6]`;
- `batchOutcomeLine(1, 1) → null` — a single launch's failure must read exactly as it does today —
  and `batchOutcomeLine(2, 4) → '2 of 4 launched'`;
- **the purity guard**: the test reads its own module's source and asserts **every `import` line
  begins `import type`**. It is three lines, it catches the failure the CSP would otherwise catch
  silently at runtime, and it is the same source-text technique `schema.test.ts` uses for
  `storage.ts`.

**`src/renderer/src/stores/layout.test.ts` — the F104 guard**

- `appendLaunchedLeaf` calls `window.chorus.setLayout` **with no timer advance at all**, carrying the
  tree that already includes the new leaf. Today that assertion fails; after this task it is the
  thing that stops the debounce coming back;
- **`removeLeaf` still debounces** — asserted, so the write-through is not widened by accident;
- the four existing `appendLaunchedLeaf` cases stay green untouched (they advance timers and use
  `toHaveBeenLastCalledWith`, which a write-through satisfies).

**And what is deliberately NOT unit-tested, said out loud:** the dialog's rendering, the loop's
sequencing, the progress label, the row ticks, the grid switch and the dialog close. **There is no
`.vue` test harness in this repository and this task does not invent one** — those are the drive's
job, and the drive is not optional.

## Verification Commands

Runnable as written from the repository root (PowerShell). **⚠ Junction `node_modules` first or
every one of these reports a false green.**

```powershell
# a worktree has no node_modules — the main checkout's, junctioned in, then removed after
New-Item -ItemType Junction -Path "C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104\node_modules" `
  -Target "C:\Projects\ContactEstablished\Chorus\node_modules" | Out-Null
# ⚠ ASSERT IT EXISTS BEFORE TRUSTING ANY GATE BELOW. Whichever form you use, a
#   junction that was not created surfaces as `'tsc' is not recognized`, which
#   reads as a broken toolchain rather than a missing directory.
if (-not (Test-Path "C:\Projects\ContactEstablished\.chorus\Chorus\wt-2be8b104\node_modules\.bin\tsc.cmd")) { throw 'junction missing — gates below would be a false green' }

npm run typecheck          # 0 errors, node + web
npx vitest run             # 2941 / 78 in a worktree (F103) + this task's new cases
npm run grep:secrets       # clean, 6 patterns
```

**The counters this task must NOT move, each measured with the TypeScript AST rather than a grep:**

```powershell
# MIGRATIONS: 22, unchanged
node -e "const ts=require('typescript'),fs=require('fs');const p='src/main/services/storage.ts';const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);let i=null;const w=n=>{if(ts.isVariableDeclaration(n)&&n.name.text==='MIGRATIONS')i=n.initializer;ts.forEachChild(n,w)};w(sf);console.log('MIGRATIONS.length =',i.elements.length)"

# IpcChannel: 110, unchanged
node -e "const ts=require('typescript'),fs=require('fs');const p='src/shared/ipc.ts';const sf=ts.createSourceFile(p,fs.readFileSync(p,'utf8'),ts.ScriptTarget.Latest,true);let i=null;const w=n=>{if(ts.isVariableDeclaration(n)&&n.name.text==='IpcChannel')i=n.initializer;ts.forEachChild(n,w)};w(sf);while(i&&(ts.isAsExpression(i)||ts.isSatisfiesExpression(i)))i=i.expression;console.log('IpcChannel keys =',i.properties.filter(p=>ts.isPropertyAssignment(p)).length)"

# runtime dependencies: 9, unchanged
node -e "console.log(Object.keys(require('./package.json').dependencies).length)"
```

**The structural checks this task's own limits rest on:**

```powershell
# the pure module has NO runtime import — every hit must begin `import type`
Select-String -Path src/shared/launchPresets.ts -Pattern "^import"

# ONE home for the pane cap: the declaration in shared, the import in main, no stray 16
Get-ChildItem -Path src -Recurse -Include *.ts,*.vue | Select-String -Pattern "LAUNCH_PANE_CAP"

# the loop is sequential — there must be no Promise.all/allSettled anywhere near the launch path
Select-String -Path src/renderer/src/components/LaunchDialog.vue -Pattern "Promise\.(all|allSettled|race)"

# the spread discipline survived: the optional fields are still conditional spreads
Select-String -Path src/renderer/src/components/LaunchDialog.vue -Pattern "\.\.\.\(.*\? \{"

# nothing outside the Exact Scope list changed
git diff --stat
```

**Runtime drive — the task is not done until this has been observed, not compiled.** A real window on
a `--user-data-dir` **seeded from `%APPDATA%\chorus-app`** (the dev DB has no credentials, so
credential paths look broken without it, including the `Local State` file beside it), driven over
**CDP port 9333 — never 9222**, which is the stable instance. Evidence under `_verify/7a-3/`.

1. **⚠ Solo → one pane, and a BYTE-IDENTICAL payload to today's dialog.** The regression that matters
   most. Capture the outgoing `session:launch` payload (log it in main for the drive, or read it off
   the CDP-visible invoke) and **diff it against the same launch on `3c70e87`**. Key set and values
   must match exactly — in particular **no `preset`, no `count`, no field that was previously
   absent**. Paste both payloads.
2. **Pair → two panes, two different agents, both `current-tree`**, and the reviewer's row carries
   the preset's `description` while the builder's carries whatever the user typed. Confirm in the
   pane headers **and** in the `sessions` rows.
3. **Workbench → an agent plus a Terminal in the same tree.** Both `current-tree`; the Terminal pane
   renders **no** model, effort or permission control anywhere in its launch (7a-2's six nulls).
4. **Swarm at 4 → four panes, four distinct worktrees** under `<repo-parent>\.chorus\<repo>\wt-*` on
   **four distinct `chorus/<repo>/<id>` branches**, all four listed in `WorktreePanel`, **and the
   view switched to grid**. Paste `git worktree list` and the branch names. **And confirm the four
   panes carry four DIFFERENT names** — four identical "Bob"s is the exact failure names were added
   to prevent, and a swarm is the fastest way to create it.
5. **Solo at 3 → agent 1 in the current tree, agents 2 and 3 in worktrees.** This is D186's Solo rule
   observed rather than asserted; paste the three sessions' `cwd`s.
6. **The cap.** With **14 panes open** in one project, the count row offers **at most 2** — values
   past the budget are **not rendered**, not greyed. Then confirm the other half of F104: with the
   flush in place, a batch that would exceed the cap is refused by **main** at the right slot, with
   its own *"Pane cap reached (16 per project)"* reason, rather than all six launches passing a
   stale check.
7. **The failure path.** A **non-git cwd** with **Swarm** selected: the first launch refuses *"Not a
   git repository: …"*, **the batch stops**, the dialog **stays open**, and it says **"0 of 4
   launched"** with that reason inline. Then the partial case: make slot 3 of 4 fail and confirm
   **"2 of 4 launched"**, the two panes **still open**, and **nothing unwound**.

**⚠ Failure-honesty clause.** A command that fails for any reason — a missing CLI, a git lock, a
worktree path collision, CDP not attaching — is reported **with its output**, and the step is **not
claimed**. A drive that did not run is not a drive that passed.

## Acceptance Criteria

- [ ] §0's probes re-run: gates re-taken **in this checkout** (2941 / 78 expected — F103), the AST
      counters recorded, **7a-1 and 7a-2 confirmed merged**, and every `file:line` in the table above
      re-taken against the post-7a-1 tree.
- [ ] `src/shared/launchPresets.ts` exists, is **pure**, and has **no runtime import** — proved by
      the test's own source-text guard, not by inspection.
- [ ] **Solo at 1 sends a payload byte-identical to `3c70e87`'s**, proved by a captured diff of two
      real payloads, and the `...(x ? {k:x} : {})` spreads at `:724`–`:767` are preserved verbatim.
- [ ] **D186's Solo rule is implemented and tested**: agent 1 at the chosen mode, agents 2..N at
      `new-worktree`, with the reason recorded in the module's own comment.
- [ ] **Pair's partner** is the first installed, non-hidden agent that is not the builder from
      `claude → codex → grok → opencode`; with none, the card is **shown and disabled with its
      reason**, never hidden — and `planLaunches` returns `[]`.
- [ ] **Roles are a label**: the Pair blurb says the reviewer writes the same tree, and no code
      anywhere attempts a read-only mode (**D22**).
- [ ] **The per-agent controls travel only on slots running the picked agent** — model, effort,
      model-effort, permission, launch profile and credential are omitted for a different-agent slot,
      and the dialog states that the controls apply to the batch.
- [ ] **The count row renders only for `solo` and `swarm`** — absent, not disabled, for Pair and
      Workbench, whose size shows as a badge. Options **1–6**, **clamped to the remaining pane
      budget**; values past it are **not rendered**.
- [ ] **BOTH F104 mitigations are in place**: the renderer clamp **and** the layout flush between
      launches, with `appendLaunchedLeaf`'s write-through proved by a test that advances no timers.
- [ ] **The batch is sequential** — no `Promise.all` anywhere in the launch path — and emits
      `launched` once per success so `App.onLaunched` runs unchanged per session.
- [ ] **Partial failure stops at the first failure and keeps what launched**, shows the inline reason
      plus *"2 of 4 launched"*, and **never unwinds a session that started**.
- [ ] **The dialog closes when the batch ends and at least one session started** — via the new `done`
      emit, not from inside `onLaunched` — and **switches to grid when more than one launched**, with
      the judgement call recorded in the code.
- [ ] **The Will-launch strip renders one row per planned session** with mark, agent label, role and
      workspace target, and is **omitted rather than rendered empty or as "0 sessions"** (**D76**).
      Its Swarm copy states that each agent gets its own worktree and branch and that **branches are
      never auto-deleted** (**D26 Q1/Q4**).
- [ ] **No new IPC channel, no migration, no dependency**: `IpcChannel` **110** · `MIGRATIONS.length`
      **22** · runtime deps **9**, each AST-counted and pasted.
- [ ] **`LAUNCH_PANE_CAP` has exactly one home** — declared in `shared/ipc.ts`, imported by main, and
      `Select-String` shows no second literal.
- [ ] typecheck **0** · vitest **≥ 2941 in a worktree** plus this task's new cases · `grep:secrets`
      clean.
- [ ] The seven-step drive is captured under `_verify/7a-3/` with exact outputs, including the Solo
      payload diff, `git worktree list` for the swarm, and the two failure cases.
- [ ] `git diff --stat` shows **no file outside the Exact Scope list**, and the pre-existing
      `.mcp.json` / `roadmap.md` modifications are untouched by this task's diff.

## Review Checklist

A spec reviewer must confirm:

1. **The plan is a computed, not a side effect of submit.** The Will-launch strip must be able to
   show the batch **before** Launch is pressed; if `planLaunches` is called inside `submit()`, the
   strip is showing a guess and the honesty surface this task exists to build is decorative.
2. **`plan[0]` is the user's slot, always.** Grep the payload builder: slot 0 takes the typed name
   and the typed note; only slots ≥ 1 may carry a plan-supplied description or a re-suggested name.
   If slot 0 can receive a plan-authored field, Solo's byte-identity is gone and no test will say so.
3. **The controls do not cross an agent boundary.** Read the payload builder's conditional spreads:
   `model`, `effort`, `model_effort`, `permission_mode`, `launch_profile_id` and
   `credential_profile_id` must each be gated on `slot.agent === selected.value`. **A Pair that
   forwards a launch profile fails at `ipc.ts:1728` with an authored reason** — it is a partial
   failure on the happy path, and it looks like a batching bug rather than the payload bug it is.
4. **The loop is sequential and the failure stops it.** `await` inside a `for`, `break` on
   `'ok' in res`, no `Promise.all`, no `continue`-past-a-failure. `git worktree add` contends on the
   index and each checkout runs under a **10-minute** timeout; six at once is a lock fight.
5. **Nothing unwinds.** Grep the failure branch for any `session:delete`, `removeLeaf` or "rollback".
   **A half-swarm the user can see beats a rollback they cannot** — and nothing in this codebase
   silently undoes user-visible state.
6. **Both F104 mitigations are present, and the reviewer can point at each.** One is
   `offeredCounts(remainingBudget)` in the renderer; the other is the write-through in
   `appendLaunchedLeaf`. **If only the clamp is there, main's cap check is still measuring a stale
   world** — it just happens not to be asked an impossible question by this particular caller.
7. **The debounce was narrowed, not deleted.** `removeLeaf` must still call `schedulePersist()`, and
   a test must say so. Removing the debounce wholesale is a wider change than F104 asked for.
8. **`appendLaunchedLeaf` is still the single append.** **D174(b)**: one line, three callers'-worth
   of behaviour, N sequential trips for a batch. A `appendLaunchedLeaves(ids)` — however tidy — is
   the second entry point that decision exists to prevent.
9. **The pure module is pure.** Every `import` line begins `import type`; there is no `z.`, no
   `window`, no `Date`, no clock. And the test guard that proves it exists — a reviewer should be
   able to break purity deliberately and watch a test go red.
10. **Absent, not disabled.** The count row does not render for Pair/Workbench; the workspace cards
    do not render for Pair/Workbench/Swarm; the Will-launch strip does not render empty. A greyed
    control anywhere in this diff is a finding, not a taste question (`LaunchDialog.vue:158`–`:167`).
11. **No `.vue` file does arithmetic or string assembly** for the preset blurbs, the role labels, the
    outcome sentence or the count options. All four come from `launchPresets.ts` and are tested
    there — the rule `shared/provenance.ts:6`–`:10` states, for the reason it states it: **this repo
    has no `.vue` tests at all.**
12. **`git diff --stat` shows no file outside the Exact Scope list**, nothing under
    `src/main/adapters/`, and no change to `session:launch`'s handler beyond the cap import.
