# Implementation specification 4a-2 — OpenCode interactive config and the remembered variant

Paired [task](../Tasks/Task-4a-2.md). Decisions: [roadmap](../roadmap.md) MR-D3, MR-D4, MR-D16 (resolved by MR-D25); user decision MR-D25; gates MR-G1–MR-G4; [overview](../Tasks/Phase-4a-Overview.md) K1, K6, K11, K13 and clarifications C10–C15. Builds on [ImplementationSpec-4a-1](ImplementationSpec-4a-1.md) and [Phase-0-Findings](../Phase-0-Findings.md). **Not started.**

## Files and insertion points

Verified 2026-10-03 at `a57ef1b`.

| File | Action |
|---|---|
| `src/main/adapters/types.ts` (CRLF) | `PtyLaunchSpec.routing?` after `resume` (:557), before the closing brace (:558). `PtyLaunchRouting` after `PtyLaunchRoute` (:623–628). `McpWriteContext.cliState?` after `agentDefaults` (:876–880), before `signal` (:881). Insertions only. |
| `src/main/adapters/opencode.ts` (CRLF) | Import `applyRememberedVariant` after the `mcpConfigWrite` import (:4). `writeMcpConfig` (:217–227) as below. In `buildLaunch`'s return (:256–265) the `envAdditions: {},` line (:260) and its comment. Nothing else. |
| `src/main/adapters/opencodeVariantStateCore.ts` | New (LF). |
| `src/main/adapters/opencodeVariantStateCore.test.ts` | New (LF), Table VS. |
| `src/main/adapters/opencodeVariantState.ts` | New (LF). |
| `src/main/adapters/opencodeVariantState.test.ts` | New (LF), Table VW. |
| `src/main/adapters/adapters.test.ts` (CRLF) | Append `describe('Phase 4a: opencode carries routing per process (MR-D3, K6)')` at the end of the file. Insertions only. |
| `src/main/adapters/mcpConfigWrite.test.ts` (CRLF) | Append `describe("MR-D25 — writeMcpConfig keeps OpenCode's remembered variant in step")` at the end of the file. Insertions only. |
| `scripts/verify-routing-body.mjs` (LF) | Header (:1–8), bundle (:19–21), constants (:23–27), the TUI half (`runTui` :70–91, cases :101–104, finders :106–107, checks :112–117), the report, the `finally` cleanup and the final line (:119–121; the evidence directory is now deleted and no `report.json` is written). The helper half (`helperRequest` :42–50, `runHelper` :59–68, cases :99–100, checks :108–111) is unchanged. |

`mcpConfigCore.ts`, `mcpConfigWrite.ts`, `env.ts`, `helpers/*`, `ipc.ts`, `sessionManager.ts` and every routing file are unchanged.

## Measured facts this task rests on

| Fact | Evidence (2026-10-03, zero cost) |
|---|---|
| Installed OpenCode is `1.18.33` | `opencode --version`. |
| `model.json` on 1.18.33 is compact JSON on one line, no trailing newline, keys `recent`, `favorite`, `variant`; `variant` maps `openrouter/<model id as sent>` to a variant name, and this machine holds `"openrouter/deepseek/deepseek-v4.1-flash":"high"` and `"openrouter/deepseek/deepseek-v4.1-flash:nitro":"default"` | A read-only look at `~\.local\state\opencode\model.json` (1,157 bytes, 0 newlines); `verify-routing-body.mjs` `isolated()` (:55) seeds the same shape. |
| The state directory is `<XDG_STATE_HOME>\opencode` when `XDG_STATE_HOME` is set; otherwise `<USERPROFILE>\.local\state\opencode`; `HOME` is ignored; without `USERPROFILE` (and with `HOMEDRIVE`/`HOMEPATH` changed) the OS profile directory is used | `opencode debug paths` under seven controlled environments: baseline, `XDG_STATE_HOME`, `USERPROFILE`, `HOME` only, `HOME` + `USERPROFILE`, no `USERPROFILE`, changed `HOMEDRIVE`/`HOMEPATH`. |
| A credentialed launch's child has no `XDG_*` unless the launch profile's env sets it | `composeChildEnv`'s allow-list (`env.ts:10–20`, :166–179). |
| A remembered variant beats `agent.build.variant`; an empty state lets it apply | Phase-0-Findings new finding 6 (`tui-stored-variant` sent `high`; an empty state sent `low`). |
| `:nitro` keeps its effort only when its variants are declared | Phase-0-Findings row (b) (`tui-nitro-variants` vs `tui-nitro-bare`). |
| The real builders run under plain Node | A scratch bundle of `opencodeAdapter` and `composeChildEnv` built a launch, wrote the config file and composed the child env (C14). |

## Normative contracts — `src/main/adapters/types.ts`

