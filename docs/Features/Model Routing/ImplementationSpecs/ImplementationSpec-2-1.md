# Implementation specification 2-1 — OpenRouter routing transport and parsers

Paired [task](../Tasks/Task-2-1.md). Decisions: [roadmap](../roadmap.md) MR-D9, MR-D12, MR-D14; user decision MR-D18; [overview](../Tasks/Phase-2-Overview.md) K1–K4 and clarifications C1–C11. Phase 1 contracts from [ImplementationSpec-1-1](ImplementationSpec-1-1.md). **Not started.**

## Files and insertion points

Verified 2026-10-02 at `a9842a5`.

| File | Action |
|---|---|
| `src/shared/routing.ts` | Append the block below after `TierResult` (:289–303). Nothing above it changes. |
| `src/shared/routing.test.ts` | Append `describe('Table S2 — transport vocabulary')` (table S2). Existing tests unchanged. |
| `src/main/routing/preflightCore.ts`, `preflightCore.test.ts` | New. Table P. |
| `src/main/routing/cacheProbeCore.ts`, `cacheProbeCore.test.ts` | New. Tables Q, E, B. |
| `src/main/routing/routingCredentialCore.ts`, `routingCredentialCore.test.ts` | New. Table K. |
| `src/main/routing/__fixtures__/preflight-guardrails-2026-10-02.json` | New. Content below, verbatim. |
| `src/main/routing/__fixtures__/preflight-data-policy-2026-10-02.json` | New. Content below, verbatim. |
| `src/main/services/routingClient.ts`, `routingClient.test.ts` | New. Table T. |
| `src/main/services/modelCatalog.ts:124` | `async function readCapped(` becomes `export async function readCapped(`. No other change to the file. |

The three cores import only `zod`, `../../shared/routing` and sibling routing modules (`endpointsCore` for `byCodeUnit`). They never read the clock, randomness, environment or file system, and never import from `../services`, `../db` or `../adapters`. `routingClient.ts` may import `./modelCatalog` (types and `readCapped`), `./logger` (`scrubSecrets`), `./openrouterKeys` (`OPENROUTER_GATEWAY_BASE_URL`), the routing cores and shared contracts. It holds no state.

## Normative contracts — `src/shared/routing.ts` (appended block)

```ts
// ── Phase 2 — transport vocabulary (Task 2-1) ──

/** A routable endpoint tag as Chorus accepts it from an OpenRouter response (C2, C3). At most 64 characters. */
export const ROUTING_TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/
export const routingTagSchema = z.string().regex(ROUTING_TAG_PATTERN)

/** The only reasons a routing request can fail. Never a provider body, header, URL or exception text. */
export const ROUTING_FAILURES = [
  'unreachable', 'auth-failed', 'rate-limited', 'provider-error', 'unexpected-status', 'unrecognized', 'model-mismatch'
] as const
export const routingFailureSchema = z.enum(ROUTING_FAILURES)
export type RoutingFailure = z.infer<typeof routingFailureSchema>

export const ROUTING_FAILURE_MESSAGES: Record<RoutingFailure, string> = {
  unreachable: 'Could not reach OpenRouter.',
  'auth-failed': 'Authentication failed — the credential was rejected.',
  'rate-limited': 'Rate limited by OpenRouter.',
  'provider-error': 'OpenRouter returned an error.',
  'unexpected-status': 'Unexpected response from OpenRouter.',
  unrecognized: 'OpenRouter returned an unrecognized response.',
  'model-mismatch': 'OpenRouter returned endpoints for a different model.'
}

export const PREFLIGHT_STEPS = ['guardrails', 'dataPolicy'] as const
export type PreflightStep = (typeof PREFLIGHT_STEPS)[number]

/** Why a preflight body did not yield a list. Every one means "unknown" (MR-D12, Phase 1 K3). */
export const PREFLIGHT_ISSUES = [
  'unexpected-status', 'unrecognized-body', 'unrecognized-message', 'unbalanced-reason',
  'bad-tag', 'funnel-inconsistent', 'step-mismatch', 'count-mismatch'
] as const
export const preflightIssueSchema = z.enum(PREFLIGHT_ISSUES)
export type PreflightIssue = z.infer<typeof preflightIssueSchema>

export const CACHE_PROBE_OUTCOMES = ['verified', 'not-cached', 'inconclusive'] as const
export const cacheProbeOutcomeSchema = z.enum(CACHE_PROBE_OUTCOMES)
export type CacheProbeOutcome = z.infer<typeof cacheProbeOutcomeSchema>

/** Why an eligible, due tag was not probed: the $ cap, a verification-only tag limit, or an aborted refresh. */
export const PROBE_SKIP_REASONS = ['cap', 'limit', 'aborted'] as const
export const probeSkipSchema = z.strictObject({ tag: routingTagSchema, reason: z.enum(PROBE_SKIP_REASONS) })
export type ProbeSkip = z.infer<typeof probeSkipSchema>
```

## Fixtures (verbatim)

Copied from the Phase 0 reports in `%TEMP%` (they are not committed and may disappear; this text is authoritative). The reports stored `error.message` and `error.metadata` (first run) or `error.message` and `error.metadata.routing_funnel` (second run); `error.code` was never captured and is omitted. `usage` was `null` in all three. Endpoint metadata and an account-level guardrail reason only; no keys, prompts or user content.

`src/main/routing/__fixtures__/preflight-guardrails-2026-10-02.json` (from `chorus-routing-live-MDU7qB\report.json`, `guardrailPreflight[1]`):

