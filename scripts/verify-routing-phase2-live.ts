// Model Routing Phase 2 live check (Task 2-3), Electron main. SPENDS REAL OPENROUTER
// CREDIT (at most $0.03): one observer tick, one refresh whose probe is limited to 2
// endpoints and an estimate cap of $0.025, then an offline `tiers`. Checks L1-L10 of
// ImplementationSpec-2-3. The key is decrypted through the production vault from a
// copied credential, INSIDE RoutingService only; this script never sees it. Requests
// are recorded as { seq, method, path, order, dataCollection, maxTokens } only, never
// headers or message content. report.json never holds the key or the credential id.
// Run through scripts/verify-routing-phase2-live.mjs, not directly.
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { routingProgressEventSchema, routingRefreshResultSchema, type RoutingProgressEvent, type TierResult } from '../src/shared/routing'
import { scrubSecrets } from '../src/main/services/logger'
import type { FetchResponseLike } from '../src/main/services/modelCatalog'
import type { RoutingFetchLike } from '../src/main/services/routingClient'
import { RoutingObserver } from '../src/main/services/routingObserver'
import { RoutingService, type RoutingObserverTick } from '../src/main/services/routingService'
import { RoutingStore } from '../src/main/services/routingStore'
import { StorageService } from '../src/main/services/storage'
import { CredentialVault } from '../src/main/services/vault'
import { copyFixtureCredential } from './team-fixture-credential'

const evidence = process.env.CHORUS_ROUTING_EVIDENCE as string
const sourceDb = process.env.CHORUS_ROUTING_SOURCE_DB as string
app.setPath('userData', path.join(evidence, 'profile'))

const MODEL = 'deepseek/deepseek-v4.1-flash'
const ENDPOINTS_PATH = '/api/v1/models/deepseek/deepseek-v4.1-flash/endpoints'
const COMPLETIONS_PATH = '/api/v1/chat/completions'
const PREFLIGHT_TAG = 'chorus-preflight-none'
const PROBE_TAG_LIMIT = 2
const PROBE_CAP_USD = 0.025
const SPEND_LIMIT_USD = 0.03

interface RequestRecord {
  seq: number
  method: string
  path: string
  order: string[] | null
  dataCollection: string | null
  maxTokens: number | null
}
interface Check { name: string; ok: boolean; detail?: unknown }
/** Only these three fields are read from a request body; messages are never looked at. */
interface RecordedBody { provider?: { order?: unknown; data_collection?: unknown }; max_tokens?: unknown }

function orders(result: TierResult): Record<string, string[] | null> {
  return {
    budget: result.tiers.budget?.endpoints ?? null,
    balanced: result.tiers.balanced?.endpoints ?? null,
    fast: result.tiers.fast?.endpoints ?? null
  }
}

function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)]))
}

