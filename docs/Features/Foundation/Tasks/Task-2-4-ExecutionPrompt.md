# Chorus Phase 2, Task 2-4 Execution Prompt — Diff Summary (CLOSES THE PHASE)

_Generated 2026-07-21 against HEAD `6ec674b`. Ground facts in §4 verified at that commit by direct inspection: `npm run typecheck` exits 0, `npx vitest run` = 132/132 across 7 files, working tree clean, `git worktree list` shows the main tree + one fixture worktree._

## §1 Role

You are the implementation engineer for Chorus Phase 2, Task 2-4 (diff summary — the **fourth and FINAL** Phase 2 task). Repo root: `C:\Projects\ContactEstablished\Chorus`. Expected branch `main` — confirm with `git branch --show-current`; do not switch or create branches. Expected HEAD: `6ec674b` ("Task 2-3 review: accept the work, prove the reconcile fix on this machine") or a descendant.

Planning was done by a separate coordinator. Your final summary will be reviewed against the task docs, and **the reviewer WILL re-run your verification independently** — including re-reading the database on the real machine (§11) and re-driving the milestone.

**This task CLOSES PHASE 2.** Its acceptance criteria include the **phase milestone**, which is a materially higher runtime bar than 2-1/2-2/2-3: two writing agents sharing one repo through isolated worktrees, surviving a graceful quit and a restart with uncommitted work intact. The feature you are adding is small — one read-only channel, a pure parser, and a header label. **Budget your session accordingly: roughly a third of the work is the diff summary, and two thirds is proving the phase.**

**This session makes exactly ONE commit.**

## §2 Goal

Give the operator an at-a-glance sense of how much a worktree agent has changed, in the header of a mounted worktree pane.

One **read-only** IPC channel (`worktree:diff-summary`) returns `{filesChanged, insertions, deletions, untracked}`, computed via the 2-1 adapter: `git diff --shortstat HEAD` (tracked changes vs HEAD) through a **pure, total shortstat parser**, plus a porcelain untracked count (`??` lines). The pane header shows the counts, refreshed on an interval **≥15 s AND on focus** — never per-keystroke, never for filmstrip cards. A current-tree (non-worktree) session returns null and shows nothing.

Then you prove the phase milestone.

## §3 Project Context

Architecture: local-first, Windows-only Electron 43.1.1 + Vue 3 + TypeScript + Vite + Pinia app running AI coding-agent CLIs (Claude Code, Codex) as live interactive TUIs in xterm.js panes; PTYs (node-pty / ConPTY) live in the MAIN process owned by `SessionManager`; the renderer is a pure view attaching by session id over typed IPC; `contextIsolation: true`, `nodeIntegration: false`. SQLite via better-sqlite3 (WAL) at `%APPDATA%\chorus\chorus.db`; Drizzle for typed queries ONLY — migrations are a hand-rolled `MIGRATIONS` array + `schema_migrations` runner (D7).

Dev machine: Windows 11, PowerShell 7, **Node 22.14.0, git 2.50.0.windows.1** (re-verified 2026-07-21). CLIs: `claude.exe`, `codex-cli` (npm `.cmd` shim). **Claude Code's auth state has been inconsistent across sessions.** This task needs agents that RUN and files that CHANGE, not agents that answer prompts — **prefer Codex, or make edits on disk directly.** The diff summary does not care who wrote the bytes.

Environment quirks — all expected, none a bug you caused:

- **(a)** OS toasts disabled system-wide (registry `ToastEnabled=0`); exit-toast logs `[notify] toast shown:` then `[notify] toast failed:` — the log line is the pass signal.
- **(b)** Codex TUI first-run prompts — update prompt (press **2 to Skip, never 1**), possible directory-trust prompt, `TERM is set to "dumb"` `[y/N]`.
- **(c)** `node-pty` logs `AttachConsole failed` on PTY teardown. Pre-existing noise.
- **(d)** The automation harness strips `ComSpec` and modifies PATH — restore before launching:
  `$env:ComSpec = "$env:SystemRoot\System32\cmd.exe"` and
  `$env:PATH = "$((Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment').Path);$((Get-ItemProperty 'HKCU:\Environment').Path)"`.
