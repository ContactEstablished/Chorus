# Task 3-1 — Carry-Over Fixes + Secret-Safe Logging Spine

_First task of Phase 3 (Foundation). Windows-only. **Two commits** this session (D32): a flagged chore commit closing F21 and F23, then the task commit adding the logging spine. This task governs scope; `ImplementationSpec-3-1.md` governs exact contents._

## Source Of Truth

- `docs/Features/Foundation/Tasks/Phase-3-Overview.md` — the phase contract, cross-cutting rules, and gates.
- Roadmap §5: **F21** (the `-D` branch-force escalation is gated only by the renderer), **F23** (a palette launch replaces the whole layout tree), **F17/F20** (verification discipline). Roadmap §6: **D26(j)** (branch deletion runs `-d`; `-D` requires typed acknowledgment), **D30** (pino approved), **D32** (chore-commit placement, G3 amended).
- `docs/PLAN.md` §2 (pino in the locked stack: file-rotated, secret-redacting serializer), §6 (keys redacted from transcripts/logs via a pino serializer **plus** a regex scrub on known key shapes).
- `CLAUDE.md` (D1 Zod-in-main; D14 plain payloads; no dependencies beyond the stack without asking — pino is the one approved this phase).
- Precedent: Task 2-1's F15 chore commit (D24) is the model for the chore-then-task two-commit session.

## Initial Starting Point

**Verified 2026-07-21 against commit `04a8a0d`** (Phase 2 complete, working tree clean). Baseline re-run this session: `npm run typecheck` exits 0; `npx vitest run` = **142/142 across 7 files**.

