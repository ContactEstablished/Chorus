import {
  QUANTIZATIONS,
  endpointsResponseSchema,
  rawEndpointSchema,
  type EndpointSnapshot,
  type Quantization,
  type RawEndpoint,
  type RawPricing,
  type RoutingObservation
} from '../../shared/routing'

/**
 * Model Routing Task 1-1: turn a raw OpenRouter `/endpoints` response into
 * validated rows, collapse rows that share a tag into one candidate (K8, C7),
 * and extract tag-keyed observations.
 *
 * Pure: no clock, no randomness, no file system. Every output is sorted by tag
 * with a code-unit compare, and rows inside a group are combined with
 * order-free operations (min, max, intersection, sorted lists), so the input
 * row order can never change a result.
 */

export interface EndpointsParseResult {
  modelId: string
  endpoints: RawEndpoint[] // valid rows, input order
  rejected: { index: number; tag: string | null; issue: string }[]
}

export interface CollapsedEndpoint {
  tag: string
  providerName: string
  rows: number
  quantization: Quantization
  rowQuantizations: Quantization[]
  mixedQuantization: boolean
  uptime1d: number | null
  uptime5m: number | null
  status: number
  contextLength: number
  maxCompletion: number | null
  supportedParameters: string[]
  /** The input rows' own pricing objects (shared references, not copies): callers must not mutate them. */
  pricing: RawPricing[]
  tpsP50: number | null
  tpsP90: number | null
  latencyP50Ms: number | null
  latencyP90Ms: number | null
}

/**
 * Code-unit string compare (`<` / `>`), never locale order, so `'B' < 'a'`.
 * Shared by every routing module that sorts by tag.
 */
export function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** `<path>: <message>` for the first Zod issue; the root path prints as `(root)`. */
function issueText(issue: { readonly path: readonly PropertyKey[]; readonly message: string } | undefined): string {
  if (!issue) return '(root): invalid'
  const path = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)'
  return `${path}: ${issue.message}`
}

function tagOf(row: unknown): string | null {
  if (typeof row !== 'object' || row === null) return null
  const tag = (row as { tag?: unknown }).tag
  return typeof tag === 'string' ? tag : null
}

/**
 * Validates the envelope (throws when it is invalid), then each row on its own:
 * a failing row is reported in `rejected` by index without dropping the others.
 */
export function parseEndpointsResponse(json: unknown): EndpointsParseResult {
  const envelope = endpointsResponseSchema.safeParse(json)
  if (!envelope.success) throw new Error(`Invalid endpoints response: ${issueText(envelope.error.issues[0])}`)
  const endpoints: RawEndpoint[] = []
  const rejected: EndpointsParseResult['rejected'] = []
  envelope.data.data.endpoints.forEach((row, index) => {
    const parsed = rawEndpointSchema.safeParse(row)
    if (parsed.success) endpoints.push(parsed.data)
    else rejected.push({ index, tag: tagOf(row), issue: issueText(parsed.error.issues[0]) })
  })
  return { modelId: envelope.data.data.id, endpoints, rejected }
}

const QUANTIZATION_SET: ReadonlySet<string> = new Set(QUANTIZATIONS)

/** Lower-cased member of `QUANTIZATIONS`; anything else, null or absent is `'unknown'` (C6). */
export function normalizeQuantization(raw: string | null | undefined): Quantization {
  if (raw === null || raw === undefined) return 'unknown'
  const lower = raw.toLowerCase()
  return QUANTIZATION_SET.has(lower) ? (lower as Quantization) : 'unknown'
}

// ── C7 collapse primitives: shared with Task 1-2's history merge so both use one implementation ──

/** C7 minimum: `null` when any value is null or absent, and for an empty list; -0 is returned as 0. */
export function minOrNull(values: (number | null | undefined)[]): number | null {
  let out: number | null = null
  for (const v of values) {
    if (v === null || v === undefined) return null
    out = out === null ? v : Math.min(out, v)
  }
  return out === null ? null : out + 0 // `+ 0` normalises -0 for a JSON round trip
}

