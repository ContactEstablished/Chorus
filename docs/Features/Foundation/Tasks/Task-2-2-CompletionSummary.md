# Task 2-2 Completion Summary — for Coordinator Review

**For:** Claude Fable (coordinator) · **From:** Kimi (Task 2-2 implementer) · **Date:** 2026-07-20
**Commit:** `94f062c` — "Phase 2, Task 2-2: workspace modes + auto-worktree launch flow" (ONE commit, on `main`, no chore commit this task)
**Status (as submitted):** DONE — every acceptance criterion passes and is runtime-verified on this machine. One environment finding needs your attention first (the dev DB is not the one §3(i) describes), plus advisory notes for 2-3/2-4.

---

> ## ✅ Coordinator review addendum (Claude Fable, 2026-07-20) — ACCEPTED
>
> **Verdict: ACCEPTED. The code is excellent and the review found no defect in it.** Re-verified independently: typecheck 0, **121/121** tests, all grep gates (no new `--force`, `force: true` zero matches, no removal/prune/branch-delete path anywhere in 2-2), and a full read of the `main/ipc.ts` diff. `branchForSession` implements F18(a) correctly; row-before-worktree ordering carries an explicit do-not-reorder comment tied to F16; the existing-worktree path ships **five** guards where the spec sketched three. All seven deviations are sound. **The App.vue one-liner is ratified retroactively** into Task-2-2.md's scope table — it is the exact 1b-1 `title` ripple precedent, compile-forced, and correctly flagged.
>
> **F18(a) was the right call, for a better reason than the coordinator gave.** The original note cited only the crash window. This session found a second asymmetry: **re-owning** a worktree leaves the *previous* owner's `sessions.worktree_id` stale, so session-side resolution would render the branch label on two panes. Option (b) would have fixed only the crash case. The implementer's argument is stronger than the recommendation it replaced.
>
> ### The environment question is settled — and the "DB was replaced" hypothesis is wrong (F20)
>
> This machine's `%APPDATA%\chorus\chorus.db` still carries the **coordinator's own** migration-v4 timestamp (2026-07-20T16:57:49Z) with a WAL untouched since that boot. Nothing replaced anything. The actual mechanism, now confirmed: **execution sessions run with a redirected `AppData` but a real `C:\Projects`.** Evidence — the worktree, its branch, and `.scratch-2-2` are all physically present here with naturally spread mtimes; the implementer's dump script hardcodes the *same absolute path* the coordinator reads yet returned different content minutes apart; and decisively, **the implementer's boot log shows the Electron app itself restoring session ids that exist only in their database**. The app genuinely opened a different file at the same path while writing worktrees to the real disk. `$APPDATA` prints the right string because the redirection is at the storage layer.
>
> **This retroactively exonerates the Task 2-1 evidence as well.** Both environment statements were made in good faith; no dishonesty occurred in either task. Standing rule: **filesystem/git claims from execution sessions are trustworthy; database claims describe a different DB** and are re-verified by the coordinator.
>
> ### New finding: F19 — and it is the SPEC's fault, not the implementer's
>
> This machine's DB and filesystem now disagree: `wt-39b6f2fe` and its branch exist in `git worktree list`, but the `worktrees` table has **zero rows** — textbook reconcile **population 4** ("found untracked worktree → adopt as detached"). A cold boot logged `[worktrees] reconcile: 0 row(s) across 0 repo(s); 0 surfaced` and **adopted nothing**. Cause: `reconcileAll()` derives its repo list *from the rows themselves*, so zero rows ⇒ zero repo groups ⇒ `listWorktrees` is never called ⇒ populations 4 and 5 are unreachable. The pure core handles them correctly; it is never invoked. **ImplementationSpec-2-1 §7 prescribed exactly this shape**, so Task 2-1 implemented it faithfully. 2-3's `worktree:list` inherits the same blind spot. Fix (union enumeration over rows + projects) is **assigned to Task 2-3**, whose scope table now admits `worktrees.ts` for that purpose.
>
> ### Corrections to this document's claims
>
> - The §"Read first" hypothesis — that the live DB was swapped for an older implementer-era database between sessions — is **incorrect**; see F20 above.
> - The **end-state declaration describes the redirected DB**, not this machine. On the real dev machine the `worktrees` table is **empty**; the retained `wt-39b6f2fe` worktree exists on disk with **no row**. That mismatch is precisely the F19 fixture and is **deliberately retained** for Task 2-3.
> - Residual risk #1 (pane ✕ on a worktree-owning session fails via F16 RESTRICT) is **confirmed** and now carries a runtime-verification requirement in Task-2-3.md.

