import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PreflightStep, RawEndpoint } from '../../shared/routing'
import { parseEndpointsResponse } from './endpointsCore'
import {
  PREFLIGHT_KNOWN_CLAUSE_STEPS,
  PREFLIGHT_MARKER,
  PREFLIGHT_NONEXISTENT_TAG,
  PREFLIGHT_STEP_NAMES,
  parsePreflight,
  preflightRequestBody,
  rowsPerTag,
  type PreflightParseResult
} from './preflightCore'

/** Model Routing Task 2-1, Table P (ImplementationSpec-2-1). */

interface FixtureResponse { status: number; body: unknown }

const fixtureText = (name: string): string => readFileSync(join(__dirname, '__fixtures__', name), 'utf8')

const guardrailsFixture = JSON.parse(fixtureText('preflight-guardrails-2026-10-02.json')) as FixtureResponse & { _note: string }
const dataPolicyFixture = JSON.parse(fixtureText('preflight-data-policy-2026-10-02.json')) as {
  _note: string
  withoutDeny: FixtureResponse
  withDeny: FixtureResponse
}
const golden = parseEndpointsResponse(JSON.parse(fixtureText('endpoints-deepseek-v4.1-flash-2026-10-02.json')))

/** `rowsPerTag` of the golden endpoints fixture: 32 tags, `baseten/fp8` → 2, every other tag → 1. */
const rows = rowsPerTag(golden.endpoints)

const PREFIX = 'No endpoints found for x/y. Every candidate endpoint was removed during routing: '
type FunnelEntry = [string, number]

/** A synthetic 404 body: `{ error: { message: PREFIX + tail, metadata: { routing_funnel } } }`. */
function synthetic(tail: string, funnel: FunnelEntry[]): unknown {
  return {
    error: {
      message: PREFIX + tail,
      metadata: { routing_funnel: funnel.map(([step, endpoint_count]) => ({ step, endpoint_count })) }
    }
  }
}

function parse(body: unknown, step: PreflightStep, rowCounts: Readonly<Record<string, number>>, status = 404): PreflightParseResult {
  return parsePreflight({ status, body, step, rowsPerTag: rowCounts })
}

const ok = (removed: string[]): PreflightParseResult => ({ removed, issue: null })

const GUARDED: FunnelEntry[] = [
  ['Initial Endpoints', 2],
  ['Filter by Guardrails', 1],
  ['Filter by Fallback', 0]
]

describe('the fixtures', () => {
  it('each Fallback clause plus deepseek is exactly the golden fixture’s 32 tags', () => {
    const goldenTags = [...new Set(golden.endpoints.map((e) => e.tag))].sort()
    expect(goldenTags).toHaveLength(32)
    const bodies = [guardrailsFixture.body, dataPolicyFixture.withoutDeny.body, dataPolicyFixture.withDeny.body]
    for (const body of bodies) {
      const message = (body as { error: { message: string } }).error.message
      const fallback = /Filter by Fallback removed (.+)\.$/.exec(message)
      expect(fallback).not.toBeNull()
      const tags = (fallback as RegExpExecArray)[1].split(', ')
      // 31 tags for 32 rows: baseten/fp8 has two rows (C1).
      expect(tags).toHaveLength(31)
      expect([...new Set([...tags, 'deepseek'])].sort()).toEqual(goldenTags)
    }
  })

  it('every fixture is a 404', () => {
    expect([guardrailsFixture.status, dataPolicyFixture.withoutDeny.status, dataPolicyFixture.withDeny.status]).toEqual([404, 404, 404])
  })
})

