# Phase 2 — Worktrees

## Source Of Truth

- Roadmap: `docs/Features/Foundation/roadmap.md` — §5 (Verified Ground Facts), §6 decisions **D22–D26** (Phase 2 kickoff + the CR-2.0 lifecycle contract and coordinator resolutions a–h), §7 Phase 2 sketch.
- Council: `docs/Features/Foundation/CouncilBriefs/CouncilBrief-2.0-Findings.md` (CR-2.0 findings — lifecycle contract, risks, action items). **Where D26's resolutions (a)–(h) conflict with the findings, D26 wins** (the findings are the raw council output; D26 patches them).
- `docs/PLAN.md` §5 (Git Isolation & Worktrees), §13 (target data model — the `worktrees` table), §14 (Phase 2 line).
- Project rules: `CLAUDE.md` (locked architecture; D1 Zod-in-main; D14 plain-object IPC; verify CLI/git flags against `--help` at execution time).
- **Verified codebase state: 2026-07-20, commit `59e7909`** (Phase 1b complete). Each task doc anchors insertion points to **named symbols**, never line numbers (house rule, per `Phase-1b-Overview.md`).

## Goal

Phase 1/1b delivered a presentation-and-input layer over a single shared working tree. Phase 2 makes **two writing agents safely share one repository** by giving each its own **git worktree** — an isolated checkout that shares the repo's object store. It adds a controlled git process adapter, a `worktrees` data layer with a crash-safe DB-first lifecycle, a boot reconcile that heals worktree state against `git worktree list` before session restore, three launch-time **workspace modes**, cleanup/retention flows, and a per-focused-pane **diff summary**. The prime directive is preserved end to end: **uncommitted agent work is never silently destroyed**, `--force` reaches git only inside the single typed-confirmation dirty-removal path (D26(i)), and nothing is ever auto-merged.

## The Four Tasks

Phase 2 is decomposed into four tasks executed **serially**. 2-1 lays the git adapter + data layer + reconcile (nothing user-visible except the F15 chore); 2-2 wires the launch modes on top; 2-3 adds cleanup + the retained-worktree panel; 2-4 adds the diff summary and closes the phase milestone.

| Task | One-line scope | Depends on |
|------|----------------|------------|
| **2-1** | **Git adapter, worktrees data layer, reconcile engine (+ F15 chore).** New `git.ts` (controlled `execFile` git adapter) + `worktrees.ts` (`GitWorktreeManager` + pure `computeWorktreeReconcile`); migration v4 (`worktrees` table + `sessions.worktree_id`); `index.ts` awaits reconcile before restore. **A separate F15 chore commit first** (D24). No IPC/UI/launch changes. | Phase 1b |
| **2-2** | **Workspace modes + auto-worktree launch flow.** `workspace_mode` on the launch payload; repo context on `session:launch-context` (repo root, live-sessions-in-repo, suggested mode, pickable worktrees); `session:launch` executes the chosen mode; LaunchDialog mode selector + picker; branch label in the pane header. | 2-1 |
| **2-3** | **Cleanup flows, retained-worktree panel, reconcile surfacing.** `worktree:list` / `worktree:remove` / `worktree:dirty-files`; `session:delete` grows the detach step; close-flow clean-removal offer / dirty-detach; new `WorktreePanel.vue` (typed-confirmation gate, "Also delete branch" opt-in, prune candidates); "Manage worktrees" palette command. | 2-2 |
| **2-4** | **Diff summary.** `worktree:diff-summary` (`git diff --shortstat HEAD` + porcelain untracked count via the 2-1 adapter); counts in the FOCUSED pane's header, refreshed on an interval ≥15 s and on focus (F12 debounce discipline). Closes the phase milestone. | 2-3 |

Dependency chain: **2-1 → 2-2 → 2-3 → 2-4** (strictly serial).

### File-ownership matrix

Overlapping files across tasks are **legal only because execution is serial** — each later task starts only after the prior task's commit exists, and touches a disjoint region of any shared file. `git.ts` and `worktrees.ts` are created by 2-1 and consumed by later tasks (2-4 minimally extends `git.ts` with a shortstat parser — called out explicitly below).

