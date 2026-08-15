import { describe, expect, it } from 'vitest'
import { summarizeDay, tidySummary } from './dayReportSummarizer'
import type { DayEvidence } from './dayReportCore'

const EVIDENCE: DayEvidence = {
  date: '2026-08-15',
  generatedAt: '2026-08-15T22:00:00.000Z',
  identities: ['me@example.com'],
  repos: [
    {
      repoKey: 'k',
      projectNames: ['Chorus'],
      commits: [{ sha: 'abc1234', at: 'x', subject: 'Add the day report', files: [] }],
      dirty: [],
      symbols: [],
      tests: []
    }
  ],
  skipped: []
}

const EMPTY: DayEvidence = { ...EVIDENCE, repos: [] }

describe('D153: summary tidying', () => {
  it('unwraps a code fence the model was told not to use', () => {
    expect(tidySummary('```\nShipped the day report.\n```')).toBe('Shipped the day report.')
    expect(tidySummary('```markdown\nShipped it.\n```')).toBe('Shipped it.')
  })

  it('drops a leading heading and flattens stray bullets into a paragraph', () => {
    expect(tidySummary('# Summary\n\nShipped the report.')).toBe('Shipped the report.')
    expect(tidySummary('- Did a thing.\n- Did another.')).toBe('Did a thing. Did another.')
  })

  it('truncates an essay rather than rejecting it', () => {
    const long = 'x'.repeat(5000)
    const out = tidySummary(long)
    expect(out.length).toBeLessThanOrEqual(1200)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('D153: summarizing a day', () => {
  it('returns the model’s prose on the happy path', async () => {
    const r = await summarizeDay(EVIDENCE, {
      complete: async () => 'Built the cross-project day report and its git collector.'
    })
    expect(r.summary).toBe('Built the cross-project day report and its git collector.')
    expect(r.error).toBeNull()
  })

  it('⚠ NEVER THROWS — a failed model call yields a reason, and the report still renders', async () => {
    const r = await summarizeDay(EVIDENCE, {
      complete: async () => {
        throw new Error('402 Payment Required')
      }
    })
    expect(r.summary).toBeNull()
    expect(r.error).toContain('402 Payment Required')
  })

  it('says plainly when no summarizer is configured', async () => {
    const r = await summarizeDay(EVIDENCE, null)
    expect(r.summary).toBeNull()
    expect(r.error).toContain('No summarizer model is configured')
  })

  it('⚠ NEVER ASKS A MODEL TO SUMMARISE AN EMPTY DAY — it would invent one', async () => {
    let called = false
    const r = await summarizeDay(EMPTY, {
      complete: async () => {
        called = true
        return 'A productive day of deep work.'
      }
    })
    expect(called).toBe(false)
    expect(r.summary).toBeNull()
    // Not an error: an empty day is a correct answer, not a failure.
    expect(r.error).toBeNull()
  })

  it('treats an empty response as a failure rather than as prose', async () => {
    const r = await summarizeDay(EVIDENCE, { complete: async () => '   ' })
    expect(r.summary).toBeNull()
    expect(r.error).toContain('empty response')
  })

  it('sends the system prompt and the evidence, and no file content', async () => {
    let seenSystem = ''
    let seenUser = ''
    await summarizeDay(EVIDENCE, {
      complete: async (s, u) => {
        seenSystem = s
        seenUser = u
        return 'ok'
      }
    })
    expect(seenSystem).toContain('timesheet')
    expect(seenSystem).toContain('Never mention which AI agent')
    expect(seenUser).toContain('Add the day report')
    expect(seenUser).not.toContain('diff --git')
  })
})
