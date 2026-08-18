import { describe, it, expect } from 'vitest'
import { API_SESSION_FAILURE, type ApiSessionDeps, type TokenUsage } from './apiSession'
import type { ApiLaunchSpec, ApiSessionHandle } from '../adapters/types'
import type { NewDispatchRow } from '../db/schema'
import { REFINE_TIMEOUT_MS, classifyRefusal, createVoiceRefiner, type RefineRouteResult } from './voiceRefine'

/**
 * The transport is INJECTED and scripted. Every path — success, transport
 * error, timeout, refusal, empty, validation, not-configured, no-credential —
 * is driven here with no network, and every one asserts two things: the text
 * that comes back is the ORIGINAL unless the refinement validated, and the
 * handle was disposed.
 */

type Script =
  | { kind: 'reply'; text: string; usage?: TokenUsage | null; finish?: string }
  | { kind: 'refuse'; reason: string; usage?: TokenUsage | null }
  | { kind: 'throw' }

function harness(opts: { script?: Script; route?: RefineRouteResult; recordThrows?: boolean } = {}) {
  const script: Script = opts.script ?? { kind: 'reply', text: 'Fix the parser.' }
  const rows: NewDispatchRow[] = []
  const specs: ApiLaunchSpec[] = []
  const sessionDeps: ApiSessionDeps[] = []
  let disposed = 0
  let created = 0
  let routeCalls = 0
  let clock = 1_000_000

  const route: RefineRouteResult = opts.route ?? {
    ok: true,
    route: {
      credential: { envVarName: 'OPENROUTER_API_KEY', value: 'sk-or-secret', isSecret: true },
      baseUrl: 'https://openrouter.ai/api/v1',
      modelId: 'anthropic/claude-haiku-4.5',
      providerName: 'OpenRouter'
    }
  }

  const refiner = createVoiceRefiner({
    createSession: (spec, deps) => {
      created += 1
      specs.push(spec)
      sessionDeps.push(deps)
      const handle: ApiSessionHandle = {
        sessionId: spec.sessionId,
        async send() {
          if (script.kind === 'throw') throw new Error('socket exploded')
          if (script.kind === 'refuse') {
            if (script.usage) deps.onUsage?.(script.usage)
            deps.onRefusal?.(script.reason)
          }
        },
        async *receive() {
          if (script.kind === 'reply') {
            // Two chunks, so accumulation is real.
            const mid = Math.floor(script.text.length / 2)
            yield script.text.slice(0, mid)
            yield script.text.slice(mid)
            if (script.usage !== null) {
              deps.onUsage?.(
                script.usage ?? { tokensIn: 120, tokensOut: 18, tokensCached: null, costUsd: 0.000234 }
              )
            }
            if (script.finish) deps.onFinishReason?.(script.finish)
          }
        },
        async dispose() {
          disposed += 1
        }
      }
      return handle
    },
    resolveRoute: async () => {
      routeCalls += 1
      return route
    },
    recordDispatch: (row) => {
      if (opts.recordThrows) throw new Error('disk full')
      rows.push(row)
    },
    now: () => new Date((clock += 250)),
    newId: () => 'refine-0001'
  })

  return {
    refiner,
    rows,
    specs,
    sessionDeps,
    disposed: () => disposed,
    created: () => created,
    routeCalls: () => routeCalls
  }
}

const target = { sessionId: 'sess-1', projectId: 'proj-1', cwd: 'C:\\repo' }

describe('voiceRefine — Verbatim is the offline floor', () => {
  it('makes NO call, resolves NO route, writes NO row', async () => {
    const h = harness()
    const out = await h.refiner.refine({ original: 'um fix the parser', mode: 'verbatim', target })
    expect(out).toEqual({ text: 'um fix the parser', refined: false, mode: 'verbatim', fallback: 'verbatim', failure: null })
    expect(h.created()).toBe(0)
    expect(h.routeCalls()).toBe(0)
    expect(h.rows).toHaveLength(0)
  })
})