describe('Table P — the real 2026-10-02 bodies (P1–P6)', () => {
  it('P1: guardrails fixture, guardrails step → deepseek', () => {
    expect(parse(guardrailsFixture.body, 'guardrails', rows)).toStrictEqual(ok(['deepseek']))
  })

  it('P2: guardrails fixture, dataPolicy step → [] (no Data Policy clause or step)', () => {
    expect(parse(guardrailsFixture.body, 'dataPolicy', rows)).toStrictEqual(ok([]))
  })

  it('P3: data-policy fixture withoutDeny (no Apply Status Sorting), guardrails step → deepseek', () => {
    expect(parse(dataPolicyFixture.withoutDeny.body, 'guardrails', rows)).toStrictEqual(ok(['deepseek']))
  })

  it('P4: data-policy fixture withDeny, dataPolicy step → deepseek', () => {
    expect(parse(dataPolicyFixture.withDeny.body, 'dataPolicy', rows)).toStrictEqual(ok(['deepseek']))
  })

  it('P5: withDeny read for guardrails → a consistent but WRONG [] (why two preflights exist)', () => {
    // Under deny the Guardrails step is absent, so this reading says "nothing
    // removed" while the account's guardrail does remove deepseek. The service
    // reads guardrails only from the guardrails preflight.
    expect(parse(dataPolicyFixture.withDeny.body, 'guardrails', rows)).toStrictEqual(ok([]))
  })

  it('P6: guardrails fixture with no row counts → deepseek (unknown tags count 1)', () => {
    expect(parse(guardrailsFixture.body, 'guardrails', {})).toStrictEqual(ok(['deepseek']))
  })
})

