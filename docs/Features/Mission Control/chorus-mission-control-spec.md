# Chorus feature spec — Mission Control

**Status:** proposed, roadmap candidate
**Priority:** low — must not derail current phase work
**Owner:** Matt
**Depends on:** existing Chorus pane lifecycle, LiteLLM proxy

---

## 1. Summary

Mission Control is a scheduling, costing, and forecasting panel inside Chorus. It reads a
committed dependency graph of the project's tasks and combines it with telemetry Chorus is
already generating — which agent ran which task, on which model, for how long, for how many
tokens — to answer four questions that no current tool answers together:

1. What can be worked on right now, and which agent/model should take it?
2. How much of *my* attention has this cost, and how much remains today?
3. What has this project cost in tokens, and what will it cost to finish?
4. When does it ship, with what confidence?

It is, structurally, a critical-path-method (CPM) scheduler with two extra cost dimensions
(attention-minutes and tokens) and an agent fleet as the resource pool.

The design borrows one idea wholesale from `rockthemike712/mission-control-board` (MIT):
**readiness is derived, never stored.** Tasks declare `deps`; the engine computes what is
unblocked. This spec extends that principle — critical path, review gates, estimates, and
the ship date are *all* derived. The only things stored by hand are facts about the work.

---

## 2. Why this belongs in Chorus rather than as a standalone tool

A standalone board would have to reconstruct information Chorus already owns:

- Chorus knows when a pane starts, what it is running, and when it exits — that is wall-clock
  duration, for free.
- Chorus knows which agent binary and which model a pane is using — that is the routing
  dimension, for free.
- Chorus owns window focus — that is the only tractable path to measuring attention-minutes.
- Chorus is the process that would need to *act* on a dispatch recommendation anyway.

Every one of those is expensive to obtain from outside the process and free from inside it.
The board is a missing view over telemetry Chorus is already sitting on.

---

## 3. Scope

### In scope (eventually)

- Task graph ingestion from a committed seed file
- Derived readiness, fan-out, critical path, float
- Dispatch recommendation across available agent panes
- Token and cost attribution per task and per dispatch
- Wall-clock and attention-minute tracking
- Self-calibrating estimates from historical actuals
- Monte Carlo ship-date projection with confidence bands
- Derived council-review gates
- A PM-facing status export

### Explicitly out of scope

State these as non-goals so the feature does not drift into being a project management product:

- No multi-user, no accounts, no auth, no server. Single operator, local-first.
- No comments, attachments, notifications, or activity feeds.
- No two-way sync with Jira / Azure DevOps / GitHub Issues. One-way *import* is a possible
  later phase; two-way sync is never in scope.
- No sprint/ceremony concepts — no story points, no sprints, no standups.
- No mobile or web surface. It lives in the Chorus desktop app.

---

## 4. Domain model

### 4.1 Concepts

| Concept | Definition |
| --- | --- |
| **Task** | A unit of work with a stable id, a track, an owner class, a kind, a size, and dependencies. Hand- or agent-authored. Committed. |
| **Track** | A named line of work (a "line" on the map view). Purely for grouping and display. |
| **Dispatch** | One execution attempt of a task by one agent in one pane. Machine-generated. Not committed. |
| **Actual** | The rollup of all dispatches for a task once complete: wall, attention, tokens, cost, retry count. |
| **Estimate** | Derived, never stored. Looked up from historical actuals keyed by `(kind, size, owner)`. |
| **Gate** | A derived review requirement on a task — `none`, `human`, or `council`. |
| **Routing policy** | A separate committed file mapping `(kind, size)` to a preferred and fallback model. |

### 4.2 The owner model — breaking change from the original

The original board hard-enforces exactly two lanes (`me` and `agent`) and its test suite
asserts `lanes.length === 2`. That constraint is wrong for Chorus, whose entire premise is
*n* agents running in parallel.

Replace it with an **owner class** plus optional pinning:

```jsonc
"owner": "human"                      // requires Matt
"owner": "agent"                      // any available agent pane
"owner": { "class": "agent", "pin": "claude-code" }   // this agent specifically
"owner": "ext"                        // the outside world; nobody can start it
```