```json
{
  "_note": "OpenRouter 404 body of the guardrail preflight (provider { order: ['chorus-preflight-none'], allow_fallbacks: false }) for deepseek/deepseek-v4.1-flash, 2026-10-02, Phase 0 --pricing run (guardrailPreflight[1]). error.message and error.metadata are verbatim; error.code was not captured. Endpoint metadata and an account-level guardrail reason only.",
  "status": 404,
  "body": {
    "error": {
      "message": "No endpoints found for deepseek/deepseek-v4.1-flash. Every candidate endpoint was removed during routing: Filter by Guardrails removed deepseek (Paid model training violation (account settings)); Filter by Fallback removed relace, open-inference/fp4, morph/fp8, inference-net, wafer, sail-research/fp4, decart/fp4, ionstream, io-net/fp8, dekallm, deepinfra/fp8, streamlake/fp8, atlas-cloud/fp8, digitalocean, gmicloud/fp8, coreweave/fp8, makora/fp8, nextbit/fp8, phala, novita/fp8, baidu/fp8, baseten/fp8, together, siliconflow/fp8, modal, parasail/fp8, fireworks, venice/fp8, fireworks/us, baseten/fast, alibaba.",
      "metadata": {
        "routing_funnel": [
          { "step": "Initial Endpoints", "endpoint_count": 33 },
          { "step": "Filter by Guardrails", "endpoint_count": 32, "reason": "Paid model training violation (account settings)" },
          { "step": "Apply Status Sorting", "endpoint_count": 32 },
          { "step": "Filter by Fallback", "endpoint_count": 0 }
        ],
        "failed_routing_step": "Filter by Fallback"
      }
    }
  }
}
```

`src/main/routing/__fixtures__/preflight-data-policy-2026-10-02.json` (from `chorus-routing-live-A9VBtp\report.json`, `dataPolicyPreflight[0]` and `[1]`):

```json
{
  "_note": "OpenRouter 404 bodies of the preflight without and with provider.data_collection 'deny' for deepseek/deepseek-v4.1-flash, 2026-10-02, Phase 0 --council run (dataPolicyPreflight[0] and [1]). error.message and error.metadata.routing_funnel are verbatim; failed_routing_step and error.code were not captured. Under deny the Guardrails step is absent.",
  "withoutDeny": {
    "status": 404,
    "body": {
      "error": {
        "message": "No endpoints found for deepseek/deepseek-v4.1-flash. Every candidate endpoint was removed during routing: Filter by Guardrails removed deepseek (Paid model training violation (account settings)); Filter by Fallback removed relace, open-inference/fp4, morph/fp8, inference-net, wafer, sail-research/fp4, decart/fp4, ionstream, io-net/fp8, dekallm, deepinfra/fp8, streamlake/fp8, atlas-cloud/fp8, digitalocean, gmicloud/fp8, coreweave/fp8, makora/fp8, nextbit/fp8, phala, novita/fp8, baidu/fp8, baseten/fp8, alibaba, together, siliconflow/fp8, modal, parasail/fp8, fireworks, venice/fp8, fireworks/us, baseten/fast.",
        "metadata": {
          "routing_funnel": [
            { "step": "Initial Endpoints", "endpoint_count": 33 },
            { "step": "Filter by Guardrails", "endpoint_count": 32, "reason": "Paid model training violation (account settings)" },
            { "step": "Filter by Fallback", "endpoint_count": 0 }
          ]
        }
      }
    }
  },
  "withDeny": {
    "status": 404,
    "body": {
      "error": {
        "message": "No endpoints found for deepseek/deepseek-v4.1-flash. Every candidate endpoint was removed during routing: Filter by Data Policy removed deepseek; Filter by Fallback removed relace, open-inference/fp4, morph/fp8, inference-net, wafer, sail-research/fp4, decart/fp4, ionstream, io-net/fp8, dekallm, deepinfra/fp8, streamlake/fp8, atlas-cloud/fp8, digitalocean, gmicloud/fp8, coreweave/fp8, makora/fp8, nextbit/fp8, phala, novita/fp8, baidu/fp8, baseten/fp8, alibaba, together, siliconflow/fp8, modal, parasail/fp8, fireworks, venice/fp8, fireworks/us, baseten/fast.",
        "metadata": {
          "routing_funnel": [
            { "step": "Initial Endpoints", "endpoint_count": 33 },
            { "step": "Filter by Data Policy", "endpoint_count": 32 },
            { "step": "Filter by Fallback", "endpoint_count": 0 }
          ]
        }
      }
    }
  }
}
```

If the reports still exist at execution, the implementer may regenerate these with a one-off `node -e` and diff; any difference is reported, and this text wins. The tag set of each Fallback clause plus `deepseek` equals the golden fixture's 32 tags (verified while drafting).

## `preflightCore.ts`

```ts
export const PREFLIGHT_NONEXISTENT_TAG = 'chorus-preflight-none'
export const PREFLIGHT_MARKER = 'Every candidate endpoint was removed during routing: '
export const PREFLIGHT_STEP_NAMES: Record<PreflightStep, string> = {
  guardrails: 'Filter by Guardrails',
  dataPolicy: 'Filter by Data Policy'
}

export interface PreflightRequestBody {
  model: string
  provider: { order: string[]; allow_fallbacks: false; data_collection?: 'deny' }
  messages: { role: 'user'; content: string }[]
  max_tokens: 1
}
/** The guardrails preflight has no data_collection key; the dataPolicy preflight adds 'deny' (MR-D18). */
export function preflightRequestBody(model: string, step: PreflightStep): PreflightRequestBody

/** Rows per tag in a snapshot, on a null-prototype object; read it with Object.hasOwn. */
export function rowsPerTag(endpoints: readonly RawEndpoint[]): Record<string, number>

export interface PreflightParseInput {
  status: number
  body: unknown // JSON.parse of the capped body
  step: PreflightStep
  rowsPerTag: Readonly<Record<string, number>>
}
export type PreflightParseResult = { removed: string[]; issue: null } | { removed: null; issue: PreflightIssue }
export function parsePreflight(input: PreflightParseInput): PreflightParseResult
```

**Request body (exact).** `preflightRequestBody(slug, 'guardrails')` serialises, with `JSON.stringify`, to:

```json
{"model":"deepseek/deepseek-v4.1-flash","provider":{"order":["chorus-preflight-none"],"allow_fallbacks":false},"messages":[{"role":"user","content":"OK"}],"max_tokens":1}
```

