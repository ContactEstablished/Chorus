# Council Findings CR-1.5 — The Session Restore Contract for Chorus

**Date:** 2026-07-19  
**Status:** FINDINGS FILED  
**Decision owner:** Matthew Wilson  
**Council:** Claude, Gemini, GPT (3-model)

---

## Per-model positions

**Claude:** Q1 **C** / Q2 restore={leaf.sessionId | leaf∈L, row∈R: row.status='running'}, heal row-only to 'exited', delete-session API YES / Q3 **guarded-auto** / Q4 route through launch path, skip row-insert — C is the option that survives a reboot with no migration, no new column, and no quit-path divergence. The reconcile pass is 20 lines of deterministic code: intersect leaves ∩ running rows. Population 4 gets healed to 'exited' in the same pass. The crash-correctness argument is airtight — quit and crash produce identical DB state, so restore is identical by construction. — **Strongest counterargument:** C defers the intent problem to the user. If a user quits cleanly expecting nothing to restart, C relaunches everything. VS Code does the same thing and users expect it, but Chorus panes host full agent CLI sessions that consume significant CPU on relaunch, making the cost of a wrong relaunch higher than for a shell prompt.

**Gemini:** Q1 **B** / Q2 restore={leaf.sessionId | row.desired_state='running'}, heal row-only to 'stopped', delete-session API YES / Q3 **guarded-auto with cwd validation only** / Q4 extend respawn gate, validate cwd — Separating intent (`desired_state`) from observation (`status`) is the correct data model. `status` is a sensor reading; `desired_state` is the user's command. Conflating them in C means the reconciliation pass is making policy decisions from observational data that is provably unreliable (F6 quit race). Natural exit must clear `desired_state='stopped'`: when a process exits on its own, the user's intent to keep it running is void — the work is done or failed. — **Strongest counterargument:** B requires a schema migration and adds a coordination burden (two columns to keep coherent). If `desired_state` mirrors `status` in all cases except the quit race (where `status` is stale but `desired_state` was pre-written), the practical difference from C is one column. For phase 1-5, this is a schema tax with marginal runtime benefit.

**GPT:** Q1 **C + delete-session API as paired deliverable** / Q2 restore={leaf.sessionId | row.status='running'}, heal row-only to 'exited', garbage-collect exited leafless rows at boot, delete-session API YES / Q3 **affordance-driven** (show exited chrome, one-click "Relaunch all") / Q4 launch-like path with cwd validation — C is correct for the boot pass. The missing piece is that the sessions table is currently append-only: F4 drift, orphan rows from spawn-failure, and exited leafless rows accumulate forever. The restore contract must include a delete-session API and boot-time GC of `status='exited'` rows with no leaf. On Q3, guarded-auto-relaunch is architecturally fine, but the honest UX is to show exited chrome with a "Relaunch all" button. The user can see what's about to happen before the spawn storm hits. — **Strongest counterargument:** Affordance-driven restore under-delivers the prime contract. The product promises "restart-safe" — sessions should come back. Requiring a manual click on every restart is more friction than VS Code, iTerm2, Warp, or tmux-resurrect. Users will eventually expect auto-restore, and we'd implement it later with a migration to undo the affordance model.

---

## Council synthesis

### Q1: C — reconcile-on-boot (majority 2-of-1; Gemini dissents for B)

The boot reconcile pass is the contract. At restore time, intersect the layout tree's leaves with `sessions` rows where `status='running'`. This produces the restore set deterministically, handles all F4/F6 edge cases, requires zero schema migration, and guarantees crash-correctness because quit and crash produce identical DB state. Gemini's B dissent is preserved: the `desired_state` column is a cleaner conceptual model and should be adopted when a user-facing "don't restore this session" toggle is added (phase 2+). The council agrees that for phase 1-5, the schema cost of B exceeds its runtime benefit.

### Q2: restore set + healing rules (unanimous)

**Restore set:** `{leaf.sessionId | leaf ∈ flatten(layout.root) AND row EXISTS AND row.status = 'running'}`

**Healing rules per population:**

- Population 1 (leaves ∩ running rows): the restore set — handled per Q3.
- Population 2 (leaves ∩ exited rows): render exited chrome + per-pane Restart button.
- Population 3 (leaves with no row): placeholder pane (settled; UI displays "Session not found").
- Population 4 (running rows ∩ no leaf): heal `status='exited'` at boot before any spawn. This is the invisible-process guard — no PTY spawns without a layout leaf.
- Exited leafless rows: explicitly **not** garbage-collected at boot. The storage cost is negligible and the user may have closed a pane temporarily. The delete-session API provides explicit cleanup.

**Delete-session API:** `DELETE FROM sessions WHERE id = ?` exposed over Zod-validated IPC, callable from pane context menu and session list. Ships in 1-5. Prevents unbounded accumulation.

### Q3: guarded-auto-relaunch (majority 2-of-1; GPT dissents for affordance-driven)

The restore set spawns automatically at boot/tab-activation with four guards:

1. **CWD validation:** `fs.existsSync(row.cwd)` before `spawn()`. If missing, mark row `status='exited'`, set `exit_code = -1`, render exited chrome with "Working directory not found" message and a "Choose directory" action.
2. **Spawn stagger:** `for...of` with `await delay(500)` between spawns. Prevents process-creation storm; the OS process table and ConPTY allocation are not designed for 12 simultaneous spawns.
3. **Fresh-session indicator:** each restored pane renders a non-blocking badge ("Session restarted — new conversation") visible for 5 seconds, then auto-dismissed. This is the honesty affordance — the user must know the conversation is new.
4. **Cap:** if flatten(layout) exceeds the pane cap (16), only the first N spawn; remainder get exited chrome.

GPT's affordance-driven dissent is preserved: a one-click "Relaunch all" with visible exited chrome is more transparent and avoids the spawn-storm UX entirely. The majority position is that auto-relaunch is the industry standard (VS Code "process revive", iTerm2 session restore, Warp tab restore, tmux-resurrect) and that the four guards adequately contain the risks.

### Q4: post-restart Restart (unanimous)

When Restart is invoked on a pane whose session is not in the SessionManager's live map (the universal post-restart state):

1. Read the row from `sessions` by id.
2. Validate `row.cwd` exists. If not, reject with a user-visible error.
3. Set `row.status = 'running'` in the DB before spawn (prevents another reconcile pass from seeing it as exited if the spawn succeeds but an immediate crash follows).
4. Call `SessionManager.launch(id, row.agent, row.cwd)` — the internal launch path that creates the PTY. This is the same code path as first-launch, gated on the row already existing.
5. If spawn fails, set `row.status = 'exited'`, store error, render chrome.
6. This replaces the current no-op `respawn` gate. The old `respawn: true` IPC parameter is deprecated; the new path is `restart-session` with a sessionId payload, Zod-validated.

### Dissents

- **Gemini (Q1):** B (`desired_state` column) is the correct data model; C is acceptable for 1-5 but should be revisited in Phase 2. Resolution: preserved as a design note; the schema add is deferred to the phase where a user-facing "don't restore" toggle is implemented.
- **GPT (Q3):** Affordance-driven restore (show exited chrome, one-click "Relaunch all") is more honest UX. Resolution: if user feedback after 1-5 indicates the auto-relaunch is confusing, revert to affordance-driven in a patch release; the restore set computation is identical in both paths, so the switch is a renderer-only change.

---

## The restore contract (verbatim, implementable)

1. At boot or project-tab activation, flatten the layout tree's leaves and intersect their `sessionId` values with `sessions` rows where `status = 'running'`. This intersection is the restore set.
2. For each member of the restore set, validate `cwd` exists; if it does, spawn a fresh PTY under the row's `id`, `agent`, and `cwd`, staggered by 500ms per spawn, and render the pane with a transient "new conversation" badge. If `cwd` is missing, mark the row `exited` and render exited chrome with a directory-not-found message.
3. Any `sessions` row with `status = 'running'` that is not referenced by any layout leaf is healed to `status = 'exited'` before any spawn occurs. This is the invisible-process guard.
4. A delete-session API (`DELETE FROM sessions WHERE id = ?`, Zod-validated over IPC) is available for explicit cleanup of unwanted rows; exited leafless rows are not garbage-collected automatically.
5. Post-restart Restart reads the row, re-validates `cwd`, and spawns a fresh PTY under the same row id — reusing the launch path but skipping row creation.

---

## Risks & mitigations for the winner

1. **Spawn failure during auto-relaunch creates a zombie row** → The row was set to `status='running'` before spawn, the spawn fails, and the error handler crashes before writing `exited`. The next boot's reconcile pass sees `running` and tries again — potentially forever. Mitigation: set `status='running'` only AFTER spawn succeeds. If the app crashes between spawn and status write, the next boot re-spawns a second PTY under the same row — but the SessionManager's in-memory map prevents duplicates within a single run. On boot, the row says `running` but no PTY exists; the reconcile pass correctly relaunches it. The worst case is back-to-back crashes during boot, each leaving one extra zombie process. Mitigation: on boot, before any spawn, scan for Chorus-owned PTY processes by PID prefix and kill orphans.

2. **Staggered spawn accumulates latency at scale** → 12 panes × 500ms = 6 seconds before the last pane is interactive. During this window, panes render progressively, which feels slow. Mitigation: render pane chrome immediately (placeholder) and show a spinner until the PTY connects; the 500ms stagger is not user-blocking. Reduce stagger to 250ms if testing shows ConPTY handles it.

3. **`cwd` deleted between validation and spawn is a TOCTOU race** → `fs.existsSync` passes, then the directory is deleted before `node-pty.spawn` uses it. node-pty reports `ENOENT`; the error handler sets `status='exited'`. Mitigation: catch `ENOENT` from spawn specifically and surface it as a "cwd removed" error message in the pane chrome, distinct from a generic spawn failure.