Agent capacity is not declared in the seed — it is read live from Chorus's pane count. This
matters: the seed describes *the work*, Chorus describes *the capacity*, and the projection
is a function of both. Keeping capacity out of the committed file means the same seed
projects differently on a machine running three panes versus six, which is correct.

### 4.3 Task schema

```jsonc
{
  "id": "b-billing-migration",       // stable, unique, referenced by deps
  "title": "Migrate billing schema",
  "short": "Billing",                 // map label
  "track": "backend",
  "owner": "agent",
  "status": "open",                   // open | done
  "deps": ["b-schema-review"],

  "kind": "refactor",                 // scaffold | refactor | debug | design | test | review | research
  "size": "L",                        // XS | S | M | L | XL

  "surface": ["payments", "migration"], // risk tags, drives gate derivation
  "reversible": false,                  // one-way door?

  "priority": "high",                 // tiebreaker only; never overrides deps
  "terminus": true,                   // at most one per board
  "rework_of": null,                  // task id, if this exists to fix another task
  "detail": "One line of context.",
  "ref": { "label": "spec", "href": "https://..." }
}
```

`kind` and `size` are the only genuinely new required fields, and they are what make
estimation, routing, and costing possible. Everything else is optional and degrades
gracefully.

### 4.4 Size semantics

Size is **not** hours. It is a t-shirt class whose hour value is looked up from history.
Seed the lookup table with priors so the tool is useful on day one, then let actuals replace
them. Suggested starting priors (wall-clock, agent-owned):

| Size | Prior p50 wall | Prior p50 attention |
| --- | --- | --- |
| XS | 10 min | 3 min |
| S | 40 min | 6 min |
| M | 2 h | 15 min |
| L | 4 h | 25 min |
| XL | 8 h | 45 min |

Human-owned tasks have a separate table where wall and attention are near-equal by
definition. Store the tables as data, not constants — they are meant to be overwritten.

---

## 5. Where the data comes from

This is the section that determines whether the feature lives or dies. **Anything requiring
manual entry will be abandoned within a week.** Ranked by automation:

### 5.1 Tokens and cost — LiteLLM virtual keys (primary)

Matt already runs a LiteLLM proxy in front of his models. The naive approach — inject
`metadata: {task_id}` into requests — fails because the agent CLIs (Claude Code, Codex CLI,
Aider, Gemini CLI) do not reliably forward arbitrary metadata fields.

**Recommended: mint a LiteLLM virtual key per dispatch.**

On dispatch, Chorus calls the LiteLLM admin API to create a short-lived virtual key tagged
with the dispatch id and given a hard budget cap. It launches the agent pane with that key in
the environment. On dispatch end, it revokes the key and reads the spend.

This gives three things at once:

1. **Attribution** — every token spent under that key belongs to that dispatch, regardless of
   whether the CLI forwards metadata.
2. **Budget guardrails for free** — the key hard-stops at its cap, so a runaway agent cannot
   burn the month's budget. Cap = estimated cost × a configurable multiplier (start at 3×).
3. **Revocation** — a stuck pane cannot keep spending after it is killed.

Requires each agent CLI to accept a custom base URL and key via environment variables.
Claude Code (`ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`) and Aider support this. **Codex CLI
and Gemini CLI need verification — see open questions.**

Fallback for any CLI that cannot be pointed at the proxy: parse its local session logs.
Claude Code writes per-session JSONL with token counts under its projects directory. This is
brittle and format-dependent; treat it as a degraded path, not the design.

Capture per dispatch: `tokens_in`, `tokens_out`, `tokens_cached`, `model`, `cost`.

**Cached input must be tracked separately.** Claude Code against a large CLAUDE.md hits cache
constantly, and cached input is priced roughly an order of magnitude below fresh input. A
projection that ignores cache hits will be badly wrong in the expensive direction.

### 5.2 Wall-clock — Chorus pane lifecycle (free)

A dispatch opens when a pane is assigned a task and closes when the pane exits or the task is
marked done. Chorus already emits both events. No new instrumentation.

Record `started_at`, `ended_at`, `outcome` (`completed` | `abandoned` | `failed`), and
`agent_id`.

### 5.3 Attention-minutes — focus and idle tracking

The most valuable output and the least reliable input. Measure automatically, then allow
correction:

- Track which pane holds focus and for how long, via Electron `BrowserWindow` focus events
  plus per-pane active state in the renderer.
- Discount away-from-keyboard time using `powerMonitor.getSystemIdleTime()`; anything over a
  60-second idle threshold does not count.
- Attribute focused, non-idle time to whichever task that pane is running.
- Time spent in Chorus but not in any agent pane (reviewing the board, reading diffs) is
  attributed to a per-project overhead bucket, not to a task.

On task completion, show the measured number with a one-tap correction control. Do not ask
the user to run a timer — that is the failure mode this is designed to avoid.

### 5.4 Rework and size validation — git

Link commits to tasks with a commit trailer (`Task-Id: b-billing-migration`) written by the
agent, or inferred from branch name. This yields:

- Diff line counts as an independent check on whether a task was really the size it claimed —
  useful for recalibrating the size table.
- Rework detection: a later task with `rework_of` pointing at a completed task, or commits
  touching the same files shortly after completion, both signal that the original dispatch
  did not hold. Rework rate by `(model, kind)` is the single best quality signal available.

Tool-agnostic, so GitKraken usage is unaffected.

### 5.5 The seed itself — hand or agent authored

The task graph is committed JSON in the project repo. It should be editable by hand, but the
expected path is that Claude Code proposes seed patches as part of its PRs. Add a rule to the
project CLAUDE.md constitution: the agent reads the seed to select work, may only start tasks
where `owner` permits it and all `deps` are `done`, and must emit a seed patch in its PR.

That turns the board from a passive view into the scheduler for the existing phase-gate
autonomy setup.

---

## 6. The derivation engine

Everything below is computed on read. None of it is stored in the seed.

### 6.1 Readiness

A task is ready when `status === "open"` and every id in `deps` resolves to a task with
`status === "done"`. `ext`-owned tasks are never dispatchable but do block their dependents.

### 6.2 Graph metrics

- **Fan-out** — size of the transitive closure of dependents. Drives the "unblocks N" display
  and feeds gate derivation.
- **Critical path** — longest path by p50 wall-clock from any root to the terminus. Tasks on
  it are flagged `critical`.
- **Float (slack)** — how long a task can slip before it moves the ship date. Critical-path
  tasks have zero float. Display float on non-critical tasks so it is obvious what can wait.

Validate on load: all `deps` resolve, the graph is acyclic, ids are unique, at most one
terminus. Refuse to render on failure and say which rule broke. Port the original repo's
`tests/smoke.js` checks (MIT, ~168 lines) rather than rewriting them.

### 6.3 Estimation

Look up `(kind, size, owner)` in the actuals table and return the empirical p50 and p80 for
wall, attention, and tokens. Fall back to the seeded priors when there are fewer than five
samples.

**Always surface the sample count.** An estimate backed by two observations must not look
like one backed by forty. A projection built on thin data is worse than no projection because
it invites false confidence.

### 6.4 Gate derivation

Compute a review requirement rather than hand-setting one. Escalate to `council` when any of:

- the task is on the critical path **and** `reversible === false`
- `surface` intersects the configured high-risk set (auth, payments, migrations, public API,
  destructive operations)
- fan-out exceeds a threshold (start at 5)
- the dispatch required more retries than its size predicts
- the task is agent-authored and touches code with no test coverage

Escalate to `human` on a lower bar; otherwise `none`. All thresholds live in config.

A council review is itself a schedulable unit with duration and token cost — model it as a
synthetic task in the graph so it appears in the projection rather than being invisible
overhead.

### 6.5 Ship-date projection

A resource-constrained Monte Carlo, not a single date.

For each of ~1000 iterations:

1. Sample each open task's duration from its empirical distribution. With fewer than five
   samples, fit a lognormal to the prior p50/p80 and sample that.
2. Run a discrete-event forward pass over the DAG. At each step, dispatch ready tasks to free
   agent slots, subject to: available pane count, remaining daily attention budget, and
   `owner`/`pin` constraints.
3. Record the completion time of the terminus.

Report p50, p80, and p90 as dates. Also report which constraint bound each run — agent slots
versus attention — because **the attention budget is usually the binding constraint, not the
agent count.** Surfacing "you are attention-bound, two panes idle" is a finding a PM has never
seen, and it correctly explains why adding agents stops helping.

