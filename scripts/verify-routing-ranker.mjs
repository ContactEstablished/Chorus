// Model Routing Phase 1, Task 1-3 (MR-G1): run the pure ranker on the real
// 2026-10-02 golden fixture for both profiles and check the result against
// expectations copied by hand from Phase-1-Overview.md and
// ImplementationSpec-1-3 (never computed by the code under test).
// No key, no network: the routing cores are bundled with esbuild into the
// git-ignored _verify/ and the bundle is deleted afterwards, also on failure.
// Usage (from the repository root): node scripts/verify-routing-ranker.mjs
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { isDeepStrictEqual } from 'node:util'
const require = createRequire(import.meta.url)

const FIXTURE = 'src/main/routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json'
const SLUG = 'deepseek/deepseek-v4.1-flash'
const NOW = '2026-10-02T09:20:00Z'
const CHECKED_AT = '2026-10-02T09:15:39Z'
const EFFORT = 'low'
const PROFILES = ['interactive', 'helper']
const TIERS = [['budget', 'Budget'], ['balanced', 'Balanced'], ['fast', 'Fast']]

// ── Golden expectations: a hand-written copy of the overview's table ──
const EXPECTED = {
  candidates: 32,
  eligible: 14,
  median: 90.5,
  floor: 45.25,
  snapshotAgeMinutes: 15,
  tiers: {
    interactive: {
      budget: ['deepinfra/fp8', 'streamlake/fp8', 'gmicloud/fp8'],
      balanced: ['deepinfra/fp8', 'streamlake/fp8', 'makora/fp8'],
      fast: ['venice/fp8', 'baidu/fp8', 'parasail/fp8']
    },
    helper: {
      budget: ['streamlake/fp8', 'deepinfra/fp8', 'gmicloud/fp8'],
      balanced: ['streamlake/fp8', 'venice/fp8', 'gmicloud/fp8'],
      fast: ['venice/fp8', 'baidu/fp8', 'parasail/fp8']
    }
  },
  nitroModel: 'deepseek/deepseek-v4.1-flash:nitro',
  nitroLikely: { tag: 'together', providerName: 'Together', tpsP50: 223 },
  nitroFailsRules: ['quantization not declared'],
  warnings: ['Limited history: 14 of 14 eligible endpoints have fewer than 3 speed observations.']
}

const checks = []
function check(what, ok, detail) {
  checks.push({ what, ok: Boolean(ok) })
  console.log(ok ? `ok ${what}` : `FAIL ${what}${detail ? `: ${detail}` : ''}`)
}
const show = (value) => JSON.stringify(value)
const expectEqual = (what, actual, expected) => check(what, isDeepStrictEqual(actual, expected), `expected ${show(expected)}, got ${show(actual)}`)
const near = (actual, expected) => typeof actual === 'number' && Math.abs(actual / expected - 1) < 1e-4
const expectNear = (what, actual, expected) => check(what, near(actual, expected), `expected ${expected}, got ${show(actual)}`)

/** Every key at any depth of a JSON value. */
const keysDeep = (value) =>
  Array.isArray(value)
    ? value.flatMap(keysDeep)
    : typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([k, v]) => [k, ...keysDeep(v)])
      : []

/** Budget, Balanced and Fast providers (when the tier exists) and Nitro's. */
const providersOf = (result) => [...TIERS.map(([tier]) => result.tiers[tier]?.provider ?? null), result.nitro.provider]

function printProfile(profile, result) {
  const byTag = new Map(result.candidates.map((c) => [c.tag, c]))
  const eligible = result.candidates.filter((c) => c.excludedBy.length === 0).length
  const flags = `${result.stale ? '  STALE' : ''}${result.accountEligibility === 'unknown' ? '  account unchecked' : ''}`
  console.log(
    `${profile.padEnd(13)}eligible ${eligible}/${result.candidates.length}  median ${result.medianEligibleTps ?? 'none'} tps  ` +
      `Budget floor ${result.budgetFloorTps ?? 'none'} tps  snapshot ${result.snapshotAgeMinutes} min${flags}`
  )
  for (const [tier, label] of TIERS) {
    const selection = result.tiers[tier]
    const line = selection
      ? selection.endpoints
          .map((tag) => {
            const score = byTag.get(tag)?.scores?.[tier]
            return `${tag} (${typeof score === 'number' ? score.toFixed(4) : '?'})`
          })
          .join(' > ')
      : '(no eligible endpoints)'
    console.log(`  ${label.padEnd(10)}${line}`)
  }
  const { model, likely, likelyFailsRules } = result.nitro
  const preview = likely ? `likely ${likely.tag} ${likely.tpsP50} tps; fails: ${likelyFailsRules.join(', ') || 'none'}` : 'likely none'
  console.log(`  ${'Nitro'.padEnd(10)}${model}, ${preview}`)
}

