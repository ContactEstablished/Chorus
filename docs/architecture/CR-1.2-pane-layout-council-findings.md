# CR-1.2 — Pane Layout Engine: Council Findings

**Date:** 2026-07-18  
**Status:** FINDINGS FILED  
**Decision owner:** Matthew Wilson  
**Council:** Claude, Gemini, GPT (3-model unanimous)

---

## Per-model positions

**Claude:** C — The ratchet is model-view separation. A welds the layout to one component tree, violating the filmstrip constraint outright. B incurs weeks of drag-math, a11y, and edge-case rework that splitpanes v4 (2.2k stars, v4.1.2, TS typedefs, keyboard ARIA in v4.1.0, touch, min/max, RTL) already ships. C gives us a pure-data tree we can render three different ways without migration, while delegating the messy pointer-event layer to a library that has already survived exactly the "crash on fast drag, size jump, cursor disappear" bugs we'd rediscover. — **Strongest counterargument:** Every dependency is a future liability. If splitpanes v5 breaks its resize event contract or goes unmaintained, we absorb the maintenance burden. Mitigation: the tree model is renderer-agnostic — we can drop in a custom renderer (degrading to B) with zero data migration.

**Gemini:** C (reluctantly conceding from B) — The binary split tree is the correct abstraction regardless; I'd prefer to own the whole stack to control xterm refit timing and avoid framework-vendor risk. But splitpanes v4's keyboard accessibility, touch support, and min/max enforcement represent months of polish work that a 2-person team shipping a terminal app should not duplicate. The marginal gain of full control doesn't justify shipping a buggy custom resizer that corrupts agent TUI rendering. — **Strongest counterargument:** The library's internal resize event stream may not support our throttle/settle strategy cleanly. If `@resize` fires only on drag-end, we can't do frame-by-frame terminal refit during drag (visual lag). If it fires every frame, we lose control of when the stream settles. A spike is required before locking in.