Run in a worker thread. A thousand iterations over a fifty-task graph is fast, but it should
never block the UI.

### 6.6 Velocity

Trailing completed size-units per working day, over a configurable window (default 14 days).
Used for the burndown and as a sanity check on the Monte Carlo output — if the two disagree
sharply, the size table needs recalibration and the UI should say so.

---

## 7. UI

Three surfaces plus one inline element. All in the existing Vue 3 renderer.

### 7.1 Dispatch panel — the daily driver

The default view. Top to bottom:

**Header metrics** (three cards): ship date at p80 with p50 as a subtitle and drift since last
projection; spend to date with projected total against cap; critical path length in hours and
task count.

**Attention budget bar.** Minutes committed today against the configured daily budget, with
the binding-constraint callout underneath when applicable ("attention-bound — 2 panes idle").

**Up now — recommended dispatch.** The ready set, ordered by projected ship-date impact rather
than by declared priority. Each row shows:

- a status chip: `critical`, or float remaining ("slack 6h"), or `waiting 9d` for aged
  external blockers
- title, then a metadata line: `kind · size · Nh wall / Nm yours · unblocks N`
- a gate line when a review is required, with the derived reason
- right-aligned: the routed model and estimated cost

Rows are actionable — dispatching from here assigns the task to a free pane, mints the virtual
key, and launches the agent.

**Waiting** and **Done** sections collapse below, as in the original.

### 7.2 Map view

Keep the original's transit-map metaphor — it is good, and the code is MIT-licensed and
readable (~394 lines for the map module). Extend it:

- Highlight the critical path as a distinct, heavier line.
- Annotate stations with cumulative cost and time rather than just status.
- Keep the terminus convergence and the cross-track connectors as-is.

The map is a communication artifact more than a working view. It earns its place in
screenshots and status meetings.

### 7.3 PM report

A generated, exportable snapshot — markdown to clipboard or file. Contents: projected ship
date with confidence band and drift since last report, burndown against velocity, spend
against budget, the current critical path, aged external blockers, and any material
projection changes with their recorded reasons.