describe('Table P — synthetic bodies (P7–P25)', () => {
  it('P7: nested parentheses in the reason, two tags', () => {
    const body = synthetic('Filter by Guardrails removed a/fp8, b (Reason (x) (y)); Filter by Fallback removed c.', [
      ['Initial Endpoints', 3],
      ['Filter by Guardrails', 1],
      ['Filter by Fallback', 0]
    ])
    expect(parse(body, 'guardrails', {})).toStrictEqual(ok(['a/fp8', 'b']))
  })

  const P8_BODY = synthetic('Filter by Guardrails removed baseten/fp8, x (r); Filter by Fallback removed c.', [
    ['Initial Endpoints', 4],
    ['Filter by Guardrails', 1],
    ['Filter by Fallback', 0]
  ])

  it('P8: row weighting — baseten/fp8 (2 rows) + x (1 row) = removal 3', () => {
    expect(parse(P8_BODY, 'guardrails', { 'baseten/fp8': 2 })).toStrictEqual(ok(['baseten/fp8', 'x']))
  })

  it('P9: the same body without row counts → count-mismatch (2 tags ≠ 3 rows)', () => {
    expect(parse(P8_BODY, 'guardrails', {})).toStrictEqual({ removed: null, issue: 'count-mismatch' })
  })

  it('P10: one tag against a removal of 2 → count-mismatch', () => {
    const body = synthetic('Filter by Guardrails removed deepseek (r); Filter by Fallback removed c.', [
      ['Initial Endpoints', 4],
      ['Filter by Guardrails', 2],
      ['Filter by Fallback', 0]
    ])
    expect(parse(body, 'guardrails', {})).toStrictEqual({ removed: null, issue: 'count-mismatch' })
  })

  it('P11: the real body under status 400 and 200 → unexpected-status', () => {
    expect(parse(guardrailsFixture.body, 'guardrails', rows, 400)).toStrictEqual({ removed: null, issue: 'unexpected-status' })
    expect(parse(guardrailsFixture.body, 'guardrails', rows, 200)).toStrictEqual({ removed: null, issue: 'unexpected-status' })
  })

  it('P12: no routing_funnel → unrecognized-body', () => {
    const message = (guardrailsFixture.body as { error: { message: string } }).error.message
    expect(parse({ error: { message, metadata: {} } }, 'guardrails', rows)).toStrictEqual({ removed: null, issue: 'unrecognized-body' })
  })

  it('P13: a non-string message, null, and a bare string → unrecognized-body each', () => {
    const numeric = { error: { message: 5, metadata: { routing_funnel: [{ step: 'Initial Endpoints', endpoint_count: 1 }] } } }
    for (const body of [numeric, null, 'text']) {
      expect(parse(body, 'guardrails', {})).toStrictEqual({ removed: null, issue: 'unrecognized-body' })
    }
  })

  it("P14: Phase 0's max_price message has no marker → unrecognized-message", () => {
    const body = {
      error: {
        message: 'No endpoints found that satisfy the max price for this request',
        metadata: { routing_funnel: [{ step: 'Initial Endpoints', endpoint_count: 33 }] }
      }
    }
    expect(parse(body, 'guardrails', {})).toStrictEqual({ removed: null, issue: 'unrecognized-message' })
  })

  it('P15: an unbalanced reason → unbalanced-reason', () => {
    const body = synthetic('Filter by Guardrails removed deepseek (r)); Filter by Fallback removed c.', GUARDED)
    expect(parse(body, 'guardrails', {})).toStrictEqual({ removed: null, issue: 'unbalanced-reason' })
  })

  it('P16: no space before the reason → unrecognized-message', () => {
    const body = synthetic('Filter by Guardrails removed deepseek(r); Filter by Fallback removed c.', GUARDED)
    expect(parse(body, 'guardrails', {})).toStrictEqual({ removed: null, issue: 'unrecognized-message' })
  })

  it('P17: a tag with a space → bad-tag', () => {
    const body = synthetic('Filter by Guardrails removed deep seek; Filter by Fallback removed c.', GUARDED)
    expect(parse(body, 'guardrails', {})).toStrictEqual({ removed: null, issue: 'bad-tag' })
  })

  it('P18: a 73-character key-shaped tag → bad-tag', () => {
    // Assembled at runtime so this file never holds a complete key shape (npm run grep:secrets).
    const keyShaped = 'sk-or-v1-' + '0'.repeat(64)
    expect(keyShaped).toHaveLength(73)
    const body = synthetic('Filter by Guardrails removed ' + keyShaped + '; Filter by Fallback removed c.', GUARDED)
    expect(parse(body, 'guardrails', {})).toStrictEqual({ removed: null, issue: 'bad-tag' })
  })

  it('P19: a repeated tag is deduplicated (1 row)', () => {
    const body = synthetic('Filter by Guardrails removed deepseek, deepseek; Filter by Fallback removed c.', GUARDED)
    expect(parse(body, 'guardrails', {})).toStrictEqual(ok(['deepseek']))
  })

  it('P20: a "; " inside the reason does not split the clause', () => {
    const body = synthetic('Filter by Guardrails removed deepseek (a; b); Filter by Fallback removed c.', GUARDED)
    expect(parse(body, 'guardrails', {})).toStrictEqual(ok(['deepseek']))
  })

  it('P21: a clause without a funnel step → step-mismatch', () => {
    const body = synthetic('Filter by Guardrails removed deepseek (r); Filter by Fallback removed c.', [
      ['Initial Endpoints', 2],
      ['Filter by Fallback', 0]
    ])
    expect(parse(body, 'guardrails', {})).toStrictEqual({ removed: null, issue: 'step-mismatch' })
  })

  it('P22: a removal without a clause → step-mismatch', () => {
    const body = synthetic('Filter by Fallback removed c, d.', [
      ['Initial Endpoints', 3],
      ['Filter by Guardrails', 2],
      ['Filter by Fallback', 0]
    ])
    expect(parse(body, 'guardrails', {})).toStrictEqual({ removed: null, issue: 'step-mismatch' })
  })

  it('P23: a funnel that does not end at 0 → funnel-inconsistent', () => {
    const body = synthetic('Filter by Guardrails removed a (r); Filter by Fallback removed c.', [
      ['Initial Endpoints', 3],
      ['Filter by Guardrails', 2],
      ['Filter by Fallback', 1]
    ])
    expect(parse(body, 'guardrails', {})).toStrictEqual({ removed: null, issue: 'funnel-inconsistent' })
  })

  it('P24: the target step present with zero removal → []', () => {
    const body = synthetic('Filter by Fallback removed c.', [
      ['Initial Endpoints', 1],
      ['Filter by Guardrails', 1],
      ['Filter by Fallback', 0]
    ])
    expect(parse(body, 'guardrails', {})).toStrictEqual(ok([]))
  })

  it('P25: the guardrails removed everything', () => {
    const body = synthetic('Filter by Guardrails removed a, b (r).', [
      ['Initial Endpoints', 2],
      ['Filter by Guardrails', 0]
    ])
    expect(parse(body, 'guardrails', {})).toStrictEqual(ok(['a', 'b']))
  })
})

