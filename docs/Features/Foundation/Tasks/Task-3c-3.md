# Task 3c-3 — The Workspace: Project Rail, Filmstrip, Pane Header, Status Bar

**Phase:** 3c — Design Adoption · **Task 3 of 5** · **Depends on:** 3c-1, 3c-2.

## Source Of Truth

- [`Phase-3c-Overview.md`](Phase-3c-Overview.md) — the purity contract, **D73**, **D76**.
- [`../ImplementationSpecs/ImplementationSpec-3c-3.md`](../ImplementationSpecs/ImplementationSpec-3c-3.md).
- `docs/design/v2/Chorus Workspace.dc.html` — the authority for every surface in this task.

## Initial Starting Point (verified 2026-07-26 at `1cf23ff`)

- `components/ProjectTabs.vue` (**38 lines**) — a **top tab bar**: a row of buttons from
  `store.projects`, active styled `border-b-2 border-sky-500`, plus `+ Add Project` calling
  `store.add()`. **The design has no top tab bar; it has a 208px left rail.**
- `components/FilmstripRenderer.vue` (121 lines) and `components/LayoutRenderer.vue` (108 lines)
  — the two layout modes (`filmstrip` | `grid`, per `viewModeSchema`).
- `components/TerminalPane.vue` (631 lines) — xterm host, includes the pane header.
- `App.vue` (395 lines) — shell; after 3c-2 it carries `<TitleBar />`.
- **There is no status bar anywhere in the app.** It is created by this task.
- Everything uses stock Tailwind palette utilities.

## Goal

Turn the workspace into the mock: the **208px left project rail** replacing the top tab bar, the
**filmstrip as the right rail**, the **pane header** enriched to the design's anatomy, and the
**30px status bar** at the bottom. This is the surface Matthew will look at all day, and it is
the task that most directly serves the phase's reason for going first.

## ⚠ Three things this task must get right

1. **`ProjectTabs.vue` is REPLACED, not restyled — and its behaviour must survive intact.**
   `store.projects`, `store.activeId`, `store.select(id)`, `store.add()` are the whole contract.
   A rail that looks right but drops `add()` has failed.
2. **D76 governs every number on screen.** Render session counts, worktree count and state
   tallies; **omit per-project cost, the daily rollup, and the neo4j chip** — they have no data
   source. **Do not render `$0.00`, `—`, or a skeleton in their place.**
3. **State is shape-first.** Every session state uses 3c-1's `StateMarker`. **A surface that
   distinguishes states only by color has broken the colorblind-safety property** the markers
   exist for, and the review checks for it.

## Exact Scope

**Create:**
- `src/renderer/src/components/ProjectRail.vue` — replaces `ProjectTabs.vue`.
- `src/renderer/src/components/StatusBar.vue`.

**Edit:**
- `src/renderer/src/App.vue` — rail left, filmstrip right, status bar bottom.
- `src/renderer/src/components/FilmstripRenderer.vue` — the 88px card design.
- `src/renderer/src/components/LayoutRenderer.vue` — grid-mode surfaces to the tokens.
- `src/renderer/src/components/TerminalPane.vue` — **pane header only**, plus the xterm theme
  object (see the spec §6).

**Delete:** `src/renderer/src/components/ProjectTabs.vue`, once nothing imports it.

## Non-Goals