and `'dataPolicy'` to the same with `"allow_fallbacks":false,"data_collection":"deny"` inside `provider`. Keys are built in exactly that insertion order (Phase 0's body, `verify-routing-live.ts:63`).

**Body schema.** Non-strict (extra keys such as `code`, `reason` and `failed_routing_step` are ignored):

```ts
const preflightBodySchema = z.object({
  error: z.object({
    message: z.string(),
    metadata: z.object({
      routing_funnel: z.array(z.object({ step: z.string().min(1), endpoint_count: z.number().int().min(0) })).min(1)
    })
  })
})
```

**Parsing rules (normative; checked in this order, the first failure wins).**

1. `status !== 404` → `unexpected-status`.
2. `body` fails `preflightBodySchema` → `unrecognized-body`.
3. `message` does not contain `PREFLIGHT_MARKER` → `unrecognized-message`. The tail is everything after its first occurrence. If the tail ends with `.`, remove exactly one `.`.
4. Split the tail with `/; (?=Filter by )/`. Each clause must match `/^(Filter by .+?) removed (.+)$/`, else `unrecognized-message`. Group 1 is the step name (for example `Filter by Guardrails`); group 2 is the rest.
5. **Reason.** If the rest ends with `)`, walk back from its last character with a depth counter (`)` adds 1, `(` subtracts 1) to the index `i` where depth returns to 0. No such index → `unbalanced-reason`. `i === 0` or the character before `i` is not a space → `unrecognized-message`. Otherwise the rest becomes `rest.slice(0, i - 1)`. A `; ` inside the parentheses never splits a clause, because rule 4 splits only before `Filter by `.
6. **Tags.** Split the rest on `, `. Every piece must match `ROUTING_TAG_PATTERN`, else `bad-tag`. Deduplicate, then sort with `byCodeUnit`.
7. A step name that appears in two clauses → `unrecognized-message`.
8. **Funnel.** The first entry's step is `Initial Endpoints`; no `endpoint_count` exceeds the one before it; the last is 0; no step name appears twice. Otherwise `funnel-inconsistent`. A step's removal is the previous entry's count minus its own.
9. Every clause's step must be a funnel step with a removal above 0, and every funnel step with a removal above 0 must have a clause. Otherwise `step-mismatch`.
10. Let the target be `PREFLIGHT_STEP_NAMES[step]`. No clause for the target → `{ removed: [], issue: null }` (by rule 9 its removal is 0 or the step is absent).
11. **Count (C1).** The sum over the target's tags of `Object.hasOwn(rowsPerTag, tag) ? rowsPerTag[tag] : 1` must equal the target's removal, else `count-mismatch`. Otherwise `{ removed: tags, issue: null }`.

Only the target step is count-checked (C2). Guardrails are read only from the `guardrails` preflight and data policy only from the `dataPolicy` preflight: under deny the Guardrails step is absent, so parsing guardrails from the deny body returns a consistent `[]` that is wrong (P5). The service never does that.

## `cacheProbeCore.ts`

```ts
export const CACHE_PROBE_CAP_USD = 0.05 // MR-D18
export const CACHE_PROBE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000 // MR-D9: re-probe a record older than 14 days
export const CACHE_PROBE_CALLS = 3
export const CACHE_PROBE_MAX_TOKENS = 64
export const CACHE_PROBE_PROMPT_TOKENS = 4500 // measured 4,457–4,464 (C4)
export const CACHE_PROBE_FILLER_LINES = 220
export const CACHE_PROBE_CONCURRENCY = 5
export const CACHE_PROBE_GAP_MS = 1500
export const CACHE_PROBE_USER_TEXT = 'Reply with the single word OK.'

export function probeFiller(): string
export function probeSystemText(runNonce: string, tag: string): string
export interface ProbeRequestBody {
  model: string
  provider: { order: string[]; allow_fallbacks: false }
  messages: { role: 'system' | 'user'; content: string }[]
  reasoning: { effort: 'low' }
  max_tokens: 64
}
export function probeRequestBody(model: string, tag: string, runNonce: string): ProbeRequestBody

export function probeTagEstimateUsd(cost: Pick<CandidateCost, 'promptPerM' | 'completionPerM'>): number

export interface ProbePlanInput {
  result: TierResult // the refresh's own computeTiers result
  cache: CacheVerification // as stored
  now: string // UTC ISO instant
  capUsd: number
  tagLimit: number | null // verification-only (C21)
}
export interface ProbePlan {
  planned: { tag: string; estimateUsd: number }[] // Balanced-score order
  estimateUsd: number // sum of planned, in plan order
  capUsd: number
  fresh: string[] // eligible tags with a record at most 14 days old, sorted by tag
  notProbed: ProbeSkip[] // reasons 'cap' or 'limit' only, in Balanced-score order
}
export function planCacheProbe(input: ProbePlanInput): ProbePlan // throws RangeError on an invalid now

export interface ProbeUsage { promptTokens: number | null; cachedTokens: number | null; costUsd: number | null }
export function extractProbeUsage(body: unknown): ProbeUsage
export type ProbeCallRecord = { ok: true; usage: ProbeUsage } | { ok: false }
export function evaluateProbe(calls: readonly ProbeCallRecord[]): CacheProbeOutcome
export function probeCallSpendUsd(call: ProbeCallRecord, perCallEstimateUsd: number): number
```

**Prompt (C4, C5).** `probeFiller()` returns Phase 0's filler exactly (`verify-routing-live.ts:78`):

```ts
Array.from({ length: 220 }, (_, i) => `export function step${i}(value: number): number { return value * ${i + 3} + ${(i * 7) % 11}; }`).join('\n')
```

It is 16,305 characters, SHA-256 `e0832703a43d98fc68a4809d982df851025aab4cb4f1cc8fc64a884d9cbca08c`. `probeSystemText(runNonce, tag)` = `` `Session ${runNonce} ${tag}. Reference module follows.\n${probeFiller()}` ``. Neither ever contains user content.

**Request body (exact key order).**

```ts
{
  model,
  provider: { order: [tag], allow_fallbacks: false },
  messages: [{ role: 'system', content: probeSystemText(runNonce, tag) }, { role: 'user', content: CACHE_PROBE_USER_TEXT }],
  reasoning: { effort: 'low' },
  max_tokens: 64
}
```

No `data_collection` key: the probe carries no user content, and Phase 0 measured this shape.

**Estimate.** `probeTagEstimateUsd(cost) = 3 × (cost.promptPerM × 4500 + cost.completionPerM × 64) / 1_000_000`, from the candidate's `cost` in the `TierResult` (overrides resolved at that result's time; uncached prices).

