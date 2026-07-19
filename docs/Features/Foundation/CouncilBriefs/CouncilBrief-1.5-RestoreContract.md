# Council Brief CR-1.5 — The Session Restore Contract for Chorus

_Issued 2026-07-19 · Status: AWAITING FINDINGS · Decision owner: Matthew Wilson · Recorder: Claude (roadmap §6)_

You are a review council of independent LLM models. Deliberate on the decision below and return findings in the **Required Output Format** at the end. You have no other context on this project — everything you need is in this document. Where you are uncertain about an external fact, say so explicitly rather than guessing.

---

## 1. What Chorus is

Chorus is a local-first Windows desktop app (Electron 43 + Vue 3 + TypeScript + Vite + Pinia) for running multiple AI coding agents (Claude Code, Codex CLI — real interactive TUIs) in parallel terminal panes. Each pane hosts an xterm.js terminal attached over typed IPC to a PTY session (node-pty/ConPTY) owned by the Electron **main** process. The renderer is strictly a view layer. The product's **prime contract**: launch, watch, control, and persist many concurrent agent sessions across multiple projects — **restart-safe** and cleanly killable — from a single window.

Locked rules (not up for review): sessions live in main, owned by `SessionManager`; all Zod validation in main only; renderer never spawns processes; IPC payloads are plain objects; SQLite (better-sqlite3 + Drizzle typed queries) with hand-rolled versioned migrations.

## 2. Current implementation state (verified 2026-07-19, commit `c91aea1`)

