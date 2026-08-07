/**
 * The one resolution of "what colour is this project's chip", shared by the
 * project rail (which draws it) and the project settings screen (which has to
 * open its picker on the SAME colour).
 *
 * ⚠ THIS EXISTS BECAUSE THE TWO SURFACES DISAGREED. A project created before
 * migration v13 has `color === null`, and the rail renders those from an index
 * cycle over three CSS tokens. The settings screen originally seeded its picker
 * from the first palette entry instead, so opening settings on a violet project
 * showed jade as "selected" — the screen contradicting the rail two inches to
 * its left. One function now answers the question for both.
 */
import { PROJECT_COLORS, PROJECT_COLOR_PATTERN } from '../../shared/projectColors'

/**
 * The pre-v13 fallback cycle, by STORED SEED — deterministically, and
 * explicitly not by hashing the name, so renaming a project never moves its
 * colour.
 *
 * ⚠ CUSTOM-PROPERTY NAMES, NOT HEX. `main.css` stays the authority on what
 * these three colours are; duplicating their values here would be a second
 * source that drifts the first time one is retuned.
 */
export const SPINE_VARS = [
  '--color-spine-violet',
  '--color-spine-sand',
  '--color-spine-blue'
] as const

/**
 * For CSS: the stored colour, or the `var(...)` the rail has always drawn.
 *
 * ⚠ `seed` IS `project.color_seed`, AND IT USED TO BE THE RAIL'S LOOP INDEX.
 * That was correct only while the rail rendered every project, in creation
 * order, always — which it did until v15. The moment it PARTITIONS (hidden and
 * archived out of the main list) or REORDERS, a loop index is a position in a
 * sub-array, and every project with `color === null` repaints: hide the first
 * project and the two below it each take the colour of the one above.
 *
 * `color_seed` is that same index, fixed at migration time and never moved
 * again, so a pre-v13 project's colour now survives everything the rail can do
 * to the list. Do not re-introduce a positional argument here.
 */
export function chipColorValue(color: string | null, seed: number): string {
  return color ?? `var(${SPINE_VARS[seed % SPINE_VARS.length]})`
}

/**
 * For `<input type="color">`, which accepts only a literal `#rrggbb` and
 * silently falls back to BLACK on anything else — a `var(...)` handed to it
 * would look like a deliberate choice of black rather than a bug. So the
 * fallback token is resolved against the live document into real hex.
 *
 * ⚠ TOTAL BY CONSTRUCTION. If the custom property is missing or is not a
 * 6-digit hex (a themed build could define it some other way), this returns
 * the first palette colour rather than null: every caller would have to invent
 * the same fallback, and one of them would forget.
 *
 * ⚠ THE SECOND HALF OF THE SAME DECOUPLING, AND IT IS EASY TO MISS. This
 * function cycles the SAME array on the SAME rule as `chipColorValue` above,
 * and it is what the settings screen's colour picker opens on. Re-parameterise
 * one and not the other and the picker keeps opening on a colour the rail no
 * longer draws — which is the exact contradiction this whole file was created
 * to end (see the header).
 */
export function resolveChipHex(color: string | null, seed: number): string {
  if (color) return color
  const name = SPINE_VARS[seed % SPINE_VARS.length]
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return PROJECT_COLOR_PATTERN.test(raw) ? raw : PROJECT_COLORS[0].hex
}
