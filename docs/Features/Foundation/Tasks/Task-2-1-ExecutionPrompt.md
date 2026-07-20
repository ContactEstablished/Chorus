# Chorus Phase 2, Task 2-1 Execution Prompt — Git Adapter, Worktrees Data Layer, Reconcile Engine (+ F15 chore)

_Generated 2026-07-20 against HEAD `9fbdea6`. Ground facts in §4 verified at commit `59e7909` (code unchanged since — `9fbdea6` touched only docs); typecheck clean and 84/84 vitest passing at generation time._

## §1 Role

You are the implementation engineer for Chorus Phase 2, Task 2-1 (git adapter + worktrees data layer + reconcile engine + the F15 CSS chore — first task of Phase 2; everything downstream consumes it). Repo root: `C:\Projects\ContactEstablished\Chorus`. Expected branch `main` — confirm with `git branch --show-current`; do not switch or create branches. Expected HEAD: `9fbdea6` ("Phase 2 (Worktrees) planned: council review, task docs, specs") or a descendant. Planning was done by a separate coordinator; your final summary will be reviewed against the task docs. **This session makes TWO commits (D24): the F15 chore commit FIRST (separate, flagged), then the task commit.**

## §2 Goal

Build the foundation every later Phase-2 task stands on, with zero user-visible change except the F15 chore: a controlled git process adapter (`src/main/services/git.ts`), a worktrees data layer (migration v4 + Drizzle defs + storage accessors), a `GitWorktreeManager` with DB-first journaled creation and Windows-safe removal sequencing, and a pure, exhaustively-tested reconcile core (`computeWorktreeReconcile`) awaited at boot BEFORE session restore. The reconcile is inert on an empty worktrees table (the case on every existing DB until Task 2-2 creates the first worktree). No IPC, no UI, no launch-flow changes. Prime directive of the phase: uncommitted agent work is never silently destroyed; `--force` reaches git only behind a flag nothing in this task sets.

## §3 Project Context

Architecture: local-first, Windows-only Electron 43.1.1 + Vue 3 + TypeScript + Vite + Pinia app running AI coding-agent CLIs (Claude Code, Codex) as live interactive TUIs in xterm.js panes; PTYs (node-pty / ConPTY) live in the MAIN process owned by `SessionManager`; renderer is a pure view attaching by session id over typed IPC; `contextIsolation: true`, `nodeIntegration: false`. SQLite via better-sqlite3 (WAL) at `%APPDATA%\chorus\chorus.db`; Drizzle for typed queries ONLY — migrations are a hand-rolled `MIGRATIONS` string array + `schema_migrations` runner (D7 scope cut).

Dev machine: Windows 11, PowerShell 7, Node 22.14.0, **git 2.50.0.windows.1** (`git worktree` verified working). CLIs: `claude.exe` 2.1.215 (currently UNAUTHENTICATED — "token has expired" on any real prompt; TUIs boot fine; irrelevant to this task, do not mistake it for a bug), `codex-cli` 0.144.6.

