# Implementation specification 2-4 — IPC, preload and app wiring

Paired [task](../Tasks/Task-2-4.md). Decisions: [roadmap](../roadmap.md) MR-D10; user decisions MR-D18, MR-D19; gates MR-G1, MR-G4, MR-G5; [overview](../Tasks/Phase-2-Overview.md) K7, K9, K10 and clarifications C11, C20, C22–C24. Builds on [ImplementationSpec-2-3](ImplementationSpec-2-3.md). **Not started.**

## Files and insertion points

Verified 2026-10-02 at `a9842a5`.

| File | Action |
|---|---|
| `src/shared/routing.ts` | Append the "Phase 2 — IPC" block below, after Task 2-3's block. Nothing above it changes. |
| `src/shared/routing.test.ts` | Append `describe('Table S5 — IPC contract')`. |
| `src/main/services/routingIpc.ts`, `routingIpc.test.ts` | New. Table I. Pattern: `teamIpc.ts:14–28` and its test's `electron` mock (`teamIpc.test.ts:2–4`). |
| `src/preload/index.ts` | `import type { RoutingApi } from '../shared/routing'` after the `TeamApi` import (:2); a `routing: { … } as RoutingApi,` block directly after the team block's `} as TeamApi,` (:159). No Zod (:137). |
| `src/preload/index.d.ts` | **No change.** It declares `chorus: ChorusApi` (:5) and `ChorusApi = typeof chorusApi` (`index.ts:919`), so the new block is typed automatically. |
| `src/main/index.ts` | Four imports; two module-scope `let`s beside `let fleet` (:149) and `let council` (:153); construction, registration and `start()` immediately after the `council = registerIpc(…)` call (:1356–1402) and before `watchSessionExits(sessions)` (:1403); `stop()` and `dispose()` as the first statements of the `before-quit` handler (:1510), before the Team-shutdown branch (:1511). `src/main/ipc.ts` is not edited (C22). |
| `scripts/verify-routing-ipc.mjs` | New. Zero-cost CDP drive of the built app. Pattern: `scripts/verify-team-packaged-ui.mjs:28–62`. |

## Normative contracts — `src/shared/routing.ts` (appended block)

```ts
// ── Phase 2 — IPC (Task 2-4) ──

export const ROUTING_CHANNELS = {
  models: 'routing:models',
  tiers: 'routing:tiers',
  refresh: 'routing:refresh',
  status: 'routing:status',
  settingsGet: 'routing:settings-get',
  settingsSet: 'routing:settings-set',
  observationGet: 'routing:observation-get',
  observationSet: 'routing:observation-set',
  progress: 'routing:progress' // main -> renderer broadcast only
} as const

export const routingEmptyRequestSchema = z.strictObject({})
export const routingSettingsSetRequestSchema = z.strictObject({ settings: routingSettingsSchema })

/** The Teams envelope (shared/team.ts:197) with routing's fixed codes. */
export type RoutingReply<T> = { ok: true; value: T } | { ok: false; code: RoutingErrorCode; message: string }

/** window.chorus.routing. Every input must be a plain object (JSON snapshot of reactive state; D14, MR-G5). */
export interface RoutingApi {
  models(input: Record<string, never>): Promise<RoutingReply<RoutingModelList>>
  tiers(input: RoutingTiersRequest): Promise<RoutingReply<TierResult>>
  refresh(input: RoutingRefreshRequest): Promise<RoutingReply<RoutingRefreshResult>>
  status(input: Record<string, never>): Promise<RoutingReply<RoutingStatus>>
  settingsGet(input: Record<string, never>): Promise<RoutingReply<RoutingSettings>>
  settingsSet(input: z.infer<typeof routingSettingsSetRequestSchema>): Promise<RoutingReply<RoutingSettings>>
  observationGet(input: Record<string, never>): Promise<RoutingReply<RoutingObservationSettings>>
  observationSet(input: RoutingObservationSettings): Promise<RoutingReply<RoutingObservationSettings>>
  onProgress(listener: (event: RoutingProgressEvent) => void): () => void
}
```

## `routingIpc.ts`

