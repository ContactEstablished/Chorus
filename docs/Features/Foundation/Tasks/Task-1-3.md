# Task 1-3 — Layout View: Spike Gate, LayoutRenderer, Debounced Resize, Close/Kill

## Source Of Truth
- `CLAUDE.md` (locked rules) and `docs/PLAN.md`.
- **D9 (council, unanimous):** layout = owned binary split tree as the persisted data model; **splitpanes@~4.1.2** (verified on npm 2026-07-18) as a dumb renderer behind a `LayoutRenderer.vue` adapter. Escape hatch: if the xterm-in-splitpanes spike fails, fall back to a fully custom renderer — the tree model is unchanged.
- **PTY resize strategy:** continuous xterm `fit()` for visual tracking; debounce `pty.resize` to 150 ms inactivity / drag-end.
- Council findings: `docs/architecture/CR-1.2-pane-layout-council-findings.md` (authoritative). Key: ResizeObserver attaches to OUR pane container div (not splitpanes internals); splitpanes `@resize` used ONLY to write ratios back to the model; hide xterm scrollbar via CSS to avoid observer loops; cap scrollback 5000; alt-screen TUIs corrupt under SIGWINCH storms → debounce.

## Initial Starting Point (verified 2026-07-18)
After Task 1-2 lands (its prerequisite state):
- `src/shared/layout.ts` — `LayoutNode`/`LayoutJson` + pure mutations (`splitPane`, `removePane`, `setRatio`, `changeDirection`, `swapPanes`, `collectSessionIds`, `findLeaf`).
- `src/shared/ipc.ts` — `layoutJsonSchema`, `layoutGetResponseSchema = {layout, sessions[]}`, `attachRequestSchema` with optional `sessionId`. All exported; parsed only in `src/main/`.
- `src/main/services/storage.ts` — `getPaneLayout(): LayoutJson`; sessions CRUD; better-sqlite3 12.11.1; hand-rolled `MIGRATIONS` (version 2 = sessions).
- `src/main/services/sessionManager.ts` — `attach({ sessionId?, agent }, cwd)`; stable PTY id = session row id.
- `src/renderer/src/App.vue` — interim flatten adapter (leaves in a 50/50 flexbox row).
- `src/renderer/src/components/TerminalPane.vue` — props `{sessionId, agent}`; attaches by `sessionId`; xterm scrollback 10 000; ResizeObserver → `fit()` + **immediate** `resizeSession`.
- `package.json` — `test` script present; `vitest` installed; **splitpanes NOT yet installed.**
- Session lifecycle IPC `session:kill(sessionId)` exists from Task 1-1 (preload `killSession`).

## Goal
Replace the interim flatten adapter with the real layout view: a recursive `LayoutRenderer.vue` that renders the persisted `LayoutJson` tree, mounting one `TerminalPane` per leaf by `sessionId`. Splitter drags write ratios back to the model and persist (debounced) via a new `layout:set` IPC; TerminalPane gains the council-specified debounced PTY resize; closing a pane kills its session and removes the leaf (sibling absorbs). A 4-hour spike gates whether splitpanes is used or a custom renderer is built behind the same `LayoutRenderer.vue` contract. Split is intentionally deferred (button disabled) because Task 1-4 owns session creation.

## Exact Scope
**Create:**
- `src/renderer/src/components/LayoutRenderer.vue` — recursive tree renderer (splitpanes or custom fallback internals).
- `src/renderer/src/stores/layout.ts` — Pinia store `{ tree, dirty }` with `loadLayout`, `applyRatio`, `removeLeaf`.
- `docs/architecture/spike-filmstrip-notes.md` — 5-bullet findings from the filmstrip validation spike (survives; the spike component is deleted).
- (Temporary, deleted before commit) a spike page/route for the go/no-go gate.