- **(e)** `TaskStop` kills only the wrapper shell. To stop the app, find the root node process (`Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*electron-vite*dev*' }`) and `taskkill /PID <pid> /T /F`, then confirm port 9222 is free. **`electron-vite` does NOT hot-restart the main process on `src/main` edits (renderer HMR only) — every main-process change needs a real tree-kill cold boot.**
- **(f)** Launch the app as: restore ComSpec/PATH, then `node node_modules/electron-vite/bin/electron-vite.js dev -- --remote-debugging-port=9222` from the repo root.
- **(g) ⚠ MILESTONE-CRITICAL:** orphan checks **cannot** grep `tasklist` for claude/codex — many unrelated `claude.exe` run on this machine. **Walk the descendant tree of the electron main PID.** The graceful-quit test is `taskkill` on the electron-main PID **WITHOUT** `/F`; the force cleanup is `/T /F`.
- **(h)** Verification driver: **CDP** on `--remote-debugging-port=9222` (`Runtime.evaluate` in IIFEs — top-level `const` collides across evaluates; `Page.captureScreenshot`; `Input.insertText`); install `ws` in the session scratchpad, **never the repo**. `ELECTRON_RUN_AS_NODE=1` scripts print nothing to a PowerShell console — write results to a file.
- **(i) The `sqlite3` CLI is NOT installed** (verified 2026-07-21 — `where.exe sqlite3` finds nothing). DB inspection = a script requiring better-sqlite3 **by absolute repo path**, run via `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe dump.js out.json`. **Known flake: intermittently writes no file on the first invocation with no error — retry once.** `_verify/` is now **gitignored** (`.gitignore:165`), so its artifacts can no longer be committed by accident; read `_verify/2-1-dump.js` for the dump pattern. Completed task docs older than 2026-07-21 (`Task-1b-1.md`, `Task-1b-2.md`, `Task-2-1.md`, `Task-2-2.md`, `ImplementationSpec-1b-1.md`) still show a wrong `sqlite3 …` invocation — **do not copy a command out of them.**

### Dev-machine baseline — coordinator-verified 2026-07-21, do NOT "clean up"

- Migrations **1, 2, 3, 4** (v4 `applied_at` 2026-07-20T16:57:49.534Z, untouched). `foreign_keys` pragma reads **1**.
- Projects: **`985d547b-d152-4a07-9094-ddb8da56ef8f` = "Chorus"**, root `C:\Projects\ContactEstablished\Chorus`. **`f47ac10b-58cc-4372-a567-0e02b2c3d479` = "Chorus-Second"**, root **`C:\Projects\ContactEstablished`** — the PARENT directory (**F22**; the docs long claimed `…\Chorus-Second`, which was never true). That parent is **not a git repo**, so it is the natural "not a git repo" test case and contributes nothing to reconcile.
- Sessions: one `running` claude + one `exited` codex, both `worktree_id` NULL.
- **`worktrees` holds ONE row:** `9ba9b0da…`, `status='detached'`, `session_id NULL`, branch `chorus/Chorus/24b5c1fe`, **`base_branch ''`**, project `985d547b…`.
- `git worktree list` shows the main tree plus `C:\Projects\ContactEstablished\.chorus\Chorus\wt-24b5c1fe`.
- **⚠ That row+worktree is the coordinator's F19 verification fixture, adopted by the app's own reconcile — not hand-written. RETAIN IT.** Its **empty `base_branch`** is exactly the shape that breaks a naive `rev-list`/`diff` call, so it is your free regression fixture for the empty-ref guard (§7). Do not remove it to tidy up.
- Leftover `chorus/*` branches with no worktree — normal under D26 Q4's no-auto-delete default, leave them: `39b6f2fe`, `605843db`, `ca1eff01`, `cc30c7be`.

## §4 Ground Yourself First (Read BEFORE Editing)

Docs, in this order:

