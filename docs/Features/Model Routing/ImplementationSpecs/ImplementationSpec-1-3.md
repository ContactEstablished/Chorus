# Implementation specification 1-3 — Payloads, `computeTiers` and the golden run

Paired [task](../Tasks/Task-1-3.md). Decisions: [roadmap](../roadmap.md) MR-D4, MR-D5, MR-D10, MR-D11, MR-D12; [overview](../Tasks/Phase-1-Overview.md) K2, K3, K7, K12, C8, C9. Contracts from [ImplementationSpec-1-1](ImplementationSpec-1-1.md); ranking from [ImplementationSpec-1-2](ImplementationSpec-1-2.md). **Not started.**

## Files and insertion points

| File | Action |
|---|---|
| `src/main/routing/payloadCore.ts`, `payloadCore.test.ts` | New. Imports shared contracts only. |
| `src/main/routing/routingCore.ts`, `routingCore.test.ts` | New. Imports shared contracts, `rankerCore`, `payloadCore`. The only module Phase 2 needs to call. |
| `scripts/verify-routing-ranker.mjs` | New. Node ESM script; bundles with esbuild into `_verify/`, deletes the bundle afterwards. |

## `payloadCore.ts`

```ts
export function quantizationsFor(selected: CandidateExplanation[]): Quantization[]
export function buildRankedProvider(selected: CandidateExplanation[], settings: RoutingSettings): OpenRouterProviderPrefs
export function buildNitroSelection(
  slug: string, likely: NitroSelection['likely'], likelyFailsRules: string[], settings: RoutingSettings
): NitroSelection
```

**`quantizationsFor` (K12, C8).** The distinct union of every selected candidate's `rowQuantizations`, in `QUANTIZATIONS` order. These are the declared values OpenRouter filters on, so an admitted first-party `unknown` contributes `'unknown'` (sending its effective `fp8` would make OpenRouter drop it). `'unknown'` can only appear through an admitted candidate, because Task 1-2 excludes every other undeclared one.

**`buildRankedProvider` (MR-D5, MR-D11).** Returns an object built with keys in exactly this insertion order:

```ts
{
  order: selected.map((c) => c.tag), // tags only, never display names
  allow_fallbacks: false,
  require_parameters: true,
  quantizations: quantizationsFor(selected),
  data_collection: 'deny' // present only when settings.dataCollection === 'deny'; otherwise the key is absent
}
```

It never emits `sort`, `ignore`, `only`, `max_price` or any `preferred_*` key.