```ts
// PtyLaunchSpec, after `resume` (:557)
  /**
   * Model Routing Phase 4a (MR-D3, K6, K13): config that travels WITH THIS PROCESS — today opencode's
   * OPENCODE_CONFIG_CONTENT: either a routed session's content (`buildOpenCodeRoutingContent`, from
   * its resolved selection) or, for an UNROUTED launch whose sent id ends in `:nitro` and carries an
   * effort, the variant declaration MR-D4 requires (`unroutedNitroVariantsContent`, no provider
   * object). Both are built in routing/launchCore.ts. Absent for every other launch, restore and
   * restart; every adapter but opencode ignores it.
   *
   * ⚠ NEVER WRITTEN INTO THE SHARED `<userData>/mcp/opencode.json`. Concurrent sessions would
   * overwrite each other's routing there and leave stale routing behind (the D179 trap MR-D3 avoids).
   */
  readonly routing?: PtyLaunchRouting

// after PtyLaunchRoute (:623–628)
/** Model Routing Phase 4a: per-process routing config. NON-SECRET (provider preferences and model ids), so it travels `envAdditions`. */
export interface PtyLaunchRouting {
  /** The exact OPENCODE_CONFIG_CONTENT string. */
  readonly configContent: string
}

// McpWriteContext, after `agentDefaults` (:876–880)
  /**
   * Model Routing Phase 4a (MR-D25): what an adapter needs to keep a CLI's remembered per-model state
   * in step with this launch's effort — today opencode's TUI variant memory, which otherwise beats the
   * `agent` block above (Phase-0-Findings, finding 6). Composed by main (`withMcpEnv`), because only
   * main knows the environment the child will receive and the installed CLI version. Absent: nothing
   * outside `chorusConfigDir` is written.
   *
   * ⚠ THE ONE PLACE CHORUS WRITES ANOTHER APPLICATION'S STATE FILE, authorised by MR-D25 alone: one
   * key, one measured version, atomically. See `opencodeVariantState.ts`.
   */
  readonly cliState?: {
    /** The state root the CHILD resolves (`opencodeStateHome`): XDG_STATE_HOME, else <USERPROFILE>/.local/state. */
    readonly stateHome: string
    /** The installed CLI version from detection, or null when unknown. */
    readonly installedVersion: string | null
  }
```

## `opencode.ts`

```ts
import { applyRememberedVariant } from './opencodeVariantState' // after the mcpConfigWrite import (:4)

  async writeMcpConfig(ctx: McpWriteContext): Promise<McpWriteResult> {
    const agent = agentBlockFor(ctx)
    const result = writeMcpConfigFile(
      OPENCODE_MCP,
      path.join(ctx.chorusConfigDir, OPENCODE_MCP.configPath),
      ctx,
      // D179: the effort block travels in the SAME file as the servers, written
      // by the same atomic write. Two writers on one path would race each other
      // at every launch.
      agent
    )
    // ⚠ MR-D25 (Model Routing Phase 4a): opencode's remembered per-model TUI
    // variant BEATS `agent.build.variant` (Phase-0-Findings, finding 6), so the
    // effort just written applies only if that memory agrees. Only when this
    // launch writes an effort block, and keyed by the block's own model string —
    // the one spelling `-m` also uses (`qualifyModel`), so the key cannot drift.
    // It never fails the launch: the writer returns an outcome and never throws.
    if (agent !== null && ctx.cliState) {
      applyRememberedVariant({
        stateHome: ctx.cliState.stateHome,
        modelKey: agent.model,
        effort: agent.variant,
        installedVersion: ctx.cliState.installedVersion
      })
    }
    return result
  },
```

In `buildLaunch`'s return (:256–265), `envAdditions: {},` (:260) becomes:

```ts
      // Model Routing Phase 4a (MR-D3, K6): a routed launch's provider object, and
      // Nitro's declared variants, travel WITH THIS PROCESS; opencode merges them
      // with the OPENCODE_CONFIG file (Phase-0-Findings row (a)). Non-secret, so
      // `envAdditions` is the channel. No routing → `{}`, byte-identical to before.
      envAdditions: spec.routing ? { OPENCODE_CONFIG_CONTENT: spec.routing.configContent } : {},
```

Rules (normative):

