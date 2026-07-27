# ImplementationSpec 3c-1 — The Theme Foundation

**Normative for:** [`../Tasks/Task-3c-1.md`](../Tasks/Task-3c-1.md). Where this spec and the task
doc differ on a value, **this spec wins**; where either differs from
`docs/design/v2/Chorus Workspace.dc.html`, **the mock wins** (D73).

## 1. Where the theme lives, and why not anywhere else

Tailwind **v4.3.3** with the Vite plugin and **no config file**. In v4 the theme is declared in
CSS with `@theme`, and every token there becomes a utility automatically —
`--color-surface-card: #12151A` yields `bg-surface-card`, `text-surface-card`,
`border-surface-card`. That is the whole mechanism.

**⚠ Do not create `tailwind.config.js`.** Two homes for the theme is the failure D48 records in
another domain: a value that can be set in two places will eventually be set differently in each.

## 2. The token block

Insert into `src/renderer/src/assets/main.css`, after `@import 'tailwindcss';`.

**Naming rule: tokens are named for the ROLE they play in the mock, and carry the mock element
they were read from.** Near-identical values are distinguished by role, never merged.

```css
@theme {
  /* ═══ Surfaces — the five-surface ladder, plus the four inset values the
         mocks actually use. ⚠ D73: several of these differ by 1–2 hex points
         with no semantic distinction. THAT IS DELIBERATE AND FAITHFUL TO THE
         MOCKS. Collapsing them is a DESIGN CHANGE requiring Matthew's
         approval — it is not a refactor and must not be done in passing. */
  --color-surface-void:      #08090B; /* body backdrop, outside the frame   */
  --color-surface-chrome:    #0A0B0D; /* titlebar + status bar             */
  --color-surface-rail:      #0B0D10; /* left project rail                 */
  --color-surface-app:       #0D0F12; /* app background                    */
  --color-surface-inset:     #0F1216; /* status-bar chip background        */
  --color-surface-hover:     #101318; /* rail item hover                   */
  --color-surface-card:      #12151A; /* filmstrip card                    */
  --color-surface-card-dim:  #101317; /* filmstrip card, completed         */
  --color-surface-selected:  #13171C; /* selected rail item                */
  --color-surface-card-hover:#151920; /* filmstrip card hover              */
  --color-surface-badge:     #1A2027; /* agent-kind tile                   */
  --color-surface-badge-dim: #171C22; /* agent-kind tile, completed        */
  --color-surface-keycap:    #111419; /* keycap hint background            */
  --color-surface-titlebar-hover: #181C21; /* window control hover         */

  /* ═══ Borders */
  --color-border-chrome:     #15181C;
  --color-border-inset:      #1D232A;
  --color-border-dim:        #222831;
  --color-border-divider:    #232A32; /* status-bar separators, keycaps    */
  --color-border-badge:      #262D35;

  /* ═══ Text ladder */
  --color-text-primary:      #E6EAEE;
  --color-text-body:         #C7CFD8;
  --color-text-badge:        #B9C2CC;
  --color-text-secondary:    #9AA4AE;
  --color-text-muted:        #8A94A0;
  --color-text-tertiary:     #7E8894;
  --color-text-quiet:        #68737F; /* timings, costs, status bar        */
  --color-text-eyebrow:      #545E6A; /* PROJECTS / COUNCIL labels         */

  /* ═══ Accents */
  --color-accent-jade:       #3BCFAE;
  --color-accent-jade-hover: #6FE0C6;
  --color-accent-periwinkle: #7C8CF8; /* active project spine, card outline*/

  /* ═══ State — ⚠ SHAPE is the primary encoding (StateMarker.vue); these
         colors REINFORCE it and must never be the only signal. */
  --color-state-attention:      #F59E0B;
  --color-state-attention-text: #F5B23C;
  --color-state-running:        #22C55E;
  --color-state-error:          #EF4444;
  --color-state-error-text:     #D96C66;
  --color-state-done:           #68737F;
  --color-state-close-hover:    #C42B1C; /* titlebar close only            */

  /* ═══ Secondary project spine colors (mock: Bryk, and the third project) */
  --color-spine-violet:      #B08CC9;
  --color-spine-sand:        #C9A97F;
  /* ⚠ ADDED 2026-07-26 from the council mock (v2). Same 2px spine geometry as
     the project rail's, used per COUNCIL ROSTER MEMBER. Reported ahead of the
     sweep by ImplementationSpec-3c-5 §1b so this task adds it with the rest
     rather than 3c-5 discovering it at the end of the phase. */
  --color-spine-blue:        #5EA2E8;

  /* ═══ Dimmed logo-bar tones — the six-bar chorus glyph rendered at
         opacity .5 in the council mock's "no members configured" empty state.
         NOT the titlebar logo's colors (#3E4650 / #4A535E / #5A646F); a
         separate, quieter set. Also from the council mock (v2). */
  --color-glyph-dim-mid:     #333D48;
  --color-glyph-dim-high:    #3E4954;

  /* ═══ Type */
  --font-sans: 'Archivo', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  /* ═══ Radii, read from the mock rather than chosen */
  --radius-chip: 3px;   /* keycaps, badges, status chips */
  --radius-rail: 5px;   /* rail items                    */
  --radius-card: 6px;   /* filmstrip cards               */
}
```