```ts
export interface RoutingIpcDeps {
  service: Pick<RoutingService,
    'models' | 'tiers' | 'refresh' | 'getSettings' | 'setSettings' | 'getObservation' | 'setObservation' | 'onProgress'>
  observer: Pick<RoutingObserver, 'status'>
  log?: RoutingLog // default: logger with the '[routing] ' prefix
}
/** Registered once, from index.ts. Validates every input and output in main (MR-G5). */
export function registerRoutingIpc(deps: RoutingIpcDeps): void
```

**Handler envelope (normative).** For each channel, `ipcMain.handle(channel, async (event, raw: unknown) => …)`:

1. `window = BrowserWindow.fromWebContents(event.sender)`. If `window` is null or destroyed, or `event.senderFrame !== event.sender.mainFrame`, return `{ ok: false, code: 'UNAUTHORIZED', message: 'Routing actions require an application window.' }` (the `teamIpc.ts:22` check). The service is not called.
2. `input.safeParse(raw)`; failure → `{ ok: false, code: 'INVALID_REQUEST', message: 'Invalid routing request.' }`. The service is not called.
3. `value = await action(parsed.data)`.
4. `output.safeParse(value)`; failure → log ``log.warn(`${channel} produced an invalid response (${issues.length} issues)`)`` (never the payload) and return `{ ok: false, code: 'OPERATION_FAILED', message: 'Routing operation failed.' }` (C23).
5. Return `{ ok: true, value: parsedOutput.data }`.
6. A thrown `RoutingError` → `{ ok: false, code: error.code, message: scrubSecrets(error.message) }`. Anything else → ``log.error(`${channel} failed`, error)`` and `{ ok: false, code: 'OPERATION_FAILED', message: 'Routing operation failed.' }`; the error's text never reaches the response.

**Channels.**

| Channel | Input schema | Output schema | Action |
|---|---|---|---|
| `routing:models` | `routingEmptyRequestSchema` | `routingModelListSchema` | `service.models()` |
| `routing:tiers` | `routingTiersRequestSchema` | `tierResultSchema` | `service.tiers(q)` |
| `routing:refresh` | `routingRefreshRequestSchema` | `routingRefreshResultSchema` | `service.refresh(q)` |
| `routing:status` | `routingEmptyRequestSchema` | `routingStatusSchema` | `observer.status()` |
| `routing:settings-get` | `routingEmptyRequestSchema` | `routingSettingsSchema` | `service.getSettings()` |
| `routing:settings-set` | `routingSettingsSetRequestSchema` | `routingSettingsSchema` | `service.setSettings(q.settings)` |
| `routing:observation-get` | `routingEmptyRequestSchema` | `routingObservationSettingsSchema` | `service.getObservation()` |
| `routing:observation-set` | `routingObservationSettingsSchema` | `routingObservationSettingsSchema` | `service.setObservation(q)` |

`routing:refresh` may take about 30 seconds while the probe runs; `invoke` has no timeout, and progress arrives on the broadcast.

**Broadcast.** `service.onProgress((event) => { … })`, following council's `emitProgress` (`ipc.ts:3503`): `routingProgressEventSchema.safeParse(event)`; failure → `log.warn('progress event did not validate; not sent')` and return; success → for every `BrowserWindow.getAllWindows()` that is not destroyed, `webContents.send(ROUTING_CHANNELS.progress, parsed.data)`. The listener never throws.

**What never crosses.** No response or event carries key material, a fingerprint, an envelope, a raw provider body or a header. Credential labels appear only inside fixed refusal messages, as elsewhere in the app.

## Preload block (`src/preload/index.ts`)

Inserted after `} as TeamApi,` (:159), in the team block's style; literal channel strings (the preload imports only the `RoutingApi` type from `shared/routing`, so no Zod schema is built in the preload):

```ts
  routing: {
    models: input => ipcRenderer.invoke('routing:models', input),
    tiers: input => ipcRenderer.invoke('routing:tiers', input),
    refresh: input => ipcRenderer.invoke('routing:refresh', input),
    status: input => ipcRenderer.invoke('routing:status', input),
    settingsGet: input => ipcRenderer.invoke('routing:settings-get', input),
    settingsSet: input => ipcRenderer.invoke('routing:settings-set', input),
    observationGet: input => ipcRenderer.invoke('routing:observation-get', input),
    observationSet: input => ipcRenderer.invoke('routing:observation-set', input),
    onProgress: listener => { const handler = (_event: IpcRendererEvent, value: Parameters<typeof listener>[0]) => listener(value); ipcRenderer.on('routing:progress', handler); return () => ipcRenderer.removeListener('routing:progress', handler) }
  } as RoutingApi,
```