- `buildLaunch` passes `configContent` through unchanged; it neither parses nor validates it (Task 4a-1 builds it from a strict selection and Task 4a-3 sets `route.modelId` to the selection's sent id). Argv, cwd and `secretEnv` are computed exactly as before.
- The state write runs after the config write, whatever that returned: the remembered variant is the user's chosen effort either way, and the TUI applies it from memory even if the config file could not be written. `McpWriteResult` is unchanged; the writer logs its own outcome.
- With `ctx.cliState` absent (every caller before Task 4a-3, claude, codex and every test that does not pass it) nothing outside `chorusConfigDir` is written.

**Where the inputs come from** (composed by Task 4a-3; stated here so the contract is complete):

- **Which launches reach the hook.** `agentBlockFor` needs a model, and only a credentialed launch has a route (`resolveCredential`, `ipc.ts:1453–1456`; `composeLaunchOptions` never sets one, `launchOptionsCore.ts`). Restore heals credentialed sessions to exited and SessionRestart refuses them, so in practice the hook runs for SessionLaunch and SessionRelaunch of credentialed OpenCode sessions with an effort — routed or not (MR-D25 is not routing-specific).
- **`stateHome`.** `withMcpEnv` composes the child's environment with `composeChildEnv` (the credential's name selects the allow-list branch; the profile's env is the only source of `XDG_STATE_HOME` there) and applies `opencodeStateHome(childEnv, os.homedir())`. On this machine a credentialed launch therefore writes `%USERPROFILE%\.local\state\opencode\model.json`, the file the TUI reads; a profile that sets `XDG_STATE_HOME` moves both.
- **`installedVersion`.** Helpers receive `installedVersion` from a probe of `opencode --version` (`teamRuntime.ts:113` and :129 store `probe.version`). Interactive detection memoises the same probe per tool in `detectClis()` (`cliDetect.ts:249–252`; the launch dialog refreshes it on open with `refreshClis()`, :274–277); `withMcpEnv` reads that memo's `opencode` entry. A memo older than an OpenCode upgrade still reports the old version, so the gate can let one write through for an unverified newer binary until the next detection; that write still changes only one existing key and leaves the file untouched if it no longer parses as the measured shape. This is a recorded risk, not a guarantee.
- **Nitro's variant efforts** are not this task's input: Task 4a-3 passes them to `buildOpenCodeRoutingContent` from the credential provider's `model_catalog` row for the base slug (`storage.getModelCatalogForProvider`, `decodeReasoningEfforts`), else the launch's own effort (K6, `routingVariantEfforts`). On this machine the installed catalog has no row for `deepseek/deepseek-v4.1-flash`, so the fallback applies.

## Normative contracts — `opencodeVariantStateCore.ts`

Pure: imports only `node:path`; no file system, clock or environment read (the environment is a parameter).

```ts
import path from 'node:path'

/**
 * Model Routing Task 4a-2 (MR-D25): the pure half of keeping opencode's remembered per-model TUI
 * variant (`<stateHome>/opencode/model.json`, `variant[<model as sent>]`) in step with the effort a
 * Chorus launch writes. The format and the state-directory rule were MEASURED on 1.18.33 (see
 * ImplementationSpec-4a-2); any other version is left alone.
 */

/** The only opencode version whose state format and directory rule were measured. */
export const OPENCODE_VARIANT_STATE_VERSION = '1.18.33'
/** A model.json above this many bytes is never touched (the measured file is 1,157). */
export const OPENCODE_STATE_FILE_CAP_BYTES = 1_000_000
/** modelEffortSchema's charset (shared/ipc.ts:1081–1085): a bare lowercase token. */
const EFFORT = /^[a-z0-9_-]{1,40}$/
const MODEL_KEY_MAX = 300

export type RememberedVariantState = 'invalid' | 'unreadable' | 'absent' | 'equal' | 'differs'

/** `<stateHome>/opencode/model.json`. */
export function opencodeModelStatePath(stateHome: string): string {
  return path.join(stateHome, 'opencode', 'model.json')
}

/** Windows environment names are case-insensitive: the exact name first, then any casing. */
function envValue(env: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  if (typeof env[name] === 'string') return env[name]
  const key = Object.keys(env).find((k) => k.toUpperCase() === name)
  return key === undefined ? undefined : env[key]
}

/**
 * C13, measured on 1.18.33 with `opencode debug paths`: the state root an opencode child resolves
 * from ITS environment — XDG_STATE_HOME when non-empty, else <USERPROFILE>/.local/state. HOME is
 * ignored. `fallbackHome` stands in when USERPROFILE is absent (main passes os.homedir(), which
 * resolves the same OS profile directory the child falls back to).
 */
export function opencodeStateHome(childEnv: Readonly<Record<string, string | undefined>>, fallbackHome: string): string {
  const xdg = envValue(childEnv, 'XDG_STATE_HOME')
  if (xdg) return xdg
  const profile = envValue(childEnv, 'USERPROFILE')
  return path.join(profile ? profile : fallbackHome, '.local', 'state')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * C12: 'invalid' (an empty, over-long or `__proto__` key, or an effort that is not a bare token);
 * 'unreadable' (no text, not JSON, a non-object root, a non-object `variant`); 'absent' (no
 * `variant` key, or no entry for this model); 'equal'; 'differs' (any other existing value).
 */
export function classifyRememberedVariant(currentText: string | null, modelKey: string, effort: string): RememberedVariantState {
  if (modelKey.length === 0 || modelKey.length > MODEL_KEY_MAX || modelKey === '__proto__' || !EFFORT.test(effort)) return 'invalid'
  if (currentText === null) return 'unreadable'
  let root: unknown
  try {
    root = JSON.parse(currentText)
  } catch {
    return 'unreadable'
  }
  if (!isPlainObject(root)) return 'unreadable'
  if (!Object.prototype.hasOwnProperty.call(root, 'variant')) return 'absent'
  const variant = root.variant
  if (!isPlainObject(variant)) return 'unreadable'
  if (!Object.prototype.hasOwnProperty.call(variant, modelKey)) return 'absent'
  return variant[modelKey] === effort ? 'equal' : 'differs'
}

/**
 * MR-D25: the new file text with ONLY `variant[modelKey]` set to `effort`, every other key and value
 * preserved as JSON, in 1.18.33's own format (compact `JSON.stringify`, no trailing newline), or null
 * (= write nothing) unless `classifyRememberedVariant` says 'differs'.
 */
export function patchRememberedVariant(currentText: string | null, modelKey: string, effort: string): string | null {
  if (currentText === null || classifyRememberedVariant(currentText, modelKey, effort) !== 'differs') return null
  const root = JSON.parse(currentText) as Record<string, unknown>
  ;(root.variant as Record<string, unknown>)[modelKey] = effort
  return JSON.stringify(root)
}
```

## Normative contracts — `opencodeVariantState.ts`

```ts
import fs from 'node:fs'
import { logger } from '../services/logger'
import {
  OPENCODE_STATE_FILE_CAP_BYTES,
  OPENCODE_VARIANT_STATE_VERSION,
  classifyRememberedVariant,
  opencodeModelStatePath,
  patchRememberedVariant
} from './opencodeVariantStateCore'

export type RememberedVariantOutcome = 'written' | 'unchanged' | 'skipped'

/**
 * MR-D25: set opencode's remembered variant for `modelKey` to `effort` before a launch that writes
 * that effort. NEVER throws. 'skipped' — another version, no or empty state home, a missing,
 * non-file, oversize or unreadable model.json, invalid input, or a failed write (nothing changed on
 * disk); 'unchanged' — no entry for this model, or it already equals `effort`; 'written'.
 *
 * ⚠ IT WRITES ANOTHER APPLICATION'S STATE FILE (authorised by MR-D25 alone). One key, the rest
 * preserved, temp-fsync-rename beside the target. A running TUI may rewrite the file afterwards.
 */
export function applyRememberedVariant(opts: {
  stateHome: string
  modelKey: string
  effort: string
  installedVersion: string | null
}): RememberedVariantOutcome {
  try {
    if (opts.installedVersion !== OPENCODE_VARIANT_STATE_VERSION || opts.stateHome.length === 0) return 'skipped'
    const target = opencodeModelStatePath(opts.stateHome)
    let stat: fs.Stats
    try {
      stat = fs.statSync(target)
    } catch {
      return 'skipped' // missing: the ordinary case on a machine where the TUI never remembered anything
    }
    if (!stat.isFile() || stat.size > OPENCODE_STATE_FILE_CAP_BYTES) return 'skipped'
    const text = fs.readFileSync(target, 'utf8')
    const state = classifyRememberedVariant(text, opts.modelKey, opts.effort)
    if (state === 'absent' || state === 'equal') return 'unchanged'
    const patched = state === 'differs' ? patchRememberedVariant(text, opts.modelKey, opts.effort) : null
    if (patched === null) return 'skipped'
    writeAtomically(target, patched)
    logger.info(`[launch] set OpenCode's remembered variant for ${opts.modelKey} to ${opts.effort}`)
    return 'written'
  } catch {
    try {
      logger.warn("[launch] could not update OpenCode's remembered variant; the launch continues")
    } catch {
      // Never throws.
    }
    return 'skipped'
  }
}