- **F21 lives in one expression.** `src/main/ipc.ts`'s `worktree:remove` handler computes `forceBranch: req.confirmation === w.path` in the options object it passes to `worktrees.removeWorktree(...)` — **outside** the dirty branch. `dirtyRemovalAllowed({path, clean}, req.confirmation)` returns `true` unconditionally for a clean worktree, so a request carrying a path-matching `confirmation` **and** `deleteBranch: true` against a **clean** worktree reaches `branchDelete(repoRoot, branch, true)` — a `git branch -D` on a possibly unmerged branch. `worktrees.ts::removeWorktree` escalates only when `opts.forceBranch` is set and the plain `-d` threw an unmerged refusal, so the *escalation logic* is correct; the **authorization** is what is wrong.
- **It is unreachable through the shipped UI.** `WorktreePanel.vue` sends `confirmation` only when the worktree is dirty, so a clean removal attempts plain `-d` and surfaces the unmerged refusal (with a message telling the user to run `git branch -D` themselves). **Severity: latent, not live.**
- **F23 lives in one expression too.** `src/renderer/src/stores/layout.ts`'s `insertLaunchedLeaf(target, newSessionId)` reads `target && this.tree ? splitPane(...) : createLeaf(newSessionId)` and then assigns `this.tree = { version: 1, root }`. When `target` is `null` and the tree is **populated**, it discards the whole tree. `App.vue`'s `onLaunched` passes `splitTarget.value`, which is `null` for a palette launch (`openLaunchDialog()` is called with no argument from the palette's "Launch agent…" command), so every other pane vanishes from the layout, its session becomes a leafless `running` row, and D16's invisible-process guard heals it to `exited` **before any spawn** at the next boot — silently killing those agents.
- **A second, related hazard in the same function:** `splitPane` returns the tree **unchanged** when `targetSessionId` is not found (`src/shared/layout.ts`). So a *stale* target id drops the newly launched leaf entirely — the same class of defect, reachable if a split target's pane closes between dialog-open and launch.
- **Logging is 24 raw `console.*` calls** across six main-process files: `index.ts` (4), `ipc.ts` (3), `services/notifications.ts` (2), `services/sessionManager.ts` (5), `services/storage.ts` (2), `services/worktrees.ts` (8). (A seventh apparent hit at `notifications.ts:25` is a comment, not a call — it mentions the console and should be reworded when that file is migrated.) There is no logger module, no redaction, and **no secret exists in the codebase yet** — which is exactly why redaction lands now.
- **Bundling:** `electron.vite.config.ts` declares `main: {}` with no explicit externalization, and electron-vite already externalizes `package.json` dependencies — the built `out/main/index.js` `require()`s `better-sqlite3`, `node-pty`, `zod`, and `@electron-toolkit/utils` rather than bundling them. **Adding `pino` to `dependencies` needs no build-config change**; verify the built bundle `require`s it rather than inlining it.
- **The standing worktree fixture must survive.** The real dev DB holds exactly one `worktrees` row — `9ba9b0da…`, `detached`, `session_id NULL`, branch `chorus/Chorus/24b5c1fe`, path `C:\Projects\ContactEstablished\.chorus\Chorus\wt-24b5c1fe` — kept deliberately as the regression fixture for empty-`base_branch` guards and population-4 adoption. **Do not remove it, and do not delete its branch.** F21's runtime proof builds its own throwaway worktree.

## Goal

Close the two defects Phase 3 inherited, then lay the logging spine **before the phase's first secret exists**.

**F21** gets a *distinct* branch-force acknowledgment: main must receive a token naming the **branch** before `branchDelete(..., force = true)` is reachable at all. D26(j)'s "same typed-confirmation acknowledgment" was written for dirty removal; overloading one token to mean two different destructions (uncommitted files / unmerged commits) is the defect. After this task the escalation is unreachable **regardless of what any renderer sends** — a main-side gate, matching the defense-in-depth used everywhere else in the worktree code.

**F23** makes `insertLaunchedLeaf` **total**: a populated tree is never discarded, a null target splits the focused pane, and an unresolvable anchor falls back to a real leaf instead of silently dropping the new pane. Only the genuine empty state may create a root leaf.

**The logging spine** replaces every main-process `console.*` with a `pino` logger carrying a redacting serializer: declared redact paths for structured fields, plus a **key-shape regex scrub applied to free-text messages** (pino's `redact` covers object paths only — the scrub is what catches an interpolated key). A repo secret-grep script makes G4 a command a reviewer runs, not an assertion an implementer makes.

## Exact Scope

### Commit 1 — chore: F21 + F23

| File | Change |
|---|---|
| `src/shared/ipc.ts` | Add `branchForceConfirmation: z.string().optional()` to `worktreeRemoveRequestSchema` with a comment stating it is a **separate** acknowledgment from `confirmation` (D26(j) as amended by F21). Add the pure predicate **`branchForceAllowed(wt: { branch: string }, ack: string \| undefined): boolean`** next to `dirtyRemovalAllowed`, mirroring its shape and doc style. |
| `src/main/ipc.ts` | In the `worktree:remove` handler, replace `forceBranch: req.confirmation === w.path` with `forceBranch: branchForceAllowed(w, req.branchForceConfirmation)`. Import the predicate. No other change to the handler. |
| `src/renderer/src/stores/layout.ts` | Make `insertLaunchedLeaf` total (see Step 3). Import `collectSessionIds`/`findLeaf` from `../../../shared/layout` as needed. |
| `src/renderer/src/App.vue` | In `onLaunched`, pass the focused pane as the split anchor when `splitTarget.value` is null and the tree is populated (`effectiveFocused` already exists in this file). |
| `src/shared/ipc.test.ts` | Cases for `branchForceAllowed` and for the widened `worktreeRemoveRequestSchema`. |
| `src/renderer/src/stores/layout.test.ts` | Cases for the F23 fix (see Test Expectations). |

### Commit 2 — task: logging spine

| File | Change |
|---|---|
| `package.json` | Add `pino` to **`dependencies`** (D30 — the one approved dependency this phase). No transport package, no `pino-pretty`, no rotation (Phase 7). Add the `grep:secrets` npm script. |
| `src/main/services/logger.ts` | **Create.** The pino instance + redact configuration + the exported pure **`scrubSecrets(text: string): string`** + the exported `REDACT_PATHS` list. Main-process only. |
| `src/main/services/logger.test.ts` | **Create.** Unit tests for `scrubSecrets` and the redact-path list (see Test Expectations). |
| `src/main/index.ts` | Replace 4 `console.*` calls; initialize the logger at the top of the boot sequence. |
| `src/main/ipc.ts` | Replace 3 `console.*` calls. |
| `src/main/services/notifications.ts` | Replace 2 `console.*` calls; reword the stale "diagnosable from the console" comment above them. |
| `src/main/services/sessionManager.ts` | Replace 5 `console.*` calls. |
| `src/main/services/storage.ts` | Replace 2 `console.*` calls. |
| `src/main/services/worktrees.ts` | Replace 8 `console.*` calls. |
| `scripts/secret-grep.mjs` | **Create.** The G4 gate: scan tracked sources, `_verify/`, and any log artifact for key-shaped strings; exit non-zero on a hit. |

Nothing else. If a change seems to require another file, raise it.

## Non-Goals

- **No PTY-output scrubbing.** Whether the session ring buffer is scrubbed for key shapes is **CR-3.0's Q4** and is not decided yet. This task's scrub applies to **log records only** — never to `session:data`, never to the ring buffer, never to what xterm renders.
- **No vault, no credential schema, no `safeStorage`, no adapter work** — Tasks 3-2/3-3.
- **No `-D` affordance in the UI.** `WorktreePanel.vue` is deliberately **not** touched: after the gate, nothing sends `branchForceConfirmation`, so `-D` has zero callers — the same dormant-with-a-documented-sole-legal-caller state `--force` sat in after Task 2-1. The unmerged refusal keeps surfacing with its existing guidance message. Do not add an escalation button.
- **No log rotation, no file transport, no `pino-pretty`, no second dependency** (D30).
- **No change to what the logger prints semantically** — the migration is mechanical: same events, same information, structured. Do not take the opportunity to add or remove log sites.
- **No renderer logging change.** The renderer keeps its `console` usage; only `src/main` migrates.
- **No restart-driver change** (F14/D25 stay deferred).
- **Do not revert, stage, or commit unrelated or untracked files, including `_verify/` and anything under `docs/`.**
- **Do not remove the standing `wt-24b5c1fe` worktree or delete branch `chorus/Chorus/24b5c1fe`.** Build throwaway fixtures for destructive tests.

## Dependencies

- Phase 2 complete at `04a8a0d`. No task dependencies.
- One new npm dependency: `pino` (D30). No others.

## Step-by-step Work

**Commit 1 — chore (F21 + F23):**

1. **F21 schema + predicate** (`src/shared/ipc.ts`): add the optional `branchForceConfirmation` field and the pure `branchForceAllowed` predicate. The predicate returns `true` only when the acknowledgment is a non-empty string exactly equal to the worktree's branch name — an absent, empty, or mismatched token is `false`.
2. **F21 gate** (`src/main/ipc.ts`): swap the `forceBranch` expression for the predicate call. Confirm by reading `worktrees.ts::removeWorktree` that `opts.forceBranch` is the **only** route to `branchDelete(..., true)`.
3. **F23 fix** (`src/renderer/src/stores/layout.ts`): rewrite `insertLaunchedLeaf` so that (a) a **null tree** creates the root leaf — the only case that may assign a fresh single-leaf tree; (b) a **populated tree** always splits, never replaces; (c) the split anchor is `target.targetSessionId` when that id is present in the tree, otherwise the **first leaf in `collectSessionIds` order**; (d) the direction is the target's direction, defaulting to `'row'`. Assert-by-construction that the returned root differs from the input root before assigning.
4. **F23 caller** (`src/renderer/src/App.vue`): in `onLaunched`, when `splitTarget.value` is null and `layout.tree` is non-null, synthesize `{ targetSessionId: effectiveFocused.value, direction: 'row' }` so a palette launch splits the pane the user is looking at. A null `effectiveFocused` falls through to the store's first-leaf fallback.
5. **Tests** for both (see Test Expectations), then `npm run typecheck` + `npx vitest run`.
6. **Runtime-verify both fixes (G2)** per Verification Commands, then **commit 1**, narrated as a flagged chore closing F21 and F23.

**Commit 2 — task (logging spine):**

7. **Install `pino`** into `dependencies`. Confirm the built main bundle `require`s it (externalized) rather than inlining it, and that a cold boot still starts.
8. **Author `src/main/services/logger.ts`**: the pino instance (level from `process.env.LOG_LEVEL`, default `info`), the `redact` path list, the pure `scrubSecrets`, and the exported log surface. **`scrubSecrets` must be applied to message strings**, since pino's `redact` covers object paths only.
9. **Migrate the 24 call sites** file by file, preserving each message's information and its existing bracketed prefix convention (`[storage]`, `[restore]`, `[worktrees]`, `[cli-detect]`, `[notify]`, `[title]`) — as a structured field, a message prefix, or a child logger, per the spec.
10. **Author `scripts/secret-grep.mjs`** + the `grep:secrets` npm script.
11. **Tests** for `scrubSecrets` and the redact list.
12. **Runtime-verify (G2)**: cold-boot the app; confirm the boot/restore/reconcile lines still appear with the same information in pino's structured form; plant a fake key of realistic shape in **both** a logged object field and an interpolated message and confirm **both** emit redacted. Then **commit 2**.

## Test Expectations

**Unit (Vitest), `src/shared/ipc.test.ts`:**
- `branchForceAllowed({branch: 'chorus/X/ab12'}, 'chorus/X/ab12')` → `true`.
- `undefined`, `''`, `'chorus/X/ab13'`, and the worktree's **path** (the old, wrong token) → all `false`. The path case is the F21 regression test and must be named as such.
- `worktreeRemoveRequestSchema` accepts a payload carrying `branchForceConfirmation` and still accepts one without it (backward compatible).

**Unit (Vitest), `src/renderer/src/stores/layout.test.ts`:**
- Null tree + null target → a single root leaf (the only legal replacement).
- **Populated tree + null target → the tree GROWS**: every pre-existing session id from `collectSessionIds` is still present, and the new id is present. This is the F23 regression test and must be named as such.
- Populated tree + a **stale** target id → the new leaf still lands (first-leaf fallback), no session dropped.
- Populated tree + a valid target → splits at that target, in the requested direction.

**Unit (Vitest), `src/main/services/logger.test.ts`:**
- `scrubSecrets` replaces each known key shape (Anthropic, OpenAI, OpenRouter, GitHub, a generic long high-entropy token) with a fixed placeholder, and does so for **multiple occurrences in one string**.
- `scrubSecrets` leaves ordinary log text untouched — specifically a Windows path, a UUID, a git SHA, and a branch name of the `chorus/<repo>/<8hex>` shape must pass through **unchanged** (guarding against an over-broad regex mangling the app's own log lines).
- The redact path list contains the field names the phase will actually use, and is exported so a reviewer can read it in one place.

**Runtime (G2)** covers the F21 authorization proof, the F23 pane-survival proof, and the end-to-end redaction proof — none of which unit tests can establish.

## Verification Commands

Run from repo root (PowerShell):

```
npm run typecheck
```

```
npx vitest run
```

```
npm run grep:secrets
```

```
npm run dev
```

**F21 runtime proof — use a THROWAWAY worktree, never the standing fixture.** Create one with an unmerged commit on its branch, then send a crafted request over CDP carrying `confirmation: <worktree path>` and `deleteBranch: true` against that **clean** worktree, and confirm the branch survives:

```
git -C "C:/Projects/ContactEstablished/Chorus" worktree list
```

```
git -C "C:/Projects/ContactEstablished/Chorus" branch --list "chorus/*"
```

The pre-fix behavior force-deletes the branch; the post-fix behavior removes the worktree and **keeps the branch with its commit reachable**. Clean up the throwaway afterwards; leave `wt-24b5c1fe` and `chorus/Chorus/24b5c1fe` alone.

**⚠ The `sqlite3` CLI is NOT installed.** Inspect the DB with the `ELECTRON_RUN_AS_NODE` dump-script pattern — `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe <scratch>/dump.js <scratch>/out.json` — requiring better-sqlite3 by **absolute repo path**. Such scripts print nothing to a console, so **write results to a file**; **known flake: no file on first invocation, retry once**. See `_verify/2-1-dump.js`. **Quote the `projects` table in every dump** — F20 provenance rule: this session's `AppData` is redirected, so your DB evidence describes a different database than the coordinator's and will be re-verified.

**Harness reminders:** electron-vite does **not** hot-restart the main process — every logger/IPC check needs a real tree-kill cold boot. Kill process **trees** (`taskkill /PID <root> /T /F`); a graceful-quit test is `taskkill /PID <electron-main-pid>` **without** `/F`. Orphan checks walk the electron main PID's descendant tree, never `tasklist` name-matching.

## Acceptance Criteria

- [ ] `npm run typecheck` — zero errors (G1).
- [ ] `npx vitest run` — green, with the 142-test baseline intact and the new cases added.
- [ ] **F21:** `branchDelete(..., force = true)` is reachable **only** via `branchForceAllowed` returning true; a request carrying a path-matching `confirmation` + `deleteBranch: true` against a **clean** worktree no longer force-deletes an unmerged branch — **proven at runtime against a throwaway fixture**, with the branch and its commit surviving.
- [ ] **F23:** a palette launch into a populated layout **adds** a pane — every pre-existing session id survives in the persisted tree, and the new session is visible; proven at runtime and by the named regression unit test. The empty state still produces a single root leaf.
- [ ] A stale split target no longer drops the launched pane.
- [ ] **No `console.*` remains anywhere in `src/main`** (grep-verified); every migrated site logs the same information through pino.
- [ ] A fake key of realistic shape emits **redacted** from both a structured field and an interpolated message; ordinary log text (paths, UUIDs, SHAs, `chorus/*` branch names) is **unmodified**.
- [ ] `npm run grep:secrets` exists, runs clean on the repo, and **fails** when pointed at a planted fake key (demonstrate both).
- [ ] `pino` is the **only** dependency added; the built main bundle externalizes it; a cold boot starts and logs normally.
- [ ] **Two** narrated commits this session (D32) — the chore, then the task — each touching only its own Exact Scope files.
- [ ] The standing `wt-24b5c1fe` worktree row, directory, and branch `chorus/Chorus/24b5c1fe` are **untouched**.

## Review Checklist

- [ ] `branchForceAllowed` is pure, total, and rejects the **path** token explicitly; the handler's old `req.confirmation === w.path` expression is gone, not merely supplemented.
- [ ] `grep -n "force: true\|forceBranch" src/main` shows exactly one authorization site and one emission site, mirroring the `--force` discipline Task 2-1 established.
- [ ] `insertLaunchedLeaf` cannot discard a populated tree on **any** input; the null-tree branch is the only assignment of a fresh single-leaf tree; the stale-anchor fallback is present and tested.
- [ ] `App.vue`'s change is confined to `onLaunched`; the palette, dialog, and split buttons are otherwise untouched.
- [ ] `scrubSecrets` is applied to **message strings**, not only object paths — verify by reading the logger surface, since a redact-paths-only implementation passes a naive test and fails the real case.
- [ ] The scrub's regexes are anchored tightly enough that a UUID, a git SHA, a Windows path, and a `chorus/<repo>/<8hex>` branch name survive unchanged; over-broad redaction that mangles the app's own logs is a defect, not caution.
- [ ] Log-site migration preserved information and the bracketed-prefix convention; no log site was added, removed, or downgraded in severity.
- [ ] Nothing in this task touches PTY output, the ring buffer, or `session:data` (CR-3.0 owns that ruling).
- [ ] `WorktreePanel.vue` is untouched; no `-D` affordance was added.
- [ ] No untracked / `_verify/` / `docs/` files staged or reverted; the standing worktree fixture survives.
