# Task 3c-1 — Execution Prompt (paste into a fresh session)

*Authored 2026-07-26 against the code at `99f6797`, not merely against the task docs. The pass
produced **D77**, which changed this task's Test Expectations before anyone executed them.*

---

## Role

You are the **Coordinator** for **Chorus — Phase 3c (Design Adoption), Task 3c-1: The Theme
Foundation**.

- **Repo root:** `C:\Projects\ContactEstablished\Chorus`
- **Expected branch:** `main`. **Confirm it; do not switch or create a branch without
  instruction.**
- **Expected HEAD at start:** `99f6797` *("Phase 3c is planned: the mockups become the app…")*.
- **Platform:** Windows 11, PowerShell primary. A Bash tool is also available; each takes its own
  syntax.

## Goal

Put the design language into the codebase as **named, faithful tokens** plus the **shared visual
primitives** every later task consumes, and ship the two typefaces locally so the app never asks
the network for them.

**⚠ THE PRIME CONSTRAINT: this task restyles NOTHING.** No existing `.vue` file is edited. It
builds the vocabulary; tasks 3c-2 … 3c-5 speak it. **The only visible change app-wide should be
the background colour and the typeface** — every existing surface should still look like its old
self, in the new fonts, on the new background. If a surface changes more than that, a token has
leaked into a component this task does not own: **report it, do not absorb it.**

## Ground yourself first — before editing anything

**Read, in this order:**

1. `CLAUDE.md` — the stack lock and the rule that dependencies are **asked about**, not added.
2. `docs/Features/Foundation/Tasks/Phase-3c-Overview.md` — the phase contract, decisions
   **D72–D77**, the gates, and the 14-surface verification inventory.
3. `docs/Features/Foundation/Tasks/Task-3c-1.md` — your task.
4. `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3c-1.md` — **normative on the
   `@theme` block's exact content.** Where it and the task doc differ, **the spec wins**; where
   either differs from the mocks, **the mocks win** (D73).

**Inspect, and confirm these are still true before you rely on them** (all verified 2026-07-26 at
`99f6797`):

| Fact | Where |
|---|---|
| `main.css` is **9 lines** — `@import 'tailwindcss';` and one `html, body, #app` rule hardcoding `background: #1e1e1e` | `src/renderer/src/assets/main.css` |
| Tailwind **v4.3.3** via `@tailwindcss/vite`; **no config file exists** | `package.json:30,41` · `electron.vite.config.ts:4,15` |
| `BrowserWindow` sets `backgroundColor: '#1e1e1e'` | `src/main/index.ts:44` (inside `createWindow`, `:37–51`) |
| **No CSS custom property exists in any mock** — every value is an inline literal | `docs/design/v2/*.dc.html` |
| The mocks load Archivo + JetBrains Mono from `fonts.googleapis.com` | mock `<helmet>` blocks |
| **Zero component tests.** All 6 renderer test files are stores/logic | `src/renderer/src/**/*.test.ts` |
| Baseline: **941 tests / 29 files**, all passing | `npx vitest run` |

**Run these git checks first:**

```bash
git branch --show-current    # expect: main
git log --oneline -1         # expect: 99f6797
git status --porcelain
```

## ⚠ Pre-existing changes — do not touch

`git status` will show one untracked path that is **not yours**:

```
?? docs/Features/Foundation/Investigations/
```

It belongs to another session. **Do not revert it, do not stage it, do not commit it.** Your
commit must contain only the files listed under Scope below.

## Implementation scope

### Create

- **`src/renderer/src/components/StateMarker.vue`** — the four colorblind-safe markers behind one
  prop: `defineProps<{ state: 'needs-you' | 'running' | 'error' | 'done' }>()`. Exact geometry is
  in `ImplementationSpec-3c-1.md` §6.

### Edit

- **`src/renderer/src/assets/main.css`** — the `@theme` token block, the `chorusPulse` and
  `cursorBlink` keyframes, the `prefers-reduced-motion` block, the base `html/body/#app` rule,
  font wiring, and the `::selection` and link colours ported from the mock's `<style>` head.
