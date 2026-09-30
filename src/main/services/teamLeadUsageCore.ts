/** Exact assigned Claude transcript accounting. Persist metadata only, never prompts or reasoning. */
export function summarizeTeamLeadTranscript(transcript: string, sessionId: string) {
  const messages = new Map<string, { usage: Record<string, number>; model: string | null; calls: Map<string, { name: string; input: any }> }>()
  const results = new Map<string, string>()
  let invalidLines = 0
  for (const line of transcript.split('\n')) {
    if (!line.trim()) continue
    let record: any
    try { record = JSON.parse(line) } catch { invalidLines++; continue }
    if (record.sessionId !== sessionId) continue
    if (record.type === 'assistant' && typeof record.message?.id === 'string') {
      const item = record.message, prior = messages.get(item.id) ?? { usage: {}, model: null, calls: new Map() }
      if (item.usage) prior.usage = item.usage
      if (typeof item.model === 'string') prior.model = item.model
      for (const block of item.content ?? []) if (block.type === 'tool_use' && typeof block.id === 'string') prior.calls.set(block.id, { name: String(block.name), input: block.input ?? {} })
      messages.set(item.id, prior)
    }
    if (record.type === 'user') for (const block of record.message?.content ?? []) if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') results.set(block.tool_use_id, typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? null))
  }
  const values = [...messages.values()].filter(m => Object.keys(m.usage).length)
  const sum = (key: string, rows = values) => rows.reduce((n, m) => n + (Number.isFinite(m.usage[key]) ? m.usage[key] : 0), 0)
  const ttl = (key: string) => values.reduce((n, m) => n + ((m.usage as any).cache_creation?.[key] ?? 0), 0)
  const activity = [...messages.entries()].filter(([, m]) => Object.keys(m.usage).length).map(([messageId, m]) => {
    const calls = [...m.calls.entries()].map(([id, c]) => {
      const reviews = c.name.endsWith('team_review_many') ? c.input.reviews ?? [] : c.name.endsWith('team_review') ? [c.input] : []
      const tasks = c.name.endsWith('team_delegate_many') ? c.input.tasks ?? [] : c.name.endsWith('team_delegate') ? [c.input] : []
      let waitResult: any = null
      if (c.name.endsWith('team_wait')) {
        try {
          let parsed = JSON.parse(results.get(id) ?? 'null')
          if (Array.isArray(parsed)) parsed = JSON.parse(parsed.find((b: any) => b.type === 'text')?.text ?? 'null')
          if (parsed?.content) parsed = JSON.parse(parsed.content.find((b: any) => b.type === 'text')?.text ?? 'null')
          waitResult = parsed?.result ?? parsed
        } catch { /* Unknown result encoding remains unknown. */ }
      }
      return { id, name: c.name, ...(c.name.endsWith('team_wait') ? { waitTarget: c.input.target ?? 'events', waitReason: typeof waitResult?.wakeReason === 'string' ? waitResult.wakeReason : typeof waitResult?.reason === 'string' ? waitResult.reason : null,
        brokerSegments: Number.isFinite(waitResult?.wait?.brokerSegments) ? waitResult.wait.brokerSegments : null, elapsedMs: Number.isFinite(waitResult?.wait?.elapsedMs) ? waitResult.wait.elapsedMs : null } : {}), argumentCharacters: JSON.stringify(c.input).length, resultCharacters: results.get(id)?.length ?? null,
        briefCharacters: tasks.map((t: any) => String(t.brief ?? '').length + String(t.context ?? '').length), inlineEvidenceCharacters: reviews.reduce((n: number, r: any) => n + (r.tests ?? []).reduce((a: number, t: any) => a + String(t.output ?? '').length, 0), 0) }
    })
    const names = calls.map(c => c.name)
    const category = names.some(n => /team_delegate(?:_many)?$/.test(n)) ? 'delegation'
      : names.some(n => /team_review(?:_many)?$/.test(n)) ? 'review'
      : names.some(n => /team_wait$/.test(n)) ? 'waiting'
      : names.some(n => /^(Edit|Write|NotebookEdit)$/.test(n)) ? 'implementation' : 'other'
    return { messageId, category, outputTokens: m.usage.output_tokens ?? 0, cacheReadTokens: m.usage.cache_read_input_tokens ?? 0, calls }
  })
  const buckets = [...new Set(activity.map(a => a.category))].map(category => {
    const rows = activity.filter(a => a.category === category)
    return { category, modelRequests: rows.length, toolCalls: rows.reduce((n, a) => n + a.calls.length, 0), outputTokens: rows.reduce((n, a) => n + a.outputTokens, 0), cacheReadTokens: rows.reduce((n, a) => n + a.cacheReadTokens, 0) }
  })
  return { usage: values.length ? { inputTokens: sum('input_tokens'), outputTokens: sum('output_tokens'), cacheReadTokens: sum('cache_read_input_tokens'), cacheCreationTokens: sum('cache_creation_input_tokens'), cacheCreation5mTokens: ttl('ephemeral_5m_input_tokens'), cacheCreation1hTokens: ttl('ephemeral_1h_input_tokens'), messages: values.length } : null,
    modelRequests: values.length, toolCalls: activity.reduce((n, a) => n + a.calls.length, 0), models: [...new Set(values.flatMap(m => m.model ? [m.model] : []))], buckets, activity, invalidLines }
}


/** Union of actual concurrent execution intervals, including retries and unordered records. */
export function summarizeTeamAttemptTimings(attempts: readonly { taskId: string; memberId: string; startedAt: string | null; endedAt: string | null; preparationDeadline: string | null }[], preparationMs: number) {
  const intervals = attempts.flatMap(a => {
    const start = Date.parse(a.startedAt ?? ''), end = Date.parse(a.endedAt ?? '')
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return []
    const reserved = Date.parse(a.preparationDeadline ?? '') - preparationMs
    return [{ taskId: a.taskId, memberId: a.memberId, start, end, executionSeconds: (end - start) / 1000,
      preparationSeconds: Number.isFinite(reserved) && reserved <= start ? (start - reserved) / 1000 : null }]
  })
  const points = [...new Set(intervals.flatMap(i => [i.start, i.end]))].sort((a, b) => a - b)
  let overlapMs = 0
  for (let n = 1; n < points.length; n++) {
    const active = new Set(intervals.filter(i => i.start <= points[n - 1] && i.end >= points[n]).map(i => i.memberId))
    if (active.size >= 2) overlapMs += points[n] - points[n - 1]
  }
  return { intervals, overlap: overlapMs > 0, overlapSeconds: overlapMs / 1000 }
}
