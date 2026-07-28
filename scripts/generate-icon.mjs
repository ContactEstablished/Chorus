#!/usr/bin/env node
/**
 * THE APP ICON GENERATOR — renders `resources/icon.ico` + `resources/icon.png`
 * from the Chorus mark. Run with `npm run icons`.
 *
 * ⚠ THE MARK IS NOT DUPLICATED HERE AS A DESIGN DECISION — the numbers below
 * are COPIED FROM `src/renderer/src/components/ChorusMark.vue`, which stays the
 * one place the logo is *drawn*. A .ico is a bag of rasterised bitmaps; it
 * cannot import a Vue SFC, so the geometry has to be restated. If the mark ever
 * changes, change it there and re-run this script — the constants are kept
 * byte-identical to the SFC's so a diff between the two is obvious.
 *
 * ⚠ NO IMAGE DEPENDENCY, ON PURPOSE. sharp / png-to-ico / jimp would each be a
 * new dependency (CLAUDE.md: ask first) carrying native binaries, to draw seven
 * rounded rectangles. Everything below is Node's own zlib plus ~80 lines of
 * rasteriser, and the output is deterministic — re-running produces the same
 * bytes.
 *
 * WHY BOTH FORMATS:
 *   icon.ico — what Windows wants. BrowserWindow({ icon }) feeds the taskbar
 *              button, the Alt-Tab card and the window's own small icon.
 *   icon.png — the 512px master. Not wired to anything today; it is what a
 *              future macOS/Linux target and the docs both need, and it is the
 *              artefact a human can actually look at.
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'resources')

// ── The mark, verbatim from ChorusMark.vue ───────────────────────────────────
/** 7 bars × 6px wide on a 13px pitch = 84 wide; the lead bar's height = 76. */
const VIEWBOX_W = 84
const VIEWBOX_H = 76
const BAR_W = 6
const PITCH = 13
const BARS = [
  { x: 0, y: 24, h: 28, tone: 'low' },
  { x: 13, y: 16, h: 44, tone: 'mid' },
  { x: 26, y: 7, h: 62, tone: 'high' },
  { x: 39, y: 0, h: 76, tone: 'lead' },
  { x: 52, y: 7, h: 62, tone: 'high' },
  { x: 65, y: 16, h: 44, tone: 'mid' },
  { x: 78, y: 24, h: 28, tone: 'low' }
]

// ── Colour, verbatim from src/renderer/src/assets/main.css ───────────────────
// ⚠ The tile is literally `--color-surface-app`, so the icon is the mark on the
// app's own background — the same picture the titlebar shows, boxed. That is
// why no colour is invented here: nothing is "tuned for the icon".
const TONES = {
  low: '#3E4650', // --color-logo-bar-low
  mid: '#4A535E', // --color-logo-bar-mid
  high: '#5A646F', // --color-logo-bar-high
  lead: '#3BCFAE' // --color-accent-jade
}
const TILE = '#0D0F12' // --color-surface-app
const RING = '#262D35' // --color-border-badge — a hairline so the tile still has
//                        an edge when the taskbar behind it is near-black.

/**
 * Fraction of the icon's width the mark spans. Leaves a normal glyph margin.
 *
 * ⚠ 0.78 IS TUNED AGAINST THE SNAPPED SIZES, NOT PICKED FOR THE BIG ONES. The
 * snapped layout below rounds the 13px pitch to whole pixels, and the mark's
 * width follows that rounding rather than this number: at 0.72 the 48px and
 * 64px pitches both rounded DOWN, landing those two icons at 67–70% while
 * 16/24/32 sat at ~81% — the mark visibly shrank in the middle of the ramp.
 * 0.78 rounds every size in the set to the same ~79–81%. Re-check the contact
 * sheet if this is ever changed.
 */
const MARK_SCALE = 0.78
/** Corner radius of the tile, as a fraction of its side. */
const TILE_RADIUS = 0.2

/**
 * ⚠ SIZES AT OR BELOW THIS GET PIXEL-SNAPPED GEOMETRY, AND THAT IS THE WHOLE
 * TRICK. At 16px a faithfully-scaled bar is 0.8px wide: antialiased, every bar
 * comes out as an identical grey smear and the mark reads as a blob. Snapping
 * bar width and pitch to whole pixels (and re-deriving the heights from the
 * SNAPPED pitch, so the mark keeps its aspect) gives crisp 1px bars with 1px
 * gaps instead. Above this, the float geometry is finer than the grid and plain
 * antialiasing is both faithful and smooth.
 */
const SNAP_MAX = 64

// ── Rasteriser ───────────────────────────────────────────────────────────────

function parseHex(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ]
}

/** Straight-alpha RGBA canvas, transparent. */
function canvasOf(size) {
  return new Uint8ClampedArray(size * size * 4)
}

/** Source-over composite of one straight-alpha colour onto one pixel. */
function blend(px, i, [r, g, b], a) {
  if (a <= 0) return
  const da = px[i + 3] / 255
  const outA = a + da * (1 - a)
  if (outA <= 0) return
  px[i] = (r * a + px[i] * da * (1 - a)) / outA
  px[i + 1] = (g * a + px[i + 1] * da * (1 - a)) / outA
  px[i + 2] = (b * a + px[i + 2] * da * (1 - a)) / outA
  px[i + 3] = outA * 255
}

/**
 * Fill a rounded rectangle, antialiased by 4×4 supersampling.
 *
 * Coverage is counted per pixel rather than solved analytically: 16 samples on
 * a 256px icon is ~1M point tests, which is nothing, and it handles the rounded
 * caps without a special case.
 */