**Edit:**
- `package.json` — add `splitpanes@~4.1.2` (only if spike is GO; if NO-GO, do not add it).
- `src/renderer/src/App.vue` — mount `LayoutRenderer` with the loaded tree; remove the interim flatten adapter; wire the spike query-flag mechanism (added then deleted).
- `src/renderer/src/components/TerminalPane.vue` — resize rework (continuous `fit()`, debounced `resizeSession` 150 ms), scrollback 10 000 → 5 000, hide xterm scrollbar via CSS; pane-header buttons (split H/V disabled, close).
- `src/shared/ipc.ts` — add `layout:set` request schema (`layoutJsonSchema`), exported.
- `src/main/ipc.ts` — `layout:set` handler: re-clamp ratios, re-validate, persist via storage.
- `src/preload/index.ts` — add `setLayout(layout)` forwarder.

## Non-Goals (itemized)
- **No** launch dialog and **no** session creation — Task 1-4. Split therefore creates nothing.
- **No** empty-leaf schema. The `sessionId`-non-empty invariant is **not** weakened. (See sequencing decision below.)
- **No** keyboard shortcuts, command palette, or filmstrip in the shipping product (filmstrip is a throwaway spike only).
- **No** persistence-format changes beyond writing back ratios (and existing session rows). No new tables.
- **No** multi-session-per-kind, project tabs, or restore-on-launch beyond what already exists — Tasks 1-4/1-5.
- **Do not revert, stage, or commit files the implementer did not change**, including untracked `docs/` (except the two docs this task deliberately creates).

## Sequencing decision (explicit)
Splitting a pane needs a new session, and session creation is owned by Task 1-4. Rather than weaken the schema with an empty/session-less leaf (which would break the `sessionId` non-empty invariant and ripple through validation), the **split buttons are rendered DISABLED with a tooltip** ("Launch a session — coming in Task 1-4") until 1-4 lands. Close and resize are fully functional this task. This keeps the layout schema clean and the invariant intact.

## Spike gate (do this FIRST — timebox 4h)
Mount 2-3 xterm terminals inside nested splitpanes on a scratch page at **1024 / 1440 / 2560 px** widths. Verify:
1. Canvases paint at all three widths (no clipping, no z-fighting).
2. ResizeObserver on our pane container fires **during** splitter drag.
3. `fit()` yields plausible cols/rows.

**GO** → install `splitpanes@~4.1.2`, implement `LayoutRenderer.vue` over Splitpanes/Pane.
**NO-GO** → record the result in roadmap D9; implement the **custom renderer** (CSS grid + pointer-driven resize handles, cursor `col-resize`/`row-resize`) behind the identical `LayoutRenderer.vue` props/emits contract. Do **not** install splitpanes. The task continues either way; only the renderer internals differ.

## Dependencies
- **Requires** Task 1-2 complete (tree model, stable ids, `{layout, sessions}` response, `session:kill`).
- Adds `splitpanes@~4.1.2` **only on GO**. Sanctioned by D9. Pinned tilde; all usage behind `LayoutRenderer.vue`.

## Step-by-step Work
1. **Spike page.** Add a temporary `?spike=layout` branch in `App.vue` mounting the scratch nested-splitpanes-with-xterm page. Test at 3 widths. Record GO/NO-GO.
2. **Gate decision.** GO → `npm install splitpanes@~4.1.2`. NO-GO → note in roadmap D9, plan the custom-renderer internals.
3. **Layout store** (`stores/layout.ts`). `{ tree: LayoutJson | null, dirty: boolean }`; `loadLayout()` (from `getLayout()`), `applyRatio(path, ratio)` (rAF-batched, clamps, marks dirty), `removeLeaf(sessionId)` (via `removePane`).
4. **LayoutRenderer.vue.** Recursive self-import; props `{ node: LayoutNode }`; internal nodes render Splitpanes (or custom) with two child `LayoutRenderer`s; leaves mount `<TerminalPane :sessionId :agent>`. `@resize` → rAF-batched `applyRatio` with the node's path (array of 0|1 indices from root). ResizeObserver stays on our pane container div.
5. **layout:set IPC.** Schema in `src/shared/ipc.ts` (payload = `layoutJsonSchema`). Renderer debounces 500 ms before `setLayout`. Main handler re-clamps ratios, re-validates with `layoutJsonSchema.parse`, persists via storage.
6. **TerminalPane resize rework.** ResizeObserver on own container → immediate `fit()` (visual), `clearTimeout` + 150 ms deferred `resizeSession` (PTY). Scrollback 10 000 → 5 000. Hide `.xterm-viewport` scrollbar via CSS.
7. **Pane header.** Buttons: split-H (disabled + tooltip), split-V (disabled + tooltip), close. Close → confirm if running (`confirm()` acceptable this phase) → `killSession(sessionId)` → `removeLeaf(sessionId)` → persist.
8. **App.vue.** Remove interim flatten; mount `LayoutRenderer` with the store tree. **Delete the spike branch** (see deletion checklist in the spec).
9. **Filmstrip spike (2h, non-shipping).** `FilmstripRenderer.vue` consuming the SAME tree read-only; screenshot; write `docs/architecture/spike-filmstrip-notes.md` (5 bullets); **delete the component**.
10. **Verify** (see below).

