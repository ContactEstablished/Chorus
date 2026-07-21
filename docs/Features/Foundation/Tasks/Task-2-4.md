# Task 2-4 — Diff Summary

_Fourth and final task of Phase 2 (Foundation). Windows-only. Serial after Task 2-3. **Closes the phase** — its acceptance criteria include the phase milestone. This task governs scope; `ImplementationSpec-2-4.md` governs exact contents._

## Source Of Truth

- `CLAUDE.md` (D1 Zod-in-main; D14 plain payloads; D4 verify git flags at execution; no new deps).
- Roadmap §6: **F12 debounce discipline** (twitchy/live sources must not drive per-keystroke or per-frame IPC — cited here as the precedent for the diff poll cadence); §7 milestone.
- `docs/PLAN.md` §5 ("diff summary in pane header"), §7 (pane header shows worktree branch + status).
- Style precedent: the 1b-2 filmstrip **one-shared-clock** elapsed ticker (a single coarse interval, never per-card/per-second) is the cadence model for the diff poll.

## Initial Starting Point

**Verified 2026-07-20 against commit `59e7909`**, plus Tasks 2-1/2-2/2-3 landed.

- **`git.ts`** (2-1) has `statusPorcelain(worktreePath)`; 2-4 adds a `git diff --shortstat HEAD` call + a pure shortstat parser.
- **`TerminalPane.vue`** header shows the status dot, agent label, (nullable) title, branch label (2-2), badge. It has the `focus` emit (1b-2) and its own resize interval discipline.
- **`WorktreePanel.vue`** (2-3) lists worktrees; it may reuse the diff call on open.
- **Worktree resolution**: a session's worktree is `sessions.worktree_id` → `worktrees` row → `path`; the diff channel can key off a `sessionId` or a `worktreeId`.

## Goal

Give the operator an at-a-glance sense of how much a worktree agent has changed, in the header of the **focused** pane only. One IPC channel (`worktree:diff-summary`) returns `{filesChanged, insertions, deletions, untracked}` computed via the 2-1 adapter: `git diff --shortstat HEAD` (tracked changes vs HEAD) parsed by a pure shortstat parser, plus a porcelain untracked count (`??` lines from `git status --porcelain`). The focused worktree pane's header shows the counts, refreshed on an interval **≥15 s AND on focus** — **never per-keystroke, never for unfocused cards** (bounding git process churn; the F12 debounce discipline is the precedent). `WorktreePanel.vue` rows may reuse the same call on open. This task closes the phase milestone: two writing agents safely sharing one repo via isolated worktrees, reconciled on restart, runtime-proven.

## Exact Scope

Touch **only** these files:

| File | Change |
|---|---|
| `src/shared/ipc.ts` | `worktree:diff-summary` channel; `worktreeDiffRequestSchema` (`{sessionId: z.uuid()}` — resolve the worktree in main; a session with no worktree returns null); `worktreeDiffSummarySchema` = `{filesChanged, insertions, deletions, untracked}` (all `z.number().int()`), and a nullable wrapper for the "no worktree" answer. |
| `src/main/ipc.ts` | `worktree:diff-summary` handler: resolve `sessionId` → worktree path (or null → return null), run `git diff --shortstat HEAD` + `git status --porcelain` via the adapter, parse, outbound-parse the result. |
| `src/main/services/git.ts` | Add `diffShortstat(worktreePath)` (or a `diffSummary` that also counts untracked) + the **pure shortstat parser** (`parseShortstat(line): {filesChanged, insertions, deletions}`), unit-testable. |
| `src/preload/index.ts` | `getWorktreeDiffSummary(sessionId)` forwarder. |
| `src/renderer/src/components/TerminalPane.vue` | Show the counts in the header for worktree sessions; poll on an interval **≥15 s** and on focus; **every MOUNTED worktree `TerminalPane` polls** — in filmstrip mode that is only the focused pane; in grid mode each visible worktree pane has its own ≥15 s interval (bounded by the 16-pane cap); **filmstrip cards never poll** (they are not `TerminalPane`s); clear the interval in `onBeforeUnmount`. |
| `src/shared/ipc.test.ts` | Schema cases for the diff channel + the **`parseShortstat`** helper (all shapes: files-only, insertions-only, deletions-only, both, empty). |

Nothing else. If a change seems to require another file, raise it.

## Non-Goals

- **No per-keystroke or per-frame polling** — the interval is ≥15 s plus on-focus; unfocused panes and filmstrip cards never poll (F12 discipline).
- **No per-file diff, no diff viewer, no patch preview** — shortstat counts only (rich diff is a v1-horizon exclusion).
- **No writes** — the diff channel is read-only; it never stages, commits, or merges. **Never auto-merge.**
- **No `--force`, no removal, no branch change** — 2-4 only reads.
- **No new dependency, no new restart driver** (D25/F14).
- **Do not revert, stage, or commit unrelated or untracked files, including `_verify/` and anything under `docs/`.**

