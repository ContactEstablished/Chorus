# Task 3c-4 — Overlays and Dialogs

**Phase:** 3c — Design Adoption · **Task 4 of 5** · **Depends on:** 3c-1, 3c-3.

## Source Of Truth

- [`Phase-3c-Overview.md`](Phase-3c-Overview.md) — the purity contract and the milestone amendment.
- [`../ImplementationSpecs/ImplementationSpec-3c-4.md`](../ImplementationSpecs/ImplementationSpec-3c-4.md).
- `docs/design/v2/Chorus Launch Dialog.dc.html` — the authority for `LaunchDialog`.
- `docs/design/v2/Chorus Workspace.dc.html`, `<!-- ══ command palette ══ -->` — for `CommandPalette`.
- `docs/design/v2/Chorus Startup.dc.html` — for `EmptyState`.

## Initial Starting Point (verified 2026-07-26 at `1cf23ff`)

- `components/LaunchDialog.vue` — **647 lines**, the app's second-largest surface. Has a mock.
- `components/CommandPalette.vue` — 118 lines. Its mock lives **inside** the Workspace file, not
  in a file of its own.
- `components/EmptyState.vue` — 20 lines. Startup mock.
- `components/WorktreePanel.vue` — 298 lines. **No mock, and none is planned.**
- All four use stock Tailwind palette utilities.
- `App.vue` tracks `anyOverlayOpen`, which feeds the attention report — overlays are already
  known to the attention system and that wiring must not move.

## Goal

Bring every overlay into the design language. Three have mocks and are held to the screenshot
diff; the worktree panel has none and is held to **token-and-primitive conformance only** — it
must stop looking foreign without being redesigned by an implementer improvising a design.

## ⚠ The worktree panel is the phase's one declared gap — do not quietly close it

The milestone amendment (Overview) is explicit: `WorktreePanel.vue` gets the theme's colors,
fonts, radii and state markers, and **zero** stock Tailwind palette utilities — and **nothing
else**. **Do not rearrange its layout, re-label its controls, or invent an anatomy for it.** If
it looks unfinished next to the mocked surfaces, that is the accurate signal, and it belongs in
the task report rather than being fixed by guesswork.

## Exact Scope

**Edit, and nothing else:**
- `src/renderer/src/components/LaunchDialog.vue`
- `src/renderer/src/components/CommandPalette.vue`
- `src/renderer/src/components/EmptyState.vue`
- `src/renderer/src/components/WorktreePanel.vue` — **conformance only**

## Non-Goals

- **No IPC.** `IpcChannel` **56**, `ipcMain.handle(` **51** — unchanged.
- **No change to what any dialog does.** `LaunchDialog` still resolves the same profiles, routes,
  models and effort levels; the palette still runs the same commands from
  `palette/commands.ts`; the worktree panel still drives the same gated lifecycle.
- **⚠ Do not touch the worktree removal confirmation flow.** It is a gated destructive path with
  F21 history attached. Restyling its *appearance* is in scope; touching its confirmation logic,
  its wording, or its gating is not.
- **Do not redesign `WorktreePanel.vue`.**
- **Do not change `anyOverlayOpen` or any overlay's open/close/Esc handling** — it feeds the
  attention report and is behaviour, not styling.
- **Do not revert or commit unrelated working-tree changes.**

## Dependencies

**3c-1** (tokens, `StateMarker`) and **3c-3** (the workspace they open over — an overlay's
scrim and elevation only read correctly against the finished surfaces beneath).

## Step-by-step Work

1. `LaunchDialog.vue` against its mock — the largest piece of work here.
2. `CommandPalette.vue` against the Workspace mock's palette block.
3. `EmptyState.vue` against the Startup mock.
4. `WorktreePanel.vue` — mechanical token substitution only.
5. The visual pass, plus the **behaviour re-check** below.

## Test Expectations

**No new component tests.** `palette/commands.test.ts` must stay green **unedited** — it is the
regression signal proving the palette's command list and gating did not move.

**⚠ If restyling `LaunchDialog` requires touching anything that `stores/settings.test.ts` or
`palette/commands.test.ts` asserts on, stop.** That is behaviour, and it is out of scope.

## Verification Commands

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

```bash
grep -rn "neutral-\|sky-\|zinc-\|slate-\|gray-\|red-[0-9]\|amber-[0-9]\|emerald-" src/renderer/src/components/LaunchDialog.vue src/renderer/src/components/CommandPalette.vue src/renderer/src/components/EmptyState.vue src/renderer/src/components/WorktreePanel.vue ; echo "expect: nothing"
```

### Visual pass (G2) — surfaces 1, 8, 9, 10 of the phase inventory

- [ ] **Startup / no project** against the Startup mock.
- [ ] **Command palette** (Ctrl+K) against the Workspace mock's palette block — including the
      selected-row treatment and the keycap hints.
- [ ] **Launch dialog** against its mock, in **each of its states**: a profile selected, no
      profile, a credential-bearing launch, and the worktree option engaged.
- [ ] **Worktree panel** — conformance only. Screenshot it and **state plainly in the report that
      it is unmocked** and what it now looks like.

### Behaviour re-check

- [ ] Ctrl+K opens the palette; Esc closes it; arrow keys and Enter still select and run.
- [ ] A launch from the dialog still starts a session on the right agent, route and model.
- [ ] The worktree panel's create / detach / **gated remove** flow behaves exactly as before,
      including the confirmation requirement.
- [ ] `anyOverlayOpen` still flips — check that an open overlay still classifies attention as
      `overhead` rather than crediting a pane.

## Acceptance Criteria

- [ ] Gates green; **941 tests passing, none edited**.
- [ ] `IpcChannel` **56**, `ipcMain.handle(` **51**, `MIGRATIONS.length` **11**,
      `sqliteTable(` **15**.
- [ ] The three mocked overlays match on a screenshot diff.
- [ ] `WorktreePanel.vue` contains **zero** stock Tailwind palette utilities and **is otherwise
      structurally unchanged** — `git diff` shows class-attribute churn, not moved elements.
- [ ] The behaviour re-check passes in full.
- [ ] The report states the worktree panel's unmocked status as a **known gap**.

## Review Checklist

1. **The worktree panel was not redesigned.** Read the diff: if elements moved, were renamed, or
   were regrouped, the scope was exceeded — however much better it looks.
2. **The destructive path is untouched.** Confirm the removal confirmation's logic and wording
   are byte-identical. F21 is attached to this flow.
3. **`commands.test.ts` is unedited.**
4. **The launch dialog was checked in more than one state.** A dialog screenshotted only in its
   empty state hides most of its surface area.
5. **Esc still works everywhere**, and `anyOverlayOpen` still flips — an overlay that no longer
   reports itself silently corrupts attention telemetry, which per D50 cannot be backfilled.
