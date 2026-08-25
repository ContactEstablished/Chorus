import { describe, expect, it } from 'vitest'
import type { ModelCatalogRow } from '../db/schema'
import {
  CATALOG_STALE_AFTER_MS,
  catalogFreshness,
  computeCatalogDiff,
  MODEL_ID_PATTERN,
  decodeReasoningEfforts,
  parseModelsResponse,
  REASONING_EFFORTS_CAP,
  REFRESH_FAILURE,
  toReasoningEfforts,
  sanitizeDisplayName,
  type CatalogModel
} from './modelCatalogCore'

/** A stored row, with sensible defaults so each test names only what it means. */
function row(over: Partial<ModelCatalogRow> & { modelId: string }): ModelCatalogRow {
  return {
    providerId: 'p1',
    displayName: over.modelId,
    contextLength: null,
    expiresAt: null,
    firstSeenAt: '2026-07-01T00:00:00.000Z',
    refreshedAt: '2026-07-01T00:00:00.000Z',
    missingSince: null,
    // D179: a row that predates v22 truthfully answers null — "nobody has asked
    // this provider yet" — so that, not `'[]'`, is the fixture default.
    reasoningEfforts: null,
    ...over
  }
}

function model(id: string, over: Partial<CatalogModel> = {}): CatalogModel {
  return {
    modelId: id,
    displayName: id,
    contextLength: null,
    expiresAt: null,
    reasoningEfforts: null,
    ...over
  }
}

const NOW = '2026-07-25T12:00:00.000Z'

/* ------------------------------------------------------------------ */
/* The diff — four populations, four rules, each its own named test    */
/* ------------------------------------------------------------------ */