describe('voiceRefine — the happy path', () => {
  it('sends the mode prompt over the injected session and returns the validated refinement', async () => {
    const h = harness({ script: { kind: 'reply', text: 'Fix the parser in ipc.ts.' } })
    const out = await h.refiner.refine({ original: 'um fix the parser in ipc.ts', mode: 'cleanup', target })
    expect(out.refined).toBe(true)
    expect(out.text).toBe('Fix the parser in ipc.ts.')
    expect(out.fallback).toBeNull()
    // The spec: the credential and the system prompt ride the launch spec, the
    // transcript is the user turn (asserted via the prompt module elsewhere).
    expect(h.specs[0]?.credential.value).toBe('sk-or-secret')
    expect(h.specs[0]?.systemPrompt).toContain('CLEAN UP')
    expect(h.specs[0]?.sessionId).toBe('voice-refine:refine-0001')
    // The bounds: a short wall clock and an output cap.
    expect(h.sessionDeps[0]?.maxWallClockMs).toBe(REFINE_TIMEOUT_MS)
    expect(h.sessionDeps[0]?.maxOutputTokens).toBe(256)
    // ⚠ onUsage IS WIRED (D157). The summarizer's omission is the anti-pattern.
    expect(typeof h.sessionDeps[0]?.onUsage).toBe('function')
    expect(h.disposed()).toBe(1)
  })

  it('Organize sends a DIFFERENT prompt from Clean up', async () => {
    const h = harness({ script: { kind: 'reply', text: 'Fix the parser.' } })
    await h.refiner.refine({ original: 'fix the parser', mode: 'organize', target })
    expect(h.specs[0]?.systemPrompt).toContain('ORGANIZE')
  })

  it('onUsage fires → the dispatches row carries tokens, the gateway cost, and tokens_source', async () => {
    const h = harness({
      script: {
        kind: 'reply',
        text: 'Fix the parser.',
        usage: { tokensIn: 120, tokensOut: 18, tokensCached: 40, costUsd: 0.000234 }
      }
    })
    await h.refiner.refine({ original: 'um fix the parser', mode: 'cleanup', target })
    expect(h.rows).toHaveLength(1)
    const row = h.rows[0]
    expect(row).toMatchObject({
      id: 'refine-0001',
      sessionId: 'sess-1',
      projectId: 'proj-1',
      cwd: 'C:\\repo',
      agent: 'voice',
      model: 'anthropic/claude-haiku-4.5',
      providerName: 'OpenRouter',
      authMode: 'api_key',
      outcome: 'completed',
      closedBy: null,
      tokensIn: 120,
      tokensOut: 18,
      tokensCached: 40,
      costUsd: 0.000234,
      tokensSource: 'api-usage',
      attributionState: 'none',
      mintedKeyHash: null
    })
    expect(typeof row.startedAt).toBe('string')
    expect(typeof row.endedAt).toBe('string')
  })

  it('onUsage never fires → the row records ABSENT usage as NULL, never 0', async () => {
    const h = harness({ script: { kind: 'reply', text: 'Fix the parser.', usage: null } })
    await h.refiner.refine({ original: 'um fix the parser', mode: 'cleanup', target })
    expect(h.rows).toHaveLength(1)
    const row = h.rows[0]
    expect(row.tokensIn).toBeNull()
    expect(row.tokensOut).toBeNull()
    expect(row.tokensCached).toBeNull()
    expect(row.costUsd).toBeNull()
    expect(row.tokensSource).toBeNull()
    // And explicitly not zero.
    expect(row.tokensIn).not.toBe(0)
    expect(row.costUsd).not.toBe(0)
  })

  it('a usage frame WITHOUT a cost keeps the tokens and leaves the cost NULL', async () => {
    const h = harness({
      script: { kind: 'reply', text: 'Fix the parser.', usage: { tokensIn: 50, tokensOut: 9, tokensCached: null, costUsd: null } }
    })
    await h.refiner.refine({ original: 'um fix the parser', mode: 'cleanup', target })
    expect(h.rows[0]).toMatchObject({ tokensIn: 50, tokensOut: 9, costUsd: null, tokensSource: 'api-usage' })
  })

  it('a null target still stores a row: the columns are opaque, not FKs', async () => {
    const h = harness()
    await h.refiner.refine({
      original: 'um fix the parser',
      mode: 'cleanup',
      target: { sessionId: null, projectId: null, cwd: null }
    })
    expect(h.rows[0]).toMatchObject({ sessionId: null, projectId: null, cwd: '' })
  })

  it('a storage error while recording spend does not cost the user the refinement', async () => {
    const h = harness({ recordThrows: true })
    const out = await h.refiner.refine({ original: 'um fix the parser', mode: 'cleanup', target })
    expect(out.refined).toBe(true)
    expect(out.text).toBe('Fix the parser.')
    expect(h.disposed()).toBe(1)
  })
})