| File | 2-1 | 2-2 | 2-3 | 2-4 |
|------|:---:|:---:|:---:|:---:|
| `src/main/services/git.ts` | **create** | consume | consume | **edit** (shortstat parser) |
| `src/main/services/worktrees.ts` | **create** | consume | consume (extend if needed) | consume |
| `src/main/services/worktrees.test.ts` | **create** | — | — | — |
| `src/main/db/schema.ts` | **edit** (worktrees table + `worktree_id`) | — | — | — |
| `src/main/services/storage.ts` | **edit** (v4 + worktree accessors) | edit (launch link) | edit (detach op) | — |
| `src/main/index.ts` | **edit** (await reconcile) | — | — | — |
| `src/renderer/src/assets/main.css` | **edit** (F15 chore commit) | — | — | — |
| `src/shared/ipc.ts` | — | edit (modes, launch-context repo ctx, `branch`) | edit (worktree channels) | edit (diff-summary channel) |
| `src/main/ipc.ts` | — | edit (launch modes) | edit (worktree handlers, delete detach) | edit (diff-summary handler) |
| `src/preload/index.ts` | — | edit (forwarders) | edit (worktree forwarders) | edit (diff forwarder) |
| `src/renderer/src/components/LaunchDialog.vue` | — | **edit** (mode selector/picker) | — | — |
| `src/renderer/src/components/TerminalPane.vue` | — | edit (branch label) | edit (close flow) | edit (diff counts) |
| `src/renderer/src/components/WorktreePanel.vue` | — | — | **create** | reuse |
| `src/renderer/src/palette/commands.ts` | — | — | **edit** (Manage worktrees cmd) | — |
| `src/renderer/src/App.vue` | — | — | **edit** (panel mount) | — |
| `src/shared/ipc.test.ts` | — | edit | edit | edit |
| `src/renderer/src/palette/commands.test.ts` | — | — | edit | — |

`src/shared/ipc.ts`, `src/main/ipc.ts`, and `src/preload/index.ts` are touched by **2-2/2-3/2-4 in disjoint regions** (launch modes vs cleanup channels vs diff channel). `TerminalPane.vue` is touched by **2-2/2-3/2-4** (branch label vs close flow vs diff counts). `WorktreePanel.vue` is created by 2-3 and reused (open-time diff call) by 2-4. `src/preload/index.d.ts` is never hand-edited — `ChorusApi` is inferred from the preload object.

Because ownership overlaps across the serial chain, every task doc repeats the same guard: implementers work only inside their listed scope and **must not revert, stage, or commit files they did not change**, including untracked `_verify/` harness artifacts and anything under `docs/`.

## Shared Context — what Phase 1/1b left behind that binds here

Phase 2 builds on these facts; implementers do not relitigate them.

