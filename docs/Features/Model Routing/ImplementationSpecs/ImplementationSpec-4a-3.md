# Implementation specification 4a-3 — Launch wiring, migration v28 and relaunch

Paired [task](../Tasks/Task-4a-3.md). Decisions: [roadmap](../roadmap.md) MR-D3, MR-D4, MR-D10, MR-D18–MR-D20; user decisions MR-D25–MR-D28; gates MR-G1, MR-G2, MR-G4–MR-G6; [overview](../Tasks/Phase-4a-Overview.md) K2–K13 and clarifications C16–C22. Builds on [ImplementationSpec-4a-1](ImplementationSpec-4a-1.md) and [ImplementationSpec-4a-2](ImplementationSpec-4a-2.md). **Not started.**

## Files and insertion points

Verified 2026-10-03 at `a57ef1b`.

| File | Action |
|---|---|
| `src/main/services/storage.ts` (CRLF) | The v27 entry's last line (:1080) gains a trailing comma; the v28 entry follows it, before `]` (:1081). In `createSession` (:1790–1829) the `memoryShellFirst` line (:1827) gains a comma and the `routingJson` normalisation follows it. Nothing else. |
| `src/main/db/schema.ts` (mixed; the `sessions` block is CRLF) | `memoryShellFirst` (:179) gains a comma; the `routingJson` column follows it, before `})` (:180). |
| `src/main/db/schema.test.ts` (CRLF) | The count pin (:134–141): title and `toHaveLength(19)` → 20. Append `describe('sessions.routing_json (v28, Model Routing Phase 4a / MR-D27)')` at the end (after :313). |
| `src/shared/ipc.ts` (CRLF) | `import { routingLaunchTierSchema } from './routing'` after the `./uiZoom` import (:4–9). In `launchRequestSchema` (:1296–1390) the `routing_tier` field after `model` (:1374), before the `name` comment (:1375). |
| `src/shared/ipc.test.ts` (CRLF) | One `it(…)` at the end of `describe('launchRequestSchema')`, before its closing `})` (:302). |
| `src/main/services/sessionManager.ts` (mixed; :165–269 and :1017–1049 are CRLF) | `type PtyLaunchRouting` in the `../adapters/types` import (:6–17); `LaunchOptions.routing` after `mcpServers` (:205); `routing: opts.routing,` after `mcpServers: opts.mcpServers,` (:1043). |
| `src/main/services/sessionManager.routing.test.ts` | New (LF), Table SM. Pattern: `sessionManager.team.test.ts` (mocks `node-pty` and `../adapters/registry`). |
| `src/main/ipc.ts` (CRLF) | Imports (:3–4, :294, :310, :313, :316, :378); the parameter after `fleet` (:719); `cliStateFor`, `readRoutingLists`, `catalogEffortsFor` and `launchConfigContent` after `resolveCredential` (:1355–1458); `withMcpEnv` (:970–974, :990–1002, :1151–1159); SessionLaunch (:1897–1962, :2051–2061, :2090, :2126–2136, :2144, :2157–2167, :2174); SessionRelaunch (:3347–3371). |
| `src/main/index.ts` (CRLF) | Three lines (one comment pair and the thunk) after `fleet,` (:1407), before `teamRuntime` (:1408). |
| `scripts/verify-routing-ipc.mjs` (LF; owned by Task 4a-1) | Header (:1–25) one sentence; freshness `sources` (:93–99) gains two files; D16 (:499–509) gains the migration check. No new check: the count stays 20 (C18). |

`teamRuntime.ts:183` and `storage.ts:3702` call `createSession` without `routingJson` and are unchanged: an omitted optional column writes NULL. `launchOptionsCore.ts`, restore (`sessionManager.ts:669–677`) and SessionRestart (`ipc.ts:2271`) are unchanged.

## Recorded amendments

| Amendment | Test or script that changes with it |
|---|---|
| `sessions` gains a twentieth column, `routing_json` | `schema.test.ts:134–141`: "pins the `sessions` column count at 19" → 20 (`toHaveLength(19)` → `toHaveLength(20)`), with the comment "19 at a57ef1b, plus v28's routing_json". |
| `verify-routing-ipc.mjs` D16 also proves v28 in the throwaway database; its freshness list gains `storage.ts` and `ipc.ts` (C18) | D16's detail only; the drive still ends `PASS (20 checks)`. |

## `storage.ts` — migration v28 (MR-D27, MR-G6)