/** Temp file beside the target (`<target>.chorus-<pid>.tmp`), written and fsync'd, then renamed over it; the temp file is removed on failure. */
function writeAtomically(target: string, text: string): void {
  const temp = `${target}.chorus-${process.pid}.tmp`
  const bytes = Buffer.from(text, 'utf8')
  try {
    const fd = fs.openSync(temp, 'w')
    try {
      let offset = 0
      while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(temp, target)
  } catch (err) {
    try {
      fs.rmSync(temp, { force: true })
    } catch {
      // The reported failure is the write's.
    }
    throw err
  }
}
```

Rules (normative, C12):

- **One key.** Only `variant[modelKey]` may change; every other key and value round-trips through `JSON.parse`/`JSON.stringify` (on 1.18.33's compact file the output equals the input with that one value replaced, VS1).
- **Only an existing, differing entry is rewritten.** An absent entry cannot override `agent.build.variant` (Phase-0-Findings: an empty state sent the configured effort), so writing one would change another application's state for no effect.
- **Version gate.** Exactly `'1.18.33'` as detected; `'unknown'`, `null` or any other string writes nothing.
- **No path, content or key in a log line.** The info line names the model key and the effort; the warning is fixed text.

## `scripts/verify-routing-body.mjs` (MR-G2, MR-G3)

**Header** (:1–8): "Model Routing Phase 0 (spike A), extended by Phase 4a (ImplementationSpec-4a-2). … The TUI cases are built from Chorus's REAL interactive builders — `resolveLaunchSelection`, `buildOpenCodeRoutingContent` and (K13) `unroutedNitroVariantsContent` on the golden `TierResult`, `opencodeAdapter.buildLaunch`, `opencodeAdapter.writeMcpConfig` and `composeChildEnv` — and the only harness change is pointing OpenRouter at the loopback stand-in. Each OpenCode run gets its own `XDG_STATE_HOME` and `XDG_DATA_HOME` (MR-G3); its config and cache directories are NOT isolated (`XDG_CONFIG_HOME`/`XDG_CACHE_HOME` are left to the user's own, exactly as before). The whole `%TEMP%\chorus-routing-body-*` evidence directory is deleted on every exit path, and the report is printed to stdout only (it holds a placeholder key, never a real one). Last line: `PASS (n checks)` (exit 0) or `FAIL (k of n checks)` (exit 1); a failed precondition throws (exit 1, no PASS line)."

**Bundle** (:19–21), same esbuild call (`packages: 'external'`, into `_verify/`, deleted in `finally`), entry:

```js
const ENTRY = [
  "export { opencodeHelper } from './src/main/adapters/helpers/opencode';",
  "export { composeHelperEnv } from './src/main/adapters/helpers/common';",
  "export { opencodeAdapter } from './src/main/adapters/opencode';",
  "export { composeChildEnv } from './src/main/adapters/env';",
  "export { opencodeStateHome } from './src/main/adapters/opencodeVariantStateCore';",
  "export { resolveLaunchSelection, buildOpenCodeRoutingContent, unroutedNitroVariantsContent } from './src/main/routing/launchCore';",
  "export { computeTiers } from './src/main/routing/routingCore';",
  "export { parseEndpointsResponse, extractObservations } from './src/main/routing/endpointsCore';",
  "export { bundledModelRegistry, findModel } from './src/main/routing/registryCore';",
  "export { DEFAULT_ROUTING_SETTINGS } from './src/shared/routing';"
].join('\n')
```

**Constants** (after :23–27; `ROUTE`, `DENY`, `VARIANTS` stay for the helper cases):

```js
const GATEWAY = 'https://openrouter.ai/api/v1'
const CREDENTIAL = { envVarName: 'OPENROUTER_API_KEY', value: 'loopback-placeholder', isSecret: true }
// Hand-written expectations (never computed by the code under test): ImplementationSpec-4a-1 Tables L8 and L17.
const EXPECTED = {
  nitroUnrouted: '{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash:nitro":{"variants":{"low":{"reasoning":{"effort":"low"}},"medium":{"reasoning":{"effort":"medium"}},"high":{"reasoning":{"effort":"high"}}}}}}}}',
  balanced: '{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash":{"options":{"provider":{"order":["deepinfra/fp8","streamlake/fp8","makora/fp8"],"allow_fallbacks":false,"require_parameters":true,"quantizations":["fp8"],"data_collection":"deny"}}}}}}}',
  nitroVariants: '{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash:nitro":{"options":{"provider":{"data_collection":"deny"}},"variants":{"low":{"reasoning":{"effort":"low"}},"medium":{"reasoning":{"effort":"medium"}},"high":{"reasoning":{"effort":"high"}}}}}}}}',
  nitroBare: '{"provider":{"openrouter":{"models":{"deepseek/deepseek-v4.1-flash:nitro":{"options":{"provider":{"data_collection":"deny"}}}}}}}'
}
const SEEDED_HIGH = '{"recent":[],"favorite":[],"variant":{"openrouter/deepseek/deepseek-v4.1-flash":"high"}}'
const PATCHED_LOW = '{"recent":[],"favorite":[],"variant":{"openrouter/deepseek/deepseek-v4.1-flash":"low"}}'
```

**The golden selections**, built once before the cases from the fixture with `routingIpc.test.ts`'s recipe (:55–76: the fixture's rows and `fetchedAt`, history `extractObservations(snapshot)`, account and cache from the fixture with `checkedAt '2026-10-02T09:15:39Z'`, profile `interactive`, effort `'low'`, `DEFAULT_ROUTING_SETTINGS`, now `'2026-10-02T09:20:00Z'`), then `resolveLaunchSelection` for `'balanced'` and `'nitro'` with `computedAt` the same instant; a non-`ok` resolution throws.

**`runTui(name, sentModelId, configContent, { storedVariants, applyState })`** replaces :70–91. The caller builds `configContent` with the real builder for the case (routed: `buildOpenCodeRoutingContent(selection, efforts)`; K13: `unroutedNitroVariantsContent(…)`), so `runTui` never builds content itself:

1. `condition = name`; `sandbox = isolated(name, storedVariants)` (unchanged helper: `XDG_STATE_HOME`, `XDG_DATA_HOME`, and a seeded `model.json` when `storedVariants` is given). Only state and data are isolated; config and cache stay the user's own (unchanged from Phase 0).
2. `configContent` must be a string (a `null` from the K13 builder throws: the case would test nothing).
3. `request = opencodeAdapter.buildLaunch({ sessionId: name, cwd: process.cwd(), credential: CREDENTIAL, route: { providerKey: 'chorus', providerName: 'OpenRouter', baseUrl: GATEWAY, modelId: sentModelId }, modelEffortId: 'low', routing: { configContent } })`.
4. `profileEnv = { OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_DISABLE_LSP_DOWNLOAD: 'true', ...sandbox.env }` — what a launch profile's env would contribute (MR-G3 isolation plus test hygiene).
5. `stateHome = opencodeStateHome(composeChildEnv({ parentEnv: process.env, requiredEnvVars: opencodeAdapter.requiredEnvVars, envAdditions: { ...request.envAdditions, ...profileEnv }, secretEnv: request.secretEnv }), os.homedir())` — the credentialed allow-list branch, exactly as the app composes it.
6. `statePath = path.join(sandbox.env.XDG_STATE_HOME, 'opencode', 'model.json')`; `stateBefore` = its text or `null`.
7. `written = await opencodeAdapter.writeMcpConfig({ projectRoot: sandbox.root, chorusConfigDir: sandbox.root, servers: [], knownSecrets: [], agentDefaults: { modelId: sentModelId, baseUrl: GATEWAY, modelEffort: 'low' }, ...(applyState ? { cliState: { stateHome, installedVersion: version } } : {}) })`; not `ok` throws.
8. `stateAfter` = the state file's text or `null`, read now, BEFORE the TUI starts (the TUI rewrites its own state as it runs). `agent` = `JSON.parse(readFileSync(written.path)).agent ?? null`.
9. The one harness patch (MR-G2): `content = JSON.parse(request.envAdditions.OPENCODE_CONFIG_CONTENT)`; `content.share = 'disabled'`; `content.provider.openrouter.options = { baseURL }`. The `models` entry is the builder's, untouched.
10. `env = composeChildEnv({ parentEnv: process.env, requiredEnvVars: opencodeAdapter.requiredEnvVars, envAdditions: { ...request.envAdditions, OPENCODE_CONFIG_CONTENT: JSON.stringify(content), ...profileEnv, OPENCODE_CONFIG: written.path }, secretEnv: request.secretEnv })`.
11. Record `tuiRuns[name] = { sentModelId, configContent, args: [...request.args], agent, stateHome, isolatedStateHome: sandbox.env.XDG_STATE_HOME, stateBefore, stateAfter }`.
12. `pty.spawn(request.executable, [...request.args], { name: 'xterm-256color', cols: 120, rows: 36, cwd: process.cwd(), env })`; the paint wait, prompt, Enter, request wait and kill are unchanged (:81–90).

`version` becomes a module-level `let`, set by the precondition (:96–97) before any case runs. **Real-state guard (MR-G3):** before the first case, `REAL_STATE = path.join(opencodeStateHome(process.env, os.homedir()), 'opencode', 'model.json')` and `realBefore` = its bytes or `null`; after the last case, `realAfter` likewise.

**Cases** (:99–104):

```js
const LMH = ['low', 'medium', 'high']
const routed = (selection, efforts) => buildOpenCodeRoutingContent(selection, efforts)
await runHelper('helper-routed', SLUG, { provider: ROUTE })                // unchanged
await runHelper('helper-nitro-deny', NITRO, { provider: DENY })           // unchanged
await runTui('tui-routed', SLUG, routed(BALANCED, []), {})
await runTui('tui-nitro-variants', NITRO, routed(NITRO_SEL, LMH), {})
await runTui('tui-nitro-bare', NITRO, routed(NITRO_SEL, []), {})
// K13: an UNROUTED :nitro launch with an effort — variants only, no provider object (ImplementationSpec-4a-1 L18's NBASE).
await runTui('tui-nitro-unrouted', NITRO, unroutedNitroVariantsContent({ agent: 'opencode', baseUrl: GATEWAY, gatewayBaseUrl: GATEWAY, sentModelId: NITRO, launchEffort: 'low', catalogEfforts: LMH, profileEnvKeys: [] }), {})
await runTui('tui-stored-variant', SLUG, routed(BALANCED, []), { storedVariants: { [`openrouter/${SLUG}`]: 'high' } })
await runTui('tui-remembered-variant', SLUG, routed(BALANCED, []), { storedVariants: { [`openrouter/${SLUG}`]: 'high' }, applyState: true })
```

**Checks** (16, in this order; `a`–`h` are the main requests of the eight cases in the order above, found as today by condition and `r.model` ∈ {`SLUG`, `NITRO`}; `t(n)` is `tuiRuns[n]`):

| # | Name | Passes when |
|---|---|---|
| 1 | `helper base slug carries the exact provider object` | Unchanged. |
| 2 | `helper base slug keeps low effort and the 64k cap` | Unchanged. |
| 3 | `helper :nitro carries data_collection deny` | Unchanged. |
| 4 | `helper :nitro keeps low effort and the 64k cap` | Unchanged. |
| 5 | `real builders: the Balanced and Nitro contents are the golden contents` | `t('tui-routed').configContent === EXPECTED.balanced`, `t('tui-nitro-variants').configContent === EXPECTED.nitroVariants`, `t('tui-nitro-bare').configContent === EXPECTED.nitroBare`, `t('tui-nitro-unrouted').configContent === EXPECTED.nitroUnrouted`. |
| 6 | `real builders: -m and agent.build.model name the sent id` | For each of the six TUI runs: the token after `'-m'` in `args` is `openrouter/<sentModelId>` and `agent` deep-equals `{ build: { model: 'openrouter/<sentModelId>', variant: 'low' } }`. |
| 7 | `TUI routed: the real Balanced provider object arrives exactly` | `c.provider` deep-equals `BALANCED.provider`. |
| 8 | `TUI base slug keeps the file-declared low effort` | `c.reasoning.effort === 'low'`. |
| 9 | `TUI :nitro with declared variants keeps low effort and the provider object` | `d.reasoning.effort === 'low'` and `d.provider` deep-equals `{ data_collection: 'deny' }`. |
| 10 | `control: TUI :nitro without declared variants drops the effort` | `e` exists and `!e.reasoning?.effort`. |
| 11 | `finding: without MR-D25 a remembered variant overrides agent.build.variant` | `g.reasoning.effort === 'high'` and `t('tui-stored-variant').stateAfter === t('tui-stored-variant').stateBefore` (no `cliState`, no write). |
| 12 | `MR-D25: the state home computed from the child env is the isolated one` | `t('tui-remembered-variant').stateHome === t('tui-remembered-variant').isolatedStateHome`. |
| 13 | `MR-D25: only the model entry changed in the state file` | `stateBefore === SEEDED_HIGH` and `stateAfter === PATCHED_LOW` for `tui-remembered-variant`. |
| 14 | `MR-D25: the TUI sends the launch effort despite a stored high` | `h.reasoning.effort === 'low'`. |
| 15 | `MR-G3: the real OpenCode state file is unchanged` | `realBefore` and `realAfter` are both `null` or byte-equal. |
| 16 | `K13: an unrouted :nitro launch with an effort keeps it, with no provider object` | `f.reasoning.effort === 'low'` and `f.provider === null` (the request body carried no `provider`). |

**Report, cleanup and final line** (:119–121):

- The report keeps `passed`, `version`, `checks`, `requests` and `providerTraffic: false` and gains `tuiRuns`; `evidence` is dropped (the directory no longer exists afterwards). It is **printed to stdout only**: no `report.json` is written anywhere. It holds no key (the only key-shaped value in the run is the placeholder `loopback-placeholder`, which is never recorded in it).
- **Cleanup on every exit path** (`finally`, whether the checks ran, a precondition threw, or a TUI failed to paint): kill any PTY still running, close the loopback server (as today), delete the bundle (as today), then delete the whole evidence directory (`fs.rmSync(evidence, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })` — the sandboxes, their state and data directories and the written `opencode.json` files). A failed delete prints `# cleanup failed: <evidence> was not deleted (<message>)` and forces exit code 1.
- **Final line**, printed after the cleanup: `PASS (16 checks)` when every check passed and the cleanup succeeded, else `FAIL (<failed> of 16 checks)` (a cleanup failure alone reads `FAIL (0 of 16 checks)` after its `#` line), with `process.exitCode` 0 or 1. A precondition that threw prints the error and no final line, exit 1. A `PASS (n checks)` line is a **new convention for this script** (C14), matching the other `verify-routing-*` scripts.

