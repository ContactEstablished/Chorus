# Task 2-4 Completion Summary — for Coordinator Review

**For:** Claude Fable (coordinator) · **From:** Kimi (Task 2-4 implementer) · **Date:** 2026-07-21
**Commit:** `2f0a35f` — "Phase 2, Task 2-4: worktree diff summary in the pane header (closes Phase 2)" (ONE commit, on `main`)
**Status (as submitted):** DONE — every Task 2-4 acceptance criterion and every Phase-Level Acceptance Criterion passes and is runtime-verified on this machine, including the phase milestone (two writing agents, isolated worktrees, graceful quit with zero orphaned PTYs, restart with reconcile-before-restore and uncommitted work intact). Two small deliberate deviations (below), plus the usual F20 environment caveat.

---

## ⚠ Environment statement (F20 provenance rule — read first)

**The DB evidence in this document does NOT come from your real dev DB.** Every dump I took quotes its `projects` table, and every one shows the **implementer-era ids**, not yours:

| | This session's dumps (every dump quoted) | Your machine (prompt §3) |
|---|---|---|
| Chorus project id | `a43b395d-51e2-47d3-8043-cb7b56094fca` | `985d547b-d152-4a07-9094-ddb8da56ef8f` |
| Chorus-Second project id | `b684e96e-2a50-409e-b6ce-0c3570142c31` | `f47ac10b-58cc-4372-a567-0e02b2c3d479` |
| migration v4 applied_at | `2026-07-20T15:55:52.976Z` | `2026-07-20T16:57:49Z` |
| Chorus-Second root_path | `C:\Projects\ContactEstablished\Chorus-Second` | `C:\Projects\ContactEstablished` (parent, F22) |
| baseline `worktrees` table | **EMPTY** | 1 row (`9ba9b0da…`, adopted fixture) |

Same redirected-`AppData`-but-real-`C:\Projects` condition as 2-2/2-3. Consequences: (1) my **filesystem/git evidence is trustworthy** — the worktrees, branches, and edits below happened on the real disk and you can re-inspect them; (2) my **DB evidence describes the redirected DB** — please re-verify DB-level claims against the real `%APPDATA%\chorus\chorus.db`; (3) nothing here presents the redirected DB as yours. My baseline dump (`_verify/2-4-dump-0-baseline.json`) predates any boot of mine and already showed the 2-3 end state (empty `worktrees`).

