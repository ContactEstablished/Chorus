import { describe, expect, it } from 'vitest'
import { summarizeTeamLeadTranscript, summarizeTeamAttemptTimings } from './teamLeadUsageCore'
describe('assigned Team lead usage', () => {
  it('records bounded wait metadata and cache TTL without retaining result bodies', () => {
    const lines = [
      { sessionId: 'assigned', type: 'assistant', message: { id: 'm', model: 'fixture', content: [{ type: 'tool_use', id: 'w', name: 'mcp__chorus-team__team_wait', input: { target: 'results' } }], usage: { output_tokens: 1, cache_creation_input_tokens: 7, cache_creation: { ephemeral_5m_input_tokens: 4, ephemeral_1h_input_tokens: 3 } } } },
      { sessionId: 'assigned', type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'w', content: [{ type: 'text', text: JSON.stringify({ wakeReason: 'ready', private: 'Do not export this', wait: { brokerSegments: 10, elapsedMs: 200000 } }) }] }] } }
    ]
    const report = summarizeTeamLeadTranscript(lines.map(l => JSON.stringify(l)).join('\n'), 'assigned')
    expect(report.usage).toMatchObject({ cacheCreation5mTokens: 4, cacheCreation1hTokens: 3 })
    expect(report.activity[0].calls[0]).toMatchObject({ waitTarget: 'results', waitReason: 'ready', brokerSegments: 10, elapsedMs: 200000 })
    expect(JSON.stringify(report)).not.toContain('Do not export this')
  })
  it('counts every content block once and usage once per request, excluding other sessions', () => {
    const record = (id: string, content: unknown[], sessionId = 'assigned') => ({ sessionId, type: 'assistant', message: { id, model: 'fixture-model', content, usage: { input_tokens: 2, output_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 } } })
    const tool = (id: string, name: string) => ({ type: 'tool_use', id, name, input: { tasks: [{ brief: 'short', context: '', references: ['SPEC.md'] }] } })
    const lines = [record('m1', [tool('t1', 'mcp__chorus-team__team_delegate_many')]), record('m1', [{ type: 'thinking', thinking: 'Never disclose reasoning.' }]), record('m1', [tool('t2', 'Read')]), record('m1', [tool('t1', 'mcp__chorus-team__team_delegate_many')]), record('other', [tool('foreign', 'Write')], 'other-session'), record('m2', [tool('t3', 'mcp__chorus-team__team_wait')])]
    const report = summarizeTeamLeadTranscript(lines.map(l => JSON.stringify(l)).join('\n'), 'assigned')
    expect(report.modelRequests).toBe(2); expect(report.toolCalls).toBe(3)
    expect(report.usage).toMatchObject({ outputTokens: 20, cacheReadTokens: 200 })
    expect(report.buckets.find(b => b.category === 'delegation')).toMatchObject({ modelRequests: 1, toolCalls: 2 })
    expect(JSON.stringify(report)).not.toContain('Never disclose reasoning')
    expect(report.activity[0].calls[0].briefCharacters).toEqual([5])
  })
})


describe('helper execution timing', () => {
  it('detects concurrency across different helpers even when retries sort adjacent', () => {
    const at = (ms: number) => new Date(ms).toISOString()
    const interval = (memberId: string, start: number, end: number) => ({ memberId, taskId: memberId, startedAt: at(start), endedAt: at(end), preparationDeadline: at(start + 299000) })
    const timings = summarizeTeamAttemptTimings([interval('a', 0, 10000), interval('a', 11000, 20000), interval('b', 1000, 15000), interval('c', 2000, 12000)], 300000)
    expect(timings.overlap).toBe(true); expect(timings.overlapSeconds).toBe(14)
    expect(timings.intervals.every(i => i.preparationSeconds === 1)).toBe(true)
    expect(summarizeTeamAttemptTimings([interval('a', 0, 10), interval('a', 1, 11)], 300000).overlap).toBe(false)
    expect(summarizeTeamAttemptTimings([{ ...interval('a', 0, 10), endedAt: null }], 300000).intervals).toEqual([])
  })
})