Environment quirks — all expected, none a bug the implementer caused:
- (a) OS toasts disabled system-wide (registry `ToastEnabled=0`); exit-toast logs `[notify] toast shown:` then `[notify] toast failed:` — the log line is the pass signal.
- (b) Codex TUI first-run prompts — update prompt (press 2 to Skip, never 1), possible directory-trust prompt, `TERM is set to "dumb"` `[y/N]`. (This task should not need to launch agents; boot auto-restore may still open TUIs.)
- (c) `node-pty` logs `AttachConsole failed` on PTY teardown. Pre-existing noise.
- (d) The automation harness strips `ComSpec` and modifies PATH — restore `ComSpec` (`$env:ComSpec = "$env:SystemRoot\System32\cmd.exe"`) + registry machine/user PATH before npm installs or app launches.
- (e) `TaskStop` kills only the wrapper shell — `npm run dev` descendant trees survive as orphans holding the CDP port. Every "restart the app" check MUST tree-kill the root node process (`taskkill /PID <root> /T /F`) and confirm port 9222 rebinds on a NEW pid, or the "fresh boot" is the old window. This task's migration and boot-ordering checks REQUIRE real cold boots — budget for tree-kill relaunches.
- (f) `npx`/`npm run` prepend the npm-global dir to the child PATH. Launch the app as: restore ComSpec/PATH, then `node node_modules/electron-vite/bin/electron-vite.js dev -- --remote-debugging-port=9222` directly from the repo root.
- (g) Orphan checks cannot grep `tasklist` for claude/codex — the dev machine runs many unrelated `claude.exe`. Walk the descendant tree of the electron main PID instead.
- (h) Verification driver: CDP on `--remote-debugging-port=9222` (`Runtime.evaluate` in IIFEs, `Page.captureScreenshot`); install `ws` in the session scratchpad, never the repo. `ELECTRON_RUN_AS_NODE=1` scripts print nothing to a PowerShell console — write results to a file. The `sqlite3` CLI is NOT installed: DB inspection = a dump script requiring better-sqlite3 by absolute repo path, run via `$env:ELECTRON_RUN_AS_NODE=1; & node_modules\electron\dist\electron.exe dump.js out.json`, results written to a file. KNOWN FLAKE: this dump script intermittently produces NO output file on first invocation with no error — retry once before diagnosing.
- (i) Dev DB state: two projects — "Chorus" (id `985d547b-d152-4a07-9094-ddb8da56ef8f`, 2-leaf layout: one Claude Code session + one exited Codex session) and "Chorus-Second" (id `f47ac10b-58cc-4372-a567-0e02b2c3d479`, no sessions/layout); `view_state:` settings rows for both; 3 applied migrations. All legitimate artifacts — do not clean up. Boot will auto-restore the Chorus project's running session (D16) — expected, unrelated to your changes.

## §4 Ground Yourself First (Read BEFORE Editing)