- `CLAUDE.md` — locked rules (sessions in main; Zod in main only; D14 plain-object IPC payloads; verify git flags at execution — D4; no new deps).
- `docs/Features/Foundation/roadmap.md` — §5 Verified Ground Facts (**especially F12, F17, F18, F20, F21, F22**); §6 decisions D22–D27; §7 the Phase 2 milestone.
- `docs/Features/Foundation/Tasks/Phase-2-Overview.md` — phase shape, file-ownership matrix, **Phase-Level Acceptance Criteria** (the last box is your milestone).
- `docs/Features/Foundation/Tasks/Task-2-4.md` — **THE task contract. Scope, non-goals, acceptance criteria. THIS GOVERNS.**
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-2-4.md` — parser, schemas, handler, poll shape. Follow it **except** its §4 handler sketch, which is stale — see the ⚠ below.
- `docs/Features/Foundation/Tasks/Task-2-3-CompletionSummary.md` — what 2-3 shipped and its notes for you.

### ⚠ THE ONE CORRECTION THAT MATTERS MOST

**`ImplementationSpec-2-4.md` §4's handler sketch resolves the worktree via `row.worktreeId` — the SESSION-side pointer. That is WRONG and the spec's own ⚠ block says so.** F18 was resolved as **(a)** in Task 2-2: the authoritative link is `worktrees.session_id`, and a crash-window promote (or a re-own) leaves `sessions.worktree_id` NULL or stale while the row-side pointer is correct. A pane in that state would silently report "no worktree" and show no counts, while its branch label renders fine — the two would disagree.

**Task 2-3 already built the shared resolver. Use it verbatim:**

```ts
// src/main/ipc.ts:120 — added by 2-3, already in scope for you to call
function worktreeForSession(sessionId: string, projectId: string): WorktreeRow | null {
  return storage.getWorktreesForProject(projectId).find((w) => w.sessionId === sessionId) ?? null
}
function branchForSession(sessionId: string, projectId: string): string | null {
  return worktreeForSession(sessionId, projectId)?.branch ?? null
}
```

Your handler resolves the session row for its `projectId`, then calls `worktreeForSession(sessionId, row.projectId)`. **The branch label and the diff summary must never disagree about whether a session is in a worktree.**

### Code state — verified 2026-07-21 at `6ec674b`; trust this over any older doc line

- `npm run typecheck` exits 0. `npx vitest run` = **132/132 across 7 files**: `src/shared/ipc.test.ts` (43), `src/shared/layout.test.ts` (26), `src/main/services/worktrees.test.ts` (30), `src/renderer/src/palette/commands.test.ts` (17), `src/main/services/restore.test.ts` (6), `src/renderer/src/stores/layout.test.ts` (5), `src/renderer/src/stores/view.test.ts` (5).
- **`src/main/services/git.ts` — YOURS TO EXTEND** (2-1 created it; 2-3 added `branchDelete`; the shortstat parser is the last planned edit). Private `runGit(cwd, args)` at line ~39 over promisified `execFile` (**argument arrays only, never a shell**). Exports: `GitError` (line 29), `resolveRepoRoot` (56), `GitWorktreeEntry` (65), `parseWorktreePorcelain` (77), `listWorktrees` (120), `worktreeAdd` (126), `worktreeRemove` (139), `worktreePrune` (144), **`branchDelete` (154)**, **`statusPorcelain` (159)**, `currentBranch` (168), `aheadBehind` (174). Add `parseShortstat` + `diffShortstat` alongside these; **reuse `runGit`, do not add a second runner.**
- **`src/main/ipc.ts`** — `registerIpc(sessions, storage, worktrees)`. Helpers: `requireProject`, an F17 path key, **`worktreeForSession` (120)**, `branchForSession` (124). 2-3's worktree handlers (`worktree:list`, `worktree:dirty-files`, `worktree:remove`) are registered around lines 460–555; add yours near them, not interleaved into the session handlers.
- **`src/shared/ipc.ts`** — Task 2-2 and Task 2-3 schemas live under banner comments (`Task 2-2: workspace modes (D22 + D26f)`, and 2-3's worktree block). **Add yours under a `Task 2-4: diff summary` banner** rather than interleaving. The house precedent for a new field is required-nullable (`z.string().nullable()`), never `.optional()`.
- **`src/renderer/src/components/TerminalPane.vue`** — `import { computed, onBeforeUnmount, onMounted, ref } from 'vue'` (line 2). **`const branch = ref<string | null>(null)` (57)**, seeded once from the attach response at line ~156 (`if (branch.value === null && attach.branch !== null) branch.value = attach.branch`) — `branch` being non-null is your "this is a worktree pane" test. `onMounted` at **294**; **`const onTextareaFocus = (): void => emit('focus', props.sessionId)` at 312** — this is the on-focus hook to extend; `onBeforeUnmount` at **383** — clear your interval there. The header's branch span is at **417** (`<span v-if="branch" class="max-w-[12rem] truncate text-xs text-sky-400">`) — render the counts after it. 2-3 added close-flow state and an inline removal offer to this file; do not disturb them.
- **`src/renderer/src/components/WorktreePanel.vue`** (2-3) — MAY call the new channel once per row on open (a one-shot read, never a poll). Optional; skipping it is fine.
- **`src/preload/index.ts`** — Zod-free typed forwarder; `src/preload/index.d.ts` is **never hand-edited** (`ChorusApi` is inferred).

### D4 pre-check already run (re-verify anyway, and report)

On this machine at git 2.50.0.windows.1, inside the fixture worktree:

```
$ git diff --shortstat HEAD
 1 file changed, 1 insertion(+)
