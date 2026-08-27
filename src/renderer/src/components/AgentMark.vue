<script setup lang="ts">
/**
 * AgentMark — the agent-identity glyph family: one vendor mark per agent kind,
 * monochrome, on one grid.
 *
 * WHY THIS EXISTS. Every surface that shows an agent used to draw a two-letter
 * monospace code — `cc`, `cx`, `gk`, `km`, `oc` — in an 18px or 16px badge
 * tile. A code has to be LEARNED before it means anything, it does not survive
 * peripheral vision (which is how a filmstrip rail is actually read), and at
 * 8.5px it sits near the limit of legibility. A mark is recognised rather than
 * decoded, and the reader already knows these five.
 *
 * ⚠ THE DECISION IS D184 (2026-08-26) AND WHAT IT OVERRIDES IS THE MOCK, NOT THE
 * COLOUR RULE. `PLAN.md` §7b names three channels that must never mix — hue =
 * project, ICON = provider/agent, state = dot + glow — and D38 adopts it as
 * "project identity by hue only; agent identity by glyph only, never color". So
 * the icon channel was ALREADY the agent's; what these marks change is only that
 * the glyph gets better at being a glyph. The rule that agent identity must never
 * travel on HUE is preserved exactly: every mark below is a single
 * `currentColor` fill, no vendor brand colour enters the palette, and the badge
 * chrome is untouched. Hue stays the project's (`shared/projectColors.ts`).
 * What IS overridden is `docs/design/v2/Chorus Launch Dialog.dc.html`, which
 * draws the two-letter tile and which D73 makes the authority — the precedent for
 * an override of exactly this scope is `ChorusMark.vue`, where four v2 mocks draw
 * a six-bar logo and the real one has seven.
 *
 * ⚠ NOMINATIVE USE, STATED ONCE. These are third-party marks identifying the tool
 * a button launches — the same use an IDE makes of them. They are reproduced
 * faithfully and monochrome, and Chorus's own branding is never restyled to
 * resemble any of them.
 *
 * PROVENANCE — the part that cannot be reconstructed later. Every `d` below was
 * COPIED from the file named here, never retyped: `_verify/7a-1/gen-agentmark.mjs`
 * generated this file by reading those SVGs, so a reviewer can grep any `d` and
 * find it character for character in `_verify/7a-1/marks/`.
 *
 * | mark | source | retrieved | src viewBox | bbox x/y/w/h | TARGET | scale |
 * |---|---|---|---|---|---|---|
 * | `claude` | https://unpkg.com/@lobehub/icons-static-svg@1.94.0/icons/claude.svg | 2026-08-27 | `0 0 24 24` | 0 / 0 / 24 / 24 | 18 | `scale(0.75)` |
 * | `codex` | https://unpkg.com/@lobehub/icons-static-svg@1.94.0/icons/codex.svg | 2026-08-27 | `0 0 24 24` | 0 / 0 / 24 / 24 | 18 | `scale(0.75)` |
 * | `grok` | https://unpkg.com/@lobehub/icons-static-svg@1.94.0/icons/grok.svg | 2026-08-27 | `0 0 24 24` | 0 / 0.5 / 24 / 23.04 | 18 | `scale(0.75)` |
 * | `kimi` | https://unpkg.com/@lobehub/icons-static-svg@1.94.0/icons/kimi.svg | 2026-08-27 | `0 0 24 24` | 3 / 0 / 20.77 / 20 | 18 | `scale(0.8666)` |
 * | `opencode` | https://unpkg.com/@lobehub/icons-static-svg@1.94.0/icons/opencode.svg | 2026-08-27 | `0 0 24 24` | 4 / 2 / 16 / 20 | 18 | `scale(0.9)` |
 * | `shell` | Chorus's own drawing — not fetched, not attributed | — | — | — | — | none |
 *
 * ⚠ THE SOURCE IS A CURATED THIRD-PARTY SET, NOT EACH VENDOR'S OWN SITE, AND THAT
 * IS A DELIBERATE AMENDMENT TO D184's SOURCING CLAUSE (Matthew, 2026-08-27).
 * The vendors' own assets were tried first and are kept beside these for the
 * trail: Anthropic's and OpenAI's favicons are APP ICONS with backplates and
 * theme-switching CSS, grok.com's is a Figma export carrying a `foreignObject`,
 * an `feGaussianBlur` and a stroke, and MOONSHOT PUBLISHES NO SVG AT ALL — only
 * `.ico`. `@lobehub/icons-static-svg` (MIT, v1.94.0) publishes clean single-purpose
 * logomarks already on a 24 grid in `currentColor`. It was cross-checked rather
 * than trusted: its `opencode` reproduces opencode.ai's own asset's proportions
 * exactly (outer aspect 0.8, inner hole 50% of outer width and 60% of its height
 * in both). Full record: `_verify/7a-1/SOURCING.md`.
 *
 * ⚠ THE PACKAGE IS NOT A DEPENDENCY AND MUST NOT BECOME ONE. `@lobehub/icons`
 * proper is REACT, which `CLAUDE.md` bars outright, and this task's non-goals bar
 * an icon package regardless. The geometry is vendored exactly as `PaneIcon.vue`
 * vendors Lucide's, and for the same reason: a package whose upgrade can restyle
 * app chrome is a bad trade for six shapes that change once a year.
 *
 * ⚠ FILLED, WHERE `PaneIcon` IS STROKED — A DELIBERATE DIVERGENCE, NOT AN
 * OVERSIGHT. `PaneIcon` draws UI verbs Chorus invented, cut to one hairline
 * weight so the header row reads as one family. These are vendor marks: solid
 * shapes in their own sources, and re-cutting them as outlines would be redrawing
 * somebody else's logo. The two components do not share a root element and
 * neither should be "unified" into the other.
 *
 * ⚠ A `Record`, WHERE `PaneIcon` USES A `v-else-if` CHAIN — THE OTHER DELIBERATE
 * DIVERGENCE, AND THE ONE STRUCTURAL DECISION IN THIS FILE. `AgentKind` is not a
 * closed set: D86 added `kimi`, D90 added `opencode`, D165 added `grok`, and Task
 * 7a-2 adds `shell`. A template chain is NOT exhaustiveness-checked by `vue-tsc`,
 * so a name with no branch renders an EMPTY <svg> — a 16px hole that reads as a
 * CSS bug and sends the reader to the stylesheet. With a total `Record`, the next
 * widening fails the TYPECHECK, at the map, in the file that owns the drawing,
 * before anything renders. That is `notifications.ts`'s argument verbatim: the
 * compiler finding this file is the property working, not a chore.
 */