describe('voiceRefine — five failure paths, original preserved in each', () => {
  const original = 'bump retry_count to 7 in apiSession.ts and say "hello"'

  it('1. transport error → original, disposed, row with outcome failed', async () => {
    const h = harness({ script: { kind: 'refuse', reason: API_SESSION_FAILURE.unreachable } })
    const out = await h.refiner.refine({ original, mode: 'cleanup', target })
    expect(out).toMatchObject({ text: original, refined: false, fallback: 'transport' })
    expect(h.disposed()).toBe(1)
    expect(h.rows[0]).toMatchObject({ outcome: 'failed', tokensIn: null, costUsd: null, tokensSource: null })
  })

  it('1b. a transport that THROWS is still a transport failure — original, disposed', async () => {
    const h = harness({ script: { kind: 'throw' } })
    const out = await h.refiner.refine({ original, mode: 'cleanup', target })
    expect(out).toMatchObject({ text: original, refined: false, fallback: 'transport' })
    expect(h.disposed()).toBe(1)
    expect(h.rows[0]).toMatchObject({ outcome: 'failed' })
  })

  it('2. timeout → original, disposed', async () => {
    const h = harness({ script: { kind: 'refuse', reason: API_SESSION_FAILURE.timedOut } })
    const out = await h.refiner.refine({ original, mode: 'organize', target })
    expect(out).toMatchObject({ text: original, refined: false, fallback: 'timeout' })
    expect(h.disposed()).toBe(1)
  })

  it('3. refusal (auth / credit / rate limit) → original, disposed', async () => {
    for (const reason of [
      API_SESSION_FAILURE.authFailed,
      API_SESSION_FAILURE.paymentRequired,
      API_SESSION_FAILURE.rateLimited
    ]) {
      const h = harness({ script: { kind: 'refuse', reason } })
      const out = await h.refiner.refine({ original, mode: 'cleanup', target })
      expect(out).toMatchObject({ text: original, refined: false, fallback: 'refused' })
      expect(h.disposed()).toBe(1)
    }
  })

  it('3b. a refusal that arrived WITH a usage frame still records the spend', async () => {
    const h = harness({
      script: {
        kind: 'refuse',
        reason: API_SESSION_FAILURE.timedOut,
        usage: { tokensIn: 100, tokensOut: 5, tokensCached: null, costUsd: 0.0001 }
      }
    })
    await h.refiner.refine({ original, mode: 'cleanup', target })
    expect(h.rows[0]).toMatchObject({ outcome: 'failed', tokensIn: 100, tokensOut: 5, costUsd: 0.0001, tokensSource: 'api-usage' })
  })

  it('4. empty response → original, disposed, row with outcome completed', async () => {
    const h = harness({ script: { kind: 'reply', text: '   \n' } })
    const out = await h.refiner.refine({ original, mode: 'cleanup', target })
    expect(out).toMatchObject({ text: original, refined: false, fallback: 'empty' })
    expect(h.disposed()).toBe(1)
    expect(h.rows[0]).toMatchObject({ outcome: 'completed' })
  })

  it('5. validation failure (a dropped number) → original, disposed, failure named', async () => {
    const h = harness({ script: { kind: 'reply', text: 'Bump retry_count in apiSession.ts and say "hello".' } })
    const out = await h.refiner.refine({ original, mode: 'cleanup', target })
    expect(out).toMatchObject({ text: original, refined: false, fallback: 'validation', failure: 'digits' })
    expect(h.disposed()).toBe(1)
    // The call completed and cost money: it is a completed run in the ledger.
    expect(h.rows[0]).toMatchObject({ outcome: 'completed' })
  })

  it('5b. validation failure (a renamed identifier) → original', async () => {
    const h = harness({ script: { kind: 'reply', text: 'Bump retryCount to 7 in apiSession.ts and say "hello".' } })
    const out = await h.refiner.refine({ original, mode: 'cleanup', target })
    expect(out).toMatchObject({ text: original, fallback: 'validation', failure: 'identifier' })
  })

  it('6. TRUNCATION (finish_reason: length) → original, BEFORE the invention check', async () => {
    // A cut-off reply that would PASS every content rule: same digits, same
    // identifier, same quote, length inside 0.4x–1.5x — only the last words
    // are missing. The provider's own signal is what catches it.
    const h = harness({
      script: { kind: 'reply', text: 'Bump retry_count to 7 in apiSession.ts and say "hello" and', finish: 'length' }
    })
    const out = await h.refiner.refine({ original, mode: 'cleanup', target })
    expect(out).toMatchObject({ text: original, refined: false, fallback: 'truncated', failure: null })
    expect(h.disposed()).toBe(1)
    // The call completed and cost money.
    expect(h.rows[0]).toMatchObject({ outcome: 'completed' })
  })

  it('6b. finish_reason: stop (or none) leaves judgement to the invention check', async () => {
    const h = harness({ script: { kind: 'reply', text: 'Bump retry_count to 7 in apiSession.ts and say "hello".', finish: 'stop' } })
    const out = await h.refiner.refine({ original, mode: 'cleanup', target })
    expect(out.refined).toBe(true)
  })

  it('5c. validation failure (a changed quote) → original', async () => {
    const h = harness({ script: { kind: 'reply', text: 'Bump retry_count to 7 in apiSession.ts and say "hi".' } })
    const out = await h.refiner.refine({ original, mode: 'cleanup', target })
    expect(out).toMatchObject({ text: original, fallback: 'validation', failure: 'quote' })
  })
})

