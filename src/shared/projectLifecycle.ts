/**
 * The project lifecycle's user-facing wording (D120–D124), shared because the
 * renderer shows it and it must be testable without a browser.
 *
 * ⚠ NOT ASSEMBLED IN THE VIEW, and the reason is `councilDocket.ts`'s, restated
 * because it applies here with more force. That file says: the whole point of
 * D109 is that the user is told the size of what they are about to delete
 * BEFORE they delete it, and interpolating that sentence into a template in a
 * `.vue` file would make "the one sentence that has to be right the one
 * sentence nothing checks." This repo has NO `.vue` tests at all, so a sentence
 * built in a template is not merely under-tested — it is unreachable by the
 * suite. Everything below is a pure function over plain numbers, and every
 * clause of it is asserted in `projectLifecycle.test.ts`.
 *
 * ⚠ THE PLURALS ARE HAND-WRITTEN RATHER THAN `n + ' session' + (n===1?'':'s')`
 * INLINE, for the reason D76 gives about zeroes: the wording is a fact the user
 * reads, and a fact worth stating is worth stating correctly. "1 sessions" in a
 * confirmation dialog undermines every other number beside it.
 */

/** The counts a delete confirmation is built from — `project:impact`'s payload
 *  minus the fields the sentence does not speak (`live_sessions` is a refusal,
 *  not a size, and is reported separately). */
export interface ProjectImpactCounts {
  sessions: number
  worktrees: number
  councilRuns: number
  transcriptTurns: number
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`
}

/**
 * Join clauses the way a person would: "a, b and c" — never a bare comma list,
 * and never a trailing "and" on a single item.
 */
function joinClauses(parts: string[]): string {
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * Build the list of non-zero counts.
 *
 * ⚠ ZERO CLAUSES ARE OMITTED, NOT PRINTED AS "0 sessions" (D76). A zero here is
 * not a fact the user needs — it is noise that makes the real numbers harder to
 * find, and four of them ("0 sessions, 0 worktrees, 0 council runs and 0
 * transcript turns") would bury the one number that matters in a dialog whose
 * entire job is to state it.
 */
function impactClauses(counts: ProjectImpactCounts): string[] {
  const parts: string[] = []
  if (counts.sessions > 0) parts.push(plural(counts.sessions, 'session', 'sessions'))
  if (counts.worktrees > 0) parts.push(plural(counts.worktrees, 'worktree', 'worktrees'))
  if (counts.councilRuns > 0) {
    parts.push(plural(counts.councilRuns, 'council run', 'council runs'))
  }
  if (counts.transcriptTurns > 0) {
    parts.push(plural(counts.transcriptTurns, 'transcript turn', 'transcript turns'))
  }
  return parts
}

/**
 * What deleting a project takes, and what it leaves — stated before it happens.
 *
 * The contract, clause by clause:
 *  1. NAME THE PROJECT. A confirmation that says "this project" is one the user
 *     cannot check against what they clicked.
 *  2. STATE EVERY NON-ZERO COUNT, with correct plurals; omit the zeroes.
 *  3. SAY WHAT SURVIVES, IN ITS OWN SENTENCE — the folder on disk (D121) and
 *     the worktree folders Chorus stops tracking (D124). This is the clause the
 *     whole file exists for: "delete project" is a phrase a reasonable person
 *     reads as "delete my work", and only saying otherwise fixes that.
 *  4. STATE IRREVERSIBILITY.
 */
export function describeProjectDeletion(name: string, counts: ProjectImpactCounts): string {
  const clauses = impactClauses(counts)
  // A project with nothing recorded against it still gets an honest first
  // sentence. "It removes nothing else" is true, checkable, and better than a
  // sentence that lists an empty set.
  const takes =
    clauses.length > 0
      ? `Deleting ${name} removes ${joinClauses(clauses)} from Chorus's database.`
      : `Deleting ${name} removes it from Chorus's database. It has nothing else recorded against it.`

  // ⚠ THE SURVIVAL SENTENCE IS SEPARATE, NOT A TRAILING CLAUSE. It is the one
  // the user most needs to read, and a subordinate clause at the end of a
  // sentence about deletion is the part that gets skimmed.
  const survives =
    counts.worktrees > 0
      ? `Your project folder is left exactly as it is, and so are the ${counts.worktrees === 1 ? 'worktree folder and branch' : `${counts.worktrees} worktree folders and branches`} on disk — Chorus simply stops tracking them.`
      : 'Your project folder on disk is left exactly as it is.'

  return `${takes} ${survives} This cannot be undone.`
}

/**
 * What archiving does — and the part that surprises people, which is that it
 * stops things that are currently running.
 *
 * ⚠ IT NAMES THE LIVE SESSION COUNT BECAUSE ARCHIVE IS THE ONE REVERSIBLE
 * ACTION WITH AN IRREVERSIBLE SIDE EFFECT. The status flips back on request;
 * the agents that were stopped do not come back with it, and an agent
 * mid-thought is work the user may not be able to reconstruct.
 */
export function describeArchive(name: string, liveSessions: number): string {
  const stops =
    liveSessions > 0
      ? ` It stops ${plural(liveSessions, 'running agent', 'running agents')}.`
      : ''
  return (
    `Archive ${name}? It leaves the rail, cannot be launched into or councilled, ` +
    `and its sessions will not come back at startup.${stops} ` +
    `Everything it has recorded is kept and stays readable, and you can unarchive it at any time.`
  )
}

/**
 * What hiding does — which is nothing, and saying so is the point.
 *
 * ⚠ THE CONTRAST WITH ARCHIVE IS THE WHOLE SENTENCE. Two controls sitting next
 * to each other, one of which stops the user's agents and one of which does
 * not, is exactly the pair a person picks wrongly. Naming what hide does NOT do
 * is what makes the choice legible.
 */
export function describeHide(name: string): string {
  return (
    `Hide ${name}? It moves out of the rail into Hidden, and nothing else changes — ` +
    `its agents keep running, they still come back at startup, and it stays in the ` +
    `command palette. You can unhide it at any time.`
  )
}
