# Chorus Phase 2, Task 2-2 Execution Prompt — Workspace Modes + Auto-Worktree Launch Flow

_Generated 2026-07-20 against HEAD `dc93330`. Ground facts in §4 verified at that commit; typecheck clean and 114/114 vitest passing at generation time._

## §1 Role

You are the implementation engineer for Chorus Phase 2, Task 2-2 (workspace modes + auto-worktree launch flow — the second of four Phase 2 tasks). Repo root: `C:\Projects\ContactEstablished\Chorus`. Expected branch `main` — confirm with `git branch --show-current`; do not switch or create branches. Expected HEAD: `dc93330` ("Task 2-1 review: verify the migration for real, correct the database facts") or a descendant. Planning was done by a separate coordinator; your final summary will be reviewed against the task docs, and the reviewer WILL re-run your verification independently. **This session makes ONE commit** — unlike Task 2-1, there is no chore commit (the F15 CSS fix already landed as `624f3da`).

## §2 Goal

Ship the three D22 workspace modes on the launch path. `session:launch-context` grows repo context computed in main — the resolved repo root, the count of other LIVE sessions in that repo, a suggested mode, and the list of pickable retained/active-unowned worktrees — so the dialog defaults correctly and can offer the existing-worktree picker. `launchRequestSchema` grows an explicit `workspace_mode` (+ optional `worktree_id`). `session:launch` executes the chosen mode: new-worktree creates a DB-first-journaled worktree (via Task 2-1's `GitWorktreeManager`) and spawns with cwd = the worktree path, writing both pointers transactionally; existing-worktree re-owns an attachable worktree; current-tree is today's behavior. The pane header and filmstrip cards gain a branch label. **The mode always travels explicitly in the payload; main validates but never silently overrides.** This is the first task that actually CREATES worktrees.

## §3 Project Context

Architecture: local-first, Windows-only Electron 43.1.1 + Vue 3 + TypeScript + Vite + Pinia app running AI coding-agent CLIs (Claude Code, Codex) as live interactive TUIs in xterm.js panes; PTYs (node-pty / ConPTY) live in the MAIN process owned by `SessionManager`; renderer is a pure view attaching by session id over typed IPC; `contextIsolation: true`, `nodeIntegration: false`. SQLite via better-sqlite3 (WAL) at `%APPDATA%\chorus\chorus.db`; Drizzle for typed queries ONLY — migrations are a hand-rolled `MIGRATIONS` array + `schema_migrations` runner (D7).

Dev machine: Windows 11, PowerShell 7, Node 22.14.0, git 2.50.0.windows.1. CLIs: `claude.exe` 2.1.215, `codex-cli` 0.144.6 (npm `.cmd` shim). Claude Code's auth state has been inconsistent across sessions ("token has expired" was observed 2026-07-19; a later session showed an authenticated Claude Max banner) — **this task needs sessions that are RUNNING, not sessions that answer prompts**, so auth state does not block any verification here. Use whichever CLI launches.

Environment quirks — all expected, none a bug the implementer caused:

- (a) OS toasts disabled system-wide (registry `ToastEnabled=0`); exit-toast logs `[notify] toast shown:` then `[notify] toast failed:` — the log line is the pass signal.
- (b) Codex TUI first-run prompts — update prompt (press 2 to Skip, never 1), possible directory-trust prompt, `TERM is set to "dumb"` `[y/N]`.
- (c) `node-pty` logs `AttachConsole failed` on PTY teardown. Pre-existing noise.
- (d) The automation harness strips `ComSpec` and modifies PATH — restore before launching: `$env:ComSpec = "$env:SystemRoot\System32\cmd.exe"` and `$env:PATH = "$((Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment').Path);$((Get-ItemProperty 'HKCU:\Environment').Path)"`.
- (e) `TaskStop` kills only the wrapper shell. To stop the app, find the root node process (`Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*electron-vite*dev*' }`) and `taskkill /PID <pid> /T /F`, then confirm port 9222 is free. **`electron-vite` does NOT hot-restart the main process on `src/main` edits (renderer HMR only) — every main-process change needs a real tree-kill cold boot. Budget for many.**
- (f) Launch the app as: restore ComSpec/PATH, then `node node_modules/electron-vite/bin/electron-vite.js dev -- --remote-debugging-port=9222` from the repo root.
- (g) Orphan checks cannot grep `tasklist` for claude/codex — many unrelated `claude.exe` run on this machine. Walk the descendant tree of the electron main PID instead.
- (h) Verification driver: CDP on `--remote-debugging-port=9222` (`Runtime.evaluate` in IIFEs — top-level `const` collides across evaluates; `Page.captureScreenshot`; `Input.insertText`); install `ws` in the session scratchpad, never the repo. `ELECTRON_RUN_AS_NODE=1` scripts print nothing to a PowerShell console — write results to a file. The `sqlite3` CLI is NOT installed: DB inspection = a script requiring better-sqlite3 by absolute repo path, run via `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe dump.js out.json`. KNOWN FLAKE: intermittently writes no file on first invocation with no error — retry once. `window.confirm` blocks the renderer thread — fire CDP clicks async.
- (i) **Dev DB state, verified 2026-07-20 at `dc93330`** — do NOT clean these up: migrations **1, 2, 3, 4 applied** (v4 landed 2026-07-20T16:57:49Z); tables `projects` / `pane_layouts` / `settings` / `schema_migrations` / `sessions` / `worktrees`; **`worktrees` is EMPTY (0 rows)**; `sessions` has `worktree_id` at cid 8, NULL for both rows. Projects: **`985d547b-d152-4a07-9094-ddb8da56ef8f` = "Chorus"** (root `C:\Projects\ContactEstablished\Chorus`) and **`f47ac10b-58cc-4372-a567-0e02b2c3d479` = "Chorus-Second"** (root `C:\Projects\ContactEstablished\Chorus-Second`). Sessions: `c10c46a6-15c5-410a-8e3c-b46271e94e80` (claude, status `running` — auto-restores at boot) and `a9ff0f7a-192e-4f70-9d79-776ff55bd70a` (codex, `exited`, exit_code `-1073741510`). `view_state:` rows exist for both projects.
- (j) **Git topology for this task:** the Chorus repo root is `C:\Projects\ContactEstablished\Chorus`, current branch **`main`** (the base branch new worktrees will fork from). Per D23/D26h, worktrees will be created at **`C:\Projects\ContactEstablished\.chorus\Chorus\wt-<shortId>`** on branch **`chorus/Chorus/<shortId>`**; that `.chorus` directory **does not exist yet**. **`C:\Projects\ContactEstablished\Chorus-Second` is NOT a git repository** (`git rev-parse` there returns "fatal: not a git repository") — it is therefore the natural test case for the inline "not a git repo" state. Before starting, `git worktree list` shows exactly one entry (the main tree).

## §4 Ground Yourself First (Read BEFORE Editing)

Docs, in this order:

- `CLAUDE.md` — locked rules (sessions in main; Zod in main only; D14 plain-object IPC payloads; verify git/CLI flags at execution — D4; no new deps).
- `docs/Features/Foundation/roadmap.md` — §5 Verified Ground Facts (**especially findings F16, F17, F18**); §6 decisions D22–D27.
- `docs/Features/Foundation/Tasks/Phase-2-Overview.md` — phase shape, file-ownership matrix.
- `docs/Features/Foundation/Tasks/Task-2-2.md` — THE task contract. Scope, non-goals, acceptance criteria. THIS GOVERNS.
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-2-2.md` — exact Zod shapes, handler sketches, dialog markup, invariants. Follow it; note its amended ⚠ blocks (F16 ordering, F18 decision).
- `docs/Features/Foundation/Tasks/Task-2-1-CompletionSummary.md` — what 2-1 shipped, plus the coordinator review addendum.

Code state — verified 2026-07-20 at `dc93330`; trust this over any older doc line:

- `npm run typecheck` exits 0; `npx vitest run` = **114/114 across 7 files** (`src/shared/layout.test.ts`, `src/shared/ipc.test.ts`, `src/main/services/restore.test.ts`, `src/main/services/worktrees.test.ts`, `src/renderer/src/stores/layout.test.ts`, `src/renderer/src/stores/view.test.ts`, `src/renderer/src/palette/commands.test.ts`).
- **`src/main/services/git.ts` (from 2-1) exports:** `GitError` (carries `args`, `code`, `stderr`); `resolveRepoRoot(cwd): Promise<string | null>` (null for non-repos, never throws); `GitWorktreeEntry` interface; `parseWorktreePorcelain(out)` (pure); `listWorktrees(repoRoot)`; `worktreeAdd(repoRoot, path, branch, baseBranch)`; `worktreeRemove(repoRoot, path, force = false)`; `worktreePrune(repoRoot)`; `statusPorcelain(worktreePath): Promise<string[]>`; `currentBranch(repoRoot): Promise<string>`; `aheadBehind(repoRoot, branch, baseBranch)`. All run through one private `runGit` over promisified `execFile` (argument arrays only, never a shell). **`--force` is emitted only when `worktreeRemove`'s flag is set, and that flag has ZERO callers — 2-2 must not add one** (its only legal caller is 2-3's typed-confirmation path, D26(i)).
- **`src/main/services/worktrees.ts` (from 2-1) exports:** `shortIdFrom(uuid)` (first 8 hex chars); `worktreeRootFor(repoRoot)`; `worktreePathFor(repoRoot, shortId)`; `branchFor(repoRoot, shortId)`; the pure `computeWorktreeReconcile(repoRoot, rows, gitEntries, managedDirs, sessionRowIds)`; and class `GitWorktreeManager` with `createWorktree(sessionId, repoRoot, baseBranch): Promise<WorktreeRow>` (DB-first journal; **requires the sessions row to already exist**, throws `createWorktree: unknown session <id>` otherwise; returns the row at status `provisioning`; deletes its own journal row on every failure path; retries up to 5 times with a fresh short id on a path/branch collision), `removeWorktree(worktreeId, {deleteBranch?, forceDirty?})` (**throws if `deleteBranch` is set — that is 2-3 scope; do not call it in 2-2**), `isClean(path)`, `getDirtyFiles(path)`, `list(projectId)`, `reconcileAll()`.
- **`src/main/services/storage.ts` worktree accessors (from 2-1):** `createWorktreeRow`, `getWorktreesForProject(projectId)`, `getAllWorktrees()`, `getWorktreeById(id)`, `updateWorktreeStatus(id, status)`, **`activateWorktreeForSession(worktreeId, sessionId, worktreePath)`** (ONE transaction: sets `worktrees.session_id` + `status='active'` AND `sessions.worktree_id` + `sessions.cwd` = the worktree path — resolution (a)), **`detachWorktree(worktreeId)`** (ONE transaction, clears both pointers, status `detached`), `deleteWorktreeRow(id)`. `createSession` now null-coalesces `worktreeId`.
- **`src/main/index.ts`:** the `whenReady` callback is `async`; a `GitWorktreeManager` is constructed immediately after `sessions.bindStorage(storage)` and `await worktrees.reconcileAll()` runs (inside try/catch) BEFORE `void sessions.restore(project.id)`. **The manager instance currently lives only in that callback — 2-2 needs it inside `registerIpc`, so thread it through `registerIpc(sessions, storage, worktrees)` (a signature change this task owns) rather than constructing a second one.** (Construction already precedes the `registerIpc` call, so no reordering is needed.)
- **`src/main/ipc.ts`:** `registerIpc(sessions, storage)` with the `requireProject` FK-check helper. `session:launch` validates cwd (absolute + exists — the main-side security boundary), enforces the 16-pane soft cap via `collectSessionIds`, `storage.createSession(...)`, `sessions.launch(agent, cwd, row.id)`, `storage.pushRecentCwd(cwd)`, returns `{...snap, title: row.title}`. `session:launch-context` is currently **synchronous** and returns `{projectRoot: p.rootPath, recentCwds}` outbound-parsed. `layout:get` returns `{layout, sessions}` mapped from `storage.getSessionsForProject`.
- **`src/shared/ipc.ts`:** `launchRequestSchema` = `{project_id, agent, cwd}`; `launchContextResponseSchema` = `{projectRoot, recentCwds}`; `sessionInfoSchema` = `{id, agent, status, title, createdAt, exitCode}`; `attachResponseSchema` = `{sessionId, buffer, status, exitCode, cwdMissing?, restorePending?, restored?, title}`. The 1b-1 precedent for a new field is **required-nullable** (`z.string().nullable()`), NOT `.optional()`.
- **`src/preload/index.ts`:** a Zod-free typed forwarder. `launch(request)` and `getLaunchContext(projectId)` already forward whole request/response objects, so **no preload signature change is required** for this task — the grown types flow through `ChorusApi` automatically.
- **`src/renderer/src/components/LaunchDialog.vue`:** `onMounted` awaits `Promise.all([detectClis(), getLaunchContext(projectId)])`, builds agent cards, defaults `cwd` to `ctx.projectRoot`, offers recent-cwd chips, submits via `window.chorus.launch({project_id, agent, cwd})`, renders `{ok:false}` reasons inline, and has an Esc/Tab focus trap.
- **`src/renderer/src/components/TerminalPane.vue`:** header renders status dot + agent label + nullable title (`max-w-[16rem] truncate` + `:title` tooltip) + restore badge. No branch label today. It seeds `title` from the attach response.
- Renderer components: `LayoutRenderer.vue`, `FilmstripRenderer.vue`, `TerminalPane.vue`, `LaunchDialog.vue`, `EmptyState.vue`, `ProjectTabs.vue`, `CommandPalette.vue`; `palette/commands.ts`. Stores: `layout.ts`, `view.ts`, `project.ts`, `session.ts`.

Git checks (run first):

```powershell
git branch --show-current   # expect: main
git status --porcelain      # expect: ONLY "?? _verify/"
git log --oneline -1        # expect: dc93330 or descendant
git config user.email       # expect: mwilson29072@gmail.com
git worktree list           # expect: exactly one entry (the main tree)
```

## §5 Pre-existing Changes Warning

The working tree holds exactly one untracked entry: `_verify/` — accumulated runtime-harness artifacts from previous tasks (screenshots, CDP scripts, DB dumps), deliberately uncommitted. Do not read it into scope, revert, stage, commit, or delete it. If `git status --porcelain` shows anything ELSE, stop and ask. Your commit contains only files you changed for this task.

## §6 Resolved Decisions and Findings That Bind This Task

Quote; do not relitigate:

- **D1** (locked): all Zod validation in main only — preload and renderer stay Zod-free (page CSP forbids the eval Zod compiles parsers with).
- **D3** (locked): sessions live in main; the renderer never spawns processes.
- **D4** (locked): verify git flags against the installed git 2.50's own `-h`/`--help` at execution, never model memory.
- **D14** (locked): renderer→main IPC payloads must be plain objects; snapshot anything store-sourced.
- **D22** (RESOLVED 2026-07-20): three workspace modes ship — current working tree (default for a lone agent), new isolated worktree (dialog DEFAULT when ≥1 other live session's cwd resolves to the same repo root), existing worktree (picker over retained worktrees). **Read-only is deferred** to Phase 3+. The mode is **always explicit in the launch payload; main never silently overrides**.
- **D23 + D26(h)** (RESOLVED 2026-07-20): worktrees at `<repo-parent>\.chorus\<repo-name>\wt-<shortId>`; branches `chorus/<repo-name>/<shortId>`; shortId = first 8 hex chars of the WORKTREE row UUID. The derivation helpers already exist in `worktrees.ts` — **use them, do not re-implement**.
- **D26(a)** (RESOLVED): both pointer columns move in ONE synchronous transaction — `activateWorktreeForSession` / `detachWorktree` already encapsulate this. `worktrees.session_id` is authoritative.
- **D26(f)** (RESOLVED): the auto-worktree trigger is precisely — the dialog's mode DEFAULT flips to new-worktree when ≥1 other LIVE session's cwd resolves to the same repo root, computed in main and delivered via `session:launch-context`. Main computes the SUGGESTION and VALIDATES the choice; it never silently creates a worktree the user did not pick. (This supersedes council findings action 4's "main auto-creates" phrasing.)
- **D26(i)** (RESOLVED): `--force` reaches git ONLY inside 2-3's typed-confirmation dirty-removal path. **2-2 adds no removal path at all.**
- **D25** (RESOLVED): F14 stays deferred — Phase 2 adds no restart driver; do not change restart events.
- **F16 (HARD, corrected 2026-07-20): SQLite FOREIGN KEYS ARE ENFORCED.** better-sqlite3 12.11.1 sets `PRAGMA foreign_keys=ON` per connection, so `worktrees.project_id` and `worktrees.session_id` are real constraints (deleting a referenced parent throws — RESTRICT). Consequences you must respect: `createWorktree` requires the sessions row to already exist, so **row-before-worktree ordering is mandatory, not stylistic**; the new-worktree failure path's `storage.deleteSession(row.id)` is safe only because `createWorktree` deletes its own journal row on every failure branch — **do not reorder those**.
- **F17: path + porcelain quirks.** `git worktree list --porcelain` emits forward-slash paths while rows store `join()`-produced backslash paths, and Windows paths are case-insensitive — every path comparison must go through a normalization key (`win32.normalize(p).toLowerCase()`; `worktrees.ts`'s internal `pathKey` is the reference). `resolveRepoRoot` returns git's forward-slash form.
- **F18 (DECIDE AT EXECUTION, state the choice in your commit): crash-window pointer asymmetry.** `sessions.worktree_id` is written only by `activateWorktreeForSession`. A crash between `git worktree add` succeeding and activation leaves `worktrees.session_id` set but `sessions.worktree_id` NULL; the boot reconcile promotes the worktree row but does not write the session side. Because the branch label resolves from the session side, such a pane would render with no branch (and, after 2-4, no diff summary) despite living in a worktree. Choose: **(a) resolve the branch from the `worktrees` table by `session_id` rather than via `sessions.worktree_id` (recommended — read-path fix, no reconcile change), or (b) have reconcile's promote repair the session pointer.** Whatever you choose, Task 2-4's diff summary must use the identical resolution path.

## §7 Implementation Scope

Follow the Exact Scope table in `Task-2-2.md` and ImplementationSpec-2-2 §§2–7. Files: EDIT `src/shared/ipc.ts`, `src/main/ipc.ts`, `src/main/index.ts` (thread the manager into `registerIpc`), `src/renderer/src/components/LaunchDialog.vue`, `src/renderer/src/components/TerminalPane.vue`, `src/shared/ipc.test.ts`. Explicitly do NOT touch: `src/main/services/git.ts`, `src/main/services/worktrees.ts` (consume them; if you believe one needs a change, raise it and justify it loudly in the summary), `src/main/services/storage.ts` (its accessors already exist), `src/main/db/schema.ts` (no schema change in 2-2), `src/renderer/src/stores/*`, other renderer components.

| File | Change |
|------|--------|
| `src/shared/ipc.ts` | `workspaceModeSchema = z.enum(['current-tree','new-worktree','existing-worktree'])`; `pickableWorktreeSchema` (id, branch, path, status); grow `launchRequestSchema` with `workspace_mode` + optional `worktree_id` (`z.uuid().optional()` — required-when-existing enforced in MAIN, not by schema branching); grow `launchContextResponseSchema` with `repoRoot: z.string().nullable()`, `liveSessionsInRepo: z.number().int()`, `suggestedMode`, `worktrees: z.array(pickableWorktreeSchema)`; add **required-nullable `branch`** to `sessionInfoSchema` AND `attachResponseSchema` (1b-1 `title` precedent). |
| `src/main/ipc.ts` | `registerIpc` takes the `GitWorktreeManager`. `session:launch-context` becomes async: resolve `repoRoot` from the project root, count OTHER live sessions whose cwd resolves to it (iterate `storage.getSessionsForProject` + `sessions.isRunning` — no SessionManager API growth), compute `suggestedMode`, list pickable worktrees (`detached`, or `active` with no live owning session). `session:launch` dispatches on `workspace_mode` per spec §4. Populate `branch` on every attach-shaped response and on `layout:get` rows. |
| `src/main/index.ts` | Pass the already-constructed `GitWorktreeManager` into `registerIpc(sessions, storage, worktrees)`. No other change. |
| `src/preload/index.ts` | **No change required** — verify the grown types flow through `ChorusApi`. |
| `src/renderer/src/components/LaunchDialog.vue` | Mode selector defaulting to `ctx.suggestedMode`; existing-worktree picker over `ctx.worktrees`; inline "not a git repo" state when `repoRoot === null` (only current-tree offered). Thread `workspace_mode` (+ `worktree_id` for existing) into the launch payload. |
| `src/renderer/src/components/TerminalPane.vue` | Branch label in the header next to the title for worktree sessions, same truncate + `:title` tooltip idiom. Static per session — seed from the attach/launch response. |
| `src/shared/ipc.test.ts` | Schema cases + a pure `suggestMode(repoRoot, liveSessionsInRepo)` helper test (factoring that helper is recommended). |

Key invariants:

- The chosen `workspace_mode` is authoritative; main validates and returns `{ok:false, reason}` inline on any failure — **never a silent fallback to another mode**.
- Row-before-worktree ordering (F16); `activateWorktreeForSession` is the ONLY way both pointers + the session cwd move.
- `branch` is required-nullable on both schemas and rippled through every attach producer (launch, restart, attach) — a producer that forgets it fails the outbound parse.
- Live-session counting excludes exited rows and **must not** count sessions already inside worktrees: `git rev-parse --show-toplevel` inside a worktree returns the WORKTREE's toplevel, so isolated sessions correctly do not match `repoRoot`. This is intended semantics — do not "fix" it with `--git-common-dir`.
- No new npm dependencies; all Zod in main; payloads plain (D14).

## §8 Strict Non-Goals

No cleanup/removal/retained-worktree panel (2-3). No `git worktree remove`, no prune, no branch deletion, no `--force`, no auto-merge. No read-only mode (D22). No diff summary (2-4). No schema change / no migration v5. No new restart driver (D25). No SessionManager API growth. No changes to `git.ts` / `worktrees.ts` / `storage.ts` unless raised and justified. Do not revert, stage, or commit unrelated or untracked files, including `_verify/` and anything under `docs/`.

## §9 Required Workflow

1. Ground per §4.
2. Implement in spec order: schemas → `launch-context` handler (+ the pure `suggestMode` helper) → `launch` mode dispatch → `layout:get` branch mapping → `index.ts` wiring → LaunchDialog → TerminalPane. Run `npm run typecheck` + `npx vitest run` after the schema/helper layer before touching components.
3. Self-review the diff against CLAUDE.md, D1/D3/D4/D14/D22/D23/D26(a)(f)(i)/D25, F16/F17/F18, and the Task-2-2.md Review Checklist.
4. Run verification (§10).
5. **ONE** intentional commit, style of repo commit `80e69c3` (plain-English paragraph first, then "Technical notes:" bullets). State in the message: your F18 choice and why, the D4 flag-verification outcome, and any deviation from the spec. Verify `git config user.email` = `mwilson29072@gmail.com`; end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; do not push, do not open a PR, do not amend or rebase existing commits.

## §10 Verification Commands

```powershell
npm run typecheck   # zero errors (G1)
npx vitest run      # green — 114 existing + new schema/helper cases
git worktree -h     # D4 flag verification
git --version       # 2.50.0.windows.1
# app launch: restore ComSpec/PATH (see §3d), then
node node_modules/electron-vite/bin/electron-vite.js dev -- --remote-debugging-port=9222
```

New unit tests (`src/shared/ipc.test.ts`): `launchRequestSchema` accepts all three modes, accepts `existing-worktree` with and without `worktree_id` (main enforces the requirement); `launchContextResponseSchema` accepts `repoRoot: null` + `suggestedMode: 'current-tree'` + a populated `worktrees` array; `sessionInfoSchema` and `attachResponseSchema` REJECT a missing `branch` and accept `branch: null`; `pickableWorktreeSchema` round-trips. `suggestMode`: null repo → current-tree; 0 live → current-tree; ≥1 live → new-worktree.

RUN the app, don't just compile (G2). Runtime script, numbered, each with its exact observable (screenshot each step; cold-boot after every main-process edit per §3e):

1. Boot on the Chorus project (a git repo, branch `main`) with NO other live session in it → open the launch dialog → mode defaults to **current tree**. Launch an agent that way → confirm NO `worktrees` row was created and `git worktree list` still shows one entry (main never overrides an unpicked mode).
2. With that session live, open the dialog again → mode now defaults to **new worktree** (D26f). Launch → cross-check ALL of: `git -C C:\Projects\ContactEstablished\Chorus worktree list` shows a new linked worktree at `C:\Projects\ContactEstablished\.chorus\Chorus\wt-<shortId>`; the DB `worktrees` row is `status='active'` with `session_id` set AND the matching `sessions.worktree_id` set (both pointers — resolution a); `sessions.cwd` equals the worktree path; the branch is `chorus/Chorus/<shortId>`; the agent process's cwd is the worktree; the pane header shows the branch label.
3. Switch to the **Chorus-Second** project (NOT a git repo — §3j) → open the dialog → the inline **"not a git repo"** state appears and only current-tree is offered; launching still works as before.
4. **Existing-worktree:** make the worktree from step 2 attachable (kill its session so it is no longer live; 2-3's detach flow does not exist yet, so hand-set `status='detached'` + `session_id=NULL` via the dump-script pattern if needed — document exactly what you did). Reopen the dialog → the picker lists it → launch → the new session re-owns it (`worktrees.session_id` re-pointed, `status='active'`, cwd = its path, branch label shown). Then verify an **unattachable** pick (a worktree whose owning session is live, or a bogus id) returns `{ok:false}` inline with no silent fallback.
5. **Restart/restore safety:** with a worktree session live, tree-kill the app and cold boot → the boot log's `[worktrees] reconcile:` line reports the row and leaves a healthy `active`+entry+dir row alone (`none`); `restore()` relaunches the session **into its worktree** (cwd persisted); the branch label still renders. Confirm the reconcile line appears BEFORE the `[restore]` lines.
6. **F18 probe (your chosen fix):** simulate the crash window — set `sessions.worktree_id = NULL` for a live worktree session while `worktrees.session_id` still points at it, reload the renderer, and confirm the branch label still renders under your chosen resolution. If you chose (b), confirm reconcile repairs the pointer on the next boot instead.
7. **Cleanup + honest end state:** worktrees you created will persist. Either remove them with plain `git worktree remove <path>` + delete the row (do NOT use `--force`, do NOT call `removeWorktree({deleteBranch})`), or leave at most one or two deliberately for Task 2-3 to exercise. **Either way, document the exact end state** (`git worktree list` output + the `worktrees` table rows) in your summary so the next task starts from a known baseline, and confirm `git worktree list` and the DB agree.
8. Renderer console across the whole flow: zero `An object could not be cloned` (D14), zero uncaught errors/unhandled rejections.

## §11 Failure Honesty Clause

Capture exact output on any failure, explain it, report it; never claim success not directly observed.

**Verification-provenance rule (new, enforced):** all runtime evidence must come from THIS machine — the dev DB at `%APPDATA%\chorus\chorus.db` with projects `985d547b-d152-4a07-9094-ddb8da56ef8f` (Chorus) and `f47ac10b-58cc-4372-a567-0e02b2c3d479` (Chorus-Second). The coordinator WILL cross-check your dumps' project ids, session ids, and migration `applied_at` timestamps against the real database, and will re-run your verification. **If you are working in a sandbox, container, or any environment whose `APPDATA` or filesystem differs from the above, say so explicitly and prominently in your summary rather than presenting its output as this machine's.**

Specifically may NOT be reported as success: a mode default you did not observe in the actual dialog; a worktree creation you did not cross-check against BOTH `git worktree list` and the DB row; a "both pointers set" claim without dumping both columns; a re-own you did not verify by dump; a restore-into-worktree you did not confirm from a cold boot log. Known environment conditions (the dump-script first-run flake, Codex first-run prompts, `AttachConsole failed` noise, Claude auth state) are not failures — note them.

## §12 Final Reporting Requirements

Detailed summary for coordinator review:

- Status: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
- Commit SHA + one-line description.
- **Environment statement**: confirm the runtime evidence came from this machine's dev DB (quote the project ids you saw), or state plainly that it did not.
- **F18 decision** — which option you took, why, and how 2-4 must follow it.
- D4 flag-verification report.
- Files changed — one-line rationale each; anything beyond §7's list flagged loudly with justification.
- Deviations from ImplementationSpec-2-2, with why.
- Verification transcript: typecheck; vitest with new test names and count; runtime items 1–8 individually with what was actually observed (screenshots/dumps referenced by filename).
- **End-state declaration**: final `git worktree list` output and the full `worktrees` table contents, so Task 2-3 starts from a known baseline.
- Acceptance criteria from Task-2-2.md restated pass/fail.
- Non-goals confirmation — each §8 item untouched.
- Residual risks / notes for 2-3 and 2-4.
- Final git output fenced: `git status --porcelain` and `git log --oneline -3`.
