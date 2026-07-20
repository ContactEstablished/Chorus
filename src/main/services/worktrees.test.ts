import { describe, it, expect } from 'vitest'
import {
  computeWorktreeReconcile,
  shortIdFrom,
  worktreeRootFor,
  worktreePathFor,
  branchFor,
  type WorktreeReconcileRow,
  type WorktreeReconcileAction
} from './worktrees'
import { parseWorktreePorcelain } from './git'

// computeWorktreeReconcile is the heart of the D26 boot reconcile (spec §6's
// evidence matrix is normative): evidence first (git entry × directory),
// journal status second. Pure: no Electron, no fs, no DB, no git.

const REPO = 'C:\\Source\\Bryk'
const ROOT = 'C:\\Source\\.chorus\\Bryk' // managed root for REPO
const WT = (short: string): string => `${ROOT}\\wt-${short}`

const row = (
  id: string,
  status: string,
  opts: { sessionId?: string | null; path?: string } = {}
): WorktreeReconcileRow => ({
  id,
  status,
  sessionId: opts.sessionId ?? null,
  path: opts.path ?? WT(id)
})

interface TestEntry {
  path: string
  branch: string | null
}

// Git emits forward-slash paths on Windows; fwd() keeps tests honest about
// the separator mix the manager hands the core.
const fwd = (p: string): string => p.replace(/\\/g, '/')
const entry = (path: string, branch: string | null = 'chorus/Bryk/x'): TestEntry => ({
  path: fwd(path),
  branch
})

const types = (actions: WorktreeReconcileAction[]): string[] => actions.map((a) => a.type)

const ofType = <T extends WorktreeReconcileAction['type']>(
  actions: WorktreeReconcileAction[],
  type: T
): Extract<WorktreeReconcileAction, { type: T }>[] =>
  actions.filter((a): a is Extract<WorktreeReconcileAction, { type: T }> => a.type === type)