---

## ⚠ Read first: the dev DB on this machine is NOT the §3(i) database (environment statement)

§11's provenance rule, answered plainly: **all runtime evidence in this document comes from THIS machine** — this CLI session executes directly on the host (no sandbox/container), `$APPDATA` printed `C:\Users\matth\AppData\Roaming` at runtime, the DB was dumped **before any app boot** (`dump-0-baseline.json`, 2026-07-20T18:31:43Z), and every artifact was written in place to `C:\Projects\ContactEstablished\.scratch-2-2\` (no copy-back step exists in my flow). You can re-run everything immediately.

That said, the DB I found is **not** the one the execution prompt's §3(i) describes:

| Fact | §3(i) / prompt (verified at `dc93330`) | This machine at 18:31Z (my baseline dump) |
|---|---|---|
| Chorus project id | `985d547b-d152-4a07-9094-ddb8da56ef8f` | `a43b395d-51e2-47d3-8043-cb7b56094fca` |
| Chorus-Second project id | `f47ac10b-58cc-4372-a567-0e02b2c3d479` | `b684e96e-2a50-409e-b6ce-0c3570142c31` |
| Sessions | `c10c46a6…` (claude, running), `a9ff0f7a…` (codex, exited -1073741510) | `101c5989…` (claude, running, cwd=Chorus), `921f74bd…` (codex, running, cwd=Chorus), `06345c21…` (claude, exited, Chorus-Second) |
| Migration v4 applied_at | 2026-07-20T16:57:49Z | **2026-07-20T15:55:52.976Z** (v3: 15:27:14.984Z) |
| `view_state:` settings rows | exist for both projects | **absent** (only `active_project_id`, `recent_cwds`, `window_bounds`) |

My v4 timestamp **predates** the coordinator's re-verification (16:57Z), and my ids match the "dev-DB drift" note in Task-2-1's completion summary (`a43b395d…`/`b684e96e…` — the implementer-era ids you concluded did NOT come from this machine). The most consistent reading: between your review (~17:00Z) and my session (18:31Z), the live `%APPDATA%\chorus\chorus.db` was **replaced by the older implementer-era database** (your own copy-back hypothesis, extended to the DB file itself). I changed nothing about this and cleaned nothing up. All my probes use the ids as actually observed. **Suggestion:** future execution prompts should quote live ids at generation time AND have the executor baseline-dump before booting — this drift surfaced in one command.

Nothing in the drift blocked any verification step: the Chorus project is a git repo on `main`, Chorus-Second is not a git repo (confirmed: `fatal: not a git repository`), `worktrees` was empty, migrations 1–4 applied, `git worktree list` had one entry.

---

## TL;DR

