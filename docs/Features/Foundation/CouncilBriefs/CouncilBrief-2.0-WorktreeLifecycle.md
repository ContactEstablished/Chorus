# Council Brief CR-2.0 — Worktree Lifecycle & Crash Reconciliation for Chorus

_Issued 2026-07-20 · Status: AWAITING FINDINGS · Decision owner: Matthew Wilson · Recorder: Claude (roadmap §6)_

You are a review council of independent LLM models. Deliberate on the decision below and return findings in the **Required Output Format** at the end. You have no other context on this project — everything you need is in this document. Where you are uncertain about an external fact, say so explicitly rather than guessing.

---

## 1. What Chorus is

Chorus is a local-first Windows desktop app (Electron 43 + Vue 3 + TypeScript + Vite + Pinia) for running multiple AI coding agents (Claude Code, Codex CLI — real interactive TUIs) in parallel terminal panes. Each pane hosts an xterm.js terminal attached over typed IPC to a PTY session (node-pty/ConPTY) owned by the Electron **main** process. The renderer is strictly a view layer. The product's **prime contract**: launch, watch, control, and persist many concurrent agent sessions across multiple projects — restart-safe and cleanly killable — from a single window.

Locked rules (not up for review): sessions live in main, owned by `SessionManager`; all Zod validation in main only; renderer never spawns processes; IPC payloads are plain objects; SQLite (better-sqlite3 + Drizzle typed queries) with hand-rolled versioned migrations; git operations run through a controlled main-process adapter (native git CLI, `execFile`, never a shell); **never auto-merge** agent branches in v1.

## 2. Why Phase 2 exists

Parallel *writing* agents must not share one working tree — two agents editing the same checkout corrupt each other's work. Phase 2 adds git-worktree isolation: when a second agent targets a repo another agent is already writing to, it gets its own worktree (own directory, own branch, shared object store). The user integrates results manually — Chorus creates and cleans up worktrees but never merges.

This council is **the phase's pre-identified data-loss checkpoint**. A worktree can hold hours of uncommitted agent work. Creation is multi-step and can be interrupted by a crash. Cleanup is a destructive filesystem + git operation. The lifecycle contract you produce here governs every destructive path in the phase.

## 3. Current implementation state (verified 2026-07-20, commit `59e7909`)