describe('Table P — funnel drift beyond P23', () => {
  it('a funnel that does not start at Initial Endpoints, increases, or repeats a step → funnel-inconsistent', () => {
    const tail = 'Filter by Guardrails removed deepseek (r); Filter by Fallback removed c.'
    const drifts: FunnelEntry[][] = [
      [['Start', 2], ['Filter by Guardrails', 1], ['Filter by Fallback', 0]],
      [['Initial Endpoints', 2], ['Filter by Guardrails', 3], ['Filter by Fallback', 0]],
      [['Initial Endpoints', 3], ['Filter by Guardrails', 2], ['Filter by Guardrails', 1], ['Filter by Fallback', 0]]
    ]
    for (const funnel of drifts) {
      expect(parse(synthetic(tail, funnel), 'guardrails', {})).toStrictEqual({ removed: null, issue: 'funnel-inconsistent' })
    }
  })

  it('a step named in two clauses → unrecognized-message', () => {
    const body = synthetic('Filter by Guardrails removed a; Filter by Guardrails removed b; Filter by Fallback removed c.', [
      ['Initial Endpoints', 3],
      ['Filter by Guardrails', 1],
      ['Filter by Fallback', 0]
    ])
    expect(parse(body, 'guardrails', {})).toStrictEqual({ removed: null, issue: 'unrecognized-message' })
  })

  it('a clause that is not "Filter by <Step> removed <tags>" → unrecognized-message', () => {
    const body = synthetic('Filter by Guardrails dropped deepseek; Filter by Fallback removed c.', GUARDED)
    expect(parse(body, 'guardrails', {})).toStrictEqual({ removed: null, issue: 'unrecognized-message' })
  })

  it('every failure is null with an issue, never an empty list', () => {
    const results = [
      parse(guardrailsFixture.body, 'guardrails', rows, 500),
      parse(null, 'guardrails', rows),
      parse(synthetic('Filter by Guardrails removed deepseek (r)); Filter by Fallback removed c.', GUARDED), 'guardrails', {})
    ]
    for (const result of results) {
      expect(result.removed).toBeNull()
      expect(result.issue).not.toBeNull()
    }
  })
})

describe('review M1 — an unknown clause step reads as unknown, never as "nothing removed"', () => {
  /** The real guardrails body with its Guardrails step renamed in both the message and the funnel. */
  function renamedGuardrails(): unknown {
    const body = JSON.parse(JSON.stringify(guardrailsFixture.body)) as {
      error: { message: string; metadata: { routing_funnel: { step: string; endpoint_count: number }[] } }
    }
    body.error.message = body.error.message.replace('Filter by Guardrails removed', 'Filter by Guardrail Policy removed')
    for (const entry of body.error.metadata.routing_funnel) {
      if (entry.step === 'Filter by Guardrails') entry.step = 'Filter by Guardrail Policy'
    }
    return body
  }

  it('the known clause steps', () => {
    expect(PREFLIGHT_KNOWN_CLAUSE_STEPS).toEqual(['Filter by Guardrails', 'Filter by Data Policy', 'Filter by Fallback'])
  })

  it('a renamed Guardrails step (consistent funnel) → step-mismatch for both targets', () => {
    const body = renamedGuardrails()
    expect(parse(body, 'guardrails', rows)).toStrictEqual({ removed: null, issue: 'step-mismatch' })
    expect(parse(body, 'dataPolicy', rows)).toStrictEqual({ removed: null, issue: 'step-mismatch' })
  })

  it('a renamed step in a synthetic body → step-mismatch for both targets', () => {
    const body = synthetic('Filter by Guardrail Policy removed deepseek (r); Filter by Fallback removed c.', [
      ['Initial Endpoints', 2],
      ['Filter by Guardrail Policy', 1],
      ['Filter by Fallback', 0]
    ])
    expect(parse(body, 'guardrails', {})).toStrictEqual({ removed: null, issue: 'step-mismatch' })
    expect(parse(body, 'dataPolicy', {})).toStrictEqual({ removed: null, issue: 'step-mismatch' })
  })

  it('an extra unknown step with a positive removal and its own clause → step-mismatch', () => {
    const body = synthetic(
      'Filter by Guardrails removed deepseek (r); Filter by Ignored Providers removed x; Filter by Fallback removed c.',
      [
        ['Initial Endpoints', 3],
        ['Filter by Guardrails', 2],
        ['Filter by Ignored Providers', 1],
        ['Filter by Fallback', 0]
      ]
    )
    expect(parse(body, 'guardrails', {})).toStrictEqual({ removed: null, issue: 'step-mismatch' })
    expect(parse(body, 'dataPolicy', {})).toStrictEqual({ removed: null, issue: 'step-mismatch' })
  })

  it('an unknown funnel step that removes nothing and has no clause stays allowed (Apply Status Sorting)', () => {
    const body = synthetic('Filter by Guardrails removed deepseek (r); Filter by Fallback removed c.', [
      ['Initial Endpoints', 2],
      ['Filter by Guardrails', 1],
      ['Some Future Sorting', 1],
      ['Filter by Fallback', 0]
    ])
    expect(parse(body, 'guardrails', {})).toStrictEqual(ok(['deepseek']))
  })
})