**Hand-edits to my (redirected) DB — complete list:** exactly one: `_verify/2-4-dbexec-1-f18.json` — `UPDATE sessions SET worktree_id = NULL WHERE id='ed2accf8-…'` for the F18(a) asymmetry probe (details below). It was left NULLed deliberately as the end-state witness of the probe; `worktrees.session_id` still points at that session, so all row-side reads (branch label, diff summary, 2-3's session:delete) behave correctly.

**Side effect on the real disk you should know:** my first boot ran the F19 union-scan reconcile against your on-disk fixture and adopted `wt-24b5c1fe` into MY DB as `ea650f4d-c5fb-49f5-ac2d-3e534a3e821c` (detached, `base_branch ''`) — the same adoption your DB already had as `9ba9b0da…`. At one point I briefly launched a session INTO the fixture by picking the wrong picker row (my driver error); I closed it via the real close flow and chose **Keep** at the clean-removal offer, returning the fixture to `detached`/`session_id NULL` (`_verify/2-4-dump-2-fixture-kept.json`). **The fixture directory, its branch, and (on your DB) its row are untouched and retained** (§8 honored).

---

## TL;DR

The `worktree:diff-summary` channel ships read-only: `git diff --shortstat HEAD` through a pure total parser (`parseShortstat`) plus a `??`-line untracked count, resolved via `worktreeForSession` (F18a, never `sessions.worktree_id`). Worktree pane headers show `Nf +I −D · U?`, refreshed on a 15 s interval and on focus, cleared on unmount; non-worktree panes and filmstrip cards never poll. **The phase milestone held end-to-end** (verdict sentence below). 142/142 tests (132 + 10 new), typecheck 0 errors, ONE commit touching exactly the six scope files.

## D4 flag-verification report

`git --version` → **2.50.0.windows.1**. `git diff --shortstat -h` prints the usage block with `--stat`/`--numstat` family present (artifact: session transcript; the flag is what the adapter emits). Live shape sampling in a scratch repo (`_verify/2-4-scratch-repo`, gitignored):

- ` 1 file changed, 1 insertion(+)` — **singular** "insertion(+)", the shape the prompt warned about
- ` 1 file changed, 2 deletions(-)`
- ` 2 files changed, 4 insertions(+)` — plural
- empty output for a clean tree
- `?? untracked.txt` — the porcelain untracked shape

The fixture worktree was **clean** at my session start (empty `diff --shortstat HEAD`, empty `status --porcelain`) — the prompt's pre-check output (`1 insertion(+)`, `_probe_untracked.txt`) described your machine's earlier probe state, since cleaned. Both empty and non-empty shapes were therefore exercised against real worktrees.

## F18(a) confirmation

The handler resolves the session row for `projectId`, then calls `worktreeForSession(sessionId, row.projectId)` — 2-3's shared resolver keyed on `worktrees.session_id`, the authoritative row-side pointer — **identical to the branch label's resolution** (`main/ipc.ts:120`). Proof, not inference: I launched session `ed2accf8…` into `wt-54098146`, hand-NULLed its `sessions.worktree_id` (`_verify/2-4-dbexec-1-f18.json`: before `54098146…` → after `null`; row side `session_id=ed2accf8…, status=active` untouched), then from the renderer `getWorktreeDiffSummary(ed2accf8…)` returned `{filesChanged:1, insertions:2, deletions:0, untracked:1}` and the pane header kept rendering `1f +2 −0 · 1?` after a focus refresh (`_verify/2-4-6-f18-probe.png`). Under the spec §4 sketch (`row.worktreeId`) this probe would have returned null.

## Cadence evidence (F12)

Measured with a **temporary** one-line `console.log` inside `git.ts`'s private runner (timestamped, reverted before the commit; full stream in `_verify/2-4-boot1.log`):

- **Interval:** one `git diff --shortstat HEAD` + one `git status --porcelain` per mounted worktree pane per **15 s** — pairs at 14:36:37.4, :52.4, :37:07.4, :22.4, :37.4, :52.4 (≈15.005 s apart).
- **Keystrokes:** 75 `Input.insertText` chunks over a measured 15.838 s window (`_verify/2-4-type-result.json`) → diff/status invocations for the worktree rose **32 → 36 lines = 2 pairs**: exactly the single on-focus pair (14:38:55.1, when the textarea was focused to type) plus one interval tick (14:39:07.4). **Zero per-keystroke calls.**
- **Unfocused/non-worktree:** with the worktree pane unmounted to a filmstrip card and a current-tree Codex pane focused, a 35 s window showed **58 → 58** calls for the worktree path and **0 → 0** calls with cwd at the repo root. Observed, not inferred.
- **Unmount cleanup:** the 58→58 window above *is* the cleanup proof — the unmounted pane's interval was cleared (2+ interval periods elapsed with no calls). On remount the interval resumes.
- Filmstrip cards never poll by construction (they are not `TerminalPane`s; only the focused pane is mounted).

## Files changed (one-line rationale each)

| File | Why |
|---|---|
| `src/main/services/git.ts` | `parseShortstat` (pure, total, exported for unit test) + `diffShortstat(worktreePath)` reusing the one private `runGit`; header flag comment extended. No existing function touched. |
| `src/shared/ipc.ts` | `WorktreeDiffSummary` channel + `worktreeDiffRequestSchema` (`{sessionId: z.uuid()}`) + `worktreeDiffSummarySchema` (all `z.number().int()`) + `worktreeDiffResponseSchema` (`.nullable()`), under a Task 2-4 banner. |
| `src/main/ipc.ts` | The handler, next to 2-3's worktree handlers: session row → `worktreeForSession` (F18a) → null on missing row/worktree/dir → `diffShortstat` + porcelain `??` count → outbound parse. Read-only. |
| `src/preload/index.ts` | `getWorktreeDiffSummary(sessionId)` forwarder (Zod-free). |
| `src/renderer/src/components/TerminalPane.vue` | `diff` ref + `refreshDiff()`; one `setInterval(15_000)` started in `onMounted` only when `branch.value` non-null; `onTextareaFocus` extended to also refresh; `clearInterval` in `onBeforeUnmount`; counts rendered after the branch span, hidden while all-zero. |
| `src/shared/ipc.test.ts` | 3 schema cases + the 7-row `parseShortstat` table (incl. the observed singular shape, empty, and garbage). |

**Nothing beyond §7's table.** `WorktreePanel.vue` deliberately NOT touched (the optional one-shot-per-row call — the spec's "safer default" is to skip). `_verify/` artifacts are gitignored harness convention; nothing under `docs/` staged or committed by me.

