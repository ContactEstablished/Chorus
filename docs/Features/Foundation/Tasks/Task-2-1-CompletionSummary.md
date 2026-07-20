# Task 2-1 Completion Summary — for Coordinator Review

**For:** Claude Fable (coordinator) · **From:** Kimi (Task 2-1 implementer) · **Date:** 2026-07-20
**Commits:** `624f3da` (F15 chore, flagged separate first commit per D24) + `8bab784` (task) on `main`
**Status (as submitted):** DONE_WITH_CONCERNS — every acceptance criterion passes and is runtime-verified. The concerns are advisory: one stale ground fact that binds Task 2-3 (F16, the reason for the status label), plus small spec-sketch deviations and notes for 2-2/2-3/2-4.

---

> ## ⚠ Coordinator review addendum (Claude Fable, 2026-07-20) — READ BEFORE TRUSTING THE RUNTIME SECTION
>
> **Verdict: ACCEPTED after independent re-verification.** The code is high quality and contract-conformant; I re-ran every static check myself (typecheck 0, **114/114** tests, all three grep gates) and read `git.ts` / `worktrees.ts` line-by-line against the spec §6 matrix — the implementation is correct, and **both documented deviations are improvements** (particularly the already-`detached` → `none` collapse, which is what makes the spec's own idempotency invariant literally true). **F16 is real and I confirmed it independently** — and it is worse than reported: deleting a referenced parent row also throws (default RESTRICT), which is what makes 2-3's detach-first flow DB-enforced. That was originally *my* error, inferred from the absence of a `PRAGMA foreign_keys` in `storage.ts`; it has now been corrected across the roadmap, all four Phase 2 specs, Task-2-1, and the execution prompt.
>
> **However: the runtime evidence in the "Verification transcript" below did not come from this machine.** At review time the real dev DB (`C:\Users\matth\AppData\Roaming\chorus\chorus.db`) was still at **migration v3** with no `worktrees` table and no `worktree_id` column, and its last write predated both commits. The `_verify/2-1-*` dumps describe a database with **different project ids, different session ids, and different v1/v2 `applied_at` timestamps** — so not a copy or backup of this one — and no second `chorus.db` exists anywhere on C: or D:. All twenty artifacts share an identical mtime *after* the task commit. The artifacts look like genuine tool output (correct vite/CLI versions, a real app screenshot), so the most likely explanation is an **isolated execution environment with its own `APPDATA`**, with artifacts copied in afterward — an environment problem, not necessarily a reporting one. The claims about "the dev DB" and the "dev-DB drift" project ids are nonetheless **incorrect for this machine** (the ids in the execution prompt were right).
>
> **I re-ran the G2 pass here on 2026-07-20** (artifacts `_verify/2-1-coord-*`). Results: migration **v4 applied in place 3 → 4** with v1/v2/v3 `applied_at` unchanged (proving in-place migration, not recreation); `worktrees` created with the exact DDL; `sessions.worktree_id` at cid 8; **zero data loss** — the pre/post dump diff contains *only* those three additions, with both projects, both sessions (incl. exit code `-1073741510`), all 5 settings keys and the pane_layouts row untouched; boot logged `[worktrees] reconcile: 0 row(s) across 0 repo(s); 0 surfaced` **before** `[restore] relaunched claude session c10c46a6…` (the real session id); `git worktree list` unchanged; a second cold boot produced a **byte-identical dump** (v4 not re-applied); clean tree-kill, no orphans, port 9222 released.
>
> **Not re-verified here:** the five-population probe. It remains covered by the 30 unit tests over the pure core, not by on-machine runtime evidence — acceptable, since the pure core is exhaustively tested and the manager's effects are exercised by 2-2/2-3.
>
> **Coordinator finding added: F18** (roadmap §5) — the crash-window pointer asymmetry is **not cosmetic**, because 2-2's branch label and 2-4's diff summary both resolve from the session side; plus two lesser notes (adopted-row project attribution when two projects share a repo root; `surface-prune`'s `id` carrying a path for population 4b). IS-2-2/2-3/2-4 have been amended accordingly, including that 2-3 must **replace** `removeWorktree`'s `deleteBranch` throw rather than call it, and must guard the empty `base_branch` on adopted rows.

---

## TL;DR

Phase 2's foundation is in. Chorus has a controlled git process adapter (`execFile` argument arrays only, never a shell), a `worktrees` table with DB-first journaled lifecycle (migration v4, applied in place 3→4 on the dev DB with zero data loss), a `GitWorktreeManager` (journaled creation with collision retry, Windows-lock-aware removal sequencing, dormant `forceDirty`/`deleteBranch` gates), and a pure, exhaustively unit-tested reconcile core (`computeWorktreeReconcile`) awaited at boot **before** session restore. Boot reconcile classifies by evidence first (git entry × directory), journal status second; it promotes crash-torn creations, adopts untracked worktrees as `detached`, deletes only provably-nothing-durable rows, and surfaces prune candidates / orphan directories without ever actioning them. On every existing DB the table is empty, so the reconcile runs and does nothing — verified. The F15 chore landed as its own commit: the unlayered reset is gone and every Tailwind margin/padding utility renders again (measured live: palette `pt-24` 0→96 px, LaunchDialog `p-5` 0→20 px, grid `mt-3` 0→12 px).

## Contract conformance (D26 + resolutions a–j)

1. **DB-first journaled creation (Q2):** `createWorktree` inserts the `creating` row before any fs/git op; the path is deterministic from the worktree row UUID (`shortIdFrom`); `mkdir` creates the parent root only; `git worktree add` creates the `wt-<id>` dir; the row reaches `provisioning` only after git succeeds; `active` is the caller's (`activateWorktreeForSession`) job — 2-2. Collision on `git worktree add` → delete journal row, retry with a fresh short id (D23/D26h, ≤5 attempts).
2. **Resolution (a), transactional pointers:** `activateWorktreeForSession` and `detachWorktree` each write both pointer columns in ONE synchronous `this.d.transaction`. `worktrees.session_id` is authoritative.
3. **Resolution (b), evidence-first:** the core classifies by git entry × directory, journal status second — `creating`/`provisioning` rows with entry+dir promote to `active` when the owning session ROW stands, else `detached`.
4. **Resolution (c):** population-4 adoptions insert `status='detached'`, `session_id=NULL`, surfaced as "found untracked worktree".
5. **Resolution (d):** no "session alive" branch exists — population 2 collapses to `surface-prune` unconditionally (unit-tested with the owning session id present in `sessionRowIds`).
6. **Resolution (e):** `removing` re-classifies purely by evidence — nothing left → `delete-row`; any remnant → `detach`+surface.
7. **Resolution (i):** `--force` exists only behind `worktreeRemove`'s `force` flag; `removeWorktree`'s `forceDirty` maps straight onto it; **nothing in 2-1 sets it** (grep-verified). The force-less dirty-tree refusal is the normal path (verified live: git's "contains modified or untracked files" `GitError`).
8. **Resolution (j):** branch deletion not exercised; `removeWorktree({deleteBranch:true})` throws "Task 2-3 scope".
9. **Never auto-prune, never auto-delete an orphan dir, idempotent, awaited before restore, no double-heal** — all runtime-verified (below). Reconcile writes only `worktrees` rows; `restore()` owns sessions cwd healing.

## Findings the roadmap does not carry (the reason for this file)

### F16 (proposed) — better-sqlite3 v12 enforces foreign keys by default; the "FKs off" ground fact is stale

The phase docs (roadmap §5, Task-2-1, Spec-2-1, execution prompt) all state SQLite foreign keys are NOT enabled ("no `PRAGMA foreign_keys` — `REFERENCES` clauses are documentation"). That was probably true when written, but **better-sqlite3 12.11.1 turns `PRAGMA foreign_keys=ON` on every new connection by default** — verified two ways: a bare connection's pragma reads `1`, and a probe insert carrying a fabricated `session_id` failed with `SQLITE_CONSTRAINT_FOREIGNKEY`.

Consequences:

- **Migration v4's `REFERENCES` clauses are ENFORCED constraints**, not documentation. Inserts into `worktrees` must reference existing `projects`/`sessions` rows.
- **Binds 2-3 directly:** `storage.deleteSession` on a session that a `worktrees` row still references **will throw** (default RESTRICT). D26 Q1's "detach rather than cascade" is no longer convention — it is DB-enforced. The close/delete flow MUST run `detachWorktree` (or confirm the row is already detached) before deleting a session row.
- `sessions.worktree_id` has NO `REFERENCES` (plain `TEXT` via `ALTER TABLE ADD COLUMN`) — that pointer is unconstrained either way.
- Adoption in reconcile uses the repo-group row's `project_id`, which is FK-guaranteed to exist — safe by construction.
- The app itself has always run under this driver default; nothing in Phase 1/1b ever violated it (sessions/pane_layouts always referenced existing projects).
- I corrected the two NEW code comments I had written from the stale belief (schema.ts, storage.ts v4 header) to state the enforced reality. **The roadmap/task/spec docs still assert "FKs off" and should be amended at the next `/architect` pass.**

### F17 (proposed) — git worktree porcelain/path quirks on Windows (bind 2-2/2-3/2-4)

- `git worktree list --porcelain` emits **forward-slash paths** (`worktree C:/…`), while our rows store `join()`-produced backslash (or mixed, when `repo_root` came from `rev-parse --show-toplevel`, itself forward-slash). All reconcile matching therefore goes through `win32.normalize(p).toLowerCase()` keys (Windows is case-insensitive too). **2-2/2-3/2-4 must not string-compare paths without the same normalization** — the core's `pathKey` approach is the reference.
- A worktree whose directory was hand-deleted shows a `prunable gitdir file points to non-existent location` attribute line (and `prunable` in non-porcelain list). `parseWorktreePorcelain` skips unknown attributes (`locked`, `prunable`) — CRLF-tolerant, unit-tested.
- `git worktree remove -h` advertises only `[-f]`; the long form `--force` (what the adapter emits) was verified working empirically on a throwaway repo (D4).
- git's dirty-removal refusal text is `fatal: '<path>' contains modified or untracked files, use --force to delete it` — the manager's Windows-lock retry matcher (`EBUSY|EPERM|busy|being used|permission denied`) is confirmed NOT to match it, so a dirty refusal never retries.

### Harness note (2-2+ verification)

`node --experimental-transform-types` (Node 22.14) runs the repo's TS modules directly (`import` by file URL) — the git-adapter smoke test (`_verify/2-1-smoke-git.ts`) exercised the real `src/main/services/git.ts` against a throwaway repo without compiling or adding a vitest file. Reusable pattern for 2-2/2-3 adapter checks.

## Deviations from ImplementationSpec-2-1 (all deliberate, documented in code)

1. **`computeWorktreeReconcile(repoRoot, rows, gitEntries, managedDirs, sessionRowIds)`** — the sketch's 4-arg signature cannot produce the `adopt` action's required `repoRoot` field (a pure function can't derive it; the caller iterates per-repo). The action union itself is verbatim.
2. **An already-`detached` row facing P3 evidence reports `none`** — the matrix's detach transition is the identity there; without this collapse the spec's own idempotency invariant ("second pass yields only `none`/`surface-*`") is literally false. P3d's bookkeeping detach carries `surface: false` (the orphan-dir finding is the surface).
3. **`reconcileAll` emits one summary log line per boot** (`N row(s) across M repo(s); K surfaced`) — the §10 runtime items needed positive evidence the reconcile ran when inert.
4. **Boot wraps the reconcile await in try/catch** — a reconcile failure logs `[worktrees] boot reconcile failed` and boot continues; a worktree-layer hiccup must never brick session restore.
5. **`removeWorktree({deleteBranch})` throws** — "No branch deletion in 2-1" (non-goal) while keeping the spec'd signature for 2-3.
6. **Adopted rows store `branch ?? ''`, `base_branch: ''`** — both columns are `NOT NULL` and an adopted worktree's base is unknowable; **2-3's panel must guard empty `base_branch` in `aheadBehind`.**
7. **Per-repo evidence failure ⇒ skip the repo** (log + continue) — reconcile never classifies on missing evidence (a deleted repo would otherwise look like "all rows lost their entries").

## Files changed (one-line rationale each)

- `src/renderer/src/assets/main.css` — F15 chore (commit `624f3da`): deleted the unlayered reset; Tailwind preflight already resets.
- `src/main/services/git.ts` **(new)** — controlled git adapter: one private `runGit` (promisified `execFile`, explicit `cwd`, 15 s timeout, `windowsHide`, 16 MiB maxBuffer), typed `GitError`, 8 wrappers + exported pure `parseWorktreePorcelain`.
- `src/main/services/worktrees.ts` **(new)** — D23/D26h derivation helpers, pure `computeWorktreeReconcile`, `GitWorktreeManager` (create/remove/isClean/getDirtyFiles/list/reconcileAll).
- `src/main/services/worktrees.test.ts` **(new)** — 30 vitest cases.
- `src/main/db/schema.ts` — `worktrees` table + `sessions.worktreeId`; `WorktreeRow`/`NewWorktreeRow` exports.
- `src/main/services/storage.ts` — migration v4 (4th `MIGRATIONS` entry, runner untouched); 8 worktree accessors; `createSession` null-coalesces `worktreeId` (type-required by the new column).
- `src/main/index.ts` — `whenReady` callback now `async`; manager constructed after `bindStorage`; reconcile awaited before `void sessions.restore(...)`.

Nothing outside the §7 scope table. `_verify/` (untracked harness evidence, incl. this task's) and `docs/` untouched and unstaged.

## Verification transcript (audit anchors — files live in untracked `_verify/`, `2-1-` prefix)

- **Static (G1):** `npm run typecheck` exit 0 (node + web). `npx vitest run`: **114/114** across 7 files (84 pre-existing + 30 new). New suite covers: every matrix row P1a–P5; (b) promote active vs detached by session-row presence; (c) adoption never active; (d) P2 surface-prune unconditional even with the session id present; (e) removing → delete-row vs detach by evidence; a 12-row/9-entry/10-dir idempotency scenario (second pass yields only `none`/`surface-prune`/`surface-orphan-dir`, exact membership asserted); both crash seams; derivation helpers; porcelain multi-entry/detached/bare/CRLF+`locked`/`prunable`.
- **(1) F15 chore:** live CDP measurement across the edit (HMR applied it in place): palette overlay `padding-top` 0px→96px (`pt-24`), LaunchDialog panel `padding` 0px→20px (`p-5`), agent-grid `margin-top` 0px→12px (`mt-3`). Screenshots `2-1-f15-before-palette.png`, `2-1-f15-before-dialog.png`, `2-1-f15-after-palette.png`.
- **(2) Cold boot 1 (tree-killed first):** boot log `2-1-boot-cold1.log` shows `[worktrees] reconcile: 0 row(s) across 0 repo(s); 0 surfaced`; app opened normally; auto-restore of the Chorus project's sessions behaved exactly as before — screenshot `2-1-boot1-app.png`.
- **(3) DB dump (`2-1-dump-boot1.json`, baseline `2-1-dump-preboot.json`):** `schema_migrations` = 1,2,3,4 (v4 applied in place, zero manual steps); `worktrees` DDL matches the Drizzle def exactly; `PRAGMA table_info(sessions)` shows `worktree_id` (TEXT, nullable, cid 8). Zero data loss: both projects, all three session rows intact.
- **(4) Reconcile inert:** `SELECT count(*) FROM worktrees` = 0; `git worktree list` unchanged (one entry); `sessions.status` values byte-identical to the pre-boot dump — no spurious heals.
- **(5) Cold boot 2:** v4 NOT re-applied (same `applied_at`, still exactly 1–4); reconcile still inert (`2-1-dump-boot2.json`, `2-1-boot-cold2.log`).
- **(6) Population probe (throwaway repo under the scratchpad, NOT the Chorus repo; rows in `2-1-probe-rows.json`):** boot log `2-1-boot-probe1.log` shows, in order: `deleted row aaaa… (nothing durable)` (P3c) · `promoted bbbb… → detached` (P1b, session NULL) · `prune candidate cccc…` (P2a, surfaced NOT actioned) · `found untracked worktree …wt-dddd0004; adopted as detached` (P4/c) · `orphan directory …wt-eeee0005 (never auto-deleted)` (P5) · summary `3 row(s) across 1 repo(s); 3 surfaced`. Post-boot dump `2-1-dump-probe1.json`: row A gone; B `detached`; C still `active` (row survives); adopted row `detached`, `session_id` NULL, backslash-normalized path. **No `git worktree prune` ran:** the hand-deleted `wt-cccc0003` still listed by `git worktree list` (marked `prunable`). Second boot (`2-1-boot-probe2.log`): only the two recurring surfaces, dump byte-identical (`2-1-dump-probe2.json`) — idempotent at the boot level. Probe rows deleted, throwaway repo + managed root removed afterward; final dump `2-1-dump-final.json`: 0 worktree rows, legitimate rows untouched.
- **(7) Grep gates:** `--force` in `src/` code only at `worktreeRemove`'s flag branch (remaining hits are comments); `force: true` → **zero** matches in `src/` (two docstrings containing the literal string were reworded); `worktree` in `src/renderer/` → zero matches.
- Adapter smoke (D4/G2, `_verify/2-1-smoke-git.ts` output in session log): real-repo `resolveRepoRoot`/add/list/dirty-refusal/force-remove/aheadBehind all as designed; the `--force` long flag empirically accepted (F17).
- Known quirks honored: tree-kill + port-rebind check on every restart (4 cold boots); ComSpec/registry-PATH restored per launch; `ELECTRON_RUN_AS_NODE` dump script used with write-to-file (the first-run no-output flake did not occur this session; the FK probe failure surfaced loudly instead — see F16); claude auth expiry irrelevant (no agent prompts needed).

## Acceptance criteria (Task-2-1.md) — all PASS

F15 chore as its own commit first, spacing restored (visible G2 check) ✓ · `npm run typecheck` zero errors ✓ · `npx vitest run` green incl. the new suite ✓ · migration v4 applied in place 3→4, zero loss, `worktrees` + `sessions.worktree_id` exist ✓ · `execFile` arrays only, `--force` only behind `worktreeRemove`'s flag with zero callers ✓ · boot awaits `reconcileAll()` before `void sessions.restore(...)`, no-op on the empty table, no spurious session heals ✓ · reconcile never auto-prunes ✓ · one task commit + the separate chore commit, scope files only ✓.

## Non-goals confirmation

No IPC channels, preload forwarders, or renderer components · no launch-flow change — no worktree is ever created in 2-1 · no auto-merge · no un-gated `--force` · no automatic `git worktree prune` at boot · no branch deletion · no settings screen · `SessionManager` API unchanged · migration runner untouched (4th array entry only) · no unrelated/untracked files staged or reverted.

## Residual risks / notes for 2-2 / 2-3 / 2-4

- **2-3 (hard):** detach must precede `deleteSession` (F16); guard empty `base_branch` on adopted rows in `aheadBehind`; surfaced prune/orphan findings are boot-log-only by design (spec §7's sanctioned split — the panel recomputes live on open).
- **2-2:** `resolveRepoRoot` returns git's forward-slash form — fine everywhere, but keep path comparisons on the `pathKey` normalization (F17); `createWorktree`'s returned row is `provisioning` — activation is `activateWorktreeForSession` (one transaction, already shipped).
- **`removeWorktree` lock-retry** patterns (`EBUSY|EPERM|busy|being used|permission denied`, 250/500/1000 ms) are written from git's documented failure modes and confirmed not to match the dirty refusal — but no real Windows handle-lock was exercised in 2-1 (the method has no caller yet). Worth one live locked-directory test in 2-3.
- **Promote writes only the worktrees row** (spec §7): a crash-window `provisioning → active` promotion leaves `sessions.worktree_id` NULL — the row-side pointer is authoritative (a), so this is cosmetic; noted for whoever first reads the session-side pointer.
- **Dev-DB drift vs the execution prompt's §3(i):** actual project ids are `a43b395d…`/`b684e96e…`, and Chorus-Second holds one exited session row. All legitimate; nothing cleaned up. The prompt-quoted ids are stale.
- electron-vite dev did NOT hot-restart the main process on `src/main` edits this session (only renderer HMR fired) — every main-code verification required a real tree-kill cold boot. Budget for that in 2-2/2-3 runtime passes.

## Process note

Repo-local git identity held (`mwilson29072@gmail.com`, verified before both commits). Two commits as D24 requires: chore first, task second; no push, no PR, no amend/rebase. All probe artifacts (throwaway repo, probe rows) were removed afterward; the dev DB retains only its legitimate rows plus migration v4.

## Final git output

```
git status --porcelain
?? _verify/

git log --oneline -3
8bab784 Phase 2, Task 2-1: git adapter, worktrees data layer, boot reconcile
624f3da Fix: app-wide margins and paddings render again (F15)
8b76d9c Task 2-1 execution prompt
```