## Dependencies

- Tasks 2-1/2-2/2-3 landed: `git.ts` adapter, worktree launch modes, the branch label, `WorktreePanel.vue`.
- No new npm dependencies.

## Step-by-step Work

1. **git.ts**: add `diffShortstat(worktreePath)` (`git diff --shortstat HEAD`, cwd = worktree path) and `parseShortstat(line)` (pure). Untracked count reuses `statusPorcelain` and counts `??` lines. **Verify `git diff --shortstat HEAD` output against the installed git 2.50 at execution (D4).**
2. **Schemas** (`ipc.ts`): the channel + request/summary schemas (summary nullable for the no-worktree case).
3. **Handler** (`main/ipc.ts`): resolve `sessionId` → worktree path (null → return null), compute the summary, outbound-parse.
4. **Preload**: the forwarder.
5. **TerminalPane**: header counts + the ≥15 s / on-focus poll, focused-pane only, interval cleared on unmount.
6. **Tests** per Test Expectations.
7. **Milestone runtime proof** (G2): drive two agents in one repo via isolated worktrees, make edits, confirm the counts update within the interval / on focus; kill/quit → no orphaned live PTY; restart → reconcile against `git worktree list` and restore into worktrees without losing uncommitted work.

## Test Expectations

- **Unit (Vitest), `src/shared/ipc.test.ts`:** `worktreeDiffSummarySchema` accepts all-int summaries and the null wrapper; `worktreeDiffRequestSchema` requires a uuid `sessionId`. **`parseShortstat`**: `" 3 files changed, 12 insertions(+), 4 deletions(-)"` → `{3,12,4}`; insertions-only; deletions-only; `" 1 file changed, 2 insertions(+)"` (singular "file"); empty string → all zeros.
- The header rendering, poll cadence, and milestone are **runtime-verified** (G2).

## Verification Commands

Run from repo root (PowerShell):

```
npm run typecheck
npx vitest run
npm run dev
```

Sanity-check the underlying git output the parser consumes:

```
git -C "<worktree-path>" diff --shortstat HEAD
git -C "<worktree-path>" status --porcelain
```

Milestone cross-checks (graceful quit = `taskkill` WITHOUT `/F`; force kill the process tree with `/T /F` — harness caveat):

```
git -C "<repo-root>" worktree list
```

**⚠ The `sqlite3` CLI is NOT installed on the dev machine** (verified 2026-07-21). Inspect the DB with a script requiring better-sqlite3 **by absolute repo path**, run through Electron as Node — `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe <scratch>/dump.js <scratch>/out.json` — querying `SELECT id, session_id, path, branch, status FROM worktrees;` plus the `projects` table (quote the ids — F20 provenance rule). Such scripts print nothing to a PowerShell console, so **write results to a file**; **known flake: no file on first invocation, retry once.** See `_verify/2-1-dump.js` for the pattern.

## Acceptance Criteria

- [ ] `npm run typecheck` — zero errors (G1).
- [ ] `npx vitest run` — green (diff schema + `parseShortstat` cases).
- [ ] The **focused** worktree pane's header shows `{filesChanged, insertions, deletions, untracked}`; a current-tree (non-worktree) session shows none (channel returns null).
- [ ] Counts refresh on an interval **≥15 s** and **on focus** — verified they do **not** refresh per-keystroke and that **filmstrip cards never poll** (in filmstrip mode only the focused pane is mounted and polling; in grid mode each mounted worktree pane polls its own ≥15 s interval — bounded git churn, observe the process count / logs).
- [ ] The channel is **read-only** — no staging/commit/merge; no `--force`.
- [ ] **Phase milestone (G2):** two writing agents share one repo via isolated worktrees; edits in each are reflected in its diff summary; kill/quit leaves no orphaned live PTY; a restart reconciles worktree state against `git worktree list` (all five populations handled) and restores each session into its worktree without losing uncommitted work.
- [ ] One narrated commit for this session (G3), touching only Exact Scope files.

## Review Checklist

- [ ] All Zod in **main**; the handler FK-checks/looks up the session and outbound-parses; preload/renderer Zod-free.
- [ ] `parseShortstat` is pure and total (singular/plural, missing segments, empty → zeros); flags re-verified against git 2.50 at execution (D4).
- [ ] The poll is a **single** interval ≥15 s on the focused pane, cleared in `onBeforeUnmount`; on-focus refresh reuses the same fetch; no per-card/per-keystroke timer (F12 precedent).
- [ ] The diff channel performs **no** writes; no `--force`, no removal, no merge.
- [ ] Milestone verified by **running** the app (G2), not by build success — with the current Claude Code CLI unauthenticated, prefer Codex or plain file edits + `git` observation for the diff proof.
- [ ] No restart-driver change (D25); no new dependency.
- [ ] No untracked / `_verify/` / `docs/` files staged or reverted.
