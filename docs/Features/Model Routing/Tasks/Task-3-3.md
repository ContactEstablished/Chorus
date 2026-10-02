# Task 3-3 — Presentational components and the isolated visual harness

**Status:** Not started.\
**Depends on:** Task 3-2 passes (`src/shared/routingView.ts` and its tests exist; Table RV passes).\
**Paired specification:** [ImplementationSpec-3-3](../ImplementationSpecs/ImplementationSpec-3-3.md)

## Source Of Truth

[Feature roadmap](../roadmap.md) (MR-D5, MR-D10, MR-D11; gates MR-G1, MR-G7), user decision MR-D21 as recorded in the [Phase 3 overview](Phase-3-Overview.md) (with K2, K3, K6, K7, C15, C16), the paired specification, [ImplementationSpec-3-2](../ImplementationSpecs/ImplementationSpec-3-2.md) for every string the components show, [Plan_1](../Plan_1.md) §2 "UI details" (the overview wins where they differ) and §12 for component names, Foundation D73 and D76, and repository CLAUDE.md (Vue 3, no React, no new state library).

## Initial Starting Point

Branch `feature/model-routing` with Tasks 3-1 and 3-2 landed on `5079b5d`. Facts verified 2026-10-02 at `5079b5d`:

- `src/renderer/src/components/` is flat (no subdirectory exists); Plan_1 §12 sketches `components/newSession/ProviderTierCards.vue` and `ProviderTable.vue` (`Plan_1.md:599–601`). No `<table>` element exists under `src/renderer/src`; tabular data uses CSS-grid rows (`EngineUsagePanel.vue:190–196`).
- `settings.css` provides the card, chip, row, hint and button anatomy (`.set-card` :159, `.set-card-protected` :213–217, `.set-chip-*` :405–463, `.set-row-ok/warn` :503–513, `.set-hint-warn` :321, `.set-btn-primary` :688). The amber token is `--color-state-attention: #F59E0B` (`main.css:135`). `main.css` imports Tailwind (:24), so a build that includes it needs `@tailwindcss/vite`, already a dev dependency.
- `scripts/verify-team-review-ui.mjs` is the isolated-harness precedent: a vite build of a generated fixture that mounts real `.vue` files with `@vitejs/plugin-vue` (:37), and an offscreen Electron runner that asserts on the DOM and writes `capturePage()` PNGs (:38–49) under gitignored `_verify/` (:8, `.gitignore:165`).
- esbuild is installed as a transitive dependency and already bundles TypeScript for a script (`verify-routing-body.mjs:20`).
- No D73 mock covers routing (`docs/design/v2/`).
- The worktree has the pre-existing changes listed in the overview.

## Goal

Three presentational Vue components that turn Task 3-2's view models into the inspector's cards, providers table and refresh status, with nothing selectable and no I/O; and a zero-cost harness that builds them in isolation, renders every state from the golden `TierResult` and its variants, asserts the exact text and structure, and saves screenshots.

## Exact Scope

- `src/renderer/src/components/routing/RoutingTierCards.vue`: the Budget, Balanced and Fast cards, the Nitro card, and the notes list.
- `src/renderer/src/components/routing/RoutingProviderTable.vue`: the collapsible all-providers grid.
- `src/renderer/src/components/routing/RoutingRefreshStatus.vue`: the Refresh button, its cost statement, the snapshot age, the progress lines, the estimate and spend, and an error line.
- `scripts/verify-routing-ui.mjs`: the isolated harness (checks H1–H15).

## Non-Goals

- No store, no `window.chorus`, no IPC, no `flashSaved()` in any component (C15). No `SettingsRouting.vue` or `SettingsView.vue` change (Task 3-4).
- Nothing selectable: no click, selection or keyboard handler on a card or a row; the only interactions are the Refresh button and the table toggle (MR-D21).
- No formatting logic in the components: every string comes from a Task 3-2 view model; a missing string is added to `routingView.ts` with a test and recorded.
- No `.vue` unit tests and no new dependencies (K2). No Tailwind utility classes in the three components (overview risks).
- No `LaunchDialog.vue`, `TeamLaunchDialog.vue`, main, preload or shared-contract change.
- No edits to the roadmap, Plan_1 or the Phase 0–2 documents.
- Do not touch, stage or revert the pre-existing modified and untracked files.

## Dependencies

Task 3-2. Task 3-4 mounts all three components; Phase 4 reuses them in the launch dialog.

## Step-by-step Work

1. Re-run `git status --short` and record the pre-existing entries. Read the Task 3-2 report for deviations.
2. Create `src/renderer/src/components/routing/` and the three components with the props, events, data attributes and classes in the specification. Text is interpolated only (`{{ }}`); no `v-html`.
3. Run `npm run typecheck` (the web pass type-checks the `.vue` files).
4. Write `scripts/verify-routing-ui.mjs`. It resolves paths from its own location, cleans `_verify/routing-ui/` first, computes the states in Node, builds the fixture, drives an offscreen window, and deletes everything but the PNGs at the end.
5. Run it; inspect every screenshot by eye (cards readable, Nitro amber, table aligned and scrollable inside its box at 900 px).
6. Run the verification commands.

## Test Expectations

- **Cards:** the golden primaries, fallbacks, reasons and metrics; the no-snapshot, empty, floor-shortened, floor-emptied and Nitro-passes states, all with the exact Task 3-2 strings.
- **Nitro:** its label, a 2 px amber left edge (`rgb(245, 158, 11)`) that no ranked card has, the likely line, the warning and three caveats.
- **Table:** collapsed by default with the count; 32 rows when open, eligible first; the exact cells for the listed rows; the limited-history, cache-verified and time-of-day markers.
- **Refresh status:** the estimate visible while probing and before any spend line; the spend after `done`; the failed line; the countdown text disabling the button; one `refresh` event per enabled click and none while disabled; the exact cost statement.
- **Isolation:** no console error, `window.chorus` undefined, zero network requests, no horizontal page overflow at 1280 px and 900 px.

## Verification Commands

Run from the repository root.

```powershell
npm run typecheck
npm test
node scripts/verify-routing-ui.mjs
Get-ChildItem _verify/routing-ui
npm run grep:secrets
git diff --check
git status --short
```

The harness's last line must be `PASS (15 checks)` with exit code 0. `Get-ChildItem _verify/routing-ui` lists only the eleven PNGs named in the specification. `git status --short` shows the four new files and the pre-existing entries unchanged (`_verify/` is ignored). Record actual exit codes, the harness output, and a sentence per screenshot from looking at it.

## Acceptance Criteria

- The three components have exactly the specified props, events and data attributes, render only interpolated text, and import nothing but Vue and `routingView` types.
- `npm run typecheck` and `npm test` pass.
- `node scripts/verify-routing-ui.mjs` passes H1–H15 and leaves only PNGs.
- `npm run grep:secrets` passes after the harness ran; the pre-existing worktree entries are untouched.

## Review Checklist

- [ ] No component reads a store, `window.chorus` or the clock, or calls IPC (C15).
- [ ] No card or row is clickable or focusable as a choice; only Refresh and the toggle are buttons (MR-D21).
- [ ] Every visible string comes from a view model; no number is formatted in a template.
- [ ] The Nitro card is distinct by its amber edge and its label, not by colour alone (the label text carries the meaning).
- [ ] The table scrolls inside its own box at narrow widths; the page never scrolls sideways.
- [ ] The harness computes `TierResult`s in Node, never in the page (C16), kills only its own child, and leaves only PNGs.
- [ ] Changes are limited to owned files; pre-existing work is preserved and not committed.
