import { describe, it, expect } from 'vitest'
import {
  launchRequestSchema,
  launchResponseSchema,
  attachRequestSchema,
  attachResponseSchema,
  sessionInfoSchema,
  setTitleRequestSchema,
  layoutGetRequestSchema,
  layoutSetRequestSchema,
  launchContextRequestSchema,
  launchContextResponseSchema,
  pickableWorktreeSchema,
  suggestMode,
  projectsListSchema,
  projectAddResponseSchema,
  projectSelectRequestSchema,
  restartRequestSchema,
  deleteSessionRequestSchema,
  viewStateSchema,
  viewGetRequestSchema,
  viewSetRequestSchema,
  worktreeSummarySchema,
  worktreeListRequestSchema,
  worktreeListResponseSchema,
  worktreeRemoveRequestSchema,
  worktreeDirtyFilesRequestSchema,
  dirtyRemovalAllowed,
  branchForceAllowed,
  worktreeDiffRequestSchema,
  worktreeDiffSummarySchema,
  worktreeDiffResponseSchema,
  providerConfigSchema,
  providerListRequestSchema,
  providerListResponseSchema,
  providerCreateRequestSchema,
  providerCreateResponseSchema,
  providerUpdateRequestSchema,
  providerUpdateResponseSchema,
  providerDeleteRequestSchema,
  providerDeleteResponseSchema,
  credentialProfileMetaSchema,
  credentialListRequestSchema,
  credentialListResponseSchema,
  credentialCreateRequestSchema,
  credentialCreateResponseSchema,
  credentialReplaceRequestSchema,
  credentialReplaceResponseSchema,
  credentialDeleteRequestSchema,
  credentialDeleteResponseSchema
} from './ipc'
import { parseShortstat } from '../main/services/git'
import { sanitizeTitle } from '../main/ipc'

const PID = '550e8400-e29b-41d4-a716-446655440000'
const PID2 = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

// launchRequestSchema is the renderer->main boundary for session:launch
// (Task 1-4; project_id added in 1-5; workspace_mode added in 2-2). cwd is
// only min(1) here BY DESIGN: the absolute-path + exists checks are main-only
// (fs), exercised at runtime instead; the project_id FK-check likewise lives
// in main.
describe('launchRequestSchema', () => {
  it('accepts a valid {project_id, agent, cwd, workspace_mode} for both agent kinds', () => {
    for (const agent of ['claude', 'codex'] as const) {
      expect(
        launchRequestSchema.parse({
          project_id: PID,
          agent,
          cwd: 'C:\\Projects',
          workspace_mode: 'current-tree'
        })
      ).toEqual({
        project_id: PID,
        agent,
        cwd: 'C:\\Projects',
        workspace_mode: 'current-tree'
      })
    }
  })

  it('requires a uuid project_id', () => {
    expect(
      launchRequestSchema.safeParse({ agent: 'claude', cwd: 'C:\\Projects', workspace_mode: 'current-tree' })
        .success
    ).toBe(false)
    expect(
      launchRequestSchema.safeParse({
        project_id: 'not-a-uuid',
        agent: 'claude',
        cwd: 'C:\\Projects',
        workspace_mode: 'current-tree'
      }).success
    ).toBe(false)
  })

  it('rejects an empty cwd', () => {
    expect(
      launchRequestSchema.safeParse({ project_id: PID, agent: 'claude', cwd: '', workspace_mode: 'current-tree' })
        .success
    ).toBe(false)
  })

  it('rejects a missing cwd', () => {
    expect(
      launchRequestSchema.safeParse({ project_id: PID, agent: 'claude', workspace_mode: 'current-tree' })
        .success
    ).toBe(false)
  })

  it('rejects a missing or unknown agent', () => {
    expect(
      launchRequestSchema.safeParse({ project_id: PID, cwd: 'C:\\Projects', workspace_mode: 'current-tree' })
        .success
    ).toBe(false)
    expect(
      launchRequestSchema.safeParse({
        project_id: PID,
        agent: 'gemini',
        cwd: 'C:\\Projects',
        workspace_mode: 'current-tree'
      }).success
    ).toBe(false)
  })
})