## Test cases

`K = 'openrouter/deepseek/deepseek-v4.1-flash'`, `KN = K + ':nitro'`. `T` is a model.json in this machine's shape:

`{"recent":[{"providerID":"openrouter","modelID":"deepseek/deepseek-v4.1-flash"}],"favorite":[],"variant":{"openrouter/z-ai/glm-5.3":"high","openrouter/deepseek/deepseek-v4.1-flash":"high","openrouter/deepseek/deepseek-v4.1-flash:nitro":"default"}}`

Expected strings were computed on 2026-10-03 with a scratch prototype of these functions (not committed).

**Table VS — `opencodeVariantStateCore.test.ts`.**

| # | Case | Expect |
|---|---|---|
| VS1 | `patchRememberedVariant(T, K, 'low')` | `{"recent":[{"providerID":"openrouter","modelID":"deepseek/deepseek-v4.1-flash"}],"favorite":[],"variant":{"openrouter/z-ai/glm-5.3":"high","openrouter/deepseek/deepseek-v4.1-flash":"low","openrouter/deepseek/deepseek-v4.1-flash:nitro":"default"}}`, which equals `T.replace('"openrouter/deepseek/deepseek-v4.1-flash":"high"', '"openrouter/deepseek/deepseek-v4.1-flash":"low"')`. |
| VS2 | `patchRememberedVariant(T, KN, 'low')` | `T` with only `"openrouter/deepseek/deepseek-v4.1-flash:nitro":"default"` replaced by `…:"low"`. |
| VS3 | `classifyRememberedVariant` on `(T, K, 'high')`; `(T, 'openrouter/other/model', 'low')`; `('{"recent":[]}', K, 'low')`; `(null, K, 'low')`; `('garbage', …)`; `('[]', …)`; `('null', …)`; `('{"variant":[]}', …)`; `('{"variant":"high"}', …)` | `'equal'`; `'absent'`; `'absent'`; `'unreadable'` for the last six. `patchRememberedVariant` is `null` for every one. |
| VS4 | `classifyRememberedVariant(T, x, 'low')` for `x` = `''`, `'__proto__'`, `'x'.repeat(301)`; `(T, K, 'LOW')`, `(T, K, 'x y')` | `'invalid'` for all five; patches `null`. |
| VS5 | `'{"variant":{"openrouter/deepseek/deepseek-v4.1-flash":7}}'` with `(K, 'low')` | `'differs'`; patch `{"variant":{"openrouter/deepseek/deepseek-v4.1-flash":"low"}}`. |
| VS6 | `patchRememberedVariant(JSON.stringify(JSON.parse(T), null, 2), K, 'low')` | Exactly VS1's string (the output is always compact). |
| VS7 | `opencodeStateHome(env, 'C:\\f')` for `{ XDG_STATE_HOME: 'C:\\x\\state', USERPROFILE: 'C:\\u' }`; `{ XDG_STATE_HOME: '', USERPROFILE: 'C:\\u' }`; `{ USERPROFILE: 'C:\\u', HOME: 'C:\\h' }`; `{ HOME: 'C:\\h' }`; `{ xdg_state_home: 'C:\\y' }`; `{ Userprofile: 'C:\\v' }` | `'C:\\x\\state'`; `path.join('C:\\u', '.local', 'state')` (twice: an empty XDG value and HOME are both ignored); `path.join('C:\\f', '.local', 'state')`; `'C:\\y'`; `path.join('C:\\v', '.local', 'state')`. |
| VS8 | `opencodeModelStatePath('C:\\s')`; `OPENCODE_VARIANT_STATE_VERSION`; `OPENCODE_STATE_FILE_CAP_BYTES` | `path.join('C:\\s', 'opencode', 'model.json')`; `'1.18.33'`; `1000000`. |