- **The D16 restore engine + cwd healing.** `SessionManager.restore(projectId)` relaunches the restore set (layout leaves ∩ `running` rows), heal-first, cwd-validated per spawn (`fs.existsSync(row.cwd)` → missing rows heal to `exited` with the pane's own "Working directory not found" chrome), 500 ms-staggered, cap 16. **A session whose cwd was a vanished worktree already converges correctly** — the worktree reconcile must NOT fight this (no double-healing): reconcile acts on `worktrees` rows; restore heals `sessions` rows; they touch different tables and converge independently.
- **The boot sequence** (`src/main/index.ts`, inside `app.whenReady().then(...)`): storage init → active-project resolution → `registerIpc(sessions, storage)` → `watchSessionExits` + the D11 exit listener → `void sessions.restore(project.id)` (**not awaited today**) → `createWindow`. **Phase 2 changes this:** worktree reconcile (for all repos known to the `worktrees` table) is **awaited before** `void sessions.restore(...)` (D26 Q3; findings risk 4). The callback becomes `async` to permit the await.
- **The launch flow shape.** `session:launch` today validates cwd (absolute + exists, the main-side security boundary), enforces the 16-pane soft cap, `storage.createSession(...)`, `sessions.launch(agent, cwd, row.id)`, `pushRecentCwd`, returns the attach snapshot. `launchRequestSchema` is `{project_id, agent, cwd}`. `session:launch-context` returns `{projectRoot, recentCwds}`.
- **Close-flow row deletion (D16 clause 5).** `TerminalPane.onClose`: kill → awaited exit → `layoutStore.removeLeaf` → `session:delete` (main refuses a live session, then `storage.deleteSession`). Phase 2 hooks the worktree **detach/offer** into this exact flow (2-3).
- **F13 — async `onMounted` bail rule.** Any new component with awaits in `onMounted` (e.g. `WorktreePanel.vue`, or LaunchDialog's context fetch) must bail after each `await` if it may have unmounted (`cleanups` run once; post-cleanup registrations leak). `WorktreePanel` follows the `LaunchDialog` focus-trap idiom.
- **F12 debounce discipline.** Live/twitchy sources must not drive per-keystroke or per-second IPC. The diff-summary poll (2-4) is bounded to an interval ≥15 s AND on focus, focused pane only — never per-keystroke, never for unfocused cards. Filmstrip cards read persisted/static values, not live streams.
- **Harness caveats pointer (roadmap §5, F3/F7/F8/F9/F11).** CDP on `--remote-debugging-port=9222` is the proven runtime driver (`Runtime.evaluate` in IIFEs, `Page.captureScreenshot`, `Input.insertText`); `ws` lives in the session scratchpad, never the repo; kill process **trees** (`taskkill /PID <root> /T /F`); graceful-quit test = `taskkill` without `/F`; `ELECTRON_RUN_AS_NODE=1` scripts print nothing to console (write to a file); the better-sqlite3 dump script intermittently produces no file on first run — **retry once**. The dev DB at `%APPDATA%\chorus\chorus.db` holds legitimate artifacts (second project `Chorus-Second`, `view_state:` rows) — **do not clean up**. **Claude Code CLI is currently UNAUTHENTICATED** (token expired) — runtime tests needing a real agent reply should prefer Codex or plain observation.

## Decisions (Matthew / council, 2026-07-20 — quoted, not relitigated)

- **D22 — Three workspace modes ship.** Current working tree (default for a lone agent) · new isolated worktree (dialog DEFAULT when ≥1 other live session's cwd resolves to the same repo root) · existing worktree (picker over retained worktrees). Read-only is **deferred** (unenforceable for PTY agents until adapter permission modes exist — PLAN §12). The mode is **always explicit in the launch payload; main never silently overrides**.
- **D23 (+D26h) — Worktree location & branch convention.** Worktrees live OUTSIDE the repo in a sibling dir: `<repo-parent>\.chorus\<repo-name>\wt-<short-worktree-id>`; branches are `chorus/<repo-name>/<short-worktree-id>`; **short id = the first 8 hex chars of the worktree row UUID** (per D26h: the segment is derived from the WORKTREE row, not the session — worktrees outlive sessions, so a session-derived name goes stale on detach/re-attach). Retry with a fresh suffix on a `git worktree add` collision. The PLAN §5 `role` segment is dropped until Phase 3.
- **D24 — F15 chore.** `src/renderer/src/assets/main.css` has an **unlayered** `*, *::before, *::after { … margin: 0; padding: 0 }` reset after `@import 'tailwindcss'` that nullifies every Tailwind margin/padding utility app-wide. It is fixed as a **separate flagged chore commit at the START of the Task 2-1 execution session** (drop the reset or move it into a layer — Tailwind preflight already resets). **G3 is amended for this one chore: the 2-1 session makes two commits (chore first, then the task commit).** The visual effect (app-wide margins/paddings return to designed values) is verified in 2-1's G2 runtime pass.
- **D25 — F14 deferred.** The restart-event asymmetry (`session:restart` emits no `session:restored`) stays as-is. Phase 2 as scoped **adds no restart driver** — do NOT add restart-event changes.
- **D26 — The worktree lifecycle contract** (CR-2.0, unanimous 3-of-3). The findings' 8-sentence "worktree lifecycle contract (verbatim, implementable)", **as patched by resolutions (a)–(h)**, is the normative contract:

  > 1. A worktree is created by a session and attributed to it via `sessions.worktree_id`, but outlives its owning session by design.
  > 2. Creation is DB-first journaled: a `worktrees` row is inserted with `status = 'creating'` before any filesystem or git operation; the path is deterministic from the worktree UUID; `git worktree add` follows; the row is promoted to `active` only after success.
  > 3. Boot reconcile runs before session restore, classifying every combination of `worktrees` row, `git worktree list --porcelain` entry, and filesystem directory across five populations with keep/heal/promote/surface/delete rules per population.
  > 4. A worktree is "clean enough to auto-remove" when `git status --porcelain` returns empty; committed-but-unmerged work on its branch survives in the object store and the branch is kept by default.
  > 5. Closing a session with a clean worktree offers auto-removal; closing with a dirty worktree transitions it to `detached` status, decoupled from the session, surfaced in a retained-worktree list, never silently destroyed.
  > 6. Explicit removal of a detached worktree requires typed confirmation naming the worktree path if dirty; branches are never auto-deleted and require a separate opt-in checkbox.
  > 7. `git worktree remove --force` is never used by Chorus; all destructive operations are gated behind an explicit, informed user confirmation that names what will be lost.
  > 8. Worktree directory removal sequences after the owning session's process tree has exited, respecting the Windows open-handle constraint; removal retries on lock failures with backoff.

  **The binding resolutions (a)–(h) that PATCH the findings:**
  - **(a)** Both pointer columns ship (PLAN §13): `worktrees.session_id` AND `sessions.worktree_id`. `worktrees.session_id` is authoritative; both are written in **one synchronous transaction** at activation and cleared in one transaction at detach.
  - **(b)** Reconcile classifies by **EVIDENCE first** (git entry × directory), journal status second — `creating`/`provisioning` rows with a valid git entry + directory are **promoted** (to `active` when the owning session ROW stands, else `detached`), closing the creating-with-git-entry crash gap the findings' Q2 rules skipped.
  - **(c)** Population-4 adoption rows (git entry under managed root, no row) are born **`detached`**, not the findings' `active` (no owning session ⇒ detached under the council's own state model).
  - **(d)** Population 2's "session still alive" branch is **vacuous** (reconcile runs pre-restore, when nothing is alive) — the rule collapses to **surface-as-prune-candidate**.
  - **(e)** `removing` crash rule (unspecified in findings): re-classify by evidence — git entry AND directory both gone → **delete row**; anything remaining → revert to **`detached`** and surface.
  - **(f)** The auto-worktree trigger is precisely: the launch dialog's mode DEFAULT flips to new-worktree when **≥1 other LIVE session's cwd resolves to the same repo root** (computed in main, delivered via `session:launch-context`); the chosen mode always travels explicitly in the launch payload — **main never silently overrides** (this supersedes findings action 4's "main auto-creates" phrasing).
  - **(g)** The retained-worktree list ships as a **minimal overlay dialog** (LaunchDialog idiom) + a palette command — **NOT a settings panel** (none exists; CLAUDE.md bars jumping ahead to settings screens). Columns per findings risk 6: path, branch, clean/dirty, Remove (this supersedes findings action 5/7/risk 6's "settings panel" phrasing).
  - **(h)** The D23 short-id path/branch segment is the **worktree row's** short id (see D23 above). Findings risk 5's rename scheme is superseded by (h) + D23; retry-with-fresh-suffix on `git worktree add` collision is kept as cheap defense.
  - **(i) — clause 7 AMENDED at the doc review (Matthew, 2026-07-20):** `--force` is never used EXCEPT inside the single dirty-removal path, after main's typed-confirmation gate has passed — a **targeted `git worktree remove --force <path>`** on the confirmed worktree only. The drafting-stage no-force workaround (`fs.rm` + repo-wide `git worktree prune`) is REJECTED: `prune` is repo-wide and would silently resolve other surfaced prune-candidates without their own confirmation.
  - **(j)** Branch deletion (the opt-in checkbox) runs `git branch -d`; an unmerged refusal is surfaced, and `-D` escalation requires the same typed-confirmation acknowledgment.

## Cross-cutting rules (every task doc repeats these)

- **No new npm dependencies.** Git runs via `node:child_process` (`execFile`, never a shell, never string-concatenated commands); everything else exists. The stack is locked (`CLAUDE.md`).
- **All Zod in main (D1, CSP).** Preload and renderer are Zod-free. Every new renderer→main payload is parsed in the main handler; every main→renderer event is validated in main before sending.
- **D14 plain-object IPC payloads.** Snapshot any store-sourced data (`JSON.parse(JSON.stringify(...))`) before it crosses the bridge; a reactive Proxy is rejected by structured clone at runtime with no compile-time signal.
- **Never auto-merge. `--force` only inside the D26(i)-gated dirty-removal path — nowhere else. No destructive git op without the D26 gates** (clean re-check at execution time + typed confirmation naming what is lost for dirty; branch deletion is opt-in only, `-d` with gated `-D` per D26(j)).
- **One narrated commit per task session (G3)** — plus the flagged **F15 chore commit in 2-1 only** (D24).
- **Verify git flags against the installed git 2.50's own `-h`/`--help` at execution time (D4)** — never from training-data memory.
- **G1 typecheck clean at every task boundary. G2 run, don't just compile** (drive the real app; CDP where headless).

## Gates

| ID | Gate |
|----|------|
| G1 | `npm run typecheck` exits 0 at every task boundary. |
| G2 | **Run, don't just compile** — drive the real app window, observe both TUIs, cross-check `git worktree list` and the sqlite DB; screenshots when headless. |
| G3 | **One** intentional narrated commit per execution session — **plus** the F15 chore commit in 2-1 (D24). |
| G5 | Council Review checkpoint for this phase is **CLOSED** as D26 (CR-2.0, unanimous). No further council pass is required unless an execution session flags a low-confidence, contested, or newly data-loss-adjacent decision. |

(G4, the secret-grep gate, does not apply — Phase 2 touches no credentials.)

## Phase-Level Acceptance Criteria

Phase 2 is complete when all hold:

- [ ] **Migration v4** applies in place on the existing dev DB (3 → 4) with zero manual steps and zero data loss; `worktrees` table + `sessions.worktree_id` exist; the reconcile is inert on an empty `worktrees` table (2-1).
- [ ] The **F15 chore** landed as its own commit; the app-wide margins/paddings render at their designed values (2-1).
- [ ] Launching a lone agent in a git repo defaults to **current tree**; launching a second agent whose cwd resolves to the same repo root **defaults to new isolated worktree**; the existing-worktree picker re-attaches a retained worktree; a non-git cwd shows an inline "not a git repo" state and offers only current-tree (2-2).
- [ ] A new-worktree launch creates `<repo-parent>\.chorus\<repo-name>\wt-<shortId>` on branch `chorus/<repo-name>/<shortId>`, DB-first journaled (`creating`→`provisioning`→`active`), with both pointers written transactionally; `git worktree list` shows the linked worktree (2-2).
- [ ] Closing a session with a **clean** worktree offers removal; closing with a **dirty** worktree silently **detaches** (retained, never destroyed); the retained-worktree panel lists worktrees with path/branch/clean-dirty/ahead-behind and removes only via the typed-confirmation gate, with "Also delete branch" unchecked by default (2-3).
- [ ] Boot **reconcile** classifies all five populations correctly against `git worktree list`, is idempotent (running twice → same end state), never auto-prunes without confirmation, and runs **before** restore (2-1 core; surfaced in 2-3).
- [ ] The **focused** worktree pane's header shows a diff summary (files changed, +insertions, −deletions, untracked), refreshed on an interval ≥15 s and on focus — never per-keystroke, never for unfocused cards (2-4).
- [ ] **Phase milestone (runtime-proven, G2):** two writing agents safely share one repo via isolated worktrees; kill/quit leaves no orphaned live PTY; a restart reconciles worktree state against `git worktree list` and restores sessions into their worktrees without losing uncommitted work (2-4).
- [ ] `npm run typecheck` clean and `npx vitest run` green at every task boundary; one narrated commit per task (+ the F15 chore in 2-1).

## Phase Non-Goals

Explicitly out of scope for Phase 2 (later phases or deliberately deferred):

- **No auto-merge** of agent branches, ever (v1 horizon exclusion).
- **No un-gated `git worktree remove --force`** — the flag exists solely inside the typed-confirmation dirty-removal path (D26 clause 7 as amended by D26(i)); no other code path may pass it.
- **No branch auto-deletion** — branch removal is an explicit opt-in checkbox, unchecked by default (D26 Q4).
- **No read-only workspace mode** (D22 — deferred to Phase 3; unenforceable for PTY agents until adapter permission modes exist).
- **No settings screen / settings panel** — the retained-worktree list is a minimal overlay + palette command (D26g); CLAUDE.md bars jumping ahead to settings/UI screens.
- **No PLAN §5 `role` path segment** (dropped until Phase 3 roles).
- **No Phase-3 adapter work** — no `AgentAdapter` interface, no credential vault, no env-var injection (D5 stands untouched; Phase 3).
- **No restart-driver / restart-event change** (F14 stays deferred per D25; Phase 2 adds no restart driver).
- **No rich diff/preview** (diff is a shortstat summary only; per-file diff viewer is a v1-horizon exclusion).
- **Do not revert, stage, or commit unrelated or untracked files, including `_verify/` and anything under `docs/`.**