**GPT:** C — Option A is already dead under constraint 3 (filmstrip mode needs a different rendering of the same sessions — that's impossible if the layout *is* the component tree). Option B is architecturally sound but practically dangerous: fractional-pixel rounding in drag-resize math breaks determinism across OS zoom levels and DPI scales, and the xterm fit→PTY resize pipeline is unforgiving of getting dimensions wrong. Option C makes the hard parts (tree semantics, serialization, restore determinism) our responsibility and the tedious parts (drag handles, a11y, touch) the library's. This is the correct risk allocation. — **Strongest counterargument:** If splitpanes uses absolute positioning internally and xterm's canvas rendering conflicts (stacking context, overflow clipping), we cannot use it at all — and we won't know until a spike verifies xterm-in-splitpanes renders correctly at all viewport sizes.

---

## Council synthesis

**Winner: C — Hybrid: owned binary split tree model + splitpanes as dumb renderer** (unanimous 3-of-3)

**Dissents:** Gemini dissents on preference — B is the purer architecture — but concedes that the implementation-risk gap between B and C is large enough that C is the correct decision for a shipping product. The dissent is recorded as a design note: if splitpanes fails the xterm-integration spike, revert to B without hesitation; the tree model carries forward unchanged.

---

## Proposed layout_json schema

```jsonc
// layout_json — persisted in SQLite pane_layouts.layout_json (TEXT column)
// Serialized with JSON.stringify, no whitespace guarantees.
// All ratios clamped to [0.05, 0.95] on write; restore clamps again defensively.
{
  "version": 1,
  "root": {                               // root MAY be a leaf (single-pane app)
    "type": "row",                         // "row" | "column" | "leaf"
    // -- present only on internal nodes --
    "ratio": 0.5,                          // float, [0.05, 0.95]; first child's fraction of cross-axis
    "children": [                          // exactly 2 elements for internal nodes
      {
        "type": "column",
        "ratio": 0.6,
        "children": [
          {
            "type": "leaf",
            "sessionId": "a1b2c3d4-..."   // UUIDv4, non-nullable on leaves
          },
          {
            "type": "leaf",
            "sessionId": "e5f6g7h8-..."
          }
        ]
      },
      {
        "type": "leaf",
        "sessionId": "i9j0k1l2-..."
      }
    ]
  }
}
```

**In-memory TypeScript types (derived from schema):**

```ts
type LayoutNode =
  | { type: "leaf"; sessionId: string }
  | { type: "row" | "column"; ratio: number; children: [LayoutNode, LayoutNode] }

type LayoutJson = { version: 1; root: LayoutNode }
```

### Invariants (enforced at serialization boundary, not trusted on deserialization)

| # | Invariant | Enforcement |
|---|-----------|-------------|
| 1 | `root` is a valid `LayoutNode` | Zod schema on read |
| 2 | Internal nodes have exactly 2 children | Zod `.length(2)` |
| 3 | Leaf nodes have no `children` field; `sessionId` is non-empty UUID | Zod discriminated union |
| 4 | `ratio` ∈ [0.05, 0.95] | clamp on write + Zod `.min(0.05).max(0.95)` on read |
| 5 | No duplicate `sessionId` across all leaves | runtime check on save, recover by de-duping on load (keep first) |
| 6 | Minimum valid tree is `{type: "leaf", sessionId: "..."}` | accepted; single-pane mode |
| 7 | Empty layout (no root) is invalid | Zod rejects; fall back to single-empty-leaf sentinel |
| 8 | Version field must be exactly `1` (forward compat: unknown version → migration or reject) | Zod literal |

**Why sessionId at leaf, not agent kind:** Per constraint 1 (multiple sessions per agent kind in sub-phase 1.3), leaves must identify panes by sessionId. The `SessionManager` resolves sessionId → agent kind; the layout model never stores agent identity.

---

## Risks & mitigations for the winner (Option C)

1. **splitpanes incompatible with xterm.js rendering** → Before finalizing architecture, run a spike: mount an xterm.js Terminal inside a `<Splitpanes><Pane>` at 3+ viewport sizes, verify canvas paints correctly, check for stacking-context or overflow-clipping bugs. If it fails, fall back to Option B (tree model carries over unchanged).

2. **splitpanes resize event semantics mismatch throttling** → `@resize` may fire per-frame during drag (good for continuous fit()) or only on drag-end (causes visual lag if we rely on it for refit). Mitigation: attach a native `ResizeObserver` to each pane container DIV *below* the splitpanes component layer, independent of splitpanes events. This gives us guaranteed per-frame resize callbacks regardless of library internals. Use `@resize` only for model update (writing ratio back).

3. **Fractional-pixel rounding breaks deterministic restore** → `FitAddon.fit()` converts `offsetWidth` (integer-rounded) to cols/rows. On restore, the container's computed width may differ by 1px from the original session, producing different cols/rows from the same ratio. Mitigation: on restore, after the initial fit, write the resolved cols/rows back to the PTY and accept that exact pixel-reproduction is not guaranteed; terminal dimensions are inherently viewport-dependent. Document that restore reproduces the *split geometry*, not the exact character grid.

4. **Keyboard-only layout manipulation has no built-in support** → splitpanes v4.1.0 adds arrow-key splitter movement (per-splitter), but adding/removing panes, swapping, or changing split direction requires our own keyboard command layer. Mitigation: implement a layout command palette in sub-phase 1.4 that operates on the tree model directly (`movePane`, `splitPane`, `changeDirection`, `swapPanes`); splitpanes only needs to re-render from the updated model. Keyboard focus management between panes (Ctrl+W/E or Vim-style) is our responsibility regardless of option.

5. **Pop-out window tree healing** → When a leaf detaches to a separate BrowserWindow, the parent internal node must collapse (the sibling absorbs 100% of space). This is a tree mutation, not a rendering concern — the model handles it cleanly. Risk: if the pop-out closes during a drag operation, the tree could be in an intermediate state. Mitigation: disallow pop-out during active drag; queue the operation.

6. **splitpanes version churn causes breakage** → Lock to a specific minor version (`~4.1.2`) in package.json. Wrap all splitpanes usage behind a thin adapter component (`LayoutRenderer.vue`) that translates our `LayoutNode` tree into `<Splitpanes>/<Pane>` props. If splitpanes must be replaced, only the adapter changes.

---

## Answers to questions 3–5

### 3. Known traps of hosting xterm.js inside nested flex/percentage-sized, live-resizable containers

1. **FitAddon integer rounding** — `offsetWidth`/`offsetHeight` round to integer pixels. In percentage-based flex layouts during drag, a pane at 33.333% of a 1000px container computes to 333.33px; `offsetWidth` reads 333px. The `fit()` call produces `cols = floor(333 / charWidth)`, leaving up to `charWidth-1` pixels of dead space. Two sibling panes splitting 1000px evenly may both get 333px `offsetWidth` (334px lost to rounding), creating a visible gap. Mitigation: `fit()` is the best available; live with the dead space.

2. **ResizeObserver → fit() → scrollbar toggle → ResizeObserver loop** — If `fit()` causes xterm's internal viewport to add/remove a scrollbar, the DOM size changes and ResizeObserver re-fires. Mitigation: set `allowProposedApi: true` on the Terminal and disable scrollbar entirely (`scrollback: 0` or CSS `overflow: hidden` on the xterm viewport). Chorus panes don't need xterm's built-in scrollbar; navigation is via the agent's own scrollback.

3. **Alt-screen buffer corruption during rapid resize** — Agent TUIs using alternate screen (smcup/rmcup) redraw their full interface on SIGWINCH. During a drag at 60fps, the PTY receives 60+ resize signals/second; the TUI queues redraws that may overlap, producing visual garbage. Mitigation: debounce PTY resize to drag-end (see question 4).

4. **Scrollback reflow CPU cost** — xterm reflows scrollback on column change. For sessions with 10k+ lines of scrollback, this blocks the main thread for 50-200ms on each `fit()` call. During drag, cumulative reflow time can exceed frame budget. Mitigation: cap scrollback at a configurable limit (e.g., 5000 lines) and only reflow on drag-end resize, not during drag.

5. **CSS transform/zoom interactions** — Electron's `zoomFactor` or Windows OS scaling (125%, 150%) changes the computed `devicePixelRatio`. xterm's canvas renders at device-native resolution; FitAddon's char measurement must account for DPR. If DPR changes (monitor hot-plug, OS zoom change), all panes must re-fit. This is a window-level event, not per-drag, but worth noting.

### 4. PTY resize: continuous vs. settle on drag-end

The terminal ecosystem is split:

| Project | Behavior | Notes |
|---------|----------|-------|
| VS Code | Continuous × rAF throttle | Terminal panel resizes propagate PTY resize every frame via requestAnimationFrame. Works for most terminals; some TUIs (nvim, htop) flicker visibly. |
| tmux | Discrete (on mouse release) | The gold standard for TUI integrity. No intermediate SIGWINCH signals. |
| Warp | Continuous × throttle | Custom terminal renderer handles intermediate states; PTY resize is debounced. |
| iTerm2 | Hybrid | Resizes on mouse-up for tmux integration; uses "Defer PTY resize" option for local sessions. |
| Windows Terminal | Continuous | ConPTY resizes on every geometry change; TUI flicker is a known issue they accept. |

**Council recommendation:** `fit()` continuously (xterm canvas tracks the container visually), but debounce PTY resize to 150ms of inactivity or drag-end, whichever comes first. Rationale:

- Continuous `fit()` prevents visual tearing — the terminal background fills the pane at all times.
- Deferred PTY resize protects the agent TUI from intermediate SIGWINCH storms. The TUI only redraws once, at the final size.
- During debounce, xterm's col/row grid may briefly mismatch the PTY's reported dimensions. xterm handles this gracefully (blanks at right/bottom edges). The mismatch is invisible to the user since it lasts < 150ms.
- Some agent TUIs poll `TIOCGWINSZ` and may notice the mismatch, but in practice they only re-render on `SIGWINCH`.

Implementation sketch:

```ts
let ptyResizeTimeout: ReturnType<typeof setTimeout> | null = null
const PTY_RESIZE_DEBOUNCE_MS = 150

function onPaneResize(sessionId: string, cols: number, rows: number) {
  terminal.fit()  // continuous — visual match
  if (ptyResizeTimeout) clearTimeout(ptyResizeTimeout)
  ptyResizeTimeout = setTimeout(() => {
    ipc.send('pty:resize', { sessionId, cols, rows })
  }, PTY_RESIZE_DEBOUNCE_MS)
}
```

### 5. Failure mode that forces a different choice entirely

No option-fixation failure mode forces abandoning the binary-split-tree approach. The tree model is the standard for this class of application (VS Code, Sublime Text, iTerm2, tmux all use binary-split layouts internally). The identified risks are all inter-option (which renderer) rather than intra-paradigm (whether trees).

However, one sharp edge deserves explicit naming: **if the team cannot verify that xterm.js renders correctly inside a splitpanes `<Pane>` within a one-day spike, abandon Option C immediately and build the Option B renderer.** The tree model survives this pivot with zero data migration cost — that is the deliberate architectural property of separating model from view, and it's the strongest argument for C over A.

CSS Grid areas, golden-layout, and dock-based alternatives were evaluated and rejected: they solve a different problem (drag-to-rearrange, floating panels) and would add bundle weight and abstraction impedance for no benefit. The binary split tree is the simplest model that can express the target layout topology.

---

## Action items for implementation

1. **Spike: xterm-in-splitpanes** — Create a minimal `SplitpanesXtermSpike.vue` that renders 2–3 xterm.js terminals inside nested `<Splitpanes><Pane>` at 3 viewport widths (1024px, 1440px, 2560px). Verify: (a) canvases render without clipping or stacking-context z-fighting, (b) `ResizeObserver` on pane containers fires correctly during drag, (c) `FitAddon.fit()` returns plausible cols/rows at all sizes. Timebox: 4 hours. Go/no-go decision on C from results.

2. **Define LayoutTree module** — Implement `src/main/layout/LayoutTree.ts` with `LayoutNode` type, Zod validation schema, tree mutation functions (`splitPane`, `removePane`, `setRatio`, `changeDirection`, `collapseNode`), and `serialize`/`deserialize` functions. Add unit tests for all invariants from the schema table above. Verify: `npm test -- layout`.

3. **Implement LayoutRenderer adapter** — Create `src/renderer/components/LayoutRenderer.vue` that takes a `LayoutNode` prop and renders nested `<Splitpanes><Pane>` recursively. Each `<Pane>` contains a `TerminalPane` component. Wire `@resize` events on splitters to a `requestAnimationFrame`-batched write-back of the new ratio to the Pinia layout store. Verify: visual inspection with 2–12 panes in various split configurations.

4. **Implement pane-container ResizeObserver with debounced PTY resize** — In `TerminalPane.vue`, attach a `ResizeObserver` to the `.terminal-pane` container DIV (not to any splitpanes-internal element). On each callback: call `fit()` immediately; debounce `pty.resize()` by 150ms. Verify: open a Claude Code session, drag a splitter, confirm the terminal redraws without TUI corruption and snaps to correct cols/rows on drag-end.

5. **Layout JSON persistence with Drizzle migration** — Create migration `0002_pane_layout_v1` that (a) adds `layout_json TEXT NOT NULL` column to `pane_layouts` with a default single-pane sentinel, (b) backfills existing rows by converting the flat `[{slot, agent}]` array into a balanced binary tree (first agent on left, rest nested right). Create `LayoutPersistence` service that reads/writes via Drizzle. Verify: create a layout, serialize, restart app from cold SQLite, confirm layout restores identically.

6. **Filmstrip mode spike (forward-looking)** — After item 3 is stable, prototype `FilmstripRenderer.vue` that consumes the same `LayoutNode` tree and renders one large focused pane + compact status cards for others in a bottom strip. This verifies constraint 3 (model-view separation) and de-risks sub-phase 1.5. Timebox: 2 hours. Don't ship in 1.2, just validate the architecture holds.