**Plan (K4, C7).**

1. `nowMs = Date.parse(now)` after `z.iso.datetime()` accepts it; otherwise throw `RangeError('Invalid time: now')`.
2. Eligible = candidates with `excludedBy.length === 0`, `cost !== null` and `scores.balanced !== undefined`.
3. Order eligible by `scores.balanced` descending, ties by tag ascending (`byCodeUnit`).
4. A tag is **due** when `cache` has no own record for it, or `nowMs − Date.parse(record.checkedAt) > CACHE_PROBE_MAX_AGE_MS`. Non-due eligible tags form `fresh`, sorted by tag.
5. Walk due tags in order with `capCut = false` and `cum = 0`: if `capCut`, skip with `cap`; else if `tagLimit !== null && planned.length >= tagLimit`, skip with `limit`; else if `cum + estimate > capUsd`, set `capCut = true` and skip with `cap`; else plan it and add its estimate to `cum`.
6. `estimateUsd = cum`. Excluded tags are never planned, whatever the cache says.

**Usage extraction.** Field by field, each independently: `promptTokens` = `body.usage.prompt_tokens` when it is a non-negative integer, else `null`; `cachedTokens` = `body.usage.prompt_tokens_details.cached_tokens` when a non-negative integer, else `null`; `costUsd` = `body.usage.cost` when a finite number ≥ 0, else `null`. Any missing level gives `null`s. The completion text is never read.

**Evaluation (K4, C6).** `verified` when call index 1 or 2 is `ok` with `cachedTokens > 0`. `not-cached` when there are exactly three calls, all `ok`, each with `cachedTokens === 0`. Otherwise `inconclusive`. Spend per call: `ok` with a numeric `costUsd` → that; `ok` without → `perCallEstimateUsd` (the tag estimate ÷ 3); not `ok` → 0.

## `routingCredentialCore.ts`

```ts
/** Structural subsets of CredentialProfileRow and ProviderConfigRow (db/schema.ts:248, :220); the rows are assignable. */
export interface RoutingCredentialRow { readonly id: string; readonly providerId: string; readonly label: string; readonly unavailableSince: string | null }
export interface RoutingProviderRow { readonly id: string; readonly authMode: string; readonly baseUrl: string | null }

export const CREDENTIAL_REFUSALS = ['not-found', 'provider-missing', 'management', 'not-api-key', 'not-openrouter', 'unavailable', 'envelope-mismatch'] as const
export type CredentialRefusal = (typeof CREDENTIAL_REFUSALS)[number]
export type CredentialCheck = { ok: true } | { ok: false; refusal: CredentialRefusal; message: string }

export function normalizeBaseUrl(url: string): string // url.replace(/\/+$/, ''), as teamMemberProfiles.ts:15
export function checkRoutingCredential(profile: RoutingCredentialRow | null, provider: RoutingProviderRow | null, gatewayBaseUrl: string): CredentialCheck
export function checkEnvelopeBaseUrl(envelopeBaseUrl: string | undefined, label: string, gatewayBaseUrl: string): CredentialCheck
export function credentialRefusalMessage(refusal: CredentialRefusal, label: string | null): string
```

**`checkRoutingCredential` order (C10).** The first that applies wins:

| # | Condition | Refusal |
|---|---|---|
| 1 | `profile === null` | `not-found` |
| 2 | `provider === null` or `provider.id !== profile.providerId` | `provider-missing` |
| 3 | `provider.authMode === 'management'` | `management` |
| 4 | `provider.authMode !== 'api_key'` | `not-api-key` |
| 5 | `provider.baseUrl === null` or `normalizeBaseUrl(provider.baseUrl) !== normalizeBaseUrl(gatewayBaseUrl)` | `not-openrouter` |
| 6 | `profile.unavailableSince !== null` | `unavailable` |

Otherwise `{ ok: true }`. The comparison is exact after trailing-slash removal (no case folding), like `teamMemberProfiles.ts:15`. The literal `'management'` equals `MANAGEMENT_AUTH_MODE` (`shared/ipc.ts:941`); the core does not import `shared/ipc`, and a test asserts the equality.

**`checkEnvelopeBaseUrl`.** `undefined` → ok. Otherwise ok only when `normalizeBaseUrl(envelopeBaseUrl) === normalizeBaseUrl(gatewayBaseUrl)`; else `envelope-mismatch`.

**Messages (exact).** `label` is the profile label; these are the only variable parts.

| Refusal | Message |
|---|---|
| `not-found` | `The routing credential was not found.` |
| `provider-missing` | `The routing credential has no provider.` |
| `management` | `Routing is not available for a management credential.` |
| `not-api-key` | `Routing needs an OpenRouter API-key credential.` |
| `not-openrouter` | `Routing needs a credential for the OpenRouter gateway.` |
| `unavailable` | `` `Credential profile '${label}' is unavailable. Re-enter the credential in Settings.` `` |
| `envelope-mismatch` | `` `Credential profile '${label}' points at a different base URL; routing only calls the OpenRouter gateway.` `` |

The service passes every message through `scrubSecrets` before it leaves (a label is user text).

## `routingClient.ts`

