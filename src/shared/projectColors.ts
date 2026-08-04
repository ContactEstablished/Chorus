/**
 * The curated project-colour palette, shared by MAIN (which assigns one to
 * every newly created project) and the RENDERER (which draws the swatch grid
 * on the project settings screen).
 *
 * ⚠ THIS FILE IS THE ONE PLACE THE PALETTE IS WRITTEN, and it holds literal
 * hex rather than `var(--color-…)` for a reason that is not a style slip: main
 * has no stylesheet. `getOrCreateProject` runs in the main process and must be
 * able to name a colour without a DOM, so a CSS custom property cannot be the
 * source. The renderer imports these same strings, so the swatch grid and the
 * auto-assignment can never drift apart.
 *
 * The five that open the list are the app's EXISTING accent/spine tokens, kept
 * byte-identical to their `main.css` values so a project can be given the exact
 * colour the rail already uses. The seven after them extend the same family —
 * mid-luminance, slightly desaturated, all legible as a 5px chip on
 * `--color-surface-rail` (#0B0D10).
 *
 * ⚠ APPEND ONLY. A stored `projects.color` is a raw hex string, not an index
 * into this array, so reordering breaks nothing — but a user who picked a
 * colour that later vanished from the grid would find their project showing a
 * colour they can no longer re-select.
 */
export const PROJECT_COLORS = [
  { name: 'Jade', hex: '#3BCFAE' },
  { name: 'Periwinkle', hex: '#7C8CF8' },
  { name: 'Violet', hex: '#B08CC9' },
  { name: 'Sand', hex: '#C9A97F' },
  { name: 'Blue', hex: '#5EA2E8' },
  { name: 'Teal', hex: '#4FBFD1' },
  { name: 'Lime', hex: '#9ECF6B' },
  { name: 'Amber', hex: '#E0A452' },
  { name: 'Coral', hex: '#E2796B' },
  { name: 'Rose', hex: '#DE7BA8' },
  { name: 'Magenta', hex: '#C77BE0' },
  { name: 'Slate', hex: '#8A97A6' }
] as const

/** The hex strings alone — the swatch grid wants the pairs, assignment wants
 *  only this. */
export const PROJECT_COLOR_HEXES: readonly string[] = PROJECT_COLORS.map((c) => c.hex)

/**
 * `#RRGGBB`, case-insensitive, and NOTHING ELSE.
 *
 * ⚠ THIS IS A SECURITY BOUNDARY, NOT A TIDINESS CHECK. A project's colour is
 * user-controlled text that the rail interpolates into an inline `style`
 * binding, so an unvalidated value is a CSS-injection primitive (`red;
 * background: url(…)` and worse). The IPC schema applies this regex on the way
 * in, which means the renderer can only ever read a string of this exact shape
 * back out of the database.
 *
 * The 3-digit form, `rgb()`, and named colours are all deliberately rejected:
 * every producer in the app (the swatch grid and `<input type="color">`) emits
 * the 6-digit form, so accepting more would only widen the surface.
 */
export const PROJECT_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

/**
 * The colour a newly created project gets, cycling the palette by how many
 * projects already exist.
 *
 * Deterministic and index-based, for the reason the rail's old `spineColor`
 * gave: it must never be derived from the NAME, or renaming a project would
 * move its colour. Cycling by count means the first twelve projects are all
 * visually distinct, which is the property that made the old index cycle worth
 * keeping.
 */
export function defaultProjectColor(existingCount: number): string {
  return PROJECT_COLORS[existingCount % PROJECT_COLORS.length].hex
}
