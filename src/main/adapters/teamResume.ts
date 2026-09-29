import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { verifyCodexTeamConversation } from './codex'

/** Bounded, read-only evidence from the installed CLI's measured conversation format. */
export function verifyTeamConversation(input: { harness: 'claude' | 'codex'; sessionId: string; conversationId: string; cwd: string; launchTimes: number[]; assignedConversationIds: string[] }): boolean {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.conversationId)) return false
  if (input.harness === 'codex') return verifyCodexTeamConversation(input)
  if (!input.assignedConversationIds.includes(input.conversationId)) return false
  const directory = path.resolve(input.cwd).replace(/[^a-zA-Z0-9]/g, '-')
  const file = path.join(os.homedir(), '.claude', 'projects', directory, `${input.conversationId}.jsonl`)
  let descriptor: number | undefined
  try {
    descriptor = fs.openSync(file, 'r')
    const buffer = Buffer.alloc(256 * 1024), length = fs.readSync(descriptor, buffer, 0, buffer.length, 0)
    const text = buffer.subarray(0, length).toString('utf8')
    for (const line of text.split('\n').slice(0, -1)) {
      let record: { cwd?: unknown; sessionId?: unknown }
      try { record = JSON.parse(line) } catch { continue }
      if (record.sessionId === input.conversationId && typeof record.cwd === 'string' && path.resolve(record.cwd).toLowerCase() === path.resolve(input.cwd).toLowerCase()) return true
    }
    return false
  } catch { return false } finally { if (descriptor !== undefined) fs.closeSync(descriptor) }
}
