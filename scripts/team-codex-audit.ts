/** Benchmark-only reader. Never imported by the application or exposed through IPC. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function findCodexPilotTranscript(conversationId: string, cwd: string, sessionId: string, started: number): string {
  if (!/^[a-f\d-]{36}$/i.test(conversationId) || !sessionId) return ''
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
  for (const offset of [-1, 0, 1]) {
    const date = new Date(started + offset * 86400000).toISOString().slice(0, 10).split('-')
    const dir = path.join(home, 'sessions', ...date)
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir).filter(n => n.endsWith(`-${conversationId}.jsonl`))) {
      const file = path.join(dir, name), text = fs.readFileSync(file, 'utf8')
      const audit = summarizeCodexPilotTranscript(text, conversationId, cwd, sessionId)
      if (audit.identityVerified) return text
    }
  }
  return ''
}

export function summarizeCodexPilotTranscript(text: string, conversationId: string, cwd: string, sessionId: string) {
  const rows: any[] = []; let invalidLines = 0
  for (const line of text.split('\n').filter(l => l.trim())) {
    try { rows.push(JSON.parse(line)) } catch { invalidLines++ }
  }
  const meta = rows[0]?.type === 'session_meta' ? rows[0].payload : null
  const identityVerified = !!meta && (meta.id ?? meta.session_id) === conversationId && meta.originator === `chorus-${sessionId}` && typeof meta.cwd === 'string' && path.resolve(meta.cwd).toLowerCase() === path.resolve(cwd).toLowerCase()
  const empty = { identityVerified: false, usage: null, modelRequests: 0, toolCalls: 0, models: [] as string[], efforts: [] as string[], buckets: [], activity: [], invalidLines, completed: false, coverage: 'unavailable', apiEquivalentUsd: null }
  if (!identityVerified) return empty
  const models = new Set<string>(), efforts = new Set<string>(), requests = new Map<string, any>(), calls = new Map<string, any>()
  let cumulative: any = null, finalMarker = false, taskCompleteMarker = false, nativeSubagents = false
  for (const row of rows) {
    const p = row.payload
    if (row.type === 'turn_context') {
      if (p?.model) models.add(p.model)
      if (p?.effort ?? p?.reasoning_effort) efforts.add(p.effort ?? p.reasoning_effort)
    }
    if (row.type === 'token_usage_record' && (!p.thread_id || p.thread_id === conversationId) && (!p.session_id || p.session_id === conversationId)) {
      const u = p.usage
      const optionalCounters = ['cached_input_tokens', 'reasoning_output_tokens', 'cache_write_input_tokens']
      if (!p.response_id || !u || !Number.isSafeInteger(u.input_tokens) || !Number.isSafeInteger(u.output_tokens) || u.input_tokens < 0 || u.output_tokens < 0 || optionalCounters.some(key => u[key] != null && (!Number.isSafeInteger(u[key]) || u[key] < 0)) || (u.total_tokens != null && u.total_tokens !== u.input_tokens + u.output_tokens) || (u.cached_input_tokens != null && u.cached_input_tokens > u.input_tokens) || (u.reasoning_output_tokens != null && u.reasoning_output_tokens > u.output_tokens) || (u.cache_write_input_tokens != null && u.cache_write_input_tokens > u.input_tokens - (u.cached_input_tokens ?? 0))) { invalidLines++; continue }
      const prior = requests.get(p.response_id)
      if (prior && ['input_tokens', 'output_tokens', 'cached_input_tokens', 'reasoning_output_tokens', 'cache_write_input_tokens'].some(key => prior.usage[key] !== u[key])) { invalidLines++; continue }
      requests.set(p.response_id, { responseId: p.response_id, turnId: p.turn_id ?? p.root_turn_id ?? null, timestamp: row.timestamp, usage: u })
      cumulative = p.thread_token_usage ?? cumulative
    }
    if (row.type === 'event_msg' && p?.type === 'token_count') cumulative = p.info?.total_token_usage ?? cumulative
    if (row.type === 'response_item' && ['function_call', 'custom_tool_call'].includes(p?.type) && p.call_id) {
      const argument = p.arguments ?? p.input ?? '', names = /team_\w+/g
      const tools = String(p.name).includes('team_') ? [p.name] : [...new Set(String(argument).match(names) ?? [p.name])]
      nativeSubagents ||= /spawn_agent/.test(String(p.name) + String(argument))
      calls.set(p.call_id, { id: p.call_id, name: p.name, tools, argumentCharacters: String(argument).length, timestamp: row.timestamp })
    }
    if (row.type === 'response_item' && p?.type === 'message' && p.role === 'assistant' && p.phase === 'final_answer' && p.content?.some((c: any) => String(c.text ?? '').includes('PILOT_COMPLETE'))) finalMarker = true
    if (row.type === 'event_msg' && p?.type === 'task_complete' && String(p.last_agent_message ?? '').includes('PILOT_COMPLETE')) taskCompleteMarker = true
  }
  const values = [...requests.values()]
  const sum = (key: string) => values.every(r => Number.isSafeInteger(r.usage[key])) ? values.reduce((n, r) => n + r.usage[key], 0) : null
  const usage = values.length ? { inputTokens: sum('input_tokens')!, outputTokens: sum('output_tokens')!, cacheReadTokens: sum('cached_input_tokens'), cacheWriteTokens: sum('cache_write_input_tokens'), reasoningOutputTokens: sum('reasoning_output_tokens'), totalTokens: sum('input_tokens')! + sum('output_tokens')!, messages: values.length } : null
  const mismatch = usage && cumulative && [['total_tokens', 'totalTokens'], ['input_tokens', 'inputTokens'], ['output_tokens', 'outputTokens']].some(([native, normalized]) => cumulative[native] != null && (usage as any)[normalized] !== cumulative[native])
  const category = (tool: string) => /team_delegate/.test(tool) ? 'delegation' : /team_review/.test(tool) ? 'review' : /team_wait/.test(tool) ? 'waiting' : /apply_patch/.test(tool) ? 'implementation' : 'other'
  const activity = [...calls.values()].map(c => ({ ...c, category: c.tools.length === 1 ? category(c.tools[0]) : 'mixed' }))
  const buckets = [...new Set(activity.map(a => a.category))].map(c => ({ category: c, toolCalls: activity.filter(a => a.category === c).length }))
  const model = models.size === 1 ? [...models][0] : null
  const rates = model === 'gpt-6-astra' ? { input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50 } : model === 'gpt-6.1-sol' ? { input: 2, cachedInput: .1, cacheWrite: 2.5, output: 10 } : null
  let apiEquivalentUsd: any = null
  if (rates && usage && !mismatch && !invalidLines && !nativeSubagents && usage.cacheReadTokens !== null) {
    let low = 0, high = 0, missingCacheWriteRecords = 0
    for (const { usage: u } of values) {
      const long = u.input_tokens > 272000, scale = long ? 2 : 1, uncached = u.input_tokens - u.cached_input_tokens
      const known = u.cache_write_input_tokens, writes = Number.isSafeInteger(known) && known >= 0 && known <= uncached ? known : null
      if (writes === null) missingCacheWriteRecords++
      const fixed = u.cached_input_tokens * rates.cachedInput * scale + u.output_tokens * rates.output * (long ? 1.5 : 1)
      low += fixed + (writes === null ? uncached * rates.input : (uncached - writes) * rates.input + writes * rates.cacheWrite) * scale
      high += fixed + (writes === null ? uncached * rates.cacheWrite : (uncached - writes) * rates.input + writes * rates.cacheWrite) * scale
    }
    apiEquivalentUsd = { low: low / 1000000, high: high / 1000000, missingCacheWriteRecords, model, ratesPerMillion: rates, source: `https://developers.openai.com/api/docs/models/${model}`, accessed: '2026-09-30', attribution: 'Standard global API-equivalent range, not subscription billing; unknown cache-write tokens bounded by uncached input. Excludes tools, fast/regional premiums, taxes and fees.' }
  }
  return { identityVerified, usage, modelRequests: values.length, toolCalls: calls.size, models: [...models], efforts: [...efforts], buckets, activity, invalidLines, completed: finalMarker && taskCompleteMarker, coverage: !usage || mismatch || invalidLines || nativeSubagents ? 'partial' : 'verified-thread', apiEquivalentUsd }
}
