# Council Brief CR-1.2 — Pane Layout Engine for Chorus

_Issued 2026-07-18 · Status: AWAITING FINDINGS · Decision owner: Matthew Wilson · Recorder: Claude (roadmap §6)_

You are a review council of independent LLM models. Deliberate on the decision below and return findings in the **Required Output Format** at the end. You have no other context on this project — everything you need is in this document. Where you are uncertain about an external fact (e.g., a library's maintenance status), say so explicitly rather than guessing.

---

## 1. What Chorus is

Chorus is a local-first Windows desktop app (Electron 43 + Vue 3 + TypeScript + Vite + Pinia) for running multiple AI coding agents (Claude Code, Codex CLI — real interactive TUIs) in parallel terminal panes. Each pane hosts an xterm.js terminal attached over typed IPC to a PTY session (node-pty/ConPTY) owned by the Electron **main** process. The renderer is strictly a view layer: it attaches to sessions by `sessionId` and never spawns processes.

Non-negotiable architecture rules (locked, not up for review):
- Sessions live in main, owned by a `SessionManager`; panes/windows are views attached by `sessionId`.
- All IPC payloads are Zod-validated **in the main process only** (the preload runs under a CSP that forbids Zod's `eval`-based parsers).
- App state persists in SQLite (better-sqlite3, versioned migrations). As of 2026-07-18 the team has also decided to adopt **Drizzle ORM** for typed queries and **Tailwind CSS** for styling, both starting in the upcoming phase.

## 2. Current implementation state (verified 2026-07-18)

- `SessionManager` holds `Map<sessionId, PtySession>`; currently at most one live session per agent kind (`'claude' | 'codex'`). The next phase lifts this to arbitrary concurrent sessions per kind.
- Pane rendering flow today: renderer calls `layout:get` over IPC → receives `[{slot: 0, agent: 'claude'}, {slot: 1, agent: 'codex'}]` from the SQLite `pane_layouts` table → `App.vue` renders a fixed 50/50 flexbox with one `TerminalPane` per entry → each `TerminalPane` attaches to its agent's session and wires xterm.js + FitAddon; a per-pane `ResizeObserver` calls `fit()` and propagates cols/rows to the PTY (`pty.resize`) on any container geometry change.
- The serialized layout (`pane_layouts.layout_json`) is therefore a **flat slot list today**. This decision replaces that shape; whatever is chosen becomes migration-bound persistent data.
- xterm.js panes are resize-sensitive: on every geometry change the terminal must refit and the PTY must be told the new cols/rows, or the agent TUIs (full-screen, box-drawing, alt-screen) render corrupted.

## 3. The decision

**How should Chorus model and render its multi-pane terminal layout?** This lands in sub-phase 1.2 of the current phase. Cap: ~12–16 panes per project.

### Option A — `splitpanes` library as both renderer and layout truth
The Vue 3 `splitpanes` component provides nested horizontal/vertical splitters with drag handles out of the box. Layout structure lives in the component tree; serialization means reading pane sizes back out of the component state and reconstructing props on restore.

### Option B — Fully custom binary split tree
A hand-rolled tree as pure data — internal nodes `{direction: 'row'|'column', ratio: number, children: [node, node]}`, leaves `{sessionId}` — with our own renderer and our own drag-resize handle math (pointer events adjusting `ratio`). No third-party layout dependency.

### Option C — Hybrid: owned tree model + `splitpanes` as dumb renderer
Same tree data model as B, persisted and mutated only through our own code, but grid-mode rendering delegates to nested `splitpanes` components driven entirely by the model (sizes in, resize events out → written back to the model). The library never owns state.

## 4. Constraints the winner must survive (these are future phases, already planned)

1. **Multiple sessions per agent kind** (sub-phase 1.3): leaves must identify panes by `sessionId`, not agent name.
2. **Full restore** (1.4): closing and reopening the app reconstructs the exact layout, reattaching every pane to its (relaunched) session. Serialize → restore must be deterministic.
3. **Focus + Filmstrip mode** (1.5): the *same* set of sessions rendered completely differently — one large focused pane plus a strip of compact status cards. The layout model must be renderable in at least two visual modes; a model welded to one component tree fails this.
4. **Pop-out windows** (later phase): a pane detaches into its own BrowserWindow attached by `sessionId`; the main-window tree must heal (sibling absorbs the space) and re-absorb the pane when the pop-out closes.
5. **Live-drag refit**: during handle drags, xterm panes receive a stream of ResizeObserver callbacks, each triggering `fit()` + an IPC resize to the PTY. The agent TUIs redraw on every resize. Excessive churn corrupts or thrashes them; the design should allow throttling/settling (e.g., refit continuously but only propagate final cols/rows to the PTY on drag end — treat this as a design consideration, not a settled answer).
6. **Migration cost**: the serialized JSON shape goes into SQLite with versioned migrations (Drizzle). Shape changes after ship require data migrations of users' saved layouts.

## 5. Evaluation rubric (weigh in this order)

1. **Restore correctness** — deterministic serialize/restore, including after crash (40%).
2. **Model–view separation** — same model drives grid, filmstrip, and future pop-outs without migration (25%).
3. **xterm refit behavior under live drag** — achievable smoothness/correctness (15%).
4. **Implementation + maintenance cost** — including drag-handle math, keyboard/a11y edge cases, and (for A/C) the dependency's health: verify `splitpanes`' current maintenance status if you can; flag as unverified if you cannot (10%).
5. **Reversibility** — cost of switching options after layouts persist in the wild (10%).

## 6. Questions for the council

1. Which option (A/B/C) wins under the rubric — and what is the **strongest argument against** your chosen option?
2. Propose the serialized JSON schema for `layout_json` that survives constraints 1–4 without migration pain. Be concrete: node types, fields, invariants (e.g., ratio bounds, tree arity), and where `sessionId` binding lives.
3. What are the known traps of hosting xterm.js inside nested flex/percentage-sized, live-resizable containers? (Rendering, scrollback, FitAddon rounding, ResizeObserver loops.)
4. Should PTY resize propagate continuously during drags or settle on drag-end? What does the terminal-emulator ecosystem (VS Code, Warp, tmux resize behavior) suggest?
5. Is there a failure mode in ANY option that should force a different choice entirely (e.g., CSS grid areas, golden-layout-style docks)? Name it only if load-bearing — this is a check against option fixation, not an invitation to bikeshed.

## 7. Success criteria for this council session

The council **succeeds** if it returns: (a) a clear winner, or an explicit tie with the tie-breaking criterion named; (b) a concrete `layout_json` schema proposal; (c) an enumerated risk list with mitigations for the winner; (d) explicit dissents preserved — do not average away disagreement. The council **fails** if it returns a survey of options without commitment, or unanimity achieved by dropping the rubric.

## 8. Required output format

```
## Per-model positions
<model>: <option> — <2-4 sentence rationale> — Strongest counterargument: <1-2 sentences>

## Council synthesis
Winner: <A|B|C|other(named)> (<unanimous | majority N-of-M>)
Dissents: <model: position and unresolved reason, or "none">

## Proposed layout_json schema
<concrete JSON schema or annotated example>

## Risks & mitigations for the winner
1. <risk> → <mitigation>
...

## Answers to questions 3-5
<numbered, concise>

## Action items for implementation
<numbered, imperative, each verifiable>
```
