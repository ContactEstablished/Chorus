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

/** Longest address Chorus will publish. The CLI truncates and suffixes names of
 *  its own accord when they collide; a shorter cap keeps our contribution
 *  readable in a peer's `ListAgents` listing and well inside anything the CLI
 *  might do to it. */
export const MAX_PEER_ADDRESS_LENGTH = 32

/**
 * Convert a session's authored name into an address safe to publish as
 * `claude -n <address>`, or `null` when nothing usable survives.
 *
 * ⚠ THIS IS USER TEXT ON ITS WAY TO ARGV, WHICH IS WHY IT IS NARROWED RATHER
 * THAN ESCAPED. `sessions.name` is a free-text field — a user can type
 * "Bug Fix: Missing Color", quotes, or a stray backslash — and a claude launch
 * may still be resolved through `cmd.exe /c` on the shim fallback path (D176),
 * where quote state is a real defect surface: F96 was every codex launch dying
 * on exactly that. An allow-list of `[A-Za-z0-9._-]` cannot express a quote, a
 * space, a caret or a redirect, so no quoting rule has to be correct.
 *
 * ⚠ AND IT IS DELIBERATELY LOSSY. The address is not the display name and is
 * never stored — `sessions.name` keeps whatever the user typed, the rail keeps
 * showing it, and this value exists only for the duration of one argv. When the
 * two differ, the registry's own name is the address (spec §6.1), which is why
 * losing "Bug Fix: Missing Color" down to "Bug-Fix-Missing-Color" costs nothing
 * that is depended on.
 *
 * Returning `null` — for an empty name, or one made entirely of characters that
 * do not survive — means the flag is omitted and the CLI derives its own name,
 * which is exactly today's behaviour.
 */
export function toPeerAddress(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null
  const collapsed = name
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-._]+/, '')
    .replace(/[-._]+$/, '')
  if (collapsed.length === 0) return null
  // Trim to the cap, then re-strip a separator the cut may have exposed.
  return collapsed.slice(0, MAX_PEER_ADDRESS_LENGTH).replace(/[-._]+$/, '') || null
}