function checkProfile(profile, result) {
  const P = profile
  const want = EXPECTED.tiers[profile]
  const eligible = result.candidates.filter((c) => c.excludedBy.length === 0).length
  expectEqual(`${P}: eligible ${EXPECTED.eligible} of ${EXPECTED.candidates} candidates`, [eligible, result.candidates.length], [EXPECTED.eligible, EXPECTED.candidates])
  expectNear(`${P}: median eligible speed ${EXPECTED.median} tps`, result.medianEligibleTps, EXPECTED.median)
  expectNear(`${P}: Budget floor ${EXPECTED.floor} tps`, result.budgetFloorTps, EXPECTED.floor)
  expectEqual(
    `${P}: snapshot ${EXPECTED.snapshotAgeMinutes} min old, not stale, account checked`,
    [result.snapshotAgeMinutes, result.stale, result.accountEligibility],
    [EXPECTED.snapshotAgeMinutes, false, 'checked']
  )
  for (const [tier, label] of TIERS) {
    expectEqual(`${P}: ${label} order ${want[tier].join(' > ')}`, result.tiers[tier]?.endpoints ?? null, want[tier])
  }
  // Key order matters too (the payload is built in a fixed order), so compare the key list as well as the value.
  const wrongPayloads = TIERS.flatMap(([tier, label]) => {
    const provider = result.tiers[tier]?.provider ?? null
    const wanted = { order: want[tier], allow_fallbacks: false, require_parameters: true, quantizations: ['fp8'], data_collection: 'deny' }
    const ok = provider !== null && isDeepStrictEqual(Object.keys(provider), Object.keys(wanted)) && isDeepStrictEqual(provider, wanted)
    return ok ? [] : [`${label} expected ${show(wanted)}, got ${show(provider)}`]
  })
  check(
    `${P}: ranked providers pin the tags in order, fallbacks off, parameters required, fp8 only`,
    wrongPayloads.length === 0,
    wrongPayloads.join('; ')
  )
  expectEqual(`${P}: Nitro likely together at 223 tps`, result.nitro.likely, EXPECTED.nitroLikely)
  expectEqual(`${P}: Nitro likely fails ${show(EXPECTED.nitroFailsRules)}`, result.nitro.likelyFailsRules, EXPECTED.nitroFailsRules)
  expectEqual(`${P}: warnings`, result.warnings, EXPECTED.warnings)
  check(`${P}: JSON round trip leaves the result unchanged`, isDeepStrictEqual(JSON.parse(JSON.stringify(result)), result))
  const forbidden = providersOf(result)
    .flatMap(keysDeep)
    .filter((k) => k === 'sort' || k.startsWith('preferred_'))
  check(`${P}: no sort or preferred_* key in any provider`, forbidden.length === 0, `found ${show(forbidden)}`)
  const collection = providersOf(result).map((p) => p?.data_collection ?? null)
  expectEqual(`${P}: data_collection 'deny' on all four tiers`, collection, ['deny', 'deny', 'deny', 'deny'])
  expectEqual(`${P}: Nitro model ${EXPECTED.nitroModel}`, result.nitro.model, EXPECTED.nitroModel)
}

async function run() {
  fs.mkdirSync('_verify', { recursive: true })
  const bundle = path.resolve('_verify', `routing-ranker-${process.pid}.cjs`)
  try {
    await require('esbuild').build({
      stdin: {
        contents:
          "export { computeTiers } from './src/main/routing/routingCore'; export { parseEndpointsResponse, extractObservations } from './src/main/routing/endpointsCore'; export { bundledModelRegistry, findModel } from './src/main/routing/registryCore'; export { DEFAULT_ROUTING_SETTINGS } from './src/shared/routing';",
        resolveDir: process.cwd(),
        loader: 'ts'
      },
      outfile: bundle,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      packages: 'external'
    })
    const { computeTiers, parseEndpointsResponse, extractObservations, bundledModelRegistry, findModel, DEFAULT_ROUTING_SETTINGS } = require(bundle)

    // The golden input, exactly as ImplementationSpec-1-3 builds it.
    const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    const { endpoints } = parseEndpointsResponse(fixture)
    const snapshot = { fetchedAt: fixture.fetchedAt, endpoints }
    const model = findModel(bundledModelRegistry(), SLUG)
    if (!model) throw new Error(`The bundled registry has no ${SLUG}`)
    const input = (profile, settings = DEFAULT_ROUTING_SETTINGS) => ({
      model,
      snapshot,
      history: extractObservations(snapshot),
      account: { guardrailRemoved: fixture.guardrailRemoved, dataPolicyRemoved: fixture.dataPolicyDenyRemoved, checkedAt: CHECKED_AT },
      cache: Object.fromEntries(Object.entries(fixture.cacheVerified).map(([tag, verified]) => [tag, { verified, checkedAt: CHECKED_AT }])),
      profile,
      effort: EFFORT,
      settings,
      now: NOW
    })

    const results = PROFILES.map((profile) => [profile, computeTiers(input(profile))])
    console.log(`Model Routing ranker — fixture ${fixture.fetchedAt}, now ${NOW}, effort ${EFFORT}`)
    for (const [profile, result] of results) printProfile(profile, result)
    for (const [profile, result] of results) checkProfile(profile, result)

    const failed = checks.filter((c) => !c.ok).length
    if (failed === 0) console.log(`PASS (${checks.length} checks)`)
    else {
      console.log(`FAIL (${failed} of ${checks.length} checks)`)
      process.exitCode = 1
    }
  } catch (error) {
    console.error(error)
    console.log(`FAIL (the run threw after ${checks.length} checks: ${error instanceof Error ? error.message : String(error)})`)
    process.exitCode = 1
  } finally {
    // maxRetries: Windows antivirus can hold a freshly written file for a moment.
    fs.rmSync(bundle, { force: true, maxRetries: 3 })
  }
}

// Relative paths (the bundle entry, _verify/ and the fixture) assume the repository root.
if (!fs.existsSync('src/main/routing/routingCore.ts')) {
  console.log('FAIL (run from the repository root)')
  process.exitCode = 1
} else {
  await run()
}
