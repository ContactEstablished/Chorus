import { layoutJsonSchema } from '../../shared/ipc'
import { collectSessionIds } from '../../shared/layout'

/**
 * The rail's per-project session count, factored PURE so Vitest covers it
 * without SQLite — the house pattern of `restore.ts`'s `computeRestoreSet`,
 * `attentionRollup.ts` and `turnsCore.ts`, and here it is not optional:
 * `vitest.config.ts` states that no test may import `storage.ts` at all,
 * because better-sqlite3 is built for the Electron ABI. Logic left inside the
 * accessor is logic with no test.
 *
 * ─── WHAT THE NUMBER MEANS, AND WHAT IT USED TO MEAN ──────────────────────
 * "3 sessions" under a project in the rail means THREE PANES THE USER CAN GO
 * AND LOOK AT. It used to mean `SELECT count(*) … GROUP BY project_id`, which
 * is a different and much larger quantity, because `sessions` is append-mostly:
 * closing a pane deletes its row (D16 resolution d), but a session that merely
 * EXITED keeps its row forever — the agent quit, the app was killed, or
 * `SessionManager.restore` healed a 'running' row that had no layout leaf. Those
 * rows must stay: `dispatches`, `agent_turns` and `attention_spans` are keyed on
 * session ids that have to remain resolvable.
 *
 * Measured on the installed 0.7.5 database, 2026-08-23: the Chorus project
 * reported **4 sessions against 2 open panes** — two live, plus two rows healed
 * to 'exited' weeks earlier that no pane references and no gesture can clear.
 * The count was not stale; it was counting the wrong thing.
 *
 * ─── THE TWO POPULATIONS THIS EXCLUDES ────────────────────────────────────
 * It is `leaves ∩ rows`, the same intersection `computeRestoreSet` calls
 * `toRelaunch`, and it drops exactly what that intersection drops:
 *  · A ROW WITH NO LEAF — invisible, and unclosable by any gesture the user
 *    has. Counting it describes work the rail cannot lead them to.
 *  · A LEAF WITH NO ROW — `computeRestoreSet.missingRows`: a placeholder pane
 *    with no session behind it. It is a pane, but it is not a session.
 *
 * ⚠ STATUS IS DELIBERATELY NOT AN INPUT. A pane whose agent has exited still
 * counts, because the project still holds it and the user can restart it in
 * place. That also keeps the number STILL: it moves when a pane is added or
 * removed and at no other time, which is exactly when `App.vue` refetches
 * `project:list`. A count keyed on liveness would drift out of date every time
 * an agent finished, on a channel that is only refetched on pane changes.
 */

/** One row of `pane_layouts`, as stored. */
export interface StoredLayout {
  projectId: string
  /** The RAW column. Parsing is this module's job — see `leafSessionIds`. */
  layoutJson: string
}

export function countSessionsHeldByProject(
  layouts: readonly StoredLayout[],
  sessionIdsByProject: ReadonlyMap<string, ReadonlySet<string>>
): Map<string, number> {
  const out = new Map<string, number>()
  for (const layout of layouts) {
    const ids = sessionIdsByProject.get(layout.projectId)
    if (!ids) continue
    let held = 0
    for (const sessionId of leafSessionIds(layout.layoutJson)) {
      if (ids.has(sessionId)) held += 1
    }
    // ⚠ ABSENT, NOT ZERO, matching `countSessionsByProject`'s standing contract
    // and `rollUpAttention`'s: the caller's `?? 0` is what turns "nothing to
    // report" into a number, and a map that answers for every project would
    // make a later "did this project have any?" read impossible to write.
    if (held > 0) out.set(layout.projectId, held)
  }
  return out
}

/**
 * The leaf session ids of one stored layout, or NONE for any shape this build
 * does not recognise.
 *
 * ⚠ IT REFUSES RATHER THAN REPAIRS, and that is the difference between this
 * and `storage.getPaneLayout`. That reader CONVERTS a legacy flat layout, and
 * conversion calls `findOrCreateSession` — it can INSERT ROWS. Drawing a number
 * in the rail must never write to the database, so an unparseable or
 * pre-v1 layout reads as zero leaves here and is repaired by the real reader
 * when the project is next opened. The cost is one boot's understatement on a
 * shape that predates v1; the alternative is a list read with a side effect.
 */
function leafSessionIds(layoutJson: string): string[] {
  let raw: unknown
  try {
    raw = JSON.parse(layoutJson)
  } catch {
    // A layout column that is not JSON is corruption, not a shape — and a
    // corrupt row must cost this project its count, never the whole list.
    return []
  }
  const parsed = layoutJsonSchema.safeParse(raw)
  if (!parsed.success) return []
  return collectSessionIds(parsed.data.root)
}
