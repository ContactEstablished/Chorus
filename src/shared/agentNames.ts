/**
 * The pool the launch dialog suggests a session's name from.
 *
 * ⚠ A SUGGESTION, NEVER AN ASSIGNMENT. The dialog prefills the field from this
 * list and the user overwrites it freely — nothing downstream re-derives a name
 * from here, and a session's name is whatever text arrived on the launch
 * payload. Clearing the field is legal too: an unnamed session renders exactly
 * as every session did before names existed.
 *
 * Short, plain, unmistakably first names — the point is that "Claude Code —
 * Bob" and "Claude Code — Ruth" are told apart at a glance in a rail of eight
 * identical agent labels. Deliberately a mixed list rather than two gendered
 * ones: nothing picks by gender, so a split would be structure with no
 * consumer.
 */
export const AGENT_NAMES: readonly string[] = [
  'Bob',
  'Mae',
  'Frank',
  'Ruth',
  'Hank',
  'June',
  'Walt',
  'Pearl',
  'Gus',
  'Nell',
  'Ray',
  'Hazel',
  'Earl',
  'Faye',
  'Vince',
  'Lois',
  'Otis',
  'Vera',
  'Dale',
  'Rita',
  'Roy',
  'Wanda',
  'Chuck',
  'Marge',
  'Stan',
  'Gail',
  'Marty',
  'Joan',
  'Gene',
  'Sue',
  'Duke',
  'Edna',
  'Wade',
  'Ida',
  'Cal',
  'Dot',
  'Rex',
  'Peg',
  'Buck',
  'Bea'
]

/**
 * Suggest a name that is not already in use in this project.
 *
 * ⚠ THE EXHAUSTED POOL FALLS BACK TO THE WHOLE LIST rather than returning
 * null or inventing "Bob 2". A project with forty live sessions is far past the
 * pane cap, so this branch is unreachable in practice — but "no suggestion" and
 * "a machine-made name" are both worse than a repeat the user can simply type
 * over, and the field is editable precisely so the suggestion never has to be
 * right.
 *
 * `random` is injectable so the choice is testable; callers pass nothing.
 */
export function suggestAgentName(
  taken: readonly string[],
  random: () => number = Math.random
): string {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()).filter((n) => n.length > 0))
  const free = AGENT_NAMES.filter((n) => !used.has(n.toLowerCase()))
  const pool = free.length > 0 ? free : AGENT_NAMES
  return pool[Math.min(Math.floor(random() * pool.length), pool.length - 1)]
}
