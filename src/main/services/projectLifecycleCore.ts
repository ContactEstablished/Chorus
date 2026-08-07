import type { ProjectStatus } from '../../shared/ipc'

/**
 * The pure half of the project lifecycle — main-process logic with no database
 * handle, so the suite can reach it.
 *
 * ⚠ THIS FILE EXISTS BECAUSE VITEST CANNOT IMPORT `storage.ts`. better-sqlite3
 * is built for the Electron ABI, so a plain `node` process cannot even load the
 * binding — the whole storage layer is unreachable from a test. The precedent
 * is `councilDocketCore.ts`: the rule that decides something lives here, where
 * it can be asserted, and the row-shuffling that applies it lives beside the
 * database.
 */

/** The minimum a successor decision needs to know about a project. Deliberately
 *  not `ProjectRecord` — this function must not be able to read a root path or
 *  a colour, because neither is allowed to influence the answer. */
export interface SuccessorCandidate {
  id: string
  status: ProjectStatus
}

/**
 * Which project becomes active when the current one is archived or deleted.
 *
 * ⚠ SOMETHING HAS TO DECIDE THIS, AND "NOTHING" IS THE WRONG ANSWER. Archiving
 * the project you are looking at leaves `active_project_id` naming a project
 * that can no longer be selected; leaving it there means the next boot resolves
 * an unusable project and the rail highlights a row that is not in it.
 *
 * The rule:
 *  - If the departing project is NOT the active one, the active one is
 *    untouched. Archiving something in the background must not move the user.
 *  - Otherwise the successor is the FIRST REMAINING ACTIVE project in RAIL
 *    ORDER — the candidates arrive in the order `listProjects()` returns, and
 *    "the top of the rail" is the one answer a user can predict by looking.
 *  - A `hidden` project is NOT a candidate even though it is perfectly usable.
 *    Being dropped into a project you deliberately tucked out of sight, with no
 *    row in the rail to explain where you are, is worse than landing nowhere.
 *  - `null` when nothing qualifies. Archiving your only project genuinely
 *    leaves no active one, and the empty rail says so honestly; inventing an
 *    archived successor would un-retire it by the back door.
 */
export function computeSuccessorActiveId(
  departingId: string,
  currentActiveId: string | null,
  candidates: readonly SuccessorCandidate[]
): string | null {
  if (currentActiveId !== departingId) return currentActiveId
  const next = candidates.find((c) => c.id !== departingId && c.status === 'active')
  return next ? next.id : null
}