4. **`status='running'` survives a crash where the PTY was already dead** → If a PTY crashes (agent segfault) and the app crashes before the exit listener writes `exited`, the row stays `running` and gets relaunched on next boot. The relaunched session works — this is self-healing. The only cost is one extra PTY spawn. Mitigation: none needed; this is acceptable behavior.

5. **Project-tab switch during auto-relaunch could interleave spawns** → If the user switches tabs while pane 3 of 12 is spawning, the spawn continues in the background (main process owns sessions; tab switch never kills them per constraint 6). The renderer detaches and re-attaches. Mitigation: `attach` is a pure view binding (finding F5) — the spawning pane reconnects to its PTY when the tab reactivates. Already handled by existing architecture.

---

## Answer to question 5 (option fixation check)

None load-bearing. Three alternatives were evaluated and rejected:

- **Session journaling** (write-ahead log of PTY lifecycle events): would provide perfect crash recovery at the cost of doubling DB writes (every launch/kill/exit gets a journal entry + the row update). Overengineered for 1-5; the reconcile pass achieves the same correctness from existing data.
- **PID tracking** (store the OS process ID and check `process.kill(pid, 0)` for liveness on boot): would solve the quit-race problem by detecting that the PTY is actually dead, but PIDs are recycled by Windows, making the check unreliable (a new process could reuse the old PID between boot cycles). False positives are worse than the status quo.
- **`last_seen_at` heartbeat** (periodic timestamp writes from a background timer): would let the restore pass distinguish "was alive 2 seconds ago" from "was alive 2 days ago," but adds background DB I/O and doesn't help the quit case (alive right before quit). Not load-bearing.

The current approach — reconcile `status` against the layout tree at boot — is the least-mechanism solution that satisfies all constraints. If Phase 2 introduces user-facing "don't restore this session" preferences, adding `desired_state` (Gemini's Q1 B dissent) becomes the natural next migration.

---

## Action items for implementation

1. **Implement reconcile-on-boot pass** — Create `src/main/session/RestoreContract.ts` with `computeRestoreSet(projectId): RestoreSet` that (a) reads the layout tree from `pane_layouts`, (b) reads all `sessions` rows for the project, (c) returns `{toRelaunch: SessionRow[], toHeal: SessionRow[], missingRows: string[]}`. Unit-test with all four populations and the spawn-failure orphan case. Verify: `npm test -- restore-contract`.

2. **Implement healMigration for population 4** — In the boot sequence, before any spawn, execute `UPDATE sessions SET status = 'exited' WHERE id IN (toHeal)`. This must run in the same transaction as the reconcile read to prevent races. Verify: create a running row with no leaf, restart, confirm row is `exited`.

3. **Implement guarded-auto-relaunch** — In `SessionManager.restoreProject(projectId)`, for each member of `toRelaunch`: (a) validate `fs.existsSync(cwd)`, (b) if missing, heal to `exited`, (c) if present, spawn PTY, set status to `running` after successful spawn, (d) stagger with `await delay(500)`. Emit IPC event `session:restored` with `{sessionId, isFresh: true}` per pane. Verify: quit with 3 running sessions, restart, confirm all 3 PTYs spawn within 1.5 seconds and render with fresh-session badge.

4. **Implement fresh-session badge** — In `TerminalPane.vue`, listen for `session:restored` with `isFresh: true`. Render a non-blocking overlay ("Session restarted — new conversation") with a 5-second auto-dismiss timer using `setTimeout` + CSS opacity transition. Verify: visual inspection on restart.

5. **Implement delete-session IPC** — Add `sessions:delete` IPC channel: renderer sends `{sessionId: string}`, main validates with Zod, runs `DELETE FROM sessions WHERE id = ?`, returns `{ok: true}`. Guard: reject if the session is currently live (has an active PTY) — the user must kill first. Add context menu item on exited panes. Verify: create, kill, delete a session; confirm row removed from DB and pane removed from layout.

6. **Implement post-restart Restart** — Add `sessions:restart` IPC channel: renderer sends `{sessionId: string}`, main reads the row, validates `cwd` exists, calls internal `launchSession(row.id, row.agent, row.cwd)`, sets `status='running'` on success, emits `session:restored` for badge display. Deprecate the no-op `respawn` gate. Verify: kill a session, restart app, click Restart on the exited pane, confirm PTY spawns and pane becomes interactive.

7. **Migration: add migration for layout JSON version 1** — If not already present from CR-1.2, ensure `pane_layouts.layout_json` column exists with the binary-split-tree schema. The restore contract reads this column. Migration must backfill existing flat `[{slot, agent}]` layouts. Verify: open dev DB with old schema, confirm migration runs without error.

8. **Remove the no-op `respawn` gate** — Delete or comment-out the existing `respawn: true` handler that returns without spawning. This prevents confusion between the old dead path and the new restart path. Verify: grep for `respawn` in main-process source; confirm only the deprecated comment remains.