```ts
  ); CREATE INDEX idx_team_member_profiles_credential ON team_member_profiles(credential_profile_id);`,
  // v28 (Model Routing Phase 4a / MR-D27): the routing selection a session
  // launched with — a RoutingLaunchSelection (shared/routing.ts) as strict JSON,
  // written on the SAME insert as the row and read back only by session:relaunch
  // (K10), which re-applies it unchanged. NULL means "launched unrouted"
  // (OpenRouter default, or not routing-eligible), which is also the truth for
  // every pre-v28 row: no backfill. Nullable, no default, no FK, no index (it is
  // read by primary key on a row already fetched).
  //
  // ⚠ THE VERSION WAS COMPUTED, NOT COPIED (MR-G6, 2026-10-03): 27 entries on
  // this branch, `main` and `origin/main`; no other local branch past v27; the
  // installed DB (read from a COPY with -wal and -shm) reported MAX(version)=27.
  `ALTER TABLE sessions ADD COLUMN routing_json TEXT;`
]
```

The first line shown is the existing v27 line (:1080) with its new trailing comma; `]` is the existing :1081. The statement is one line, so the schema.test.ts slicing finds it.

**`createSession`** (:1827):

```ts
      memoryShellFirst: row.memoryShellFirst ?? 0,
      // v28: normalised for the reason every line above it is — the returned row
      // must match a re-read. A session launched without routing has none.
      routingJson: row.routingJson ?? null
```

## `schema.ts`

```ts
  memoryShellFirst: integer('memory_shell_first').notNull().default(0),
  // v28 (Model Routing Phase 4a / MR-D27): the RoutingLaunchSelection this session
  // launched with, as strict JSON; NULL = launched unrouted. Read only by
  // session:relaunch (K10). Never sent to the renderer (sessionInfoSchema strips it).
  routingJson: text('routing_json')
})
```

`SessionRow` gains `routingJson: string | null` and `NewSessionRow` gains `routingJson?: string | null` by inference (:209–210).

## `src/shared/ipc.ts`

```ts
import { routingLaunchTierSchema } from './routing' // after the ./uiZoom import (:4–9)

  // in launchRequestSchema, after `model` (:1374)
  /**
   * Model Routing Phase 4a (K2): the routing tier for THIS launch. Absent means
   * OpenRouter default — today's launch, byte-identical. Only a tier NAME crosses
   * the bridge: main checks eligibility (K3) and resolves what the tier means
   * itself (`RoutingService.resolveLaunch`), and a tier on an ineligible launch is
   * refused with a stated reason, never ignored.
   */
  routing_tier: routingLaunchTierSchema.optional(),
```

`src/shared/routing.ts` imports only `zod` (:1), so this import brings no Node module into the renderer or the preload; the preload's existing value import of `IpcChannel` from `shared/ipc` now also constructs routing's schemas there, and nothing parses in the preload (Zod compiles on the first `.parse()`, never at construction).

## `sessionManager.ts`

```ts
// LaunchOptions, after mcpServers (:205)
  /**
   * Model Routing Phase 4a (MR-D3, K6, K13): the per-process config for an adapter
   * that carries one (opencode's OPENCODE_CONFIG_CONTENT), composed by ipc.ts: a
   * routed session's content, or an unrouted `:nitro` launch's variant declaration.
   * NON-SECRET. Absent for every other launch, and always for restore and
   * session:restart, which never route.
   */
  readonly routing?: PtyLaunchRouting

// the buildLaunch call, after `mcpServers: opts.mcpServers,` (:1043)
      // Model Routing Phase 4a: straight through, like mcpServers. Only opencode reads it.
      routing: opts.routing,
```

`composeChildEnv`'s merge (:1073–1075) is unchanged: a profile env still beats the adapter's additions, which is why main refuses a routed launch whose profile sets `OPENCODE_CONFIG_CONTENT` (K7) instead of relying on precedence.

## `src/main/index.ts`

After `fleet,` (:1407):

```ts
    // Model Routing Phase 4a: a THUNK, because `routing` is constructed below this
    // call and reset to null if routing fails to start (K2; the hasManagementKey precedent).
    () => routing,