app.whenReady().then(async () => {
  const report: Record<string, unknown> = { startedAt: new Date().toISOString(), model: MODEL, passed: false }
  const checks: Check[] = []
  const check = (name: string, ok: boolean, detail?: unknown): void => {
    checks.push(detail === undefined ? { name, ok } : { name, ok, detail })
  }
  // Set once the credential is copied; every occurrence is masked out of the report text.
  let credentialProfileId: string | null = null
  const reportText = (): string => {
    const text = JSON.stringify({ ...report, checks }, null, 2)
    return credentialProfileId === null ? text : text.split(credentialProfileId).join('<credential>')
  }
  try {
    // 1. Throwaway database with only the copied OpenRouter API credential; the production vault.
    const storage = new StorageService(path.join(evidence, 'routing-live.db'))
    credentialProfileId = copyFixtureCredential(sourceDb, storage)
    const vault = new CredentialVault(storage)

    // 2. A counting vault, and a recording fetch sharing one sequence counter with the progress listener.
    let decrypts = 0
    const counting = {
      decryptForLaunch: (id: string) => {
        decrypts += 1
        return vault.decryptForLaunch(id)
      }
    }
    let seq = 0
    const requests: RequestRecord[] = []
    report.requests = requests // by reference, so a run that throws still reports what it sent
    const recording: RoutingFetchLike = (url, init) => {
      const body = init.body === undefined ? null : (JSON.parse(init.body) as RecordedBody)
      const order = body?.provider?.order
      const dataCollection = body?.provider?.data_collection
      requests.push({
        seq: ++seq,
        method: init.method,
        path: new URL(url).pathname,
        order: Array.isArray(order) ? order.map(String) : null,
        dataCollection: typeof dataCollection === 'string' ? dataCollection : null,
        maxTokens: typeof body?.max_tokens === 'number' ? body.max_tokens : null
      })
      // init unchanged: method, headers, body, signal and redirect: 'error' all reach the real fetch.
      return fetch(url, init) as unknown as Promise<FetchResponseLike>
    }

    // 3. The service under test, with the C21 verification knobs.
    const service = new RoutingService({
      storage,
      vault: counting,
      store: new RoutingStore(path.join(evidence, 'routing')),
      fetchImpl: recording,
      probeTagLimit: PROBE_TAG_LIMIT,
      probeCapUsd: PROBE_CAP_USD
    })
    const events: { seq: number; event: RoutingProgressEvent }[] = []
    report.events = events
    service.onProgress((event) => {
      events.push({ seq: ++seq, event })
      if (event.stage === 'probe-plan') {
        console.log(`probe estimate: $${event.estimateUsd.toFixed(4)} for ${event.planned.length} tag(s), cap $${PROBE_CAP_USD}`)
      }
      if (event.stage === 'done') console.log(`actual spend: $${event.spentUsd.toFixed(6)}`)
    })

    // 4. Designate the copied credential (this throwaway database only).
    service.setObservation({ enabled: true, credentialProfileId })

    // 5. Tick FIRST: the store is empty, so the model is due (after the refresh it would be fresh).
    const tick: RoutingObserverTick = await new RoutingObserver({ service }).tick()
    const afterTick = { requests: requests.length, decrypts }
    console.log(`observer tick: ${tick.outcome}`)
    report.tick = tick

    // 6. Refresh.
    const res = await service.refresh({ model: MODEL, credentialProfileId, profile: 'interactive', effort: 'low' })
    const afterRefresh = { requests: requests.length, decrypts }

    // 7. Offline tiers: no request.
    const again = service.tiers({ model: MODEL, profile: 'interactive', effort: 'low', credentialProfileId })
    const afterTiers = requests.length

    report.estimateUsd = res.estimateUsd
    report.spentUsd = res.spentUsd
    report.probed = res.probed
    report.notProbed = res.notProbed
    report.result = {
      accountEligibility: res.result.accountEligibility,
      snapshotFetchedAt: res.result.snapshotFetchedAt,
      tiers: orders(res.result),
      nitroLikely: res.result.nitro.likely,
      warnings: res.result.warnings
    }

    // 8. Checks.
    // L1
    const first = requests[0]
    check(
      'L1 tick observed with exactly one GET of the endpoints and one decrypt',
      tick.outcome === 'observed' && afterTick.requests === 1 && first?.method === 'GET' && first.path === ENDPOINTS_PATH && afterTick.decrypts === 1,
      { outcome: tick.outcome, requests: afterTick.requests, decrypts: afterTick.decrypts }
    )
    // L2
    check('L2 two decrypts in total (one per tick, one per refresh)', afterRefresh.decrypts === 2, { decrypts: afterRefresh.decrypts })
    // L3
    const refreshRequests = requests.slice(afterTick.requests, afterRefresh.requests)
    const [get, guardrails, dataPolicy, ...probes] = refreshRequests
    const preflightOk = (r: RequestRecord | undefined, dataCollection: string | null): boolean =>
      r !== undefined &&
      r.method === 'POST' &&
      r.path === COMPLETIONS_PATH &&
      isDeepStrictEqual(r.order, [PREFLIGHT_TAG]) &&
      r.maxTokens === 1 &&
      r.dataCollection === dataCollection
    const probeTags = new Set(probes.map((p) => (p.order ?? [])[0]))
    check(
      'L3 refresh requests: GET, guardrails preflight, deny preflight, then <= 6 probe POSTs over <= 2 tags',
      get?.method === 'GET' &&
        get.path === ENDPOINTS_PATH &&
        preflightOk(guardrails, null) &&
        preflightOk(dataPolicy, 'deny') &&
        probes.length <= 6 &&
        probes.every((p) => p.method === 'POST' && p.path === COMPLETIONS_PATH && p.maxTokens === 64 && p.order?.length === 1 && p.dataCollection === null) &&
        probeTags.size <= PROBE_TAG_LIMIT,
      { requests: refreshRequests.length, probeRequests: probes.length, probeTags: [...probeTags] }
    )
    // L4
    const stages = events.map((e) => e.event.stage)
    const k = stages.filter((s) => s === 'probe').length
    const expectedStages = ['endpoints', 'preflight', 'probe-plan', ...Array.from({ length: k }, () => 'probe'), 'done']
    check(
      'L4 events endpoints, preflight, probe-plan, probe x k (k <= 2), done; every event passes the schema',
      k <= PROBE_TAG_LIMIT && isDeepStrictEqual(stages, expectedStages) && events.every((e) => routingProgressEventSchema.safeParse(e.event).success),
      { stages }
    )
    // L5
    const plan = events.find((e) => e.event.stage === 'probe-plan')
    const planEvent = plan?.event.stage === 'probe-plan' ? plan.event : null
    const firstProbe = probes[0]
    // MR-G7 must be OBSERVED, not vacuous: at least one probe request has to exist to come after the estimate.
    check(
      'L5 at least one probe request was sent, the probe-plan event precedes the first, and its estimate is <= $0.025',
      plan !== undefined && planEvent !== null && planEvent.estimateUsd <= PROBE_CAP_USD && firstProbe !== undefined && plan.seq < firstProbe.seq,
      { planSeq: plan?.seq ?? null, firstProbeSeq: firstProbe?.seq ?? null, probeRequests: probes.length, estimateUsd: planEvent?.estimateUsd ?? null }
    )
    // L6: the spend assertion.
    const done = events.find((e) => e.event.stage === 'done')?.event
    const doneSpent = done?.stage === 'done' ? done.spentUsd : null
    check('L6 actual spend <= $0.03 and equal to the done event', res.spentUsd <= SPEND_LIMIT_USD && doneSpent === res.spentUsd, {
      spentUsd: res.spentUsd,
      doneSpentUsd: doneSpent
    })
    // L7: today's live preflight message still parses (values printed, not asserted).
    const preflight = events.find((e) => e.event.stage === 'preflight')?.event
    const guardrailRemoved = preflight?.stage === 'preflight' ? preflight.guardrails.removed : null
    const dataPolicyRemoved = preflight?.stage === 'preflight' ? preflight.dataPolicy.removed : null
    console.log(`guardrails removed: ${JSON.stringify(guardrailRemoved)}; data policy removed: ${JSON.stringify(dataPolicyRemoved)}`)
    report.preflight = preflight?.stage === 'preflight' ? { guardrails: preflight.guardrails, dataPolicy: preflight.dataPolicy } : null
    check('L7 both preflight lists parsed (removed !== null)', guardrailRemoved !== null && dataPolicyRemoved !== null, {
      guardrailRemoved,
      dataPolicyRemoved
    })
    // L8
    check(
      'L8 result passes the schema, eligibility checked, plain JSON, at least one ranked tier',
      routingRefreshResultSchema.safeParse(res).success &&
        res.result.accountEligibility === 'checked' &&
        isDeepStrictEqual(JSON.parse(JSON.stringify(res)), res) &&
        Object.values(res.result.tiers).some((t) => t !== null),
      { accountEligibility: res.result.accountEligibility }
    )
    // L9
    check('L9 offline tiers: the same tier orders and no request', isDeepStrictEqual(orders(again), orders(res.result)) && afterTiers === afterRefresh.requests, {
      requestsBefore: afterRefresh.requests,
      requestsAfter: afterTiers
    })
    // L10: every stored routing file, and the report text itself, survive the scrubber unchanged.
    const files = filesUnder(path.join(evidence, 'routing'))
    const dirty = files.filter((f) => {
      const text = fs.readFileSync(f, 'utf8')
      return scrubSecrets(text) !== text
    })
    const text = reportText()
    check('L10 routing files and the report pass scrubSecrets unchanged', files.length > 0 && dirty.length === 0 && scrubSecrets(text) === text, {
      files: files.map((f) => path.relative(evidence, f)),
      dirty: dirty.map((f) => path.relative(evidence, f))
    })

    report.finishedAt = new Date().toISOString()
    report.passed = checks.length === 10 && checks.every((c) => c.ok)
    service.dispose()
  } catch (error) {
    report.passed = false
    report.error = scrubSecrets(error instanceof Error ? `${error.name}: ${error.message}` : String(error))
  } finally {
    try {
      fs.writeFileSync(path.join(evidence, 'report.json'), reportText())
    } catch (error) {
      console.error(`could not write report.json: ${error instanceof Error ? error.message : String(error)}`)
    }
    app.exit(0)
  }
})