describe('row counts read only own properties (Object.hasOwn)', () => {
  it('tags named constructor and toString count 1 each against a plain {}', () => {
    const body = synthetic('Filter by Guardrails removed constructor, toString (r); Filter by Fallback removed c.', [
      ['Initial Endpoints', 3],
      ['Filter by Guardrails', 1],
      ['Filter by Fallback', 0]
    ])
    expect(parse(body, 'guardrails', {})).toStrictEqual(ok(['constructor', 'toString']))
  })

  it('rowsPerTag counts constructor, toString and __proto__ as ordinary own keys', () => {
    const at = (tag: string): RawEndpoint => ({ ...golden.endpoints[0], tag })
    const counts = rowsPerTag([at('constructor'), at('toString'), at('toString'), at('__proto__')])
    expect(Object.getPrototypeOf(counts)).toBeNull()
    expect(Object.keys(counts).sort()).toEqual(['__proto__', 'constructor', 'toString'])
    expect(counts.constructor).toBe(1)
    expect(counts.toString).toBe(2)
    expect(Object.hasOwn(counts, '__proto__')).toBe(true)
  })
})

describe('Table P — request body and row counts (P26, P27)', () => {
  it('P26: the exact serialised preflight bodies, keys in Phase 0 order', () => {
    expect(JSON.stringify(preflightRequestBody('deepseek/deepseek-v4.1-flash', 'guardrails'))).toBe(
      '{"model":"deepseek/deepseek-v4.1-flash","provider":{"order":["chorus-preflight-none"],"allow_fallbacks":false},"messages":[{"role":"user","content":"OK"}],"max_tokens":1}'
    )
    expect(JSON.stringify(preflightRequestBody('deepseek/deepseek-v4.1-flash', 'dataPolicy'))).toBe(
      '{"model":"deepseek/deepseek-v4.1-flash","provider":{"order":["chorus-preflight-none"],"allow_fallbacks":false,"data_collection":"deny"},"messages":[{"role":"user","content":"OK"}],"max_tokens":1}'
    )
  })

  it('P27: rowsPerTag of the golden endpoints — 32 own keys, baseten/fp8 2, null prototype', () => {
    expect(golden.endpoints).toHaveLength(33)
    expect(Object.keys(rows)).toHaveLength(32)
    expect(rows['baseten/fp8']).toBe(2)
    expect(Object.values(rows).filter((n) => n !== 1)).toEqual([2])
    expect(Object.getPrototypeOf(rows)).toBeNull()
  })

  it('constants', () => {
    expect(PREFLIGHT_NONEXISTENT_TAG).toBe('chorus-preflight-none')
    expect(PREFLIGHT_MARKER).toBe('Every candidate endpoint was removed during routing: ')
    expect(PREFLIGHT_STEP_NAMES).toEqual({ guardrails: 'Filter by Guardrails', dataPolicy: 'Filter by Data Policy' })
  })
})