describe('computeWorktreeReconcile — evidence matrix rows', () => {
  it('P1a: active/detached row + entry + dir → none (healthy)', () => {
    const rows = [row('a1b2c3d4', 'active'), row('e5f67890', 'detached')]
    const entries = [entry(WT('a1b2c3d4')), entry(WT('e5f67890'))]
    const dirs = [WT('a1b2c3d4'), WT('e5f67890')]
    const actions = computeWorktreeReconcile(REPO, rows, entries, dirs, new Set())
    expect(actions).toEqual([
      { type: 'none', id: 'a1b2c3d4' },
      { type: 'none', id: 'e5f67890' }
    ])
  })

  it('P1b: journal row + entry + dir → promote (b)', () => {
    const rows = [row('a1b2c3d4', 'creating', { sessionId: 's1' })]
    const actions = computeWorktreeReconcile(
      REPO,
      rows,
      [entry(WT('a1b2c3d4'))],
      [WT('a1b2c3d4')],
      new Set(['s1'])
    )
    expect(actions).toEqual([{ type: 'promote', id: 'a1b2c3d4', to: 'active' }])
  })

  it('P1c: removing row + entry + dir → detach, surfaced (e)', () => {
    const rows = [row('a1b2c3d4', 'removing')]
    const actions = computeWorktreeReconcile(
      REPO,
      rows,
      [entry(WT('a1b2c3d4'))],
      [WT('a1b2c3d4')],
      new Set()
    )
    expect(actions).toEqual([{ type: 'detach', id: 'a1b2c3d4', surface: true }])
  })

  it('P2a: active/detached row + entry, dir gone → surface-prune', () => {
    const rows = [row('a1b2c3d4', 'active'), row('e5f67890', 'detached')]
    const entries = [entry(WT('a1b2c3d4')), entry(WT('e5f67890'))]
    const actions = computeWorktreeReconcile(REPO, rows, entries, [], new Set())
    expect(actions).toEqual([
      { type: 'surface-prune', id: 'a1b2c3d4' },
      { type: 'surface-prune', id: 'e5f67890' }
    ])
  })

  it('P2b: journal row + entry, dir gone → surface-prune', () => {
    for (const status of ['creating', 'provisioning']) {
      const actions = computeWorktreeReconcile(
        REPO,
        [row('a1b2c3d4', status)],
        [entry(WT('a1b2c3d4'))],
        [],
        new Set()
      )
      expect(actions).toEqual([{ type: 'surface-prune', id: 'a1b2c3d4' }])
    }
  })

  it('P2c: removing row + entry, dir gone → detach, surfaced (e)', () => {
    const actions = computeWorktreeReconcile(
      REPO,
      [row('a1b2c3d4', 'removing')],
      [entry(WT('a1b2c3d4'))],
      [],
      new Set()
    )
    expect(actions).toEqual([{ type: 'detach', id: 'a1b2c3d4', surface: true }])
  })

  it('P3a: active row, no entry, dir present → detach, surfaced; already-detached converges to none', () => {
    const dirs = [WT('a1b2c3d4'), WT('e5f67890')]
    const actions = computeWorktreeReconcile(
      REPO,
      [row('a1b2c3d4', 'active'), row('e5f67890', 'detached')],
      [],
      dirs,
      new Set()
    )
    expect(actions).toEqual([
      { type: 'detach', id: 'a1b2c3d4', surface: true },
      { type: 'none', id: 'e5f67890' }
    ])
  })

  it('P3b: active row, no entry, no dir → detach, surfaced; already-detached converges to none', () => {
    const actions = computeWorktreeReconcile(
      REPO,
      [row('a1b2c3d4', 'active'), row('e5f67890', 'detached')],
      [],
      [],
      new Set()
    )
    expect(actions).toEqual([
      { type: 'detach', id: 'a1b2c3d4', surface: true },
      { type: 'none', id: 'e5f67890' }
    ])
  })

  it('P3c: journal row with no entry and no dir → delete-row (nothing durable)', () => {
    for (const status of ['creating', 'provisioning']) {
      const actions = computeWorktreeReconcile(REPO, [row('a1b2c3d4', status)], [], [], new Set())
      expect(actions).toEqual([{ type: 'delete-row', id: 'a1b2c3d4' }])
    }
  })

  it('P3d: journal row, no entry, dir present → surface-orphan-dir + detach (dir never deleted)', () => {
    const actions = computeWorktreeReconcile(
      REPO,
      [row('a1b2c3d4', 'provisioning')],
      [],
      [WT('a1b2c3d4')],
      new Set()
    )
    expect(actions).toEqual([
      { type: 'surface-orphan-dir', path: WT('a1b2c3d4') },
      { type: 'detach', id: 'a1b2c3d4', surface: false }
    ])
  })

  it('P3e: removing row with nothing left → delete-row (e)', () => {
    const actions = computeWorktreeReconcile(REPO, [row('a1b2c3d4', 'removing')], [], [], new Set())
    expect(actions).toEqual([{ type: 'delete-row', id: 'a1b2c3d4' }])
  })

  it('P3f: removing row, no entry, dir remnant → detach, surfaced (e)', () => {
    const actions = computeWorktreeReconcile(
      REPO,
      [row('a1b2c3d4', 'removing')],
      [],
      [WT('a1b2c3d4')],
      new Set()
    )
    expect(actions).toEqual([{ type: 'detach', id: 'a1b2c3d4', surface: true }])
  })

  it('P4: managed git entry + dir, no row → adopt born detached (c), carrying repoRoot', () => {
    const actions = computeWorktreeReconcile(
      REPO,
      [],
      [entry(WT('a1b2c3d4'), 'chorus/Bryk/a1b2c3d4')],
      [WT('a1b2c3d4')],
      new Set()
    )
    expect(actions).toEqual([
      { type: 'adopt', path: WT('a1b2c3d4'), branch: 'chorus/Bryk/a1b2c3d4', repoRoot: REPO }
    ])
  })

  it('P4b: managed git entry, no dir, no row → surface-prune (id carries the path)', () => {
    const actions = computeWorktreeReconcile(
      REPO,
      [],
      [entry(WT('a1b2c3d4'))],
      [],
      new Set()
    )
    expect(actions).toEqual([{ type: 'surface-prune', id: fwd(WT('a1b2c3d4')) }])
  })

  it('P5: managed dir with no entry and no row → surface-orphan-dir, never deleted', () => {
    const actions = computeWorktreeReconcile(REPO, [], [], [WT('a1b2c3d4')], new Set())
    expect(actions).toEqual([{ type: 'surface-orphan-dir', path: WT('a1b2c3d4') }])
  })
})