describe('voiceRefine — the two configuration paths', () => {
  it('no refiner configured → original, no call, no row, and the reason says so', async () => {
    const h = harness({ route: { ok: false, reason: 'not-configured' } })
    const out = await h.refiner.refine({ original: 'fix the parser', mode: 'cleanup', target })
    expect(out).toMatchObject({ text: 'fix the parser', refined: false, fallback: 'not-configured' })
    expect(h.created()).toBe(0)
    expect(h.rows).toHaveLength(0)
  })

  it('a refiner whose credential cannot be resolved → original, no call, no row', async () => {
    const h = harness({ route: { ok: false, reason: 'no-credential' } })
    const out = await h.refiner.refine({ original: 'fix the parser', mode: 'organize', target })
    expect(out).toMatchObject({ text: 'fix the parser', refined: false, fallback: 'no-credential' })
    expect(h.created()).toBe(0)
    expect(h.rows).toHaveLength(0)
  })

  it('an empty original never dials out', async () => {
    const h = harness()
    const out = await h.refiner.refine({ original: '   ', mode: 'cleanup', target })
    expect(out).toMatchObject({ text: '   ', refined: false, fallback: 'empty' })
    expect(h.routeCalls()).toBe(0)
    expect(h.created()).toBe(0)
  })

  it('the route is resolved PER refinement, never cached', async () => {
    const h = harness()
    await h.refiner.refine({ original: 'fix the parser', mode: 'cleanup', target })
    await h.refiner.refine({ original: 'fix the lexer', mode: 'cleanup', target })
    expect(h.routeCalls()).toBe(2)
  })
})

describe('voiceRefine — classifyRefusal is by identity, not prose', () => {
  it('maps the transport table into the closed fallback vocabulary', () => {
    expect(classifyRefusal(API_SESSION_FAILURE.timedOut)).toBe('timeout')
    expect(classifyRefusal(API_SESSION_FAILURE.authFailed)).toBe('refused')
    expect(classifyRefusal(API_SESSION_FAILURE.paymentRequired)).toBe('refused')
    expect(classifyRefusal(API_SESSION_FAILURE.rateLimited)).toBe('refused')
    expect(classifyRefusal(API_SESSION_FAILURE.unreachable)).toBe('transport')
    expect(classifyRefusal(API_SESSION_FAILURE.midStream)).toBe('transport')
    expect(classifyRefusal(API_SESSION_FAILURE.interrupted)).toBe('transport')
    // A 4xx the transport did not name is the provider REJECTING the request
    // (an unknown model id is a 400/404); a 5xx is the provider failing.
    expect(classifyRefusal('Unexpected response (400).')).toBe('refused')
    expect(classifyRefusal('Unexpected response (404).')).toBe('refused')
    expect(classifyRefusal('Unexpected response (503).')).toBe('transport')
    expect(classifyRefusal('Unexpected response (418).')).toBe('refused')
    // A reworded sentence that merely CONTAINS "time" is not a timeout.
    expect(classifyRefusal('The response took its time.')).toBe('transport')
  })
})
