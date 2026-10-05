import { z } from 'zod'

import { ROUTING_TAG_PATTERN, type PreflightIssue, type PreflightStep, type RawEndpoint } from '../../shared/routing'
import { byCodeUnit } from './endpointsCore'

/**
 * Model Routing Task 2-1: the zero-cost account preflights (MR-D12, MR-D18,
 * K3, C1, C2). A chat completion pinned to an endpoint that does not exist,
 * with fallbacks off, is refused by OpenRouter with a 404 whose message names
 * every endpoint the account's own filters removed. This module builds that
 * request body and parses the 404 body into the removed tags.
 *
 * The parse reads free text that OpenRouter does not version, so it is strict
 * everywhere and count-checked on the target step: any drift is `null` with an
 * issue (unknown, never "allowed"; Phase 1 K3), never an empty list.
 *
 * Pure: no clock, no randomness, no environment, no file system, no network.
 */

/** The `order` entry no endpoint carries, so every candidate is removed and the 404 lists why. */
export const PREFLIGHT_NONEXISTENT_TAG = 'chorus-preflight-none'
export const PREFLIGHT_MARKER = 'Every candidate endpoint was removed during routing: '
export const PREFLIGHT_STEP_NAMES: Record<PreflightStep, string> = {
  guardrails: 'Filter by Guardrails',
  dataPolicy: 'Filter by Data Policy'
}

/**
 * The only step names a removal clause may carry (review M1, strengthening
 * MR-D12 and C2). A clause naming any other step is `step-mismatch`: if
 * OpenRouter renamed the Guardrails step, the target would otherwise find no
 * clause and read as "nothing removed", which is the one wrong answer a
 * renamed step must never produce. Funnel steps without a clause (such as
 * `Apply Status Sorting`, which removes nothing) stay allowed.
 */
export const PREFLIGHT_KNOWN_CLAUSE_STEPS = ['Filter by Guardrails', 'Filter by Data Policy', 'Filter by Fallback'] as const
const KNOWN_CLAUSE_STEPS: ReadonlySet<string> = new Set(PREFLIGHT_KNOWN_CLAUSE_STEPS)

export interface PreflightRequestBody {
  model: string
  provider: { order: string[]; allow_fallbacks: false; data_collection?: 'deny' }
  messages: { role: 'user'; content: string }[]
  max_tokens: 1
}

/** The guardrails preflight has no data_collection key; the dataPolicy preflight adds 'deny' (MR-D18). */
export function preflightRequestBody(model: string, step: PreflightStep): PreflightRequestBody {
  // Keys are built in Phase 0's insertion order (verify-routing-live.ts:63), so the
  // serialised body is byte-identical to the request that was measured.
  const provider: PreflightRequestBody['provider'] =
    step === 'dataPolicy'
      ? { order: [PREFLIGHT_NONEXISTENT_TAG], allow_fallbacks: false, data_collection: 'deny' }
      : { order: [PREFLIGHT_NONEXISTENT_TAG], allow_fallbacks: false }
  return { model, provider, messages: [{ role: 'user', content: 'OK' }], max_tokens: 1 }
}

/** Rows per tag in a snapshot, on a null-prototype object; read it with Object.hasOwn. */
export function rowsPerTag(endpoints: readonly RawEndpoint[]): Record<string, number> {
  const out: Record<string, number> = Object.create(null) as Record<string, number>
  for (const row of endpoints) out[row.tag] = (Object.hasOwn(out, row.tag) ? out[row.tag] : 0) + 1
  return out
}

export interface PreflightParseInput {
  status: number
  body: unknown // JSON.parse of the capped body
  step: PreflightStep
  rowsPerTag: Readonly<Record<string, number>>
}
export type PreflightParseResult = { removed: string[]; issue: null } | { removed: null; issue: PreflightIssue }

/** Non-strict: extra keys such as `code`, `reason` and `failed_routing_step` are ignored. */
const preflightBodySchema = z.object({
  error: z.object({
    message: z.string(),
    metadata: z.object({
      routing_funnel: z.array(z.object({ step: z.string().min(1), endpoint_count: z.number().int().min(0) })).min(1)
    })
  })
})

const INITIAL_STEP = 'Initial Endpoints'
/** Splits only before the next `Filter by `, so a `; ` inside a parenthesised reason never splits a clause. */
const CLAUSE_SPLIT = /; (?=Filter by )/
const CLAUSE = /^(Filter by .+?) removed (.+)$/

interface Clause { step: string; rest: string }
interface TaggedClause { step: string; tags: string[] }

function fail(issue: PreflightIssue): PreflightParseResult {
  return { removed: null, issue }
}

/**
 * Rule 5: strips one trailing parenthesised reason, nested parentheses included,
 * by walking back from the last `)` until the depth returns to 0. `null` when the
 * parentheses never balance; `'no-space'` when the reason is not preceded by a space.
 */