describe('computeWorktreeReconcile — resolutions (b) (c) (d) (e)', () => {
  it('(b) promote target is active only while the owning session ROW stands', () => {
    const dirs = [WT('a1b2c3d4'), WT('e5f67890'), WT('cafe0000')]
    const entries = dirs.map((d) => entry(d))
    const rows = [
      row('a1b2c3d4', 'creating', { sessionId: 's1' }),
      row('e5f67890', 'provisioning', { sessionId: 'gone' }),
      row('cafe0000', 'provisioning') // sessionId null
    ]
    const actions = computeWorktreeReconcile(REPO, rows, entries, dirs, new Set(['s1']))
    expect(actions).toEqual([
      { type: 'promote', id: 'a1b2c3d4', to: 'active' },
      { type: 'promote', id: 'e5f67890', to: 'detached' },
      { type: 'promote', id: 'cafe0000', to: 'detached' }
    ])
  })

  it('(c) population-4 adoption is born detached, never active — no session link exists', () => {
    // The adopt action has no status field; the manager inserts status:'detached'.
    // What the core guarantees: the action type is adopt (never promote), even
    // when sessionRowIds is non-empty.
    const actions = computeWorktreeReconcile(
      REPO,
      [],
      [entry(WT('a1b2c3d4'), 'chorus/Bryk/a1b2c3d4')],
      [WT('a1b2c3d4')],
      new Set(['s1', 's2'])
    )
    expect(types(actions)).toEqual(['adopt'])
    expect(actions[0]).toMatchObject({ branch: 'chorus/Bryk/a1b2c3d4', repoRoot: REPO })
  })

  it('(d) population 2 surfaces as prune candidate unconditionally — no "session alive" branch', () => {
    // Even with the owning session id present in sessionRowIds, entry+no-dir
    // collapses to surface-prune (reconcile runs pre-restore, nothing alive).
    const actions = computeWorktreeReconcile(
      REPO,
      [row('a1b2c3d4', 'active', { sessionId: 's1' })],
      [entry(WT('a1b2c3d4'))],
      [],
      new Set(['s1'])
    )
    expect(actions).toEqual([{ type: 'surface-prune', id: 'a1b2c3d4' }])
  })

  it('(e) removing re-classifies purely by evidence: nothing left → delete-row; any remnant → detach', () => {
    const gone = computeWorktreeReconcile(REPO, [row('a1b2c3d4', 'removing')], [], [], new Set())
    expect(gone).toEqual([{ type: 'delete-row', id: 'a1b2c3d4' }])

    const remnantEntry = computeWorktreeReconcile(
      REPO,
      [row('a1b2c3d4', 'removing')],
      [entry(WT('a1b2c3d4'))],
      [],
      new Set()
    )
    expect(remnantEntry).toEqual([{ type: 'detach', id: 'a1b2c3d4', surface: true }])

    const remnantDir = computeWorktreeReconcile(
      REPO,
      [row('a1b2c3d4', 'removing')],
      [],
      [WT('a1b2c3d4')],
      new Set()
    )
    expect(remnantDir).toEqual([{ type: 'detach', id: 'a1b2c3d4', surface: true }])
  })
})