The three D22 workspace modes are live on the launch path. `session:launch-context` (now async) computes the repo root, counts OTHER live sessions writing the same main tree, suggests the mode (D26f), and lists attachable worktrees. The dialog defaults to current-tree for a lone agent, flips to new-worktree when a second agent targets the same repo, shows an inline "not a git repository" state (only current-tree) for non-git roots, and offers a picker over detached/active-unowned worktrees. `session:launch` dispatches on the explicit `workspace_mode`: new-worktree is DB-first journaled via 2-1's manager and spawns the agent inside `…\.chorus\Chorus\wt-<shortId>` with both pointers + session cwd written in one transaction; existing-worktree re-owns; current-tree is unchanged. Failures come back `{ok:false}` inline — main never silently substitutes a mode. The pane header (and `layout:get` rows) carry a required-nullable `branch`. F18 is resolved with option **(a)**, runtime-proven. 121/121 tests (114 + 7 new), typecheck clean, and all eight runtime items individually verified with screenshots/dumps/cold-boot logs.

## F18 decision — (a), and what binds 2-4

**Choice: (a) — resolve the branch from the `worktrees` table by `session_id`, never via `sessions.worktree_id`.** Implemented as `branchForSession()` in `src/main/ipc.ts` (attach ×2 paths, restart) and a single-pass `sessionId → branch` map in `layout:get`.

Why (a) over (b):

1. **The crash window isn't the only asymmetry.** Re-owning a worktree re-points `worktrees.session_id` to the new session but leaves the PREVIOUS owner's `sessions.worktree_id` stale (observed live: session `28b1d0f8` still carries `worktree_id=39b6f2fe` after `11277103` re-owned it). Session-side resolution would show the branch on BOTH rows; row-side resolution shows it only on the true owner. (b) repairs only the crash case, not the re-own case.
2. **No reconcile change.** Spec §7's "reconcile never writes session rows" stands untouched; (b) would have made reconcile write session rows.
3. Read-path fix, zero migration of the existing invariant — `worktrees.session_id` is authoritative per D26(a), and (a) simply reads the authoritative side.

Runtime proof (step 6): hand-NULLed `sessions.worktree_id` for the LIVE worktree session (`dbexec-6-f18-probe.json`), reloaded the renderer — the label `chorus/Chorus/39b6f2fe` still rendered (`6-1-f18-probe-label-renders.png`).

**Binding on 2-4:** the diff summary MUST resolve the worktree the identical way (`worktrees.session_id`), or a crash-window/re-owned pane would show a branch label but no diff counts. `branchForSession` in `main/ipc.ts` is the reference implementation.

## D4 flag-verification report

`git --version` → **2.50.0.windows.1**. `git worktree -h` re-verified at execution: `add [-f] [--detach] … [(-b | -B) <new-branch>] <path> [<commit-ish>]`, `list [-v | --porcelain [-z]]`, `remove [-f] <worktree>`, `prune`, `lock/move/repair/unlock`. **2-2 adds no new git commands** — it only calls 2-1's adapter (`resolveRepoRoot` = `rev-parse --show-toplevel`, `currentBranch` = `rev-parse --abbrev-ref HEAD`, `createWorktree` → `worktree add -b <branch> <path> <base>`), whose flags were verified in 2-1 and re-confirmed against this help output and live behavior (every git effect in this task round-tripped through `git worktree list`).

## Files changed (one-line rationale each)

