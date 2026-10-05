// Model Routing Task 4b-2 (ImplementationSpec-4b-2, overview C18): the main-process Team routing harness.
// Driven by scripts/verify-routing-team.mjs, which bundles this file into _verify/ and runs it in a WINDOWLESS
// Electron host (better-sqlite3 is built for Electron). REAL: StorageService/TeamStorage on a throwaway database,
// RoutingService over a throwaway routing store seeded with the golden fixture under a PINNED clock, the routing
// port, TeamService, opencodeHelper.buildExecution and the helper parser. FAKES: the process executor (it never
// spawns), the workspace, the lead, validateMember and the decrypt. Zero cost: no helper, lead or OpenCode
// process, no request (the only child processes are the real builder's `where.exe` PATH lookups), no paid call.
// Writes report.json into its evidence directory and exits; the launcher prints the checks and deletes everything.
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import Database from 'better-sqlite3'
import { StorageService } from '../src/main/services/storage'
import { TeamService } from '../src/main/services/teamService'
import type { HelperProcessOptions, HelperProcessOutcome } from '../src/main/services/helperProcess'
import { reserveNextAttempt, TeamDomainError, type TeamLease } from '../src/main/services/teamCore'
import { RoutingService, type RoutingServiceDeps } from '../src/main/services/routingService'
import { RoutingStore } from '../src/main/services/routingStore'
import { createTeamRoutingPort, type TeamRoutingServiceLike } from '../src/main/services/teamRouting'
import { extractObservations, parseEndpointsResponse } from '../src/main/routing/endpointsCore'
import { resolveCli } from '../src/main/services/cliDetect'
import { DEFAULT_ROUTING_SETTINGS, type RoutingLaunchSelection } from '../src/shared/routing'
import type { TeamAttempt, TeamEvent, TeamMember, TeamRunConfig } from '../src/shared/team'
import type { HelperLaunchRequest } from '../src/main/adapters/helpers/types'

const evidence = process.env.CHORUS_ROUTING_TEAM_EVIDENCE!
app.setPath('userData', path.join(evidence, 'electron-profile'))
const ROOT = path.resolve(__dirname, '..') // the bundle runs from _verify/

// ── Constants and hand-written expectations (ImplementationSpec-4b-2; never computed by the code under test) ──
const SLUG = 'deepseek/deepseek-v4.1-flash'
const NITRO = SLUG + ':nitro'
const GATEWAY = 'https://openrouter.ai/api/v1'
const PROVIDER_ID = '3b9d7c1e-2f4a-4c6b-8d0e-1a2b3c4d5e6f'
const C = '5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab'
const AT = '2026-10-02T09:20:00Z' // the pinned routing clock: 15 min after the fixture's fetchedAt
const LATER = '2026-10-02T10:21:00Z' // 61 min after AT: the fixture's numbers are 76 min old
const RESEED_AT = '2026-10-02T10:20:00Z'
const CHECKED_AT = '2026-10-02T09:15:39Z'
const SHA = 'a'.repeat(40)
/** Built at run time so no source file holds a complete key shape (npm run grep:secrets). */
const FAKE_KEY = 'sk-or-v1-' + 'f'.repeat(64)
const ROUTING_IMMUTABLE = "An attempt's recorded routing cannot change."
const PROVIDER = (order: string[]) => ({ order, allow_fallbacks: false, require_parameters: true, quantizations: ['fp8'], data_collection: 'deny' })
const GOLDEN_ORDER = ['streamlake/fp8', 'venice/fp8', 'gmicloud/fp8'] // Phase 1's golden helper Balanced
const RESEED_ORDER = ['venice/fp8', 'gmicloud/fp8', 'deepinfra/fp8'] // the same ranking without streamlake/fp8
const EXPECTED = {
  balanced: { tier: 'balanced', model: SLUG, sentModelId: SLUG, provider: PROVIDER(GOLDEN_ORDER), endpoints: GOLDEN_ORDER, computedAt: AT, snapshotFetchedAt: '2026-10-02T09:05:00Z' },
  nitro: { tier: 'nitro', model: SLUG, sentModelId: NITRO, provider: { data_collection: 'deny' }, endpoints: [], computedAt: AT, snapshotFetchedAt: null },
  nitroLater: { tier: 'nitro', model: SLUG, sentModelId: NITRO, provider: { data_collection: 'deny' }, endpoints: [], computedAt: LATER, snapshotFetchedAt: null },
  reseeded: { tier: 'balanced', model: SLUG, sentModelId: SLUG, provider: PROVIDER(RESEED_ORDER), endpoints: RESEED_ORDER, computedAt: LATER, snapshotFetchedAt: RESEED_AT },
  argsBase: ['run', '--pure', '--format', 'json', '--model', 'openrouter/deepseek/deepseek-v4.1-flash', '--agent', 'build', '--variant', 'low'],
  argsNitro: ['run', '--pure', '--format', 'json', '--model', 'openrouter/deepseek/deepseek-v4.1-flash:nitro', '--agent', 'build', '--variant', 'low'],
  modelsBalanced: '{"deepseek/deepseek-v4.1-flash":{"options":{"provider":{"order":["streamlake/fp8","venice/fp8","gmicloud/fp8"],"allow_fallbacks":false,"require_parameters":true,"quantizations":["fp8"],"data_collection":"deny"}}}}',
  modelsReseeded: '{"deepseek/deepseek-v4.1-flash":{"options":{"provider":{"order":["venice/fp8","gmicloud/fp8","deepinfra/fp8"],"allow_fallbacks":false,"require_parameters":true,"quantizations":["fp8"],"data_collection":"deny"}}}}',
  modelsNitro: '{"deepseek/deepseek-v4.1-flash:nitro":{"options":{"provider":{"data_collection":"deny"}},"variants":{"low":{"reasoning":{"effort":"low"}}}}}',
  modelsUnrouted: '{"deepseek/deepseek-v4.1-flash:nitro":{"variants":{"low":{"reasoning":{"effort":"low"}}}}}',
  notOpencode: 'A routing tier applies only to an OpenCode helper on an OpenRouter API key.',
  glmRefusal: 'Helper "GLM-5.3 helper": Model routing does not know this helper\'s model.',
  staleBlocker: 'Balanced routing refused this helper attempt: the endpoint numbers for deepseek/deepseek-v4.1-flash are more than 60 minutes old. Refresh them in Settings → Model routing, or turn on background observation there to keep them fresh, then revise the task. This attempt was consumed.',
  unavailableBlocker: 'Model routing is not available right now. Launch this helper with OpenRouter default instead. This attempt was consumed.',
  providerError: 'opencode reported an unsuccessful run.',
  truncated: 'opencode ended with finish reason length. Generation was truncated; reduce the assignment or use a verified model budget before a counted retry.',
  noteReseeded: "This attempt used the Balanced tier, pinned to venice/fp8, gmicloud/fp8 and deepinfra/fp8 with no fallback. If those providers were unavailable, refresh the numbers in Settings → Model routing and revise the task: each attempt resolves its tier again. A helper on another tier can also take the revision. Chorus never changes a helper's tier on its own.",
  noteNitro: "This attempt used the Nitro tier, which leaves the provider to OpenRouter. Chorus never changes a helper's tier on its own."
}

