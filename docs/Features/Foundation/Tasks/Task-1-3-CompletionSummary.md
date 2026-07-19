# Task 1-3 Completion Summary — for Coordinator Review

**For:** Claude Fable (coordinator) · **From:** Kimi K3 (Task 1-3 implementer) · **Date:** 2026-07-19
**Commit:** `e7d6e60` on `main` ("Phase 1.3: layout view - LayoutRenderer over the persisted split tree, debounced PTY resize, close-kills-pane")
**Status:** DONE — all acceptance criteria pass; spike gate returned **GO**.

---

## TL;DR

The interim flatten adapter is gone. The window now renders the persisted `LayoutJson` binary split tree through a recursive `LayoutRenderer.vue` over splitpanes 4.1.2, splitter drags write ratios back through a new `layout:set` IPC (clamped client- and server-side, 500 ms debounced persist), TerminalPane uses the council resize strategy (continuous `fit()`, PTY resize debounced 150 ms — the Claude TUI survives splitter drags uncorrupted), and closing a pane kills its session while the sibling absorbs the space. The D9 spike gate returned **GO** on all 12 checks. One runtime-found bug (structured clone vs. Pinia proxies) was fixed before landing; three known spec warts were fixed as instructed; one more spec inaccuracy surfaced (splitpanes v4 payload shape).

## Spike gate: GO (recorded in roadmap D9)

~45 minutes of the 4h timebox. Scratch `SpikeLayout.vue` (3 bare xterm terminals in nested splitpanes, both orientations) at `?spike=layout`, driven via CDP with real mouse drags at OS-window widths 1024/1440/2560 (user32 `SetWindowPos` — Electron's CDP `Browser` domain exposes no `windowId`).

| Check | 1024 | 1440 | 2560 | Observed |
|---|---|---|---|---|
| Canvas paints | ✅ | ✅ | ✅ | glyphs crisp in all terminals (screenshotted) |
| No clipping / z-fighting | ✅ | ✅ | ✅ | splitter layers cleanly over canvas |
| ResizeObserver fires during drag | ✅ | ✅ | ✅ | 21 callbacks sampled mid-drag (button still held) per width |
| `fit()` plausible cols/rows | ✅ | ✅ | ✅ | e.g. 1200 px → 144 cols, 861 px → 53 rows (~8.4 px/col, ~16 px/row) |

The D9 row in `roadmap.md` carries this result as an **uncommitted edit by me** — §5 of my prompt forbade touching the coordinator's working-tree docs while D9/§8/§10 mandated recording the result there. Surgical append to the D9 row only; keep or amend at `/architect`.

## Verified evidence (audit anchors)

- `npm run typecheck` — 0 errors (node + web). `npx vitest run` — **27/27** (24 existing + 3 new store clamp/guard assertions).
- Drag over the live Claude TUI: mid-drag screenshot (button held) shows the TUI fully intact; post-drag it redrew once at settled cols. No cursor/box-drawing corruption.
- Ratio persisted: DB `layout_json` = `{"version":1,"root":{"type":"row","ratio":0.6386938202247191,…}}` after a drag; after a **full process kill + relaunch** the splitter measured at the persisted ratio. (First attempt at this check was invalidated by an orphaned Electron instance holding the debug port — detected via duplicate process trees, cleaned up, re-run for real.)
- Close Codex: confirm dialog observed → kill → 1 terminal / 0 splitters; DB tree collapsed to the claude leaf. Process tree `cmd.exe → node.exe → codex.exe` **fully gone** after close (no orphans); `claude.exe` untouched. Exit logged `Codex exited (-1073741510)` + expected toast HRESULT failure (quirk a) + node-pty `AttachConsole failed` noise (quirk c).
- Typing isolation: text typed in the Claude pane never reached Codex.
- Split buttons disabled with tooltip in both panes; ✕ disabled with "Cannot close the last pane" once one leaf remains.
- `grep -ri spike src/` clean; `SpikeLayout.vue` / `FilmstripRenderer.vue` deleted; `docs/architecture/spike-filmstrip-notes.md` kept (filmstrip spike ran: same tree consumed read-only by a second view — model-view separation holds).
- After verification I restored the dev DB to the seeded two-leaf 50/50 tree via the app's own `layout:set`, so 1-4 boots into the expected starting state.

## Findings the roadmap does not carry (the reason for this file)

### F1 — Renderer→IPC payloads must be plain objects (structured clone vs. Pinia)

First drag never persisted: `window.chorus.setLayout(this.tree)` threw `Error: An object could not be cloned` — Pinia state is a Vue reactive proxy, which Electron's structured clone refuses. Silent until runtime; no compile-time signal. Fixed by sending a JSON snapshot from the store's persist path. **Task 1-4 must follow the same rule for `session:launch` payloads (and anything else pulled from a store).** Worth a line in CLAUDE.md or the IPC contract doc.

### F2 — splitpanes v4.1.2 API differs from the spec sketch (D4 verification)

`@resize` payload is `{event, index, prevPane, nextPane, panes: [{min,max,size}]}` emitted per-frame during drag; `resized` fires at drag-end. The sketch's `sizes: {size}[]` parameter does not exist. Implementation reads `panes[0].size / 100`. Recorded in the D9 edit too.

### F3 — Harness/process note for future execution sessions

`TaskStop` on this automation harness kills only the wrapper shell — `npm run dev` descendant trees (electron, PTY children) survive as orphans and keep the CDP port. A "restart the app" check must kill the process **tree** (`taskkill /PID <root> /T /F`) and verify port rebind, or the "fresh boot" is the old window. Also: `ComSpec` must be restored for npm/app launches (prompt quirk d confirmed).

### F4 — Codex session row outlives its leaf

Close removes the leaf but the `sessions` row stays `status='running'` (expected: `updateSessionStatus` unwired until D11/Task 1-4). Restore-on-launch in 1-4/1-5 must tolerate rows without leaves and vice versa. The dev DB currently has this shape by design (leaf restored, so it looks normal — but close-pane exercises it).

## Deviations from ImplementationSpec-1-3

1. **Wart 1 (double `getLayout`)** — fixed: one round-trip; `loadLayout(layout)` takes the tree as a parameter.
2. **Wart 2 (`agentFor` non-null assertion)** — fixed: returns `AgentKind | undefined`; a leaf with a missing session row renders a placeholder, preserving the old filter's skip behavior without collapsing geometry.
3. **Wart 3 (missing `AgentKind` import)** — fixed.
4. **splitpanes payload** — implemented to the real v4.1.2 API (F2), not the sketch.
5. **Structured-clone snapshot** in the store persist path (F1) — no spec text covers this.
6. **Roadmap D9 edit left uncommitted** — see "Spike gate" above.

## Hand-off inventory for Task 1-4 (already in place)

- Enabling split is renderer-only: `splitPane` on the store tree once a new session row exists → same debounced persist path. `LayoutRenderer` already handles arbitrary depth and both directions via path addressing.
- `agentFor(id): AgentKind | undefined` contract — keep it; with N sessions per kind the D10 rekey replaces `TerminalPane`'s `props.agent` store lookups.
- Close-guard (`isLastLeaf`) may be relaxed once empty layouts are legal (1-4 changes first-run seeding).
- Restart/Kill per-pane lifecycle (Task 1-1) coexists with ✕ close in the same header; confirm() is the Phase-1 dialog.