## Wiring (`src/main/index.ts`)

```ts
// imports, beside the other service imports
import { RoutingService } from './services/routingService'
import { RoutingObserver } from './services/routingObserver'
import { RoutingStore } from './services/routingStore'
import { registerRoutingIpc } from './services/routingIpc'

// module scope, beside `let fleet` (:149) and `let council` (:153)
/** Model Routing Phase 2: module scope so 'before-quit' can stop the observer and abort in-flight requests. */
let routing: RoutingService | null = null
let routingObserver: RoutingObserver | null = null

// in whenReady, right after the `council = registerIpc(…)` call (:1356–1402), before watchSessionExits (:1403)
// Model Routing Phase 2 (MR-D18–MR-D20). The observer's tick is the one unattended decrypt of an
// api_key-class credential (MR-D18 class 2, to be mirrored as D214; see D60): dormant until the user
// designates a credential (MR-D19), first tick 2 minutes after start, one free GET per 30 minutes.
const routingStore = new RoutingStore(join(app.getPath('userData'), 'routing'))
routing = new RoutingService({ storage: store, vault, store: routingStore })
routingObserver = new RoutingObserver({ service: routing })
registerRoutingIpc({ service: routing, observer: routingObserver })
routingObserver.start()

// the first statements of app.on('before-quit', …) (:1510), before the Team-shutdown branch (:1511)
// Idempotent: this handler runs twice when a Team shutdown re-quits.
routingObserver?.stop()
routing?.dispose()
```

`store` is the non-null `StorageService` local (:595) and `vault` the `CredentialVault` (:809); both are in scope at :1403. Registering after `registerIpc` is safe because the window is created later (:1487). `registerIpc` gains no parameter (C22).

## `scripts/verify-routing-ipc.mjs`

Zero cost: no credential, no key, no OpenRouter request. Prerequisite: `npx electron-vite build` (the drive loads `out/`; dev never rebuilds MAIN on edit, and a stale build would test stale main code; C24).

1. **Header comment:** what it checks, that it spends nothing, and the prerequisite.
2. **Freshness.** `out/main/index.js` and `out/preload/index.js` exist; the main bundle's mtime is not older than the newest of `src/main/services/routing*.ts`, `src/shared/routing.ts`, `src/main/index.ts` and `src/preload/index.ts`; `out/main/index.js` contains `routing:refresh` and `out/preload/index.js` contains `routing:progress`. Otherwise print `FAIL build is stale: run npx electron-vite build` and exit 1.
3. **Launch** (`verify-team-packaged-ui.mjs:28–32`): pick a free port (`net` server on port 0, then close); `profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-routing-ipc-'))`; env = `process.env` without `ELECTRON_RUN_AS_NODE` and `ELECTRON_RENDERER_URL`; spawn `require('electron')` with `['.', --user-data-dir=<profile>, --remote-debugging-port=<port>, '--remote-debugging-address=127.0.0.1']`, `cwd` = repository root, `windowsHide: true`, output to `<profile>/app.log`.
4. **Connect** (`:39–62`): poll `http://127.0.0.1:<port>/json/list` for up to 60 s for a `page` whose URL contains `renderer/index.html`; open its `webSocketDebuggerUrl` with Node 22's global `WebSocket` (no `ws` dependency); a `cdp(method, params)` helper with a 30 s timeout; `evaluate(expression)` via `Runtime.evaluate` with `awaitPromise: true, returnByValue: true`, each expression an async IIFE returning plain JSON.
5. **Watchers.** Evaluate once: `window.__routingErrors = []` plus an `unhandledrejection` listener pushing `String(event.reason)`; `window.__routingEvents = 0` and `window.__routingUnsub = window.chorus.routing.onProgress(() => { window.__routingEvents++ })`.
6. **Checks** (below), each printed as `ok <name>` or `FAIL <name>: <detail>`. Every payload is an object literal written in the page.
7. **Shutdown.** Send CDP `Browser.close` without awaiting its reply (it never answers), wait up to 5 s for the child to exit, then `child.kill()`. Only this child is killed, by its own handle; never by process name.
8. **After exit:** check D16; delete `profile` (it holds no credential, but it is a throwaway).
9. Last line `PASS (n checks)` with exit code 0, or `FAIL (k of n checks)` with exit code 1.