## Test Expectations
- Existing Vitest layout-invariant tests (from 1-2) stay green — `removePane` sibling-absorb underpins close.
- `layout:set` re-clamp: add a pure-logic assertion that an out-of-range ratio submitted to the store is clamped before persist (store-level, no DB).
- No new DB integration tests (better-sqlite3 electron-ABI constraint from 1-2 stands). Runtime behavior is verified by driving the app (G2) — this is the primary verification for a UI/PTY task.

## Verification Commands
```
npm run typecheck
npx vitest run
npm run dev
```
Runtime checks (in `npm run dev`):
- Drag a splitter over the Claude TUI → TUI stays intact during drag; snaps at drag-end; no corruption.
- Close the Codex pane → confirm → session killed → Claude absorbs full width.
- Restart the app → ratios restored.
- Confirm `?spike=layout` no longer resolves (spike deleted) and `FilmstripRenderer.vue` is gone.

## Acceptance Criteria
- [ ] Spike GO/NO-GO recorded; if NO-GO, roadmap D9 updated and the custom renderer is used behind the same contract.
- [ ] `LayoutRenderer.vue` renders the persisted tree; each leaf mounts `TerminalPane` by `sessionId`.
- [ ] Splitter drag writes ratios back to the model and persists (debounced `layout:set`, re-clamped/re-validated in main).
- [ ] TerminalPane: continuous `fit()`, debounced `resizeSession` 150 ms, scrollback 5 000, xterm scrollbar hidden.
- [ ] Close kills the session and removes the leaf (sibling absorbs); split buttons disabled with tooltip.
- [ ] Ratios survive an app restart.
- [ ] Spike page mechanism removed; `FilmstripRenderer.vue` deleted; `docs/architecture/spike-filmstrip-notes.md` present.
- [ ] `npm run typecheck` zero errors; `npx vitest run` green.
- [ ] `splitpanes` added only if GO, pinned `~4.1.2`, used only behind `LayoutRenderer.vue`.
- [ ] One narrated commit (G3).

## Review Checklist
- [ ] ResizeObserver attaches to our pane container div, NOT splitpanes internals.
- [ ] splitpanes `@resize` used only to write ratios; no layout state owned by splitpanes.
- [ ] All splitpanes usage behind the `LayoutRenderer.vue` adapter; version pinned `~4.1.2`.
- [ ] `layout:set` re-clamps `[0.05,0.95]` and re-validates in main; `.parse()` main-only.
- [ ] PTY resize debounced 150 ms / drag-end; no SIGWINCH storm; alt-screen TUI intact through drags.
- [ ] Scrollbar hidden via CSS to avoid fit→scrollbar→ResizeObserver loops; scrollback capped 5 000.
- [ ] Split disabled (no empty-leaf schema; invariant intact).
- [ ] Spike branch fully deleted; no dead `?spike` code shipped; filmstrip component deleted, notes doc kept.
- [ ] No secrets in args/logs/transcripts.
- [ ] No unrelated/untracked files reverted, staged, or committed.