```

## `src/main/ipc.ts`

**Imports** (added to existing lines where one exists):

```ts
import os from 'node:os' // after `import path from 'node:path'` (:4)
import { composeChildEnv, resolveEnvVarName } from './adapters/env' // :310
import type { AgentAdapter, McpWriteContext, PtyLaunchRoute, ResolvedCredential } from './adapters/types' // :313
import { isPtyAdapter, supportsHooks } from './adapters/types' // :316
import { opencodeStateHome } from './adapters/opencodeVariantStateCore'
import {
  buildOpenCodeRoutingContent,
  checkRoutedRoute,
  planRoutingLaunch,
  planRoutingRelaunch,
  routingVariantEfforts,
  unroutedNitroVariantsContent
} from './routing/launchCore'
import { RoutingError, type RoutingService } from './services/routingService'
import { ROUTING_NITRO_SUFFIX, routingBaseModelId, type RoutingLaunchSelection } from '../shared/routing'
```

`detectClis` (:294), `OPENROUTER_GATEWAY_BASE_URL` (:378) and `decodeReasoningEfforts` (:338) are already imported. `routingService.ts` imports `storage.ts` and `vault.ts` as types only, so the value import adds no cycle.

**Parameter** (after `fleet: FleetRegistry,` :719, before `teamRuntime?: TeamRuntime` :720; C20):

```ts
  /**
   * Model Routing Phase 4a: how session:launch and session:relaunch reach the
   * routing service (K2). A THUNK, on the hasManagementKey precedent, because
   * index.ts constructs the service after this function runs and resets it to
   * null when routing fails to start. Read once per handler call.
   */
  routing: () => RoutingService | null,
```

**Helpers** (after `resolveCredential`, :1355–1458):

```ts
  /**
   * MR-D25 (C17): McpWriteContext.cliState for this launch — the state root an
   * opencode child resolves from the environment it WILL receive, and the
   * version detection last recorded. composeChildEnv is the one env policy; the
   * credential's NAME selects its allow-list branch, and no key value is needed
   * to know where the child keeps its state.
   */
  async function cliStateFor(
    opts: LaunchOptions,
    agent: string,
    adapter: AgentAdapter | null
  ): Promise<NonNullable<McpWriteContext['cliState']>> {
    const childEnv = composeChildEnv({
      parentEnv: process.env,
      requiredEnvVars: adapter && isPtyAdapter(adapter) ? adapter.requiredEnvVars : [],
      envAdditions: opts.envAdditions ?? {},
      secretEnv: opts.credential ? { [opts.credential.envVarName]: '' } : {}
    })
    let installedVersion: string | null = null
    try {
      installedVersion = (await detectClis()).find((d) => d.name === agent)?.version ?? null
    } catch {
      // Unknown version: the state write is skipped (it is gated to the verified version).
    }
    return { stateHome: opencodeStateHome(childEnv, os.homedir()), installedVersion }
  }

  /** K3: the two lists routing eligibility reads, or null when routing is unavailable. Never decrypts. */
  function readRoutingLists(service: RoutingService | null): { credentialIds: string[]; registrySlugs: string[] } | null {
    if (service === null) return null
    try {
      return {
        credentialIds: service.credentials().credentials.map((c) => c.id),
        registrySlugs: service.models().models.map((m) => m.slug)
      }
    } catch (err) {
      logger.warn(`[launch] model routing is unavailable for this launch: ${scrubSecrets(err instanceof Error ? err.message : String(err))}`)
      return null
    }
  }

  /** C22: a base slug's reasoning efforts from the credential provider's catalog row, or null when none is stored. */
  function catalogEffortsFor(providerId: string | null, slug: string): readonly string[] | null {
    if (providerId === null) return null
    const row = storage.getModelCatalogForProvider(providerId).find((r) => r.modelId === slug)
    return row ? decodeReasoningEfforts(row.reasoningEfforts) : null
  }

  /**
   * K6, K13 (C22): the OPENCODE_CONFIG_CONTENT a credentialed launch carries, or null.
   * A routed selection's content (Nitro declares the base slug's catalog efforts,
   * else the launch's own; ranked tiers declare none). Otherwise, for an UNROUTED
   * launch whose sent id ends in `:nitro` (MR-D4), only that id's variants — no
   * provider object, never persisted. Any other launch: null, and no catalog read.
   */
  function launchConfigContent(input: {
    agent: string
    selection: RoutingLaunchSelection | null
    route: PtyLaunchRoute | null
    providerId: string | null
    launchEffort: string | null
    profileEnvKeys: readonly string[]
  }): string | null {
    const { agent, selection, route, providerId, launchEffort, profileEnvKeys } = input
    if (selection !== null) {
      const efforts = selection.tier === 'nitro' ? routingVariantEfforts(catalogEffortsFor(providerId, selection.model), launchEffort) : []
      return buildOpenCodeRoutingContent(selection, efforts)
    }
    const sentModelId = route?.modelId ?? null
    if (sentModelId === null || !sentModelId.endsWith(ROUTING_NITRO_SUFFIX)) return null
    return unroutedNitroVariantsContent({
      agent,
      baseUrl: route?.baseUrl ?? null,
      gatewayBaseUrl: OPENROUTER_GATEWAY_BASE_URL,
      sentModelId,
      launchEffort,
      catalogEfforts: catalogEffortsFor(providerId, routingBaseModelId(sentModelId)),
      profileEnvKeys
    })
  }
