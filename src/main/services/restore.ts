import { collectSessionIds, type LayoutJson } from '../../shared/layout'

/**
 * The D16 restore-set computation as a PURE function (no Electron, no fs, no
 * DB — Vitest covers it without spawning). Generic over a minimal row shape so
 * the module never imports the Drizzle schema: storage's SessionRow satisfies
 * RestoreCandidate structurally.
 *
 * Populations (contract clauses 1–2):
 *  - toRelaunch: row says 'running' AND a layout leaf references it AND the
 *    manager has no live PTY for it this run (the lazy re-activation guard).
 *  - toHeal:     row says 'running', no live PTY, and NO leaf references it —
 *    the invisible-process guard; healed to 'exited' before any spawn.
 *  - missingRows: leaf sessionIds with no sessions row at all (renderer
 *    placeholder territory; main has nothing to do for them).
 *
 * F6: a persisted 'running' row means "was running when last observed", never
 * "is alive" — that is why row status alone never qualifies a relaunch.
 */
export interface RestoreCandidate {
  id: string
  status: string
}

export interface RestoreSet<T extends RestoreCandidate> {
  toRelaunch: T[]
  toHeal: T[]
  missingRows: string[]
}

export function computeRestoreSet<T extends RestoreCandidate>(
  layout: LayoutJson | null,
  rows: T[],
  live: Set<string>
): RestoreSet<T> {
  const leafIds = new Set<string>(layout ? collectSessionIds(layout.root) : [])
  const rowIds = new Set<string>(rows.map((r) => r.id))

  const toRelaunch: T[] = []
  const toHeal: T[] = []
  for (const row of rows) {
    if (row.status !== 'running') continue
    // Already live in this app run: never relaunch and never heal — the
    // manager's map is the sole liveness authority within a run (D15).
    if (live.has(row.id)) continue
    if (leafIds.has(row.id)) {
      toRelaunch.push(row)
    } else {
      toHeal.push(row)
    }
  }

  const missingRows: string[] = []
  for (const id of leafIds) {
    if (!rowIds.has(id)) missingRows.push(id)
  }

  return { toRelaunch, toHeal, missingRows }
}