- **`package.json`** — the two `@fontsource` dependencies (**D75**), and nothing else.
- **`src/main/index.ts`** — **ONE LINE:** `backgroundColor: '#1e1e1e'` → `'#0D0F12'`, so the
  window does not flash grey before first paint.

**Nothing else.** `git diff --stat` at the end should list exactly: `main.css`, `package.json`,
`package-lock.json`, `index.ts`, and the new `StateMarker.vue`.

### Resolved decisions that bind this task

**D73 (Matthew, 2026-07-26) — reproduce every value faithfully.**
> The theme carries **~45 hex values**, including about ten near-identical darks. **`#0F1216`,
> `#101318`, `#111419` and `#101317` are four different values doing four different jobs**, as are
> `#12151A` and `#12161B`. **Name them by role and provenance. Do not collapse, round, snap, or
> "tidy" them into a ladder.** The token comments must state that collapsing them is **a design
> change requiring Matthew's approval — not a refactor.**

**⚠ This is the single most likely way this task goes wrong.** The values look like a mistake.
They are not. A tidy ladder would break the phase's screenshot-diff milestone, which D73 chose to
keep literal.

**D75 (Matthew, 2026-07-26) — `@fontsource` packages, and the CDN must be GONE.**
> Add `@fontsource/archivo` and `@fontsource/jetbrains-mono`. These are **two dependencies not in
> `CLAUDE.md`'s locked stack, and Matthew approved them explicitly at kickoff.** Import only the
> weights the mocks use: Archivo 400/500/600/700, JetBrains Mono 400/500/600 + 400-italic.
> **The CDN link must be removed, not supplemented** — a `<link>` left "just in case" fails.

**D77 (Matthew, 2026-07-26) — NO component test, and no test harness.**
> An earlier draft of this task required a `StateMarker` component test as the repo's first.
> **The repo cannot run one:** `vitest.config.ts` is `environment: 'node'`, includes only
> `src/**/*.test.ts`, and documents itself as *"Pure-logic unit tests only"*; there is **no
> `@vue/test-utils`, no `jsdom`, no `happy-dom`.** That is **two dependencies plus a change to a
> deliberately-chosen test environment**, and D75's approval covers fonts only.
>
> **Ruling: prove shape-distinctness on the real rendered app via CDP, not in jsdom** — a
> grayscale screenshot of the running app is a *stronger* proof of "distinguishable without
> colour" than a jsdom assertion on `transform: rotate(45deg)`.
>
> **⚠ Consequence you must honour: this task mounts `StateMarker` NOWHERE** (it restyles
> nothing), so there is nothing to photograph here. **Verify it STRUCTURALLY only — four distinct
> geometries in the rendered output — and state in your report that the runtime colourblind proof
> is OWED BY TASK 3c-3** (its grayscale filmstrip check). This is the **`attention_spans` (v7)
> precedent**: written one task before its first caller, with the gap named in writing.
>
> **Do NOT add `@vue/test-utils`, `jsdom`, or `happy-dom`. Do NOT touch `vitest.config.ts`.**

### The mock authority is `docs/design/v2/`

**All eight `.dc.html` files, and every reference you make must be to `v2/`.** The seven
pre-existing screens there are **byte-identical** to the `docs/design/` originals (verified by
`cmp`), so v2 is **one addition, not a fork** — it adds `Chorus Council.dc.html`. Citing the root
for some files and v2 for others would create two homes for the same authority.

**The four mocks this task sweeps** (the 3c-owned set) plus the council mock:
`v2/Chorus Workspace.dc.html` · `v2/Chorus Launch Dialog.dc.html` ·
`v2/Chorus Settings Providers.dc.html` · `v2/Chorus Startup.dc.html` · `v2/Chorus Council.dc.html`

*(`v2/Chorus Attention Inbox.dc.html` is **Phase 4's** and `v2/Chorus Micro Surfaces.dc.html` is
**Phase 5's** — mission control and push-to-talk. `Chorus Overview.dc.html` is an index, not a
screen. Do not extract from those three.)*

### Three tokens are PRE-REPORTED — confirm, do not re-derive

Already added to the spec's table from the council mock. **Confirm each is present in the mock and
correctly named; do not go looking for them as if unknown:**