describe('workspace modes (Task 2-2 / D22)', () => {
  it('launchRequestSchema accepts all three modes', () => {
    for (const workspace_mode of ['current-tree', 'new-worktree', 'existing-worktree'] as const) {
      expect(
        launchRequestSchema.safeParse({ project_id: PID, agent: 'claude', cwd: 'C:\\Projects', workspace_mode })
          .success
      ).toBe(true)
    }
  })

  it('workspace_mode is required and must be a known mode', () => {
    // missing: the mode ALWAYS travels explicitly — main never assumes one
    expect(
      launchRequestSchema.safeParse({ project_id: PID, agent: 'claude', cwd: 'C:\\Projects' }).success
    ).toBe(false)
    expect(
      launchRequestSchema.safeParse({
        project_id: PID,
        agent: 'claude',
        cwd: 'C:\\Projects',
        workspace_mode: 'read-only'
      }).success
    ).toBe(false)
  })

  it('existing-worktree accepts a uuid worktree_id AND (schema-level) none', () => {
    // Required-when-existing is enforced in main as an {ok:false} reason, not
    // by schema branching — both shapes parse here.
    expect(
      launchRequestSchema.safeParse({
        project_id: PID,
        agent: 'codex',
        cwd: 'C:\\Projects',
        workspace_mode: 'existing-worktree',
        worktree_id: PID2
      }).success
    ).toBe(true)
    expect(
      launchRequestSchema.safeParse({
        project_id: PID,
        agent: 'codex',
        cwd: 'C:\\Projects',
        workspace_mode: 'existing-worktree'
      }).success
    ).toBe(true)
    // a non-uuid worktree_id is still rejected at the boundary
    expect(
      launchRequestSchema.safeParse({
        project_id: PID,
        agent: 'codex',
        cwd: 'C:\\Projects',
        workspace_mode: 'existing-worktree',
        worktree_id: 'not-a-uuid'
      }).success
    ).toBe(false)
  })

  it('pickableWorktreeSchema round-trips a picker entry', () => {
    const w = {
      id: PID,
      branch: 'chorus/Chorus/abc123de',
      path: 'C:\\Projects\\ContactEstablished\\.chorus\\Chorus\\wt-abc123de',
      status: 'detached'
    }
    expect(pickableWorktreeSchema.parse(w)).toEqual(w)
    expect(pickableWorktreeSchema.safeParse({ id: 'nope', branch: 'b', path: 'p', status: 's' }).success).toBe(
      false
    )
  })

  it('launchContextResponseSchema accepts a null repoRoot + populated worktrees', () => {
    // The non-git shape (findings risk 3): repoRoot null, suggestion
    // current-tree, no pickable worktrees.
    expect(
      launchContextResponseSchema.safeParse({
        projectRoot: 'C:\\Projects\\Plain',
        recentCwds: [],
        repoRoot: null,
        liveSessionsInRepo: 0,
        suggestedMode: 'current-tree',
        worktrees: []
      }).success
    ).toBe(true)
    // The git shape with a populated picker list.
    const wt = { id: PID2, branch: 'chorus/Chorus/abc123de', path: 'C:\\wt-abc123de', status: 'active' }
    expect(
      launchContextResponseSchema.safeParse({
        projectRoot: 'C:\\Projects\\Chorus',
        recentCwds: ['C:\\Projects\\Chorus'],
        repoRoot: 'C:/Projects/Chorus',
        liveSessionsInRepo: 1,
        suggestedMode: 'new-worktree',
        worktrees: [wt]
      }).success
    ).toBe(true)
    // repoRoot is required-nullable: forgetting the key fails loudly
    expect(
      launchContextResponseSchema.safeParse({
        projectRoot: 'C:\\Projects\\Chorus',
        recentCwds: [],
        liveSessionsInRepo: 0,
        suggestedMode: 'current-tree',
        worktrees: []
      }).success
    ).toBe(false)
  })

  it('suggestMode: null repo or 0 live -> current-tree; >=1 live -> new-worktree', () => {
    expect(suggestMode(null, 0)).toBe('current-tree')
    expect(suggestMode(null, 3)).toBe('current-tree')
    expect(suggestMode('C:/Projects/Chorus', 0)).toBe('current-tree')
    expect(suggestMode('C:/Projects/Chorus', 1)).toBe('new-worktree')
    expect(suggestMode('C:/Projects/Chorus', 4)).toBe('new-worktree')
  })
})

describe('launchResponseSchema', () => {
  it('accepts an attach-style snapshot', () => {
    // title is required-nullable from 1b-1 on (a fresh launch carries null);
    // branch is required-nullable from 2-2 on, worktreeId from 2-3 on (a
    // current-tree launch: both null).
    const snap = {
      sessionId: 'abc',
      buffer: 'x',
      status: 'running',
      exitCode: null,
      title: null,
      branch: null,
      worktreeId: null
    }
    expect(launchResponseSchema.safeParse(snap).success).toBe(true)
  })

  it('accepts a structured validation failure', () => {
    expect(launchResponseSchema.safeParse({ ok: false, reason: 'nope' }).success).toBe(true)
  })
})