- **Persistence:** `sessions` table — `id` (stable UUID, PK), `project_id`, `agent` (`'claude'|'codex'`), `cwd`, `status` (`'running'|'exited'`), `exit_code`, `created_at`. `pane_layouts.layout_json` — a versioned binary split tree whose **leaves bind `sessionId`**; the row's **absence** means "no layout" (empty state). Layouts and sessions are both per-project.
- **Session identity:** the row id is stable; the PTY is ephemeral and can be re-created under the same id. Within a run, the `SessionManager`'s in-memory map is the **sole liveness authority**.
- **Lifecycle (decision D15, settled):** `launch` creates a row + spawns; `attach` is a **pure view binding** that never spawns — Vue provably remounts surviving panes when a sibling pane closes (finding F5), so an attach that spawned resurrected killed sessions until it was gated. Only the explicit per-pane Restart control sends `respawn: true` (after kill + awaited exit), respawning a fresh PTY under the same row id. `kill` terminates and keeps the row.
- **Status writing (finding F6):** a listener writes `status='exited'` + exit code when a PTY exits, and the row flips back to `running` on a Restart respawn. **But at app quit, PTYs are killed and the DB closes before the async exit events land** — sessions alive at quit keep `status='running'`. A persisted `running` therefore means *"was running when last observed"*, never *"is alive"*. This race is inherent, not a bug to fix: post-crash the same state occurs with no chance to write anything.
- **Row/leaf drift (finding F4) is routine and bidirectional:** rows outlive leaves (closing a pane kills the session but keeps the row; closing all panes leaves N rows and no layout). Leaves reference dead sessions (after every app restart, all PTYs are gone but the layout tree persists — panes render "exited" chrome with a Restart button). One pathological case exists today: if a launch's PTY **spawn fails after the row is created**, the row is orphaned at `status='running'` with no PTY and no leaf, forever — there is **no delete-session API**.
- **Post-restart Restart is currently a deliberate no-op:** `respawn: true` for an id the manager doesn't know spawns nothing. This was left as the explicit seam for this decision.
- **Restored TUIs are fresh processes.** A relaunched agent CLI starts a **new conversation** — the agent's prior conversational context lives (if anywhere) in the CLI's own session files, not in Chorus. "Restore" can restore the pane, the process, and the working directory; it cannot restore the conversation. (Whether the CLIs' own `--resume`-style flags could later close this gap is a future-phase question; do not assume it here.)

## 3. The decision

**What does Chorus promise about sessions across an app restart — and how is that promise represented in the schema and executed at boot?** This lands in Task 1-5 (project tabs + restore), the phase-closer. Cap: ~12–16 panes per project. Inactive projects restore lazily on first tab activation (settled); everything below concerns what "restore" does when it runs.

### Q1 — The relaunch signal: what does the schema say?

- **Option A (drafted):** `status='running'` **is** the relaunch signal. No schema change. Quit and crash paths are identical by construction (neither writes anything). Weakness: one column carries two meanings — observed process state (written on exit) and user intent (read by restore) — and F4/F6 show observation is already unreliable at the edges (quit race; orphan rows).
- **Option B:** split intent from observation. Add a column (e.g. `desired_state: 'running'|'stopped'`): `launch`/Restart set it `running`, `kill` sets it `stopped`, natural exit **leaves it** (the user never asked it to stop — or does natural exit clear intent? council to specify). Restore reads `desired_state` only; `status` stays purely observational. Weakness: a migration, two columns to keep coherent, and a semantic call on natural-exit.
- **Option C:** keep the single column but add a **reconcile-on-boot pass** that recomputes effective intent before any spawn: e.g. rows ∩ layout leaves define the restorable set; `running` rows outside the layout are healed to `exited` (or deleted) at boot. Weakness: reconciliation logic is the contract, and it runs on every boot.

A hybrid (B+C) is admissible if load-bearing.

### Q2 — Reconciliation: what is the restore set, and what happens to the leftovers?

At restore time there are four populations: (1) leaves whose row qualifies for relaunch; (2) leaves whose row is exited (settled: exited chrome + Restart); (3) leaves with **no row** (settled: placeholder pane); (4) **qualifying rows with no leaf**. The drafted `restore()` iterates rows and would **spawn invisible PTYs** for population 4 — known-broken. The council must specify: the restore set (presumably leaves ∩ qualifying rows), the healing rule for population 4 (mark exited? delete?), whether a delete-session API is introduced this task, and whether exited leafless rows (population accumulating since 1-4) get garbage-collected.

### Q3 — Relaunch execution: automatic, and with what guards?

- **Auto-relaunch (drafted):** boot/tab-activation silently spawns fresh PTYs for the restore set. Concerns: a relaunch storm (up to the pane cap) of agent CLI processes; a `cwd` deleted since last run currently reaches `spawn` unvalidated (launch validates cwd; the drafted restore bypasses that path); and the fresh-conversation reality (§2 last bullet) — a silently relaunched pane *looks* continuous but is a new agent conversation. Is that honest UX?
- **Restore-dead + affordance:** restore the layout with exited chrome everywhere and offer "Relaunch" (per-pane Restart and/or a one-click "Relaunch all"). Cheaper, more honest, but arguably under-delivers the prime contract's "restart-safe".
- Or auto-relaunch with explicit guards (cwd re-validation, staggered/capped spawn, a visual "relaunched — fresh conversation" affordance). Council to pick and specify the guard set.

### Q4 — The Restart button after a restart

Should Restart on a manager-unknown session (the post-restart state of every pane) relaunch from the row's `agent`+`cwd` under the same row id? If Q3 lands on any flavor of affordance-driven relaunch, this is the mechanism. Specify its relationship to the `respawn` gate (extend it, or route through a launch-like path), and whether it re-runs cwd validation.

## 4. Constraints the winner must survive

1. **Crash-correctness:** a hard crash and a clean quit must converge to the same restored state; a crash must never lose the layout or spawn something the layout can't show.
2. **The invisible-process rule:** no code path may ever spawn a PTY that no pane can reach.
3. **Migration cost:** the `sessions` schema is persisted user data under versioned migrations; the existing dev DB must open with zero manual migration.
4. **Phase 2 (worktrees) is coming:** `cwd` will increasingly point at git worktrees that get created and cleaned up — "directory vanished since last run" will become common, not exotic.
5. **Phase 1b (filmstrip) and later pop-out windows** read the same layout model and session rows; the contract must not weld restore semantics to the current grid renderer.
6. **The sessions-live-in-main proof stands:** switching project tabs must never kill or respawn live sessions.

## 5. Evaluation rubric (weigh in this order)

1. **Crash-correctness & the invisible-process rule** — both quit paths converge; population 4 can never spawn (35%).
2. **Honesty of restored state** — the UI never misrepresents liveness or conversation continuity (25%).
3. **Forward compatibility** — worktree-era cwd churn, filmstrip, pop-outs (15%).
4. **Schema reversibility** — cost of changing course after DBs exist in the wild (15%).
5. **Implementation cost inside Task 1-5** — this is a phase-closer, not a platform rewrite (10%).

## 6. Questions for the council

1. Q1: A, B, C, or a named hybrid — and the **strongest argument against** your choice. If B: specify the natural-exit semantics for `desired_state`.
2. Q2: state the restore set precisely, the healing rule for each leftover population, and whether a delete-session API ships in 1-5.
3. Q3: auto-relaunch, affordance-driven, or guarded-auto — with the exact guard list (cwd validation? spawn stagger/cap? freshness indicator?).
4. Q4: post-restart Restart semantics and its mechanism.
5. Is there a failure mode in ANY option that should force a different shape entirely (e.g. session journaling, a `last_seen_at` heartbeat, PID tracking)? Name it only if load-bearing — this is a check against option fixation, not an invitation to bikeshed.

## 7. Success criteria for this council session

The council **succeeds** if it returns: (a) one committed answer per question Q1–Q4, or an explicit tie with the tie-breaker named; (b) the restore contract restated as 3–6 sentences an implementer can code from verbatim; (c) an enumerated risk list with mitigations; (d) explicit dissents preserved — do not average away disagreement. The council **fails** if it returns a survey without commitment, or unanimity achieved by dropping the rubric.

## 8. Required output format

```
## Per-model positions
<model>: Q1 <choice> / Q2 <one-line rule> / Q3 <choice> / Q4 <choice> — <2-4 sentence rationale> — Strongest counterargument: <1-2 sentences>

## Council synthesis
Q1: <A|B|C|hybrid(named)> (<unanimous | majority N-of-M>)
Q2: <restore set + healing rules, 2-4 sentences> (<vote>)
Q3: <choice + guard list> (<vote>)
Q4: <choice + mechanism> (<vote>)
Dissents: <model: position and unresolved reason, or "none">

## The restore contract (verbatim, implementable)
<3-6 sentences>

## Risks & mitigations for the winner
1. <risk> → <mitigation>
...

## Answer to question 5
<concise; "none load-bearing" is acceptable>

## Action items for implementation
<numbered, imperative, each verifiable>
```