```ts
/** FetchInitLike (modelCatalog.ts:61) has no body; POST needs one (C8). A FetchLike stub stays assignable. */
export type RoutingFetchInit = FetchInitLike & { readonly body?: string }
export type RoutingFetchLike = (url: string, init: RoutingFetchInit) => Promise<FetchResponseLike>

export const ENDPOINTS_RESPONSE_CAP_BYTES = 2_000_000 // fixture: 64,233 bytes for 33 rows
export const PREFLIGHT_BODY_CAP_BYTES = 65_536
export const PROBE_RESPONSE_CAP_BYTES = 262_144
export const ROUTING_REQUEST_TIMEOUT_MS = 10_000

export interface RoutingCallFailure { readonly ok: false; readonly failure: RoutingFailure; readonly status: number | null }
export interface RoutingCallBase {
  readonly key: string // decrypted by the caller for this one use
  readonly model: string // a registry slug
  readonly fetchImpl?: RoutingFetchLike // default: the global fetch
  readonly signal?: AbortSignal // the service's dispose signal; combined with the timeout
}

export function endpointsUrl(model: string): string
export function failureForStatus(status: number): RoutingFailure

export type EndpointsCallResult = { readonly ok: true; readonly endpoints: RawEndpoint[]; readonly rejectedRows: number } | RoutingCallFailure
export function fetchRoutingEndpoints(input: RoutingCallBase): Promise<EndpointsCallResult>

export type PreflightCallResult =
  | { readonly ok: true; readonly removed: string[] | null; readonly issue: PreflightIssue | null }
  | RoutingCallFailure
export function sendRoutingPreflight(
  input: RoutingCallBase & { readonly step: PreflightStep; readonly rowsPerTag: Readonly<Record<string, number>> }
): Promise<PreflightCallResult>

export type ProbeCallResult = { readonly ok: true; readonly usage: ProbeUsage } | RoutingCallFailure
export function sendRoutingProbeCall(input: RoutingCallBase & { readonly tag: string; readonly runNonce: string }): Promise<ProbeCallResult>
```

A file-header comment narrates this as the third key-bearing call class (D33 resolution (d), D58), admitted by MR-D18 with its constraints, in the style of `modelCatalog.ts:16–44`.

**Common transport rules (MR-D18, K2).**

- URLs: `endpointsUrl(model)` = `` `${OPENROUTER_GATEWAY_BASE_URL}/models/${model.split('/').map(encodeURIComponent).join('/')}/endpoints` ``; completions = `` `${OPENROUTER_GATEWAY_BASE_URL}/chat/completions` ``. No query string. The key is never part of either.
- Headers (C9), built in this order: `accept: 'application/json'`, ``authorization: `Bearer ${key}` ``, and on POST `content-type: 'application/json'`. No other header, no provider or envelope `extraHeaders`.
- `signal`: `AbortSignal.any([AbortSignal.timeout(ROUTING_REQUEST_TIMEOUT_MS), ...(input.signal ? [input.signal] : [])])`.
- An empty `key` returns `{ ok: false, failure: 'auth-failed', status: null }` without calling `fetchImpl`.
- `fetchImpl` throwing or rejecting (timeout and abort included) → `{ ok: false, failure: 'unreachable', status: null }`. The exception is discarded wholesale; its cause chain can carry the request.
- `failureForStatus`: 401 or 403 → `auth-failed`; 429 → `rate-limited`; ≥ 500 → `provider-error`; anything else → `unexpected-status`.
- Bodies are read only with the exported `readCapped(res, cap)` from `modelCatalog.ts`; everything not read is cancelled with `void res.body?.cancel().catch(() => undefined)`. No parsed value, header or body text is ever put into a returned string. No retry, no backoff.

**`fetchRoutingEndpoints`.** GET. A non-2xx status → body cancelled unread → `{ ok: false, failure: failureForStatus(status), status }`. A 2xx → `readCapped(res, ENDPOINTS_RESPONSE_CAP_BYTES)`; `null` → `unrecognized`; `JSON.parse` throws → `unrecognized`; `parseEndpointsResponse` throws → `unrecognized`; `modelId !== model` → `model-mismatch`; zero valid rows → `unrecognized`. Otherwise `{ ok: true, endpoints, rejectedRows: rejected.length }` (only the count of rejected rows leaves; their issue text does not).

**`sendRoutingPreflight`.** POST `JSON.stringify(preflightRequestBody(model, step))`.

| Status | Body | Result |
|---|---|---|
| 404 | `readCapped(res, PREFLIGHT_BODY_CAP_BYTES)`; `null` (over cap or stream error) or `JSON.parse` failure → `{ ok: true, removed: null, issue: 'unrecognized-body' }` | Otherwise `parsePreflight({ status: 404, body, step, rowsPerTag })`; then, if any returned tag differs from `scrubSecrets(tag)`, `{ ok: true, removed: null, issue: 'bad-tag' }` (C3) |
| 2xx | Cancelled unread | `{ ok: true, removed: null, issue: 'unexpected-status' }` |
| 401, 403 | Cancelled unread, always | `{ ok: false, failure: 'auth-failed', status }` |
| Any other | Cancelled unread | `{ ok: false, failure: failureForStatus(status), status }` |

**`sendRoutingProbeCall`.** POST `JSON.stringify(probeRequestBody(model, tag, runNonce))`. A non-2xx status → cancelled unread → `{ ok: false, failure: failureForStatus(status), status }` (a 404 is `unexpected-status`; it is free). A 2xx → `readCapped(res, PROBE_RESPONSE_CAP_BYTES)`; `null` or `JSON.parse` failure → `unrecognized`; otherwise `{ ok: true, usage: extractProbeUsage(body) }`.

## Test cases

Tests import `{ describe, it, expect }` from `vitest`, read fixtures with `readFileSync(join(__dirname, '__fixtures__/<file>'), 'utf8')`, and never touch the network. Every key-shaped string in a test (the fake key, P18, S2-1, T13) is assembled at runtime by concatenation, such as `'sk-or-v1-' + 'a'.repeat(20)`, never written as one literal; otherwise `npm run grep:secrets` fails (`modelCatalog.test.ts:25`). `rows` below is `rowsPerTag` of the golden endpoints fixture (32 tags; `baseten/fp8` → 2, every other tag → 1).

**Table S2 — `src/shared/routing.test.ts`.**

| # | Case | Expect |
|---|---|---|
| S2-1 | `routingTagSchema` on `deepinfra/fp8`, `together`, `baseten/fast`; on `deep seek`, `-x`, a 65-character tag, `sk-or-v1-` + 64 hex digits | First three pass; last four fail. |
| S2-2 | `Object.keys(ROUTING_FAILURE_MESSAGES)` | Equals `ROUTING_FAILURES` (same order); every message is non-empty and contains no `${`. |
| S2-3 | `probeSkipSchema` with reason `cap`; with reason `later`; with an extra key | Pass; fail; fail. |