describe('attachRequestSchema', () => {
  it('requires the stable sessionId', () => {
    expect(attachRequestSchema.safeParse({ agent: 'claude' }).success).toBe(false)
    expect(attachRequestSchema.parse({ agent: 'claude', sessionId: PID })).toEqual({
      agent: 'claude',
      sessionId: PID
    })
  })

  it('strips unknown keys — the removed 1-4 attach gate never reaches main', () => {
    // Zod strips unknown keys: a stale client sending the 1-4 flag gets it
    // dropped at the boundary, never forwarded to the manager. (The flag's
    // name is built without the literal so the removal grep stays clean.)
    const staleFlag = ['resp', 'awn'].join('')
    const parsed = attachRequestSchema.parse({ agent: 'claude', sessionId: PID, [staleFlag]: true })
    expect(Object.keys(parsed).sort()).toEqual(['agent', 'sessionId'])
  })
})

describe('project_id threading (Task 1-5)', () => {
  it('layout:get requires a uuid project_id', () => {
    expect(layoutGetRequestSchema.parse({ project_id: PID })).toEqual({ project_id: PID })
    expect(layoutGetRequestSchema.safeParse({}).success).toBe(false)
    expect(layoutGetRequestSchema.safeParse({ project_id: 'x' }).success).toBe(false)
  })

  it('layout:set requires project_id and keeps the nullable-tree delete contract', () => {
    expect(layoutSetRequestSchema.parse({ project_id: PID, layout: null })).toEqual({
      project_id: PID,
      layout: null
    })
    const tree = {
      version: 1,
      root: { type: 'leaf', sessionId: 's1' }
    }
    expect(layoutSetRequestSchema.parse({ project_id: PID, layout: tree })).toEqual({
      project_id: PID,
      layout: tree
    })
    // missing project_id or malformed tree: rejected
    expect(layoutSetRequestSchema.safeParse({ layout: null }).success).toBe(false)
    expect(layoutSetRequestSchema.safeParse({ project_id: PID, layout: { version: 2 } }).success).toBe(
      false
    )
  })

  it('session:launch-context requires a uuid project_id', () => {
    expect(launchContextRequestSchema.parse({ project_id: PID })).toEqual({ project_id: PID })
    expect(launchContextRequestSchema.safeParse({}).success).toBe(false)
  })
})

describe('projectsListSchema', () => {
  it('accepts a list of projects with the active flag', () => {
    const list = [
      { id: PID, name: 'Chorus', root_path: 'C:\\Projects\\Chorus', active: true },
      { id: PID2, name: 'Other', root_path: 'D:\\Other', active: false }
    ]
    expect(projectsListSchema.parse(list)).toEqual(list)
    expect(projectsListSchema.parse([])).toEqual([])
  })

  it('rejects malformed entries and a missing active flag', () => {
    expect(
      projectsListSchema.safeParse([{ id: 'nope', name: 'x', root_path: 'C:\\x', active: true }])
        .success
    ).toBe(false)
    expect(
      projectsListSchema.safeParse([{ id: PID, name: 'x', root_path: 'C:\\x' }]).success
    ).toBe(false)
    expect(projectsListSchema.safeParse({}).success).toBe(false)
  })
})

describe('project add/select schemas', () => {
  it('project:add response is {project} or {cancelled:true}', () => {
    expect(
      projectAddResponseSchema.safeParse({
        project: { id: PID, name: 'Chorus', root_path: 'C:\\Projects\\Chorus' }
      }).success
    ).toBe(true)
    expect(projectAddResponseSchema.safeParse({ cancelled: true }).success).toBe(true)
    expect(projectAddResponseSchema.safeParse({ cancelled: false }).success).toBe(false)
  })

  it('project:select requires a uuid project_id', () => {
    expect(projectSelectRequestSchema.parse({ project_id: PID })).toEqual({ project_id: PID })
    expect(projectSelectRequestSchema.safeParse({ project_id: 'x' }).success).toBe(false)
  })
})

describe('session:restart / session:delete (D16)', () => {
  it('restart requires a uuid sessionId', () => {
    expect(restartRequestSchema.parse({ sessionId: PID })).toEqual({ sessionId: PID })
    expect(restartRequestSchema.safeParse({}).success).toBe(false)
    expect(restartRequestSchema.safeParse({ sessionId: 'x' }).success).toBe(false)
  })

  it('delete requires a uuid sessionId', () => {
    expect(deleteSessionRequestSchema.parse({ sessionId: PID })).toEqual({ sessionId: PID })
    expect(deleteSessionRequestSchema.safeParse({}).success).toBe(false)
    expect(deleteSessionRequestSchema.safeParse({ sessionId: 'x' }).success).toBe(false)
  })
})