**`buildNitroSelection` (MR-D4, MR-D11).** `model: slug + ':nitro'`; `provider: settings.dataCollection === 'deny' ? { data_collection: 'deny' } : null`; `likely` and `likelyFailsRules` as passed (Task 1-2's `nitroLikely` / `nitroFailsRules`).

## `routingCore.ts`

```ts
export function computeTiers(input: RankInput): TierResult
```

1. **Times (C9).** `nowMs = Date.parse(input.now)`, `fetchedMs = Date.parse(input.snapshot.fetchedAt)`. Either `NaN` → throw `RangeError('Invalid time in RankInput')`. `fetchedMs > nowMs` → throw `RangeError('snapshot.fetchedAt is after now')`.
2. `ranked = rankCandidates(input)`.
3. **Age (K7).** `ageMs = nowMs − fetchedMs`; `snapshotAgeMinutes = Math.floor(ageMs / 60_000)`; `stale = ageMs > settings.snapshotMaxAgeMinutes × 60_000`.
4. **Account (K3).** `accountEligibility = input.account.guardrailRemoved === null ? 'unknown' : 'checked'`.
5. **Tiers.** For each tier in `RANKED_TIERS`: no selected tags → `null`. Otherwise, with `selected` = the candidates for those tags in selection order:

   ```ts
   {
     tier,
     model: input.model.slug,
     provider: buildRankedProvider(selected, settings),
     endpoints: tags,
     limitedHistory: selected.some((c) => c.limitedHistory),
     limitedFallbacks: tags.length < 1 + settings.fallbackCount,
     rationale
   }
   ```

6. **Nitro.** `buildNitroSelection(input.model.slug, ranked.nitroLikely, ranked.nitroFailsRules, settings)`.
7. **Result.** Keys in `TierResult` contract order: `model` (slug), `profile`, `computedAt` (= `input.now`, unchanged), `snapshotFetchedAt`, `snapshotAgeMinutes`, `stale`, `accountEligibility`, `medianEligibleTps`, `budgetFloorTps`, `tiers` (`budget`, `balanced`, `fast`), `nitro`, `candidates`, `warnings`.

**Rationale (exact).** With `p` the primary candidate and `rest` the other selected tags:

```ts
`${p.tag} first: ${p.effectiveTps.toFixed(1)} effective tok/s, $${p.cost.blended.toPrecision(3)}/M blended` +
  (rest.length ? `; then ${rest.join(', ')}` : '; no fallbacks') +
  (limitedHistory ? ' (limited history)' : '')
```

**Warnings (exact, in this order; each only when its condition holds).** `Label` is `Budget`, `Balanced` or `Fast`; `S` is `settings`.

| # | Condition | Text |
|---|---|---|
| W1 | `stale` | `Snapshot is ${snapshotAgeMinutes} minutes old (limit ${S.snapshotMaxAgeMinutes}); refresh before launching.` |
| W2 | `accountEligibility === 'unknown'` | `Account guardrails were not checked; a pinned endpoint may be refused.` |
| W3 | `S.dataCollection === 'deny' && account.dataPolicyRemoved === null` | `Data-policy removals were not checked.` |
| W4 | Per tier, in `RANKED_TIERS` order: no selection | `${Label}: no eligible endpoints.` |
| W5 | Per tier: `1 ≤ n < 1 + S.fallbackCount` selected | `${Label}: only ${n} eligible endpoint${n === 1 ? '' : 's'}; limited fallbacks.` |
| W6 | `k` eligible candidates with `limitedHistory`, `k > 0`, of `m` eligible | `Limited history: ${k} of ${m} eligible endpoints have fewer than ${S.stableMinObservations} speed observations.` |
| W7 | `nitro.likely === null` | `Nitro: no endpoint in the snapshot passes the capability filters.` |

W4 and W5 are evaluated tier by tier in `RANKED_TIERS` order; at most one of them fires per tier.

## Invariants

- `computeTiers` is pure: same input, same output; `now` is its only time source (MR-G8).
- The result is plain JSON: only strings, finite numbers, booleans, `null`, arrays and plain objects; no key holds `undefined` (K2, MR-G5).
- Budget/Balanced/Fast payloads use tags in `order` and never a live sort or preference (MR-D5); every tier, Nitro included, sends `data_collection: 'deny'` unless settings say `'allow'` (MR-D11).
- Nitro is never ranked; its `likely` is a preview and is labelled by `likelyFailsRules`.

## Golden input

Built the same way in `routingCore.test.ts` and in the script:

```ts
const fixture = JSON.parse(readFileSync(join(__dirname, '__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json'), 'utf8'))
const { endpoints } = parseEndpointsResponse(fixture)
const snapshot = { fetchedAt: fixture.fetchedAt, endpoints } // 2026-10-02T09:05:00Z
const checkedAt = '2026-10-02T09:15:39Z'
const input = (profile: RoutingProfileId, settings = DEFAULT_ROUTING_SETTINGS): RankInput => ({
  model: findModel(bundledModelRegistry(), 'deepseek/deepseek-v4.1-flash')!,
  snapshot,
  history: extractObservations(snapshot),
  account: { guardrailRemoved: fixture.guardrailRemoved, dataPolicyRemoved: fixture.dataPolicyDenyRemoved, checkedAt },
  cache: Object.fromEntries(Object.entries(fixture.cacheVerified).map(([tag, verified]) => [tag, { verified, checkedAt }])),
  profile,
  effort: 'low',
  settings,
  now: '2026-10-02T09:20:00Z'
})
```

## Golden expectations

Computed independently by the coordinator at kickoff and again while drafting; both agree. Tier orders are asserted exactly; numbers to `Math.abs(actual / expected − 1) < 1e-4`. A mismatch means re-checking the implementation against the K-rules first and reporting; never editing these values to match.

| Field | Interactive | Helper |
|---|---|---|
| `candidates.length` / eligible / excluded | 32 / 14 / 18 | 32 / 14 / 18 |
| `medianEligibleTps` / `budgetFloorTps` | 90.5 / 45.25 | 90.5 / 45.25 |
| `snapshotAgeMinutes` / `stale` / `accountEligibility` | 15 / false / `checked` | same |
| `tiers.budget.endpoints` | deepinfra/fp8, streamlake/fp8, gmicloud/fp8 | streamlake/fp8, deepinfra/fp8, gmicloud/fp8 |
| `tiers.balanced.endpoints` | deepinfra/fp8, streamlake/fp8, makora/fp8 | streamlake/fp8, venice/fp8, gmicloud/fp8 |
| `tiers.fast.endpoints` | venice/fp8, baidu/fp8, parasail/fp8 | venice/fp8, baidu/fp8, parasail/fp8 |
| Every tier | `limitedHistory` true, `limitedFallbacks` false | same |
| `nitro` | `{ model: 'deepseek/deepseek-v4.1-flash:nitro', provider: { data_collection: 'deny' }, likely: { tag: 'together', providerName: 'Together', tpsP50: 223 }, likelyFailsRules: ['quantization not declared'] }` | same |
| `warnings` | `['Limited history: 14 of 14 eligible endpoints have fewer than 3 speed observations.']` | same |

Interactive Budget, in full:

```ts
{
  tier: 'budget',
  model: 'deepseek/deepseek-v4.1-flash',
  provider: {
    order: ['deepinfra/fp8', 'streamlake/fp8', 'gmicloud/fp8'],
    allow_fallbacks: false,
    require_parameters: true,
    quantizations: ['fp8'],
    data_collection: 'deny'
  },
  endpoints: ['deepinfra/fp8', 'streamlake/fp8', 'gmicloud/fp8'],
  limitedHistory: true,
  limitedFallbacks: false,
  rationale: 'deepinfra/fp8 first: 48.5 effective tok/s, $0.0165/M blended; then streamlake/fp8, gmicloud/fp8 (limited history)'
}
```

Interactive Fast rationale: `venice/fp8 first: 119.9 effective tok/s, $0.0449/M blended; then baidu/fp8, parasail/fp8 (limited history)`.

Spot values (interactive): scores budget deepinfra 4.03670, streamlake 4.03282; balanced streamlake 3.99985, deepinfra 3.99215; fast venice 4.78673. `effectiveTps` venice 119.909, deepinfra 48.4621, baidu 89.7453. `cost.blended` deepinfra 0.0165144, streamlake 0.0168692, gmicloud 0.0215352, baidu 0.309590 (`cacheCredit` false), venice 0.0448650. Helper: budget streamlake 4.36728, deepinfra 4.31882; balanced venice 4.23081, gmicloud 4.22583. The per-tag exclusion table is ImplementationSpec-1-2 Table F; `routingCore.test.ts` asserts it again through `computeTiers`.

## Test cases

**Table Y — `payloadCore.test.ts`.**

| # | Case | Expect |
|---|---|---|
| Y1 | `quantizationsFor` over rows `fp8`, `fp8`, `fp32` | `['fp8', 'fp32']` |
| Y2 | Adds an admitted first-party `unknown` | `['fp8', 'fp32', 'unknown']` |
| Y3 | A mixed tag with rows `fp8` + `fp16` | `['fp8', 'fp16']` |
| Y4 | `buildRankedProvider`, `deny` | `Object.keys` equals `['order', 'allow_fallbacks', 'require_parameters', 'quantizations', 'data_collection']`. |
| Y5 | Same, `allow` | `'data_collection' in provider` is false. |
| Y6 | `buildNitroSelection`, `deny` / `allow` | Provider `{ data_collection: 'deny' }` / `null`; model ends with `:nitro`. |

**Table Z — `routingCore.test.ts`.**

| # | Case | Expect |
|---|---|---|
| Z1 | Golden, both profiles | The golden table, the interactive Budget object above, both rationale strings, spot values, the Table F exclusions. |
| Z2 | JSON round-trip of Z1 results and of the Z5/Z6/Z7 results | `toStrictEqual`. |
| Z3 | Recursive key walk over every `tiers.*.provider` and `nitro.provider` | No key is `sort` or starts with `preferred_`. |
| Z4 | Golden with `dataCollection: 'allow'` | Same tier orders; no `data_collection` key anywhere; `nitro.provider` `null`; no W3. |
| Z5 | `now` = fetchedAt + 61 min; + 60 min | `stale` true, `snapshotAgeMinutes` 61, W1 first; `stale` false. |
| Z6 | `guardrailRemoved: null`, `dataPolicyRemoved: null` | `'unknown'`, W2 and W3; `deepseek` still excluded (by uptime) without the guardrail reason; tiers still computed. |
| Z7 | `minUptimePct` 100 (and `readmitUptimePct` 100) | All three tiers `null`; W4 for each; Nitro likely still `together`. |
| Z8 | Snapshot reduced to two eligible tags | `limitedFallbacks` true, W5 `only 2 eligible endpoints`. |
| Z9 | `fetchedAt` one minute after `now`; `now: 'not a date'` | Both throw `RangeError`. |
| Z10 | Endpoints reversed, history shuffled | Strictly equal to Z1. |
| Z11 | Synthetic snapshot whose top Budget candidate is first-party `unknown` | That tier's `quantizations` include `'unknown'`. |

## `scripts/verify-routing-ranker.mjs`

```js
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
fs.mkdirSync('_verify', { recursive: true })
const bundle = path.resolve('_verify', `routing-ranker-${process.pid}.cjs`)
await require('esbuild').build({
  stdin: {
    contents: "export { computeTiers } from './src/main/routing/routingCore'; export { parseEndpointsResponse, extractObservations } from './src/main/routing/endpointsCore'; export { bundledModelRegistry, findModel } from './src/main/routing/registryCore'; export { DEFAULT_ROUTING_SETTINGS } from './src/shared/routing';",
    resolveDir: process.cwd(), loader: 'ts'
  },
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external'
})
try {
  // build the golden input (as above) from src/main/routing/__fixtures__/…, run both profiles,
  // print the table, run the checks, set process.exitCode = 1 on any failure
} finally {
  fs.rmSync(bundle, { force: true })
}
```

It runs from the repository root, needs no key and makes no network call. It holds its own copy of the golden expectations (tier orders, eligible count, median, floor, Nitro likely and failed rules), written from the overview, not computed by the code under test. Checks, each printed as `ok` or `FAIL <what>`: the expectations; JSON round-trip via `isDeepStrictEqual` from `node:util`; no `sort` / `preferred_*` keys; `data_collection: 'deny'` on all four tiers; Nitro model `deepseek/deepseek-v4.1-flash:nitro`. Output shape:

```text
Model Routing ranker — fixture 2026-10-02T09:05:00Z, now 2026-10-02T09:20:00Z, effort low
interactive  eligible 14/32  median 90.5 tps  Budget floor 45.25 tps  snapshot 15 min
  Budget    deepinfra/fp8 (4.0367) > streamlake/fp8 (4.0328) > gmicloud/fp8 (3.8869)
  Balanced  deepinfra/fp8 (3.9922) > streamlake/fp8 (3.9998) > makora/fp8 (3.9662)
  Fast      venice/fp8 (4.7867) > baidu/fp8 (4.4970) > parasail/fp8 (4.4493)
  Nitro     deepseek/deepseek-v4.1-flash:nitro, likely together 223 tps; fails: quantization not declared
helper       …
PASS (n checks)
```

The last line is `PASS (n checks)` with exit code 0, or `FAIL (k of n checks)` with exit code 1.

## Verification

```powershell
npm run typecheck
npx vitest run src/main/routing src/shared/routing.test.ts
npm test
node scripts/verify-routing-ranker.mjs
Get-ChildItem -Path src/main/routing, src/shared/routing.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
npm run grep:secrets
git diff --check
git status --short
```

The runtime check is the script (MR-G1): paste its full output and exit code into the report, and confirm `_verify/` holds no `routing-ranker-*.cjs` afterwards. `npm run grep:secrets` scans `_verify/` too, so run it after the script has cleaned up.
