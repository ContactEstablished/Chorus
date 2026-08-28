# Task 1-4 — The fleet roster

**Phase:** Fleet Comms 1 · **Depends on:** Task 1-3 · **Owns:** one new roster component and its store reads
**⚠ This is the phase's droppable task.** Tasks 1-1 → 1-3 are a coherent shipment without it.

---

## Source Of Truth

- Spec **§7.2** (the roster), **§4.5** (the fleet is larger than Chorus in both directions),
  **§6.1** (the addressing rule).
- `Tasks/Phase-1-Overview.md` §5 non-goals — especially the ban on unread state.

## Initial Starting Point (verified 2026-08-27 at `07708c8`)

- Task 1-3 has landed: the snapshot reaches the renderer on one channel and the store exposes a
  per-session lookup. `externalPeers` is already on the payload and currently unused.
- Existing renderer components live in `src/renderer/src/components/` (19 files listed).

## Goal

One per-project view of who is reachable: the project's own panes with their fleet status, and —
separately and collapsed — the peers on this machine that Chorus did not launch. It must be honest
about being a partial view in both directions.

## Exact Scope

- **Create** one roster component and its test.
- **Edit** the store only if a derived getter is needed; add no new channel.
- Wire it to an existing surface (follow how `WorktreePanel.vue` is opened; do not invent a new
  window).

## Non-Goals

- **No unread counts, notification badges, pulsing, presence pings, or ambient placement.** Council
  FC-1.0 Q3 prohibited unread state outright; it is precisely the mechanism that converts a
  consulted view into an activity feed, which is Phase 8's standing non-goal.
- **No click-to-message, no composer, no reply.** Clicking a Chorus pane **focuses** it; that is the
  only gesture.
- **No action on external peers at all** — not focus, not kill, not message. They are listed because
  hiding them would be dishonest; they are not ours to manage.
- No new IPC channel. No timeline.
- No claim of completeness.
- Do not revert, stage, or commit `.mcp.json`.

## Dependencies

Task 1-3 merged.

## Step-by-step Work

1. **Two groups, visually distinct.** *This project's panes* first; *other sessions on this machine*
   second, **collapsed by default**.
2. **Every pane in the project appears**, including ones that cannot participate. A codex pane and a
   claude pane with no registry match both render **`Not addressable`** with a reason. §7.2 is
   explicit that omitting them is wrong: *"an absent row reads as 'no agents', which is a different
   and wrong claim."*
3. **Row content** per §7.2: the current address, the fleet status dot (`idle`/`busy`/`shell` from
   the registry — see §8.2, it is more authoritative than what Chorus computes), and last activity.
   A `changed` address shows both names exactly as the chip does.
4. **Clicking a Chorus pane focuses it.** Focus by **Chorus session identity**, never by matching on
   name — §6.1, and the name is precisely the thing that moves.
5. **State the partiality in the UI, not just in the docs.** A short line: this lists claude sessions
   with a peer-protocol registry entry on this machine; non-claude panes cannot participate, and
   sessions elsewhere are not visible.
6. **`unknown` propagates.** If the snapshot is unreadable, the roster says so rather than rendering
   an empty list — an empty roster is the claim *there are no peers*.

## Test Expectations

⚠ **CORRECTED 2026-08-28 DURING IMPLEMENTATION: THESE CANNOT BE RENDER TESTS.** This repository has
**no `.vue` tests** — `App.vue:24` and Task 7a-3 both say so, and D186 states the consequence: *a
rule written in a component is a rule nothing can check*. The rules therefore live in a pure module,
`src/shared/fleetRoster.ts`, tested in `fleetRoster.test.ts`, and `FleetRoster.vue` only draws the
result. The assertions themselves are unchanged in substance:

- A project with one claude and one codex pane produces **two** rows, the codex one not addressable.
- The two non-participation reasons stay **distinct** (`not-claude` is permanent, `no-entry` is
  probably temporary) — one label for both would tell the operator to stop waiting for something
  that is about to arrive.
- An unreadable snapshot reports `readable: false` **with the rows still present**, never an empty
  list, and never serves a status or address it cannot vouch for.
- A null snapshot — before the first poll — behaves exactly like unreadable.
- External peers are carried only when the registry is readable.
- `describeAddress` shows both names for a drifted address and names a collision.
- ⚠ A test asserting **no field on any row matches** `unread|count|badge|notify|pending|seen` — the
  non-goal made executable at the shape level, because a field is the first step of the drift the
  council warned about and it is easier to catch here than in a rendered DOM.

## Verification Commands

```
npm run typecheck
npx vitest run
```

**Runtime gate (G-A) — run it.** Open the roster in the dev app with at least one claude pane and
one codex pane: both appear, the codex one reads `Not addressable`, external peers are present and
collapsed, and a click on a Chorus pane focuses that pane. Kill a claude session's process and
confirm its row leaves within one poll interval **despite its registry file remaining on disk**.

## Acceptance Criteria

- Every pane in the project has a row; none is omitted for being unable to participate.
- External peers are listed, collapsed, and inert.
- The partial-view statement is visible in the UI.
- No unread, badge, count, or notification affordance exists anywhere in the component.
- A dead session's row disappears within one poll interval.

## Review Checklist

- [ ] Focus is by Chorus session identity, never by name match.
- [ ] `Not addressable` reads as a property of the agent, not a failure.
- [ ] Unreadable ≠ empty, in the code and on screen.
- [ ] No unread state of any kind, and a test that proves it.
- [ ] External peers carry no actions.
- [ ] The roster nowhere implies it is the whole fleet.
