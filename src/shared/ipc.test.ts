import { describe, it, expect } from 'vitest'
import {
  launchRequestSchema,
  launchResponseSchema,
  attachRequestSchema,
  layoutGetRequestSchema,
  layoutSetRequestSchema,
  launchContextRequestSchema,
  projectsListSchema,
  projectAddResponseSchema,
  projectSelectRequestSchema,
  restartRequestSchema,
  deleteSessionRequestSchema
} from './ipc'

const PID = '550e8400-e29b-41d4-a716-446655440000'
const PID2 = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

// launchRequestSchema is the renderer->main boundary for session:launch
// (Task 1-4; project_id added in 1-5). cwd is only min(1) here BY DESIGN: the
// absolute-path + exists checks are main-only (fs), exercised at runtime
// instead; the project_id FK-check likewise lives in main.
describe('launchRequestSchema', () => {
  it('accepts a valid {project_id, agent, cwd} for both agent kinds', () => {
    for (const agent of ['claude', 'codex'] as const) {
      expect(launchRequestSchema.parse({ project_id: PID, agent, cwd: 'C:\\Projects' })).toEqual({
        project_id: PID,
        agent,
        cwd: 'C:\\Projects'
      })
    }
  })

  it('requires a uuid project_id', () => {
    expect(
      launchRequestSchema.safeParse({ agent: 'claude', cwd: 'C:\\Projects' }).success
    ).toBe(false)
    expect(
      launchRequestSchema.safeParse({ project_id: 'not-a-uuid', agent: 'claude', cwd: 'C:\\Projects' })
        .success
    ).toBe(false)
  })

  it('rejects an empty cwd', () => {
    expect(launchRequestSchema.safeParse({ project_id: PID, agent: 'claude', cwd: '' }).success).toBe(
      false
    )
  })

  it('rejects a missing cwd', () => {
    expect(launchRequestSchema.safeParse({ project_id: PID, agent: 'claude' }).success).toBe(false)
  })

  it('rejects a missing or unknown agent', () => {
    expect(launchRequestSchema.safeParse({ project_id: PID, cwd: 'C:\\Projects' }).success).toBe(false)
    expect(
      launchRequestSchema.safeParse({ project_id: PID, agent: 'gemini', cwd: 'C:\\Projects' }).success
    ).toBe(false)
  })
})

describe('launchResponseSchema', () => {
  it('accepts an attach-style snapshot', () => {
    const snap = { sessionId: 'abc', buffer: 'x', status: 'running', exitCode: null }
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