describe('computeWorktreeReconcile — crash seams & idempotency', () => {
  it('crash seam: creating row, no entry, no dir → delete-row (git add never ran)', () => {
    const actions = computeWorktreeReconcile(REPO, [row('a1b2c3d4', 'creating')], [], [], new Set())
    expect(actions).toEqual([{ type: 'delete-row', id: 'a1b2c3d4' }])
  })

  it('crash seam: provisioning row, dir present, no entry → surface-orphan-dir + detach, dir kept', () => {
    const actions = computeWorktreeReconcile(
      REPO,
      [row('a1b2c3d4', 'provisioning')],
      [],
      [WT('a1b2c3d4')],
      new Set()
    )
    expect(types(actions)).toEqual(['surface-orphan-dir', 'detach'])
    expect(actions[0]).toEqual({ type: 'surface-orphan-dir', path: WT('a1b2c3d4') })
  })

  /** Mirrors the manager's non-destructive applies so the post-action state
   *  can be fed back through the core. */
  function applyActions(
    rows: WorktreeReconcileRow[],
    actions: WorktreeReconcileAction[]
  ): WorktreeReconcileRow[] {
    let next = rows.map((r) => ({ ...r }))
    for (const a of actions) {
      if (a.type === 'promote') {
        next = next.map((r) => (r.id === a.id ? { ...r, status: a.to } : r))
      } else if (a.type === 'detach') {
        next = next.map((r) =>
          r.id === a.id ? { ...r, status: 'detached', sessionId: null } : r
        )
      } else if (a.type === 'delete-row') {
        next = next.filter((r) => r.id !== a.id)
      } else if (a.type === 'adopt') {
        next = [...next, { id: `adopted:${a.path}`, sessionId: null, status: 'detached', path: a.path }]
      }
      // none / surface-* : no state change
    }
    return next
  }

  it('idempotency: the post-action state feeds back to only none/surface-* actions', () => {
    const rows = [
      row('a1b2c3d4', 'active'), // P1a healthy
      row('bb000001', 'creating', { sessionId: 's1' }), // P1b promote active
      row('bb000002', 'provisioning'), // P1b promote detached (no session)
      row('bb000003', 'active'), // P2a prune candidate
      row('bb000004', 'provisioning'), // P2b prune candidate
      row('bb000005', 'active'), // P3a dir, no entry
      row('bb000006', 'active'), // P3b nothing
      row('bb000007', 'creating'), // P3c nothing → delete-row
      row('bb000008', 'provisioning'), // P3d dir, no entry
      row('bb000009', 'removing'), // P3e nothing → delete-row
      row('bb000010', 'removing'), // P2c entry remnant
      row('bb000011', 'removing'), // P3f dir remnant
      row('bb000012', 'removing') // P1c entry+dir remnant
    ]
    const entries = [
      entry(WT('a1b2c3d4')),
      entry(WT('bb000001')),
      entry(WT('bb000002')),
      entry(WT('bb000003')),
      entry(WT('bb000004')),
      entry(WT('bb000010')),
      entry(WT('bb000012')),
      entry(WT('bb000020'), 'chorus/Bryk/bb000020'), // P4 adopt
      entry(WT('bb000021')) // P4b prune candidate
    ]
    const dirs = [
      WT('a1b2c3d4'),
      WT('bb000001'),
      WT('bb000002'),
      WT('bb000005'),
      WT('bb000008'),
      WT('bb000011'),
      WT('bb000012'),
      WT('bb000020'), // P4's dir
      WT('bb000030') // P5 orphan dir
    ]
    const sessions = new Set(['s1'])

    const first = computeWorktreeReconcile(REPO, rows, entries, dirs, sessions)
    // sanity: the first pass really did classify across the whole matrix
    expect(new Set(types(first))).toEqual(
      new Set(['none', 'promote', 'surface-prune', 'detach', 'delete-row', 'surface-orphan-dir', 'adopt'])
    )

    const postRows = applyActions(rows, first)
    const second = computeWorktreeReconcile(REPO, postRows, entries, dirs, sessions)
    for (const a of second) {
      expect(['none', 'surface-prune', 'surface-orphan-dir']).toContain(a.type)
    }
    // every converged row is a no-op; surfaced populations recur by design
    // (P2 rows keep their status, P2c's detach lands a detached row on P2a
    // evidence → surface-prune, P4b/P5 were never actioned at all)
    expect(ofType(second, 'none').map((a) => a.id).sort()).toEqual(
      [
        'a1b2c3d4',
        'bb000001',
        'bb000002',
        'bb000005',
        'bb000006',
        'bb000008',
        'bb000011',
        'bb000012',
        `adopted:${WT('bb000020')}`
      ].sort()
    )
    expect(ofType(second, 'surface-prune').map((a) => a.id).sort()).toEqual(
      ['bb000003', 'bb000004', 'bb000010', fwd(WT('bb000021'))].sort()
    )
    expect(ofType(second, 'surface-orphan-dir').map((a) => a.path)).toEqual([WT('bb000030')])
  })

  it('matches paths across separators and case (git fwd-slash vs stored backslash)', () => {
    const actions = computeWorktreeReconcile(
      REPO,
      [row('a1b2c3d4', 'active')],
      [{ path: fwd(WT('a1b2c3d4')).toUpperCase(), branch: 'x' }],
      [WT('a1b2c3d4')],
      new Set()
    )
    expect(actions).toEqual([{ type: 'none', id: 'a1b2c3d4' }])
  })
})

