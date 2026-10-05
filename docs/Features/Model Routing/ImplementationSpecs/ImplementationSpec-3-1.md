# Implementation specification 3-1 — Main support for the UI

Paired [task](../Tasks/Task-3-1.md). Decisions: [roadmap](../roadmap.md) MR-D18, MR-D19; user decisions MR-D21, MR-D22; gates MR-G1, MR-G4, MR-G5, MR-G8; [overview](../Tasks/Phase-3-Overview.md) K1, K4, K10 and clarifications C1–C4. Builds on [ImplementationSpec-2-3](ImplementationSpec-2-3.md) and [ImplementationSpec-2-4](ImplementationSpec-2-4.md). **Not started.**

## Files and insertion points

Verified 2026-10-02 at `5079b5d`.

| File | Action |
|---|---|
| `src/shared/routing.ts` | In `ROUTING_CHANNELS` (:535), insert `credentials: 'routing:credentials',` after `observationSet` (:543), before `progress` (:544). In `RoutingApi` (:554), insert `credentials(…)` after `observationSet` (:562), before `onProgress` (:563). Append the "Phase 3 — UI support" block after the IPC block (file end, :564). Nothing else changes. |
| `src/shared/routing.test.ts` | Amend S5-1 (:310–315): ten values. Append `describe('Table S6 — Phase 3 UI support')`. |
| `src/main/services/routingService.ts` | Imports (:4–28); `RoutingStorageLike` (:97–105); `RoutingServiceDeps` after `probeConcurrency` (:127); two fields beside the C21 fields (:249–251) and `busy` (:255); constructor validation after the C21 checks (:264–275); `cooldownMessage` beside `MESSAGES` (:149–157); `credentials()` after `models()` (:294–300); `refresh()` (:329–348) as below; `assertCooledDown` and `recordRefreshEnd` in the helpers section (after :826). |
| `src/main/services/routingService.test.ts` | Harness amendments (:192–218, :295–305); append `describe('Table V3 — Phase 3 additions')`. |
| `src/main/services/routingIpc.ts` | Header (:24–25); imports (:4–18); `RoutingIpcDeps.service` (:48–51); one `handle(…)` after the `observationSet` line (:110). |
| `src/main/services/routingIpc.test.ts` | `VALID` (:96–105), `WRONG_TYPE` (:107–116), the `setup` fake (:121–133) and `actions` (:143–152); I1 (:176–182); `happyPaths` (:225–244); I4 (:246–270); append I11. |
| `src/preload/index.ts` | One line after `observationSet` (:169). CRLF in the working tree. |
| `scripts/verify-routing-ipc.mjs` | Header (:3–11); freshness (:104–105); `CHECKS` (:64–70); the D18 call after D12 (:392–396). |

`src/main/index.ts`, `src/preload/index.d.ts`, `src/main/ipc.ts`, `storage.ts`, `routingObserver.ts` and every `src/main/routing/*` file are unchanged: `index.ts:1416` already passes the full `StorageService`, which has both list methods (`storage.ts:2304`, :2354).

## Normative contracts — `src/shared/routing.ts`