// ── Small helpers ──
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }
async function until(label: string, condition: () => boolean, ms = 10000): Promise<void> {
  const deadline = Date.now() + ms
  while (!condition()) { if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`); await delay(10) }
}
const checks: { name: string; ok: boolean; detail: unknown }[] = []
const record = (name: string, ok: boolean, detail: unknown) => checks.push({ name, ok: Boolean(ok), detail })
const errorOf = async (work: () => Promise<unknown> | unknown): Promise<{ name: string; code: string | null; message: string; issues: unknown } | null> => {
  try { await work(); return null } catch (err) {
    const e = err as { name?: string; code?: string; message?: string; issues?: { code: string; path: unknown[]; message: string; keys?: string[] }[] }
    return { name: e.name ?? 'Error', code: e instanceof TeamDomainError ? e.code : null, message: String(e.message), issues: e.issues?.map((i) => ({ code: i.code, path: i.path, message: i.message, keys: i.keys })) ?? null }
  }
}

app.whenReady().then(async () => {
  // ── S0: throwaway storage, the credential, the seeded routing store, the real RoutingService, the fakes ──
  const dbPath = path.join(evidence, 'chorus.db')
  let storage = new StorageService(dbPath)
  const createdAt = new Date().toISOString()
  storage.createProviderConfig({ id: PROVIDER_ID, name: 'OpenRouter', adapterType: 'opencode', authMode: 'api_key', envVarName: 'OPENROUTER_API_KEY', baseUrl: GATEWAY, createdAt })
  storage.createCredentialProfile({ id: C, providerId: PROVIDER_ID, label: 'Harness key', encryptedBlob: Buffer.from('not-a-real-DPAPI-envelope'), fingerprintHash: 'harness-fixture', createdAt })
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/main/routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json'), 'utf8'))
  const snapshot = { fetchedAt: fixture.fetchedAt as string, endpoints: parseEndpointsResponse(fixture).endpoints }
  const storeWarnings: string[] = [], logLines: string[] = []
  const routingStore = new RoutingStore(path.join(evidence, 'routing'), { warn: (m) => storeWarnings.push(m) })
  routingStore.writeSnapshot(SLUG, snapshot)
  routingStore.appendObservations(SLUG, extractObservations(snapshot), AT, DEFAULT_ROUTING_SETTINGS.observationMaxAgeDays)
  routingStore.mergeCache(SLUG, Object.fromEntries(Object.entries(fixture.cacheVerified as Record<string, boolean>).map(([tag, verified]) => [tag, { verified, checkedAt: CHECKED_AT }])))
  routingStore.writeAccount(SLUG, C, { guardrailRemoved: fixture.guardrailRemoved, dataPolicyRemoved: fixture.dataPolicyDenyRemoved, checkedAt: CHECKED_AT })
  const counters = { decrypts: 0, spawns: 0, routingVault: 0, fetches: 0, credentials: 0, models: 0, resolveLaunch: 0, getSettings: 0 }
  let routingClock = AT
  const routing = new RoutingService({
    storage,
    vault: { decryptForLaunch: async () => { counters.routingVault++; throw new Error('the harness never decrypts through routing') } } as unknown as RoutingServiceDeps['vault'],
    store: routingStore,
    now: () => routingClock,
    fetchImpl: async () => { counters.fetches++; throw new Error('the harness sends no request') },
    log: { info: (m) => logLines.push(m), warn: (m) => logLines.push(m), error: (m) => logLines.push(m) }
  })
  const resolveCalls: { request: unknown; outcome: string }[] = []
  /** The real service behind the four methods the port may call, counted. */
  const counted: TeamRoutingServiceLike = {
    credentials: () => { counters.credentials++; return routing.credentials() },
    models: () => { counters.models++; return routing.models() },
    resolveLaunch: (q) => {
      counters.resolveLaunch++
      try { const s = routing.resolveLaunch(q); resolveCalls.push({ request: q, outcome: 'ok' }); return s }
      catch (err) { resolveCalls.push({ request: q, outcome: (err as { code?: string }).code ?? 'error' }); throw err }
    },
    getSettings: () => { counters.getSettings++; return routing.getSettings() }
  }
  let routingAvailable = true
  let runId = ''
  let lease: TeamLease | undefined
  const decryptRecords: { memberId: string; routingAtDecrypt: (string | null)[] }[] = []
  type Finish = 'success' | 'provider-error' | 'truncated'
  const spawns: { attemptId: string; request: HelperLaunchRequest; settled: boolean; finish(kind: Finish): void }[] = []
  const teams = storage.createTeamStorage()
  const service = new TeamService({
    storage: teams,
    autoActivate: true,
    validateProject() {},
    validateMember: async () => {},
    leaseIssued: (value) => { lease = value },
    credentials: {
      inspect: (m) => m.authMode === 'api_key' ? { credentialId: m.credentialProfileId!, fingerprint: 'harness', providerId: m.providerId!, authMode: 'api_key', routeIdentity: 'harness-route' } : undefined,
      resolve: async (m) => {
        counters.decrypts++
        decryptRecords.push({ memberId: m.id, routingAtDecrypt: teams.attempts(runId).filter((a) => a.memberId === m.id && a.status === 'preparing').map((a) => (a.routing ? JSON.stringify(a.routing) : null)) })
        return { envVarName: 'OPENROUTER_API_KEY', value: FAKE_KEY, isSecret: true }
      },
      route: (m) => m.authMode === 'api_key' ? { providerKey: PROVIDER_ID, providerName: 'OpenRouter', baseUrl: GATEWAY, modelId: m.model } : undefined
    },
    workspace: {
      prepareRun: async () => ({ baseSha: SHA, head: SHA, worktreeId: randomUUID() }),
      prepareAttempt: async (_run, attempt) => ({ cwd: path.join(evidence, 'worktree'), baseSha: attempt.baseSha!, worktreeId: randomUUID() }),
      validateResult: async () => {},
      inspectRecovery: async () => ({ writersStopped: true, ordinaryDirty: false, ambiguousIntegration: false })
    },
    lead: { launch: async (_run, _lease, authorization) => { authorization.assertAuthorized(); return { sessionId: randomUUID() } }, stopped: async () => true, stop: async () => true },
    executor: {
      spawnHelper: (attemptId: string, options: HelperProcessOptions) => {
        options.authorizeSpawn() // production calls it immediately before the OS spawn; here nothing is spawned
        counters.spawns++
        const done = deferred<HelperProcessOutcome>()
        const identity = { pid: 40000 + counters.spawns, creationTime: String(counters.spawns), executable: options.request.executable }
        /** The REAL parser's result for one OpenCode record (C18 T13). */
        const parsed = (line: string) => [...options.parser.push(line), ...options.parser.finish()].find((e) => e.type === 'result') as NonNullable<HelperProcessOutcome['result']>
        const entry = {
          attemptId, request: options.request, settled: false,
          finish(kind: Finish) {
            if (entry.settled) return
            entry.settled = true
            const result = kind === 'success' ? { type: 'result' as const, summary: 'Harness helper finished.', isError: false } : parsed(kind === 'provider-error' ? '{"type":"error"}\n' : '{"type":"step_finish","part":{"reason":"length"}}\n')
            done.resolve({ exitCode: kind === 'success' ? 0 : 1, cessation: 'confirmed', result, permissionBlocked: false, protocolError: false, intent: null, process: identity, descendants: [], usage: [] })
          }
        }
        spawns.push(entry)
        return {
          identified: Promise.resolve(identity),
          done: done.promise,
          cancel: async (intent?: 'cancelled' | 'timed-out') => { options.onTerminationIntent?.(intent ?? 'cancelled'); if (!entry.settled) { entry.settled = true; done.resolve({ exitCode: null, cessation: 'confirmed', result: null, permissionBlocked: false, protocolError: false, intent: intent ?? 'cancelled', process: identity, descendants: [], usage: [] }) } },
          inspect: () => ({ process: identity, descendants: [], cessation: entry.settled ? 'confirmed' as const : 'live' as const, intent: null })
        }
      },
      cancelHelper: async () => {}
    },
    routing: createTeamRoutingPort(() => (routingAvailable ? counted : null))
  })

  // T1
  {
    const raw = new Database(dbPath, { readonly: true })
    const version = (raw.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number }).v
    const routingJson = (raw.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]).some((c) => c.name === 'routing_json')
    raw.close()
    const files = fs.readdirSync(path.join(evidence, 'routing'), { recursive: true }).map(String).filter((f) => fs.statSync(path.join(evidence, 'routing', f)).isFile()).map((f) => path.basename(f)).sort()
    const tiers = routing.tiers({ model: SLUG, profile: 'helper', effort: 'low', credentialProfileId: C })
    const listed = routing.credentials().credentials.map((c) => c.id)
    let builder: string | null = null
    try { builder = resolveCli('opencode').file } catch (err) { builder = `unresolved: ${(err as Error).message}` }
    record('T1 setup: v28 database, seeded store, pinned clock, the credential listed, nothing decrypted or sent',
      version === 28 && routingJson && isDeepStrictEqual(files, [`account-${C}.json`, 'cache.json', 'observations.json', 'snapshot.json']) && tiers.computedAt === AT && tiers.snapshotFetchedAt === '2026-10-02T09:05:00Z' && !tiers.stale && isDeepStrictEqual(listed, [C]) && builder !== null && !builder.startsWith('unresolved') && counters.decrypts === 0 && counters.routingVault === 0 && counters.fetches === 0 && routing.status().requestsSinceStart === 0,
      { version, routingJson, files, computedAt: tiers.computedAt, snapshotFetchedAt: tiers.snapshotFetchedAt, stale: tiers.stale, listed, builder, counters: { ...counters } })
  }

  // The roster (the DeepSeek capability options' member shape, teamRuntime.ts capabilities()).
  const LEAD: TeamMember = { id: randomUUID(), label: 'Lead', harness: 'claude', authMode: 'subscription', providerId: null, credentialProfileId: null, model: 'claude-sonnet-5', effort: null, installedVersion: '2.1.278 (Claude Code)' }
  const helper = (label: string, model: string, routingTier?: TeamMember['routingTier']): TeamMember => ({ id: randomUUID(), label, harness: 'opencode', authMode: 'api_key', providerId: PROVIDER_ID, credentialProfileId: C, model, effort: 'low', installedVersion: '1.18.34', customModel: true, ...(routingTier ? { routingTier } : {}) })
  const H1 = helper('Helper Balanced', NITRO, 'balanced'), H2 = helper('Helper Nitro', SLUG, 'nitro'), H3 = helper('Helper default', NITRO)
  const config = (helpers: unknown[]): unknown => ({ schemaVersion: 1, baseRevision: 'HEAD', leadContext: 'standard', lead: LEAD, helpers, concurrency: 4 })
  const USER = { role: 'user' as const, principal: 'routing-team-harness' }

  // T2, T3
  {
    const glm = await errorOf(() => service.createRun({ projectId: randomUUID(), clientRequestId: 'refused-glm', config: config([{ ...helper('GLM-5.3 helper', 'z-ai/glm-5.3', 'balanced'), customModel: false, effort: null }]) }, USER))
    const codex = await errorOf(() => service.createRun({ projectId: randomUUID(), clientRequestId: 'refused-codex', config: config([{ id: randomUUID(), label: 'Codex', harness: 'codex', authMode: 'subscription', providerId: null, credentialProfileId: null, model: 'gpt-6-astra', effort: null, installedVersion: 'codex-cli 0.155.1', routingTier: 'balanced' }]) }, USER))
    record('T2 launch refuses a tier on GLM-5.3 and on a Codex helper; no run row',
      glm?.code === 'ROUTING_REFUSED' && glm.message === EXPECTED.glmRefusal && isDeepStrictEqual(codex?.issues, [{ code: 'custom', path: ['config', 'helpers', 0], message: EXPECTED.notOpencode, keys: undefined }]) && teams.listRunIds().length === 0 && counters.resolveLaunch === 0 && counters.decrypts === 0,
      { glm, codex, runs: teams.listRunIds().length, counters: { ...counters } })
    const object = await errorOf(() => service.createRun({ projectId: randomUUID(), clientRequestId: 'refused-object', config: config([{ ...H1, routing: EXPECTED.balanced }]) }, USER))
    record('T3 launch rejects a member routing object; no run row',
      object?.name === 'ZodError' && isDeepStrictEqual(object.issues, [{ code: 'unrecognized_keys', path: ['config', 'helpers', 0], message: 'Unrecognized key: "routing"', keys: ['routing'] }]) && teams.listRunIds().length === 0,
      { object, runs: teams.listRunIds().length })
  }

  // T4
  const projectId = randomUUID()
  const ack = await service.createRun({ projectId, clientRequestId: 'routing-team', config: config([H1, H2, H3]) }, USER)
  runId = String(ack.runId)
  await until('the lead', () => teams.getRun(runId).leadSessionId !== null)
  const actor = () => ({ role: 'lead' as const, runId, generation: lease!.generation, epoch: lease!.epoch })
  service.markBridgeReady(actor())
  await until('an active run', () => teams.getRun(runId).status === 'active')
  {
    const run = teams.getRun(runId)
    const roster = await service.dispatch(actor(), 'team_roster', {}, new AbortController().signal) as { members: TeamMember[] }
    const stored = new Database(dbPath, { readonly: true })
    const configJson = (stored.prepare('SELECT config_json AS c FROM team_runs WHERE id = ?').get(runId) as { c: string }).c
    const memberJson = (stored.prepare('SELECT config_json AS c FROM team_members WHERE run_id = ? AND id = ?').get(runId, H3.id) as { c: string }).c
    stored.close()
    record('T4 launch stores tier names only; team_roster returns them',
      isDeepStrictEqual(run.config.helpers.map((h) => h.routingTier ?? null), ['balanced', 'nitro', null]) && isDeepStrictEqual(roster.members.map((h) => h.routingTier ?? null), ['balanced', 'nitro', null]) && !/"routing"\s*:/.test(configJson) && !memberJson.includes('routingTier') && counters.resolveLaunch === 0 && counters.decrypts === 0,
      { tiers: run.config.helpers.map((h) => h.routingTier ?? null), roster: roster.members.map((h) => h.routingTier ?? null), configHasRoutingObject: /"routing"\s*:/.test(configJson), unroutedMemberHasTier: memberJson.includes('routingTier'), counters: { ...counters } })
  }

  const task = (request: string, memberId: string) => service.submitTask(runId, { clientRequestId: request, memberId, kind: 'code', title: `Harness ${request}`, brief: `Harness task ${request}.`, acceptance: ['The harness records the request.'], paths: [`${request}.txt`] }, actor())
  const attemptsOf = (taskId: string): TeamAttempt[] => teams.attempts(runId).filter((a) => a.taskId === taskId).sort((a, b) => a.number - b.number)
  const spawnOf = (attemptId: string) => spawns.find((s) => s.attemptId === attemptId)
  /** TeamStorage.events pages 200 at a time (it reads one more to say whether more exist). */
  const allEvents = (): TeamEvent[] => { const out: TeamEvent[] = []; let after = 0; for (;;) { const page = teams.events(runId, after), take = page.slice(0, 200); out.push(...take); if (page.length <= 200) return out; after = take[take.length - 1].sequence } }
  const contentOf = (request: HelperLaunchRequest) => JSON.parse(request.envAdditions.OPENCODE_CONFIG_CONTENT) as { share: unknown; agent?: unknown; provider: { openrouter: { models: unknown } }; permission: unknown }
  const tail = (request: HelperLaunchRequest) => request.args.slice(request.args.indexOf('run'))

  // S3: A1 (H1, Balanced from :nitro), A2 (H2, Nitro from standard), A3 (H3, unrouted), each spawned then finished.
  const A1 = String(task('a1', H1.id).taskId); await until('A1 spawn', () => attemptsOf(A1).length === 1 && !!spawnOf(attemptsOf(A1)[0].id))
  const A2 = String(task('a2', H2.id).taskId); await until('A2 spawn', () => attemptsOf(A2).length === 1 && !!spawnOf(attemptsOf(A2)[0].id))
  const A3 = String(task('a3', H3.id).taskId); await until('A3 spawn', () => attemptsOf(A3).length === 1 && !!spawnOf(attemptsOf(A3)[0].id))
  const a1 = attemptsOf(A1)[0], a2 = attemptsOf(A2)[0], a3 = attemptsOf(A3)[0]
  const r1 = spawnOf(a1.id)!.request, r2 = spawnOf(a2.id)!.request, r3 = spawnOf(a3.id)!.request
  const a1RoutingJson = JSON.stringify(a1.routing)
  spawnOf(a1.id)!.finish('success'); spawnOf(a2.id)!.finish('truncated'); spawnOf(a3.id)!.finish('success')
  await until('A1-A3 settled', () => teams.tasks(runId).find((t) => t.id === A1)?.status === 'awaiting-review' && teams.tasks(runId).find((t) => t.id === A2)?.status === 'failed' && teams.tasks(runId).find((t) => t.id === A3)?.status === 'awaiting-review')

  {
    const mainTiers = routing.tiers({ model: SLUG, profile: 'helper', effort: 'low', credentialProfileId: C }).tiers.balanced
    const atDecrypt = decryptRecords.find((d) => d.memberId === H1.id)
    record('T5 Balanced from a :nitro member resolves on the helper profile before the decrypt',
      isDeepStrictEqual(a1.routing, EXPECTED.balanced) && isDeepStrictEqual(a1.routing?.provider, mainTiers?.provider) && isDeepStrictEqual(a1.routing?.endpoints, mainTiers?.endpoints) && isDeepStrictEqual(atDecrypt?.routingAtDecrypt, [JSON.stringify(EXPECTED.balanced)]) && isDeepStrictEqual(resolveCalls[0], { request: { model: SLUG, tier: 'balanced', effort: 'low', credentialProfileId: C, profile: 'helper' }, outcome: 'ok' }),
      { routing: a1.routing, mainTiers, atDecrypt, firstResolve: resolveCalls[0] })
    const c1 = contentOf(r1), c3 = contentOf(r3)
    record('T6 the routed request: base slug, the golden entry, every measured option kept',
      isDeepStrictEqual(tail(r1), EXPECTED.argsBase) && JSON.stringify(c1.provider.openrouter.models) === EXPECTED.modelsBalanced && r1.envAdditions.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX === '64000' && isDeepStrictEqual(Object.keys(c1), ['share', 'agent', 'provider', 'permission']) && isDeepStrictEqual(c1.share, c3.share) && isDeepStrictEqual(c1.agent, c3.agent) && isDeepStrictEqual(c1.permission, c3.permission),
      { args: tail(r1), models: c1.provider.openrouter.models, cap: r1.envAdditions.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX, keys: Object.keys(c1) })
    record('T7 Nitro from a standard member: :nitro, deny and variants.low',
      isDeepStrictEqual(a2.routing, EXPECTED.nitro) && isDeepStrictEqual(tail(r2), EXPECTED.argsNitro) && JSON.stringify(contentOf(r2).provider.openrouter.models) === EXPECTED.modelsNitro && r2.envAdditions.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX === '64000',
      { routing: a2.routing, args: tail(r2), models: contentOf(r2).provider.openrouter.models })
    const events = allEvents()
    const resolved = (id: string) => events.filter((e) => e.operation === 'helper-routing-resolved' && e.payload.attemptId === id)
    const seq = (op: string, id: string) => events.find((e) => e.operation === op && e.payload.attemptId === id)?.sequence ?? -1
    const ordered = (id: string) => resolved(id).length === 1 && seq('attempt-workspace-ready', id) < resolved(id)[0].sequence && resolved(id)[0].sequence < seq('helper-spawn-intent', id)
    record('T8 one helper-routing-resolved event per routed attempt, before helper-spawn-intent',
      ordered(a1.id) && ordered(a2.id) && resolved(a3.id).length === 0 && isDeepStrictEqual(resolved(a1.id)[0]?.payload, { attemptId: a1.id, tier: 'balanced', sentModelId: SLUG, endpoints: GOLDEN_ORDER }) && isDeepStrictEqual(resolved(a2.id)[0]?.payload, { attemptId: a2.id, tier: 'nitro', sentModelId: NITRO, endpoints: [] }) && resolved(a1.id)[0]?.actor === 'system' && resolved(a2.id)[0]?.actor === 'system',
      { a1: resolved(a1.id).map((e) => [e.sequence, e.payload]), a2: resolved(a2.id).map((e) => [e.sequence, e.payload]), a3: resolved(a3.id).length })
  }

  // S4: the routing clock moves 61 minutes on. B1 (H1, Balanced) is refused stale; B2 (H2, Nitro) resolves and stays live.
  routingClock = LATER
  let before = { ...counters }
  const B1 = String(task('b1', H1.id).taskId)
  await until('B1 refused', () => teams.tasks(runId).find((t) => t.id === B1)?.status === 'failed')
  {
    const b1 = attemptsOf(B1)[0], t = teams.tasks(runId).find((x) => x.id === B1)!
    const events = allEvents()
    record('T9 a stale ranked tier refuses the attempt before any decrypt or spawn',
      b1.status === 'failed' && b1.routing === undefined && b1.blocker === EXPECTED.staleBlocker && t.blocker === EXPECTED.staleBlocker && b1.process === null && counters.decrypts === before.decrypts && counters.spawns === before.spawns && counters.resolveLaunch === before.resolveLaunch + 1 && counters.getSettings === before.getSettings + 1 && resolveCalls.at(-1)?.outcome === 'SNAPSHOT_STALE' && events.some((e) => e.operation === 'preparation-failed' && e.payload.attemptId === b1.id) && !events.some((e) => e.operation === 'helper-routing-resolved' && e.payload.attemptId === b1.id),
      { status: b1.status, routing: b1.routing ?? null, blocker: b1.blocker, taskBlocker: t.blocker, delta: { decrypts: counters.decrypts - before.decrypts, spawns: counters.spawns - before.spawns, resolveLaunch: counters.resolveLaunch - before.resolveLaunch, getSettings: counters.getSettings - before.getSettings } })
  }
  before = { ...counters }
  const B2 = String(task('b2', H2.id).taskId)
  await until('B2 spawn', () => attemptsOf(B2).length === 1 && !!spawnOf(attemptsOf(B2)[0].id))
  const b2 = attemptsOf(B2)[0]
  record('T10 Nitro resolves on the same stale numbers',
    isDeepStrictEqual(b2.routing, EXPECTED.nitroLater) && counters.decrypts === before.decrypts + 1 && counters.spawns === before.spawns + 1 && JSON.stringify(contentOf(spawnOf(b2.id)!.request).provider.openrouter.models) === EXPECTED.modelsNitro,
    { routing: b2.routing, delta: { decrypts: counters.decrypts - before.decrypts, spawns: counters.spawns - before.spawns } })

  // S5: new numbers arrive (the fixture without streamlake/fp8, fetched one minute ago); the lead revises B1.
  const b1Before = JSON.stringify(attemptsOf(B1)[0])
  routingStore.writeSnapshot(SLUG, { fetchedAt: RESEED_AT, endpoints: snapshot.endpoints.filter((e) => e.tag !== 'streamlake/fp8') })
  await service.dispatch(actor(), 'team_revise', { clientRequestId: 'revise-b1', taskId: B1, memberId: H1.id, brief: 'Harness revision after new numbers.' }, new AbortController().signal)
  await until('B1 attempt 2 spawn', () => attemptsOf(B1).length === 2 && !!spawnOf(attemptsOf(B1)[1].id))
  const b1two = attemptsOf(B1)[1]
  record('T11 after a re-seed, the revised task resolves again on the new numbers',
    b1two.number === 2 && isDeepStrictEqual(b1two.routing, EXPECTED.reseeded) && Date.parse(b1two.routing!.computedAt) > Date.parse(a1.routing!.computedAt) && !isDeepStrictEqual(b1two.routing!.endpoints, a1.routing!.endpoints) && JSON.stringify(attemptsOf(B1)[0]) === b1Before && JSON.stringify(attemptsOf(A1)[0].routing) === a1RoutingJson && JSON.stringify(contentOf(spawnOf(b1two.id)!.request).provider.openrouter.models) === EXPECTED.modelsReseeded,
    { routing: b1two.routing, attempt1Unchanged: JSON.stringify(attemptsOf(B1)[0]) === b1Before, a1Unchanged: JSON.stringify(attemptsOf(A1)[0].routing) === a1RoutingJson })

  // S6: routing becomes unavailable (the thunk answers null): C1 (H1) is refused; C2 (H3, unrouted) launches as today.
  routingAvailable = false
  before = { ...counters }
  const C1 = String(task('c1', H1.id).taskId)
  await until('C1 refused', () => teams.tasks(runId).find((t) => t.id === C1)?.status === 'failed')
  const C2 = String(task('c2', H3.id).taskId)
  await until('C2 spawn', () => attemptsOf(C2).length === 1 && !!spawnOf(attemptsOf(C2)[0].id))
  routingAvailable = true
  {
    const c1 = attemptsOf(C1)[0], c2 = attemptsOf(C2)[0], r = spawnOf(c2.id)!.request
    record("T12 routing unavailable: a routed attempt is refused, an unrouted helper sends today's request",
      c1.blocker === EXPECTED.unavailableBlocker && c1.routing === undefined && c2.routing === undefined && counters.resolveLaunch === before.resolveLaunch && counters.decrypts === before.decrypts + 1 && counters.spawns === before.spawns + 1 && isDeepStrictEqual(tail(r), EXPECTED.argsNitro) && JSON.stringify(contentOf(r).provider.openrouter.models) === EXPECTED.modelsUnrouted && r.envAdditions.OPENCODE_CONFIG_CONTENT === r3.envAdditions.OPENCODE_CONFIG_CONTENT,
      { c1Blocker: c1.blocker, delta: { resolveLaunch: counters.resolveLaunch - before.resolveLaunch, decrypts: counters.decrypts - before.decrypts, spawns: counters.spawns - before.spawns }, args: tail(r) })
  }

  // S7: the live attempts end with OpenCode's generic provider error, through the real parser.
  const c2 = attemptsOf(C2)[0]
  for (const id of [b1two.id, b2.id, c2.id]) spawnOf(id)!.finish('provider-error')
  await until('S7 settled', () => [B1, B2, C2].every((id) => teams.tasks(runId).find((t) => t.id === id)?.status === 'failed'))
  {
    const blocker = (taskId: string, n: number) => ({ attempt: attemptsOf(taskId)[n].blocker, task: teams.tasks(runId).find((t) => t.id === taskId)!.blocker, summary: attemptsOf(taskId)[n].result?.summary, failure: attemptsOf(taskId)[n].result?.failure })
    const routed = blocker(B1, 1), nitro = blocker(B2, 0), unrouted = blocker(C2, 0), truncated = blocker(A2, 0)
    const providerError = { category: 'provider-error', finishReason: null }
    record('T13 a routed provider error names its tier; other failures do not',
      isDeepStrictEqual(routed, { attempt: `${EXPECTED.providerError} ${EXPECTED.noteReseeded}`, task: `${EXPECTED.providerError} ${EXPECTED.noteReseeded}`, summary: EXPECTED.providerError, failure: providerError }) &&
      isDeepStrictEqual(nitro, { attempt: `${EXPECTED.providerError} ${EXPECTED.noteNitro}`, task: `${EXPECTED.providerError} ${EXPECTED.noteNitro}`, summary: EXPECTED.providerError, failure: providerError }) &&
      isDeepStrictEqual(unrouted, { attempt: EXPECTED.providerError, task: EXPECTED.providerError, summary: EXPECTED.providerError, failure: providerError }) &&
      isDeepStrictEqual(truncated, { attempt: EXPECTED.truncated, task: EXPECTED.truncated, summary: EXPECTED.truncated, failure: { category: 'generation-truncated', finishReason: 'length' } }),
      { routed, nitro, unrouted, truncated })
  }

  // S8 (T14): quiesce, reopen from disk, then the storage rules on a fixture run in the same database.
  await service.shutdown()
  const attemptsBefore = JSON.stringify(teams.attempts(runId))
  storage.close()
  storage = new StorageService(dbPath)
  const reopened = storage.createTeamStorage()
  {
    const after = reopened.attempts(runId)
    const op = (rid: string, n: number) => ({ runId: rid, operation: `harness-${n}`, actor: 'system' as const, generation: 1, eventId: randomUUID(), now: new Date().toISOString() })
    const write = (rid: string, n: number, value: TeamAttempt, expected?: number) => errorOf(() => reopened.command(op(rid, n), (tx) => { tx.writeAttempt(value, expected); return { acknowledgment: {}, event: {} } }))
    // A fixture run whose helper is a copy of the OpenCode H1, with one reserved (preparing) attempt. These two writes must succeed.
    const fixtureRun = teamFixtureRunFor(H1)
    reopened.createRun(fixtureRun, 'storage-controls', { config: fixtureRun.config }, randomUUID())
    const fixtureTask = teamFixtureTaskFor(fixtureRun.id, fixtureRun.config.helpers[0].id)
    reopened.command(op(fixtureRun.id, 1), (tx) => { tx.writeTask(fixtureTask); return { acknowledgment: {}, event: {} } })
    const reservation = reserveNextAttempt(fixtureRun, [fixtureTask], [], randomUUID(), new Date().toISOString())!
    reopened.command(op(fixtureRun.id, 2), (tx) => { tx.writeAttempt(reservation.attempt); tx.writeTask(reservation.task, fixtureTask.version); return { acknowledgment: {}, event: {} } })
    const preparing = reopened.attempts(fixtureRun.id)[0]
    const keyTag = 'sk-or-v1-' + 'e'.repeat(40)
    const forged: RoutingLaunchSelection = { ...EXPECTED.balanced, provider: PROVIDER([keyTag]), endpoints: [keyTag] } as RoutingLaunchSelection
    const secret = await write(fixtureRun.id, 3, { ...preparing, routing: forged, version: preparing.version + 1 }, preparing.version)
    const unchangedAfterSecret = JSON.stringify(reopened.attempts(fixtureRun.id)[0]) === JSON.stringify(preparing)
    const first = await write(fixtureRun.id, 4, { ...preparing, routing: EXPECTED.balanced as RoutingLaunchSelection, version: preparing.version + 1 }, preparing.version)
    const recorded = reopened.attempts(fixtureRun.id)[0]
    const changed = await write(fixtureRun.id, 5, { ...recorded, routing: { ...recorded.routing!, computedAt: LATER }, version: recorded.version + 1 }, recorded.version)
    const { routing: _dropped, ...withoutRouting } = recorded
    const dropped = await write(fixtureRun.id, 6, { ...withoutRouting, version: recorded.version + 1 }, recorded.version)
    const lateA3 = after.find((a) => a.id === a3.id)!
    const late = await write(runId, 7, { ...lateA3, routing: EXPECTED.nitro as RoutingLaunchSelection, version: lateA3.version + 1 }, lateA3.version)
    const inserted = await write(fixtureRun.id, 8, { ...reservation.attempt, id: randomUUID(), number: 2, routing: EXPECTED.balanced as RoutingLaunchSelection })
    record('T14 attempts read back unchanged; recorded routing is immutable and secret-free',
      JSON.stringify(after) === attemptsBefore && after.filter((a) => a.routing).length === 4 && secret?.code === 'SECRET_IN_RECORD' && unchangedAfterSecret && first === null && isDeepStrictEqual(recorded.routing, EXPECTED.balanced) && [changed, dropped, late, inserted].every((e) => e?.code === 'IMMUTABLE_ATTEMPT' && e.message === ROUTING_IMMUTABLE),
      { sameJson: JSON.stringify(after) === attemptsBefore, routed: after.filter((a) => a.routing).length, secret: secret?.code, unchangedAfterSecret, first, changed: changed?.code, dropped: dropped?.code, late: late?.code, inserted: inserted?.code })
  }

  // T15: MR-G4 — the fake key appears nowhere it should not; every routing call is accounted for.
  {
    const patterns = (JSON.parse(fs.readFileSync(path.join(ROOT, 'src/main/services/secret-patterns.json'), 'utf8')).patterns as { name: string; source: string }[]).map((p) => ({ name: p.name, re: new RegExp(p.source) }))
    const scanInto = (into: string[], label: string, text: string) => { if (text.includes(FAKE_KEY)) into.push(`${label} contains the fake key`); const p = patterns.find(({ re }) => re.test(text)); if (p) into.push(`${label} matches the ${p.name} pattern`) }
    const hits: string[] = [], scratch: string[] = []
    scanInto(scratch, 'scratch', `planted ${FAKE_KEY} here`)
    const raw = new Database(dbPath, { readonly: true })
    for (const { name } of raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]) scanInto(hits, `table ${name}`, JSON.stringify(raw.prepare(`SELECT * FROM "${name}"`).all(), (_k, v) => (Buffer.isBuffer(v) ? v.toString('latin1') : v)))
    raw.close()
    for (const file of fs.readdirSync(path.join(evidence, 'routing'), { recursive: true }).map(String)) { const p = path.join(evidence, 'routing', file); if (fs.statSync(p).isFile()) scanInto(hits, `routing/${file}`, fs.readFileSync(p, 'utf8')) }
    scanInto(hits, 'routing log', logLines.join('\n')); scanInto(hits, 'store warnings', storeWarnings.join('\n'))
    for (const s of spawns) { const { secretEnv: _secret, ...visible } = s.request; scanInto(hits, `request ${s.attemptId}`, JSON.stringify(visible)) }
    scanInto(hits, 'checks', JSON.stringify(checks))
    const keyWhereExpected = spawns.length === 6 && spawns.every((s) => s.request.secretEnv.OPENROUTER_API_KEY === FAKE_KEY)
    const expected = { decrypts: 6, spawns: 6, routingVault: 0, fetches: 0, credentials: 8, models: 8, resolveLaunch: 5, getSettings: 1 }
    record('T15 no key material anywhere; every routing call accounted for',
      isDeepStrictEqual(scratch, ['scratch contains the fake key', 'scratch matches the openrouter pattern']) && patterns.some(({ re }) => re.test('sk-or-v1-' + '0123456789abcdef'.repeat(2))) && keyWhereExpected && hits.length === 0 && isDeepStrictEqual(counters, expected) && routing.status().requestsSinceStart === 0,
      { hits, scratch, keyWhereExpected, counters, expected, requestsSinceStart: routing.status().requestsSinceStart })
  }
  storage.close()
  fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify({ checks, electron: process.versions.electron, at: new Date().toISOString() }, null, 2))
  app.exit(0)
}).catch((error) => { fs.writeFileSync(path.join(evidence, 'failure.json'), JSON.stringify({ message: String(error?.message ?? error), stack: String(error?.stack ?? '') })); app.exit(1) })

/** A minimal active run (teamTestFixtures' shape) whose only helper is a copy of H1, so its attempt can carry routing. */
function teamFixtureRunFor(member: TeamMember) {
  const lead: TeamMember = { id: randomUUID(), label: 'Lead', harness: 'claude', authMode: 'subscription', providerId: null, credentialProfileId: null, model: 'claude-sonnet-5', effort: null, installedVersion: '2.1.278 (Claude Code)' }
  const config = { schemaVersion: 1, baseRevision: 'HEAD', lead, helpers: [{ ...member, id: randomUUID() }], concurrency: 2, executionMinutes: 30, integrationPolicy: 'lead-integrates' } as TeamRunConfig
  const now = new Date().toISOString()
  return { id: randomUUID(), projectId: randomUUID(), leadSessionId: null, config, status: 'active' as const, generation: 1, version: 1, policyVersion: 1, baseSha: SHA, integrationWorktreeId: randomUUID(), integrationHead: SHA, createdAt: now, updatedAt: now, blocker: null }
}
function teamFixtureTaskFor(runId: string, memberId: string) {
  return { id: randomUUID(), runId, command: { clientRequestId: 'storage-control', memberId, kind: 'code' as const, title: 'Storage control', brief: 'Storage control.', context: '', acceptance: ['The control runs.'], paths: ['control.txt'], dependsOn: [] }, status: 'queued' as const, version: 1, currentAttemptId: null, attemptCount: 0, readyAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), blocker: null }
}