/** C7 maximum: `null` when any value is null or absent, and for an empty list; -0 is returned as 0. */
export function maxOrNull(values: (number | null | undefined)[]): number | null {
  let out: number | null = null
  for (const v of values) {
    if (v === null || v === undefined) return null
    out = out === null ? v : Math.max(out, v)
  }
  return out === null ? null : out + 0 // `+ 0` normalises -0 for a JSON round trip
}

/** K8/C7 status: 0 when every status is 0 (and for an empty list), else the smallest non-zero value. */
export function collapseStatus(statuses: number[]): number {
  let out = 0
  for (const s of statuses) {
    if (s !== 0 && (out === 0 || s < out)) out = s
  }
  return out
}

/**
 * One tag's rows as one candidate (K8, C7). Every rule is order-free. `pricing`
 * holds the rows' own pricing objects (shared references): callers must not mutate them.
 */
function collapseGroup(tag: string, rows: RawEndpoint[]): CollapsedEndpoint {
  const declared = new Set(rows.map((r) => normalizeQuantization(r.quantization)))
  const rowQuantizations = QUANTIZATIONS.filter((q) => declared.has(q))
  const mixedQuantization = rowQuantizations.length > 1
  const maxCompletions = rows.map((r) => r.max_completion_tokens).filter((m): m is number => typeof m === 'number')
  const parameterSets = rows.map((r) => new Set(r.supported_parameters))
  const supportedParameters = [...parameterSets[0]].filter((p) => parameterSets.every((s) => s.has(p))).sort(byCodeUnit)
  const pricing = rows
    .map((r) => ({ key: JSON.stringify(r.pricing), value: r.pricing }))
    .sort((a, b) => byCodeUnit(a.key, b.key))
    .map((p) => p.value)
  return {
    tag,
    providerName: rows.map((r) => r.provider_name).sort(byCodeUnit)[0],
    rows: rows.length,
    quantization: mixedQuantization ? 'unknown' : rowQuantizations[0],
    rowQuantizations,
    mixedQuantization,
    uptime1d: minOrNull(rows.map((r) => r.uptime_last_1d)),
    uptime5m: minOrNull(rows.map((r) => r.uptime_last_5m)),
    status: collapseStatus(rows.map((r) => r.status)),
    contextLength: Math.min(...rows.map((r) => r.context_length)),
    maxCompletion: maxCompletions.length > 0 ? Math.min(...maxCompletions) : null,
    supportedParameters,
    pricing,
    tpsP50: minOrNull(rows.map((r) => r.throughput_last_30m?.p50)),
    tpsP90: minOrNull(rows.map((r) => r.throughput_last_30m?.p90)),
    latencyP50Ms: maxOrNull(rows.map((r) => r.latency_last_30m?.p50)),
    latencyP90Ms: maxOrNull(rows.map((r) => r.latency_last_30m?.p90))
  }
}

/** Rows sharing a tag become one candidate (K8, C7). Sorted by tag. */
export function collapseEndpoints(endpoints: RawEndpoint[]): CollapsedEndpoint[] {
  const groups = new Map<string, RawEndpoint[]>()
  for (const row of endpoints) {
    const group = groups.get(row.tag)
    if (group) group.push(row)
    else groups.set(row.tag, [row])
  }
  return [...groups.keys()].sort(byCodeUnit).map((tag) => collapseGroup(tag, groups.get(tag) as RawEndpoint[]))
}

/** One observation per tag at the snapshot's `fetchedAt`, sorted by tag. */
export function extractObservations(snapshot: EndpointSnapshot): RoutingObservation[] {
  return collapseEndpoints(snapshot.endpoints).map((c) => ({
    tag: c.tag,
    observedAt: snapshot.fetchedAt,
    uptime1d: c.uptime1d,
    uptime5m: c.uptime5m,
    status: c.status,
    tpsP50: c.tpsP50,
    tpsP90: c.tpsP90,
    latencyP50Ms: c.latencyP50Ms,
    latencyP90Ms: c.latencyP90Ms
  }))
}
