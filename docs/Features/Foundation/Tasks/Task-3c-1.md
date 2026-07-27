# Task 3c-1 — The Theme Foundation: Tokens, Fonts, State Markers

**Phase:** 3c — Design Adoption · **Task 1 of 5** · **Depends on:** none.

## Source Of Truth

- [`Phase-3c-Overview.md`](Phase-3c-Overview.md) — the phase contract, D72–D75, the gates.
- [`../ImplementationSpecs/ImplementationSpec-3c-1.md`](../ImplementationSpecs/ImplementationSpec-3c-1.md) — normative on the token block's exact content.
- `docs/design/v2/Chorus Workspace.dc.html` — **the authority on every value** (D73).
- `docs/design/v2/Chorus Launch Dialog.dc.html`, `Chorus Settings Providers.dc.html`, `Chorus Startup.dc.html` — the remaining 3c-owned mocks; sweep them for values the Workspace mock does not contain.
- `CLAUDE.md` — the stack lock, and the rule that dependencies are asked about (D75 is the approval).

## Initial Starting Point (verified 2026-07-26 at `1cf23ff`)

- `src/renderer/src/assets/main.css` is **9 lines**: `@import 'tailwindcss';` and one
  `html, body, #app` rule hardcoding `background: #1e1e1e`. That is the whole theme.
- **No `tailwind.config.*` exists.** Tailwind **v4.3.3** is wired via `@tailwindcss/vite`
  (`electron.vite.config.ts:4` import, `:15` plugin). v4 is CSS-first, so the theme is `@theme`
  in CSS — **do not create a JS config file.**
- **No CSS custom property exists in any mock** — the values are inline literals only.
- The mocks load Archivo + JetBrains Mono from `fonts.googleapis.com`.
- Existing components use stock Tailwind palette utilities (`neutral-800`, `sky-500`, …).
- **No component tests exist.** 941 tests across 29 files, all logic/stores.

## Goal

Put the design language into the codebase as **named, faithful tokens** and the **shared visual
primitives** every later task consumes — so that 3c-2 … 3c-5 are each a matter of applying the
system rather than re-deriving it from the mocks. Ship the fonts locally so the app never asks
the network for them. Change as little of the app's *appearance* as possible beyond the shell:
this task builds the vocabulary; the later tasks speak it.

## ⚠ Three things this task must get right

1. **D73 is faithful extraction, and the near-duplicates are the point.** `#0F1216`, `#101318`,
   `#111419` and `#101317` are four different values doing four different jobs. **Name them by
   role and provenance — never collapse them, and never "tidy" them to a ladder.** A later
   reader will want to; the token comments must tell them it is a design change needing
   Matthew's approval, not a refactor.
2. **The CDN link must be GONE, not supplemented.** The acceptance test is that the app renders
   correctly **with networking disabled**. A `<link>` to `fonts.googleapis.com` left behind
   "just in case" fails this task.
3. **Shape carries state meaning; color only reinforces it.** The four markers are diamond /
   circle / triangle / square precisely so the app is readable without color vision. A later
   task that renders a state as "the amber one" has broken this, and 3c-3's review checks it.

## Exact Scope

**Create:**
- `src/renderer/src/components/StateMarker.vue` — the four colorblind-safe markers behind one
  `state` prop (`'needs-you' | 'running' | 'error' | 'done'`).

