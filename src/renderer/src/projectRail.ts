import type { ProjectsList } from '../../shared/ipc'

/**
 * The project rail's pure rules — what is shown, what is tucked away, and (from
 * Task 3) how a reorder moves a row.
 *
 * ⚠ A `.ts` MODULE RATHER THAN LOGIC IN `ProjectRail.vue`, AND THAT IS THE ONLY
 * REASON IT EXISTS. THERE ARE NO `.vue` TESTS IN THIS REPO — none, not one —
 * and the vitest environment is `node`. A partition rule written in a computed
 * property is a rule nothing checks; written here it is asserted line by line.
 * The precedent is `projectChip.ts`, which was extracted for exactly this after
 * two surfaces disagreed about a colour.
 *
 * The component keeps the DOM and the pointer bookkeeping. Everything that
 * DECIDES something lives here.
 */

/** One rail row. Structurally a `ProjectsList` entry; typed by what these
 *  functions actually read, so a test fixture need not invent a whole project
 *  row to assert an ordering rule. */
export type RailProject = ProjectsList[number]

export interface RailPartition {
  /** Drawn in the rail proper, in the order given. */
  visible: RailProject[]
  /** Behind the collapsed disclosure at the foot (D122), in the order given. */
  tucked: RailProject[]
}

/**
 * Split the rail into what is shown and what is tucked away.
 *
 * ⚠ THE SECOND CLAUSE IS LOAD-BEARING: `status === 'active' || p.id === activeId`.
 * A HIDDEN PROJECT MAY BE THE ACTIVE ONE — hiding is cosmetic and does not
 * change which project you are working in, and `project:select` accepts a
 * hidden project on purpose (the palette keeps offering them). Without the
 * second clause you would be staring at a workspace full of panes whose project
 * is not in the rail at all, with the rail highlighting nothing. The row stays,
 * and it is the honest thing to draw.
 *
 * An ARCHIVED project can never satisfy the second clause in practice — main
 * refuses to select one and reassigns the active pointer when you archive the
 * one you are in — but the rule is written as "or it is active" rather than "or
 * it is hidden and active" because the invariant being protected is *the active
 * project is always visible*, not a fact about hiding.
 *
 * Order is preserved from the input, which arrives already in rail order from
 * main. This function never sorts: position is main's authority (`sort_order`),
 * and a second one here would disagree the first time a reorder raced a list
 * refresh.
 */
export function partitionRail(
  projects: readonly RailProject[],
  activeId: string | null
): RailPartition {
  const visible: RailProject[] = []
  const tucked: RailProject[] = []
  for (const p of projects) {
    if (p.status === 'active' || p.id === activeId) visible.push(p)
    else tucked.push(p)
  }
  return { visible, tucked }
}

/**
 * The disclosure's label — `Hidden (2)`, `Archived (3)`, `Tucked away (5)`.
 *
 * ⚠ IT NAMES THE KIND WHEN THERE IS ONLY ONE KIND, AND GENERALISES WHEN THERE
 * ARE TWO. "Archived (3)" tells the user what they are looking at; "Tucked away
 * (3)" for a mixed list is vaguer but true, and the alternative — two separate
 * disclosures — would put two collapsed rows at the foot of a 208px rail to
 * save a word.
 *
 * ⚠ AND THE COUNT IS ALWAYS THERE (D122). A disclosure that said only "Archived"
 * would be a control the user has no reason to open. The number is what makes
 * "nothing silently vanishes" a promise the rail visibly keeps: whatever is not
 * above is counted below.
 */
export function tuckedLabel(tucked: readonly RailProject[]): string {
  const hidden = tucked.filter((p) => p.status === 'hidden').length
  const archived = tucked.filter((p) => p.status === 'archived').length
  if (archived === 0 && hidden === 0) return ''
  if (archived === 0) return `Hidden (${hidden})`
  if (hidden === 0) return `Archived (${archived})`
  return `Tucked away (${hidden + archived})`
}

/**
 * Move the item at `from` to `to`, returning a NEW array.
 *
 * ⚠ A FRESH PLAIN ARRAY, NEVER A MUTATION (D14). The caller's list is a Pinia
 * array — a Vue Proxy — and the result of this is what ends up crossing the IPC
 * bridge, where a Proxy throws "An object could not be cloned" at runtime with
 * no compile-time signal. Building a new array here is half of that defence;
 * the caller mapping it to a fresh `string[]` is the other half.
 *
 * Out-of-range indices return a copy unchanged rather than throwing: the
 * callers are a drag that can end anywhere and an Alt+Arrow at the ends of the
 * list, and "nothing moved" is the correct answer to both.
 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const out = [...items]
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out
  const [moved] = out.splice(from, 1)
  out.splice(to, 0, moved)
  return out
}

/**
 * Translate a position among the VISIBLE rows into a position in the FULL list.
 *
 * ⚠ THIS IS THE FUNCTION THAT KEEPS A REORDER FROM SCRAMBLING TUCKED PROJECTS.
 * The user drags within the visible rows, but `project:reorder` takes EVERY
 * project id — so a visible index has to be resolved against the full list
 * before anything is written. Dropping the third visible row when a hidden
 * project sits second means position 3 in the full list, not position 2, and
 * getting that wrong silently reorders projects the user cannot even see.
 *
 * Returns the full-list index of the nth visible project, or `-1` when there is
 * no such row.
 */
export function visibleIndexToFullIndex(
  projects: readonly RailProject[],
  activeId: string | null,
  visibleIndex: number
): number {
  if (visibleIndex < 0) return -1
  let seen = 0
  for (let i = 0; i < projects.length; i++) {
    const p = projects[i]
    if (p.status !== 'active' && p.id !== activeId) continue
    if (seen === visibleIndex) return i
    seen++
  }
  return -1
}