**⚠ SWEEP `docs/design/v2/` — FIVE mocks now, not four.** The council mock (D72, delivered
2026-07-26) joins Workspace, Launch Dialog, Settings Providers and Startup. **Its three additions
are already folded into the table above** (`--color-spine-blue`, `--color-glyph-dim-mid`,
`--color-glyph-dim-high`), reported ahead of time by `ImplementationSpec-3c-5.md` §1b so that this
task adds them with everything else. **Confirm them rather than re-deriving them, and sweep the
other four for anything still missing.**

**Values to sweep for and report if found.** The table above is the Workspace mock's set plus the
council mock's three. The Launch Dialog, Settings and Startup mocks may introduce more (`#191E24`, `#1B2128`, `#141920`,
`#11151A`, `#181D23`, `#0D1013` and `#12161B` all appear somewhere in the mock set). **Add them
with role names derived from where they appear, and list every addition in the task report** —
an unreported token is an unreviewed design decision.

## 3. Fonts (D75)

```bash
npm install @fontsource/archivo @fontsource/jetbrains-mono
```

Import **only the weights the mocks use** — Archivo 400/500/600/700, JetBrains Mono 400/500/600
plus 400 italic — at the top of `main.css`, before `@import 'tailwindcss';`:

```css
@import '@fontsource/archivo/400.css';
@import '@fontsource/archivo/500.css';
@import '@fontsource/archivo/600.css';
@import '@fontsource/archivo/700.css';
@import '@fontsource/jetbrains-mono/400.css';
@import '@fontsource/jetbrains-mono/500.css';
@import '@fontsource/jetbrains-mono/600.css';
@import '@fontsource/jetbrains-mono/400-italic.css';
```

**Verification that the bundle is real, not cached:** the built renderer must contain the font
files — `npm run build && find out/renderer -name "*.woff2" | head`. ⚠ Searched **recursively on
purpose**: `out/renderer` is electron-vite's default renderer output but **did not exist when this
spec was written** (only `out/main` and `out/preload` were present), so the asset subdirectory and
the hashed filenames are **unverified**. Confirm where the renderer actually builds to before
reading an empty result as a failed font bundle. **Then the offline cold boot** — that is the
acceptance proof, because a warm HTTP cache will happily fake a working CDN.

## 4. Keyframes and motion, ported from the mock's `<style>` head

```css
@keyframes chorusPulse {
  0%, 100% { box-shadow: 0 0 0 1px rgba(245,158,11,.45), 0 0 10px rgba(245,158,11,.08); }
  50%      { box-shadow: 0 0 0 1px rgba(245,158,11,.95), 0 0 18px rgba(245,158,11,.30); }
}
@keyframes cursorBlink {
  0%, 49%   { opacity: 1; }
  50%, 100% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  [data-pulse] {
    animation: none !important;
    box-shadow: 0 0 0 1px rgba(245,158,11,.95), 0 0 14px rgba(245,158,11,.22) !important;
  }
  [data-blink] { animation: none !important; }
}
```

**⚠ The reduced-motion resolution is not "no shadow" — it is the BRIGHT end, held static.** The
attention state must stay as visible for a user who cannot tolerate motion as for one who can.
Getting this wrong makes the app quietly less accessible in exactly the state that matters most.
The `[data-pulse]` / `[data-blink]` attribute hooks are the mock's own convention; keep them so
the selectors keep working as components adopt them.

## 5. Base rules, ported from the mock

```css
html, body, #app { height: 100%; overflow: hidden; background: var(--color-surface-app); }
a       { color: var(--color-accent-jade); text-decoration: none; }
a:hover { color: var(--color-accent-jade-hover); }
::selection { background: rgba(59,207,174,.25); }
body { font-family: var(--font-sans); color: var(--color-text-body); }
```