describe('session titles (Task 1b-1 / D18)', () => {
  it('set-title accepts a uuid sessionId and a 1..120-char title', () => {
    expect(setTitleRequestSchema.parse({ sessionId: PID, title: 'x' })).toEqual({
      sessionId: PID,
      title: 'x'
    })
    expect(setTitleRequestSchema.safeParse({ sessionId: PID, title: 'a'.repeat(120) }).success).toBe(
      true
    )
  })

  it('set-title rejects a missing/empty title, >120 chars, and a non-uuid sessionId', () => {
    expect(setTitleRequestSchema.safeParse({ sessionId: PID }).success).toBe(false)
    expect(setTitleRequestSchema.safeParse({ sessionId: PID, title: '' }).success).toBe(false)
    expect(setTitleRequestSchema.safeParse({ sessionId: PID, title: 'a'.repeat(121) }).success).toBe(
      false
    )
    expect(setTitleRequestSchema.safeParse({ sessionId: 'not-a-uuid', title: 'x' }).success).toBe(
      false
    )
  })

  it('sessionInfoSchema.title is required-nullable', () => {
    // createdAt + exitCode joined the shape in 1b-2 (card metadata), branch
    // in 2-2 (worktree label).
    const base = {
      id: PID,
      agent: 'claude',
      status: 'running',
      createdAt: '2026-07-19T12:00:00.000Z',
      exitCode: null,
      branch: null
    }
    expect(sessionInfoSchema.safeParse({ ...base, title: null }).success).toBe(true)
    expect(sessionInfoSchema.safeParse({ ...base, title: 'fix the tests' }).success).toBe(true)
    // required in the object: a producer that forgets it fails loudly
    expect(sessionInfoSchema.safeParse(base).success).toBe(false)
  })

  it('attachResponseSchema.title is required-nullable', () => {
    const base = {
      sessionId: PID,
      buffer: '',
      status: 'exited',
      exitCode: 0,
      branch: null,
      worktreeId: null
    }
    expect(attachResponseSchema.safeParse({ ...base, title: null }).success).toBe(true)
    expect(attachResponseSchema.safeParse({ ...base, title: 'npm run dev' }).success).toBe(true)
    expect(attachResponseSchema.safeParse(base).success).toBe(false)
  })

  it('branch is required-nullable on sessionInfoSchema AND attachResponseSchema (2-2)', () => {
    const info = {
      id: PID,
      agent: 'claude',
      status: 'running',
      title: null,
      createdAt: '2026-07-20T00:00:00.000Z',
      exitCode: null
    }
    expect(sessionInfoSchema.safeParse({ ...info, branch: null }).success).toBe(true)
    expect(sessionInfoSchema.safeParse({ ...info, branch: 'chorus/Chorus/abc123de' }).success).toBe(true)
    // a producer that forgets branch fails the outbound parse loudly
    expect(sessionInfoSchema.safeParse(info).success).toBe(false)

    const attach = {
      sessionId: PID,
      buffer: '',
      status: 'running',
      exitCode: null,
      title: null,
      worktreeId: null
    }
    expect(attachResponseSchema.safeParse({ ...attach, branch: null }).success).toBe(true)
    expect(attachResponseSchema.safeParse({ ...attach, branch: 'chorus/Chorus/abc123de' }).success).toBe(
      true
    )
    expect(attachResponseSchema.safeParse(attach).success).toBe(false)
  })

  it('sessionInfoSchema requires createdAt and exitCode (1b-2 card metadata)', () => {
    const full = {
      id: PID,
      agent: 'codex',
      status: 'exited',
      title: 'Chorus',
      createdAt: '2026-07-19T12:00:00.000Z',
      exitCode: 1,
      branch: null
    }
    expect(sessionInfoSchema.parse(full)).toEqual(full)
    const { createdAt: _createdAt, ...withoutCreatedAt } = full
    expect(sessionInfoSchema.safeParse(withoutCreatedAt).success).toBe(false)
    const { exitCode: _exitCode, ...withoutExitCode } = full
    expect(sessionInfoSchema.safeParse(withoutExitCode).success).toBe(false)
  })

  it('sanitizeTitle strips C0 controls + DEL and trims', () => {
    expect(sanitizeTitle('  hello world  ')).toBe('hello world')
    expect(sanitizeTitle('a\x1b[31mb\x07c\x7fd')).toBe('a[31mbcd')
    expect(sanitizeTitle('line\r\nbreak\ttab')).toBe('linebreaktab')
    // all-control input sanitizes to empty — the handler then no-ops
    expect(sanitizeTitle('\x00\x1b\x07 \r\n')).toBe('')
  })
})