**Table P — `preflightCore.test.ts`.** Real bodies (P1–P6); synthetic (P7–P24), each built as `{ error: { message: PREFIX + tail, metadata: { routing_funnel } } }` with `PREFIX = 'No endpoints found for x/y. Every candidate endpoint was removed during routing: '` and funnel entries written `[step, count]`.

| # | Body | Step | rowsPerTag | Expect |
|---|---|---|---|---|
| P1 | guardrails fixture | `guardrails` | `rows` | `{ removed: ['deepseek'], issue: null }` |
| P2 | guardrails fixture | `dataPolicy` | `rows` | `{ removed: [], issue: null }` |
| P3 | data-policy fixture `withoutDeny` (no `Apply Status Sorting`) | `guardrails` | `rows` | `['deepseek']` |
| P4 | data-policy fixture `withDeny` | `dataPolicy` | `rows` | `['deepseek']` |
| P5 | data-policy fixture `withDeny` | `guardrails` | `rows` | `[]`: the consistent-but-wrong reading the service must never use (it documents why two preflights exist) |
| P6 | guardrails fixture | `guardrails` | `{}` | `['deepseek']` (unknown tags count 1) |
| P7 | `Filter by Guardrails removed a/fp8, b (Reason (x) (y)); Filter by Fallback removed c.`; `[Initial Endpoints, 3], [Filter by Guardrails, 1], [Filter by Fallback, 0]` | `guardrails` | `{}` | `['a/fp8', 'b']` (nested parentheses) |
| P8 | `Filter by Guardrails removed baseten/fp8, x (r); Filter by Fallback removed c.`; `[Initial Endpoints, 4], [Filter by Guardrails, 1], [Filter by Fallback, 0]` | `guardrails` | `{ 'baseten/fp8': 2 }` | `['baseten/fp8', 'x']` (2 + 1 rows = removal 3) |
| P9 | Same as P8 | `guardrails` | `{}` | `count-mismatch` (2 tags ≠ 3 rows) |
| P10 | `Filter by Guardrails removed deepseek (r); Filter by Fallback removed c.`; `[Initial Endpoints, 4], [Filter by Guardrails, 2], [Filter by Fallback, 0]` | `guardrails` | `{}` | `count-mismatch` |
| P11 | guardrails fixture body with `status: 400`; with `status: 200` | `guardrails` | `rows` | `unexpected-status` both |
| P12 | `{ error: { message: <fixture message>, metadata: {} } }` | `guardrails` | `rows` | `unrecognized-body` (no funnel) |
| P13 | `{ error: { message: 5, metadata: { routing_funnel: [[Initial Endpoints, 1]] } } }`; `null`; `'text'` | `guardrails` | `{}` | `unrecognized-body` each |
| P14 | `No endpoints found that satisfy the max price for this request` (no marker); `[Initial Endpoints, 33]` | `guardrails` | `{}` | `unrecognized-message` (Phase 0's `max_price` shape) |
| P15 | `Filter by Guardrails removed deepseek (r)); Filter by Fallback removed c.`; `[Initial Endpoints, 2], [Filter by Guardrails, 1], [Filter by Fallback, 0]` | `guardrails` | `{}` | `unbalanced-reason` |
| P16 | `Filter by Guardrails removed deepseek(r); …` (no space before `(`), same funnel | `guardrails` | `{}` | `unrecognized-message` |
| P17 | `Filter by Guardrails removed deep seek; Filter by Fallback removed c.`, same funnel | `guardrails` | `{}` | `bad-tag` |
| P18 | `Filter by Guardrails removed ` + `sk-or-v1-` + 64 zeros + `; Filter by Fallback removed c.`, same funnel | `guardrails` | `{}` | `bad-tag` (73 characters) |
| P19 | `Filter by Guardrails removed deepseek, deepseek; Filter by Fallback removed c.`, same funnel | `guardrails` | `{}` | `['deepseek']` (deduplicated; 1 row) |
| P20 | `Filter by Guardrails removed deepseek (a; b); Filter by Fallback removed c.`, same funnel | `guardrails` | `{}` | `['deepseek']` (a `; ` inside the reason does not split) |
| P21 | `Filter by Guardrails removed deepseek (r); Filter by Fallback removed c.`; `[Initial Endpoints, 2], [Filter by Fallback, 0]` | `guardrails` | `{}` | `step-mismatch` (clause without a funnel step) |
| P22 | `Filter by Fallback removed c, d.`; `[Initial Endpoints, 3], [Filter by Guardrails, 2], [Filter by Fallback, 0]` | `guardrails` | `{}` | `step-mismatch` (removal without a clause) |
| P23 | `Filter by Guardrails removed a (r); Filter by Fallback removed c.`; `[Initial Endpoints, 3], [Filter by Guardrails, 2], [Filter by Fallback, 1]` | `guardrails` | `{}` | `funnel-inconsistent` (does not end at 0) |
| P24 | `Filter by Fallback removed c.`; `[Initial Endpoints, 1], [Filter by Guardrails, 1], [Filter by Fallback, 0]` | `guardrails` | `{}` | `[]` (target step present with zero removal) |
| P25 | `Filter by Guardrails removed a, b (r).`; `[Initial Endpoints, 2], [Filter by Guardrails, 0]` | `guardrails` | `{}` | `['a', 'b']` (the guardrails removed everything) |
| P26 | `preflightRequestBody('deepseek/deepseek-v4.1-flash', s)` for both steps | — | — | `JSON.stringify` equals the two exact strings above. |
| P27 | `rowsPerTag(golden endpoints)` | — | — | 32 own keys; `baseten/fp8` 2; `Object.getPrototypeOf(result)` is `null`. |

Every P1–P25 case was run against a prototype of these rules while drafting and gave the value shown.

**Table Q — planning (`cacheProbeCore.test.ts`).** `result` is `computeTiers` of the Phase 1 golden input (ImplementationSpec-1-3 "Golden input": snapshot `fetchedAt` 2026-10-02T09:05:00Z, history from the snapshot, account `['deepseek']` twice, profile `interactive`, effort `low`, default settings, `now` 2026-10-02T09:20:00Z) **but with `cache: {}`**. The cores are pure, so the test imports `routingCore`, `endpointsCore` and `registryCore` directly. Money compares with `Math.abs(actual − expected) < 1e-12`.

| # | Case | Expect |
|---|---|---|
| Q1 | `cache: {}`, cap 0.05, no limit | `planned` tags, in order: atlas-cloud/fp8, morph/fp8, makora/fp8, streamlake/fp8, deepinfra/fp8, venice/fp8, gmicloud/fp8, baidu/fp8, parasail/fp8, nextbit/fp8, novita/fp8, baseten/fp8, siliconflow/fp8, baseten/fast. `estimateUsd` 0.0493873956. `notProbed: []`, `fresh: []`. |
| Q2 | Same, cap 0.02 | First seven planned (atlas-cloud/fp8 … gmicloud/fp8), `estimateUsd` 0.017288676; `notProbed` = the other seven, in order, all `cap` (baidu/fp8 would bring the total to 0.0215647956). |
| Q3 | Same, cap 0.05, `tagLimit: 2` | Planned atlas-cloud/fp8, morph/fp8; `estimateUsd` 0.002497428; 12 `limit`. |
| Q4 | `cache` = the fixture's `cacheVerified`, each with `checkedAt: '2026-10-02T09:15:39Z'`; `now` 2026-10-02T09:20:00Z | `planned: []`, `estimateUsd` 0, `fresh` = the 14 eligible tags sorted by tag, `notProbed: []`. |
| Q5 | Q4's cache, `now` 2026-10-16T09:15:39Z; then 2026-10-16T09:15:40Z | All 14 fresh (exactly 14 days is not older); then all 14 due and planned as in Q1. |
| Q6 | A record for `together` (excluded: undeclared quantization) or `deepseek` | Never planned and never in `fresh`. |
| Q7 | `probeTagEstimateUsd` for atlas-cloud/fp8, morph/fp8, venice/fp8, baidu/fp8, baseten/fast | 0.002011788, 0.00048564, 0.0053505, 0.0042761196, 0.0085608. |
| Q8 | `now: '2026-10-02 09:20'` | Throws `RangeError`. |
| Q9 | Q1 with the candidates array reversed | Strictly equal plan (order comes from scores and tags only). |

**Table E — evaluation and spend.** Rows E1–E4 are the real Phase 0 samples (`[status, prompt, cached, cost]`).

| # | Calls | Expect |
|---|---|---|
| E1 | atlas-cloud/fp8 `[200, 4460, 0, 0.000656496]`, `[200, 4460, 4352, 0.0000833592]`, `[200, 4460, 4352, 0.0001126872]` | `verified`; spend 0.0008525424 |
| E2 | baidu/fp8 `[200, 4462, 0, 0.0013564422]`, `[200, 4462, 0, 0.0013900086]`, `[200, 4462, 0, 0.0014139846]` | `not-cached`; spend 0.0041604354 |
| E3 | baseten/fp8 `[200, 4462, 0, 0.0014154]`, `[200, 4462, 0, 0.0013542]`, `[200, 4462, 4352, 0.000079064]` | `verified` (call 3) |
| E4 | morph/fp8 `[200, 4459, 0, 0.00014049]`, `[200, 4459, 0, 0.00013923]`, `[200, 4459, 4352, 0.000064906]` | `verified`; spend 0.000344626 |
| E5 | ok 0, not ok, ok 0 | `inconclusive` |
| E6 | ok 0, ok with `cachedTokens: null`, ok 0 | `inconclusive` (C6) |
| E7 | ok 4352, ok 0, ok 0 | `inconclusive` (a hit on call 1 is not evidence) |
| E8 | ok 0, ok 4352 (two calls; the refresh aborted) | `verified` |
| E9 | `probeCallSpendUsd` of ok without cost, estimate 0.003; of not ok | 0.003; 0 |
| E10 | `extractProbeUsage({ usage: { prompt_tokens: 4460, prompt_tokens_details: { cached_tokens: 4352 }, cost: 0.0000833592 } })` | `{ promptTokens: 4460, cachedTokens: 4352, costUsd: 0.0000833592 }` |
| E11 | `extractProbeUsage({})`, `(null)`, `({ usage: { cost: 'x', prompt_tokens: -1 } })` | All-null each |

**Table B — bodies.**

| # | Case | Expect |
|---|---|---|
| B1 | `probeFiller()` | 220 lines; first `export function step0(value: number): number { return value * 3 + 0; }`; last `export function step219(value: number): number { return value * 222 + 4; }`; SHA-256 as above (the test may use `node:crypto`). |
| B2 | `probeRequestBody('deepseek/deepseek-v4.1-flash', 'atlas-cloud/fp8', 'N')` | `Object.keys` = `['model', 'provider', 'messages', 'reasoning', 'max_tokens']`; provider `{ order: ['atlas-cloud/fp8'], allow_fallbacks: false }`; system content starts `Session N atlas-cloud/fp8. Reference module follows.\n`; user content `Reply with the single word OK.`; no `data_collection` anywhere. |
| B3 | Same nonce, two tags | Different system content (C5). |

**Table K — `routingCredentialCore.test.ts`.** Base rows: provider `{ id: 'p', authMode: 'api_key', baseUrl: 'https://openrouter.ai/api/v1' }`, profile `{ id: 'c', providerId: 'p', label: 'OR key', unavailableSince: null }`, gateway `'https://openrouter.ai/api/v1'`.

| # | Case | Expect |
|---|---|---|
| K1 | Base rows | `{ ok: true }` |
| K2 | `baseUrl: 'https://openrouter.ai/api/v1/'` | ok |
| K3 | `profile: null` | `not-found` |
| K4 | `provider: null`; provider id `q` | `provider-missing` both |
| K5 | `authMode: 'management'` with the OpenRouter base URL; also with `unavailableSince` set | `management` both (class first) |
| K6 | `authMode: 'subscription'` | `not-api-key` |
| K7 | `baseUrl: null`; `'https://example.invalid/api/v1'`; `'https://OpenRouter.ai/api/v1'` | `not-openrouter` each |
| K8 | `unavailableSince: '2026-10-01T00:00:00Z'` | `unavailable`; message `Credential profile 'OR key' is unavailable. Re-enter the credential in Settings.` |
| K9 | `checkEnvelopeBaseUrl(undefined, …)`; `('https://openrouter.ai/api/v1/', …)`; `('https://proxy.invalid/v1', 'OR key', …)` | ok; ok; `envelope-mismatch` |
| K10 | The literal checked in rule 3 | Equals `MANAGEMENT_AUTH_MODE` from `shared/ipc.ts` (the test may import it). |
| K11 | Real row types | A `CredentialProfileRow` and `ProviderConfigRow` value (as in `modelCatalog.test.ts`) are accepted by the signature (compile-time). |

**Table T — `routingClient.test.ts`.** A stub `fetchImpl` records `(url, init)`; `stubResponse(status, text)` follows `modelCatalog.test.ts:76` and records whether the body was read or cancelled and how many chunks were pulled.

| # | Case | Expect |
|---|---|---|
| T1 | Endpoints 200 with the golden fixture text | One call; URL `https://openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash/endpoints`; method `GET`; headers exactly `{ accept, authorization }`; no body; 33 endpoints, `rejectedRows` 0. |
| T2 | Endpoints 200 with `data.id` `other/model` | `model-mismatch` |
| T3 | Endpoints 200, body 2,000,001 bytes | `unrecognized`; the reader was cancelled at the cap (not read to the end). |
| T4 | Endpoints 200 with `{` or with `{ "data": { "id": "deepseek/deepseek-v4.1-flash", "endpoints": [] } }` | `unrecognized` both |
| T5 | Endpoints 401, 403, 429, 500, 503, 418 — each body containing the fake key | `auth-failed`, `auth-failed`, `rate-limited`, `provider-error`, `provider-error`, `unexpected-status` (status 418); every body cancelled unread; `JSON.stringify(result)` never contains the key. |
| T6 | `fetchImpl` rejects with an `Error` whose message and `cause` contain the key | `unreachable`, status `null`; the result does not contain the key. |
| T7 | Empty key | `auth-failed`; `fetchImpl` never called. |
| T8 | Preflight `guardrails`, 404 with the fixture body | One POST to `https://openrouter.ai/api/v1/chat/completions`; headers exactly `{ accept, authorization, content-type }`; body equals the exact guardrails string; result `{ ok: true, removed: ['deepseek'], issue: null }`; body read. |
| T9 | Preflight `dataPolicy`, 404 with `withDeny` | Body equals the exact deny string; `removed: ['deepseek']`. |
| T10 | Preflight 404 with a 65,537-byte body | `{ ok: true, removed: null, issue: 'unrecognized-body' }`; reader cancelled at the cap. |
| T11 | Preflight 401 and 403 whose bodies contain the key | `auth-failed`; cancelled unread; key absent from the result. |
| T12 | Preflight 200 | `{ ok: true, removed: null, issue: 'unexpected-status' }`; cancelled unread. |
| T13 | Preflight 404 whose Guardrails clause lists `'sk-or-v1-' + 'a'.repeat(20)` (29 characters: it passes `ROUTING_TAG_PATTERN` and matches the `openrouter` pattern in `secret-patterns.json`, `sk-or-v1-[A-Za-z0-9_-]{20,}`), with a consistent funnel | `issue: 'bad-tag'`, `removed: null` (C3). |
| T14 | Probe 200 with a real-shaped usage body | Body equals `JSON.stringify(probeRequestBody(model, tag, nonce))`; `usage` extracted; the completion text never appears in the result. |
| T15 | Probe 200, body 262,145 bytes | `unrecognized`; reader cancelled. |
| T16 | Probe 404, 401, 429 | `unexpected-status` (404), `auth-failed`, `rate-limited`; cancelled unread. |
| T17 | Every call | The URL never contains the key; the key appears in exactly one header value, `Bearer <key>`; `init.signal` is an `AbortSignal`. |
| T18 | An external `signal` already aborted | `unreachable` (the stub rejects on an aborted signal). |
| T19 | `FetchLike`-typed stub (from `modelCatalog.ts`) passed as `fetchImpl` | Compiles (C8). |
| T20 | `modelCatalog.test.ts` | Still passes unchanged after the `readCapped` export. |

## Invariants

- The three cores are pure: no clock, randomness, environment, file system or network; `now`, nonces and row counts are parameters. The Phase 1 purity grep and the layering grep stay empty.
- The key exists only in the caller's scope and in one header value. It is never in a URL, a returned value, a thrown error or a log call. No function in this task logs.
- Every returned failure is a member of `ROUTING_FAILURES` with an optional numeric status; every preflight outcome is a tag list or a member of `PREFLIGHT_ISSUES`. No provider text crosses the function boundary, except tags that pass `ROUTING_TAG_PATTERN` and `scrubSecrets`.
- Non-2xx bodies are cancelled unread, except the preflight's 404 (read to at most 65,536 bytes). 2xx bodies are read only through `readCapped`.
- No retry, no backoff, no timer.

## Verification

```powershell
npm run typecheck
npx vitest run src/main/routing src/main/services/routingClient.test.ts src/main/services/modelCatalog.test.ts src/shared/routing.test.ts
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
Get-ChildItem -Path src/main/routing -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern "from '\.\./(services|db|adapters)/"
node scripts/verify-routing-ranker.mjs
npm run grep:secrets
git diff --check
git status --short
```

Both `Select-String` lines must print nothing; they also match comments, so state the purity rule in comments without those literal tokens. The runtime evidence for this task is the parser over the real 2026-10-02 bodies (P1–P6) and the planner over the real fixture (Q1–Q5); there is no network call. Record the vitest summary, the ranker script's `PASS (30 checks)`, `git diff --stat src/main/services/modelCatalog.ts` (1 line changed), and `git status --short` showing the new files and the untouched pre-existing entries.
