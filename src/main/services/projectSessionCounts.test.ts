import { describe, expect, it } from 'vitest'
import { countSessionsHeldByProject, type StoredLayout } from './projectSessionCounts'

// The rail's "N sessions". Every case here is a shape the installed database
// was measured holding on 2026-08-23, not an invented one — see the module
// header for the reading that produced them.
//
// ⚠ Nothing here imports storage.ts: better-sqlite3 is built for the Electron
// ABI and cannot load under plain-node vitest (vitest.config.ts).

/** One project's layout, written the way `pane_layouts.layout_json` holds it. */
function layout(projectId: string, ...sessionIds: string[]): StoredLayout {
  const leaves = sessionIds.map((sessionId) => ({ type: 'leaf', sessionId }))
  const root =
    leaves.length === 1 ? leaves[0] : { type: 'row', ratio: 0.5, children: leaves.slice(0, 2) }
  return { projectId, layoutJson: JSON.stringify({ version: 1, root }) }
}

function rows(entries: Record<string, string[]>): Map<string, Set<string>> {
  return new Map(Object.entries(entries).map(([p, ids]) => [p, new Set(ids)]))
}

describe('countSessionsHeldByProject — panes, not rows', () => {
  it('counts the leaves that have a session row behind them', () => {
    const counts = countSessionsHeldByProject(
      [layout('proj-1', 'sess-a', 'sess-b')],
      rows({ 'proj-1': ['sess-a', 'sess-b'] })
    )
    expect(counts.get('proj-1')).toBe(2)
  })

  it('⚠ IGNORES A ROW WITH NO LEAF — the bug this replaced, in its measured shape', () => {
    // The Chorus project on the installed 0.7.5 database: two live panes, plus
    // two rows healed to 'exited' weeks earlier that no leaf references. The
    // `GROUP BY` this function replaced answered 4; the rail said "4 sessions"
    // over two panes, and no gesture the user had could ever clear the other two.
    const counts = countSessionsHeldByProject(
      [layout('proj-1', 'sess-live-1', 'sess-live-2')],
      rows({ 'proj-1': ['sess-live-1', 'sess-live-2', 'sess-dead-aug-08', 'sess-dead-aug-18'] })
    )
    expect(counts.get('proj-1')).toBe(2)
  })

  it('⚠ IGNORES A LEAF WITH NO ROW — a placeholder pane is not a session', () => {
    // `computeRestoreSet.missingRows`, and it exists in the wild: one project on
    // the same database holds a leaf whose session row is long gone.
    const counts = countSessionsHeldByProject(
      [layout('proj-1', 'sess-gone')],
      rows({ 'proj-1': ['sess-other'] })
    )
    expect(counts.has('proj-1')).toBe(false)
  })

  it('counts an EXITED pane, because status is not an input', () => {
    // The number describes what the project holds, so it must not flicker every
    // time an agent finishes its turn — `project:list` is only refetched when a
    // pane is added or removed.
    const counts = countSessionsHeldByProject(
      [layout('proj-1', 'sess-a')],
      rows({ 'proj-1': ['sess-a'] })
    )
    expect(counts.get('proj-1')).toBe(1)
  })

  it('is ABSENT rather than zero when a project holds nothing', () => {
    // The standing contract of this map (and of `rollUpAttention`): the caller's
    // `?? 0` turns "nothing to report" into a number.
    const counts = countSessionsHeldByProject(
      [layout('proj-1', 'sess-gone')],
      rows({ 'proj-1': [], 'proj-2': ['sess-x'] })
    )
    expect(counts.size).toBe(0)
  })

  it('a project with rows but no layout row at all is absent, not a crash', () => {
    expect(countSessionsHeldByProject([], rows({ 'proj-1': ['sess-a'] })).size).toBe(0)
  })

  it('a corrupt layout column costs THAT project its count and nothing else', () => {
    const counts = countSessionsHeldByProject(
      [{ projectId: 'proj-1', layoutJson: 'not json{' }, layout('proj-2', 'sess-b')],
      rows({ 'proj-1': ['sess-a'], 'proj-2': ['sess-b'] })
    )
    expect(counts.has('proj-1')).toBe(false)
    expect(counts.get('proj-2')).toBe(1)
  })

  it('a pre-v1 (legacy flat) layout reads as zero rather than being repaired here', () => {
    // ⚠ THE POINT IS THE ABSENCE OF A SIDE EFFECT. `storage.getPaneLayout`
    // converts this shape, and conversion calls `findOrCreateSession` — it
    // INSERTS. A list read that draws a number in the rail must never write, so
    // the repair is left to the reader that runs when the project is opened.
    const counts = countSessionsHeldByProject(
      [{ projectId: 'proj-1', layoutJson: JSON.stringify([{ agent: 'claude' }]) }],
      rows({ 'proj-1': ['sess-a'] })
    )
    expect(counts.has('proj-1')).toBe(false)
  })

  it('counts each project independently', () => {
    const counts = countSessionsHeldByProject(
      [layout('proj-1', 'a1', 'a2'), layout('proj-2', 'b1')],
      rows({ 'proj-1': ['a1', 'a2'], 'proj-2': ['b1'] })
    )
    expect([...counts.entries()].sort()).toEqual([
      ['proj-1', 2],
      ['proj-2', 1]
    ])
  })

  it('does not count another project’s session id, even when a leaf names it', () => {
    // Ids are matched WITHIN the project, so a stray cross-project leaf cannot
    // inflate a neighbour's count.
    const counts = countSessionsHeldByProject(
      [layout('proj-1', 'sess-belongs-to-2')],
      rows({ 'proj-1': ['sess-a'], 'proj-2': ['sess-belongs-to-2'] })
    )
    expect(counts.has('proj-1')).toBe(false)
  })
})