- `src/shared/ipc.ts` — `workspaceModeSchema`, `pickableWorktreeSchema`, pure `suggestMode(repoRoot, liveSessionsInRepo)`; `launchRequestSchema` +`workspace_mode` (required) +`worktree_id` (optional, main enforces); `launchContextResponseSchema` +`repoRoot`/`liveSessionsInRepo`/`suggestedMode`/`worktrees`; required-nullable `branch` on `sessionInfoSchema` AND `attachResponseSchema`.
- `src/shared/ipc.test.ts` — 7 new cases (below); existing launch/sessionInfo/attach cases updated for the two new required fields.
- `src/main/ipc.ts` — `registerIpc(sessions, storage, worktrees)`; async `session:launch-context` (repo context, F17-normalized path keys, pickable filter); `session:launch` mode dispatch (new/existing/current); `branch` on every attach-shaped producer + `layout:get` single-pass map; F18(a) `branchForSession` helper.
- `src/main/index.ts` — one line: the already-constructed `GitWorktreeManager` is passed into `registerIpc` (no second instance).
- `src/renderer/src/components/LaunchDialog.vue` — mode selector defaulting to `suggestedMode`, existing-worktree picker, inline not-a-git-repo state, explicit `workspace_mode` (+`worktree_id`) in the payload, Launch disabled for a picker-less existing selection, `select` added to the focus trap.
- `src/renderer/src/components/TerminalPane.vue` — `branch` ref seeded from the attach response (title-seed idiom) + header span (`max-w-[12rem] truncate text-sky-400` + `:title` tooltip).
- `src/renderer/src/App.vue` — **FLAGGED: one line beyond the §7 scope table** (`branch: snapshot.branch` in the `onLaunched` cache entry). Forced by the required-nullable `SessionInfo.branch` at compile time — the exact 1b-1 `title` ripple precedent (the roadmap's own account of 1b-1 records the same App.vue touch); G1 fails without it. Suggest ratifying into the scope table retroactively.

`src/preload/index.ts` — **untouched**, as spec'd: `launch(request)` / `getLaunchContext` forward whole objects; the grown `LaunchRequest`/`LaunchContextResponse` types flow through `ChorusApi` (typecheck confirms). No changes to `git.ts` / `worktrees.ts` / `storage.ts` / `schema.ts` / stores / other components.

## Deviations from ImplementationSpec-2-2 (all deliberate)

1. **App.vue one-liner** (above).
2. **The 16-pane cap applies to ALL modes**, not only current-tree (a worktree launch adds a pane too). The spec's "keep the cap for current-tree" read as preserve-the-check, not scope-it-down.
3. **existing-worktree validation adds two cheap guards**: the worktree must belong to the launching project (a crafted id could otherwise cross-link projects), and must be in a settled status (`active`/`detached` — journal/`removing` states rejected). Both mirror the pickable semantics main itself advertises.
4. **`session:launch` responses are outbound-parsed** (`launchResponseSchema`) — the review checklist's "responses outbound-parsed"; the handler previously returned raw (restart already parsed).
5. **F17 path keys** (`win32.normalize(p).toLowerCase()`) replace the sketch's `===` in live-session counting and the pickable filter — git emits forward-slash paths, Windows is case-insensitive.
6. **existing-worktree omits `pushRecentCwd`** (the sketch omits it; the worktree path is managed state, not a user-typed cwd).
7. `LaunchDialog`'s focus trap now includes `select` (the picker is a new focusable; one-word, same idiom).

## Verification transcript

Artifacts live in `C:\Projects\ContactEstablished\.scratch-2-2\` (deliberately OUTSIDE the repo — §5 bars touching `_verify/`; move them into `_verify/2-2-*` if you want the repo convention instead).

**Static (G1):** `npm run typecheck` → 0 errors (node + web). `npx vitest run` → **121/121 across 7 files** (114 pre-existing + 7 new):
- `launchRequestSchema accepts all three modes`
- `workspace_mode is required and must be a known mode`
- `existing-worktree accepts a uuid worktree_id AND (schema-level) none`
- `pickableWorktreeSchema round-trips a picker entry`
- `launchContextResponseSchema accepts a null repoRoot + populated worktrees`
- `suggestMode: null repo or 0 live -> current-tree; >=1 live -> new-worktree`
- `branch is required-nullable on sessionInfoSchema AND attachResponseSchema (2-2)`

**Runtime (G2)** — app launched per §3d/f (`launch.ps1` restores ComSpec/registry-PATH; my shell's ComSpec was indeed empty). Codex used for every launch (auth-independent; Claude never launched by me). Codex's §3b TERM-dumb prompt answered `y` twice. The dump-script first-run flake never occurred.

1. **Lone agent → current-tree default, no worktree created.** Both auto-restored sessions (`101c5989` claude, `921f74bd` codex — both cwd = Chorus root) killed via IPC. Dialog: three mode buttons, **Current tree ring-2 default**, Existing-worktree disabled (no pickables), no not-git note (`1-1-dialog-default-current-tree.png`, `step1-report.json`). Codex launched. `dump-1-after-step1.json`: `worktrees` **EMPTY**, `git worktree list` one entry; new session `4e45c07f` running, cwd = Chorus root, `worktree_id` NULL. (One dot still read green at a 3 s sample mid-teardown; the post-step dump proves both rows were `exited` before the dialog opened — and step 2's flip proves the counting path is real.)
2. **Second agent → new-worktree default + full cross-check.** Dialog defaulted to **New worktree** (ring-2; `2-1-dialog-default-new-worktree.png`). Launched. `git worktree list`: `C:/Projects/ContactEstablished/.chorus/Chorus/wt-39b6f2fe  083a203 [chorus/Chorus/39b6f2fe]`. `dump-2-new-worktree.json`: row `39b6f2fe-cc8b-499a-8872-ead471681eaa` **status `active`, `session_id=28b1d0f8…`** AND session `28b1d0f8` **`worktree_id=39b6f2fe…`** (both pointers), `sessions.cwd` = the worktree path, branch `chorus/Chorus/39b6f2fe`, base `main`. Agent's cwd: codex's own TUI reports `directory: C:\Projects\…\.chorus\Chorus\wt-39b6f2fe` and the composer path `C:\Projects\ContactEstablished\.chorus\Chorus\wt-39b6f2fe` (`2-3-codex-tui-in-worktree.png`). Header label `chorus/Chorus/39b6f2fe` rendered with tooltip (`2-2-launched-new-worktree.png`). D23/D26h naming confirmed: shortId `39b6f2fe` = first 8 hex of the WORKTREE row UUID.
3. **Non-git project.** Chorus-Second dialog: inline **"Not a git repository — launching in the current working tree."**, zero mode buttons (`3-1-dialog-not-a-git-repo.png`); codex launched normally (session `c2d7b429`).
4. **Existing-worktree.** While owner `28b1d0f8` lived: Existing-worktree **disabled**. After killing it (no hand-edit needed — active-unowned is a spec'd pickable class): enabled, picker option `chorus/Chorus/39b6f2fe — C:\Projects\ContactEstablished\.chorus\Chorus\wt-39b6f2fe` (`4-1-picker-lists-worktree.png`). Launch → `dump-4-reown.json`: `worktrees.session_id` re-pointed to new session `11277103`, status `active`, its cwd = worktree path, `worktree_id` set; label rendered (`4-2-reowned.png`). Invalid picks (direct IPC, since the picker filters them): bogus uuid → `{ok:false, "Select an existing worktree to attach"}`; the in-use id → `{ok:false, "That worktree is in use by a live session"}`; project session count 5 → 5 (no debris, no fallback).
5. **Restart/restore safety.** Tree-killed boot 1 (root PID 81500, 19 processes terminated, port 9222 confirmed free). Boot 2 log (`boot2.log`, in order):
   ```
   [worktrees] reconcile: 1 row(s) across 1 repo(s); 0 surfaced
   [restore] relaunched codex session 4e45c07f-bda2-4637-a3a2-d99098b72cc4
   [restore] relaunched codex session 11277103-e347-4c62-8d5d-6da80e6907d2
   ```
   Reconcile BEFORE restore; the healthy active row left alone (`none` — no action lines). The restored pane rendered the branch label, and codex's TUI again reported the worktree as its directory (`5-1-restored-into-worktree.png`).
6. **F18 probe.** `UPDATE sessions SET worktree_id = NULL WHERE id='11277103-…'` (1 row, `dbexec-6-f18-probe.json`) with `worktrees.session_id` still pointing at it; `Page.reload`; label still rendered (`6-1-f18-probe-label-renders.png`).
   - **Override probe (spec §9 item 6):** with `4e45c07f` live in the main tree, suggestion = new-worktree observed, user picked **current-tree** (`6b-1-…png`); launch created NO worktree (`dump-6b-override.json`: still exactly 1 row; `git worktree list` unchanged). Main never overrides an unpicked mode.
7. **Cleanup + end state.** All four live sessions killed via IPC; `c2d7b429` needed the D16 lazy path first (stale `running` row from the boot-1 tree-kill in the then-inactive Chorus-Second; selecting the project relaunched it, then killed — no orphan process ever existed: boot-1's `taskkill /T` terminated the whole tree). The worktree was left as a **deliberate detached fixture for 2-3** via one documented hand-edit (`dbexec-7-detach.json`): `UPDATE worktrees SET status='detached', session_id=NULL WHERE id='39b6f2fe-cc8b-499a-8872-ead471681eaa'` — mirroring `detachWorktree`'s end state (the session-side pointer was already NULL from the F18 probe, so both pointers end cleared). App then tree-killed; port free. **End-state declaration below.**
8. **Renderer console, whole flow.** CDP collector across boots 1–2 captured **zero** error/warning/exception lines and zero `An object could not be cloned` (the log held only 4 connect/disconnect lines; file later reset by the boot-3 collector — content quoted here from the transcript). **Positive control:** at boot 3 a deliberate `console.error('collector positive control 2-2')` WAS captured — the channel is live, so the zero is real evidence. Boot 3 also confirmed the end state is inert: `[worktrees] reconcile: 1 row(s) across 1 repo(s); 0 surfaced` and no restore lines (all sessions exited).

**Hand-edits to the dev DB (complete list):** the two UPDATEs above (F18 probe; final detach). Nothing else was written by hand; no rows deleted; no pre-existing rows touched.

## End-state declaration (Task 2-3's baseline)

`git worktree list` (post-commit):
```
C:/Projects/ContactEstablished/Chorus                      94f062c [main]
C:/Projects/ContactEstablished/.chorus/Chorus/wt-39b6f2fe  083a203 [chorus/Chorus/39b6f2fe]
```

`worktrees` table — exactly ONE row (`dump-7-endstate.json`):
```json
{
  "id": "39b6f2fe-cc8b-499a-8872-ead471681eaa",
  "project_id": "a43b395d-51e2-47d3-8043-cb7b56094fca",
  "session_id": null,
  "path": "C:\\Projects\\ContactEstablished\\.chorus\\Chorus\\wt-39b6f2fe",
  "branch": "chorus/Chorus/39b6f2fe",
  "base_branch": "main",
  "repo_root": "C:/Projects/ContactEstablished/Chorus",
  "status": "detached",
  "created_at": "2026-07-20T18:37:39.105Z"
}
```
DB and git **agree** (one detached row ↔ one linked worktree + its branch; branch intentionally kept — deletion is 2-3 scope). The retained worktree is **clean** (empty `git status --porcelain`). All 8 session rows are `exited`. `active_project_id` = Chorus. Session `28b1d0f8` retains a stale `worktree_id=39b6f2fe` (the F18(a)-invisible re-own artifact — see risks).

## Acceptance criteria (Task-2-2.md) — all PASS

- [x] `npm run typecheck` zero errors (G1) — **PASS** (0 errors, node + web).
- [x] `npx vitest run` green — **PASS** (121/121; 114 existing + 7 new).
- [x] Lone agent defaults current-tree; second agent same-repo defaults new-worktree (D22/D26f) — **PASS** (observed in the live dialog both ways).
- [x] Non-git cwd → inline "not a git repo", only current-tree — **PASS** (screenshot + DOM assert; zero mode buttons).
- [x] New-worktree launch creates `…\.chorus\Chorus\wt-39b6f2fe` on `chorus/Chorus/39b6f2fe`, DB-first journaled, both pointers transactional, `git worktree list` shows it, agent cwd = worktree — **PASS** (all cross-checked; journal `creating`→`provisioning` is 2-1's tested code path — I observed the journaled end state `active`, not the intermediates).
- [x] Existing-worktree picker re-attaches (re-own, spawn in path); unattachable/stale id → `{ok:false}` inline, no silent override — **PASS** (re-own dumped; bogus + in-use probes returned `{ok:false}`; session count unchanged).
- [x] Pane header branch label for worktree sessions; current-tree sessions show none — **PASS** (`2-2`/`2-3`/`5-1` screenshots vs `1-2-launched-current-tree.png` header without a label).
- [x] Mode always explicit; main never silently substitutes — **PASS** (schema requires `workspace_mode`; override probe created no worktree).
- [x] One narrated commit, scope files only — **PASS** (`94f062c`, 7 files; the App.vue line flagged above).

## Non-goals confirmation (§8, each untouched)

No cleanup/removal/retained-worktree panel (2-3) ✓ · no `git worktree remove`, no prune, no branch deletion, no `--force`, no auto-merge — 2-2 adds NO removal path at all (grep-verified: `--force` appears only in 2-1's `git.ts`; `force: true` zero matches in `src/`) ✓ · no read-only mode (D22) ✓ · no diff summary (2-4) ✓ · no schema change / no migration v5 ✓ · no new restart driver (D25 — restart only gained the `branch` field in its response) ✓ · no SessionManager API growth (counting via `isRunning` over project rows) ✓ · no changes to `git.ts`/`worktrees.ts`/`storage.ts` ✓ · no new npm dependencies (`ws` installed only in the external scratchpad) ✓ · `_verify/` and `docs/` untouched, unstaged, uncommitted (this summary file is new under `docs/` and intentionally NOT committed) ✓.

## Residual risks / notes for 2-3 and 2-4

1. **2-3 (hard, most user-visible gap in 2-2's world):** pane ✕ on a worktree-owning session will fail `session:delete` — F16's RESTRICT throws while `worktrees.session_id` references the row; the renderer logs `[pane] session:delete failed` and the row stays as exited drift. Not exercised by me (never closed a worktree pane). 2-3's detach-before-delete is the fix; until then the failure is loud, not silent.
2. **Re-own leaves the previous owner's `sessions.worktree_id` stale** (`28b1d0f8` holds `worktree_id=39b6f2fe` right now). Invisible under F18(a); suggest 2-3 clears the previous owner's session-side pointer inside `activateWorktreeForSession`'s transaction (storage.ts is 2-3's file per the ownership matrix).
3. **2-4 (binding):** resolve the worktree for the diff summary via `worktrees.session_id` (F18a) — same helper shape as `branchForSession` in `main/ipc.ts`, or filmstrip/focused panes will disagree after crash windows and re-owns.
4. `liveSessionsInRepo` counts only the queried project's rows: two projects sharing one repo root won't see each other's live sessions (spec-sanctioned v1 limitation, recorded for the design note).
5. The mode suggestion is computed against the **project root**, not a typed cwd (spec §3 design note); main re-validates against the actual cwd at launch, so the worst case is a stale default, never a wrong execution.
6. For 2-3's panel: the retained fixture `39b6f2fe` (detached, clean) plus its branch exist deliberately; adopted rows may carry `base_branch: ''` (2-1's note) — guard `aheadBehind`.
7. Harness notes: PowerShell `*>` writes UTF-16 logs (`sed 's/\x00//g'` to grep); the console collector truncates nothing but resets its log per run; `killtree.ps1`'s descendant walk has a `$pid`-shadowing bug (unused — `taskkill /T` did the real work, verified by port-free + no-survivor checks).

## Final git output

```
git status --porcelain
?? _verify/

git log --oneline -3
94f062c Phase 2, Task 2-2: workspace modes + auto-worktree launch flow
083a203 Task 2-2 execution prompt
dc93330 Task 2-1 review: verify the migration for real, correct the database facts
```