Docs (in-repo), read in this order:
- `CLAUDE.md` — locked rules (sessions in main; Zod in main only; D14 plain-object IPC; verify CLI/git flags against `--help` at execution — D4; ask before new deps, there are NONE here).
- `docs/Features/Foundation/roadmap.md` — §5 Verified Ground Facts; §6 decisions D22–D26 (D23/D26h location+branch derivation, D24 two-commit chore, D26 lifecycle contract with resolutions a–h and amendments i–j).
- `docs/Features/Foundation/Tasks/Phase-2-Overview.md` — phase shape, file-ownership matrix, cross-cutting rules.
- `docs/Features/Foundation/Tasks/Task-2-1.md` — THE task contract. Scope, non-goals, acceptance criteria. THIS GOVERNS.
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-2-1.md` — exact DDL, adapter signatures, the NORMATIVE evidence-matrix reconcile table (§6), manager sketches, boot wiring, runtime script. Follow it.
- `docs/Features/Foundation/CouncilBriefs/CouncilBrief-2.0-Findings.md` — council context (the spec + roadmap D26 supersede it where they differ).

Code state — verified 2026-07-20 at `59e7909` (docs-only commit `9fbdea6` since; trust this over any older doc line):
- `npm run typecheck` exits 0; `npx vitest run` = 84/84 across 6 files (`src/shared/layout.test.ts`, `src/shared/ipc.test.ts`, `src/main/services/restore.test.ts`, `src/renderer/src/stores/layout.test.ts`, `src/renderer/src/stores/view.test.ts`, `src/renderer/src/palette/commands.test.ts`).
- Nothing git-aware exists anywhere in `src/` — no git service, no worktrees table, no workspace-mode concept.
- `src/main/services/storage.ts` — `MIGRATIONS` array has 3 entries; `migrate()` applies `applied+1 … MIGRATIONS.length`, each inside a transaction; the runner must NOT be touched (only a 4th array entry added). Settings accessors follow the inline-Drizzle per-key pattern. `this.d` is the Drizzle handle over the same better-sqlite3 connection.
- `src/main/db/schema.ts` — Drizzle table defs for projects/pane_layouts/settings/schema_migrations/sessions; sessions has NO worktree_id yet. SQLite FOREIGN KEYS ARE NOT ENABLED (no `PRAGMA foreign_keys`) — `REFERENCES` clauses are documentation; existence checks live in code.
- `src/main/index.ts` — boot sequence inside `app.whenReady().then(() => {...})` (callback NOT async today): storage init → active-project resolution → `registerIpc(sessions, storage)` → `watchSessionExits(sessions)` + D11 `sessions.onExit` status-writer → `void sessions.restore(project.id)` (line 121, not awaited) → `createWindow()`. Task 2-1 makes the callback async and awaits the worktree reconcile BEFORE the restore line.
- `src/main/services/restore.ts` — `computeRestoreSet` is the style precedent for the pure reconcile core (pure, Electron-free, structurally typed, exhaustively unit-tested).
- `src/main/services/sessionManager.ts` — `restore()` validates `fs.existsSync(row.cwd)` per spawn and heals missing-cwd rows to exited. Reconcile must NOT double-heal: it touches only `worktrees` rows; restore owns `sessions` healing.
- `src/renderer/src/assets/main.css` lines 3–9 — the F15 unlayered `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }` reset after `@import 'tailwindcss'`, which nullifies every Tailwind margin/padding utility app-wide.

Git checks (run first):
```powershell
git branch --show-current   # expect: main
git status --porcelain      # expect: ONLY "?? _verify/"
git log --oneline -1        # expect: 9fbdea6 or descendant
git config user.email       # expect: mwilson29072@gmail.com
git worktree list           # expect: exactly one entry (the main tree at the repo root)
```

## §5 Pre-existing Changes Warning

The working tree holds exactly one untracked entry at prompt-generation time: `_verify/` — a previous implementer's harness artifacts, deliberately uncommitted. Do not read into scope, revert, stage, commit, or delete it. If `git status --porcelain` shows anything ELSE, stop and ask the user. Your two commits contain only files you changed for this task.

## §6 Resolved Decisions That Bind This Task

Quote; do not relitigate:
- D1 (locked): ALL Zod validation in main only. 2-1 adds no IPC — binds by prohibition.
- D4 (locked): verify git flags against the installed git 2.50's own `git worktree -h` / `git status -h` at execution, never model memory; note the verification in the commit message.
- D7 (resolved): migration ENGINE stays hand-rolled; Drizzle is typed queries only. Migration v4 = a 4th `MIGRATIONS` entry, runner untouched.
- D23 + D26(h) (resolved 2026-07-20): worktrees live at `<repo-parent>\.chorus\<repo-name>\wt-<shortId>`; branches `chorus/<repo-name>/<shortId>`; shortId = first 8 hex chars of the WORKTREE row UUID (not the session id — worktrees outlive sessions). Retry with a fresh short id on `git worktree add` collision.
- D24 (resolved 2026-07-20): the F15 chore is a SEPARATE, FLAGGED FIRST COMMIT in this session (drop the unlayered reset or move it into a layer — Tailwind preflight already resets), verified at runtime; then the task commit. G3 is amended for this one chore.
- D26 (resolved 2026-07-20, council CR-2.0 unanimous + coordinator resolutions a–h + amendments i–j): the worktree lifecycle contract. Binding on 2-1: DB-first journaled creation (`creating` row BEFORE any fs/git op; deterministic path from the worktree UUID; `active` only after success); state set `creating → provisioning → active → detached → removing`; boot reconcile AWAITED BEFORE restore, classifying by EVIDENCE first (git entry × directory), journal status second (resolution b); population-4 adoptions born `detached` (c); no "session alive" branch (d); `removing` re-classified by evidence (e); both pointer columns written in ONE synchronous transaction (a); reconcile never auto-prunes and never auto-deletes an orphan directory; amendment (i): `--force` exists ONLY behind `worktreeRemove`'s `force` flag whose sole legal caller is Task 2-3's typed-confirmation path — NOTHING in 2-1 sets it; amendment (j): branch deletion is `-d` (gated `-D`), not exercised in 2-1.
- F13 (binds any new async code in components — the chore touches none, noted for completeness).

## §7 Implementation Scope

Follow the Exact Scope table in `Task-2-1.md` and ImplementationSpec-2-1 §§2–7 exactly. Files: CREATE `src/main/services/git.ts`, `src/main/services/worktrees.ts`, `src/main/services/worktrees.test.ts`; EDIT `src/main/db/schema.ts`, `src/main/services/storage.ts`, `src/main/index.ts`, and (chore commit only) `src/renderer/src/assets/main.css`. Explicitly do NOT touch: `src/shared/*`, `src/preload/*`, `src/main/ipc.ts`, `src/main/services/sessionManager.ts` / `restore.ts` / `cliDetect.ts` / `notifications.ts`, anything else in `src/renderer/`.

| File | Change |
|------|--------|
| `src/renderer/src/assets/main.css` | F15 CHORE, SEPARATE FIRST COMMIT (D24): remove the unlayered reset (preferred) or wrap it in `@layer base`; keep the `html, body, #app` block. Verify restored spacing at runtime (LaunchDialog `p-5`/`mt-3`, palette `pt-24`). |
| `src/main/services/git.ts` | NEW. One private `runGit(cwd, args)` over `promisify(execFile)('git', args, {cwd, timeout: 15000, windowsHide: true, maxBuffer: 16MiB})`; never a shell, never string-concatenated commands; typed `GitError` carrying args/code/stderr. Public: `resolveRepoRoot` (null for non-repos — never an error), `listWorktrees` (+ exported pure `parseWorktreePorcelain`), `worktreeAdd(repoRoot, path, branch, baseBranch)` (`worktree add -b <branch> <path> <base>`), `worktreeRemove(repoRoot, path, force = false)` (`--force` only when the flag is set; nothing in 2-1 sets it), `worktreePrune`, `statusPorcelain`, `currentBranch`, `aheadBehind` (`rev-list --left-right --count base...branch`). |
| `src/main/services/worktrees.ts` | NEW. Derivation helpers (`shortIdFrom`, `worktreeRootFor`, `worktreePathFor`, `branchFor` per D23/D26h); `GitWorktreeManager` (`createWorktree` DB-first journal with collision retry; `removeWorktree(worktreeId, {deleteBranch?, forceDirty?})` sequenced after owning-session death with Windows lock retry/backoff; `isClean`; `getDirtyFiles`; `reconcileAll`); the PURE `computeWorktreeReconcile(rows, gitEntries, managedDirs, sessionRowIds)` implementing the spec §6 evidence matrix (P1a–P5) — no Electron/fs/DB/git imports in the pure core. `reconcileAll` applies only non-destructive actions (promote/detach/delete-row-when-provably-nothing/adopt-as-detached) and logs+returns surface-prune / surface-orphan-dir findings, never actioning them. |
| `src/main/db/schema.ts` | EDIT. `worktrees` Drizzle table (id PK, project_id, session_id nullable, path UNIQUE, branch, base_branch, repo_root, status, created_at) + `worktreeId: text('worktree_id')` nullable on sessions. Export `WorktreeRow`/`NewWorktreeRow`. |
| `src/main/services/storage.ts` | EDIT. 4th `MIGRATIONS` entry (CREATE TABLE worktrees + ALTER TABLE sessions ADD COLUMN worktree_id TEXT — DDL matching Drizzle names/types exactly; both statements in the one entry, runner applies atomically). Accessors: `createWorktreeRow`, `getWorktreesForProject`, `getAllWorktrees`, `getWorktreeById`, `updateWorktreeStatus`, `activateWorktreeForSession` (ONE `this.d.transaction`: worktree sessionId+status='active' + session worktreeId+cwd — resolution a), `detachWorktree` (ONE transaction: clear both pointers, status='detached'), `deleteWorktreeRow`. |
| `src/main/index.ts` | EDIT. Construct `GitWorktreeManager` after `sessions.bindStorage(storage)`; make the `whenReady` callback async; `await worktrees.reconcileAll()` after storage init/registerIpc/exit-listener wiring and BEFORE `void sessions.restore(project.id)`. |
| `src/main/services/worktrees.test.ts` | NEW. Vitest per §10. |

Key invariants (from ImplementationSpec-2-1 §8):
- The worktrees row is inserted `creating` BEFORE any fs/git op; `active` only after success; path deterministic from the worktree UUID (D26 Q2).
- Both pointer columns written in ONE transaction at activation, cleared in one at detach (resolution a).
- `computeWorktreeReconcile` is pure; evidence first, journal second (b); adoption is `detached` (c); no "alive" branch (d); `removing` rule is (e).
- Reconcile is idempotent, never auto-prunes, never auto-deletes an orphan directory, runs awaited before restore, and does not double-heal session rows.
- `git.ts` uses `execFile` with argument arrays only; `--force` exists solely behind `worktreeRemove`'s flag; `force: true` has ZERO callers in 2-1 (grep-verifiable).
- Migration v4 is the 4th `MIGRATIONS` entry; runner untouched; reconcile inert on the current empty-worktrees DB.
- `createWorktree`'s mkdir creates the PARENT root only (`worktreeRootFor`), never the `wt-<id>` dir itself — `git worktree add` creates that.

## §8 Strict Non-Goals

- No IPC channels, no preload forwarders, no renderer components (those are 2-2/2-3/2-4).
- No launch-flow change — `session:launch` untouched; no worktree is ever CREATED in 2-1 (only the data layer + reconcile of already-existing rows, of which there are none on current DBs).
- No auto-merge, ever.
- No un-gated `--force` (the flag exists, zero callers here).
- No automatic `git worktree prune` at boot — reconcile surfaces, never prunes.
- No branch deletion.
- No settings screen.
- No SessionManager API growth.
- Migration runner untouched — only the 4th array entry is added.
- Do not revert, stage, or commit unrelated or untracked files, including `_verify/` and anything under `docs/`.

## §9 Required Workflow

1. Ground per §4.
2. **Chore commit first (D24):** edit `main.css`, boot the app, verify restored spacing at runtime (screenshot LaunchDialog / Ctrl+K palette padding), commit ALONE with a chore-style message (precedent: repo commit `de98679`), co-author trailer included.
3. Implement in spec order: `git.ts` (verify flags per D4 as you go) → derivation helpers + pure `computeWorktreeReconcile` → `worktrees.test.ts` red/green → schema + migration v4 → storage accessors → `GitWorktreeManager` → boot wiring. Run `npm run typecheck` + `npx vitest run` after the pure core before wiring boot.
4. Self-review the diff against CLAUDE.md, D7/D23/D24/D26(+i/j), the Task-2-1.md Review Checklist.
5. Run verification (§10).
6. ONE task commit (plus the earlier chore commit), style of repo commit `80e69c3` (plain-English paragraph, then "Technical notes:" bullets); state the D4 flag-verification outcome in the message; verify `git config user.email` = `mwilson29072@gmail.com`; end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; do not push, do not open a PR, do not amend or rebase existing commits.

## §10 Verification Commands

```powershell
npm run typecheck   # zero errors (G1)
npx vitest run      # green — 84 existing + new worktrees.test.ts cases
git --version       # 2.50.0.windows.1
git worktree -h     # D4 flag verification
git status -h       # D4 flag verification
# app launch: restore ComSpec/PATH, then
node node_modules/electron-vite/bin/electron-vite.js dev -- --remote-debugging-port=9222
```

New unit tests (in `src/main/services/worktrees.test.ts`): `computeWorktreeReconcile` over every evidence-matrix row P1a–P5 (spec §6 is normative); resolution cases — (b) `creating`/`provisioning` + entry + dir promotes to `active` when the session row exists, `detached` when absent; (c) population-4 adoption is `detached`, never `active`; (d) population-2 surfaces as prune candidate unconditionally; (e) `removing` with nothing left → delete-row, with any remnant → detach+surface; idempotency — feeding the post-action state back yields only `none`/`surface-*` actions; crash seams — `creating` row with no entry and no dir → delete-row; `provisioning` row with dir but no entry → surface-orphan-dir + detach (never delete the dir); derivation helpers — `shortIdFrom`/`worktreePathFor`/`branchFor` produce the exact D23/D26h strings for known inputs; `parseWorktreePorcelain` — multi-entry porcelain output, detached-HEAD entry, bare entry.

RUN the app, don't just compile (G2). Runtime script, numbered, each with its exact observable (screenshot each step):
1. F15 chore verification (before the chore commit): boot → open the launch dialog and the Ctrl+K palette → padding/margins render at designed values (LaunchDialog `p-5`/`mt-3`, palette `pt-24`) — screenshot before/after the CSS edit if practical (HMR applies CSS live).
2. After the task changes: cold boot (tree-kill first per §3(e)) on the existing dev DB → boot log shows migration v4 applied; the app opens normally; existing projects/sessions intact (zero data loss); auto-restore of the Chorus project behaves exactly as before.
3. DB dump (§3(h) method, retry once): `schema_migrations` = versions 1,2,3,4; `worktrees` table exists with the full column set; `PRAGMA table_info(sessions)` shows `worktree_id`.
4. Reconcile inert: `SELECT count(*) FROM worktrees` = 0; `git worktree list` unchanged (one entry); no worktree rows created; `sessions.status` values unchanged vs a pre-boot dump (no spurious heals).
5. Second cold boot → migration NOT re-applied (still exactly versions 1–4); reconcile still inert (idempotency at the boot level).
6. Manual population probe (headless, no UI): hand-insert `worktrees` rows via an `ELECTRON_RUN_AS_NODE` better-sqlite3 script pointing at a real throwaway repo (create one under the scratchpad; NOT the Chorus repo) covering at least: a `creating` row with no git entry/dir (expect delete-row), a `provisioning` row with entry+dir (expect promote→detached since its session_id is null or fabricated), an `active` row whose dir you delete by hand (expect surface-prune, NOT auto-prune — row survives, git metadata survives), and a real `git worktree add` under the managed root with NO row (expect adopt-as-detached + surface). Reboot (or invoke reconcileAll headlessly) → dump → each row in the matrix-specified end state; run again → unchanged (idempotency). Confirm NO `git worktree prune` ran (the by-hand-deleted worktree still appears in `git worktree list`). Clean up probe rows AND the throwaway repo afterward; leave the dev DB's legitimate rows alone.
7. Grep gates: `grep -rn -- "--force" src/` → matches only the `worktreeRemove` flag branch in `git.ts`, and `grep -rn "force: true" src/` → zero matches; `grep -rni "worktree" src/renderer/` → nothing (renderer untouched beyond the CSS chore).

## §11 Failure Honesty Clause

Capture exact output on any failure, explain it, report it; never claim success not directly observed. Specifically may NOT be reported as success: a migration you did not verify by dumping `schema_migrations` on the REAL dev DB; reconcile inertness without before/after dumps; probe-row end states without the actual post-boot dump; idempotency without a second run; the F15 spacing fix without actually rendering the dialog/palette. The dump-script first-run no-output flake (§3(h)) and the claude auth expiry (§3) are known environment conditions — retry/note them, do not misattribute. If a verification command fails for an unrelated environment reason, capture the exact output, explain it, and do not claim success.

## §12 Final Reporting Requirements

Detailed summary for coordinator review:
- Status: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
- Both commit SHAs (chore + task) with one-line descriptions.
- D4 flag-verification report: what `git worktree -h` / `git status -h` showed vs what the spec assumed; any deviation flagged.
- Files changed — one-line rationale each; anything beyond §7's list flagged loudly with justification.
- Deviations from ImplementationSpec-2-1, with why.
- Verification transcript: typecheck; vitest with new test names and count; runtime items 1–7 individually with what was actually observed (screenshots/dumps referenced by filename).
- Acceptance criteria from Task-2-1.md restated pass/fail.
- Non-goals confirmation — each §8 item untouched.
- Residual risks / notes for the coordinator — anything learned about git worktree behavior on this machine (locking, porcelain quirks, ConPTY handle behavior) that binds 2-2/2-3/2-4.
- Final git output fenced: `git status --porcelain` and `git log --oneline -3`.
