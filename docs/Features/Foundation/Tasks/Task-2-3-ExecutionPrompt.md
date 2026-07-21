# Chorus Phase 2, Task 2-3 Execution Prompt — Cleanup Flows, Retained-Worktree Panel, Reconcile Surfacing

_Generated 2026-07-21 against HEAD `bc3ed0a`. Ground facts in §4 verified at that commit by direct inspection: `npm run typecheck` exits 0, `npx vitest run` = 121/121 across 7 files, `git worktree list` shows the F19 fixture, working tree clean except `?? _verify/`._

## §1 Role

You are the implementation engineer for Chorus Phase 2, Task 2-3 (cleanup flows, retained-worktree panel, reconcile surfacing — the **third of four** Phase 2 tasks). Repo root: `C:\Projects\ContactEstablished\Chorus`. Expected branch `main` — confirm with `git branch --show-current`; do not switch or create branches. Expected HEAD: `bc3ed0a` ("Task 2-2 review: accept the work, record a reconcile blind spot and the env cause") or a descendant.

Planning was done by a separate coordinator. Your final summary will be reviewed against the task docs, and **the reviewer WILL re-run your verification independently** — including re-reading the database on the real machine (see §11). **This session makes exactly ONE commit** (no chore commit — the F15 CSS fix landed back in `624f3da`).

This task is different from 2-1 and 2-2 in one important way: **it is the first Phase 2 task that DESTROYS things.** Every destructive path is gated, and the gates are the deliverable as much as the features are. It also fixes **two live defects** (F16's close-flow failure and F19's reconcile blind spot) rather than only adding capability.

## §2 Goal

Close the loop on worktree cleanup, honoring the prime directive that **uncommitted agent work is never silently destroyed**.

Three IPC channels ship (`worktree:list`, `worktree:remove`, `worktree:dirty-files`). `session:delete` grows a **transactional detach step** so closing a worktree-owning pane stops failing on the enforced foreign key. The pane **close flow** reads cleanliness fresh after the awaited exit: **clean → inline removal offer** (never `window.confirm`); **dirty → silent detach + transient notice**. A new **`WorktreePanel.vue`** overlay lists the project's worktrees and removes them only through a **typed-path confirmation gate** with an unchecked-by-default "Also delete branch" checkbox. A **"Manage worktrees"** palette command opens it. `reconcileAll()` is fixed so repos with zero worktree rows are still scanned (**F19**).

Main **always** re-checks cleanliness at execution time. **`--force` reaches git on exactly one code path** — the typed-confirmation dirty removal (D26(i)) — and nowhere else.

## §3 Project Context

Architecture: local-first, Windows-only Electron 43.1.1 + Vue 3 + TypeScript + Vite + Pinia app running AI coding-agent CLIs (Claude Code, Codex) as live interactive TUIs in xterm.js panes; PTYs (node-pty / ConPTY) live in the MAIN process owned by `SessionManager`; the renderer is a pure view attaching by session id over typed IPC; `contextIsolation: true`, `nodeIntegration: false`. SQLite via better-sqlite3 (WAL) at `%APPDATA%\chorus\chorus.db`; Drizzle for typed queries ONLY — migrations are a hand-rolled `MIGRATIONS` array + `schema_migrations` runner (D7).

Dev machine: Windows 11, PowerShell 7, **Node 22.14.0, git 2.50.0.windows.1** (both re-verified 2026-07-21). CLIs: `claude.exe`, `codex-cli` (npm `.cmd` shim). **Claude Code's auth state has been inconsistent across sessions** — this task needs sessions that are RUNNING and worktrees that get DIRTY, not sessions that answer prompts. Prefer Codex, or dirty a worktree by editing a file on disk directly. Auth state does not block any verification here.

Environment quirks — all expected, none a bug you caused:

- **(a)** OS toasts disabled system-wide (registry `ToastEnabled=0`); exit-toast logs `[notify] toast shown:` then `[notify] toast failed:` — the log line is the pass signal.
- **(b)** Codex TUI first-run prompts — update prompt (press **2 to Skip, never 1**), possible directory-trust prompt, `TERM is set to "dumb"` `[y/N]`.
- **(c)** `node-pty` logs `AttachConsole failed` on PTY teardown. Pre-existing noise.
- **(d)** The automation harness strips `ComSpec` and modifies PATH — restore before launching:
  `$env:ComSpec = "$env:SystemRoot\System32\cmd.exe"` and
  `$env:PATH = "$((Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment').Path);$((Get-ItemProperty 'HKCU:\Environment').Path)"`.