**Edit:**
- `src/renderer/src/assets/main.css` — the `@theme` token block, the `chorusPulse` and
  `cursorBlink` keyframes, the `prefers-reduced-motion` block, the base `html/body/#app` rule
  (`#1e1e1e` → the design's app background), font-family wiring, and the `::selection` and link
  colors from the mock's `<style>` head.
- `package.json` — the two `@fontsource` dependencies (D75).
- `src/main/index.ts` — **one line only:** `backgroundColor: '#1e1e1e'` → the design's app
  background, so the window does not flash the old grey before the renderer paints.

**Nothing else.** No existing `.vue` file is restyled in this task.

## Non-Goals

- **Do not restyle any existing component.** Not `App.vue`, not the settings views, nothing.
  Surfaces keep their stock Tailwind utilities until the task that owns them.
- **Do not create a `tailwind.config.js`.** v4 is CSS-first; a JS config is a second home for
  the theme and the exact bug class D48 exists to prevent, one layer out.
- **Do not add a light theme**, a theme switcher, or `prefers-color-scheme` handling. Chorus is
  dark-only and is not getting a light mode.
- **Do not collapse, round, or rationalize any hex value** (D73).
- **Do not add an icon library.** The mocks use inline SVG; stay there.
- **Do not revert or commit unrelated working-tree changes.** Check `git status` first and leave
  anything you did not create alone.
- No IPC, no schema, no store logic.

## Dependencies

None. This is the phase's first task.

## Step-by-step Work

1. **Sweep all four 3c-owned mocks** for every distinct color, font size, letter-spacing,
   radius, and shadow. The spec's table is the Workspace mock's set; the other three may add
   values. **Report any value the spec does not list** rather than silently adding it.
2. **Author the `@theme` block** in `main.css` per the spec, with role-named tokens and the
   D73 do-not-collapse comment.
3. **Install and wire the fonts.** Add the `@fontsource` packages, import them in `main.css`,
   set the two font families, and **confirm no `fonts.googleapis.com` reference remains** in
   `src/`.
4. **Port the mock's head `<style>`**: `chorusPulse`, `cursorBlink`, the reduced-motion block,
   `::selection`, and the link colors.
5. **Build `StateMarker.vue`** with the four shapes at the exact geometry in the spec.
6. **Update `main.css`'s base rule and `index.ts`'s `backgroundColor`** to the design's app
   background so there is no launch flash.
7. **Run the gates and the visual pass** below.

## Test Expectations

**A component test for `StateMarker.vue` is REQUIRED, and it is the first component test in the
repo** — which makes it a precedent, so keep it minimal and behavioural: for each of the four
`state` values, assert the rendered marker is distinguishable **by shape, not only by fill** (a
diamond has a rotation, the triangle is an `<svg>` with the given `path d`, the two squares
differ by rotation). **This is the one place the colorblind-safety claim becomes checkable
rather than asserted**, which is why it is worth the precedent.

If `@vue/test-utils` is not already a dev dependency, **stop and ask** before adding it — it is
not in `CLAUDE.md`'s stack list, and D75's approval covers fonts only.

No test is expected or wanted for the token block: a test asserting `--color-x: #hex` restates
the CSS.

## Verification Commands

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

### Grep gates

```bash
grep -rn "fonts.googleapis.com\|fonts.gstatic.com" src/ ; echo "expect: no matches"
```

```bash
grep -rn "tailwind.config" . --include="*.js" --include="*.ts" --include="*.json" --exclude-dir=node_modules ; echo "expect: no config file created"
```

### ⚠ The offline proof (G2) — this task's load-bearing drive

Disable the network adapter (or run the app with networking blocked), cold-boot Chorus, and
confirm **Archivo and JetBrains Mono still render** — screenshot the shell, and read back
`getComputedStyle(document.body).fontFamily` over CDP. A font that only works online has not
been bundled; it has been cached.

### Visual pass

Cold-boot and screenshot the app shell. The expected visible change is **the background color
and the typeface, and nothing else** — every existing surface should still look like its old
self in the new fonts on the new background. **If a surface changes more than that, a token has
leaked into a component that this task does not own; report it.**

## Acceptance Criteria

- [ ] `npm run typecheck` exits 0 (node + web); `npx vitest run` is **941 + the new
      `StateMarker` tests**, no pre-existing test edited; `grep:secrets` clean.
- [ ] `MIGRATIONS.length` **11** · `sqliteTable(` **15** · `ipcMain.handle(` **48** ·
      `IpcChannel` keys **52** — all unchanged.
- [ ] Every token in the spec's table is present in `@theme`, with its role name and its
      provenance comment.
- [ ] **Zero** references to `fonts.googleapis.com` or `fonts.gstatic.com` anywhere in `src/`.
- [ ] **The app renders both typefaces with networking disabled**, proven by screenshot and by a
      computed-style read.
- [ ] `StateMarker.vue` renders four shapes distinguishable without color, with a test proving
      it.
- [ ] `prefers-reduced-motion: reduce` stops the pulse and resolves it to the static bright
      shadow — verified by toggling the emulation over CDP, not by reading the CSS.
- [ ] No existing `.vue` file was restyled.
- [ ] No `tailwind.config.*` was created.

## Review Checklist

1. **Every hex in `@theme` traces to a mock.** Spot-check five against
   `docs/design/v2/Chorus Workspace.dc.html`. A value that appears in neither the mocks nor the
   spec's table is invented and must come out.
2. **The near-duplicates survived.** Confirm `#0F1216`, `#101318`, `#111419` and `#101317` are
   all four present as distinct tokens, and that the do-not-collapse comment is there. **This is
   the single most likely thing to have been "improved" during implementation.**
3. **The fonts are local.** Grep is clean *and* the offline screenshot exists.
4. **The state markers differ by geometry.** Read the test — if all four assertions are on fill
   color, the colorblind-safety claim is untested and the test is theatre.
5. **The blast radius stayed inside the scope.** `git diff --stat` should show `main.css`,
   `package.json`, `package-lock.json`, `index.ts` (one line), and the two new component files.
   Any `.vue` file other than `StateMarker.vue` in that list is out of scope.
6. **The window does not flash grey on launch** — `backgroundColor` in `index.ts` and the CSS
   base rule agree.