The script holds a hand-written copy of `DEFAULT_ROUTING_SETTINGS` (from `src/shared/routing.ts:155`), as `verify-routing-ranker.mjs` holds its own expectations. `UUID0 = '00000000-0000-4000-8000-000000000000'` (a valid UUID that names no credential).

| # | Call (in the page) | Expect |
|---|---|---|
| D1 | `chorus.routing.models({})` | `ok`; `models` contains `{ slug: 'deepseek/deepseek-v4.1-flash', displayName: 'DeepSeek V4.1 Flash' }`. |
| D2 | `chorus.routing.status({})` | `ok`; observer `state: 'dormant'`, `dormantReason: 'undesignated'`, `nextTickAt` non-null, `lastTickAt` null; the model's `snapshotFetchedAt` null, `observations` 0, `cacheVerified` 0, `busy` false; `requestsSinceStart` 0. |
| D3 | `chorus.routing.settingsGet({})` | `ok`; deep-equals the defaults. |
| D4 | `settingsSet({ settings: { ...defaults, minUptimePct: 99.4 } })`, then `settingsGet({})`, then `settingsSet({ settings: defaults })` | `ok` with 99.4; reads back 99.4 (persisted through `storage.ts`); restored. |
| D5 | `settingsSet({ settings: { ...defaults, bogus: 1 } })`; `settingsSet({ settings: { ...defaults, readmitUptimePct: 99 } })`; `settingsSet(defaults)` (unwrapped) | `INVALID_REQUEST` each. |
| D6 | `observationGet({})` | `{ enabled: true, credentialProfileId: null }`. |
| D7 | `observationSet({ enabled: true, credentialProfileId: UUID0 })`, then `observationGet({})` | `CREDENTIAL_REFUSED`, message `The routing credential was not found.`; unchanged. |
| D8 | `observationSet({ enabled: false, credentialProfileId: null })`, `status({})`, then restore `{ enabled: true, credentialProfileId: null }` | `ok`; `dormantReason: 'disabled'`; restored. |
| D9 | `tiers({ model: 'deepseek/deepseek-v4.1-flash', profile: 'interactive', effort: 'low', credentialProfileId: null })` | `NO_SNAPSHOT`. |
| D10 | `tiers({ …, model: 'other/model' })`; `tiers({ …, profile: 'batch' })` | `UNKNOWN_MODEL`; `INVALID_REQUEST`. |
| D11 | `refresh({ model: 'deepseek/deepseek-v4.1-flash', credentialProfileId: UUID0, profile: 'interactive', effort: 'low' })` | `CREDENTIAL_REFUSED`; `window.__routingEvents` still 0. |
| D12 | `models('text')`; `status({ extra: 1 })` | `INVALID_REQUEST` both. |
| D13 | Negative control: `chorus.routing.status(new Proxy({}, {}))` inside `try`/`catch` | Rejects in the renderer with a message containing `could not be cloned` (the D14 failure this drive would catch); main is never reached. |
| D14 | `status({})` at the end | `requestsSinceStart` 0: no OpenRouter request was made during the drive. |
| D15 | `window.__routingErrors` | Empty. |
| D16 | After the app exits: `<profile>/routing` | Absent, or contains no `snapshot.json` anywhere. |
| D17 | Every response text collected above | Matches none of the patterns in `src/main/services/secret-patterns.json`. |

## Test cases

