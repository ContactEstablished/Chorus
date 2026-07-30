/**
 * Generates the README's brand lockup: the seven-bar mark plus the `chorus`
 * wordmark, as two standalone SVGs (one per colour scheme).
 *
 * Run with `npm run logo`. Output: docs/brand/chorus-logo-{dark,light}.svg
 *
 * ⚠ `src/renderer/src/components/ChorusMark.vue` IS THE AUTHORITY ON THE MARK
 * (D73 as corrected). The geometry below is a deliberate MIRROR of its `BARS`
 * table, not a second design: SEVEN bars, 6 wide on a 13px pitch, fully
 * rounded, vertically centred, heights 28/44/62/76/62/44/28, and the jade bar
 * is the CENTRE one. If the component's table ever changes, this file is wrong
 * until it is regenerated — which is why this is a script and not a hand-drawn
 * asset committed once and forgotten.
 *
 * ⚠ THE SIX-BAR GLYPH IN THE v2 MOCKS IS NOT THE LOGO. It is this mark missing
 * its second `high` bar, which pushes the jade bar off-centre and breaks the
 * mirror. Do not "fix" this file against those mocks.
 *
 * ⚠ WHY THE FONT IS EMBEDDED AS A DATA URI, AND WHY IT IS NOT LIVE TEXT.
 * GitHub strips inline <svg> from rendered Markdown, and no stylesheet or
 * webfont of ours can reach a README — so the wordmark cannot be HTML text in
 * its real face. It has to be an image asset, and for the real face to survive
 * on a machine that has never installed JetBrains Mono the font must travel
 * inside the file. 21 KB of woff2 becomes ~28 KB of base64; that is the price
 * of the name rendering correctly on someone else's computer.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/* ── The mark, mirroring ChorusMark.vue's own box and table ──────────────── */
const VIEWBOX_W = 84
const VIEWBOX_H = 76
const BAR_W = 6
const BARS = [
  { x: 0, y: 24, h: 28, tone: 'low' },
  { x: 13, y: 16, h: 44, tone: 'mid' },
  { x: 26, y: 7, h: 62, tone: 'high' },
  { x: 39, y: 0, h: 76, tone: 'lead' },
  { x: 52, y: 7, h: 62, tone: 'high' },
  { x: 65, y: 16, h: 44, tone: 'mid' },
  { x: 78, y: 24, h: 28, tone: 'low' }
]

/**
 * ⚠ TWO PALETTES, AND THE JADE IS THE SAME IN BOTH BECAUSE IT IS THE BRAND.
 * The app's greys were chosen against a near-black surface; on GitHub's white
 * they wash out to almost nothing. The light variant darkens ONLY the greys,
 * keeping their relative ordering (low < mid < high) so the mark still reads as
 * three descending pairs around a lead.
 */
const PALETTES = {
  dark: { low: '#3E4650', mid: '#4A535E', high: '#5A646F', lead: '#3BCFAE', word: '#8A94A0' },
  light: { low: '#A8B0BA', mid: '#8F98A4', high: '#77818D', lead: '#1AA98A', word: '#5A646F' }
}

/* ── The wordmark ────────────────────────────────────────────────────────────
   Lowercase and wide-tracked, exactly as TitleBar.vue renders it:
   font-family: var(--font-mono) · letter-spacing: 0.3em. */
const WORD = 'chorus'
const FONT_SIZE = 40
const TRACKING = 0.3 * FONT_SIZE
const GAP = 26

/** JetBrains Mono is monospaced at 600/1000 em per advance. Six glyphs each
 *  carry one tracking step; the last step is trailing space, so the INKED width
 *  is one step short of the total advance. */
const ADVANCE = 0.6 * FONT_SIZE
const INK_W = WORD.length * (ADVANCE + TRACKING) - TRACKING

const TEXT_X = VIEWBOX_W + GAP
/** Optically centred on the mark rather than mathematically: `chorus` has no
 *  descender and one ascender, so centring its x-height reads level while
 *  centring its em box reads low. */
const BASELINE_Y = VIEWBOX_H / 2 + 0.275 * FONT_SIZE

const TOTAL_W = Math.ceil(TEXT_X + INK_W)

const fontBase64 = readFileSync(
  join(root, 'node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2')
).toString('base64')

function svg(scheme) {
  const c = PALETTES[scheme]
  const bars = BARS.map(
    (b) =>
      `    <rect x="${b.x}" y="${b.y}" width="${BAR_W}" height="${b.h}" rx="${BAR_W / 2}" fill="${c[b.tone]}"/>`
  ).join('\n')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TOTAL_W}" height="${VIEWBOX_H}" viewBox="0 0 ${TOTAL_W} ${VIEWBOX_H}" role="img" aria-label="Chorus">
  <title>Chorus</title>
  <defs>
    <style>
      /* The face travels inside the file — see this script's header for why. */
      @font-face {
        font-family: 'Chorus JetBrains Mono';
        font-style: normal;
        font-weight: 400;
        src: url(data:font/woff2;base64,${fontBase64}) format('woff2');
      }
      .chorus-word {
        font-family: 'Chorus JetBrains Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace;
        font-size: ${FONT_SIZE}px;
        letter-spacing: ${TRACKING}px;
        fill: ${c.word};
      }
    </style>
  </defs>
  <g>
${bars}
  </g>
  <text class="chorus-word" x="${TEXT_X}" y="${BASELINE_Y}">${WORD}</text>
</svg>
`
}

mkdirSync(join(root, 'docs/brand'), { recursive: true })
for (const scheme of ['dark', 'light']) {
  const out = join(root, `docs/brand/chorus-logo-${scheme}.svg`)
  writeFileSync(out, svg(scheme))
  console.log(`wrote docs/brand/chorus-logo-${scheme}.svg  (${TOTAL_W}x${VIEWBOX_H})`)
}
