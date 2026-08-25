import { partitionRail, type RailProject } from './projectRail'

/**
 * The Ctrl+G project switcher's pure rules (D180) — which projects it offers, in what
 * order, and which digit each one answers to.
 *
 * ⚠ A `.ts` MODULE FOR THE SAME REASON `projectRail.ts` IS ONE: there are no
 * `.vue` tests in this repo and the vitest environment is `node`. The component
 * keeps the DOM and the key handling; the numbering — the one thing here that
 * can be silently WRONG rather than merely ugly — is asserted line by line.
 *
 * ─── WHY THIS EXISTS AT ALL ────────────────────────────────────────────────
 *
 * Project switching used to be N entries in the Ctrl+K palette ("Switch to
 * Chorus", "Switch to Trupanion", …), which had two costs. It drowned the
 * palette — nine of its thirteen rows were one command repeated — and it made
 * the most frequent action in the app a FUZZY SEARCH, so switching to a project
 * you switch to twenty times a day still meant reading a list. A numbered
 * surface turns that into a two-key gesture you stop looking at.
 */

/** One row of the switcher. */
export interface SwitcherRow {
  id: string
  name: string
  root_path: string
  /** 1-based position, matching the rail read top to bottom. */
  position: number
  /** `'1'`…`'9'`, or `null` past the ninth row — see `digitFor`. */
  digit: string | null
  /** The project you are already in. Listed, never switched to. */
  current: boolean
  /** Tucked behind the rail's disclosure (D122) — still switchable. */
  tucked: boolean
  sessionCount: number
  /** Straight through to `chipColorValue` — the switcher draws the rail's chip. */
  color: string | null
  color_seed: number
}

/** How many rows get a digit. Nine because there is no `0` row: a `0` would
 *  have to mean either "ten" or "the first", and both readings are defensible,
 *  which is exactly what a shortcut cannot afford. Row ten onward is reachable
 *  by arrow keys and by mouse, and says so by simply showing no keycap. */
export const MAX_DIGIT_ROWS = 9

function digitFor(index: number): string | null {
  return index < MAX_DIGIT_ROWS ? String(index + 1) : null
}

/**
 * Build the switcher's rows from the project list and the active project.
 *
 * ⚠ THE ORDER IS THE RAIL'S ORDER, AND THAT IS THE WHOLE CONTRACT. "Ctrl+G then
 * 2" has to mean the second row of the project panel or the numbers are noise;
 * so this partitions with `partitionRail` — the same function the rail draws
 * from — rather than re-deriving a rule that would drift the first time one of
 * them changed. Visible rows first, then whatever sits behind the disclosure,
 * which is the panel read top to bottom with everything expanded.
 *
 * ⚠ THE ACTIVE PROJECT KEEPS ITS ROW AND ITS NUMBER, and this is the one place
 * the switcher deliberately disagrees with the palette it replaces. The palette
 * DISABLED the active project's entry (`enabled: () => !p.active`) because in a
 * fuzzy list a row that does nothing is just clutter. Here, omitting it would
 * RENUMBER EVERY ROW BELOW IT — switch to project 3 and projects 4-9 all shift
 * up one, so the digit you learned yesterday lands somewhere else today. Stable
 * numbers are the entire value of the feature; a row that no-ops is the cheap
 * price of them. The component marks it "current" rather than pretending it is
 * a destination.
 *
 * ⚠ ARCHIVED PROJECTS ARE FILTERED, HIDDEN ONES ARE KEPT — inherited unchanged
 * from the palette entries this replaces (v15/D120/D122), reasons intact:
 * `project:select` REFUSES an archived project in main, so offering one would
 * be a command that can only fail; a hidden project is one you still work in,
 * and this surface is the fast way back to it.
 */
export function buildSwitcherRows(
  projects: readonly RailProject[],
  activeId: string | null
): SwitcherRow[] {
  const selectable = projects.filter((p) => p.status !== 'archived')
  const { visible, tucked } = partitionRail(selectable, activeId)

  const rows: SwitcherRow[] = []
  const push = (p: RailProject, isTucked: boolean): void => {
    rows.push({
      id: p.id,
      name: p.name,
      root_path: p.root_path,
      position: rows.length + 1,
      digit: digitFor(rows.length),
      current: p.id === activeId,
      tucked: isTucked,
      sessionCount: p.sessionCount,
      color: p.color,
      color_seed: p.color_seed
    })
  }
  for (const p of visible) push(p, false)
  for (const p of tucked) push(p, true)
  return rows
}

/**
 * The row a digit keystroke means, or `null` for anything that is not a live
 * row number.
 *
 * ⚠ IT TAKES THE RAW `KeyboardEvent.key`, NOT A PARSED NUMBER, so the component
 * has no arithmetic of its own to get wrong. `'0'` returns null (see
 * MAX_DIGIT_ROWS), and so does a digit past the end of a short list — pressing
 * `7` with four projects open must do NOTHING, not wrap and not clamp to the
 * last row. A shortcut that silently switches you somewhere you did not ask for
 * is worse than one that ignores you.
 */
export function rowForDigit(rows: readonly SwitcherRow[], key: string): SwitcherRow | null {
  if (!/^[1-9]$/.test(key)) return null
  return rows.find((r) => r.digit === key) ?? null
}
