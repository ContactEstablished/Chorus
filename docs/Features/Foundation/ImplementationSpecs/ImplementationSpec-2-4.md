# Implementation Spec 2-4 — Diff Summary

_Deep spec for Task 2-4. Read `Task-2-4.md` first. Insertion points are anchored to **named symbols**, never line numbers. Git flags per git 2.50 — re-verify at execution (D4). **This task closes the phase; its runtime verification is the phase milestone.**_

## 1. The contract

> One read-only channel returns `{filesChanged, insertions, deletions, untracked}` for a session's worktree, computed from `git diff --shortstat HEAD` (tracked changes vs HEAD) + a porcelain untracked count. The **focused** worktree pane's header shows the counts, refreshed on an interval **≥15 s AND on focus** — never per-keystroke, never for unfocused cards (F12 debounce discipline; the 1b-2 one-shared-clock ticker is the cadence precedent). A non-worktree (current-tree) session returns null.

## 2. git adapter additions (`src/main/services/git.ts`)

```ts
/** Pure parser for a `git diff --shortstat` line, e.g.
 *  " 3 files changed, 12 insertions(+), 4 deletions(-)".
 *  Handles singular ("1 file changed"), missing insertion/deletion segments,
 *  and an empty line (no changes → all zeros). Exported for unit test. */
export function parseShortstat(line: string): { filesChanged: number; insertions: number; deletions: number } {
  const files = /(\d+) files? changed/.exec(line)
  const ins = /(\d+) insertions?\(\+\)/.exec(line)
  const del = /(\d+) deletions?\(-\)/.exec(line)
  return {
    filesChanged: files ? Number(files[1]) : 0,
    insertions: ins ? Number(ins[1]) : 0,
    deletions: del ? Number(del[1]) : 0
  }
}

/** git diff --shortstat HEAD in the worktree — tracked staged+unstaged changes
 *  relative to HEAD. (Untracked files are counted separately via porcelain.) */
export async function diffShortstat(worktreePath: string): Promise<{ filesChanged: number; insertions: number; deletions: number }> {
  const out = await runGit(worktreePath, ['diff', '--shortstat', 'HEAD'])
  return parseShortstat(out.trim())
}
```

Untracked count reuses `statusPorcelain` (2-1): `(await statusPorcelain(path)).filter((l) => l.startsWith('??')).length`. **Verify `git diff --shortstat HEAD` output shape against git 2.50 at execution (D4)** — the sample on the dev machine was `" 1 file changed, 15 insertions(+)"`.

## 3. IPC schema additions (`src/shared/ipc.ts`)

```ts
WorktreeDiffSummary: 'worktree:diff-summary',

export const worktreeDiffRequestSchema = z.object({ sessionId: z.uuid() })

export const worktreeDiffSummarySchema = z.object({
  filesChanged: z.number().int(),
  insertions: z.number().int(),
  deletions: z.number().int(),
  untracked: z.number().int()
})
/** null when the session has no worktree (current-tree) or its dir is gone. */
export const worktreeDiffResponseSchema = worktreeDiffSummarySchema.nullable()
export type WorktreeDiffSummary = z.infer<typeof worktreeDiffSummarySchema>
```

## 4. Handler (`src/main/ipc.ts`)

```ts
ipcMain.handle(IpcChannel.WorktreeDiffSummary, async (_e, payload): Promise<WorktreeDiffSummary | null> => {
  const { sessionId } = worktreeDiffRequestSchema.parse(payload)
  const row = storage.getSessionById(sessionId)
  if (!row?.worktreeId) return null
  const wt = storage.getWorktreeById(row.worktreeId)
  if (!wt || !fs.existsSync(wt.path)) return null
  const stat = await diffShortstat(wt.path)
  const untracked = (await statusPorcelain(wt.path)).filter((l) => l.startsWith('??')).length
  return worktreeDiffResponseSchema.parse({ ...stat, untracked })
})
```

Read-only — no staging, commit, or merge. A missing session row → null; a missing/gone worktree → null.

**⚠ Resolve the worktree the same way 2-2 resolves the branch label (F18).** The sketch above reads `row.worktreeId` (the session-side pointer), which a crash-window promote can leave NULL while `worktrees.session_id` still points at the session — that pane would silently report "no worktree" and show no counts. Whatever resolution 2-2 settles on (recommended: look the worktree up by `worktrees.session_id`), **use the identical path here** so the branch label and the diff summary can never disagree about whether a session is in a worktree.

## 5. Preload (`src/preload/index.ts`)

```ts
getWorktreeDiffSummary: (sessionId: string): Promise<WorktreeDiffSummary | null> =>
  ipcRenderer.invoke(IpcChannel.WorktreeDiffSummary, { sessionId }),
```

## 6. `TerminalPane.vue` — header counts + bounded poll

A worktree pane (has a `branch`, 2-2) polls its own diff summary. The rule is **per MOUNTED `TerminalPane`**: each mounted worktree pane runs one **≥15 s interval** plus an **on-focus refresh** (the pane already emits `focus`; reuse the same handler). In **filmstrip** mode only the focused pane is mounted, so this collapses to focused-only polling; in **grid** mode every visible worktree pane polls its own interval — bounded by the 16-pane cap (worst case ~2 git calls/pane/15 s, all headers visible and all useful). **Filmstrip cards never poll** (they are not `TerminalPane`s). Never poll per-keystroke.