**Amendments to the Phase 2 IPC block** (recorded in the overview's amendment table):

```ts
export const ROUTING_CHANNELS = {
  // … the eight existing request channels, unchanged …
  observationSet: 'routing:observation-set',
  credentials: 'routing:credentials', // Phase 3 (Task 3-1)
  progress: 'routing:progress' // main -> renderer broadcast only
} as const

export interface RoutingApi {
  // … unchanged members …
  observationSet(input: RoutingObservationSettings): Promise<RoutingReply<RoutingObservationSettings>>
  /** Phase 3 (Task 3-1): the credentials a refresh or a designation would accept. Never decrypted. */
  credentials(input: Record<string, never>): Promise<RoutingReply<RoutingCredentialList>>
  onProgress(listener: (event: RoutingProgressEvent) => void): () => void
}
```

**Appended block:**

```ts
// ── Phase 3 — UI support (Task 3-1) ──

/**
 * MR-D22: after a refresh of a model that reached the network ends, another refresh of that model
 * is refused for this long. Main's default and the renderer's countdown (C4).
 */
export const ROUTING_REFRESH_COOLDOWN_MS = 60_000

/** The cache-probe cap per refresh (MR-D9, MR-D18), for the UI's cost statement. Equal to CACHE_PROBE_CAP_USD (a main test pins it). */
export const ROUTING_REFRESH_PROBE_CAP_USD = 0.05

/**
 * One credential a refresh or a designation would accept: it passes checkRoutingCredential (pre-decrypt;
 * never decrypted). `label` and `providerName` are user text, passed through scrubSecrets in main (C1).
 */
export const routingCredentialSchema = z.strictObject({
  id: credentialProfileIdSchema,
  label: z.string(),
  providerName: z.string()
})
export type RoutingCredential = z.infer<typeof routingCredentialSchema>
export const routingCredentialListSchema = z.strictObject({ credentials: z.array(routingCredentialSchema) })
export type RoutingCredentialList = z.infer<typeof routingCredentialListSchema>
```

`label` and `providerName` carry no length or emptiness rule on purpose: a stored row must never make the whole list fail its output parse. `id` is strict because a refresh request requires a UUID.

## `routingService.ts`

```ts
// imports from '../../shared/routing', added to the existing list (:4–28)
ROUTING_REFRESH_COOLDOWN_MS, credentialProfileIdSchema, type RoutingCredential, type RoutingCredentialList

// RoutingStorageLike (:97–105) gains two members
| 'listCredentialProfiles'
| 'listProviderConfigs'

// RoutingServiceDeps, after probeConcurrency (:127)
refreshCooldownMs?: number // MR-D22, C3; default ROUTING_REFRESH_COOLDOWN_MS; 0 disables. Never reachable from IPC.

// beside MESSAGES (:149–157)
/** MR-D22. Exact text; `seconds` is 1..60. */
function cooldownMessage(seconds: number): string {
  return `This model was refreshed less than a minute ago. Try again in ${seconds} s.`
}

// fields, beside the C21 knobs (:249–251) and `busy` (:255)
private readonly refreshCooldownMs: number
/** MR-D22: per model slug, when the last refresh that reached the network ended (epoch ms, service clock). */
private readonly refreshEndedAt = new Map<string, number>()

// constructor, after the C21 checks (:264–272)
const refreshCooldownMs = deps.refreshCooldownMs ?? ROUTING_REFRESH_COOLDOWN_MS
if (!(Number.isInteger(refreshCooldownMs) && refreshCooldownMs >= 0 && refreshCooldownMs <= ROUTING_REFRESH_COOLDOWN_MS)) {
  throw new RangeError('Invalid refreshCooldownMs')
}
this.refreshCooldownMs = refreshCooldownMs
```

**`credentials()`** (after `models()`, :294–300):

```ts
/** Phase 3 (K1, C1): the credentials a refresh or a designation would accept. The pre-decrypt predicate only; never decrypts. */
credentials(): RoutingCredentialList {
  try {
    const providers = new Map(this.storage.listProviderConfigs().map((p) => [p.id, p] as const))
    const credentials: RoutingCredential[] = []
    for (const profile of this.storage.listCredentialProfiles()) {
      if (!credentialProfileIdSchema.safeParse(profile.id).success) continue // a refresh could never name it
      const provider = providers.get(profile.providerId) ?? null
      if (provider === null || !checkRoutingCredential(profile, provider, OPENROUTER_GATEWAY_BASE_URL).ok) continue
      credentials.push({ id: profile.id, label: scrubSecrets(profile.label), providerName: scrubSecrets(provider.name) })
    }
    credentials.sort((a, b) => byCodeUnit(a.label, b.label) || byCodeUnit(a.id, b.id))
    return { credentials }
  } catch (err) {
    throw this.unexpected('credentials', err)
  }
}
```

It reads two lists and never calls `getCredentialProfileById`, `vault.decryptForLaunch` or anything that touches a blob or a fingerprint. Like `models()` and `status()` it does not call `assertLive`, so it answers after `dispose()`.

**`refresh()`** (:329–348) becomes, with the two marked changes only:

```ts
async refresh(request: RoutingRefreshRequest): Promise<RoutingRefreshResult> {
  let slot: string | null = null
  let reached = false // C2: true once every pre-network refusal has passed
  try {
    const q = this.parseInput(routingRefreshRequestSchema, request)
    const entry = this.registryEntry(q.model)
    this.assertLive()
    if (this.busy.has(q.model)) throw routingError('BUSY', MESSAGES.busy)
    this.assertCooledDown(q.model) // NEW — MR-D22: pre-network; no event, no credential read, no decrypt
    this.busy.add(q.model)
    slot = q.model
    const settings = this.readSettings()
    return await this.withRoutingKey(q.credentialProfileId, (key) => {
      reached = true // NEW — the decrypt succeeded and the envelope passed; C17's events begin in runRefresh
      return this.runRefresh(key, q, entry, settings)
    })
  } catch (err) {
    throw this.unexpected('refresh', err)
  } finally {
    if (slot !== null) {
      if (reached) this.recordRefreshEnd(slot) // NEW
      this.busy.delete(slot)
    }
  }
}
```

**Helpers** (after `readSettings`, :824–826):

```ts
/** MR-D22, C2. Refused iff 0 <= elapsed < cooldown; NaN or a clock that moved back is not refused. */
private assertCooledDown(model: string): void {
  if (this.refreshCooldownMs === 0) return // C3: no clock read at all
  const endedAt = this.refreshEndedAt.get(model)
  if (endedAt === undefined) return
  const elapsed = Date.parse(this.now()) - endedAt
  if (!(elapsed >= 0 && elapsed < this.refreshCooldownMs)) return
  throw routingError('BUSY', cooldownMessage(Math.ceil((this.refreshCooldownMs - elapsed) / 1000)))
}

/** Called from refresh's finally only when the refresh reached the network. Never throws. */
private recordRefreshEnd(model: string): void {
  if (this.refreshCooldownMs === 0) return
  try {
    const endedAt = Date.parse(this.now())
    if (Number.isFinite(endedAt)) this.refreshEndedAt.set(model, endedAt)
  } catch {
    // A failing clock records nothing; the refresh's own result or error stands.
  }
}
```

Rules (normative):

- **Boundary (C2).** A refresh starts the cooldown if and only if the `use` callback of `withRoutingKey` ran. Everything before it is a pre-network refusal: `INVALID_REQUEST`, `UNKNOWN_MODEL`, `OPERATION_FAILED` "Routing has stopped.", `BUSY` (in flight or cooldown), `CREDENTIAL_REFUSED` before or after the decrypt, `CREDENTIAL_UNAVAILABLE`. Everything after it started the cooldown, whatever its outcome (`done`, `FETCH_FAILED`, `INVALID_TIME`, `OPERATION_FAILED` mid-refresh).
- **Order.** Parse, registry, `assertLive`, in-flight `BUSY` (its message unchanged), cooldown `BUSY`. So an invalid or unknown request keeps its own code during a cooldown, and a refresh in flight is reported as in flight.
- **Per model.** The map is keyed by slug; a refresh of one model never delays another.
- **Observer.** `observe` neither reads nor writes `refreshEndedAt`.
- **Clock.** The service clock (`now`) is the only time source, as everywhere in the service. With `refreshCooldownMs` 0 the service makes no extra `now()` call, so every Phase 2 test that counts clock calls (`routingService.test.ts:1266`, :1336) runs exactly as before.
- **Seconds.** `ceil((refreshCooldownMs − elapsed) / 1000)`, which is 1..60 whenever the refusal fires; `routingError` scrubs the message like every other.

## `routingIpc.ts`

```ts
// header (:24–25): "Nine request channels and one broadcast"
// imports (:4–18): add routingCredentialListSchema
// RoutingIpcDeps.service (:48–51): add 'credentials' to the Pick
// after the observationSet line (:110)
handle(ROUTING_CHANNELS.credentials, routingEmptyRequestSchema, routingCredentialListSchema, () => service.credentials())
```

The envelope (sender frame, input parse, action, output parse, error mapping; `routingIpc.ts:67–100`) is unchanged and applies to the new channel.

## Preload (`src/preload/index.ts`)

After `observationSet: input => ipcRenderer.invoke('routing:observation-set', input),` (:169):

```ts
    credentials: input => ipcRenderer.invoke('routing:credentials', input),
```

A literal channel string, no import change, no Zod (:138). The file is CRLF in the working tree: keep the new line CRLF, check `git diff --stat src/preload/index.ts` reports `1 insertion(+)`, and check `git ls-files --eol src/preload/index.ts` still reports `w/crlf` (`core.autocrlf` is true, so the diff alone cannot see a line-ending rewrite).

## `scripts/verify-routing-ipc.mjs`

- Header (:3–11): "(ImplementationSpec-2-4, D1-D17; ImplementationSpec-3-1, D18)".
- Freshness (:104–105): also require `out/preload/index.js` to contain `routing:credentials`, with the detail `out/preload/index.js has no routing:credentials`.
- `CHECKS` (:64–70): add `'D18 credentials empty'` after `'D17 no key material'`, before `'cleanup'`.
- After D12 (:392–396), before the D13 negative control, so D14's zero-request check covers it:

```js
const d18 = await page(`
  const list = await routing.credentials({})
  const extra = await routing.credentials({ extra: 1 })
  return { list, extra }`)
record('D18 credentials empty', first(okValue(d18?.list, { credentials: [] }), refused(d18?.extra, 'INVALID_REQUEST')))
```

The throwaway profile has no credential, so the list is empty. The last line becomes `PASS (19 checks)`.

## Test cases

Every key-shaped string is built by concatenation (`'sk-or-v1-' + …`), as the existing files do (`routingService.test.ts:45`, `routingIpc.test.ts:45`).

**Harness amendments — `routingService.test.ts`** (fixtures, not expectations):

- `HarnessOptions.deps` (:193) widens to `Pick<RoutingServiceDeps, 'probeTagLimit' | 'probeCapUsd' | 'probeConcurrency' | 'refreshCooldownMs'>`, and `HarnessOptions` gains `productionCooldown?: boolean`.
- The storage fake (:207–218) gains `listCredentialProfiles: vi.fn(() => [...state.profiles.values()])` and `listProviderConfigs: vi.fn(() => [...state.providers.values()])`.
- The construction (:295–305) passes `...(options.productionCooldown ? {} : { refreshCooldownMs: 0 })` before `...options.deps`. So every existing test runs with the cooldown off (C3), a test opts in with `deps: { refreshCooldownMs: 60_000 }`, and `productionCooldown: true` omits the knob to exercise the default.
- Run the whole file after this change and before writing V30: every existing test must pass unchanged.

**Table V3 — `routingService.test.ts`.** `NOW` is `2026-10-02T09:20:00Z`; `C` is the harness's OpenRouter credential (`OR key` on provider `OpenRouter`). "Cooldown on" means `makeHarness({ deps: { refreshCooldownMs: 60_000 } })`. Every value returned by `credentials()` is pushed to `h.results`, so the key-discipline audit (V19) covers it.

| # | Case | Expect |
|---|---|---|
| V30 | `credentials()` on the default harness; again after `dispose()` | Both `{ credentials: [{ id: C, label: 'OR key', providerName: 'OpenRouter' }] }`. `h.decrypts` `[]`, `h.requests` `[]`; `getCredentialProfileById` and `getProviderConfigById` not called. |
| V31 | Add providers `prov-slash` (as `OR_PROVIDER`, `baseUrl: 'https://openrouter.ai/api/v1/'`, `name: 'OpenRouter (Team helpers)'`), `prov-other` (`baseUrl: 'https://example.invalid/api/v1'`), `prov-mgmt` (`authMode: 'management'`), `prov-sub` (`authMode: 'subscription'`); profiles `D` on `prov-slash` labelled `Another key`, `I = '00000000-0000-4000-8000-000000000001'` on `prov-or` labelled `OR key`, and one profile each on `prov-other`, `prov-mgmt`, `prov-sub`, on `prov-or` with `unavailableSince` set, and on a missing provider id | Exactly `[{ id: D, label: 'Another key', providerName: 'OpenRouter (Team helpers)' }, { id: I, label: 'OR key', providerName: 'OpenRouter' }, { id: C, label: 'OR key', providerName: 'OpenRouter' }]` (label order, then id: `0000…` before `5f0c…`). 0 decrypts. |
| V32 | A profile with id `legacy-id` on `prov-or`; a profile `D` labelled `'my ' + FAKE_KEY` on a provider named `'Prov ' + FAKE_KEY` (OpenRouter base URL, `api_key`) | `legacy-id` absent. `D`'s entry is `{ id: D, label: 'my [redacted]', providerName: 'Prov [redacted]' }`. `routingCredentialListSchema.parse(result)` strictly equals `result`. |
| V33 | `listCredentialProfiles` throws `new Error('db locked')` | `RoutingError` `OPERATION_FAILED`, message `Routing operation failed.`; `log.error` called once, with `('credentials failed', <that error>)`. |
| V34 | Cooldown on. `refresh()` at `NOW`; record the call counts of `getCredentialProfileById` and `readRoutingSettings`; `refresh()` again at `NOW` | Second: `BUSY`, message `This model was refreshed less than a minute ago. Try again in 60 s.`. Both call counts unchanged; `h.decrypts` `[C]`; `h.requests` 45; `h.events` 18 (no event from the refusal). |
| V35 | Cooldown on. `refresh()` at `NOW`; then `h.clock.now` = `2026-10-02T09:20:42Z`, `2026-10-02T09:20:59.001Z`, `2026-10-02T09:21:00Z`, refreshing at each | `… Try again in 18 s.`; `… Try again in 1 s.`; the third runs (`h.decrypts` `[C, C]`; `h.requests` 48, because every tag's cache record is now fresh, as in V29's second refresh). |
| V36 | Cooldown on. In turn, each restored afterwards: profile `C` deleted (`CREDENTIAL_REFUSED`); the vault answers `{ ok: false, kind: 'undecryptable', message }` (`CREDENTIAL_UNAVAILABLE`); the envelope carries `baseUrl: 'https://proxy.invalid/v1'` (`CREDENTIAL_REFUSED` after its decrypt); then a valid `refresh()`; then another | The three refusals as stated, with 0 requests and 0 events. The valid refresh runs (`h.events` 18; `h.decrypts` `[C, C, C]`). The next is the cooldown `BUSY` (`Try again in 60 s.`): only a refresh that reached the network starts the cooldown. |
| V37 | Cooldown on. The endpoints GET answers 503; `refresh()` → `FETCH_FAILED`; restore 200; `refresh()` at the same clock | Second: cooldown `BUSY`, `Try again in 60 s.`; `h.requests` 1 (a failed refresh that reached the network starts the cooldown). |
| V38 | Cooldown on. Designate `C`; `observe()`; then `refresh()` at the same clock | The tick is `observed` (1 GET); the refresh runs (`h.requests` 46, `h.decrypts` `[C, C]`): an observer tick does not start the cooldown. |
| V39 | Cooldown on. `refresh()` at `NOW`. Then during the cooldown: `refresh({ model: 'other/model' })`; `service.refresh({ …valid, extra: 1 })`. Then `h.clock.now = '2026-10-02T09:21:01Z'`, hold the endpoints GET and start a refresh; a second call while it is held; release; a third call at the same clock. Finally `dispose()` and call again | `UNKNOWN_MODEL`; `INVALID_REQUEST`; the held one runs; the second is `BUSY` with `A routing refresh or observation is already running for this model.`; the third is the cooldown `BUSY`, `Try again in 60 s.`; after dispose, `OPERATION_FAILED`, `Routing has stopped.`. |
| V40 | `new RoutingService({ ...base, refreshCooldownMs })` (the base of `routingService.test.ts:1187`) for −1, 1.5, `NaN`, 60,001, `Infinity`; then for 0, 60,000 and omitted | `RangeError` for the first five; the last three construct (and `dispose()` without throwing). With `deps: { refreshCooldownMs: 0 }`, two refreshes at the same clock both run. |
| V41 | `makeHarness({ productionCooldown: true })`: `refresh()`, `refresh()` at `NOW`; then `h.clock.now = '2026-10-02T09:21:00Z'` and `refresh()`. Also `ROUTING_REFRESH_PROBE_CAP_USD` and `ROUTING_REFRESH_COOLDOWN_MS` | Cooldown `BUSY` `Try again in 60 s.`, then a run: the default is 60,000 ms. `ROUTING_REFRESH_PROBE_CAP_USD === CACHE_PROBE_CAP_USD` (imported from `../routing/cacheProbeCore`) and `ROUTING_REFRESH_COOLDOWN_MS === 60_000`. |
| V42 | Cooldown on. `refresh()` at `NOW`; `h.clock.now = '2026-10-02T09:19:00Z'`; `refresh()` | The second runs: a clock that moved backwards is not refused (C2). |

**Table I amendments and I11 — `routingIpc.test.ts`.**

- `VALID['routing:credentials'] = {}`; `WRONG_TYPE['routing:credentials'] = []`; the `setup` fake gains `credentials: vi.fn(() => ({ credentials: [{ id: C, label: 'OR key', providerName: 'OpenRouter' }] }))`; `actions['routing:credentials'] = service.credentials`. With these, I2, I3, I5 and I6 run over nine channels.
- I1: `expect(REQUEST_CHANNELS).toHaveLength(9)` (was 8; amendment); the registered set equals the nine.
- `happyPaths`: add `await run('routing:credentials', {}, service.credentials)` after the observation-set call. I4: `expect(responses).toHaveLength(9)` (was 8; amendment); `expect(service.credentials).toHaveBeenCalledWith()`; `service.credentials` joins the called-once loop.

| # | Case | Expect |
|---|---|---|
| I11 | `credentials` returns `{ credentials: [{ id: 'x', label: 'L', providerName: 'P' }] }` | `{ ok: false, code: 'OPERATION_FAILED', message: 'Routing operation failed.' }`; `log.warn` called once with `routing:credentials produced an invalid response (1 issues)`. |

**Table S5 amendment and S6 — `src/shared/routing.test.ts`.**

| # | Case | Expect |
|---|---|---|
| S5-1 (amended) | `Object.values(ROUTING_CHANNELS)` | Ten unique values (was nine), each starting with `routing:`. |
| S6-1 | `ROUTING_REFRESH_COOLDOWN_MS`; `ROUTING_REFRESH_PROBE_CAP_USD`; `ROUTING_CHANNELS.credentials` | `60000`; `0.05`; `'routing:credentials'`. |
| S6-2 | `routingCredentialListSchema` on `{ credentials: [] }`; on one item `{ id: C, label: 'OR key', providerName: 'OpenRouter' }`; on `id: 'x'`; on an item with an extra key; on an extra top-level key; on an item without `providerName` | Pass, pass, fail, fail, fail, fail. |
| S6-3 | An item with `label: ''` | Passes (a stored row never fails the list). |

## Invariants

- `credentials()` never decrypts, never reads a blob or fingerprint, never sends a request, and returns only ids that a refresh request can name, with scrubbed user text (MR-G4, C1).
- The cooldown is a pre-network refusal: no credential read, no settings read, no decrypt, no event, no request. It starts only for a refresh that reached the network and never for an observer tick (MR-D22, C2).
- `refreshCooldownMs` is a constructor option only (C3); `routingStatusSchema` is unchanged (K1).
- Every request, the new one included, is checked for its sender, parsed in, and parsed out in main (MR-G5); the preload stays a Zod-free pass-through.
- No Phase 1 or Phase 2 golden value changes; the purity and layering greps stay empty; the ranker script passes.

## Verification

```powershell
npm run typecheck
npx vitest run src/main/services/routingService.test.ts src/main/services/routingIpc.test.ts src/shared/routing.test.ts
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
Get-ChildItem -Path src/main/routing -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern "from '\.\./(services|db|adapters)/"
node scripts/verify-routing-ranker.mjs
npx electron-vite build
node scripts/verify-routing-ipc.mjs
npm run grep:secrets
git diff --check
git diff --stat src/preload/index.ts
git ls-files --eol src/preload/index.ts
git status --short
```

Both `Select-String` lines must print nothing. The CDP drive is the runtime check (MR-G1, MR-G5): paste its full output and exit code; it must end `PASS (19 checks)`. It launches its own built app with a throwaway `--user-data-dir` and a free port, and stops only its own child by pid; never point it at `%APPDATA%\chorus*`, never at 9222, and never stop `electron.exe` or `Chorus.exe` by name (the installed Chorus is running). Dev never rebuilds MAIN on edit, so the drive tests the build: run `npx electron-vite build` after the last main-process edit. Record the vitest summary, `git diff --stat src/preload/index.ts` (one insertion), and that every pre-existing Table V test passed before Table V3 was written.
