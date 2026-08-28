# Implementation Spec 1-4 — the roster

Companion to `Tasks/Task-1-4.md`.

---

## Why this task is droppable, stated so the decision is not re-litigated

Tasks 1-1 → 1-3 deliver the phase's substance: every claude pane shows an honest, live address. The
roster is a **second view of data already on screen**, and its unique contribution is narrow —
seeing peers Chorus did **not** launch. Valuable, not load-bearing. If the phase runs long, stop
after 1-3 and the shipment is still coherent; if the roster is cut, nothing else in the phase needs
rewriting because it adds no channel and no state.

## Placement

A panel, opened the way `WorktreePanel.vue` is opened. **Do not build a new window** — an
always-visible surface would drift toward the ambient dashboard the non-goals forbid, and a window
implies management capability the feature deliberately lacks.

⚠ **Placement is a non-goal boundary, not a preference.** §13 and council Q3 make the timeline's
distinction from an activity feed depend on it being **consulted rather than pushed**. The roster
inherits that: it is somewhere you *go*, never something that surfaces itself.

## Structure

```
This project
  ● Mae                       idle    2m ago
  ⚠ Requested Bob · now       busy    just now
    launch-presets-multi-agent
  ○ Codex — Rita              Not addressable
  ○ Claude — Otis             Not addressable (no registry entry)

Other sessions on this machine  ▸ (collapsed, 6)
```

Three things this sketch is asserting:

1. **A pane that cannot participate still gets a row**, with a reason. §7.2: *"an absent row reads
   as 'no agents', which is a different and wrong claim."* Note the two distinct reasons — a codex
   pane is structurally excluded, a claude pane with no registry match is *unknown*. Do not collapse
   them into one label; the first is permanent and the second is probably temporary.
2. **A `changed` address shows both names**, exactly as the chip does. Two renderings of one state
   would drift apart the first time one is edited — share the formatting.
3. **External peers are collapsed and counted**, not hidden and not expanded. Hiding them would
   misrepresent the fleet; expanding them by default would make other people's sessions the
   loudest thing in a view about your own project.

## Status dot

Use the registry's `status` (`idle` / `busy` / `shell`) for claude panes with a live entry, per
§8.2 — it is claude's own signal and is more authoritative than what Chorus reconstructs from hooks
and PTY heuristics. **This does not change the activity light**, which is a different surface with
a different job and covers every adapter; the roster simply displays the better source where it has
one. Task 1-2's disagreement log exists to tell you when the two differ.

## Focus

```ts
// Focus by the pane's Chorus identity. NEVER by matching the displayed name:
// the name is live registry state and can be reclaimed by another session
// between render and click (spec §4.7 — two live sessions were observed
// holding the same name).
```

A name-based focus would be a race, and the window in which it is wrong is exactly when the roster
is most useful.

## The partiality line

One sentence, always visible, not a tooltip:

> Claude sessions with a peer-protocol registry entry on this machine. Other agents cannot
> participate; sessions on other machines are not visible.

§4.5 makes this a correctness requirement rather than politeness: the fleet is larger than Chorus in
both directions, and a list that looks complete is a claim.

## Unreadable is not empty

When `snapshot.readable === false`, render the unavailable state. **Never an empty list** — that
reads as *there are no peers*, a strong and probably false claim. Same distinction as the chip's
`unknown`, and it comes from the same field, so there is one source of truth for it.

## Verification

The runtime gate in the task doc. Two checks that are easy to skip and are the ones worth doing:

- **The dead-session case** — kill a claude pane's process by pid; its `<pid>.json` remains on disk
  (§4.7), and its row must still leave within one poll interval. This proves the roster reads
  liveness rather than file presence.
- **The unreadable case** — make the registry unreadable and confirm the roster says so rather than
  emptying. Restore it afterwards.

Obey G-E: identify the dev app by its `*9333*` command line, never by process name, and confirm the
installed Chorus is still running afterwards.