function stripReason(rest: string): string | null | 'no-space' {
  if (!rest.endsWith(')')) return rest
  let depth = 0
  for (let i = rest.length - 1; i >= 0; i--) {
    const ch = rest[i]
    if (ch === ')') depth++
    else if (ch === '(') {
      depth--
      if (depth === 0) return i === 0 || rest[i - 1] !== ' ' ? 'no-space' : rest.slice(0, i - 1)
    }
  }
  return null
}

/**
 * Parses one preflight response (ImplementationSpec-2-1, rules 1-11, checked in
 * order; the first failure wins). Each per-clause rule (4, 5, 6) runs over every
 * clause before the next rule starts. One extra rule, 9a, runs between rules 9
 * and 10: every clause must name a step in `PREFLIGHT_KNOWN_CLAUSE_STEPS`, so a
 * renamed step reads as unknown, never as "nothing removed" (review M1). Only
 * the target step is count-checked (C1, C2).
 */
export function parsePreflight(input: PreflightParseInput): PreflightParseResult {
  // 1. Status.
  if (input.status !== 404) return fail('unexpected-status')

  // 2. Body shape.
  const parsed = preflightBodySchema.safeParse(input.body)
  if (!parsed.success) return fail('unrecognized-body')
  const { message, metadata } = parsed.data.error
  const funnel = metadata.routing_funnel

  // 3. Marker; the tail is everything after its first occurrence, less one trailing `.`.
  const at = message.indexOf(PREFLIGHT_MARKER)
  if (at < 0) return fail('unrecognized-message')
  let tail = message.slice(at + PREFLIGHT_MARKER.length)
  if (tail.endsWith('.')) tail = tail.slice(0, -1)

  // 4. Clauses.
  const clauses: Clause[] = []
  for (const text of tail.split(CLAUSE_SPLIT)) {
    const m = CLAUSE.exec(text)
    if (m === null) return fail('unrecognized-message')
    clauses.push({ step: m[1], rest: m[2] })
  }

  // 5. Reasons.
  for (const clause of clauses) {
    const stripped = stripReason(clause.rest)
    if (stripped === null) return fail('unbalanced-reason')
    if (stripped === 'no-space') return fail('unrecognized-message')
    clause.rest = stripped
  }

  // 6. Tags: every piece must be a routable tag; deduplicated, sorted by code unit.
  const tagged: TaggedClause[] = []
  for (const clause of clauses) {
    const pieces = clause.rest.split(', ')
    if (!pieces.every((piece) => ROUTING_TAG_PATTERN.test(piece))) return fail('bad-tag')
    tagged.push({ step: clause.step, tags: [...new Set(pieces)].sort(byCodeUnit) })
  }

  // 7. One clause per step.
  const clauseSteps = new Set<string>()
  for (const clause of tagged) {
    if (clauseSteps.has(clause.step)) return fail('unrecognized-message')
    clauseSteps.add(clause.step)
  }

  // 8. Funnel: starts at Initial Endpoints, never increases, ends at 0, no repeated step.
  if (funnel[0].step !== INITIAL_STEP || funnel[funnel.length - 1].endpoint_count !== 0) return fail('funnel-inconsistent')
  const removals = new Map<string, number>()
  for (let i = 1; i < funnel.length; i++) {
    const removal = funnel[i - 1].endpoint_count - funnel[i].endpoint_count
    if (removal < 0 || removals.has(funnel[i].step) || funnel[i].step === INITIAL_STEP) return fail('funnel-inconsistent')
    removals.set(funnel[i].step, removal)
  }

  // 9. Clauses and positive removals correspond one to one.
  for (const clause of tagged) {
    const removal = removals.get(clause.step)
    if (removal === undefined || removal <= 0) return fail('step-mismatch')
  }
  for (const [step, removal] of removals) {
    if (removal > 0 && !clauseSteps.has(step)) return fail('step-mismatch')
  }

  // 9a. Every clause names a known step (review M1). Without this, a renamed
  // target step ('Filter by Guardrail Policy') would pass rule 9, find no target
  // clause at rule 10, and report "nothing removed". It must read as unknown.
  for (const clause of tagged) {
    if (!KNOWN_CLAUSE_STEPS.has(clause.step)) return fail('step-mismatch')
  }

  // 10. No clause for the target: by rules 9 and 9a its removal is 0 or the step is absent.
  const target = PREFLIGHT_STEP_NAMES[input.step]
  const clause = tagged.find((c) => c.step === target)
  if (clause === undefined) return { removed: [], issue: null }

  // 11. Count (C1): the funnel counts rows, so each tag weighs its row count (1 when unknown).
  const rows = input.rowsPerTag
  const weighted = clause.tags.reduce((sum, tag) => sum + (Object.hasOwn(rows, tag) ? rows[tag] : 1), 0)
  if (weighted !== removals.get(target)) return fail('count-mismatch')
  return { removed: clause.tags, issue: null }
}