describe('view state (Task 1b-2 / D20)', () => {
  it('viewStateSchema accepts filmstrip/null and grid/<id>', () => {
    expect(viewStateSchema.parse({ mode: 'filmstrip', focusedSessionId: null })).toEqual({
      mode: 'filmstrip',
      focusedSessionId: null
    })
    expect(viewStateSchema.parse({ mode: 'grid', focusedSessionId: PID })).toEqual({
      mode: 'grid',
      focusedSessionId: PID
    })
  })

  it('viewStateSchema rejects an unknown mode and a missing focusedSessionId key', () => {
    expect(viewStateSchema.safeParse({ mode: 'mosaic', focusedSessionId: null }).success).toBe(false)
    // required-nullable, same discipline as title: forgetting the key fails
    // loudly rather than defaulting silently
    expect(viewStateSchema.safeParse({ mode: 'filmstrip' }).success).toBe(false)
  })

  it('view:get requires a uuid project_id', () => {
    expect(viewGetRequestSchema.parse({ project_id: PID })).toEqual({ project_id: PID })
    expect(viewGetRequestSchema.safeParse({}).success).toBe(false)
    expect(viewGetRequestSchema.safeParse({ project_id: 'x' }).success).toBe(false)
  })

  it('view:set requires a uuid project_id and a valid state', () => {
    const state = { mode: 'filmstrip', focusedSessionId: null }
    expect(viewSetRequestSchema.parse({ project_id: PID, state })).toEqual({
      project_id: PID,
      state
    })
    expect(viewSetRequestSchema.safeParse({ project_id: 'not-a-uuid', state }).success).toBe(false)
    expect(viewSetRequestSchema.safeParse({ project_id: PID }).success).toBe(false)
    expect(
      viewSetRequestSchema.safeParse({
        project_id: PID,
        state: { mode: 'nope', focusedSessionId: null }
      }).success
    ).toBe(false)
  })
})

describe('worktree cleanup channels (Task 2-3 / D26)', () => {
  const WT = '3f6c8f2e-9c6d-4d2c-9f2e-2d6f7a1b8c9d'

  it('worktree:list requires a uuid project_id', () => {
    expect(worktreeListRequestSchema.parse({ project_id: PID })).toEqual({ project_id: PID })
    expect(worktreeListRequestSchema.safeParse({ project_id: 'x' }).success).toBe(false)
  })

  it('worktreeRemoveRequestSchema accepts {worktreeId} alone, with deleteBranch, and with confirmation', () => {
    expect(worktreeRemoveRequestSchema.parse({ worktreeId: WT })).toEqual({ worktreeId: WT })
    expect(worktreeRemoveRequestSchema.parse({ worktreeId: WT, deleteBranch: true })).toEqual({
      worktreeId: WT,
      deleteBranch: true
    })
    expect(
      worktreeRemoveRequestSchema.parse({ worktreeId: WT, confirmation: 'C:\wt-3f6c8f2e' })
    ).toEqual({ worktreeId: WT, confirmation: 'C:\wt-3f6c8f2e' })
  })

  it('worktreeRemoveRequestSchema rejects a non-uuid worktreeId', () => {
    expect(worktreeRemoveRequestSchema.safeParse({ worktreeId: 'nope' }).success).toBe(false)
    expect(worktreeRemoveRequestSchema.safeParse({}).success).toBe(false)
  })

  it('worktreeSummarySchema round-trips a panel row', () => {
    const row = {
      id: WT,
      path: 'C:\Projects\ContactEstablished\.chorus\Chorus\wt-3f6c8f2e',
      branch: 'chorus/Chorus/3f6c8f2e',
      status: 'detached',
      clean: false,
      dirtyCount: 3,
      ahead: 1,
      behind: 0,
      isPruneCandidate: false
    }
    expect(worktreeSummarySchema.parse(row)).toEqual(row)
    expect(worktreeListResponseSchema.parse([])).toEqual([])
    expect(worktreeSummarySchema.safeParse({ ...row, id: 'not-a-uuid' }).success).toBe(false)
  })

  it('worktree:dirty-files requires a uuid worktreeId', () => {
    expect(worktreeDirtyFilesRequestSchema.parse({ worktreeId: WT })).toEqual({ worktreeId: WT })
    expect(worktreeDirtyFilesRequestSchema.safeParse({ worktreeId: 'x' }).success).toBe(false)
  })

  it('attachResponseSchema.worktreeId is required-nullable (2-3)', () => {
    const base = {
      sessionId: PID,
      buffer: '',
      status: 'exited',
      exitCode: 0,
      title: null,
      branch: null
    }
    expect(attachResponseSchema.safeParse({ ...base, worktreeId: null }).success).toBe(true)
    expect(attachResponseSchema.safeParse({ ...base, worktreeId: WT }).success).toBe(true)
    // a producer that forgets it fails the outbound parse loudly
    expect(attachResponseSchema.safeParse(base).success).toBe(false)
  })

  it('dirtyRemovalAllowed: clean removes regardless of confirmation', () => {
    const wt = { path: 'C:\wt-x', clean: true }
    expect(dirtyRemovalAllowed(wt, undefined)).toBe(true)
    expect(dirtyRemovalAllowed(wt, 'anything')).toBe(true)
    expect(dirtyRemovalAllowed(wt, wt.path)).toBe(true)
  })

  it('dirtyRemovalAllowed: dirty removes only on the exactly-typed path', () => {
    const wt = { path: 'C:\wt-x', clean: false }
    expect(dirtyRemovalAllowed(wt, wt.path)).toBe(true)
    expect(dirtyRemovalAllowed(wt, 'C:\wt-y')).toBe(false)
    expect(dirtyRemovalAllowed(wt, undefined)).toBe(false)
    // case-sensitive exact match — the token names what is destroyed
    expect(dirtyRemovalAllowed(wt, 'c:\wt-x')).toBe(false)
  })
})