This is the artifact that makes the feature legible to people who will never open Chorus.
Aged external blockers in particular ("nine days waiting on client credentials, blocking four
tasks") are the highest-value line in the whole report and cost one timestamp to produce.

### 7.4 Pane task chip — highest daily value per line of code

Each running pane's header shows: task title, elapsed wall time, tokens burned so far, and
percentage of its budget cap consumed. Small, always visible, and it makes cost concrete at
the moment it is being incurred rather than in a report afterwards.

If only one piece of UI ships, ship this one.

---

## 8. Architecture and storage

Electron + Vue 3 + TypeScript, matching existing Chorus structure.

**Main process** owns all ingestion:

- LiteLLM client — key minting, revocation, spend polling
- Pane lifecycle listener — dispatch open/close
- Focus and idle tracker — attention attribution
- Git watcher — commit trailers, diff stats
- The derivation engine and the Monte Carlo worker

**Renderer** owns the three views and the pane chip, fed over IPC.

**Storage splits deliberately in two:**

| What | Where | Committed? |
| --- | --- | --- |
| Task graph (seed), routing policy, config | JSON in the project repo | Yes — diffable, reviewable in PRs |
| Dispatches, actuals, attention log, size tables | Local SQLite | No — gitignored |

The rationale matters: **the plan is shared, the telemetry is personal.** The seed belongs in
version control so a task graph can be reviewed alongside the code it describes. The actuals
are machine-local, grow unbounded, are queried by `(kind, size, model)` rather than read
whole, and would be noise in every diff. SQLite, not JSON, for that half.

One consequence worth stating: because actuals are machine-local, the estimator calibrates to
*this* operator on *this* machine. That is correct — the whole point is a personal, calibrated
forecast, not an industry benchmark.

---

## 9. Phasing

Sequenced so that nothing derails current phase work, with one exception that genuinely
cannot wait.

### Phase 0 — telemetry capture only *(do this first, ~half a day)*

No UI. No board. Just start recording dispatches to SQLite or even append-only JSONL:
task id (or a placeholder), agent, model, start, end, tokens, cost, outcome.

**Rationale for doing this out of priority order:** historical actuals cannot be backfilled.
Every week without capture is a week the estimator cannot calibrate, and phases 2 onward are
worthless without three to four weeks of data. This is the only urgent piece, and it is small
enough not to disturb anything.

*Acceptance:* dispatches appear in the store with non-zero token counts attributed to the
right agent and model.

### Phase 1 — schema, validation, and a read-only board

Seed loader, graph validation, readiness, fan-out, critical path, float. Dispatch panel
rendering without projection or recommendation. Pane task chip.

*Acceptance:* an invalid seed is rejected with a specific reason; the critical path matches a
hand-computed result on a fixture graph; the panel shows the correct ready set.

### Phase 2 — estimates and projection

Size tables, empirical lookup with sample counts, Monte Carlo worker, ship-date cards,
attention budget bar and binding-constraint detection.

*Blocked on:* three to four weeks of phase 0 data.

*Acceptance:* projections carry visible confidence; the tool refuses to project when sample
counts are below threshold; the binding constraint is correctly identified on a synthetic
scenario with deliberately scarce attention.

### Phase 3 — routing and gates

Routing policy file, model recommendation per task, virtual-key budget caps, derived council
gates, rework tracking, cost-and-rework-by-model reporting.

*Acceptance:* a task tagged `payments` and `reversible: false` on the critical path derives a
council gate without hand-setting; per-model rework rates are queryable.

### Phase 4 — PM report

Markdown export, burndown, blocker aging, decision log.

*Acceptance:* a report generates from a real project and is intelligible to someone who has
never opened Chorus.

---

## 10. Open questions

To resolve before implementation; do not guess at these.

1. **Does the current Chorus pane abstraction expose a stable id that survives app restart?**
   Dispatch records need to reattach to panes across restarts, or dispatches will orphan.
2. **Can Codex CLI and Gemini CLI be pointed at a custom base URL and key via environment
   variables?** Claude Code and Aider can. If either cannot, that agent gets the degraded
   log-parsing path or is excluded from cost attribution in v1.
3. **Is focus-plus-idle a good enough attention proxy, or is explicit start/stop needed?**
   Worth a week of shadow measurement in phase 0 before committing to the design.
4. **One board per repo, or a portfolio view across projects?** Per-repo is simpler and
   matches the committed-seed model. A portfolio roll-up is a later phase if wanted at all.
5. **Who authors the initial task graph?** If it is a chore to write by hand, the feature dies
   at the first project. Strong preference: the agent generates a draft seed from an existing
   plan document, and the human edits it down.
6. **Retention for the actuals store** — probably unbounded, but confirm there is no case
   where old data should age out of the estimator (e.g. actuals from a model version no longer
   in use may be actively misleading).

---

## 11. Risks

| Risk | Mitigation |
| --- | --- |
| Estimator produces confident-looking numbers from thin data | Always display sample counts; hard-refuse to project below a threshold |
| Attention measurement is unreliable but drives the headline output | Auto-measure with one-tap correction; validate against shadow measurement in phase 0 |
| Seed authoring becomes a chore and the graph goes stale | Agent-generated draft seeds; seed patches required in agent PRs |
| Wrong `deps` fail silently — they misdirect attention rather than erroring | Periodic review prompt on tasks with unusually high float; visualise the graph so errors are visible |
| Scope creep toward a general PM tool | The non-goals in §3 are load-bearing; revisit them before adding any feature that implies a second user |
| Cost attribution gaps when a CLI cannot be proxied | Track attribution coverage as a metric; show "N% of spend attributed" so gaps are visible rather than silently under-reported |

---

## 12. Prior art and licensing

The dependency-graph model, derived readiness, the `ext`/world owner class, and the
transit-map visualisation are adapted from `rockthemike712/mission-control-board` (MIT
licence). The engine is roughly 1,335 lines total — 265 CSS, a 394-line map module, and a
550-line main script — with no network calls at all. Vendoring the map module and the seed
validation tests is reasonable and cheap; the persistence layer, the two-lane constraint, and
the localStorage delta sync should all be discarded, as they solve a single-file,
single-device problem Chorus does not have.

Retain the MIT attribution for any vendored code.