- **No IPC.** `IpcChannel` stays at **56** and `ipcMain.handle(` at **51** (3c-2's numbers).
  **If a surface seems to need data that does not exist, D76 says omit it — not add a channel.**
- **No store logic changes.** If a store test needs editing to accommodate a restyle, stop: the
  change has left the phase's purity contract.
- **Do not change layout behaviour** — split/close/focus, the filmstrip/grid switch, ratio
  write-back and `layout:set` all behave exactly as before.
- **Do not touch xterm's buffer, scrollback, resize or PTY wiring.** The theme object only.
- **Do not build the Attention Inbox** (Phase 4) or the mission-control overlay (Phase 5), even
  though mocks for both exist in `docs/design/`.
- **Do not restyle dialogs or overlays** — 3c-4.
- **Do not revert or commit unrelated working-tree changes.**

## Dependencies

**3c-1** (tokens, `StateMarker`, the `chorusPulse` keyframe) and **3c-2** (the titlebar defines
the vertical budget: 36px top + 30px status bar around a `flex: 1; min-height: 0` body).

## Step-by-step Work

1. `ProjectRail.vue` to the mock's geometry; mount it left in `App.vue`; delete `ProjectTabs.vue`
   and confirm no import survives.
2. `StatusBar.vue` with **only** the D76-permitted facts; mount it bottom.
3. `FilmstripRenderer.vue` → the 88px card, with `data-pulse` on the **card** for the needs-you
   state (3c-1's spec §6: the marker itself must not animate).
4. `LayoutRenderer.vue` → token surfaces and borders.
5. `TerminalPane.vue` → pane header to the design's anatomy, and the xterm theme.
6. The **per-surface visual pass**, on the running app.

## Test Expectations

**No new component tests are required** and none should be invented for styling. The existing
store tests (`stores/layout.test.ts`, `stores/view.test.ts`, `stores/settings.test.ts`) must stay
green **unedited** — that is this task's real regression signal, because it proves the restyle
did not reach into behaviour.

**One exception worth writing:** if the rail derives per-project session counts with any logic
beyond a `filter().length`, that derivation gets a unit test. Counting is where an off-by-one
hides.

## Verification Commands

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

```bash
grep -rn "ProjectTabs" src/ ; echo "expect: no matches — the file and every import are gone"
```

```bash
grep -rn "neutral-\|sky-\|zinc-\|slate-\|gray-" src/renderer/src/components/ProjectRail.vue src/renderer/src/components/StatusBar.vue src/renderer/src/components/FilmstripRenderer.vue ; echo "expect: no stock Tailwind palette utilities"
```

```bash
grep -rn "\$0\.00\|neo4j\|today" src/renderer/src/components/StatusBar.vue src/renderer/src/components/ProjectRail.vue ; echo "expect: nothing — D76 omits what has no data"
```

### Visual pass (G2) — surfaces 2–7 of the phase inventory

Cold-boot with **at least two projects and four sessions**, and screenshot-diff each against the
Workspace mock:

- [ ] **Project rail** — active item (`#13171C`, 2px periwinkle spine, `#E6EAEE` label) vs
      inactive (transparent border, `#9AA4AE`, hover `#101318`); the attention badge with its
      diamond and count; the session-count line in mono `#68737F`. **Cost omitted per D76.**
- [ ] **Filmstrip cards in all four states** — needs-you (pulsing card), running, error, done
      (`opacity: .82`). Confirm the **shapes** differ, not only the colors.
- [ ] **Pane header** in both filmstrip and grid mode.
- [ ] **Status bar** — 30px, `#0A0B0D`, mono 10.5px, the separators, the `ctrl+k commands` keycap.
- [ ] **Grid mode** at 4+ panes.
- [ ] **`prefers-reduced-motion: reduce`** — the needs-you card stops pulsing and holds the
      bright static shadow.

**Then the behaviour re-check, because this task rewrote the app's shell:** switching projects,
adding a project, splitting a pane, closing a pane, switching filmstrip↔grid, and focusing a pane
all still work, and the layout still persists across a restart.

## Acceptance Criteria

- [ ] Gates green; **941 tests still passing with no pre-existing test edited**.
- [ ] `IpcChannel` **56**, `ipcMain.handle(` **51**, `MIGRATIONS.length` **11**,
      `sqliteTable(` **15** — all unchanged from 3c-2.
- [ ] `ProjectTabs.vue` is deleted and unreferenced.
- [ ] The four workspace surfaces match the mock on a screenshot diff, allowing only D76's
      omissions.
- [ ] **Zero** stock Tailwind palette utilities in the files this task owns.
- [ ] **Zero** invented numbers: no `$0.00`, no neo4j chip, no daily rollup.
- [ ] All four session states are distinguishable **with color removed** — verified by
      screenshotting with a grayscale filter applied over CDP, not by inspection of the source.
- [ ] Layout behaviour is unchanged, verified by the behaviour re-check.

## Review Checklist

1. **The grayscale screenshot.** Ask for it. If the four states are not tellable apart in
   grayscale, `StateMarker` was bypassed somewhere and the phase's accessibility property is
   quietly gone.
2. **D76 held under pressure.** The mock is right there showing `$1.94`, and the most likely
   failure is a well-meaning `$0.00` or a `—`. Grep for it.
3. **`add()` survived.** Open `ProjectRail.vue` and find the add-project affordance. A rail
   built from `v-for` alone silently drops it, and nothing else in the app offers it.
4. **The pulse is on the card, not the marker.** Two pulsing things is a different design.
5. **No store test was edited.** `git diff --stat` must not list any `stores/*.test.ts`.
6. **`min-height: 0` is present** on the flex body — its absence presents as a missing status
   bar and gets misdiagnosed as a status-bar bug.