## Deviations from ImplementationSpec-2-4

1. **`refreshDiff` wraps the IPC call in try/catch (`console.warn`).** The spec sketch awaited bare; a transient git/read failure would then surface as an unhandled rejection in the renderer (an item-11 hygiene violation). The header keeps the last good counts and the next tick retries. Small, deliberate.
2. **All-zero counts are hidden** (render guard `diffHasChanges`) rather than showing `0f +0 −0` — the spec's own runtime script sanctions "or nothing when all zero, per the render guard". The span appears the moment any count is non-zero.
3. IS-2-4 §4's `row.worktreeId` sketch was **not** followed — the §4 ⚠ correction (F18a) was applied instead, as the prompt instructs; expected, not a deviation, listed here only for completeness.

## Verification transcript

**Static (G1):** `npm run typecheck` → **0 errors** (node + web, re-run after the instrumentation revert). `npx vitest run` → **142/142 across 7 files** (132 pre-existing + 10 new): `worktreeDiffRequestSchema requires a uuid sessionId`; `worktreeDiffSummarySchema accepts an all-int summary and rejects a float`; `worktreeDiffResponseSchema accepts a summary or null (no worktree)`; `parseShortstat` × 7 (` 3 files changed, 12 insertions(+), 4 deletions(-)` → `{3,12,4}`; ` 1 file changed, 2 insertions(+)` → `{1,2,0}`; ` 1 file changed, 1 insertion(+)` → `{1,1,0}`; ` 2 files changed, 5 deletions(-)` → `{2,0,5}`; ` 1 file changed, 1 deletion(-)` → `{1,0,1}`; `""` → zeros; `"not a shortstat"` → zeros).

**Runtime (feature items 1–6), app launched per §3d/f, Codex for all launches, CDP-driven, screenshots in `_verify/`:**

1. **Launch + pristine header.** New-worktree Codex launch → branch `chorus/Chorus/54098146` in the header, no counts (render guard) — `_verify/2-4-1-worktree-pane.png`. Codex's `TERM is set to "dumb"` first-run prompt appeared and was answered `y` (§3b quirk, expected).
2. **Edits → counts.** On-disk: appended 2 lines to `README.md` + one untracked file → header `1f +2−0· 1?` within the interval — `_verify/2-4-2-diff-counts.png`. Hand cross-check: `git -C wt-54098146 diff --shortstat HEAD` = ` 1 file changed, 2 insertions(+)`; porcelain = ` M README.md` + `?? _2-4-untracked.txt`. **Match.**
3. **Cadence + keystrokes** — see the Cadence evidence section above.
4. **No poll when unfocused/non-worktree** — 35 s zero-call window above; current-tree pane header has no branch span and no counts (`_verify/2-4-4-currenttree-nopoll.png`).
5. **Unmount cleanup** — same window; calls stop when the pane unmounts.
6. **Empty-`base_branch` fixture.** WorktreePanel with the adopted `wt-24b5c1fe` row present renders `—` for ahead/behind, `clean`, `detached`; nothing threw — `_verify/2-4-6-panel-fixture.png`. (My diff call targets `HEAD`, never `base_branch`, so the empty ref is not even read on this path — verified, not assumed.)

**Milestone (items 7–12):**

