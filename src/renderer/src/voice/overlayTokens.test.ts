import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * THE OVERLAY WINDOW HAS NO APP STYLESHEET, SO IT CARRIES ITS OWN COPY OF THE
 * MARK'S FOUR FILLS — and a copy nothing checks is a copy that drifts.
 *
 * The failure this guards against is silent and looks like a broken feature
 * rather than a broken colour: an undefined CSS custom property is not an
 * error, so a renamed or re-valued token in main.css would leave the dictation
 * overlay's Chorus mark rendering with NO FILL AT ALL.
 */

const TOKENS = [
  '--color-logo-bar-low',
  '--color-logo-bar-mid',
  '--color-logo-bar-high',
  '--color-accent-jade'
] as const

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

/** `--name: #RRGGBB;` — anchored on the colon so `-jade` never matches `-jade-hover`. */
function hexFor(css: string, token: string): string | null {
  const m = new RegExp(`${token}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css)
  return m === null ? null : m[1].toLowerCase()
}

describe('the dictation overlay repeats main.css verbatim', () => {
  const appCss = read('../assets/main.css')
  const overlayHtml = read('./overlay.html')

  it.each(TOKENS)('%s matches the app stylesheet', (token) => {
    const source = hexFor(appCss, token)
    const copy = hexFor(overlayHtml, token)
    expect(source, `${token} is missing from assets/main.css`).not.toBeNull()
    expect(copy, `${token} is missing from voice/overlay.html`).not.toBeNull()
    expect(copy).toBe(source)
  })

  it('declares them on :root, where ChorusMark can inherit them', () => {
    const root = /:root\s*\{([^}]*)\}/.exec(overlayHtml)
    expect(root).not.toBeNull()
    for (const token of TOKENS) expect(root?.[1]).toContain(token)
  })
})