function fillRoundRect(px, size, x, y, w, h, radius, color, SS = 4) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  const cx = x + w / 2
  const cy = y + h / 2
  const insetX = w / 2 - r
  const insetY = h / 2 - r
  const x0 = Math.max(0, Math.floor(x))
  const x1 = Math.min(size, Math.ceil(x + w))
  const y0 = Math.max(0, Math.floor(y))
  const y1 = Math.min(size, Math.ceil(y + h))
  for (let py = y0; py < y1; py++) {
    for (let pxx = x0; pxx < x1; pxx++) {
      let hits = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const qx = Math.max(Math.abs(pxx + (sx + 0.5) / SS - cx) - insetX, 0)
          const qy = Math.max(Math.abs(py + (sy + 0.5) / SS - cy) - insetY, 0)
          if (Math.sqrt(qx * qx + qy * qy) <= r) hits++
        }
      }
      if (hits > 0) blend(px, (py * size + pxx) * 4, color, hits / (SS * SS))
    }
  }
}

/** Bar rectangles in device pixels, for one icon size. */
function layout(size) {
  if (size > SNAP_MAX) {
    const scale = (size * MARK_SCALE) / VIEWBOX_W
    const ox = (size - VIEWBOX_W * scale) / 2
    const oy = (size - VIEWBOX_H * scale) / 2
    return BARS.map((b) => ({
      x: ox + b.x * scale,
      y: oy + b.y * scale,
      w: BAR_W * scale,
      h: b.h * scale,
      tone: b.tone
    }))
  }

  // Snapped: choose a whole-pixel pitch first, then let everything follow from
  // it so the mark's proportions survive the rounding.
  const pitch = Math.max(2, Math.round((size * MARK_SCALE * PITCH) / VIEWBOX_W))
  const barW = Math.max(1, Math.min(pitch - 1, Math.round((BAR_W * pitch) / PITCH)))
  const scale = pitch / PITCH
  const totalW = 6 * pitch + barW
  const ox = Math.round((size - totalW) / 2)
  return BARS.map((b, i) => {
    const h = Math.max(2, Math.round(b.h * scale))
    return {
      x: ox + i * pitch,
      y: Math.round((size - h) / 2),
      w: barW,
      h,
      tone: b.tone
    }
  })
}

function render(size) {
  const px = canvasOf(size)
  const radius = size * TILE_RADIUS
  const ring = Math.max(1, Math.round(size / 64))
  fillRoundRect(px, size, 0, 0, size, size, radius, parseHex(RING))
  fillRoundRect(px, size, ring, ring, size - 2 * ring, size - 2 * ring, radius - ring, parseHex(TILE))
  for (const bar of layout(size)) {
    fillRoundRect(px, size, bar.x, bar.y, bar.w, bar.h, bar.w / 2, parseHex(TONES[bar.tone]))
  }
  return px
}

// ── PNG ──────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function encodePng(px, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  // 10..12 = compression / filter / interlace, all 0
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

// ── ICO ──────────────────────────────────────────────────────────────────────

/**
 * A 32-bpp BGRA DIB, bottom-up, with the legacy AND mask appended.
 *
 * ⚠ THE MASK IS REQUIRED EVEN THOUGH IT IS ALL ZEROES. The header declares
 * `height = 2 × size` because an ICO's DIB is defined as colour rows followed
 * by mask rows; a reader that trusts the header and finds the buffer short will
 * either reject the entry or render garbage. With a real alpha channel every
 * mask bit is 0 ("opaque"), and alpha does the transparency.
 */
function encodeDib(px, size) {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8)
  header.writeUInt16LE(1, 12) // planes
  header.writeUInt16LE(32, 14) // bpp
  header.writeUInt32LE(0, 16) // BI_RGB
  const maskStride = Math.ceil(size / 8 / 4) * 4
  const maskBytes = maskStride * size
  header.writeUInt32LE(size * size * 4 + maskBytes, 20)
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4
    for (let x = 0; x < size; x++) {
      const s = src + x * 4
      const d = (y * size + x) * 4
      pixels[d] = px[s + 2] // B
      pixels[d + 1] = px[s + 1] // G
      pixels[d + 2] = px[s] // R
      pixels[d + 3] = px[s + 3] // A
    }
  }
  return Buffer.concat([header, pixels, Buffer.alloc(maskBytes)])
}

/**
 * ⚠ PNG ENTRIES ONLY AT 256. Vista+ reads PNG-compressed ICO entries and a
 * 256×256 DIB would add ~256 KB for nothing — but the small sizes are the ones
 * every shell surface actually touches, so they stay as plain DIBs where no
 * decoder has ever had a choice to get wrong.
 */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

function encodeIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)
  const entries = []
  const blobs = []
  let offset = 6 + 16 * images.length
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size // 0 means 256
    entry[1] = size >= 256 ? 0 : size
    entry[2] = 0 // palette size
    entry[3] = 0 // reserved
    entry.writeUInt16LE(1, 4) // planes
    entry.writeUInt16LE(32, 6) // bpp
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    blobs.push(data)
    offset += data.length
  }
  return Buffer.concat([header, ...entries, ...blobs])
}

// ── Main ─────────────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true })

const images = ICO_SIZES.map((size) => {
  const px = render(size)
  return { size, data: size >= 256 ? encodePng(px, size) : encodeDib(px, size) }
})
const ico = encodeIco(images)
writeFileSync(join(OUT_DIR, 'icon.ico'), ico)

const master = encodePng(render(512), 512)
writeFileSync(join(OUT_DIR, 'icon.png'), master)

console.log(
  `resources/icon.ico  ${ICO_SIZES.join('/')}  ${(ico.length / 1024).toFixed(1)} KB\n` +
    `resources/icon.png  512  ${(master.length / 1024).toFixed(1)} KB`
)