**Table VW — `opencodeVariantState.test.ts`** (a real temp root per test, `stateHome = join(root, 'state')`, `file = join(stateHome, 'opencode', 'model.json')`; `V = { stateHome, modelKey: K, effort: 'low', installedVersion: '1.18.33' }`; `logger.info`/`logger.warn` spied with `vi.spyOn`).

| # | Case | Expect |
|---|---|---|
| VW1 | Seed `T`; `applyRememberedVariant(V)` | `'written'`; the file equals VS1's string; `readdirSync(join(stateHome, 'opencode'))` `['model.json']`; `logger.info` once with `[launch] set OpenCode's remembered variant for openrouter/deepseek/deepseek-v4.1-flash to low`. |
| VW2 | Then `applyRememberedVariant(V)` again | `'unchanged'`; bytes identical; no further info call. |
| VW3 | Seed `T`; `{ ...V, modelKey: 'openrouter/other/model' }` | `'unchanged'`; bytes identical. |
| VW4 | Seed `T`; `installedVersion` `'1.18.34'`, `null`, `'unknown'` | `'skipped'` each; bytes identical. |
| VW5 | No state directory; `V` | `'skipped'`; `existsSync(join(stateHome, 'opencode'))` false. |
| VW6 | `garbage`; a valid file padded to 1,000,001 bytes; a directory at `file` | `'skipped'` each; the first two byte-identical; `logger.warn` not called. |
| VW7 | Windows only (`it.skipIf(process.platform !== 'win32')`): seed `T`, `chmodSync(file, 0o444)`, `V`; restore `0o666` in `finally` | `'skipped'`; bytes identical; the directory lists only `model.json` (no temp file); `logger.warn` once with `[launch] could not update OpenCode's remembered variant; the launch continues`. |
| VW8 | Seed `T`: `{ ...V, stateHome: '' }`; `{ ...V, effort: 'LOW' }`; `{ ...V, modelKey: '' }` | `'skipped'` each; no throw; bytes identical. |