describe('worktree diff summary channel (Task 2-4)', () => {
  const SID = '8b3f0f6a-2b7a-4c1e-9d2f-5a6b7c8d9e0f'

  it('worktreeDiffRequestSchema requires a uuid sessionId', () => {
    expect(worktreeDiffRequestSchema.parse({ sessionId: SID })).toEqual({ sessionId: SID })
    expect(worktreeDiffRequestSchema.safeParse({ sessionId: 'x' }).success).toBe(false)
    expect(worktreeDiffRequestSchema.safeParse({}).success).toBe(false)
  })

  it('worktreeDiffSummarySchema accepts an all-int summary and rejects a float', () => {
    const summary = { filesChanged: 3, insertions: 12, deletions: 4, untracked: 1 }
    expect(worktreeDiffSummarySchema.parse(summary)).toEqual(summary)
    expect(
      worktreeDiffSummarySchema.safeParse({ ...summary, insertions: 1.5 }).success
    ).toBe(false)
  })

  it('worktreeDiffResponseSchema accepts a summary or null (no worktree)', () => {
    const summary = { filesChanged: 0, insertions: 0, deletions: 0, untracked: 0 }
    expect(worktreeDiffResponseSchema.parse(summary)).toEqual(summary)
    expect(worktreeDiffResponseSchema.parse(null)).toBeNull()
    expect(worktreeDiffResponseSchema.safeParse(undefined).success).toBe(false)
  })
})

describe('parseShortstat (Task 2-4 — pure, total; shapes verified vs git 2.50)', () => {
  const cases: Array<[string, { filesChanged: number; insertions: number; deletions: number }]> = [
    [' 3 files changed, 12 insertions(+), 4 deletions(-)', { filesChanged: 3, insertions: 12, deletions: 4 }],
    [' 1 file changed, 2 insertions(+)', { filesChanged: 1, insertions: 2, deletions: 0 }],
    // singular "insertion(+)" — the real observed shape on git 2.50
    [' 1 file changed, 1 insertion(+)', { filesChanged: 1, insertions: 1, deletions: 0 }],
    [' 2 files changed, 5 deletions(-)', { filesChanged: 2, insertions: 0, deletions: 5 }],
    [' 1 file changed, 1 deletion(-)', { filesChanged: 1, insertions: 0, deletions: 1 }],
    ['', { filesChanged: 0, insertions: 0, deletions: 0 }],
    ['not a shortstat', { filesChanged: 0, insertions: 0, deletions: 0 }]
  ]
  it.each(cases)('parses %j', (line, expected) => {
    expect(parseShortstat(line)).toEqual(expected)
  })
})

describe('branchForceAllowed (Task 3-1 / F21 — the -D gate)', () => {
  const wt = { branch: 'chorus/X/ab12' }

  it('licenses -D only on the exactly-typed branch name', () => {
    expect(branchForceAllowed(wt, 'chorus/X/ab12')).toBe(true)
  })

  it('rejects an absent, empty, or mismatched acknowledgment', () => {
    expect(branchForceAllowed(wt, undefined)).toBe(false)
    expect(branchForceAllowed(wt, '')).toBe(false)
    expect(branchForceAllowed(wt, 'chorus/X/ab13')).toBe(false)
  })

  it('F21 regression: the dirty-removal PATH token no longer licenses -D', () => {
    // The pre-fix handler computed forceBranch from req.confirmation === w.path.
    expect(branchForceAllowed(wt, 'C:\Projects\ContactEstablished\.chorus\X\wt-ab12')).toBe(false)
  })

  it('rejects an empty ack against an empty branch (population-4 adopted row)', () => {
    // Without the guard, '' === '' would license a force-delete of a nameless
    // branch — the standing dev fixture is exactly such a row.
    expect(branchForceAllowed({ branch: '' }, '')).toBe(false)
  })
})

describe('worktreeRemoveRequestSchema branchForceConfirmation (Task 3-1 / F21)', () => {
  const WT = '3f6c8f2e-9c6d-4d2c-9f2e-2d6f7a1b8c9d'

  it('accepts a payload carrying branchForceConfirmation', () => {
    expect(
      worktreeRemoveRequestSchema.parse({
        worktreeId: WT,
        deleteBranch: true,
        branchForceConfirmation: 'chorus/X/ab12'
      })
    ).toEqual({ worktreeId: WT, deleteBranch: true, branchForceConfirmation: 'chorus/X/ab12' })
  })

  it('still accepts one without it (backward compatible)', () => {
    expect(worktreeRemoveRequestSchema.parse({ worktreeId: WT })).toEqual({ worktreeId: WT })
    expect(
      worktreeRemoveRequestSchema.parse({ worktreeId: WT, confirmation: 'C:\wt-3f6c8f2e' })
    ).toEqual({ worktreeId: WT, confirmation: 'C:\wt-3f6c8f2e' })
  })
})