```

**`withMcpEnv`** — after `agentDefaults` (:970–974):

```ts
    // MR-D25 (Model Routing Phase 4a): keep opencode's remembered variant in step
    // with this effort — only for a launch that writes one (C17).
    const cliState = agentDefaults.modelEffort === null ? undefined : await cliStateFor(opts, agent, adapter)
```

and both `wireMcpForLaunch` contexts (:991–1002 and :1152–1159) gain `...(cliState ? { cliState } : {})` after `agentDefaults`. Every return of `withMcpEnv` spreads `opts` (`return opts` :989, `mergeWiringEnv` :1010 and :1197 via `{ ...base, … }` :1243, `{ ...opts, instructions }` :1174, `{ ...withInstructions, mcpServers }` :1182), so `opts.routing` survives it unchanged; `mergeWiringEnv` touches only `envAdditions`.

### SessionLaunch (C16)

**1. Plan and resolve, before the decrypt** — between `composeLaunchOptions(…)` (:1897–1909) and `let launchOpts: LaunchOptions = baseLaunchOpts` (:1910):

```ts
    // Model Routing Phase 4a (K2, K3, K7, MR-D26): this launch's routing, decided
    // BEFORE the decrypt and before any row exists, so a refusal leaves nothing
    // behind. Main resolves the tier itself; the renderer sent only its name.
    const routingService = routing()
    const routingCredential = credentialProfileId ? storage.getCredentialProfileById(credentialProfileId) : null
    const routingProvider = routingCredential ? storage.getProviderConfigById(routingCredential.providerId) : null
    const routingLists = req.agent === 'opencode' ? readRoutingLists(routingService) : null
    const routingPlan = planRoutingLaunch({
      agent: req.agent,
      tier: req.routing_tier ?? null,
      credentialProfileId,
      model: req.model ?? profileModel ?? routingProvider?.model ?? null,
      routingAvailable: routingLists !== null,
      routingCredentialIds: routingLists?.credentialIds ?? [],
      registrySlugs: routingLists?.registrySlugs ?? [],
      profileEnvKeys: Object.keys(profileEnv)
    })
    if (routingPlan.kind === 'refused') return { ok: false, reason: routingPlan.reason }
    let routingSelection: RoutingLaunchSelection | null = null
    if (routingPlan.kind === 'routed' && routingService !== null) {
      try {
        routingSelection = routingService.resolveLaunch({
          model: routingPlan.model,
          tier: routingPlan.tier,
          effort: baseLaunchOpts.modelEffort ?? null, // K4: the launch's own effort
          credentialProfileId: routingPlan.credentialProfileId
        })
      } catch (err) {
        return { ok: false, reason: err instanceof RoutingError ? err.message : 'Routing operation failed.' }
      }
    }
```

**2. The gateway check, after the decrypt and before any key is minted** — immediately after `if (!resolved.ok) return { ok: false, reason: resolved.reason }` (:1920), before `mint = await attribution.mintForDispatch(…)` (:1925):

```ts
      // Phase 4a: a routed launch must reach the OpenRouter gateway. The envelope
      // may name its own base URL, so this can only be known after the decrypt —
      // and it is checked before attribution mints a key for a launch that would not happen.
      if (routingSelection !== null) {
        const gateway = checkRoutedRoute(resolved.route?.baseUrl ?? null, routingCredential?.label ?? '', OPENROUTER_GATEWAY_BASE_URL)
        if (!gateway.ok) return { ok: false, reason: gateway.reason }
      }
