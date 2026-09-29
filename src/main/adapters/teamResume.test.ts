import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { verifyTeamConversation } from './teamResume'
const roots: string[] = []
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
describe('verified Team conversation replacement', () => {
  it('requires the Claude pointer file to identify the exact integration workspace', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-team-resume-')); roots.push(root); vi.spyOn(os, 'homedir').mockReturnValue(root)
    const cwd = path.join(root, 'workspace'), id = '00000000-0000-4000-8000-000000000020'
    const input = { harness: 'claude' as const, sessionId: 'pane', conversationId: id, cwd, launchTimes: [], assignedConversationIds: [id] }
    expect(verifyTeamConversation(input)).toBe(false)
    const directory = path.join(root, '.claude', 'projects', path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-')); fs.mkdirSync(directory, { recursive: true })
    const file = path.join(directory, `${id}.jsonl`)
    fs.writeFileSync(file, JSON.stringify({ sessionId: id, cwd: cwd + '-sibling' }) + '\n')
    expect(verifyTeamConversation(input)).toBe(false)
    fs.writeFileSync(file, JSON.stringify({ sessionId: id, cwd }) + '\n')
    expect(verifyTeamConversation(input)).toBe(true)
    expect(verifyTeamConversation({ ...input, assignedConversationIds: [] })).toBe(false)
    expect(verifyTeamConversation({ ...input, conversationId: '../../other' })).toBe(false)
  })
  it('requires Codex exact pane stamp as well as conversation and workspace identity', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-team-resume-')); roots.push(root); vi.spyOn(os, 'homedir').mockReturnValue(root)
    const time = Date.parse('2026-09-20T20:00:00Z'), cwd = path.join(root, 'workspace'), id = '00000000-0000-4000-8000-000000000020'
    const dir = path.join(root, '.codex', 'sessions', '2026', '09', '20'); fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `rollout-2026-09-20-${id}.jsonl`)
    const input = { harness: 'codex' as const, sessionId: 'pane', conversationId: id, cwd, launchTimes: [time], assignedConversationIds: [] }
    const record = (originator: string) => JSON.stringify({ type: 'session_meta', payload: { session_id: id, cwd, timestamp: new Date(time).toISOString(), originator } }) + '\n'
    fs.writeFileSync(file, record('chorus-other')); expect(verifyTeamConversation(input)).toBe(false)
    fs.writeFileSync(file, record('chorus-pane')); expect(verifyTeamConversation(input)).toBe(true)
    expect(verifyTeamConversation({ ...input, cwd: cwd + '-sibling' })).toBe(false)
  })
})