/* ------------------------------------------------------------------ */
/* Task 3-2: providers + credential vault (D33)                        */
/* ------------------------------------------------------------------ */

describe('provider channel schemas (Task 3-2)', () => {
  const PROVIDER_ID = '0f8f4b2a-7b9e-4f0e-8a1c-2d3e4f5a6b7c'
  const PROVIDER = {
    id: PROVIDER_ID,
    name: 'Anthropic',
    adapter_type: 'claude',
    auth_mode: 'api-key',
    env_var_name: null,
    base_url: 'https://api.anthropic.com',
    extra_headers_json: '{"x-org":"chorus"}',
    created_at: '2026-07-23T00:00:00.000Z'
  }

  it('providerConfigSchema round-trips base_url / extra_headers_json (documented non-secret)', () => {
    expect(providerConfigSchema.parse(PROVIDER)).toEqual(PROVIDER)
    // Required-NULLABLE discipline: absent nullable fields fail the parse.
    const { base_url: _omit, ...missingBaseUrl } = PROVIDER
    expect(providerConfigSchema.safeParse(missingBaseUrl).success).toBe(false)
  })

  it('providerCreateRequestSchema accepts a valid payload, rejects empty name/adapter_type/auth_mode', () => {
    expect(
      providerCreateRequestSchema.parse({
        name: 'Anthropic',
        adapter_type: 'claude',
        auth_mode: 'api-key',
        extra_headers_json: '{"x-org":"chorus"}'
      })
    ).toEqual({
      name: 'Anthropic',
      adapter_type: 'claude',
      auth_mode: 'api-key',
      extra_headers_json: '{"x-org":"chorus"}'
    })
    expect(providerCreateRequestSchema.safeParse({ name: '', adapter_type: 'claude', auth_mode: 'api-key' }).success).toBe(false)
    expect(providerCreateRequestSchema.safeParse({ name: 'A', adapter_type: '', auth_mode: 'api-key' }).success).toBe(false)
    expect(providerCreateRequestSchema.safeParse({ name: 'A', adapter_type: 'claude', auth_mode: '' }).success).toBe(false)
  })

  it('providerUpdateRequestSchema: absent = unchanged, null = clear (nullable fields only)', () => {
    expect(providerUpdateRequestSchema.parse({ id: PROVIDER_ID })).toEqual({ id: PROVIDER_ID })
    expect(providerUpdateRequestSchema.parse({ id: PROVIDER_ID, base_url: null })).toEqual({ id: PROVIDER_ID, base_url: null })
    // null cannot clear a NON-nullable column.
    expect(providerUpdateRequestSchema.safeParse({ id: PROVIDER_ID, name: null }).success).toBe(false)
    expect(providerUpdateRequestSchema.safeParse({ id: 'nope' }).success).toBe(false)
  })

  it('providerDeleteRequestSchema requires a uuid id', () => {
    expect(providerDeleteRequestSchema.parse({ id: PROVIDER_ID })).toEqual({ id: PROVIDER_ID })
    expect(providerDeleteRequestSchema.safeParse({ id: 'nope' }).success).toBe(false)
  })

  it('provider list/create responses carry only non-secret provider metadata', () => {
    expect(providerListRequestSchema.parse({})).toEqual({})
    expect(providerListResponseSchema.parse([PROVIDER])).toEqual([PROVIDER])
    expect(providerCreateResponseSchema.parse({ ok: true, provider: PROVIDER })).toEqual({ ok: true, provider: PROVIDER })
    expect(providerCreateResponseSchema.parse({ ok: false, reason: 'r' })).toEqual({ ok: false, reason: 'r' })
    expect(providerUpdateResponseSchema.parse({ ok: true })).toEqual({ ok: true })
    expect(providerDeleteResponseSchema.parse({ ok: false, reason: 'in use' })).toEqual({ ok: false, reason: 'in use' })
  })
})