$ git status --porcelain
 M README.md
?? _probe_untracked.txt
```

**Note the SINGULAR "insertion(+)"** — the spec's `/(\d+) insertions?\(\+\)/` handles it, but your parser must be total across singular/plural on all three segments, and an empty line must yield all zeros. Untracked detection via `startsWith('??')` is correct against the porcelain shape above.

### Git checks (run first)

```powershell
git branch --show-current   # expect: main
git status --porcelain      # expect: EMPTY (see §5)
git log --oneline -1        # expect: 6ec674b or descendant
git config user.email       # expect: mwilson29072@gmail.com
git worktree list           # expect: main tree + .chorus\Chorus\wt-24b5c1fe
```

## §5 Pre-existing Changes Warning

**The working tree is CLEAN as of `6ec674b`.** `_verify/` is now gitignored (`.gitignore:165`), so it no longer appears as untracked — you may freely add harness artifacts there and they cannot be committed by accident.

If `git status --porcelain` shows anything at session start, **stop and ask**. Your commit contains only files you changed for this task. Do not revert, stage, or commit anything under `docs/`.

## §6 Resolved Decisions and Findings That Bind This Task

Quote; do not relitigate. All Phase 2 decisions are RESOLVED; the council checkpoint **G5 is CLOSED as D26**.

- **D1** (locked): all Zod validation in main only — preload and renderer stay Zod-free (page CSP forbids the eval Zod compiles parsers with).
- **D3** (locked): sessions live in main; the renderer never spawns processes.
- **D4** (locked): verify git flags against the installed git 2.50's own `-h`/`--help` at execution. Relevant: `git diff --shortstat`. Report what you saw.
- **D14** (locked): renderer→main IPC payloads must be plain objects.
- **D22/D23/D26** (RESOLVED 2026-07-20): the worktree lifecycle contract. 2-4 **reads only** — it creates, removes, and modifies nothing.
- **D25** (RESOLVED): F14 stays deferred — Phase 2 adds no restart driver; **do not change restart events.**
- **F12 — debounce discipline (THE cadence rule for this task).** Live/twitchy sources must not drive per-keystroke or per-second IPC. The diff poll is bounded to **one interval ≥15 s per MOUNTED worktree pane, plus an on-focus refresh**, cleared on unmount. In **filmstrip** mode only the focused pane is mounted, so this collapses to focused-only. In **grid** mode each visible worktree pane polls its own interval — bounded by the 16-pane cap. **Filmstrip cards never poll** (they are not `TerminalPane`s). The 1b-2 one-shared-clock elapsed ticker is the style precedent.
- **F17: path + porcelain quirks.** `git worktree list --porcelain` emits forward-slash paths while rows store backslash paths, and Windows paths are case-insensitive — every path comparison goes through a normalization key (`worktrees.ts::pathKey`).
- **F18 RESOLVED as (a)** — see the ⚠ in §4. **This is the single most important correction in this prompt.**
- **⚠ Adopted rows carry `base_branch ''`** (population-4 adoptions have unknowable bases; the column is NOT NULL). **An empty ref makes `rev-list`/`diff` fail.** 2-3's `aheadBehind` guard is the reference idiom. Your diff call targets `HEAD` rather than `base_branch`, so it is likely unaffected — **but the fixture row in §3 has an empty `base_branch`, so verify rather than assume**, and render `—`/nothing rather than throwing.
- **F20 — KNOWN ENVIRONMENT CONDITION, stated as fact, not suspicion.** Execution sessions here run with a **REDIRECTED `AppData` but a REAL `C:\Projects`**. `$APPDATA` prints the correct string because the redirection is at the storage layer, not the variable. **Consequences: (1) your filesystem/git evidence is trustworthy; (2) your DATABASE evidence may describe a different DB and the coordinator WILL re-verify it against the real `%APPDATA%\chorus\chorus.db`; (3) this is an environment artifact — no dishonesty is implied, and saying "my dump shows X" is not a mark against you.** Presenting a redirected dump as this machine's *without* flagging it is the only thing that counts against you. **Dump the `projects` table in every DB dump and quote the ids** (§11).
- **F21 — EXPLICITLY NOT YOUR SCOPE.** `worktree:remove` computes `forceBranch` from `confirmation === w.path` outside the dirty branch, so main would `-D` an unmerged branch on a clean worktree if such a request arrived. It is unreachable through the shipped UI and is recorded as a deferred, separately-designed fix. **Do not "fix" it while adding the diff summary** — it is a gated-UX decision, not a code cleanup.
- **F22** — Chorus-Second's `root_path` is `C:\Projects\ContactEstablished` (the parent), which is not a git repo. Use it as the current-tree / non-worktree test case.

## §7 Implementation Scope

Follow the Exact Scope table in `Task-2-4.md` and `ImplementationSpec-2-4.md` §§2–6.

| File | Change |
|------|--------|
| `src/main/services/git.ts` | Add **`parseShortstat(line)`** — pure, total, exported for unit test — and **`diffShortstat(worktreePath)`** (`git diff --shortstat HEAD`, cwd = the worktree). **Reuse the private `runGit`**; add no second runner and touch no existing function. |
| `src/shared/ipc.ts` | Under a `Task 2-4` banner: `WorktreeDiffSummary: 'worktree:diff-summary'`; `worktreeDiffRequestSchema` = `{sessionId: z.uuid()}`; `worktreeDiffSummarySchema` = `{filesChanged, insertions, deletions, untracked}` (all `z.number().int()`); `worktreeDiffResponseSchema` = the summary **`.nullable()`**. |
| `src/main/ipc.ts` | The `worktree:diff-summary` handler. Resolve the session row → **`worktreeForSession(sessionId, row.projectId)`** (§4 ⚠ — NOT `row.worktreeId`); null row / null worktree / missing directory ⇒ return `null`; else `diffShortstat` + `statusPorcelain` filtered to `??`; outbound-parse. **Read-only.** |
| `src/preload/index.ts` | `getWorktreeDiffSummary(sessionId)` forwarder. Zod-free. |
| `src/renderer/src/components/TerminalPane.vue` | Header counts after the branch span (line ~417); one `setInterval` ≥15 s started in `onMounted` **only when `branch.value` is non-null**; extend `onTextareaFocus` (line 312) to also refresh; `clearInterval` in `onBeforeUnmount` (line 383). |
| `src/shared/ipc.test.ts` | Schema cases + the `parseShortstat` table (see §10). |

**Optional:** `WorktreePanel.vue` may call the channel once per row on open — a one-shot read, never a poll. Skipping it is fine and is the safer default.

**Explicitly do NOT touch:** `src/main/services/worktrees.ts`, `src/main/services/storage.ts`, `src/main/db/schema.ts` (**no schema change, no migration v5**), `src/main/index.ts`, `src/renderer/src/App.vue`, `src/renderer/src/components/LaunchDialog.vue`, `src/renderer/src/palette/commands.ts`, `src/renderer/src/stores/*`, `src/preload/index.d.ts`. If a change seems to require another file, **raise it and justify it loudly in the summary.**

### Key invariants

- **The channel is READ-ONLY.** No staging, no commit, no merge, no branch change, no removal, **no `--force`**. Never auto-merge.
- **`parseShortstat` is pure and total** — singular and plural on all three segments, missing segments default to 0, empty string ⇒ `{0,0,0}`. It never throws.
- **One interval per mounted worktree pane, ≥15 s, cleared on unmount.** Plus an on-focus refresh reusing the same fetch. No per-card timer, no per-keystroke fetch.
- **A non-worktree session never polls at all** (`branch.value === null` ⇒ no interval is ever created) and shows no counts.
- Worktree resolution goes through `worktreeForSession` (F18a) — identical to the branch label.
- All Zod in main; payloads plain (D14); no new npm dependencies.

## §8 Strict Non-Goals

- **No per-keystroke or per-frame polling**; no timer on filmstrip cards; no timer on non-worktree panes.
- **No per-file diff, no diff viewer, no patch preview** — shortstat counts only (rich diff is a v1-horizon exclusion).
- **No writes of any kind** from the diff path — no stage, commit, merge, branch change, removal. **Never auto-merge.**
- **No `--force` anywhere.** 2-3's single gated dirty-removal path remains the only site; you add no caller.
- **No F21 fix** (§6) — deferred by design.
- **No schema change / no migration v5.**
- **No restart-driver or restart-event change** (D25/F14).
- **No new npm dependency.**
- **Do not delete the `wt-24b5c1fe` fixture worktree or its DB row** (§3) — it is a retained regression fixture.
- **Do not revert, stage, or commit unrelated files, including anything under `docs/`.**

## §9 Required Workflow

1. **Ground per §4** — especially the F18(a) correction.
2. **Implement bottom-up:** `parseShortstat` + its unit tests FIRST (pure, no app needed) → `diffShortstat` → schemas → handler → preload → TerminalPane. **Run `npm run typecheck` + `npx vitest run` after the parser and schema layer** before touching the component.
3. **Self-review the diff** against `CLAUDE.md`, D1/D3/D4/D14/D25, F12/F17/F18/F21, and the `Task-2-4.md` Review Checklist.
4. **Run verification (§10)** — static, then the feature runtime script, then **the phase milestone**. The milestone is not optional and is not satisfied by the feature script.
5. **ONE intentional commit**, in the style of `94f062c` / `6dfd146`: a plain-English paragraph a non-technical reader can follow, then a `Technical notes:` bullet list. State: the **D4 flag-verification outcome**, that worktree resolution went through `worktreeForSession` (F18a), the observed poll cadence, and any deviation. **Because this closes the phase, also state the milestone result in the commit message.** Verify `git config user.email` = `mwilson29072@gmail.com`. End with the `Co-Authored-By:` trailer naming the model that did the work. **Do not push, do not open a PR, do not amend or rebase existing commits.**

## §10 Verification Commands

```powershell
npm run typecheck          # zero errors (G1)
npx vitest run             # green — 132 existing + your new cases
git diff --shortstat -h    # D4 flag verification
git --version              # 2.50.0.windows.1
# sample the real shapes the parser consumes (inside a worktree):
git -C "C:\Projects\ContactEstablished\.chorus\Chorus\wt-24b5c1fe" diff --shortstat HEAD
git -C "C:\Projects\ContactEstablished\.chorus\Chorus\wt-24b5c1fe" status --porcelain
# app launch: restore ComSpec/PATH (see §3d), then
node node_modules/electron-vite/bin/electron-vite.js dev -- --remote-debugging-port=9222
```

### New unit tests

`src/shared/ipc.test.ts` — `worktreeDiffRequestSchema` requires a uuid `sessionId`; `worktreeDiffSummarySchema` accepts an all-int summary and **rejects a float**; `worktreeDiffResponseSchema` accepts `null`. **`parseShortstat` table:**

| Input | Expected |
|---|---|
| `" 3 files changed, 12 insertions(+), 4 deletions(-)"` | `{3, 12, 4}` |
| `" 1 file changed, 2 insertions(+)"` | `{1, 2, 0}` |
| `" 1 file changed, 1 insertion(+)"` (singular — the real observed shape) | `{1, 1, 0}` |
| `" 2 files changed, 5 deletions(-)"` | `{2, 0, 5}` |
| `" 1 file changed, 1 deletion(-)"` | `{1, 0, 1}` |
| `""` | `{0, 0, 0}` |
| garbage (`"not a shortstat"`) | `{0, 0, 0}` — total, never throws |

### RUN the app, don't just compile (G2) — feature script

Screenshot each step. Cold-boot after every main-process edit (§3e).

1. Launch a **new-worktree** session (the 2-2 flow). The header shows the branch; counts render as zeros or are hidden per your render guard.
2. **Edit a tracked file** in that worktree (on disk is fine) → within ≤15 s, or immediately on refocusing the pane, the header shows `1f +N −M`. **Add an untracked file** → the untracked marker appears. Cross-check the numbers against `git -C <worktree> diff --shortstat HEAD` run by hand.
3. **Cadence proof (F12).** Instrument or observe main-process git invocations over a ~60 s window with one worktree pane focused: expect **~4 poll cycles** (one `git diff` + one `git status` each), **none** per keystroke — type continuously into the TUI for 15 s and show the count does not rise with keystrokes.
4. **No poll when unfocused / non-worktree.** In filmstrip mode confirm only the mounted focused pane polls and cards do not. Launch a **current-tree** session (or use the Chorus-Second project, §3/F22) → **no counts render and no interval is created.**
5. **Unmount cleanup.** Close a worktree pane and confirm its interval is gone (no further git calls attributable to it).
6. **Empty-`base_branch` fixture.** Open the WorktreePanel with the retained `wt-24b5c1fe` row present (its `base_branch` is `''`) and confirm nothing throws and ahead/behind still renders `—`.

### THE PHASE MILESTONE (headline G2 — this closes Phase 2)

7. **Two writing agents, one repo, isolated worktrees.** Launch agent A into a new worktree; with A live, launch agent B — the dialog must **default to new-worktree** (D26f). Both edit files independently. Confirm: two separate directories under `C:\Projects\ContactEstablished\.chorus\Chorus\`, two separate `chorus/Chorus/<shortId>` branches, **each pane's header showing its OWN diff summary** (they must differ), and `git worktree list` agreeing.
8. **Graceful quit leaves no orphan.** `taskkill` the electron-main PID **WITHOUT `/F`** → walk the **descendant tree** of that PID (never grep `tasklist` for claude/codex — §3g) and confirm **no live PTY survives**.
9. **Restart reconciles and restores.** Relaunch → the boot log's `[worktrees] reconcile:` line appears **BEFORE** the `[restore]` lines; healthy `active`+entry+dir rows report `none` (no spurious healing); **each session is restored into its worktree** (cwd persisted); **the uncommitted edits from step 7 are intact on disk** and reflected in the restored panes' diff summaries.
10. **Final cross-check:** `git worktree list`, the `worktrees` table, and the `sessions` table all agree with what is on screen.
11. **Console hygiene** across everything: zero `An object could not be cloned` (D14), zero uncaught errors, zero unhandled rejections.
12. **Read-only grep gate:** the diff path performs no writes. Confirm `--force` still has exactly **one** emission site (`git.ts` `worktreeRemove`) with exactly one caller (2-3's gated path), and that you added **no** new caller. Report the grep and its hit count.

## §11 Failure Honesty Clause

Capture exact output on any failure, explain it, report it. **Never claim success you did not directly observe.**

**Verification-provenance rule (enforced — see F20 in §6):** your **filesystem and git evidence is trustworthy**; your **database evidence may describe a different DB**, and the coordinator **will** re-verify it against the real `%APPDATA%\chorus\chorus.db` (projects `985d547b-d152-4a07-9094-ddb8da56ef8f` = Chorus, `f47ac10b-58cc-4372-a567-0e02b2c3d479` = Chorus-Second). **Dump the `projects` table alongside every DB dump and quote the ids you actually saw.** If they do not match, say so plainly and prominently — that is a useful signal, not a failure on your part.

**Specifically may NOT be reported as success:**
- a count you did not cross-check against `git diff --shortstat HEAD` run by hand;
- a cadence claim you did not measure over a real window with real keystrokes;
- a "does not poll" claim for unfocused/non-worktree panes that you inferred from code rather than observed;
- **a milestone step you did not perform** — in particular a graceful quit you did not do **without `/F`**, or an orphan check you did based on `tasklist` name-matching rather than the descendant tree;
- a restore-into-worktree you did not confirm from a cold boot log **plus** the surviving uncommitted edits.

**If the milestone fails, that is a legitimate and valuable outcome — report `DONE_WITH_CONCERNS` or `BLOCKED` with the exact evidence.** A truthfully-failed milestone is worth far more than a claimed one; Phase 2 cannot close on an unverified milestone, and the coordinator will re-run it.

Known environment conditions are **not** failures — note them and move on: the dump-script first-run flake (§3i), Codex first-run prompts (§3b), `AttachConsole failed` teardown noise (§3c), disabled OS toasts (§3a), Claude Code auth state.

## §12 Final Reporting Requirements

Write a detailed summary for coordinator review containing:

- **Status:** DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
- **Commit SHA** + one-line description.
- **Environment statement** — confirm the runtime evidence came from this machine's dev DB (**quote the project ids you saw**), or state plainly that it did not (§11).
- **D4 flag-verification report** — what `git diff --shortstat` actually printed, including the singular/plural forms you exercised.
- **F18(a) confirmation** — state explicitly that worktree resolution went through `worktreeForSession` (row-side), not `sessions.worktree_id`, and how you know (ideally: a probe with the session-side pointer NULLed while the row-side stands, showing the counts still render).
- **Cadence evidence** — the measured git-invocation count over your observation window, with keystroke activity, and the unfocused/non-worktree zero-poll observation.
- **Files changed** — one-line rationale each; anything beyond §7's table flagged loudly with justification.
- **Deviations** from `ImplementationSpec-2-4.md`, with why. (Its §4 sketch is known-stale — following the §4 ⚠ correction instead is expected, not a deviation.)
- **Verification transcript** — typecheck; vitest with new test names and total count; feature items 1–6 and **milestone items 7–12** individually with what was actually observed (screenshots/dumps by filename).
- **`--force` grep gate** result with hit counts.
- **PHASE MILESTONE VERDICT** — a plain statement of whether two writing agents safely shared one repo via isolated worktrees, survived a graceful quit with no orphaned PTY, and restarted with reconcile-before-restore and uncommitted work intact. **This is the sentence Phase 2 closes on. Do not soften it if it did not fully hold.**
- **End-state declaration** — final `git worktree list`, the full `worktrees` table, and the `chorus/*` branch list. **Confirm the `wt-24b5c1fe` fixture and its row still exist** (§8).
- **Acceptance criteria** from `Task-2-4.md` restated pass/fail, **plus** the Phase-Level Acceptance Criteria in `Phase-2-Overview.md` — this task closes the phase, so report on all of them.
- **Non-goals confirmation** — each §8 item untouched.
- **Residual risks / notes for Phase 3** — anything the next phase should know, including whether F21 remains open.
- **Final git output**, fenced: `git status --porcelain` and `git log --oneline -3`.
