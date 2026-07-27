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

**⚠ NO COMPLETE TEST — D77, settled 2026-07-26 before this task was prompted. Read the reason,
because it changes what "done" means for `StateMarker.vue`.**

An earlier draft of this task required a component test as the repo's first. **The repo cannot
run one, and the gap is bigger than one dependency:** `vitest.config.ts` sets
`environment: 'node'` with `include: ['src/**/*.test.ts']` and states in its own comment that it
is for *"Pure-logic unit tests only"*; there is **no `@vue/test-utils`, no `jsdom`, no
`happy-dom`**. Satisfying the old requirement meant **two dependencies against `CLAUDE.md`'s
locked stack plus a change to a deliberately-chosen test environment** — and D75's approval
covered fonts only.

**D77's ruling: prove shape-distinctness on the REAL RENDERED APP via CDP, not in jsdom.** The
property is *"a user who cannot distinguish these colors can still distinguish these states"*,
and a jsdom assertion on `transform: rotate(45deg)` is a weaker proof of that than a grayscale
screenshot of the running app. **The phase's entire verification model is already CDP screenshots
precisely because no component tests exist** — adding a harness for one component would be the
inconsistent choice, not the rigorous one.

### ⚠ And the proof is DEFERRED to Task 3c-3 — which is a consequence, not a loophole

**This task restyles nothing, so `StateMarker.vue` has NO CONSUMER when it ships.** There is
nothing mounted for CDP to photograph. That is not a flaw in D77; it is the same shape as the
**`attention_spans` precedent (v7)** and 3b-2's run/message accessors — *written one task before
their first caller* — and this repo's practice is to **say so plainly rather than manufacture a
proof.**

So:

- **In THIS task**, `StateMarker.vue` is verified **structurally only**: the four states render
  four distinct geometries (rotation / border-radius / `<svg> path d` / neither), confirmed by
  reading the rendered SFC output. **State that as a structural check, not as a runtime proof.**
- **The RUNTIME proof is Task 3c-3's grayscale screenshot** — the filmstrip with all four states
  present, `filter: grayscale(1)` applied, all four still distinguishable. It is already in
  3c-3's acceptance criteria and review checklist.
- **⚠ Carry this forward as an owed item in the task report**, so that if 3c-3 is ever re-scoped
  the proof does not vanish with it.

**No test is expected or wanted for the token block** either: a test asserting `--color-x: #hex`
restates the CSS.

**⚠ Do NOT add `@vue/test-utils`, `jsdom`, or `happy-dom`, and do not touch `vitest.config.ts`.**
If component testing later proves worth having, it is its own decision with its own approval —
not something this task establishes in passing.

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

- [ ] `npm run typecheck` exits 0 (node + web); `npx vitest run` is **941/941 across 29 files —
      UNCHANGED, because D77 adds no test** and no pre-existing test is edited; `grep:secrets`
      clean.
- [ ] **`package.json` gained exactly TWO dependencies** — the `@fontsource` pair (D75) — and
      **`vitest.config.ts` is byte-identical**. No `@vue/test-utils`, no `jsdom`, no `happy-dom`.
- [ ] `MIGRATIONS.length` **11** · `sqliteTable(` **15** · `ipcMain.handle(` **48** ·
      `IpcChannel` keys **52** — all unchanged.
- [ ] Every token in the spec's table is present in `@theme`, with its role name and its
      provenance comment.
- [ ] **Zero** references to `fonts.googleapis.com` or `fonts.gstatic.com` anywhere in `src/`.
- [ ] **The app renders both typefaces with networking disabled**, proven by screenshot and by a
      computed-style read.
- [ ] `StateMarker.vue` renders four **structurally distinct** geometries, confirmed by reading
      the rendered output — **and the report states plainly that the runtime colorblind proof is
      OWED BY TASK 3c-3** (D77), because this task mounts the component nowhere.
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
4. **The state markers differ by geometry, and the deferral is stated rather than glossed.**
   Read `StateMarker.vue`: rotation / border-radius / `<svg> path d` / neither must be four
   distinct answers. Then check the report **says** the runtime proof is owed by 3c-3 (D77). A
   report that implies the colorblind property was verified here has overclaimed — the component
   is mounted nowhere.
5. **No test harness crept in.** `vitest.config.ts` byte-identical; `package.json` gained exactly
   the two `@fontsource` packages and nothing else. D77 exists because that boundary is easy to
   cross while being helpful.
5. **The blast radius stayed inside the scope.** `git diff --stat` should show `main.css`,
   `package.json`, `package-lock.json`, `index.ts` (one line), and the two new component files.
   Any `.vue` file other than `StateMarker.vue` in that list is out of scope.
6. **The window does not flash grey on launch** — `backgroundColor` in `index.ts` and the CSS
   base rule agree.