And in `src/main/index.ts`, the single permitted line change:

```ts
backgroundColor: '#0D0F12',   // was '#1e1e1e' — matches --color-surface-app so
                              // the window does not flash grey before first paint
```

## 6. `StateMarker.vue` — exact geometry

**⚠ D77 (2026-07-26): NO COMPONENT TEST, and this component's runtime proof is OWED BY TASK
3c-3.** The repo has no DOM test harness (`vitest.config.ts` is `environment: 'node'`, no
`@vue/test-utils`/`jsdom`) and this phase does not build one. Because 3c-1 restyles nothing, the
component **is mounted nowhere here** — verify it **structurally** (four distinct geometries in
the rendered output) and **state in the report that the colorblind proof is 3c-3's grayscale
filmstrip screenshot.** Do not add a test harness; do not touch `vitest.config.ts`.

The four shapes, read from `v2/Chorus Workspace.dc.html`'s filmstrip cards. **These sizes and
glows are the mock's, not approximations.**

| State | Geometry | Fill | Glow |
|---|---|---|---|
| `needs-you` | `7×7px`, `transform: rotate(45deg)` → diamond | `--color-state-attention` | `box-shadow: 0 0 8px rgba(245,158,11,.6)` |
| `running` | `8×8px`, `border-radius: 50%` → circle | `--color-state-running` | `box-shadow: 0 0 8px rgba(34,197,94,.55)` |
| `error` | `<svg width="11" height="10" viewBox="0 0 11 10">`, `<path d="M5.5 0.5 10.5 9.5H0.5Z">` → triangle | `--color-state-error` | `filter: drop-shadow(0 0 4px rgba(239,68,68,.6))` |
| `done` | `7×7px`, no rotation, no radius → square | `--color-state-done` | none |

Component contract:

```ts
defineProps<{ state: 'needs-you' | 'running' | 'error' | 'done' }>()
```

All four render `flex: none` so they never shrink inside a flex row. **The `error` case is an
`<svg>` and the other three are `<span>`s** — that asymmetry is the mock's and is what makes the
triangle a real triangle rather than a rotated square; do not force one element type for
symmetry's sake.

**⚠ The pulse belongs to the CARD, not to the marker.** In the mock, `data-pulse` and the
`chorusPulse` animation sit on the 88px filmstrip card, while the diamond only carries its own
static glow. `StateMarker` must **not** animate — Task 3c-3 puts `data-pulse` on the card. A
marker that pulses on its own will double up and read as a different design.

## 7. Verification

**Build-level**

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
grep -rn "fonts.googleapis.com\|fonts.gstatic.com" src/          # expect nothing
npm run build && find out/renderer -name "*.woff2" | head        # expect non-empty (path unverified — see §3)
git diff --stat vitest.config.ts                                 # expect EMPTY (D77)
grep -c "vue/test-utils\|jsdom\|happy-dom" package.json          # expect 0 (D77)
```

**⚠ `npx vitest run` must report 941/941 across 29 files — UNCHANGED.** D77 adds no test, so a
number other than 941 means either a pre-existing test was edited or a harness was added.

**Runtime, over CDP on `--remote-debugging-port=9222`** — the claims that only a running app can
settle:

1. `getComputedStyle(document.body).fontFamily` contains `Archivo`.
2. `getComputedStyle(document.documentElement).getPropertyValue('--color-surface-app').trim()`
   is `#0D0F12`.
3. **With the network adapter disabled**, cold-boot and screenshot: both typefaces still render.
   Compare against an online screenshot — they must be identical.
4. Enable `prefers-reduced-motion: reduce` via `Emulation.setEmulatedMedia` and confirm a
   `[data-pulse]` element reports `animationName: none` with the static bright shadow applied.
   **Toggle it live rather than reading the stylesheet** — the rule is only real if it wins the
   cascade.
5. Screenshot the shell and confirm **no existing surface changed beyond background and
   typeface**.

## 8. Deliberately left open for later tasks

- **Which surfaces adopt which token** — every later task's job, and the reason this one restyles
  nothing.
- **The `data-pulse` placement** on the filmstrip card — Task 3c-3.
- **Whether the settings mocks introduce tokens the Workspace mock lacks** — swept here,
  *applied* in 3c-5.
- **The terminal's own ANSI palette.** `TerminalPane.vue` hosts xterm.js, which has a separate
  theme object; the mock draws terminal text in specific colors. **That is Task 3c-3's decision,
  not this one's** — noted here so it is not mistaken for an omission.