**Table OA — `adapters.test.ts`** (appended; `ROUTE = { providerKey: 'chorus', providerName: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', modelId: 'deepseek/deepseek-v4.1-flash' }`; `CONTENT_BALANCED` and `CONTENT_NITRO` are Table L8's first two strings, written out in the test).

| # | Case | Expect |
|---|---|---|
| OA1 | `buildLaunch({ sessionId: 's', cwd: 'C:\\Projects', credential: FAKE_CREDENTIAL, route: ROUTE, routing: { configContent: CONTENT_BALANCED } })` and the same without `routing` | `envAdditions` `{ OPENCODE_CONFIG_CONTENT: CONTENT_BALANCED }` (exactly one key) vs `{}`; `args`, `executable`, `cwd` and `secretEnv` equal between the two; the token after `-m` is `openrouter/deepseek/deepseek-v4.1-flash`; `args.join(' ')` contains neither `OPENCODE_CONFIG_CONTENT` nor `data_collection`. |
| OA2 | `route.modelId: 'deepseek/deepseek-v4.1-flash:nitro'`, `routing: { configContent: CONTENT_NITRO }` | `-m openrouter/deepseek/deepseek-v4.1-flash:nitro`; `envAdditions` `{ OPENCODE_CONFIG_CONTENT: CONTENT_NITRO }`. |
| OA3 | OA1's call with `modelEffortId: 'low'` and without | Equal requests (`buildLaunch` still never reads it). |
| OA4 | For each of `adapters` (claude, codex, grok): `buildLaunch({ sessionId: 's', cwd: 'C:\\Projects', routing: { configContent: CONTENT_BALANCED } })` and without `routing` | Equal (`toEqual`). |
| OA5 | K13: `route.modelId: 'deepseek/deepseek-v4.1-flash:nitro'`, `routing: { configContent: CONTENT_NITRO_UNROUTED }` (Table L17's first string, written out) | `-m openrouter/deepseek/deepseek-v4.1-flash:nitro`; `envAdditions` `{ OPENCODE_CONFIG_CONTENT: CONTENT_NITRO_UNROUTED }` exactly (`buildLaunch` passes any content through unchanged). |

**Table MW — `mcpConfigWrite.test.ts`** (appended; same `root`/`ctx()`; `stateHome = path.join(root, 'state')`; `stateFile = path.join(stateHome, 'opencode', 'model.json')`; `RT = { modelId: 'deepseek/deepseek-v4.1-flash', baseUrl: 'https://openrouter.ai/api/v1', modelEffort: 'low' }`; `CS = { stateHome, installedVersion: '1.18.33' }`; `SEED = '{"recent":[],"favorite":[],"variant":{"openrouter/deepseek/deepseek-v4.1-flash":"high"}}'`).

| # | Case | Expect |
|---|---|---|
| MW1 | Seed `SEED`; `opencodeAdapter.writeMcpConfig(ctx({ servers: [], agentDefaults: RT, cliState: CS }))` | `ok`; the state file is `{"recent":[],"favorite":[],"variant":{"openrouter/deepseek/deepseek-v4.1-flash":"low"}}`; `opencode.json`'s `agent` is `{ build: { model: 'openrouter/deepseek/deepseek-v4.1-flash', variant: 'low' } }`. |
| MW2 | Seed; no `cliState` | The state file byte-identical; the config written as before. |
| MW3 | Seed; `cliState: CS`, `agentDefaults: { ...RT, modelEffort: null }` | Byte-identical (no effort block, no state write). |
| MW4 | Seed; `cliState: CS`, `agentDefaults: { ...RT, modelId: null }` | Byte-identical. |
| MW5 | Seed; `cliState: { ...CS, installedVersion: '1.18.34' }` | Byte-identical; result `ok`. |
| MW6 | Seed `{"recent":[],"favorite":[],"variant":{"openrouter/deepseek/deepseek-v4.1-flash:nitro":"default"}}`; `agentDefaults: { ...RT, modelId: 'deepseek/deepseek-v4.1-flash:nitro' }`, `cliState: CS` | `{"recent":[],"favorite":[],"variant":{"openrouter/deepseek/deepseek-v4.1-flash:nitro":"low"}}`. |
| MW7 | Seed; `claudeAdapter.writeMcpConfig(ctx({ agentDefaults: RT, cliState: CS }))` | Byte-identical. |
| MW8 | Seed; `wireMcpForLaunch(opencodeAdapter, ctx({ servers: [], agentDefaults: RT, cliState: CS }))` | `envAdditions` `{ OPENCODE_CONFIG: <the opencode.json path> }`; the state file patched as MW1. |
| MW9 | No state file; MW1's call | Result `ok`; `opencode.json` carries the agent block; no state directory created. |

## Invariants

- A launch without `spec.routing` produces a `PtyLaunchRequest` byte-identical to today's; every adapter but opencode ignores `routing` (OA1, OA4).
- `OPENCODE_CONFIG_CONTENT` travels only in the child's environment (MR-D3): never argv, the shared file or a log.
- Chorus writes opencode's state only from `writeMcpConfig`, only for a launch that writes an effort, only with `cliState`, only on 1.18.33, only an existing differing `variant[modelKey]`, atomically, and never throws (MR-D25).
- `verify-routing-body.mjs` makes no provider request, uses a placeholder key, isolates every OpenCode run's XDG state and data (MR-G3), leaves the real `model.json` byte-identical, and builds its TUI cases from the real builders (MR-G2).
- No secret reaches a log, the state file or the report (MR-G4); `npm run grep:secrets` is clean after the script deletes its bundle.
- The script leaves nothing behind: its bundle and its whole `%TEMP%\chorus-routing-body-*` evidence directory are deleted on every exit path, and its report exists only on stdout. Only XDG state and data are isolated; config and cache remain the user's own, as in Phase 0.
- An unrouted `:nitro` launch with an effort declares that id's variants and no provider object (K13); the script proves OpenCode then sends the effort (check 16).

## Verification

```powershell
npm run typecheck
npx vitest run src/main/adapters/opencodeVariantStateCore.test.ts src/main/adapters/opencodeVariantState.test.ts src/main/adapters/adapters.test.ts src/main/adapters/mcpConfigWrite.test.ts
npm test
Select-String -Path src/main/adapters/opencodeVariantStateCore.ts -Pattern "from 'node:fs'|from 'fs'|Date\.now\(|new Date\(\)|process\.env"
opencode --version
node scripts/verify-routing-body.mjs
npm run grep:secrets
git diff --check
git diff --stat -- src/main/adapters/opencode.ts src/main/adapters/types.ts src/main/adapters/adapters.test.ts src/main/adapters/mcpConfigWrite.test.ts
git ls-files --eol -- src/main/adapters/opencode.ts src/main/adapters/types.ts src/main/adapters/adapters.test.ts src/main/adapters/mcpConfigWrite.test.ts
git status --short
```

The `Select-String` line prints nothing. The script is the runtime check (MR-G1, MR-G2): it needs no build, runs the installed OpenCode against a loopback stand-in (zero cost), and must end `PASS (16 checks)` with exit code 0 and `providerTraffic: false`; paste its whole output. Do not run it while OpenCode is open on the same model in a terminal you care about: the script never touches the real state, but check 15 would flag a real TUI writing its own file meanwhile. `types.ts`, `opencode.ts` and both test files are CRLF: `git diff --stat` must show only the intended lines and `git ls-files --eol` must still report `w/crlf` (restore CRLF if an editor rewrote the file).