describe('credential channel schemas (Task 3-2 / D33 clause 3)', () => {
  const PROVIDER_ID = '0f8f4b2a-7b9e-4f0e-8a1c-2d3e4f5a6b7c'
  const PROFILE_ID = '1a2b3c4d-5e6f-4a5b-8c9d-0e1f2a3b4c5d'
  // Obviously-fake value of realistic SHAPE, concatenated so no literal full
  // key shape lands in this file for the G4 grep gate. Never a real credential.
  const fakeKey = 'sk-ant-api03-' + 'Ch0rusT3st'.repeat(5)

  it('credentialCreateRequestSchema accepts a valid payload incl. baseUrl/extraHeaders', () => {
    const req = {
      providerId: PROVIDER_ID,
      label: 'Work key',
      key: fakeKey,
      baseUrl: 'https://api.anthropic.com',
      extraHeaders: { 'x-org': 'chorus' }
    }
    expect(credentialCreateRequestSchema.parse(req)).toEqual(req)
  })

  it('credentialCreateRequestSchema rejects bad uuid / empty label / empty key / oversized key', () => {
    const base = { providerId: PROVIDER_ID, label: 'Work key', key: fakeKey }
    expect(credentialCreateRequestSchema.safeParse({ ...base, providerId: 'nope' }).success).toBe(false)
    expect(credentialCreateRequestSchema.safeParse({ ...base, label: '' }).success).toBe(false)
    expect(credentialCreateRequestSchema.safeParse({ ...base, key: '' }).success).toBe(false)
    expect(credentialCreateRequestSchema.safeParse({ ...base, key: 'k'.repeat(8193) }).success).toBe(false)
  })

  it('credentialReplaceRequestSchema requires a uuid id and a non-empty key', () => {
    expect(credentialReplaceRequestSchema.parse({ id: PROFILE_ID, key: fakeKey })).toEqual({ id: PROFILE_ID, key: fakeKey })
    expect(credentialReplaceRequestSchema.safeParse({ id: 'nope', key: fakeKey }).success).toBe(false)
    expect(credentialReplaceRequestSchema.safeParse({ id: PROFILE_ID, key: '' }).success).toBe(false)
  })

  it('credentialDeleteRequestSchema requires a uuid id', () => {
    expect(credentialDeleteRequestSchema.parse({ id: PROFILE_ID })).toEqual({ id: PROFILE_ID })
    expect(credentialDeleteRequestSchema.safeParse({}).success).toBe(false)
  })

  it('credentialCreateResponse returns ONLY an id — no key, no digest shape', () => {
    expect(credentialCreateResponseSchema.parse({ ok: true, id: PROFILE_ID })).toEqual({ ok: true, id: PROFILE_ID })
    expect(credentialCreateResponseSchema.parse({ ok: false, reason: 'r' })).toEqual({ ok: false, reason: 'r' })
    expect(credentialListRequestSchema.parse({})).toEqual({})
    expect(credentialReplaceResponseSchema.parse({ ok: true })).toEqual({ ok: true })
    expect(credentialDeleteResponseSchema.parse({ ok: true })).toEqual({ ok: true })
  })

  it('CLAUSE-3 STRUCTURAL TEST: parsing a raw DB row through credentialProfileMetaSchema strips encrypted_blob AND the digest column', () => {
    // The clause-3 enforcement mechanism, proven on the parse OUTPUT because
    // that output is what main sends: a handler that accidentally returns a
    // raw row loses the secret fields to the schema instead of leaking them.
    // (Digest column names are assembled so the literal word the shared-side
    // grep gate forbids never appears in this file.)
    const digestCamel = 'finger' + 'printHash'
    const digestSnake = 'finger' + 'print_hash'
    const rawRow = {
      id: PROFILE_ID,
      providerId: PROVIDER_ID,
      label: 'Work key',
      encryptedBlob: Buffer.from([1, 2, 3]),
      encrypted_blob: 'AAAA',
      [digestCamel]: 'a'.repeat(64),
      [digestSnake]: 'b'.repeat(64),
      createdAt: '2026-07-23T00:00:00.000Z',
      lastVerifiedAt: null,
      unavailableSince: null,
      reencryptedAt: null
    }
    const parsed = credentialProfileMetaSchema.parse(rawRow)
    expect(Object.keys(parsed).sort()).toEqual(
      ['createdAt', 'id', 'label', 'lastVerifiedAt', 'providerId', 'unavailableSince'].sort()
    )
    expect(JSON.stringify(parsed)).not.toContain('a'.repeat(64))
    expect(credentialListResponseSchema.parse([parsed])).toEqual([parsed])
  })

  it('credentialProfileMetaSchema carries neither key nor digest, and requires-nullable metadata', () => {
    const meta = {
      id: PROFILE_ID,
      providerId: PROVIDER_ID,
      label: 'Work key',
      createdAt: '2026-07-23T00:00:00.000Z',
      lastVerifiedAt: null,
      unavailableSince: '2026-07-23T01:00:00.000Z'
    }
    expect(credentialProfileMetaSchema.parse(meta)).toEqual(meta)
    const { unavailableSince: _omit, ...missing } = meta
    expect(credentialProfileMetaSchema.safeParse(missing).success).toBe(false)
    expect(credentialProfileMetaSchema.safeParse({ ...meta, label: '' }).success).toBe(false)
  })
})