| Value | Role | Token |
|---|---|---|
| `#5EA2E8` | a **fourth spine colour** (blue), same 2px geometry as the project rail's spine, used per council roster member | `--color-spine-blue` |
| `#333D48` | dimmed logo-bar tone, empty-state glyph at `opacity:.5` | `--color-glyph-dim-mid` |
| `#3E4954` | dimmed logo-bar tone, empty-state glyph | `--color-glyph-dim-high` |

**None is a new *state* colour** — the four-shape vocabulary is untouched, and it must stay that
way.

**Then sweep the other four 3c-owned mocks for anything still missing.** The spec names
`#191E24`, `#1B2128`, `#141920`, `#11151A`, `#181D23`, `#0D1013`, `#12161B` as values appearing
somewhere in the mock set. **Report every token you add** — an unreported token is an unreviewed
design decision.

## Strict non-goals

- **Do not restyle any existing component.** Not `App.vue`, not the settings views, nothing.
- **Do not create `tailwind.config.js`** or any Tailwind config file. v4 is CSS-first; a JS config
  is a second home for the theme.
- **Do not add a light theme**, a theme switcher, or `prefers-color-scheme` handling. Chorus is
  dark-only and is not getting a light mode.
- **Do not collapse, round, or rationalize any hex value** (D73).
- **Do not add an icon library.** The mocks use inline SVG.
- **Do not add a test harness or touch `vitest.config.ts`** (D77).
- **Do not add any dependency beyond the two `@fontsource` packages.** Anything else → **stop and
  ask.**
- **Do not touch IPC, schema, migrations, or store logic.**
- **Do not extract from the Attention Inbox or Micro Surfaces mocks** (Phases 4 and 5).
- **Do not revert, stage, or commit `docs/Features/Foundation/Investigations/`.**
- **Do not push or open a PR unless explicitly asked.**

## Required workflow

1. **Ground** — read the four documents above and verify the ground-fact table against the code.
2. **Sweep** the five mocks for values; confirm the three pre-reported tokens.
3. **Implement** in the spec's order: tokens → fonts → keyframes/base rules → `StateMarker.vue` →
   the `index.ts` one-liner.
4. **Spec review** — re-read `ImplementationSpec-3c-1.md` against your diff. Every token present?
   Role-named? D73 comment in place?
5. **Code-quality review** of your own diff.
6. **Resolve findings**, then **verify** (below).
7. **One intentional commit**, narrated in the repo's established style: a plain-language title,
   then a body that explains what changed and why in terms a non-technical reader follows first,
   technical detail second. **Do not push.**

## Verification

### Build gates — all must pass

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

**Expected:** typecheck **0** (node + web) · vitest **941 passed / 941, across 29 files —
UNCHANGED** (D77 adds no test; any other number means a test was edited or a harness was added) ·
`grep:secrets` **clean across 6 patterns**.

### Grep gates — with expected counts

```bash
grep -rn "fonts.googleapis.com\|fonts.gstatic.com" src/        # expect: NOTHING
grep -rc "vue/test-utils\|jsdom\|happy-dom" package.json       # expect: 0  (D77)
git diff --stat vitest.config.ts                               # expect: EMPTY (D77)
ls tailwind.config.* 2>/dev/null                               # expect: no such file
```

**Counts that must NOT move in this task** (they move only in 3c-2, and only for IPC):

```bash
grep -c "sqliteTable(" src/main/db/schema.ts                          # expect 15
grep -c "ipcMain.handle(" src/main/ipc.ts                             # expect 48
grep -oE "^\s+[A-Za-z]+: '[a-z0-9:-]+'" src/shared/ipc.ts | wc -l     # expect 52
```

`MIGRATIONS.length` must remain **11**.

### Runtime gates — G2 is load-bearing and cannot be discharged by vitest

**Preferred mechanism: CDP on `--remote-debugging-port=9222`.** A user32 PowerShell helper exists
as a fallback; prefer CDP.

**⚠ F17: electron-vite does NOT hot-restart the main process.** Your `index.ts` one-liner requires
a **tree-kill and cold boot** to take effect. Budget for it; do not expect HMR to pick it up.