- **Persistence:** `sessions` — `id` (stable UUID PK), `project_id` FK, `agent` (`'claude'|'codex'`), `cwd` (plain TEXT), `status` (`'running'|'exited'`), `exit_code`, `title`, `created_at`. `pane_layouts.layout_json` — a versioned binary split tree whose leaves bind `sessionId`. No `worktrees` table, no `worktree_id` column, nothing git-aware anywhere in the codebase. Migrations are a hand-rolled numbered array (3 applied); the dev DB must upgrade in place with zero manual steps.
- **The restore contract (D16, settled — not up for review):** on boot and on project activation, `restore(projectId)` relaunches {layout leaves ∩ `running` rows}: heal-first (a `running` row with no leaf flips to `exited` before any spawn), per-spawn `fs.existsSync(cwd)` validation (missing → healed + the pane's own "Working directory not found" chrome), 500 ms stagger, `running` written only after spawn success. Restored TUIs are **fresh processes** — a relaunch is a new agent conversation.
- **Session close deletes the session row** (settled): kill → awaited exit → leaf removed → `session:delete` (main refuses while the PTY is live). Leafless rows are unreachable under the restore set, so close-flow deletion is the coherent cleanup. **A worktree tied 1:1 to a session row would be orphaned by this deletion** — or must block it, or must outlive it. That tension is yours to resolve (Q1).
- **Launch flow:** dialog → `session:launch {project_id, agent, cwd}` → cwd validated (absolute + exists, main-side) → row created → PTY spawned. `cwd` is free-form: any absolute existing directory, defaulting to the project root. Projects have a `root_path`, but a session's cwd may be any directory — repo identity is not modeled anywhere and must be computed (e.g. `git rev-parse --show-toplevel`).
- **Scale bounds:** 16-pane soft cap per project; restore cap 16. Worktree count is bounded by the same order of magnitude.
- **Windows reality:** an agent CLI running in a worktree holds open handles on that directory (cwd of a live ConPTY process tree). Removing a directory a live process sits in fails on Windows. Any removal path must therefore require the owning session to be dead first — the same ordering `session:delete` already enforces for rows.

## 4. Git worktree facts the options rest on

(Standard git behavior, stated for shared context; the implementer re-verifies against `git worktree --help` on git 2.50 at execution time per project rule D4.)

- `git worktree add <path> -b <branch> <base>` creates branch + worktree directory in one command, but the operation touches multiple stores (refs, worktree admin metadata in `.git/worktrees/`, the new directory). A crash can leave partial state.
- `git worktree remove <path>` **refuses** when the worktree contains modified or untracked files; `--force` overrides. Committed work on the branch survives removal (shared object store); **uncommitted changes and untracked files are destroyed**.
- `git worktree list --porcelain` is the machine-readable ground truth of what git believes exists.
- `git worktree prune` deletes administrative entries whose directories have vanished (e.g. user deleted the folder by hand).
- The same branch cannot be checked out in two worktrees simultaneously; git refuses.
- Worktrees are cheap (no object duplication) but tooling that assumes `.git` is a directory (it is a file in a worktree) can hiccup.

## 5. The decision

**What is the lifecycle contract of a Chorus-managed worktree — creation, crash reconciliation, and destruction — such that uncommitted agent work is never silently lost?** This shapes the `worktrees` schema (migration v4), the `GitWorktreeManager` service, and the boot reconcile pass, all landing in Phase 2.

### Q1 — Coupling: is a worktree owned by its session, or an independent resource?

- **Option A — session-owned (1:1):** `sessions.worktree_id` + a worktrees row per isolated session; closing the pane drives worktree cleanup (with a dirty-check gate). Simple mental model: pane == workspace. Weakness: session close currently *deletes* the row after kill; an agent leaves uncommitted work, user closes the pane reflexively, and the cleanup prompt is the only thing standing between that work and destruction. Also: a session can be restarted (fresh PTY, same row) — the worktree must survive restarts regardless.
- **Option B — independent resource:** worktrees are a first-class per-project resource (own table, own lifecycle, own UI list); sessions *reference* one (`worktree_id` nullable). Closing a session never touches the worktree; cleanup is always an explicit, separate act against the worktree list. Weakness: worktrees accumulate by default; the "cheap isolated workspace" becomes a chore list, and an invisible directory pile grows under the worktree root.
- **Option C — hybrid (owned with retention):** session-owned for creation/attribution, but close only *offers* cleanup when clean and *always retains* when dirty (worktree row flips to a `detached`/`orphaned` state the UI surfaces later). Weakness: the retained-worktree list is a new UI surface Phase 2 must then ship at least minimally.

Also specify: does `session:delete` (row deletion) cascade, block, or detach when a worktrees row references the session?

### Q2 — Lifecycle states and crash-safe creation

Propose the `worktrees.status` state set (PLAN sketches `(id, project_id, session_id, path, branch, base_branch, status)`). Creation is multi-step (mkdir parents → `git worktree add -b` → DB row → session launch with cwd = worktree path). Specify the ordering and the crash story at each seam: is the DB row written *before* the git operation (journal-style, `creating`, so reconcile can finish or roll back a half-made worktree) or *after* (git is ground truth, DB is a cache)? A crash between `git worktree add` and the row write leaves an untracked-by-Chorus worktree; a crash the other way leaves a row pointing at nothing. Pick a side and give reconcile the matching rule.

### Q3 — The boot reconcile contract

On boot (and project activation), Chorus must reconcile three sources: the `worktrees` table, `git worktree list --porcelain` (per known repo), and the filesystem. Populations: (1) row + git entry + directory — healthy; (2) row + git entry, directory gone (user deleted by hand) — prune candidate; (3) row, no git entry — stale row; (4) git entry under Chorus's managed worktree root, no row — crash mid-create or foreign; (5) directory exists, git entry gone. For each: heal silently, surface to the user, or leave alone? Where does `git worktree prune` fit, and is it ever run automatically? The reconcile must be idempotent and must compose with the existing D16 session restore (a session whose cwd is a vanished worktree already heals to exited "Working directory not found" chrome — reconcile ordering relative to restore matters).

### Q4 — Destruction semantics: what may be removed, when, by whom?

Define "clean enough to auto-remove": empty `git status --porcelain` only, or also zero commits ahead of the base branch (committed-but-unmerged work is safe in the object store but *invisible* once the worktree and its UI listing vanish — is a branch with unmerged commits removable without ceremony)? What confirmation gates dirty removal (typed confirmation? show the dirty file list? never offer at all)? Is `--force` ever used by Chorus, or is dirty removal simply refused with guidance? What happens to the **branch** on worktree removal — never auto-deleted (safest, litters branches), deleted when fully merged into base, or user's choice? State the exact rule set an implementer can code from.

### Q5 — Option-fixation check

Is there a failure mode in ANY of the above that should force a different shape entirely (e.g. a trash-can model — worktrees moved to a graveyard dir instead of removed; a `git stash`/bundle snapshot before any destructive op; copy-on-remove archives)? Name it only if load-bearing — this is a check against option fixation, not an invitation to bikeshed.

## 6. Constraints the winner must survive

1. **The data-loss rule (prime directive of this CR):** no code path — including reconcile — may destroy uncommitted work without an explicit, informed user confirmation naming what will be lost. A crash at any point must never make that decision for the user.
2. **Crash-correctness:** a hard crash and a clean quit must converge to the same reconciled state at next boot; reconcile is idempotent.
3. **Never auto-merge** (locked, v1): integration of agent branches is manual, outside Chorus's write paths.
4. **Windows removal ordering:** a worktree directory cannot be removed while the owning session's process tree lives (open handles). Removal paths must sequence after kill + awaited exit, mirroring `session:delete`.
5. **Migration cost:** the dev DB (5 tables, 3 migrations applied) upgrades in place with zero manual steps; the schema should not need re-migration when Phase 3 adds adapters (a `role` concept, richer modes).
6. **D16 compatibility:** session restore already handles vanished cwds (heal → exited chrome). The worktree reconcile must not fight it — no double-healing, no restore spawning into a worktree the reconcile is about to act on.
7. **Bounded scale:** ≤16 panes/project; a reconcile pass may shell out to git a handful of times per repo per boot, but not per-session-per-second.

## 7. Evaluation rubric (weigh in this order)

1. **Data-loss safety** — uncommitted work survives every crash/cleanup/reconcile path without user heroics (35%).
2. **Crash-correctness & idempotent reconcile** — partial creation, hand-deleted dirs, and stale rows all converge (25%).
3. **Contract simplicity & UX honesty** — a user can predict what closing a pane does; state count stays small (15%).
4. **Implementation cost inside one phase** — this is 3–5 tasks, not a platform (15%).
5. **Forward compatibility** — Phase 3 adapters (roles, read-only mode, capability flags), possible future `--resume`, pop-out windows (10%).

## 8. Questions for the council

1. Q1: A, B, C, or a named hybrid — including the `session:delete` cascade/block/detach call — and the **strongest argument against** your choice.
2. Q2: the state set, the creation ordering (DB-first journal vs git-first), and the crash rule at each seam.
3. Q3: the reconcile rule for each of the five populations, `git worktree prune` policy, and ordering relative to D16 restore.
4. Q4: the exact destruction rule set — auto-remove criteria, dirty-removal gating, `--force` policy, branch retention.
5. Q5 as posed: load-bearing alternative shapes only.

## 9. Success criteria for this council session

The council **succeeds** if it returns: (a) one committed answer per question Q1–Q4, or an explicit tie with the tie-breaker named; (b) the worktree lifecycle contract restated as 4–8 sentences an implementer can code from verbatim; (c) an enumerated risk list with mitigations; (d) explicit dissents preserved — do not average away disagreement. The council **fails** if it returns a survey without commitment, or unanimity achieved by dropping the rubric.

## 10. Required output format

```
## Per-model positions
<model>: Q1 <choice> / Q2 <one-line rule> / Q3 <one-line rule> / Q4 <one-line rule> — <2-4 sentence rationale> — Strongest counterargument: <1-2 sentences>

## Council synthesis
Q1: <A|B|C|hybrid(named)> + session:delete semantics (<unanimous | majority N-of-M>)
Q2: <states + ordering + crash rules, 2-4 sentences> (<vote>)
Q3: <per-population rules + prune policy + restore ordering, 2-5 sentences> (<vote>)
Q4: <destruction rule set, 2-5 sentences> (<vote>)
Dissents: <model: position and unresolved reason, or "none">

## The worktree lifecycle contract (verbatim, implementable)
<4-8 sentences>

## Risks & mitigations for the winner
1. <risk> → <mitigation>
...

## Answer to question 5
<concise; "none load-bearing" is acceptable>

## Action items for implementation
<numbered, imperative, each verifiable>
```