```

**3. The route and the options** — `chosenModel`/`route` (:1949–1953) and `launchOpts` (:1957–1962) become:

```ts
      const chosenModel = req.model ?? profileModel
      const baseRoute =
        resolved.route && chosenModel
          ? { ...resolved.route, modelId: chosenModel }
          : resolved.route
      // K6: on a routed launch `-m`, D179's agent.build.model and MR-D25's state
      // key must all name the SENT id (…:nitro for Nitro), or the variant does not apply.
      const route =
        routingSelection !== null && baseRoute
          ? { ...baseRoute, modelId: routingSelection.sentModelId }
          : baseRoute
      // K6 / K13: a routed selection's content, or an unrouted `:nitro` launch's variants.
      const configContent = launchConfigContent({
        agent: req.agent,
        selection: routingSelection,
        route,
        providerId: routingProvider?.id ?? null,
        launchEffort: baseLaunchOpts.modelEffort ?? null,
        profileEnvKeys: Object.keys(profileEnv)
      })
      launchOpts = {
        ...baseLaunchOpts,
        secrets: [credential.value],
        credential,
        ...(route ? { route } : {}),
        ...(configContent !== null ? { routing: { configContent } } : {})
      }
```

A routed plan always has a credential (`planRoutingLaunch` refuses otherwise), so the credentialed branch is the only place a selection is applied. **K13** also lives only here: an unrouted `:nitro` model reaches a launch only through a credentialed OpenRouter route (an uncredentialed launch has no route, `launchOptionsCore.ts:53`), and a `:nitro` id is never routing-eligible (`planRoutingLaunch`'s `nitroModel`), so its plan is `'unrouted'` with no tier, or `'refused'` with one.

**C21 — `launchModelId` becomes the sent id.** `launchModelId(opts)` (`sessionManager.ts:276–278`) is `opts.route?.modelId ?? null`. It feeds the `:AgentSession` MERGE (`ipc.ts:1059`) and the memory contract's `modelId` (:1109) in `withMcpEnv`, and `SessionStartInfo.model` (`sessionManager.ts:1369`), from which the dispatch row records its model. Because step 3 sets `route.modelId = selection.sentModelId`, a routed launch records the id OpenCode actually sends — the base slug for Budget, Balanced and Fast, `<slug>:nitro` for Nitro. That is accurate, and nothing else reads it; unrouted launches (K13 ones included, whose route already names their `:nitro` id) are unchanged.

**4. Persist and record** — after `sessionProfilePointer` (:1999–2000):

```ts
    /** MR-D27: what this session launched with, on the SAME insert as the row. */
    const routingJson = routingSelection === null ? null : JSON.stringify(routingSelection)
    /** K8 / MR-D28: remember an eligible launch's choice, AFTER it started. Never throws. */
    const recordRoutingChoice = (): void => {
      if (routingPlan.kind === 'routed') routingService?.recordLaunchChoice(routingPlan.model, routingPlan.tier)
      else if (routingPlan.kind === 'default') routingService?.recordLaunchChoice(routingPlan.model, 'default')
    }
```

Each `storage.createSession({ … })` (:2051, :2126, :2157) gains `routingJson,` after `launchProfileId: sessionProfilePointer,`; each branch calls `recordRoutingChoice()` immediately after its `linkAttribution(row.id)` (:2090, :2144, :2174). A `sessions.launch` that throws leaves the handler before the call, so nothing is recorded for a launch that did not start.

Rules (normative):

- **Order.** Parse → project, cwd, Team, pane cap → profile + credential refusal → `apiKey` refusal → profile resolution → `composeLaunchOptions` → **routing plan and `resolveLaunch`** → `resolveCredential` → **gateway check** → `mintForDispatch` → route and options → rows → `withMcpEnv` → `sessions.launch` → `linkAttribution` → **`recordRoutingChoice`**.
- **Refusal texts** are `ROUTING_LAUNCH_REFUSALS` (ImplementationSpec-4a-1), a `RoutingError`'s message verbatim (`NO_SNAPSHOT`, `SNAPSHOT_STALE`, `TIER_EMPTY`, `UNKNOWN_MODEL`, `INVALID_TIME`, `Routing has stopped.`, `Routing operation failed.`), or `checkRoutedRoute`'s; nothing else is invented here.
- **Unrouted launches are unchanged, with one exception (K13).** For `'unrouted'` and `'default'` plans no option, route or row value differs from today's (`routingJson` NULL); `'default'` only adds the record. The exception: a credentialed `opencode` launch on the OpenRouter gateway whose sent id ends in `:nitro` and that carries a model effort gets `routing.configContent` declaring that id's variants (ImplementationSpec-4a-1 L17/L18), with no provider object, no `routing_json` and no record. Without an effort, or when the profile env sets its own `OPENCODE_CONFIG_CONTENT`, it is unchanged. MR-D25 then keeps OpenCode's remembered variant for that `:nitro` key in step, because `agentDefaults.modelId` is the route's `:nitro` id.
- **Recording (K8, C8).** Only `'routed'` (the tier) and `'default'` plans record. A K7-blocked launch (profile env sets `OPENCODE_CONFIG_CONTENT`) is `'refused'` with a tier and `'unrouted'` without one, so it records nothing.
- **Multi-slot batches** (LaunchDialog's sequential slots) are N independent `session:launch` calls: each plans, resolves and records on its own; main keeps no batch state, and a refused slot stops the batch in the renderer exactly as any other refusal does.

### SessionRelaunch (K10, C19)

Between `if (!resolution.ok) …` (:3347–3349) and `const baseOpts = composeLaunchOptions(resolution.plan)` (:3356) nothing changes; after `baseOpts` (:3356):

```ts
    // Model Routing Phase 4a (K10): a routed session relaunches with its persisted
    // selection, unchanged — never re-ranked, never silently unrouted.
    // An unrouted row never reads routing at all.
    const relaunchLists = row.routingJson === null ? null : readRoutingLists(routing())
    const relaunchPlan = planRoutingRelaunch({
      agent: row.agent,
      routingJson: row.routingJson,
      credentialProfileId: resolution.plan.credentialProfileId,
      routingAvailable: relaunchLists !== null,
      routingCredentialIds: relaunchLists?.credentialIds ?? [],
      profileEnvKeys: Object.keys(resolution.plan.envAdditions)
    })
    if (relaunchPlan.kind === 'refused') return relaunchResponseSchema.parse({ ok: false, reason: relaunchPlan.reason })