describe('computeCatalogDiff — the four populations', () => {
  it('a model seen for the FIRST time -> added, with first_seen_at set to now', () => {
    const diff = computeCatalogDiff([], [model('a/one')], NOW)
    expect(diff.addedCount).toBe(1)
    expect(diff.updatedCount).toBe(0)
    expect(diff.upserts).toEqual([
      {
        modelId: 'a/one',
        displayName: 'a/one',
        contextLength: null,
        expiresAt: null,
        // D179: carried through the diff untouched. `null` here is the fixture
        // saying the provider published no `reasoning` object — the answer a
        // row must be able to give, and a different one from `[]`.
        reasoningEfforts: null,
        firstSeenAt: NOW,
        refreshedAt: NOW
      }
    ])
    expect(diff.markMissing).toEqual([])
    expect(diff.clearMissing).toEqual([])
  })

  it('a model seen AGAIN -> updated with a new refreshed_at, first_seen_at PRESERVED', () => {
    const existing = [row({ modelId: 'a/one', firstSeenAt: '2026-01-01T00:00:00.000Z' })]
    const diff = computeCatalogDiff(existing, [model('a/one')], NOW)
    expect(diff.addedCount).toBe(0)
    expect(diff.updatedCount).toBe(1)
    expect(diff.upserts[0].firstSeenAt).toBe('2026-01-01T00:00:00.000Z')
    expect(diff.upserts[0].refreshedAt).toBe(NOW)
  })

  it('a catalogued model NOT seen -> markMissing, set ONCE', () => {
    const existing = [row({ modelId: 'a/gone' })]
    const diff = computeCatalogDiff(existing, [], NOW)
    expect(diff.markMissing).toEqual(['a/gone'])
    expect(diff.upserts).toEqual([])
    // ⚠ The row is NOT deleted — deleting destroys the only evidence the id
    // was ever real, which is exactly the fact a user staring at a failing
    // saved route needs.
    expect(Object.keys(diff)).not.toContain('deletes')
  })

  it('⚠ a STILL-missing model produces NO ACTION — missing_since never moves', () => {
    // The easiest rule to get wrong, because setting it unconditionally reads
    // as simpler code. If it moved, "missing since" would read as "today"
    // forever and the user could never tell whether a model vanished this
    // morning or last month.
    const existing = [row({ modelId: 'a/gone', missingSince: '2026-07-01T00:00:00.000Z' })]
    const diff = computeCatalogDiff(existing, [], NOW)
    expect(diff.markMissing).toEqual([])
    expect(diff.clearMissing).toEqual([])
    expect(diff.upserts).toEqual([])
  })

  it('a missing model seen AGAIN -> missing_since cleared', () => {
    const existing = [row({ modelId: 'a/back', missingSince: '2026-07-01T00:00:00.000Z' })]
    const diff = computeCatalogDiff(existing, [model('a/back')], NOW)
    expect(diff.clearMissing).toEqual(['a/back'])
    expect(diff.markMissing).toEqual([])
    expect(diff.updatedCount).toBe(1)
  })

  it('a seen model that was NEVER marked is not in clearMissing (no spurious clears)', () => {
    const diff = computeCatalogDiff([row({ modelId: 'a/one' })], [model('a/one')], NOW)
    expect(diff.clearMissing).toEqual([])
  })

  it('all four populations at once, in one refresh', () => {
    const existing = [
      row({ modelId: 'keep' }),
      row({ modelId: 'vanishing' }),
      row({ modelId: 'still-gone', missingSince: '2026-07-02T00:00:00.000Z' }),
      row({ modelId: 'returning', missingSince: '2026-07-03T00:00:00.000Z' })
    ]
    const diff = computeCatalogDiff(existing, [model('keep'), model('returning'), model('brand-new')], NOW)
    expect(diff.addedCount).toBe(1)
    expect(diff.updatedCount).toBe(2)
    expect(diff.markMissing).toEqual(['vanishing'])
    expect(diff.clearMissing).toEqual(['returning'])
    expect(diff.upserts.map((u) => u.modelId).sort()).toEqual(['brand-new', 'keep', 'returning'])
  })

  it('carries ONE nowIso for the whole refresh, so storage cannot straddle two instants', () => {
    const diff = computeCatalogDiff([row({ modelId: 'gone' })], [model('a')], NOW)
    expect(diff.nowIso).toBe(NOW)
    expect(diff.upserts[0].refreshedAt).toBe(NOW)
  })

  it('propagates the parser’s droppedCount rather than inventing one', () => {
    expect(computeCatalogDiff([], [], NOW, 7).droppedCount).toBe(7)
    expect(computeCatalogDiff([], [], NOW).droppedCount).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* ⚠ THE ANTI-AUTHORITY TEST                                           */
/* ------------------------------------------------------------------ */

describe('⚠ THE ANTI-AUTHORITY TEST — the diff cannot instruct a write to either model home', () => {
  /**
   * The unit-level statement of the precedence ruling, and the most important
   * test in the catalog half. `model_catalog` is a LIST OF WHAT EXISTS: it is
   * not authoritative over `provider_configs.model` (rank 2, D48) or
   * `launch_profiles.model` (rank 1, 3a-5), and it never writes to them.
   *
   * Asserted over the WHOLE KEY SET, so a future added field cannot smuggle a
   * write in behind a passing suite.
   */
  const EXPECTED_KEYS = [
    'addedCount',
    'clearMissing',
    'droppedCount',
    'markMissing',
    'nowIso',
    'updatedCount',
    'upserts'
  ]

  it('the key set is exactly the seven instruction fields, for a trivial input', () => {
    expect(Object.keys(computeCatalogDiff([], [], NOW)).sort()).toEqual(EXPECTED_KEYS)
  })

  it('⚠ …AND for the input where the ROUTE’S OWN DEFAULT MODEL is the one that just went missing', () => {
    // The case where "helpfully" clearing provider_configs.model would look
    // like a convenience at the call site. There is no field to express it in.
    const routeDefault = 'moonshotai/kimi-k2.7'
    const existing = [row({ modelId: routeDefault }), row({ modelId: 'moonshotai/kimi-k3' })]
    const diff = computeCatalogDiff(existing, [model('moonshotai/kimi-k3')], NOW)

    expect(Object.keys(diff).sort()).toEqual(EXPECTED_KEYS)
    expect(diff.markMissing).toEqual([routeDefault])

    // Nothing anywhere in the emitted object names either other home.
    const serialized = JSON.stringify(diff)
    expect(serialized).not.toContain('provider_configs')
    expect(serialized).not.toContain('providerConfig')
    expect(serialized).not.toContain('launch_profiles')
    expect(serialized).not.toContain('launchProfile')
    expect(serialized).not.toContain('clearRouteModel')
    expect(serialized).not.toContain('substitute')
  })

  it('the diff never proposes a REPLACEMENT model for a missing one', () => {
    const existing = [row({ modelId: 'retired' })]
    const diff = computeCatalogDiff(existing, [model('shiny-new'), model('also-new')], NOW)
    // 'retired' is marked and left alone; the two new models are simply
    // catalogued. No pairing, no "did you mean", no fallback.
    expect(diff.markMissing).toEqual(['retired'])
    expect(diff.upserts.map((u) => u.modelId).sort()).toEqual(['also-new', 'shiny-new'])
  })
})

/* ------------------------------------------------------------------ */
/* Row validation — hostile input is DROPPED WITH A COUNT, never thrown */
/* ------------------------------------------------------------------ */

describe('parseModelsResponse — shape', () => {
  it('accepts {data: [...]}, and IGNORES the extra top-level keys the live endpoint sends', () => {
    // D4-measured 2026-07-25: the live top level is data + total_count + links.
    const parsed = parseModelsResponse({
      data: [{ id: 'a/one', name: 'A One' }],
      total_count: 345,
      links: {}
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.models).toHaveLength(1)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'nope'],
    ['an array', [{ id: 'a' }]],
    ['no data key', { models: [] }],
    ['data not an array', { data: { a: 1 } }],
    ['data null', { data: null }]
  ])('refuses %s with the FIXED unrecognized-shape message', (_label, body) => {
    const parsed = parseModelsResponse(body)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.reason).toBe(REFRESH_FAILURE.unrecognized)
  })

  it('⚠ the refusal NEVER names the received shape (a body echo wearing a diagnostic hat)', () => {
    const parsed = parseModelsResponse({ secret_field: 'sk-or-v1-notarealkey', unexpected: [1, 2] })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.reason).toBe(REFRESH_FAILURE.unrecognized)
    expect(parsed.reason).not.toContain('secret_field')
    expect(parsed.reason).not.toContain('unexpected')
  })
})

describe('parseModelsResponse — per-row validation drops without throwing', () => {
  it('⚠ rejects ids that would write into a command line — this string reaches argv as -m', () => {
    const hostile = [
      'has space',
      'has"quote',
      "has'quote",
      'has\nnewline',
      'has\ttab',
      '[31mansi',
      'semi;colon',
      'amp&ersand',
      'pipe|d',
      'back\\slash',
      '$(subshell)',
      '`backtick`',
      'a'.repeat(201),
      ''
    ]
    const parsed = parseModelsResponse({ data: hostile.map((id) => ({ id })) })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.models).toEqual([])
    expect(parsed.droppedCount).toBe(hostile.length)
  })

  it('accepts the full live charset, INCLUDING OpenRouter’s `~` latest-alias prefix', () => {
    // D4-measured 2026-07-25: the complete set of non-alphanumeric characters
    // across all 345 published ids is exactly `- . / : ~`, and 10 ids use `~`.
    // Spec §4.2's charset omitted it and would have dropped all ten on EVERY
    // refresh of the one route the app ships.
    const real = [
      'moonshotai/kimi-k3',
      'moonshotai/kimi-k2.7-code',
      'poolside/laguna-m.1:free',
      '~anthropic/claude-opus-latest',
      '~openai/gpt-latest',
      'some@vendor/model_x'
    ]
    for (const id of real) expect(MODEL_ID_PATTERN.test(id)).toBe(true)
    const parsed = parseModelsResponse({ data: real.map((id) => ({ id })) })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.models.map((m) => m.modelId)).toEqual(real)
    expect(parsed.droppedCount).toBe(0)
  })

  it('drops non-object rows and rows with a non-string id, with a count', () => {
    const parsed = parseModelsResponse({
      data: [null, 42, 'a string', [], { id: 7 }, { name: 'no id' }, { id: 'a/good' }]
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.models.map((m) => m.modelId)).toEqual(['a/good'])
    expect(parsed.droppedCount).toBe(6)
  })

  it('drops a DUPLICATE id within one response (first wins) — an upsert would double-apply', () => {
    const parsed = parseModelsResponse({
      data: [
        { id: 'a/one', name: 'First' },
        { id: 'a/one', name: 'Second' }
      ]
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.models).toHaveLength(1)
    expect(parsed.models[0].displayName).toBe('First')
    expect(parsed.droppedCount).toBe(1)
  })

  it('never throws, for any hostile input', () => {
    const nasty = [
      { data: [{ id: 'a', name: { nested: true } }] },
      { data: [{ id: 'a', context_length: 'lots' }] },
      { data: [{ id: 'a', expiration_date: 12345 }] },
      { data: [{ id: 'a', get name() { throw new Error('boom') } }] }
    ]
    // The getter row is the interesting one: a hostile body must not be able
    // to raise out of ingest.
    expect(() => parseModelsResponse(nasty[0])).not.toThrow()
    expect(() => parseModelsResponse(nasty[1])).not.toThrow()
    expect(() => parseModelsResponse(nasty[2])).not.toThrow()
  })
})

describe('parseModelsResponse — provider-controlled display text is sanitized', () => {
  it('strips control characters and caps length (this renders in the DOM)', () => {
    const parsed = parseModelsResponse({
      data: [
        { id: 'a/one', name: 'Good [31m Name' },
        { id: 'a/two', name: 'x'.repeat(500) }
      ]
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.models[0].displayName).toBe('Good[31m Name')
    expect(parsed.models[0].displayName).not.toMatch(/[ -]/)
    expect(parsed.models[1].displayName).toHaveLength(200)
  })

  it('falls back to the id when the name is absent, non-string, or sanitizes to empty', () => {
    const parsed = parseModelsResponse({
      data: [{ id: 'a/one' }, { id: 'a/two', name: 42 }, { id: 'a/three', name: '   ' }]
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.models.map((m) => m.displayName)).toEqual(['a/one', 'a/two', 'a/three'])
  })

  it('sanitizeDisplayName is exported and total', () => {
    expect(sanitizeDisplayName('  hi  ')).toBe('hi')
    expect(sanitizeDisplayName('')).toBe('')
  })
})

describe('parseModelsResponse — numeric and date fields', () => {
  it('⚠ a non-numeric context_length yields NULL, never NaN and never 0', () => {
    // 0 and "unknown" must stay distinguishable (3a-3's rule, same reasoning).
    const parsed = parseModelsResponse({
      data: [
        { id: 'a', context_length: 1048576 },
        { id: 'b', context_length: 0 },
        { id: 'c', context_length: 'lots' },
        { id: 'd', context_length: null },
        { id: 'e', context_length: NaN },
        { id: 'f', context_length: Infinity },
        { id: 'g', context_length: -5 },
        { id: 'h', context_length: 1234.9 }
      ]
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.models.map((m) => m.contextLength)).toEqual([
      1048576,
      0,
      null,
      null,
      null,
      null,
      null,
      1234
    ])
  })

  it('expiration_date keeps an ISO-parseable value and nulls anything else', () => {
    // D4-measured: the live format is a bare `YYYY-MM-DD`, populated on 7 of
    // 345 models.
    const parsed = parseModelsResponse({
      data: [
        { id: 'a', expiration_date: '2026-08-10' },
        { id: 'b', expiration_date: '2098-12-31' },
        { id: 'c', expiration_date: 'soon' },
        { id: 'd', expiration_date: 20260810 },
        { id: 'e' }
      ]
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.models.map((m) => m.expiresAt)).toEqual([
      '2026-08-10',
      '2098-12-31',
      null,
      null,
      null
    ])
  })
})

/* ------------------------------------------------------------------ */
/* Freshness — THREE distinguishable states                            */
/* ------------------------------------------------------------------ */

describe('catalogFreshness — three states, and they must stay three', () => {
  const now = '2026-07-25T12:00:00.000Z'
  const nowMs = Date.parse(now)
  const iso = (msAgo: number): string => new Date(nowMs - msAgo).toISOString()

  it('null -> "never" — A THIRD STATE, NOT A FLAVOUR OF STALE', () => {
    // Folding these looks right on a populated database and wrong on every
    // fresh install, which is every new user.
    expect(catalogFreshness(null, now)).toBe('never')
  })

  it('< 24 h -> "fresh"', () => {
    expect(catalogFreshness(iso(0), now)).toBe('fresh')
    expect(catalogFreshness(iso(60_000), now)).toBe('fresh')
    expect(catalogFreshness(iso(CATALOG_STALE_AFTER_MS - 1), now)).toBe('fresh')
  })

  it('>= 24 h -> "stale" (the boundary is inclusive on the stale side)', () => {
    expect(catalogFreshness(iso(CATALOG_STALE_AFTER_MS), now)).toBe('stale')
    expect(catalogFreshness(iso(CATALOG_STALE_AFTER_MS + 1), now)).toBe('stale')
    expect(catalogFreshness(iso(3 * CATALOG_STALE_AFTER_MS), now)).toBe('stale')
  })

  it('the three states are DISTINGUISHABLE — never === stale must be false', () => {
    const never = catalogFreshness(null, now)
    const fresh = catalogFreshness(iso(1000), now)
    const stale = catalogFreshness(iso(CATALOG_STALE_AFTER_MS * 2), now)
    expect(new Set([never, fresh, stale]).size).toBe(3)
  })

  it('a future timestamp (clock skew) reads fresh rather than throwing', () => {
    expect(catalogFreshness(new Date(nowMs + 60_000).toISOString(), now)).toBe('fresh')
  })

  it('an UNDATEABLE timestamp on a table that HAS rows warns rather than claiming freshness', () => {
    expect(catalogFreshness('not-a-date', now)).toBe('stale')
    expect(catalogFreshness(iso(0), 'not-a-date')).toBe('stale')
  })

  it('the threshold is exactly 24 h and lives HERE — one home', () => {
    expect(CATALOG_STALE_AFTER_MS).toBe(24 * 60 * 60 * 1000)
  })
})

/* ------------------------------------------------------------------ */
/* The failure vocabulary never echoes a body                          */
/* ------------------------------------------------------------------ */

describe('the failure vocabulary is FIXED and echoes nothing', () => {
  // A realistic-shaped fake, assembled by concatenation so this file never
  // contains a complete key shape for scripts/secret-grep.mjs (G4 scans src/).
  const FAKE_KEY = 'sk-or-v1-' + '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

  it('every message is a fixed string with no interpolation slot for a body', () => {
    for (const message of Object.values(REFRESH_FAILURE)) {
      expect(typeof message).toBe('string')
      expect(message.length).toBeGreaterThan(0)
      expect(message).not.toContain('${')
    }
  })

  it('⚠ a body containing a realistic key cannot reach the returned reason', () => {
    const parsed = parseModelsResponse({
      error: { message: `Invalid key ${FAKE_KEY}`, code: 401 },
      authorization: `Bearer ${FAKE_KEY}`
    })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.reason).toBe(REFRESH_FAILURE.unrecognized)
    // No substring >= 8 characters of the fake key survives.
    for (let i = 0; i + 8 <= FAKE_KEY.length; i++) {
      expect(parsed.reason).not.toContain(FAKE_KEY.slice(i, i + 8))
    }
  })

  it('mirrors probeCredential’s vocabulary verbatim for the shared conditions', () => {
    // One voice about a provider that said no — the strings are deliberate
    // COPIES, because probeCredential is untouched by this task.
    expect(REFRESH_FAILURE.authFailed).toBe('Authentication failed — the credential was rejected.')
    expect(REFRESH_FAILURE.rateLimited).toBe('Rate limited by the provider.')
    expect(REFRESH_FAILURE.providerError).toBe('The provider returned an error.')
    expect(REFRESH_FAILURE.unreachable).toBe('Could not reach the provider.')
  })
})

/* ================================================================== */
/* D179 — the model's OWN effort vocabulary                            */
/* ================================================================== */

describe("D179 — reasoning efforts, the provider's own words", () => {
  it("reads OpenRouter's supported_efforts, in the order published", () => {
    // The live shape, D4-verified 2026-08-25 against the free /api/v1/models:
    // z-ai/glm-5.2 publishes ["xhigh","high"], and opencode's own variants map
    // for that model is exactly {high, xhigh} — which is what makes the catalog
    // a safe source rather than a guess.
    expect(
      toReasoningEfforts({ mandatory: false, supported_efforts: ['xhigh', 'high'], default_effort: 'high' })
    ).toEqual(['xhigh', 'high'])
  })

  /**
   * ⚠ THE THREE-ANSWER RULE, and it is the whole reason this returns
   * `readonly string[] | null` rather than an array. A model with no reasoning
   * at all (`qwen/qwen3-coder` publishes no `reasoning` key) and a model whose
   * reasoning is not effort-gated (`nvidia/nemotron-3.5-lightning` publishes
   * `{mandatory: false}`) both mean "we were told nothing" — which must not
   * render as "we were told none".
   */
  it('⚠ null when the provider said nothing; [] only when it said none', () => {
    expect(toReasoningEfforts(undefined)).toBeNull()
    expect(toReasoningEfforts({ mandatory: false })).toBeNull()
    expect(toReasoningEfforts({ supported_efforts: 'high' })).toBeNull()
    expect(toReasoningEfforts({ supported_efforts: [] })).toEqual([])
  })

  it('drops a malformed name rather than the whole row, and never duplicates', () => {
    expect(
      toReasoningEfforts({ supported_efforts: ['high', 'HIGH', 'extra high', 42, null, 'high', 'low'] })
    ).toEqual(['high', 'low'])
  })

  it('caps what a provider body can push into the DB and the DOM', () => {
    const many = Array.from({ length: 40 }, (_, i) => `e${i}`)
    expect(toReasoningEfforts({ supported_efforts: many })!.length).toBe(REASONING_EFFORTS_CAP)
  })

  it('parseModelsResponse carries it onto the row, null when absent', () => {
    const out = parseModelsResponse({
      data: [
        { id: 'z-ai/glm-5.2', reasoning: { supported_efforts: ['xhigh', 'high'] } },
        { id: 'qwen/qwen3-coder' }
      ]
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.models[0].reasoningEfforts).toEqual(['xhigh', 'high'])
    expect(out.models[1].reasoningEfforts).toBeNull()
  })

  it('decodes the stored column, and degrades to null rather than to a claim', () => {
    expect(decodeReasoningEfforts('["high","xhigh"]')).toEqual(['high', 'xhigh'])
    expect(decodeReasoningEfforts('[]')).toEqual([])
    expect(decodeReasoningEfforts(null)).toBeNull()
    // ⚠ EVERY UNREADABLE FORM ANSWERS null — "we do not know" — because the only
    // safe direction is the one that renders no control instead of a wrong one.
    expect(decodeReasoningEfforts('')).toBeNull()
    expect(decodeReasoningEfforts('not json')).toBeNull()
    expect(decodeReasoningEfforts('"high"')).toBeNull()
    expect(decodeReasoningEfforts('{"a":1}')).toBeNull()
    // A hand-edited row cannot smuggle a name into another tool's config file.
    expect(decodeReasoningEfforts('["high","DROP TABLE"]')).toEqual(['high'])
  })
})
