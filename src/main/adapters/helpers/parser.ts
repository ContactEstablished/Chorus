import { StringDecoder } from 'node:string_decoder'
import { MAX_HELPER_RECORD_BYTES } from './common'
import type { HelperEvent, HelperEventParser, HelperId, HelperUsage } from './types'

type RecordValue = Record<string, any>
const object = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value)
const count = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

/** Bounded JSONL decoder. A terminal result is evidence, never process-exit or task acceptance. */
export function createHelperParser(kind: HelperId): HelperEventParser {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  let failed = false
  let finished = false
  let terminal = false
  let permissionBlocked = false
  let summary = ''
  let session: string | null = null
  const fail = (reason: string): HelperEvent[] => {
    failed = true
    pending = ''
    return [{ type: 'protocol-error', reason }]
  }
  const usage = (raw: RecordValue, source: string, cost: unknown, estimated = false, recordId?: string): HelperEvent => ({
    type: 'usage', usage: {
      inputTokens: count(raw.input_tokens ?? raw.input), outputTokens: count(raw.output_tokens ?? raw.output),
      cachedTokens: count(raw.cached_input_tokens ?? raw.cache_read_input_tokens ?? raw.cache?.read),
      costUsd: count(cost), costKind: count(cost) === null ? 'unknown' : estimated ? 'list-price-estimate' : 'reported', source,
      cacheCreationTokens: count(raw.cache_creation_input_tokens ?? raw.cache?.write), reasoningTokens: count(raw.reasoning_tokens ?? raw.reasoning), totalTokens: count(raw.total_tokens ?? raw.total),
      ...(recordId ? { recordId } : {}), accounting: source === 'claude-result' ? 'cumulative' : 'delta'
    } satisfies HelperUsage
  })
  const result = (text: unknown, isError: boolean, failure?: Extract<HelperEvent, { type: 'result' }>['failure']): HelperEvent[] => {
    if (terminal) return fail('Duplicate helper terminal result.')
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_HELPER_RECORD_BYTES) return fail('Invalid or oversized helper result.')
    terminal = true
    return [{ type: 'result', summary: text, isError: isError || permissionBlocked, ...(failure ? { failure } : {}) }]
  }
  const parse = (line: string): HelperEvent[] => {
    if (Buffer.byteLength(line) > MAX_HELPER_RECORD_BYTES) return fail('Helper record exceeds 1 MiB.')
    let e: RecordValue
    try { e = JSON.parse(line) } catch { return fail('Malformed helper JSON record.') }
    if (!object(e) || typeof e.type !== 'string') return fail('Invalid helper event envelope.')
    const out: HelperEvent[] = []
    if (kind === 'claude') {
      if (e.type === 'system' && e.subtype === 'init') {
        session = typeof e.session_id === 'string' ? e.session_id : null
        out.push({ type: 'started', sessionId: session })
      } else if (e.type === 'system' && e.subtype === 'permission_denied') {
        permissionBlocked = true
        out.push({ type: 'permission-blocked', reason: 'Claude reported a denied permission.' })
      } else if (e.type === 'user' && object(e.message) && Array.isArray(e.message.content)) {
        for (const part of e.message.content) {
          if (object(part) && part.type === 'tool_result' && part.is_error === true && typeof part.content === 'string' && /No such tool available: [A-Za-z]+\. [A-Za-z]+ is disabled for this session/.test(part.content)) {
            permissionBlocked = true
            out.push({ type: 'permission-blocked', reason: 'Claude refused a tool disabled by this session policy.' })
          }
        }
      } else if (e.type === 'assistant' && object(e.message) && Array.isArray(e.message.content)) {
        for (const part of e.message.content) if (object(part) && part.type === 'text' && typeof part.text === 'string') out.push({ type: 'activity', text: part.text, category: 'message' })
      } else if (e.type === 'result') {
        if (typeof e.is_error !== 'boolean' || typeof e.subtype !== 'string') return fail('Invalid Claude completion.')
        const denied = Array.isArray(e.permission_denials) && e.permission_denials.length > 0
        if (denied) out.push({ type: 'permission-blocked', reason: 'Claude reported denied tool calls.' })
        if (object(e.usage)) out.push(usage(e.usage, 'claude-result', e.total_cost_usd, true))
        out.push(...result(e.result ?? (e.is_error ? 'Claude reported an unsuccessful result.' : undefined), e.is_error || e.subtype !== 'success' || denied))
      }
    } else if (kind === 'codex') {
      if (e.type === 'thread.started' && typeof e.thread_id === 'string') out.push({ type: 'started', sessionId: e.thread_id })
      else if (e.type === 'item.completed' && object(e.item)) {
        if (e.item.type === 'agent_message' && typeof e.item.text === 'string') {
          summary = e.item.text
          out.push({ type: 'activity', text: summary, category: 'message' })
        } else if (e.item.type === 'command_execution') {
          out.push({ type: 'activity', text: typeof e.item.aggregated_output === 'string' ? e.item.aggregated_output : '', category: 'command' })
        } else if (e.item.type === 'mcp_tool_call' && e.item.error) {
          out.push({ type: 'activity', text: 'Codex reported a failed MCP tool call.', category: 'tool-error' })
        }
      } else if (e.type === 'turn.completed') {
        if (!object(e.usage) || !summary) return fail('Codex completion lacks usage or a final message.')
        out.push(usage(e.usage, 'codex-turn', null), ...result(summary, false))
      } else if (e.type === 'turn.failed' || e.type === 'error') {
        out.push(...result('Codex reported an unsuccessful turn.', true))
      }
    } else {
      if (typeof e.sessionID === 'string' && session === null) {
        session = e.sessionID
        out.push({ type: 'started', sessionId: session })
      }
      if (e.type === 'text' && object(e.part) && typeof e.part.text === 'string') {
        summary = e.part.text
        out.push({ type: 'activity', text: summary, category: 'message' })
      } else if (e.type === 'tool_use' && object(e.part) && object(e.part.state)) {
        const state = e.part.state
        if (state.status === 'error' && typeof state.error === 'string' && /^(?:The user has specified a rule which prevents you from using this specific tool call|The user rejected permission to use this specific tool call)/.test(state.error)) {
          permissionBlocked = true
          const command = object(state.input) && typeof state.input.command === 'string' ? `: ${state.input.command.slice(0, 1000)}` : ''
          out.push({ type: 'permission-blocked', reason: `opencode refused ${typeof e.part.tool === 'string' ? e.part.tool : 'a tool'} under its native permission policy${command}.` })
        }
        out.push({ type: 'activity', text: typeof state.output === 'string' ? state.output : typeof state.error === 'string' ? state.error : '', category: state.status === 'error' ? 'tool-error' : 'tool' })
      } else if (e.type === 'step_finish' && object(e.part)) {
        if (object(e.part.tokens)) out.push(usage(e.part.tokens, 'opencode-step', e.part.cost, false, typeof e.part.id === 'string' ? e.part.id : undefined))
        if (e.part.reason === 'stop') out.push(...result(summary || undefined, false))
        else if (e.part.reason !== 'tool-calls') {
          const reason = typeof e.part.reason === 'string' && /^[a-z][a-z_-]{0,63}$/.test(e.part.reason) ? e.part.reason : 'unknown'
          out.push(...result(`opencode ended with finish reason ${reason}.${reason === 'length' ? ' Generation was truncated; reduce the assignment or use a verified model budget before a counted retry.' : ''}`, true, { category: reason === 'length' ? 'generation-truncated' : 'unsuccessful-finish', finishReason: reason }))
        }
      } else if (e.type === 'error') out.push(...result('opencode reported an unsuccessful run.', true, { category: 'provider-error', finishReason: null }))
    }
    return out
  }
  const consume = (text: string): HelperEvent[] => {
    pending += text
    const out: HelperEvent[] = []
    for (;;) {
      const end = pending.indexOf('\n')
      if (end < 0) break
      const line = pending.slice(0, end).replace(/\r$/, '')
      pending = pending.slice(end + 1)
      if (line.length) out.push(...parse(line))
      if (failed) return out
    }
    if (Buffer.byteLength(pending) > MAX_HELPER_RECORD_BYTES) out.push(...fail('Helper record exceeds 1 MiB.'))
    return out
  }
  return {
    push(chunk) {
      if (finished || failed) return []
      return consume(typeof chunk === 'string' ? chunk : decoder.write(Buffer.from(chunk)))
    },
    finish() {
      if (finished || failed) return []
      finished = true
      const out = consume(decoder.end())
      if (!failed && pending.trim()) out.push(...parse(pending.replace(/\r$/, '')))
      pending = ''
      if (!failed && !terminal) out.push(...fail('Helper exited without a valid structured terminal result.'))
      return out
    }
  }
}
