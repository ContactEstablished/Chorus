import { describe, it, expect } from 'vitest'
import { launchRequestSchema, launchResponseSchema, attachRequestSchema } from './ipc'

// launchRequestSchema is the renderer->main boundary for session:launch
// (Task 1-4). cwd is only min(1) here BY DESIGN: the absolute-path + exists
// checks are main-only (fs), exercised at runtime instead.
describe('launchRequestSchema', () => {
  it('accepts a valid {agent, cwd} for both agent kinds', () => {
    for (const agent of ['claude', 'codex'] as const) {
      expect(launchRequestSchema.parse({ agent, cwd: 'C:\\Projects' })).toEqual({
        agent,
        cwd: 'C:\\Projects'
      })
    }
  })

  it('rejects an empty cwd', () => {
    expect(launchRequestSchema.safeParse({ agent: 'claude', cwd: '' }).success).toBe(false)
  })

  it('rejects a missing cwd', () => {
    expect(launchRequestSchema.safeParse({ agent: 'claude' }).success).toBe(false)
  })

  it('rejects a missing or unknown agent', () => {
    expect(launchRequestSchema.safeParse({ cwd: 'C:\\Projects' }).success).toBe(false)
    expect(launchRequestSchema.safeParse({ agent: 'gemini', cwd: 'C:\\Projects' }).success).toBe(
      false
    )
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
  it('requires the stable sessionId and passes respawn through', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000'
    expect(attachRequestSchema.safeParse({ agent: 'claude' }).success).toBe(false)
    expect(attachRequestSchema.parse({ agent: 'claude', sessionId: id, respawn: true })).toEqual({
      agent: 'claude',
      sessionId: id,
      respawn: true
    })
  })
})