- **(e)** `TaskStop` kills only the wrapper shell. To stop the app, find the root node process (`Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*electron-vite*dev*' }`) and `taskkill /PID <pid> /T /F`, then confirm port 9222 is free. **`electron-vite` does NOT hot-restart the main process on `src/main` edits (renderer HMR only) — every main-process change needs a real tree-kill cold boot. This task is main-process-heavy: budget for many.**
- **(f)** Launch the app as: restore ComSpec/PATH, then `node node_modules/electron-vite/bin/electron-vite.js dev -- --remote-debugging-port=9222` from the repo root.
- **(g)** Orphan checks cannot grep `tasklist` for claude/codex — many unrelated `claude.exe` run on this machine. Walk the descendant tree of the electron main PID instead.
- **(h)** Verification driver: **CDP** on `--remote-debugging-port=9222` (`Runtime.evaluate` in IIFEs — top-level `const` collides across evaluates; `Page.captureScreenshot`; `Input.insertText`); install `ws` in the session scratchpad, **never the repo**. `ELECTRON_RUN_AS_NODE=1` scripts print nothing to a PowerShell console — write results to a file. **`window.confirm` blocks the renderer thread — fire CDP clicks async.** (This is also *why* every new gate in this task must be inline UI.)
- **(i) ⚠ THE `sqlite3` CLI IS NOT INSTALLED ON THIS MACHINE** (verified 2026-07-21 — `where.exe sqlite3` finds nothing). DB inspection = a script requiring better-sqlite3 **by absolute repo path**, run via `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe dump.js out.json`. `Task-2-3.md` and `Task-2-4.md` were corrected to say so in the same commit that generated this prompt. **Note that COMPLETED task docs (`Task-1b-1.md`, `Task-1b-2.md`, `Task-2-1.md`, `Task-2-2.md`) and `ImplementationSpec-1b-1.md` still carry the wrong `sqlite3 ...` invocation** — they were left as historical record. Do not copy a command out of them. **KNOWN FLAKE: it intermittently writes no file on the first invocation with no error — retry once before concluding anything.** Prior sessions' dump scripts are in `_verify/` (e.g. `2-1-dump.js`, `2-1-coord-dump-*.json`) — read them for the pattern, but do not modify or commit that directory.

### Dev-machine baseline — coordinator-verified, do NOT "clean up"

- Migrations **1, 2, 3, 4** applied (v4 landed 2026-07-20T16:57:49Z). Tables `projects` / `pane_layouts` / `settings` / `schema_migrations` / `sessions` / `worktrees`.
- Projects: **`985d547b-d152-4a07-9094-ddb8da56ef8f` = "Chorus"** (root `C:\Projects\ContactEstablished\Chorus`) and **`f47ac10b-58cc-4372-a567-0e02b2c3d479` = "Chorus-Second"** (root `C:\Projects\ContactEstablished\Chorus-Second`, **NOT a git repository** — the natural "not a git repo" test case). `view_state:` rows exist for both.
- Sessions: one `running` claude + one `exited` codex, **both `worktree_id` NULL**.
- **`worktrees` table is EMPTY (0 rows).**
- **⚠ THE F19 FIXTURE — DO NOT DELETE IT BEFORE THE F19 FIX WORKS.** `git worktree list` (re-verified 2026-07-21) shows:
  ```
  C:/Projects/ContactEstablished/Chorus                      bc3ed0a [main]
  C:/Projects/ContactEstablished/.chorus/Chorus/wt-39b6f2fe  083a203 [chorus/Chorus/39b6f2fe]
  ```
  That second entry is **clean**, on branch `chorus/Chorus/39b6f2fe`, and has **no `worktrees` row**. Filesystem/git and the DB disagree *deliberately*. It is your live fixture for the F19 adoption fix and the panel's adoption surfacing. Destroying it early costs you the only real-world test case you have.

## §4 Ground Yourself First (Read BEFORE Editing)

Docs, in this order:

- `CLAUDE.md` — locked rules (sessions in main; Zod in main only; D14 plain-object IPC payloads; verify git/CLI flags at execution — D4; no new deps; **no jumping ahead to settings screens**).
- `docs/Features/Foundation/roadmap.md` — §5 Verified Ground Facts (**especially F16, F17, F19, F20**); §6 decisions D22–D27.
- `docs/Features/Foundation/Tasks/Phase-2-Overview.md` — phase shape, file-ownership matrix, the D26 lifecycle contract with resolutions (a)–(j).
- `docs/Features/Foundation/Tasks/Task-2-3.md` — **THE task contract. Scope, non-goals, acceptance criteria. THIS GOVERNS.**
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-2-3.md` — exact Zod shapes, handler sketches, panel markup, close-flow shape, invariants. Follow it; note its four ⚠ blocks (F19 fix, the `deleteBranch` tripwire, adopted rows carrying empty `branch`/`base_branch`, the F16 detach being load-bearing).
- `docs/Features/Foundation/Tasks/Task-2-2-CompletionSummary.md` — what 2-2 shipped, plus the coordinator review addendum that raised F19 and F20.

### Code state — verified 2026-07-21 at `bc3ed0a`; trust this over any older doc line

- `npm run typecheck` exits 0. `npx vitest run` = **121/121 across 7 files**: `src/shared/ipc.test.ts` (35), `src/shared/layout.test.ts` (26), `src/main/services/worktrees.test.ts` (30), `src/renderer/src/palette/commands.test.ts` (14), `src/main/services/restore.test.ts` (6), `src/renderer/src/stores/layout.test.ts` (5), `src/renderer/src/stores/view.test.ts` (5).
- **`src/main/ipc.ts`** — `registerIpc(sessions: SessionManager, storage: StorageService, worktrees: GitWorktreeManager)` (2-2 threaded the manager in; it is already available to your handlers — **do not construct a second one**). Contains the `requireProject(projectId)` FK-check helper and an F17 path-key helper. **`branchForSession(sessionId, projectId)` (at ~line 111) resolves the branch from the AUTHORITATIVE worktrees side** — `storage.getWorktreesForProject(projectId).find(w => w.sessionId === sessionId)?.branch ?? null`. This is **F18 resolution (a)**, already shipped. **`session:delete` (at ~line 342) currently does only:** parse → `if (sessions.isRunning(sessionId)) throw` → `storage.deleteSession(sessionId)`. **No worktree awareness — this is the F16 defect you are fixing.**
- **`src/shared/ipc.ts`** — `attachResponseSchema` = `{sessionId, buffer, status, exitCode, cwdMissing?, restorePending?, restored?, title: z.string().nullable(), branch: z.string().nullable()}`. **The house precedent for a new field is required-nullable (`z.string().nullable()`), NOT `.optional()`** — a producer that forgets it then fails the outbound parse loudly. Your `worktreeId` addition follows that precedent. Task 2-2's workspace-mode schemas live under a `Task 2-2: workspace modes (D22 + D26f)` banner comment — add yours under a similar `Task 2-3` banner rather than interleaving.
- **`src/main/services/git.ts` (2-1, consume — do NOT edit; 2-4 owns the next edit)** exports: `GitError` (carries `args`, `code`, `stderr`); `resolveRepoRoot(cwd)` (null for non-repos, never throws; returns git's **forward-slash** form); `parseWorktreePorcelain(out)` (pure); `listWorktrees(repoRoot)`; `worktreeAdd(...)`; **`worktreeRemove(repoRoot, path, force = false)`**; `worktreePrune(repoRoot)`; `statusPorcelain(worktreePath)`; `currentBranch(repoRoot)`; `aheadBehind(repoRoot, branch, baseBranch)`. All run through one private `runGit` over promisified `execFile` (argument arrays only, never a shell). **`--force` is emitted only when `worktreeRemove`'s flag is set, and that flag has ZERO callers today. Your gated dirty-removal path becomes its FIRST and ONLY caller.**
- **`src/main/services/worktrees.ts` (2-1's file — ADMITTED TO YOUR SCOPE for the F19 fix ONLY)** exports `shortIdFrom(uuid)`, `worktreeRootFor(repoRoot)`, `worktreePathFor(repoRoot, shortId)`, `branchFor(repoRoot, shortId)`, the pure `computeWorktreeReconcile(repoRoot, rows, gitEntries, managedDirs, sessionRowIds)`, and class `GitWorktreeManager` with `createWorktree(...)`, **`removeWorktree(worktreeId, {deleteBranch?, forceDirty?})`**, `isClean(path)`, `getDirtyFiles(path)`, `list(projectId)`, `reconcileAll()`. Its internal `pathKey` is the F17 normalization reference.
- **⚠ `removeWorktree` currently THROWS when `deleteBranch` is set** — at `src/main/services/worktrees.ts:286`, `throw new Error('removeWorktree: branch deletion is Task 2-3 scope (D26(j))')`. This is a **deliberate 2-1 tripwire** so the flag could not be silently ignored. **You must REPLACE that throw with the real `git branch -d` implementation** (plus the gated `-D` escalation per D26(j)) — not merely call it. Ship the checkbox and the branch-deletion code in the same change, **or the checkbox becomes a crash.**
- **`src/main/services/storage.ts` (consume — its accessors already exist; do NOT edit unless you take the optional F18 tidy-up in §7)**: `listProjects()` (line ~126), `getSessionById(id)` (~255), `getWorktreesForProject(projectId)`, `getAllWorktrees()`, `getWorktreeById(id)` (~305), `updateWorktreeStatus(id, status)` (~309), `activateWorktreeForSession(...)`, **`detachWorktree(worktreeId)` (~324 — ONE transaction, clears BOTH pointers, sets status `detached`)**, `deleteWorktreeRow(id)` (~334).
- **`src/renderer/src/components/TerminalPane.vue`** — `onClose` (at ~line 162) currently does: `if (pane.value.busy) return` → if running, `window.confirm('Kill this session and close the pane?')` → `setBusy` → `waitForExit` + `killSession` + `await exited` → `layoutStore.removeLeaf(props.sessionId)` → `try { await window.chorus.deleteSession(...) } catch { console.error('[pane] session:delete failed:', err) }`. **That catch is exactly where the F16 defect surfaces today.** The header renders status dot + agent label + nullable title + the 2-2 branch label + restore badge.
- **`src/renderer/src/palette/commands.ts`** — a pure registry. `PaletteContext` = `{openLaunchDialog, projects, selectProject, leaves, focusSession, focusedSessionId, toggleMode, currentMode, restartFocused}`. `buildCommands(ctx)` currently pushes command ids `launch`, `toggle-mode`, `restart-focused` plus the per-project and per-session dynamic entries (five D21 commands total). Yours is the sixth.
- **`src/renderer/src/App.vue`** — assembles `paletteCommands` (computed, at ~line 153) and mounts `<LaunchDialog v-if="dialogOpen && projectStore.activeId" :project-id="projectStore.activeId" …>` (~239) and `<CommandPalette v-if="paletteOpen" :commands="paletteCommands" @close="paletteOpen = false" />` (~245). Mount your panel next to these.
- **`src/renderer/src/components/LaunchDialog.vue`** — the overlay/focus-trap idiom to copy for `WorktreePanel.vue` (fixed inset, `bg-black/50`, `role="dialog" aria-modal="true"`, Tab-trap, Esc-cancel), and the reference for the **F13 async-`onMounted` bail rule**.
- **`src/preload/index.ts`** — a Zod-free typed forwarder. `src/preload/index.d.ts` is **never hand-edited**; `ChorusApi` is inferred from the preload object.

### Git checks (run first)

```powershell
git branch --show-current   # expect: main
git status --porcelain      # expect: ONLY "?? _verify/"
git log --oneline -1        # expect: bc3ed0a or descendant
git config user.email       # expect: mwilson29072@gmail.com
git worktree list           # expect: TWO entries — main tree + the wt-39b6f2fe fixture
```

## §5 Pre-existing Changes Warning

The working tree holds exactly one untracked entry: **`_verify/`** — accumulated runtime-harness artifacts from previous tasks (screenshots, CDP scripts, DB dump scripts and their JSON output). It is deliberately uncommitted and deliberately retained. **Do not read it into scope, revert, stage, commit, or delete it.** You may freely READ it (the dump-script and CDP patterns there will save you time) and freely ADD new artifacts to it.

If `git status --porcelain` shows anything ELSE at session start, **stop and ask**. Your commit contains only files you changed for this task.

## §6 Resolved Decisions and Findings That Bind This Task

Quote; do not relitigate. All Phase 2 decisions are RESOLVED and the council checkpoint **G5 is CLOSED as D26** (CR-2.0, unanimous 3-of-3) — no further council pass is required unless you hit a low-confidence, contested, or newly data-loss-adjacent decision, in which case **flag it rather than deciding silently**.

- **D1** (locked): all Zod validation in main only — preload and renderer stay Zod-free (the page CSP forbids the eval Zod compiles parsers with).
- **D3** (locked): sessions live in main; the renderer never spawns processes.
- **D4** (locked): **verify git flags against the installed git 2.50's own `-h`/`--help` at execution**, never model memory. Relevant here: `git worktree remove`, `git worktree prune`, `git branch -d`/`-D`. **Known from F17: `git worktree remove -h` advertises only `[-f]`, but the long `--force` (what the adapter emits) was verified working empirically.** Re-verify and report.
- **D14** (locked): renderer→main IPC payloads must be **plain objects**; snapshot anything store-sourced (`JSON.parse(JSON.stringify(x))`). A reactive Proxy is rejected by structured clone at runtime with no compile-time signal.
- **D26 clause 5** (RESOLVED 2026-07-20): closing a session with a **clean** worktree offers auto-removal; closing with a **dirty** worktree transitions it to `detached`, decoupled from the session, surfaced in a retained list, **never silently destroyed**.
- **D26 clause 6**: explicit removal of a detached worktree requires **typed confirmation naming the worktree path if dirty**; branches are **never** auto-deleted and require a separate opt-in checkbox.
- **D26 clause 7 as AMENDED by D26(i)**: `--force` is never used **EXCEPT** inside the single dirty-removal path, after main's typed-confirmation gate has passed — a **targeted `git worktree remove --force <path>`** on the confirmed worktree only. **The no-force workaround (`fs.rm` + repo-wide `git worktree prune`) is REJECTED** — `prune` is repo-wide and would silently resolve other surfaced prune-candidates without their own confirmation.
- **D26 clause 8**: worktree directory removal **sequences after the owning session's process tree has exited**, respecting the Windows open-handle constraint; removal retries on lock failures with backoff. (2-1's `removeWorktree` already implements the retry/backoff. F17: git's dirty-refusal text `fatal: '<path>' contains modified or untracked files, use --force to delete it` was confirmed NOT to match the lock retry matcher, so a dirty refusal never retries — good.)
- **D26(a)**: both pointer columns move in **ONE synchronous transaction** — `detachWorktree` already encapsulates this. **`worktrees.session_id` is authoritative.**
- **D26(d)/(e)**: reconcile population 2's "session still alive" branch is vacuous (reconcile runs pre-restore) — collapses to **surface-as-prune-candidate**. A `removing` row crashed mid-flight re-classifies by evidence: git entry AND directory both gone → **delete row**; anything remaining → revert to **`detached`** and surface.
- **D26(g)**: the retained-worktree list ships as a **minimal overlay dialog** (LaunchDialog idiom) + a palette command — **NOT a settings panel** (none exists; CLAUDE.md bars jumping ahead to settings screens). Columns: path, branch, clean/dirty, Remove.
- **D26(j)**: branch deletion runs `git branch -d`; an **unmerged refusal is surfaced**, and `-D` escalation requires the same typed-confirmation acknowledgment.
- **D25**: F14 stays deferred — Phase 2 adds no restart driver; **do not change restart events.**
- **F13 — async `onMounted` bail rule.** Any component with awaits in `onMounted` must bail after each `await` if it may have unmounted (`cleanups` run once; post-cleanup registrations leak). `WorktreePanel.vue` must follow the `LaunchDialog` idiom.
- **F16 (HARD): SQLite FOREIGN KEYS ARE ENFORCED.** better-sqlite3 12.11.1 sets `PRAGMA foreign_keys=ON` per connection; `worktrees.session_id REFERENCES sessions(id)` is a real constraint with default **RESTRICT** (coordinator-verified three ways: pragma reads `1`; a fabricated-FK insert throws; **deleting a referenced parent throws `SQLITE_CONSTRAINT_FOREIGNKEY`**). Therefore **`storage.deleteSession(sessionId)` WILL THROW whenever any `worktrees` row still references that session.** The detach step is **load-bearing, not tidiness**. **This is a live defect today:** closing a pane whose session owns a worktree fails, the renderer logs `[pane] session:delete failed`, and the row is left as exited drift. It fails loudly, not silently. **Verify this specific case at runtime.**
- **F17: path + porcelain quirks.** `git worktree list --porcelain` emits **forward-slash** paths while rows store `join()`-produced backslash paths, and Windows paths are **case-insensitive** — **every path comparison must go through a normalization key** (`win32.normalize(p).toLowerCase()`; `worktrees.ts::pathKey` is the reference). A hand-deleted worktree gains a `prunable` attribute line; `parseWorktreePorcelain` skips unknown attributes and is CRLF-tolerant.
- **F18 is RESOLVED as (a)** — `branchForSession` reads the authoritative `worktrees.session_id`, never `sessions.worktree_id`. **Task 2-4 must use the identical path.** Consequence for you: **a `session:delete` where the two pointers disagree (session-side NULL, row-side set) would STILL throw** if you key the detach off `sessions.worktree_id` alone. **Make the handler resilient: detach by looking up any worktree row whose `session_id` matches, not by trusting `sessions.worktree_id`.** (IS-2-3 §3 spells this out.)
- **F19 — YOU OWN THIS FIX.** `reconcileAll()` derives its repo list **from the rows themselves** (`getAllWorktrees()` → group by `repoRoot`), so a repo with **zero** rows produces zero groups, `listWorktrees` is never called for it, and the pure core never receives the evidence that would trigger `adopt` (population 4) or `surface-orphan-dir` (population 5). **Proven live:** a cold boot on this machine logged `[worktrees] reconcile: 0 row(s) across 0 repo(s); 0 surfaced` while `wt-39b6f2fe` sat in `git worktree list`. **The spec, not the 2-1 implementer, was at fault** — IS-2-1 §7 prescribed the row-derived enumeration verbatim. **Fix:** enumerate candidate repos from the **union** of (a) distinct `repoRoot` across worktree rows and (b) `resolveRepoRoot(project.rootPath)` for every project in `storage.listProjects()`, **deduped by the F17 `pathKey`**; a null repo root contributes nothing. A repo group may now legitimately have **zero rows** and still produce actions — **`computeWorktreeReconcile` itself needs NO change**, it already handles `rows: []` with non-empty `gitEntries`/`managedDirs`. **`worktree:list` inherits the same blind spot** and needs the same treatment so the panel can surface what the table does not know about.
- **F20 — KNOWN ENVIRONMENT CONDITION, stated as fact, not suspicion.** Execution sessions on this machine have run with a **REDIRECTED `AppData` but a REAL `C:\Projects`**. Evidence: Task 2-2's worktree, branch, and scratch artifacts are all physically present on the real disk with naturally spread mtimes; the implementer's dump script hardcoded the same absolute DB path the coordinator reads yet returned different contents minutes apart; and decisively, their boot log showed Electron restoring session ids that exist only in their database. `$APPDATA` prints the correct string because **the redirection is at the storage layer, not the variable**. **Consequences for you: (1) your filesystem/git evidence is trustworthy; (2) your DATABASE evidence may describe a different DB and the coordinator will re-verify it against the real `%APPDATA%\chorus\chorus.db`; (3) no dishonesty occurred in 2-1 or 2-2 — this is an environment artifact, and saying "my DB dump shows X" is not a mark against you.** What IS a mark against you is presenting a redirected-environment dump as this machine's without flagging it. **Dump the projects table in every DB dump you take and quote the project ids** (§11) so provenance is checkable at a glance.

## §7 Implementation Scope

Follow the Exact Scope table in `Task-2-3.md` and `ImplementationSpec-2-3.md` §§2–7.

| File | Change |
|------|--------|
| `src/shared/ipc.ts` | The three channels + `worktreeListRequestSchema`, `worktreeSummarySchema` (id, path, branch, status, clean, dirtyCount, ahead, behind, isPruneCandidate), `worktreeListResponseSchema`, `worktreeRemoveRequestSchema` (`{worktreeId: z.uuid(), deleteBranch?: boolean, confirmation?: string}`), `worktreeRemoveResponseSchema` (ok-true \| ok-false+reason), `worktreeDirtyFilesRequest/ResponseSchema`. Plus **required-nullable `worktreeId` on `attachResponseSchema`** and the pure exported **`dirtyRemovalAllowed(wt, confirmation)`** predicate. |
| `src/main/ipc.ts` | Register the three handlers. `worktree:list` (FK-check project → summaries, `isPruneCandidate` recomputed **live**, F19 union scan). `worktree:dirty-files`. `worktree:remove` — the destructive gate: live cleanliness re-check, block if the owning session is live, `dirtyRemovalAllowed` gate, `updateWorktreeStatus('removing')` journal → `removeWorktree` → `deleteWorktreeRow`, **revert to `detached` on failure**. Grow `session:delete` with the transactional detach (**keyed off the worktrees side — F18**). |
| `src/preload/index.ts` | `listWorktrees(projectId)`, `removeWorktree(req)`, `getWorktreeDirtyFiles(worktreeId)` forwarders. Zod-free. |
| `src/renderer/src/components/TerminalPane.vue` | Close flow: after kill + awaited exit, resolve `worktreeId` from the attach response → **fresh** `getWorktreeDirtyFiles` read → clean → **inline offer**; dirty → silent detach + transient notice. Keep the existing kill/exit/leaf-remove/delete ordering (D16 clause 5). **No new blocking `window.confirm`.** |
| `src/renderer/src/components/WorktreePanel.vue` | **NEW.** LaunchDialog overlay/focus-trap idiom; row = path (truncated + `:title`), branch, clean/dirty badge + count, ahead/behind, status; Remove with the inline typed-path gate; **"Also delete branch" unchecked by default**; prune-candidate rows get a distinct Prune affordance (explicit click only). **F13 bail rule.** |
| `src/main/services/worktrees.ts` | **ADMITTED TO SCOPE FOR THE F19 FIX ONLY.** `reconcileAll()` union enumeration (rows ∪ projects, deduped by `pathKey`). **AND** replace the `deleteBranch` tripwire throw at line ~286 with the real `git branch -d` / gated `-D` implementation (D26(j)). **Make no other changes to this file.** |
| `src/renderer/src/palette/commands.ts` | A sixth command `manage-worktrees` — "Manage worktrees…", keywords `['worktree','worktrees','git','branch','cleanup','remove']`, `enabled: () => true`, `run: () => ctx.manageWorktrees()`. Add `manageWorktrees: () => void` to `PaletteContext`. |
| `src/renderer/src/App.vue` | A `worktreePanelOpen` ref; `manageWorktrees` in the palette context; mount `<WorktreePanel v-if="worktreePanelOpen && projectStore.activeId" :project-id="projectStore.activeId" @close="worktreePanelOpen = false" />` next to `CommandPalette`. |
| `src/shared/ipc.test.ts` | Schema cases for the three channels + the `dirtyRemovalAllowed` predicate. |
| `src/renderer/src/palette/commands.test.ts` | "Manage worktrees" present, enabled, `run()` invokes the callback, survives `fuzzyFilter('worktree')`. |

**Optional tidy-up (not required):** re-owning a worktree leaves the previous owner's `sessions.worktree_id` stale. F18(a) renders this harmless. If you are already inside `storage.ts` you may clear it inside `activateWorktreeForSession`'s transaction — **but `storage.ts` is otherwise NOT in your scope**, so skipping this is the safe default. If you do it, call it out.

**Explicitly do NOT touch:** `src/main/services/git.ts` (2-4 owns the next edit; `worktreeRemove` already does everything you need), `src/main/db/schema.ts` (**no schema change, no migration v5**), `src/main/index.ts`, `src/renderer/src/components/LaunchDialog.vue`, `src/renderer/src/stores/*`, `src/preload/index.d.ts` (inferred, never hand-edited). If a change seems to require another file, **raise it and justify it loudly in the summary** rather than quietly widening scope.

### Key invariants

- **`--force` reaches git ONLY via the gated dirty-removal call.** Every other `worktreeRemove` caller passes `force: false`. This is greppable and the reviewer will grep it.
- `worktree:remove` **re-checks `git status --porcelain` at execution time** — never trusts the renderer's cleanliness read. The renderer's fresh read narrows the race window; the handler's re-check closes it. Defense in depth, both required.
- The owning session must not be live when a worktree is removed.
- **Branch deletion is opt-in only** (`-d`, with `-D` only behind the typed acknowledgment). An unmerged `-d` refusal is **surfaced**, not swallowed.
- `session:delete` **detaches transactionally** (both pointers, one transaction) and still refuses a live session. The handler only ever detaches; the *offer* to remove-when-clean is renderer UX.
- **No `window.confirm` for worktree decisions** — it blocks the renderer thread (§3h). All gates inline.
- **Adopted rows carry `branch: ''` and `base_branch: ''`** (population-4 adoptions have unknowable bases; both columns are NOT NULL). **`aheadBehind(repoRoot, branch, baseBranch)` MUST guard empty strings** — an empty ref makes `rev-list --left-right --count` fail. Render `—` instead of calling git.
- **Adopted-row project attribution is approximate** — 2-1 attributes an adopted worktree to `repoRows[0].projectId`, which can misattribute when two projects resolve to the same repo root. Known limitation, not a bug to fix here.
- All Zod in main; payloads plain (D14); no new npm dependencies.

## §8 Strict Non-Goals

- **Never auto-merge.** Ever.
- **No un-gated `--force`** — the flag exists solely inside the typed-confirmation dirty-removal path (D26(i)); no other code path may pass it.
- **No branch auto-deletion** — unchecked by default, acts only when explicitly checked.
- **No automatic pruning** — prune candidates are surfaced and act only on explicit user click.
- **No `window.confirm`** for worktree decisions.
- **No settings panel / settings screen** — a minimal overlay + palette command only (D26g).
- **No rich diff/preview** in the panel (2-4's shortstat; per-file diff is a v1-horizon exclusion).
- **No diff summary at all** — that is Task 2-4.
- **No schema change / no migration v5.**
- **No restart-driver or restart-event change** (D25/F14).
- **No changes to `git.ts` / `storage.ts` / `schema.ts` / `index.ts`** unless raised and justified.
- **Do not revert, stage, or commit unrelated or untracked files, including `_verify/` and anything under `docs/`.**

## §9 Required Workflow

1. **Ground per §4.** Read the docs and the named symbols before editing anything.
2. **Implement in spec order:** schemas + `dirtyRemovalAllowed` → the F19 `reconcileAll` fix + the `deleteBranch` tripwire replacement in `worktrees.ts` → the three handlers + `session:delete` detach → preload forwarders → `WorktreePanel.vue` → palette + `App.vue` → `TerminalPane` close flow. **Run `npm run typecheck` + `npx vitest run` after the schema/predicate layer before touching components** — a schema mistake caught there is minutes; caught at runtime it is a cold boot.
3. **Self-review the diff** against `CLAUDE.md`, D1/D3/D4/D14/D25/D26(a)(d)(e)(g)(i)(j) + clauses 5–8, F13/F16/F17/F18/F19, and the `Task-2-3.md` Review Checklist (its 10 items are the reviewer's actual checklist).
4. **Run verification (§10)** — static AND runtime. G2 means *run the app*, not *compile the app*.
5. **ONE intentional commit**, in the style of repo commit `80e69c3` / `94f062c`: a plain-English paragraph a non-technical reader can follow, then a `Technical notes:` bullet list. State in the message: the **D4 flag-verification outcome**, how you fixed **F19**, how you fixed the **F16 close failure**, the fact that **`worktrees.ts` was edited under its admitted-scope exception**, and any deviation from the spec. Verify `git config user.email` = `mwilson29072@gmail.com`. End with the `Co-Authored-By:` trailer naming the model that did the work. **Do not push, do not open a PR, do not amend or rebase existing commits.**

## §10 Verification Commands

```powershell
npm run typecheck          # zero errors (G1)
npx vitest run             # green — 121 existing + your new cases
git worktree remove -h     # D4 flag verification (expect: advertises only [-f]; --force works empirically per F17)
git worktree prune -h      # D4
git branch -h              # D4 — confirm -d / -D
git --version              # 2.50.0.windows.1
# app launch: restore ComSpec/PATH (see §3d), then
node node_modules/electron-vite/bin/electron-vite.js dev -- --remote-debugging-port=9222
# DB inspection — sqlite3 is NOT installed (§3i); use the dump-script pattern:
$env:ELECTRON_RUN_AS_NODE=1; node_modules/electron/dist/electron.exe <scratch>/dump.js <scratch>/out.json
```

### New unit tests

`src/shared/ipc.test.ts`: `worktreeRemoveRequestSchema` accepts `{worktreeId}` alone, `{worktreeId, deleteBranch:true}`, and `{worktreeId, confirmation:'<path>'}`; **rejects a non-uuid `worktreeId`**. `worktreeSummarySchema` round-trips. `worktreeListResponseSchema` accepts an empty array. `attachResponseSchema` **rejects a missing `worktreeId`** and accepts `worktreeId: null`. **`dirtyRemovalAllowed`**: clean → true regardless of confirmation (including `undefined`); dirty + exactly-matching confirmation → true; dirty + mismatched → false; dirty + `undefined` → false.

`src/renderer/src/palette/commands.test.ts`: "Manage worktrees" is present and enabled; `run()` invokes the `manageWorktrees` callback; it survives `fuzzyFilter('worktree')`.

### RUN the app, don't just compile (G2)

Numbered, each with its exact observable. **Screenshot each step. Cold-boot after every main-process edit (§3e).**

1. **F19 FIRST — before you disturb the fixture.** Cold boot with the `worktrees` table empty and `wt-39b6f2fe` present in `git worktree list`. Observe the boot log: it must now report a non-zero repo count and log an `adopt` / `found untracked worktree … adopted as detached` line for `wt-39b6f2fe` (the pre-fix baseline was `reconcile: 0 row(s) across 0 repo(s); 0 surfaced`). Dump the DB: the row exists, `status='detached'`, `session_id` NULL. **Boot a second time: nothing changes (idempotent).** Open the panel: the adopted row is listed, with `—` for ahead/behind (empty `branch`/`base_branch` — do not let this throw).
2. **Clean-close offer.** Launch a new-worktree session (2-2 flow). Make **no** edits. Close the pane → the **inline clean-removal offer** appears (no native dialog; CDP click-through works). Accept → `git worktree list` no longer shows it AND the row is gone.
3. **Decline path.** Repeat step 2 but **decline** the offer → the worktree is retained: row `detached`, `session_id` NULL, directory intact.
4. **Dirty-close silent detach.** Launch another new-worktree session; **make an edit** inside it (Codex writes a file, or edit on disk directly). Close → it **detaches silently** with a transient notice — no offer, no prompt. `git worktree list` still shows it; the row is `detached` with `session_id` NULL; **the file edit is intact on disk** (open the file and confirm the content).
5. **F16 — THE LIVE DEFECT, verify explicitly.** In steps 2–4 the pane close must succeed **end-to-end with no `[pane] session:delete failed` in the renderer console**. Before this task that path threw `SQLITE_CONSTRAINT_FOREIGNKEY` and left exited drift. Dump the DB and confirm **both** pointers are cleared (`worktrees.session_id` NULL AND `sessions.worktree_id` NULL) — transactional, resolution (a).
6. **Panel listing.** `Ctrl+K` → "Manage worktrees" → the panel lists the detached worktree with path, branch, a **dirty** badge + count, ahead/behind, status.
7. **Typed-confirmation gate.** Click Remove on the **dirty** row → the dirty file list shows; the confirm button **stays disabled** until the exact path is typed; type it → confirm → removed (directory gone, row gone). **Then prove the live re-check:** open the panel while a worktree is clean, dirty a file on disk *after* the panel has loaded, then remove → the handler must **still gate it** on the fresh dirty state, not the panel's stale `clean: true`.
8. **Branch deletion opt-in.** With **"Also delete branch" checked** → `git branch --list 'chorus/*'` no longer shows that branch. With it **unchecked (default)** → the branch **remains**. Also exercise the **unmerged `-d` refusal**: confirm the refusal is surfaced in the UI rather than swallowed, and that `-D` escalation requires the typed acknowledgment (D26(j)).
9. **Prune candidate.** Delete a worktree directory **by hand** (leaving git metadata), open the panel → the row shows as a prune candidate; the Prune affordance acts **only on explicit click**, never automatically.
10. **No renderer block.** Confirm no `window.confirm` blocked the renderer during any of the above — every CDP click-through worked without a native dialog.
11. **Console hygiene across the whole flow:** zero `An object could not be cloned` (D14), zero uncaught errors, zero unhandled rejections.
12. **`--force` grep gate:** `--force` appears in `git.ts`'s `worktreeRemove` only, and the ONLY caller passing a truthy force flag is the gated dirty-removal path in `main/ipc.ts`. Report the grep and its hit count.

## §11 Failure Honesty Clause

Capture exact output on any failure, explain it, report it. **Never claim success you did not directly observe.**

**Verification-provenance rule (enforced — see F20 in §6):** execution sessions here have run with a **redirected `AppData` but a real `C:\Projects`**. This is a known condition, not an accusation. Your **filesystem and git evidence is trustworthy**; your **database evidence may describe a different DB**, and the coordinator **will** re-verify it against the real `%APPDATA%\chorus\chorus.db` (projects `985d547b-d152-4a07-9094-ddb8da56ef8f` = Chorus, `f47ac10b-58cc-4372-a567-0e02b2c3d479` = Chorus-Second). **Therefore: dump the `projects` table alongside every DB dump you take and quote the ids you actually saw.** If they do not match the two above, say so plainly and prominently — that is a useful signal, not a failure on your part. Presenting a redirected dump as this machine's *without* flagging it is the only thing that counts against you.

**Specifically may NOT be reported as success:**
- an F19 adoption you did not observe in an actual cold-boot log **and** confirm by DB dump;
- a clean-removal offer you did not see rendered in the actual UI;
- a dirty detach where you did not confirm the uncommitted content still on disk;
- a removal you did not cross-check against **both** `git worktree list` and the DB row;
- a "both pointers cleared" claim without dumping both columns;
- a live-recheck gate you did not exercise by dirtying a file *after* the panel loaded;
- a branch deletion (or non-deletion) you did not confirm with `git branch --list`.

Known environment conditions are **not** failures — note them and move on: the dump-script first-run flake (§3i), Codex first-run prompts (§3b), `AttachConsole failed` teardown noise (§3c), disabled OS toasts (§3a), Claude Code auth state.

## §12 Final Reporting Requirements

Write a detailed summary for coordinator review containing:

- **Status:** DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
- **Commit SHA** + one-line description.
- **Environment statement** — confirm the runtime evidence came from this machine's dev DB (**quote the project ids you saw**), or state plainly that it did not (§11).
- **D4 flag-verification report** — what `git worktree remove -h`, `git worktree prune -h`, and `git branch -h` actually printed, and how it matched or contradicted the adapter's emitted flags.
- **F19 fix** — what you changed in `reconcileAll`, and the before/after boot-log lines proving adoption now fires.
- **F16 fix** — the close-flow failure before vs. after, with the console evidence.
- **The `deleteBranch` tripwire** — confirm you REPLACED the throw with a real implementation (quote the removed line and describe what replaced it).
- **Files changed** — one-line rationale each; anything beyond §7's table flagged loudly with justification. Explicitly confirm `worktrees.ts` was touched **only** for the F19 fix and the tripwire replacement.
- **Deviations** from `ImplementationSpec-2-3.md`, with why.
- **Verification transcript** — typecheck; vitest with new test names and total count; runtime items 1–12 individually with what was actually observed (screenshots/dumps referenced by filename).
- **`--force` grep gate** result with hit counts (§10 item 12).
- **End-state declaration** — final `git worktree list` output and the full `worktrees` table contents, so Task 2-4 starts from a known baseline. **State explicitly whether the `wt-39b6f2fe` fixture still exists** and, if you removed it, that the F19 fix was proven first.
- **Acceptance criteria** from `Task-2-3.md` restated pass/fail (all 11 boxes).
- **Non-goals confirmation** — each §8 item untouched.
- **Residual risks / notes for Task 2-4** — especially anything about how the panel or close flow will interact with the diff summary, and confirmation that 2-4 must resolve the worktree via `worktrees.session_id` (F18(a)).
- **Final git output**, fenced: `git status --porcelain` and `git log --oneline -3`.