```

Inside `if (resolution.plan.credentialProfileId)` (:3358), after `if (!resolved.ok) …` (:3364), and the `opts` literal (:3365–3370):

```ts
      const relaunchSelection = relaunchPlan.kind === 'routed' ? relaunchPlan.selection : null
      const relaunchCredential = storage.getCredentialProfileById(resolution.plan.credentialProfileId)
      if (relaunchSelection !== null) {
        const gateway = checkRoutedRoute(resolved.route?.baseUrl ?? null, relaunchCredential?.label ?? '', OPENROUTER_GATEWAY_BASE_URL)
        if (!gateway.ok) return relaunchResponseSchema.parse({ ok: false, reason: gateway.reason })
      }
      const route =
        relaunchSelection !== null && resolved.route
          ? { ...resolved.route, modelId: relaunchSelection.sentModelId }
          : resolved.route
      // K10 / K13: the persisted selection's content, or — for an unrouted row whose
      // route (provider.model, as today) is a `:nitro` id — that id's variants.
      const configContent = launchConfigContent({
        agent: row.agent,
        selection: relaunchSelection,
        route,
        providerId: relaunchCredential?.providerId ?? null,
        launchEffort: baseOpts.modelEffort ?? null,
        profileEnvKeys: Object.keys(resolution.plan.envAdditions)
      })
      opts = {
        ...baseOpts,
        secrets: [resolved.credential.value],
        credential: resolved.credential,
        ...(route ? { route } : {}),
        ...(configContent !== null ? { routing: { configContent } } : {})
      }