describe('derivation helpers (D23/D26h)', () => {
  it('shortIdFrom takes the first 8 hex chars of the UUID', () => {
    expect(shortIdFrom('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe('a1b2c3d4')
  })

  it('worktreeRootFor/worktreePathFor place worktrees OUTSIDE the repo', () => {
    expect(worktreeRootFor('C:\\Source\\Bryk')).toBe('C:\\Source\\.chorus\\Bryk')
    expect(worktreePathFor('C:\\Source\\Bryk', 'a1b2c3d4')).toBe(
      'C:\\Source\\.chorus\\Bryk\\wt-a1b2c3d4'
    )
  })

  it('branchFor derives the chorus/<repo>/<shortId> branch name', () => {
    expect(branchFor('C:\\Source\\Bryk', 'a1b2c3d4')).toBe('chorus/Bryk/a1b2c3d4')
    // forward-slash repo roots (git's own output form) derive the same branch
    expect(branchFor('C:/Source/Bryk', 'a1b2c3d4')).toBe('chorus/Bryk/a1b2c3d4')
  })
})

describe('parseWorktreePorcelain', () => {
  it('parses multi-entry output with branches and heads', () => {
    const out = [
      'worktree C:/Source/Bryk',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree C:/Source/.chorus/Bryk/wt-a1b2c3d4',
      'HEAD 2222222222222222222222222222222222222222',
      'branch refs/heads/chorus/Bryk/a1b2c3d4',
      ''
    ].join('\n')
    expect(parseWorktreePorcelain(out)).toEqual([
      {
        path: 'C:/Source/Bryk',
        branch: 'main',
        head: '1111111111111111111111111111111111111111',
        detached: false,
        bare: false
      },
      {
        path: 'C:/Source/.chorus/Bryk/wt-a1b2c3d4',
        branch: 'chorus/Bryk/a1b2c3d4',
        head: '2222222222222222222222222222222222222222',
        detached: false,
        bare: false
      }
    ])
  })

  it('parses a detached-HEAD entry (branch null)', () => {
    const out = [
      'worktree C:/Source/.chorus/Bryk/wt-deadbeef',
      'HEAD 3333333333333333333333333333333333333333',
      'detached',
      ''
    ].join('\n')
    expect(parseWorktreePorcelain(out)).toEqual([
      {
        path: 'C:/Source/.chorus/Bryk/wt-deadbeef',
        branch: null,
        head: '3333333333333333333333333333333333333333',
        detached: true,
        bare: false
      }
    ])
  })

  it('parses a bare entry (no HEAD line, branch null)', () => {
    const out = ['worktree C:/Source/bare-repo', 'bare', ''].join('\n')
    expect(parseWorktreePorcelain(out)).toEqual([
      { path: 'C:/Source/bare-repo', branch: null, head: null, detached: false, bare: true }
    ])
  })

  it('tolerates CRLF and skips locked/prunable attribute lines', () => {
    const out =
      'worktree C:/Source/.chorus/Bryk/wt-a1b2c3d4\r\n' +
      'HEAD 2222222222222222222222222222222222222222\r\n' +
      'branch refs/heads/chorus/Bryk/a1b2c3d4\r\n' +
      'locked reason here\r\n' +
      'prunable gitdir file points to non-existent location\r\n'
    const entries = parseWorktreePorcelain(out)
    expect(entries).toHaveLength(1)
    expect(entries[0].branch).toBe('chorus/Bryk/a1b2c3d4')
    expect(entries[0].detached).toBe(false)
  })
})