7. **Two writing agents, one repo, isolated worktrees.** Agent A2 (Codex `ed2accf8…`) in `wt-54098146` and agent B (Codex `d32682d0…`) in `wt-1963d58c`, plus a current-tree Codex (`0e30d37f…`) at the repo root. With A2+C live, B's launch dialog **defaulted to New worktree** (D26f — `_verify/2-4-7-b-dialog-default.png`). Each edited independently (on disk): A2 → `README.md` +2 / 1 untracked; B → `docs/Plan.md` +4 / 2 untracked. Headers: A2 `1f +2−0· 1?` (`_verify/2-4-7-a2-header-cards.png`), B `1f +4−0· 2?` (`_verify/2-4-7-b-header.png`) — **each its own, and they differ.** `git worktree list` showed main + fixture + both agent worktrees. **D26f nuance you should double-check:** with ONLY a worktree agent live, the dialog suggests *current-tree* — `resolveRepoRoot(worktreePath)` returns the worktree's own toplevel, so worktree sessions never count toward `liveSessionsInRepo` (`main/ipc.ts:311-316` documents this as intended D22 semantics, "do not 'fix'"). The new-worktree default fired because the current-tree session C was live in the main tree. If the milestone intends "a worktree agent alone should trigger the default," that is a Phase 3 design question, not a 2-4 defect — the shipped behavior matches 2-2's reviewed code.
8. **Graceful quit leaves no orphan.** Pre-quit tree (`_verify/2-4-tree-before-quit.txt`): electron-main PID 88720 under the wrapper, with three `conhost→cmd→node→codex.exe` PTY chains. `taskkill /PID 88720` **without `/F`** → the whole tree exited, wrapper included (`_verify/2-4-tree-after-quit.txt`: "root pid 100212 not found"); a survivors check across all nine pre-quit PTY PIDs returned **NONE**. Descendant-tree walk per §3g; no `tasklist` name-grep anywhere.
9. **Restart reconciles and restores.** Boot 2 (`_verify/2-4-boot2.log`): `[worktrees] reconcile: 3 row(s) across 1 repo(s); 0 surfaced` appears **BEFORE** the three `[restore] relaunched codex session …` lines; no promote/adopt/heal lines (healthy rows → no-op). All three sessions relaunched into their persisted cwds (A2→`wt-54098146`, B→`wt-1963d58c`, C→repo root). The killed-earlier leafless session `f1edb9a4` was healed to `exited` by the D16 guard. **Uncommitted edits intact on disk** in both worktrees (` M README.md` / ` M docs/Plan.md` + untracked files, contents spot-checked) and **reflected in the restored headers** (A2 `1f +2−0· 1?` — `_verify/2-4-8-restored.png`; B `1f +4−0· 2?` with the D16 "new conversation" badge — `_verify/2-4-9-b-restored.png`).
10. **Cross-check.** `git worktree list` (4 entries), the `worktrees` table (fixture `detached`/NULL; both agent rows `active` with correct `session_id`s), the `sessions` table (3 running with matching cwds), and the on-screen panes all agree — `_verify/2-4-dump-4-boot2.json`.
11. **Console hygiene.** Sniffers across both runs (`_verify/2-4-console-run1.log`, `-run2.log`): zero `An object could not be cloned`, zero uncaught exceptions, zero unhandled rejections, zero error/warn lines (only vite chatter).
12. **Read-only grep gate.** `--force` emission sites in `src/`: exactly **one** — `git.ts:143` inside `worktreeRemove`. Its single caller chain: `worktrees.ts:313` ← `main/ipc.ts:561` (2-3's gated handler) ← TerminalPane close offer / WorktreePanel. `grep "force: true|forceDirty: true|forceBranch: true" src/` → **zero**. My handler calls only `diffShortstat` + `statusPorcelain` — no writes of any kind.

## `--force` grep gate result

Emission sites: **1** (`src/main/services/git.ts:143`, `worktreeRemove`). Main-process callers of the adapter: **1** (`worktrees.ts:313`). Handler callers of the manager: **1** (2-3's `worktree:remove`). New callers added by 2-4: **0**. `force: true` literals in `src/`: **0**.

## PHASE MILESTONE VERDICT

**Two writing agents (plus a current-tree third) safely shared one repository via isolated worktrees — separate directories, separate branches, per-pane diff summaries that tracked each agent's own uncommitted work and never each other's; a graceful quit (taskkill without /F) left zero orphaned PTY processes in the electron-main descendant tree; and a restart ran worktree reconcile before session restore with no spurious healing, relaunched every session into its own worktree, and preserved every uncommitted edit on disk and in the headers. Phase 2's milestone holds on this machine, with the F20 caveat that DB-level rows should be re-read from your real DB (your `worktrees` table starts from a different baseline than mine did).**

## End-state declaration

**`git worktree list` (final):**
```
C:/Projects/ContactEstablished/Chorus                      2f0a35f [main]  (was c6ab713 during the run)
C:/Projects/ContactEstablished/.chorus/Chorus/wt-1963d58c  c6ab713 [chorus/Chorus/1963d58c]
C:/Projects/ContactEstablished/.chorus/Chorus/wt-24b5c1fe  cc3e866 [chorus/Chorus/24b5c1fe]
C:/Projects/ContactEstablished/.chorus/Chorus/wt-54098146  c6ab713 [chorus/Chorus/54098146]
```
**`worktrees` table (my redirected DB, `_verify/2-4-dump-5-endstate.json`):** fixture `ea650f4d` detached/NULL/`base_branch ''`; `54098146` active → `ed2accf8`; `1963d58c` active → `d32682d0`. Sessions: 3 `running` (restored set — the app received a final graceful quit, so your next boot restores them again), the rest `exited`.
**`chorus/*` branches:** `1963d58c`, `24b5c1fe`, `54098146` (this session's) + pre-existing `39b6f2fe`, `605843db`, `ca1eff01`, `cc30c7be` (D26 Q4 no-auto-delete).
**The `wt-24b5c1fe` fixture and its DB row are RETAINED** (§8) — directory, branch, and row all present; its earlier brief ownership by a session was fully unwound through the shipped close flow (Keep → detached).
**Both agent worktrees hold their uncommitted edits** (A2's README change + untracked file; B's Plan.md change + two untracked files) — left in place deliberately as the milestone's end-state evidence for your re-drive.
**App state:** stopped via a second graceful quit (taskkill without /F on the boot-2 electron-main PID; tree walk confirms no orphans, port 9222 free).

## Acceptance criteria (Task-2-4.md) — all PASS

- [x] `npm run typecheck` zero errors — **PASS**.
- [x] `npx vitest run` green — **PASS** (142/142; diff schema + parser cases named above).
- [x] Focused worktree pane header shows the counts; current-tree session shows none (channel returns null) — **PASS** (items 1–4).
- [x] Refresh on interval ≥15 s + on focus; not per-keystroke; filmstrip cards never poll; grid mode bounded per mounted pane — **PASS** (measured; grid-mode per-pane polling is by construction — each mounted worktree `TerminalPane` starts its own interval — filmstrip verified live).
- [x] Channel read-only; no `--force` — **PASS** (grep gate).
- [x] **Phase milestone** — **PASS** (verdict above, items 7–12 individually evidenced).
- [x] One narrated commit, Exact-Scope files only — **PASS** (`2f0a35f`, six files).

## Phase-Level Acceptance Criteria (Phase-2-Overview.md) — phase closes

- [x] Migration v4 applies in place, zero data loss; reconcile inert on empty table — carried from 2-1/2-3 (my v4 predates this session; my boot on an empty `worktrees` table adopted only the on-disk fixture, i.e. non-empty ⇒ correct action, empty ⇒ inert per 2-3's evidence).
- [x] F15 chore landed as its own commit — carried (`624f3da`, 2-1).
- [x] Lone agent defaults current-tree; second agent in the same main tree defaults new-worktree; existing-worktree picker re-attaches; non-git cwd offers only current-tree — **re-verified this session**: lone → current-tree; with C live → new-worktree (screenshot); the picker re-attached A2 into `wt-54098146` with its dirty state and diff counts intact; the Chorus-Second "not a git repo" state stands from 2-2 (my DB's Chorus-Second points at `…\Chorus-Second`, a non-repo dir — same rendering path as your F22 parent-dir row).
- [x] New-worktree launch creates `wt-<shortId>` on `chorus/<repo>/<shortId>`, DB-first journaled, both pointers transactional — **re-verified** (B's launch: row `active`, both pointers set, `git worktree list` agreeing).
- [x] Clean close offers removal; dirty close silently detaches; panel lists and gates removal with unchecked branch opt-in — carried from 2-3; the clean-offer/Keep path was **re-exercised** live when unwinding the fixture's brief ownership.
- [x] Boot reconcile classifies all five populations, idempotent, never auto-prunes, runs before restore — **re-verified** (adoption on boot 1; `3 row(s); 0 surfaced` before `[restore]` on boot 2; no healing lines).
- [x] Focused worktree pane header diff summary ≥15 s + on focus, never per-keystroke, never for cards — **this task, PASS.**
- [x] **Phase milestone runtime-proven** — **PASS** (verdict above).
- [x] Typecheck clean, vitest green, one narrated commit — **PASS.**

## Non-goals confirmation (§8, each untouched)

No per-keystroke/per-frame polling, no card timers, no timers on non-worktree panes ✓ · no per-file diff/viewer/preview ✓ · no writes from the diff path (no stage/commit/merge/branch-change/removal; never auto-merge) ✓ · no new `--force` site or caller ✓ · **no F21 fix** (the `-D`-on-clean latent path stays deferred by design — still open, see below) ✓ · no schema change / migration v5 ✓ · no restart-driver or restart-event change (D25/F14) ✓ · no new npm dependency ✓ · fixture worktree + row retained ✓ · nothing unrelated staged or committed; `docs/` untouched by the commit ✓.

## Findings, concerns, and recommendations for you (Fable)

1. **F21 remains open, deliberately.** The `-D`-on-clean latent path in `worktree:remove` is untouched per §6. It stays the one data-loss-adjacent path gated only by renderer behavior; the recorded fix direction (a distinct branch-force acknowledgment field main requires before passing `force: true` to `branchDelete`) is a good small Phase 3 work item.
2. **D26f trigger nuance (recommend a ruling or a doc line):** a worktree-resident live agent never triggers the new-worktree dialog default, because `resolveRepoRoot` on a worktree returns the worktree's own toplevel (`main/ipc.ts:311-316` calls this intended). The practical consequence: after the user closes their last current-tree session, the next launch defaults to current-tree even if three worktree agents are live — a current-tree launch into a tree nobody else is writing to is arguably correct, and it matched every scenario in the milestone, but the milestone's own wording ("with A live, launch B — the dialog must default to new-worktree") reads broader than the implementation. In my run the default fired because a current-tree session was also live. Either the docs should say "a live session *in the main tree*", or Phase 3 reconsiders the trigger.
3. **Palette launch replaces the layout tree (pre-existing, surfaced hard in this session):** a palette/"Launch agent" launch has no split target, and `insertLaunchedLeaf(null, id)` **replaces the whole tree with a single leaf** (`stores/layout.ts:55-63`) — my first agent kept running but lost its pane (leafless-running, healed to exited on the next boot by the D16 guard). Nothing destroyed, but an operator who launches via the palette loses every other pane's *view* while the sessions keep running invisibly. Recommend a Phase 3 look: append-as-split (or focus-only insertion) for no-target launches, or at least a doc line — it is surprising.
4. **Picker default selects the first option (UX trap I fell into):** the existing-worktree picker preselects `worktrees[0]`, and my driver launched into the fixture by accepting the default. A human reads the list; a script doesn't. No code change requested — but if the panel order is ever by recency this gets likelier to bite humans too; consider requiring an explicit selection when >1 option exists.
5. **Model-trailer caveat (same as 2-3's):** the commit names "Kimi K2.5 (Moonshot AI)" — treat the family as the reliable part; I can't see the deployed version from inside.
6. **Environment (standing):** F20 persists — same implementer-era DB as 2-2/2-3 (v4 `15:55Z` vs your `16:57Z` tells it at a glance). My end state deliberately leaves the two agent worktrees dirty on the real disk; if you re-drive the milestone from your DB, your boot will adopt/surface them per the reconcile matrix — that is itself a decent populations-4 exercise, but say the word and I'll clean them up through the panel instead.
7. **Note for Phase 3:** the diff poll's git fan-out is 2 processes per mounted worktree pane per 15 s (≤16 panes ⇒ ≤128 process spawns/min worst case, all sub-100 ms). Observed load was trivial, but if Phase 3 adds per-pane git features, the shared-clock pattern (1b-2) or a main-side cache keyed on `HEAD`/index mtime would be the next lever.

## Final git output

```
git status --porcelain
(clean)

git log --oneline -3
2f0a35f Phase 2, Task 2-4: worktree diff summary in the pane header (closes Phase 2)
c6ab713 Task 2-4 execution prompt
6ec674b Task 2-3 review: accept the work, prove the reconcile fix on this machine
```