```

Rules (normative):

- A row with `routing_json` NULL relaunches exactly as today (the plan is `'unrouted'` without reading routing at all), except for K13 below.
- A routed row always has a credential (the plan refuses one without), so the selection is only applied in the credentialed branch. Relaunch updates no `routing_json` and records no launch choice (C19): the memory reflects dialog choices, and the row keeps what the session first launched with.
- The relaunch's effort is the profile's (`composeLaunchOptions(resolution.plan)`, unchanged), so Nitro's fallback variant is the profile's effort.
- **K13 on relaunch** is recomputed, never stored: an unrouted row whose relaunch route names a `:nitro` id (relaunch keeps `provider.model`, the pre-existing behaviour) and whose profile carries an effort gets that id's variants, exactly as a launch would; `routing_json` stays NULL.

## `scripts/verify-routing-ipc.mjs` (MR-G6; C18)

- Header (:1–25): add "D16 also proves migration v28 applied in the throwaway profile's own chorus.db (MR-G6; ImplementationSpec-4a-3)."
- Freshness `sources` (:93–99): add `path.join(ROOT, 'src', 'main', 'services', 'storage.ts')` and `path.join(ROOT, 'src', 'main', 'ipc.ts')`, so a build older than the migration is refused.
- Before section 8 (:499):

```js
/** MR-G6 (Task 4a-3): v28 applied in the throwaway profile's OWN database. Read after the app exited. */
async function migrationDetail(dbPath) {
  let db = null
  try {
    const { DatabaseSync } = await import('node:sqlite') // Node 22's built-in, as src/main/db/schema.test.ts uses
    db = new DatabaseSync(dbPath)
    if (!db.prepare('SELECT version FROM schema_migrations WHERE version = 28').get()) return 'schema_migrations has no version 28'
    const column = db.prepare('PRAGMA table_info(sessions)').all().find((c) => c.name === 'routing_json')
    if (!column) return 'sessions has no routing_json column'
    if (column.type !== 'TEXT' || column.notnull !== 0 || column.dflt_value !== null) return `routing_json is ${JSON.stringify(column)}`
    return null
  } catch (err) {
    return `could not read chorus.db: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    db?.close()
  }
}
```

- D16 (:505–508) becomes `record('D16 throwaway DB, no snapshot file', first(existsDetail, await migrationDetail(path.join(profile, 'chorus.db')), snapshotDetail))`, where `existsDetail` and `snapshotDetail` are the two existing expressions; the database is opened in place (it is throwaway; opening it read-write replays a WAL the app left) and closed before `deleteProfile()`.

## Test cases

**schema.test.ts — the v28 block** (`migrationsSource()` as defined at :29–36).

| # | Case | Expect |
|---|---|---|
| M1 | `sessions.routingJson.name`; the DDL | `'routing_json'`; `migrationsSource()` contains `` `ALTER TABLE sessions ADD COLUMN routing_json TEXT;` `` (with its backticks: one entry). |
| M2 | `sessions.routingJson.notNull`, `.hasDefault` | `false`, `false`. |
| M3 | `ADD COLUMN routing_json` occurrences; its line; its position | Exactly 1; the line matches none of `/NOT NULL/i`, `/DEFAULT/i`, `/REFERENCES/i`; no `CREATE INDEX` mentions `routing_json`; its index in the source is greater than that of `CREATE TABLE team_member_profiles` (the last entry). |
| M4 | The statement sliced from the source (as the v24 test does, :282–287), applied to an in-memory `node:sqlite` database holding `CREATE TABLE sessions (id TEXT PRIMARY KEY, agent TEXT NOT NULL, launch_profile_id TEXT)` and the row `('pre-v28', 'opencode', 'lp-1')`; then insert `('routed', 'opencode', 'lp-1', S)` with `S = JSON.stringify(<ImplementationSpec-4a-1's NITRO_SELECTION>)` | The pre-existing row's `routing_json` is `null` (and `not.toBe('')`); its other columns unchanged; the inserted row's `routing_json` strictly equals `S`. |
| M5 | `storage.ts` source | Contains `routingJson: row.routingJson ?? null` inside `createSession` (the slice from `createSession(row: NewSessionRow)` to `getSessionsForProject(`). |
| count (amended) | `Object.keys(getTableColumns(sessions))` | Length 20 (was 19) and contains `routingJson`. |

**ipc.test.ts — `launchRequestSchema`.**

| # | Case | Expect |
|---|---|---|
| W1 | `base = { project_id: PID, agent: 'opencode', cwd: 'C:\\Projects', workspace_mode: 'current-tree' }`: parse `base`; `{ ...base, routing_tier: t }` for `budget`, `balanced`, `fast`, `nitro`; `routing_tier` = `'default'`, `'turbo'`, `''`, `7`, `null` | `routing_tier` undefined; each parses to itself (`toEqual`); each of the five fails. |

**Table SM — `sessionManager.routing.test.ts`** (mocks: `node-pty` `spawn: vi.fn()` returning a fake child as `sessionManager.team.test.ts` does; `../adapters/registry` `getAdapterOrThrow` returning an `opencode`-shaped PTY adapter whose `buildLaunch(spec)` pushes `spec` to a hoisted array and returns `{ executable: 'fixture.exe', args: [], cwd: spec.cwd, envAdditions: spec.routing ? { OPENCODE_CONFIG_CONTENT: spec.routing.configContent } : {}, secretEnv: {} }`. Every launch passes `launchSecretEnv: { FIXTURE_SECRET: 'fixture' }`, so `composeChildEnv` takes its allow-list branch and the ambient environment cannot leak in. `X = '{"provider":{"openrouter":{"models":{}}}}'`.)

| # | Case | Expect |
|---|---|---|
| SM1 | `launch('opencode', 'C:\\fixture', 'routed', { routing: { configContent: X }, launchSecretEnv })` | The captured spec's `routing` strictly equals `{ configContent: X }`; `pty.spawn`'s `env.OPENCODE_CONFIG_CONTENT === X`. |
| SM2 | The same without `routing` | The captured spec has no `routing` (`undefined`); `env` has no `OPENCODE_CONFIG_CONTENT`. |
| SM3 | `{ routing: { configContent: X }, envAdditions: { OPENCODE_CONFIG_CONTENT: 'profile' }, launchSecretEnv }` | `env.OPENCODE_CONFIG_CONTENT === 'profile'`: a profile's env beats the adapter's additions here, which is why main refuses this launch (K7). |
| SM4 | `launch('opencode', 'C:\\fixture', 'restored')` with no options | The captured spec has no `routing`. |

SessionLaunch and SessionRelaunch have no unit test (there is no `src/main/ipc.test.ts`); every rule they apply is a pure function covered by ImplementationSpec-4a-1 Tables L and V4 (K13: L17 and L18), OpenCode's reaction to K13's content is proven by `verify-routing-body.mjs` check 16 (ImplementationSpec-4a-2), and the built app is driven end to end by Task 4a-5.

## Invariants

- A launch with no `routing_tier` that is not routing-eligible is byte-identical to today's — options, argv, env, row (NULL `routing_json`) and nothing recorded — except that an `opencode` launch on the gateway whose sent id ends in `:nitro` and carries an effort also declares that id's variants (K13; no provider object, never persisted).
- No routed launch decrypts before its plan and resolution pass, creates a row before they pass, or mints a key before its gateway check passes (D33).
- A routed launch's `-m`, `agent.build.model`, remembered-variant key and `routing_json.sentModelId` are one string; its `OPENCODE_CONFIG_CONTENT` travels only in the child's environment (MR-D3).
- `routing_json` is written only on the launch insert, read only by relaunch, never sent to the renderer, and always parses with the strict selection schema (it is the service's parsed output, stringified).
- Relaunch never re-ranks and never silently drops routing (K10). Restart and restore never route.
- No key value enters `cliStateFor`, a refusal message, a log line or `routing_json` (MR-G4).

## Verification

```powershell
npm run typecheck
npx vitest run src/main/db/schema.test.ts src/shared/ipc.test.ts src/main/services/sessionManager.routing.test.ts src/main/services/sessionManager.team.test.ts src/main/routing/launchCore.test.ts src/main/services/routingService.test.ts
npm test
node scripts/verify-routing-ranker.mjs
npx electron-vite build
node scripts/verify-routing-ipc.mjs
node scripts/verify-routing-body.mjs
npm run grep:secrets
git diff --check
git diff --stat -- src/main/services/storage.ts src/main/db/schema.ts src/main/db/schema.test.ts src/shared/ipc.ts src/shared/ipc.test.ts src/main/ipc.ts src/main/index.ts src/main/services/sessionManager.ts
git ls-files --eol -- src/main/services/storage.ts src/main/db/schema.ts src/main/db/schema.test.ts src/shared/ipc.ts src/shared/ipc.test.ts src/main/ipc.ts src/main/index.ts src/main/services/sessionManager.ts
git status --short
```

Runtime checks (MR-G1): the IPC drive must end `PASS (20 checks)` with D16 proving version 28 and the nullable `TEXT` `routing_json` column in the throwaway profile's own `chorus.db` (MR-G6: a fresh profile runs every migration, so a version claimed elsewhere cannot hide a no-op); the body script must end `PASS (16 checks)` (MR-G2). Run `npx electron-vite build` after the last main-process edit (dev never rebuilds MAIN, and the drive refuses a build older than `storage.ts` or `ipc.ts`). Never point a drive at `%APPDATA%\chorus*` or port 9222, and never stop `electron.exe` or `Chorus.exe` by name: the installed Chorus is running. **Line endings:** `storage.ts`, `schema.test.ts`, `src/shared/ipc.ts`, `ipc.test.ts`, `src/main/ipc.ts` and `index.ts` must still report `w/crlf`, and `schema.ts` and `sessionManager.ts` `w/mixed`; every inserted line takes its neighbours' ending (CRLF in all the regions this task edits). With `core.autocrlf` true, `git diff --stat` cannot see a whole-file rewrite, so check both, and restore the original bytes if either changed. Paste both drive outputs and the vitest summary.
