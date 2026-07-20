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
  viewSetRequestSchema
} from './ipc'
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
    // branch is required-nullable from 2-2 on (a current-tree launch: null).
    const snap = {
      sessionId: 'abc',
      buffer: 'x',
      status: 'running',
      exitCode: null,
      title: null,
      branch: null
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
    const base = { sessionId: PID, buffer: '', status: 'exited', exitCode: 0, branch: null }
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

    const attach = { sessionId: PID, buffer: '', status: 'running', exitCode: null, title: null }
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