1. **Tokens resolve at runtime**
   `getComputedStyle(document.documentElement).getPropertyValue('--color-surface-app').trim()`
   → `#0D0F12`.
2. **Fonts are applied**
   `getComputedStyle(document.body).fontFamily` contains `Archivo`.
3. **⚠ THE OFFLINE PROOF — THIS TASK'S LOAD-BEARING DRIVE.**
   **Disable the network adapter** (or otherwise block networking), then **cold-boot** Chorus and
   screenshot the shell. **Both typefaces must still render.** Compare against an online
   screenshot — they must be identical.
   **A warm HTTP cache will happily fake a working CDN, so the adapter must actually be disabled.**

   Also confirm the bundle really contains the fonts:

   ```bash
   npm run build && find out/renderer -name "*.woff2" | head
   ```

   *(Searched recursively on purpose: `out/renderer` is electron-vite's default renderer output
   and did not exist at the time this prompt was written, so the exact asset subdirectory and the
   hashed filenames are **unverified**. If `out/renderer` turns out not to be the output root,
   find the real one and **say so in your report** — do not treat an empty result as a failed
   font bundle until you have confirmed where the renderer actually builds to.)*
4. **Reduced motion — toggle it LIVE, do not read the stylesheet.**
   Use `Emulation.setEmulatedMedia` with `prefers-reduced-motion: reduce` and confirm a
   `[data-pulse]` element reports `animationName: none` **and** carries the static bright shadow.
   **The rule is only real if it wins the cascade**, and reading the CSS cannot tell you that.
   Note the resolution is the **bright** end held static — not "no shadow".
5. **No unintended restyle.** Screenshot the shell and confirm every existing surface changed
   **only** in background colour and typeface.
6. **No launch flash.** Cold-boot and confirm the window does not show grey before first paint.
7. **`StateMarker` — structural check only (D77).** Confirm the four states produce four distinct
   geometries. **Do not claim a runtime colourblind proof; it is owed by 3c-3.**

### Harness conditions you should know

- **F20/F31** — execution sessions run with a **redirected `AppData`** but a **real
  `C:\Projects`**. Filesystem and screenshot evidence is trustworthy; **database** evidence
  describes a different DB. **Nothing in this task should need DB evidence at all — if you find
  yourself dumping the database, the scope has moved.**
- **Cost envelope: `$0.00`.** This task makes **no API call**. If something appears to require
  one, stop and report.

## Failure honesty

**If any verification command fails for an unrelated environment reason, capture the exact output,
explain what happened, and do not claim success.** A gate that could not be run is **not** a gate
that passed. If the offline drive cannot be performed (e.g. you cannot disable networking), **say
so explicitly and mark the font claim UNPROVEN** rather than substituting a weaker check —
that drive is the whole point of D75.

## Final reporting requirements

Report:

1. **Status** — `DONE` · `DONE_WITH_CONCERNS` · `NEEDS_CONTEXT` · `BLOCKED`.
2. **Files changed**, with `git diff --stat`. Confirm it lists only the five expected paths.
3. **Every token added**, with the mock and element each came from — **including any beyond the
   spec's table**, which is the report's most important content.
4. **Confirmation that D73's near-duplicates survived**, naming `#0F1216` / `#101318` / `#111419`
   / `#101317` explicitly, and that the do-not-collapse comment is present.
5. **Build results** — typecheck, the **941/941 across 29 files** figure, `grep:secrets`, and all
   grep-gate counts.
6. **Runtime results** — what you actually observed, with screenshots: token resolution, font
   family, **the offline cold boot**, the live reduced-motion toggle, the no-unintended-restyle
   check, and the no-flash check.
7. **The D77 deferral, stated plainly** — that `StateMarker` is verified structurally only, is
   mounted nowhere, and that **the runtime colourblind proof is owed by Task 3c-3**.
8. **Non-goals confirmation** — no component restyled, no Tailwind config, no test harness, no
   `vitest.config.ts` change, no dependency beyond the two `@fontsource` packages.
9. **Residual risks and anything you had to decide** that these documents did not settle.
10. **Final `git status`**, confirming `docs/Features/Foundation/Investigations/` is still
    untracked and uncommitted.