import type { AgentKind } from '../../../shared/ipc'

/**
 * ⚠ `AgentKind | 'shell'` RATHER THAN `AgentKind`, AND ONLY UNTIL 7a-2 LANDS.
 * `'shell'` is not in `agentKindSchema` yet (`shared/ipc.ts:902`) — Task 7a-2
 * widens it. The mark is drawn HERE anyway, deliberately: 7a-2 is a main-process
 * task about a schema widening and an adapter, and a DRAWING that landed in that
 * diff would have no reviewer looking at geometry. When 7a-2 lands the union
 * collapses on its own — it is idempotent, nothing breaks, and this alias can be
 * simplified in one line.
 */
export type AgentMarkName = AgentKind | 'shell'

interface MarkPath {
  /** ⚠ COPIED VERBATIM FROM THE SOURCE FILE. Never retyped, never rounded. */
  readonly d: string
  /** ⚠ ONLY WHERE THE SOURCE CARRIES IT. Dropping an `evenodd` turns a ring into
   *  a disc — the mark still renders, still looks deliberate, and is wrong. */
  readonly fillRule?: 'evenodd'
}

interface Mark {
  /** The 24-grid placement. `null` only for `shell`, which Chorus drew straight
   *  onto the grid — written as null rather than `scale(1)` so the difference
   *  between "no transform needed" and "transform happens to be identity" stays
   *  visible. */
  readonly transform: string | null
  readonly paths: readonly MarkPath[]
}

/**
 * ⚠ THE PATHS ARE THE VENDOR'S AND THE PLACEMENT IS OURS, AND KEEPING THOSE TWO
 * SEPARATE IS THE WHOLE FIDELITY STRATEGY. Every `d` is untouched source; every
 * `transform` is Chorus's arithmetic over a measured bbox
 * (`_verify/7a-1/bbox.mjs`), so a reviewer can re-derive the second without
 * re-checking the first.
 *
 * ⚠ AND THE TRANSFORMS ARE NOT REDUNDANT EVEN THOUGH EVERY SOURCE IS ALREADY A 24
 * BOX. The set does not frame consistently: claude, codex and grok are drawn
 * edge-to-edge (max dimension 24), `opencode` is 16x20, and `kimi` is inset AND
 * off-centre (bbox starts at x=3, centred at 13.38 rather than 12). Rendered raw,
 * kimi would read small and pushed right beside its neighbours. Normalising every
 * mark to TARGET=18 units centred on the grid is what makes a row of them read as
 * one family — which is the same job the 24 grid does for `PaneIcon`.
 */