**Table I — `routingIpc.test.ts`.** `vi.mock('electron', …)` as `teamIpc.test.ts:4` does: `ipcMain.handle` stores handlers in a map; `BrowserWindow.fromWebContents` is a spy returning `{ isDestroyed: () => false }`; `getAllWindows` returns two fake windows (one destroyed) with `webContents.send` spies. `event = { sender: { id: 12, mainFrame: frame }, senderFrame: frame }`. `service` and `observer` are fakes with spies; the test imports only types from `./routingService` and `./routingObserver`. The golden `TierResult` is built with `computeTiers` from the Phase 1 golden input (the cores are pure). Every key-shaped string is built by concatenation.

| # | Case | Expect |
|---|---|---|
| I1 | `registerRoutingIpc` | Exactly the eight request channels of `ROUTING_CHANNELS` registered (not `routing:progress`); `service.onProgress` subscribed once. |
| I2 | Each channel with `senderFrame: {}`; with `fromWebContents` returning a destroyed window; returning `null` | `UNAUTHORIZED` each; no service or observer method called. |
| I3 | Each channel with an extra key, a wrong type, or a non-object | `INVALID_REQUEST`; nothing called. |
| I4 | Happy paths: `models`; `tiers` returning the golden `TierResult`; `refresh` returning a valid refresh result; `status`; both settings and both observation channels | `{ ok: true, value }` with `value` strictly equal to what the fake returned; each action received exactly the parsed input (`settings-set` passes `input.settings`). |
| I5 | Service throws `RoutingError('CREDENTIAL_REFUSED', 'x ' + FAKE_KEY)` | `{ ok: false, code: 'CREDENTIAL_REFUSED', message: 'x [redacted]' }`. |
| I6 | Service throws `new Error('boom ' + FAKE_KEY)` | `{ ok: false, code: 'OPERATION_FAILED', message: 'Routing operation failed.' }`; the response contains neither `boom` nor the key. |
| I7 | `tiers` returns the golden result plus an extra key | `OPERATION_FAILED`; the warn call names the channel and an issue count, not the payload. |
| I8 | Progress listener given a valid event; an invalid one | The valid event is sent once to the live window as `('routing:progress', parsed)`, not to the destroyed one; the invalid one is not sent, warns, and does not throw. |
| I9 | The text of `src/preload/index.ts` | Contains each request channel and `routing:progress` as a string literal and `as RoutingApi`; contains no `from 'zod'`. |
| I10 | Every `ok` response in I4 | `JSON.parse(JSON.stringify(r))` strictly equals `r`. |

**Table S5 — `src/shared/routing.test.ts`.**

| # | Case | Expect |
|---|---|---|
| S5-1 | `Object.values(ROUTING_CHANNELS)` | Nine unique values, each starting with `routing:`. |
| S5-2 | `routingEmptyRequestSchema` on `{}`, `{ a: 1 }`; `routingSettingsSetRequestSchema` on `{ settings: DEFAULT_ROUTING_SETTINGS }`, on `DEFAULT_ROUTING_SETTINGS` | Pass, fail; pass, fail. |

## Invariants

- Zod runs in main only. The preload is a pass-through with literal channel names and a type-only import.
- Every request is checked for the sender frame, then parsed, before any service call; every response is parsed before it is returned; every broadcast is parsed before it is sent (MR-G5).
- No response or event contains key material, fingerprints, envelopes, raw provider bodies or exception text; refusal messages pass `scrubSecrets`.
- The observer starts after the app is ready and stops, with in-flight routing requests aborted, as soon as quitting begins.
- `src/main/ipc.ts` and `src/preload/index.d.ts` are unchanged.

## Verification

```powershell
npm run typecheck
npx vitest run src/main/services/routingIpc.test.ts src/shared/routing.test.ts
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
Get-ChildItem -Path src/main/routing -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern "from '\.\./(services|db|adapters)/"
node scripts/verify-routing-ranker.mjs
npx electron-vite build
node scripts/verify-routing-ipc.mjs
npm run grep:secrets
git diff --check
git status --short
```

Both `Select-String` lines must print nothing. The CDP drive is the runtime check (MR-G1, MR-G5): paste its full output and exit code. It must not be pointed at the user's real profile or at an already-running instance; it launches its own. For an ad-hoc drive of `npm run dev` instead, use `$env:REMOTE_DEBUGGING_PORT='9333'` and a throwaway `--user-data-dir` (9222 only in the main checkout and only if `/json/version` shows it is free), and relaunch after any main-process edit.