```ts
const diff = ref<WorktreeDiffSummary | null>(null)
let diffTimer: ReturnType<typeof setInterval> | undefined
const DIFF_POLL_MS = 15_000

async function refreshDiff(): Promise<void> {
  if (!branch.value) return                       // non-worktree session — never polls
  diff.value = await window.chorus.getWorktreeDiffSummary(props.sessionId)
}

// in onMounted, after attach + the F13 bail:
if (branch.value) {
  void refreshDiff()
  diffTimer = setInterval(() => void refreshDiff(), DIFF_POLL_MS)
}
// reuse the existing textarea 'focus' handler to also refreshDiff():
const onTextareaFocus = (): void => { emit('focus', props.sessionId); void refreshDiff() }

// in onBeforeUnmount:
clearInterval(diffTimer)
```

**Header render** — after the branch label, when `diff` is present and any count is non-zero:

```html
<span v-if="diff" class="text-[10px] text-neutral-500" :title="'vs HEAD in this worktree'">
  {{ diff.filesChanged }}f
  <span class="text-green-500">+{{ diff.insertions }}</span>
  <span class="text-red-500">−{{ diff.deletions }}</span>
  <span v-if="diff.untracked">· {{ diff.untracked }}?</span>
</span>
```

**Cadence invariant (F12 precedent):** one interval per focused pane, ≥15 s; plus an on-focus refresh; cleared on unmount. No per-card timer (cards are not `TerminalPane`s and have no diff), no per-keystroke fetch. This bounds git process churn to at most one `git diff` + one `git status` per pane per 15 s (plus focus events).

`WorktreePanel.vue` (2-3) MAY call `getWorktreeDiffSummary` once per row on open to enrich its display — a one-shot read, not a poll — reusing the same channel.

## 7. Invariants recap (2-4)

- `parseShortstat` is pure and total (singular/plural, missing segments, empty → zeros); flags re-verified at execution (D4).
- The channel is **read-only**: no stage/commit/merge; no `--force`; no removal. Never auto-merge.
- The header poll is one ≥15 s interval per MOUNTED worktree pane + on-focus refresh, cleared on unmount (filmstrip: focused-only by construction; grid: per visible pane, capped); filmstrip cards never poll; nothing polls per-keystroke (F12).
- A current-tree session returns null and shows no counts.
- All Zod in main (D1); payloads plain (D14); no new dependency; no restart-driver change (D25).

## 8. Verification (including RUNTIME — G2, incl. the PHASE MILESTONE)

**Static:**
- `npm run typecheck` (G1).
- `npx vitest run` — `ipc.test.ts`: `worktreeDiffSummarySchema` accepts all-int summaries; `worktreeDiffResponseSchema` accepts null; `worktreeDiffRequestSchema` requires a uuid. `parseShortstat`:
  - `" 3 files changed, 12 insertions(+), 4 deletions(-)"` → `{3, 12, 4}`
  - `" 1 file changed, 2 insertions(+)"` → `{1, 2, 0}`
  - `" 2 files changed, 5 deletions(-)"` → `{2, 0, 5}`
  - `""` → `{0, 0, 0}`

**Runtime script (drive the real app; prefer Codex — Claude Code unauthenticated; screenshot each step):**
1. Launch a new-worktree session (2-2). Header shows the branch and an initial `0f +0 −0` (or nothing when all zero, per the render guard).
2. Edit a tracked file in the worktree (on disk or via the agent) → within ≤15 s (or immediately on refocusing the pane) the header shows `1f +N −M`. Add a new untracked file → the `· 1?` untracked marker appears.
3. Confirm the poll is bounded: watch the main-process git invocations / process count — one `git diff` + one `git status` per focused pane per interval, **none** for unfocused panes and **none** per keystroke.
4. Switch the pane out of focus (filmstrip card) → it is no longer a `TerminalPane` and does not poll; refocus → an immediate refresh.
5. A current-tree session shows **no** diff counts (channel returns null).
6. **PHASE MILESTONE (the headline G2 proof):**
   - Launch **two** agents against the **same** repo via **isolated worktrees** (second launch defaults to new-worktree — D26f). Each edits files independently; each pane's header reflects its own diff summary; the two worktrees are separate directories under `<repo-parent>\.chorus\<repo-name>\`, on separate `chorus/<repo>/<shortId>` branches, sharing the object store.
   - **Kill/quit:** graceful quit (`taskkill` on the electron-main PID **without** `/F`) leaves **no orphaned live PTY** (walk the descendant tree; ignore unrelated `claude.exe`).
   - **Restart:** relaunch → the boot **reconcile** classifies the worktree rows against `git worktree list` (all five populations handled; healthy `active`+entry+dir → no-op; any crash-partial promoted/adopted/surfaced per the matrix) **before** restore; `restore()` relaunches each session **into its worktree** (cwd persisted) without losing uncommitted work (the dirty edits survive on disk and in the diff summary).
   - Cross-check: `git worktree list`, and the DB `worktrees`/`sessions` rows, agree with the on-screen state.

**Completion note:** this closes Phase 2 — state in the completion summary that two writing agents safely shared one repo via isolated worktrees, reconciled on restart, runtime-proven, with no `--force`, no auto-merge, and uncommitted work preserved across close/detach/restart.