const MARKS: Record<AgentMarkName, Mark> = {
  // claude — https://unpkg.com/@lobehub/icons-static-svg@1.94.0/icons/claude.svg
  // retrieved 2026-08-27 · source viewBox "0 0 24 24" · bbox x=0 y=0 w=24 h=24
  // TARGET 18 -> scale 0.75, translate(3 3)
  claude: {
    transform: 'translate(3 3) scale(0.75)',
    paths: [
      { d: 'M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z' }
    ]
  },
  // codex — https://unpkg.com/@lobehub/icons-static-svg@1.94.0/icons/codex.svg
  // retrieved 2026-08-27 · source viewBox "0 0 24 24" · bbox x=0 y=0 w=24 h=24
  // TARGET 18 -> scale 0.75, translate(3 3)
  codex: {
    transform: 'translate(3 3) scale(0.75)',
    paths: [
      { d: 'M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z', fillRule: 'evenodd' }
    ]
  },
  // grok — https://unpkg.com/@lobehub/icons-static-svg@1.94.0/icons/grok.svg
  // retrieved 2026-08-27 · source viewBox "0 0 24 24" · bbox x=0 y=0.5 w=24 h=23.04
  // TARGET 18 -> scale 0.75, translate(3 2.985)
  grok: {
    transform: 'translate(3 2.985) scale(0.75)',
    paths: [
      { d: 'M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815' }
    ]
  },
  // kimi — https://unpkg.com/@lobehub/icons-static-svg@1.94.0/icons/kimi.svg
  // retrieved 2026-08-27 · source viewBox "0 0 24 24" · bbox x=3 y=0 w=20.77 h=20
  // TARGET 18 -> scale 0.8666, translate(0.4001 3.3337)
  kimi: {
    transform: 'translate(0.4001 3.3337) scale(0.8666)',
    paths: [
      { d: 'M21.846 0a1.923 1.923 0 110 3.846H20.15a.226.226 0 01-.227-.226V1.923C19.923.861 20.784 0 21.846 0z' },
      { d: 'M11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 00-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 01.205-.023l6.484 4.772a7.677 7.677 0 003.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 01-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z' }
    ]
  },
  // opencode — https://unpkg.com/@lobehub/icons-static-svg@1.94.0/icons/opencode.svg
  // retrieved 2026-08-27 · source viewBox "0 0 24 24" · bbox x=4 y=2 w=16 h=20
  // TARGET 18 -> scale 0.9, translate(1.2 1.2)
  opencode: {
    transform: 'translate(1.2 1.2) scale(0.9)',
    paths: [
      { d: 'M16 6H8v12h8V6zm4 16H4V2h16v20z' }
    ]
  },
  // shell — CHORUS'S OWN DRAWING. Nobody's mark, no attribution, no source
  // file. Drawn directly on the 24 grid, so it needs no transform.
  shell: {
    transform: null,
    paths: [
      { d: 'M4 7.2 5.6 5.6 12 12l-6.4 6.4L4 16.8 8.8 12z' },
      { d: 'M14 16.4h5.6a1 1 0 0 1 0 2H14a1 1 0 0 1 0-2z' }
    ]
  }
}

withDefaults(defineProps<{ name: AgentMarkName; size?: number }>(), { size: 11 })
</script>

<template>
  <!-- ⚠ `currentColor` AND NOTHING ELSE. The tile's own `color` decides what this
       resolves to, which is what makes FilmstripRenderer's `.card-done .card-tile`
       dim rule re-tint the mark for free rather than needing a second rule here.

       `aria-hidden` because every surface renders the agent's NAME as text beside
       the tile (LaunchDialog.vue, TerminalPane.vue). The one surface that does not
       always — the filmstrip card, whose adjacent text is the session title and may
       never name the agent — carries a `title` on the tile instead.

       ⚠ `MARKS[name]` NEEDS NO GUARD AND MUST NOT BE GIVEN ONE. `name` is
       `AgentMarkName` and `MARKS` is a total `Record` over it, so the lookup
       cannot miss. A `?.` or an `|| FALLBACK` would compile away the very error
       the `Record` exists to raise, and the missing mark would come back as an
       empty <svg> — the failure mode this shape replaced. Vue omits an attribute
       bound to null/undefined, so `transform: null` and an absent `fillRule` both
       render as no attribute, with no branch. -->
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
    aria-hidden="true"
    focusable="false"
  >
    <!-- ⚠ `?? undefined` IS LOAD-BEARING, NOT NOISE. The data models "no transform
         needed" as `null` on purpose (see `Mark.transform`), but `vue-tsc` types the
         SVG `transform` attribute as `string | undefined` and rejects `null` —
         TS2322, caught by the typecheck gate on the first run of this task. Both
         render as no attribute; this converts at the boundary rather than weakening
         the type, so `shell` keeps saying "none" rather than "identity". -->
    <g :transform="MARKS[name].transform ?? undefined">
      <path v-for="(p, i) in MARKS[name].paths" :key="i" :d="p.d" :fill-rule="p.fillRule" />
    </g>
  </svg>
</template>
