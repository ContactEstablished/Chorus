# Implementation specification 4b-1 — Helper routing contracts, resolution and the helper's OpenCode content

Paired [task](../Tasks/Task-4b-1.md). Decisions: [roadmap](../roadmap.md) MR-D3, MR-D4, MR-D10, MR-D11, MR-D15, MR-D26, MR-D31, MR-D32; gates MR-G1–MR-G5, MR-G8; [overview](../Tasks/Phase-4b-Overview.md) K1–K7, K15, K16 and clarifications C1–C6, C17. Builds on [ImplementationSpec-4a-1](ImplementationSpec-4a-1.md) (`resolveLaunch`, the selection schema, `LAUNCH_TIER_LABELS`) and [ImplementationSpec-4a-2](ImplementationSpec-4a-2.md) (the body script). **Not started.**

## Files and insertion points

Verified 2026-10-05 at `70d5dda` (branch `feature/model-routing`, release 0.9.2 merged), by opening each file. Line endings from `git ls-files --eol` and a byte count of the working tree; `core.autocrlf` is `true` and there is no `.gitattributes`.

| File | Endings at `70d5dda` | Action |
|---|---|---|
| `src/shared/routing.ts` | CRLF (668 CRLF, 32,629 bytes) | `routingLaunchRequestSchema` (:619–624): its doc comment (:618) names K5; the `credentialProfileId` line (:623) gains a trailing comma; one line, `profile`, is inserted after it, before `})` (:624). Nothing else. |
| `src/shared/routing.test.ts` | CRLF (493 lines) | Append `describe('Table S8 — Phase 4b: the launch request names a profile')` after the last line (:493). `routingLaunchRequestSchema` is already imported (:31). |
| `src/shared/team.ts` | CRLF (227 CRLF, 27,760 bytes) | One import after :2. `memberFields` (:26–32): the last field line (:31) gains a trailing comma; a doc line and `routingTier` follow it, before `}` (:32). `teamMemberSchema`'s `superRefine` (:33–36): one line after :35, before `})` (:36). `teamAttemptSchema` (:149–158): the last field line (:157) gains a trailing comma; a doc line and `routing` follow it, before `})` (:158). |
| `src/shared/team.test.ts` | New (LF) | Table TS. No such file exists at `70d5dda`. |
| `src/main/routing/helperRoutingCore.ts` | New (LF) | The pure core, exactly as below. |
| `src/main/routing/helperRoutingCore.test.ts` | New (LF) | Table HR. |
| `src/main/services/routingService.ts` | CRLF (1,009 CRLF, 44,076 bytes) | `LAUNCH_PROFILE`'s doc comment (:186); `resolveLaunch`'s doc comment (:379–380, two lines become three); the `rank` call (:392): `profile: LAUNCH_PROFILE` → `profile: q.profile ?? LAUNCH_PROFILE`. Nothing else. |
| `src/main/services/routingService.test.ts` | CRLF (2,046 lines) | Append `describe('Table V5 — Phase 4b helper profile')` after the last line (:2046). Every name it uses is already in scope (`makeHarness`, `storeWith`, `GOLDEN_TIERS`, `SLUG`, `C`, `UNKNOWN_ID`, `NOW`, `routingLaunchSelectionSchema`, `DEFAULT_ROUTING_SETTINGS`, the `Harness` and `RoutingLaunch*` types, `vi`). |
| `src/main/adapters/helpers/types.ts` | **LF** (85 LF, 2,980 bytes) | One type import after :1. `HelperExecutionInput` (:21–43): a two-line doc comment and `routing?` after `allowedCommands` (:41), before `signal` (:42). |
| `src/main/adapters/helpers/opencode.ts` | CRLF (50 CRLF, 4,215 bytes) | Two imports after :5. `const modelId = …` (:16) becomes six lines. `measuredCodeHelper` (:24) and the `models` entry inside `OPENCODE_CONFIG_CONTENT` (:42) change in place. |
| `src/main/adapters/helpers/common.ts` | **mixed** (95 CRLF, 2 lone LF at lines 21 and 22, 0 CR, 9,363 bytes) | `probeHelper`'s `run` (:82–84) and the help call (:86), byte-wise (below). The edited region is CRLF. |
| `src/main/adapters/helpers/helpers.test.ts` | CRLF (210 lines) | Append `describe('Table HO — …')` after the last line (:210). No import changes: the block types its fixtures as `NonNullable<HelperExecutionInput['routing']>`. |
| `src/main/adapters/helpers/probe.test.ts` | New (LF) | Table PR. No probe test exists at `70d5dda`. |
| `scripts/verify-routing-body.mjs` | CRLF (294 CRLF, 25,460 bytes) | The helper half (below). The TUI half is unchanged. |

Unchanged (verified): `launchCore.ts` (every rule this task reuses is there: `LAUNCH_TIER_LABELS` :34, `LAUNCH_MESSAGES` :37, `resolveLaunchSelection` :59–91), `evidence.ts`, `parser.ts`, `teamProfiles.ts`, `routingIpc.ts`, the preload, every renderer file, `teamService.ts` and everything Task 4b-2 owns. Nothing sets `HelperExecutionInput.routing` or `teamAttemptSchema.routing` until Task 4b-2.

## Recorded contract amendments (to Phases 1–4a)

Listed so that no test edit reads as "changing an expectation to make a test pass". **No existing test changes in this task.**

| Amendment | Test or script that changes with it |
|---|---|
| `routingLaunchRequestSchema` gains `profile: routingProfileIdSchema.optional()`; absent means `'interactive'` | None: S7-4 still refuses `{ extra: 1 }` (S8-2 repeats it beside a valid profile). |
| `RoutingService.resolveLaunch` ranks with `q.profile ?? 'interactive'` | None: Table V4 keeps every expectation (V45 still proves a request with no profile ranks `interactive`). |
| `memberFields` gains `routingTier` (optional, last); the member refine limits it to OpenCode on an API key | None: no test pins the member's keys. TS1 proves a pre-4b member round-trips byte for byte. |
| `teamAttemptSchema` gains `routing` (optional, last) | None: `teamCore.test.ts:17` still parses a failed attempt. TS6 proves a pre-4b attempt round-trips. |
| `HelperExecutionInput` gains `routing?`; the OpenCode helper computes `--model`, the model entry and its measured options from the sent id; an unrouted request is byte-identical | None: `helpers.test.ts:18–39` keeps every expectation (scratch reference: every existing test in the file passes on the proposed builder). |
| `probeHelper` reads stdout and stderr for the help call only | None: no probe test exists; Table PR is new. |
| `verify-routing-body.mjs`'s helper half runs on the real helper builder with a real helper-profile selection and no hand-patched provider object; a third helper run (unrouted control) | Its last line `PASS (16 checks)` → `PASS (18 checks)`. |

## Normative contracts — `src/shared/routing.ts`

```ts
/** RoutingService.resolveLaunch's input (K2, K4; Phase 4b K5 adds `profile`). Main-only: no IPC channel carries it. */
export const routingLaunchRequestSchema = z.strictObject({
  model: routingModelSlugSchema, // the base registry slug
  tier: routingLaunchTierSchema,
  effort: routingEffortSchema, // the launch's model_effort, or null
  credentialProfileId: credentialProfileIdSchema, // the launch credential (account eligibility per credential, MR-D20)
  profile: routingProfileIdSchema.optional() // Phase 4b (K5): absent = 'interactive' (a session launch); 'helper' = a Team helper attempt
})
```

`routingProfileIdSchema` is module scope (:26). `RoutingLaunchRequest` gains `profile?: 'interactive' | 'helper'` by inference. A parse without `profile` returns an object with **no** `profile` key (S8-1). The selection schema is unchanged: a selection never records its profile (C5).

## Normative contracts — `src/shared/team.ts`

```ts
import { routingLaunchSelectionSchema, routingLaunchTierSchema } from './routing' // after the ./teamProfiles import (:2)

// memberFields (:26–32): the last line gains a comma, then
  profileId: teamIdSchema.optional(), customModel: z.boolean().optional(), instructions: z.string().max(8000).optional(),
  /** Model Routing Phase 4b (K2, K3): a helper's routing tier NAME, resolved by main before every attempt (MR-D32). Absent = OpenRouter default. */
  routingTier: routingLaunchTierSchema.optional()
}

// teamMemberSchema's superRefine, after the subscription line (:35)
  if (v.routingTier !== undefined && (v.harness !== 'opencode' || v.authMode !== 'api_key')) ctx.addIssue({ code: 'custom', message: 'A routing tier applies only to an OpenCode helper on an OpenRouter API key.' })

// teamAttemptSchema (:149–158): the last line gains a comma, then
  artifact: teamArtifactSchema.nullable(), usage: z.array(teamUsageSchema).max(10000), blocker: utf8(4096).nullable(),
  /** Model Routing Phase 4b (K9): the exact selection this attempt sent, recorded once by helper-routing-resolved before the decrypt. Absent = unrouted. */
  routing: routingLaunchSelectionSchema.optional()
})
```

Rules (normative):

- **Placement.** Both fields are last, so a parsed record keeps every pre-4b key in its old order and adds the new key at the end (TS1, TS6). `TeamStorage.getRun` compares the stored `config_json` with `JSON.stringify` of the parse (`teamStorage.ts:54`): a pre-4b run must round-trip byte for byte, and does (TS1).
- **The refine's message equals `HELPER_ROUTING_REFUSALS.notOpencode`** (C1); HR7 pins the equality. The lead (`teamRunConfigSchema.lead`, :40) is a member, so a lead with a tier is refused by the same refine (TS5), on the path `['lead']`.
- **No renderer-built routing object.** The member schema is strict: a `routing` key on a member is `unrecognized_keys` (K2, TS4). Only `teamAttemptSchema` carries a selection, and only main writes it.
- **Imports.** `routing.ts` imports only `zod` (:1), so this value import brings no Node module into the renderer; the preload imports `TeamApi` as a type only (`src/preload/index.ts:2`) and stays unchanged.
- **Downgrade (Q5).** A run, attempt or preset written with these keys cannot be read by 0.9.2 or earlier (strict schemas). Accepted; recorded as a risk in the overview.

## Normative contracts — `src/main/routing/helperRoutingCore.ts`

Pure: imports only `../../shared/routing`, `../../shared/teamProfiles` (which imports only `zod`) and the sibling `./launchCore`. No clock, randomness, environment, file system or network; every result is a fresh plain-JSON value that shares no array or object with its input. The purity and layering greps cover it, so the words they match must not appear even in a comment. The file below is exactly the scratch reference that produced every golden value in this specification.

```ts
import { routingBaseModelId, type OpenRouterProviderPrefs, type RoutingErrorCode, type RoutingLaunchSelection, type RoutingLaunchTier } from '../../shared/routing'
import { normalizeTeamModel } from '../../shared/teamProfiles'
import { LAUNCH_TIER_LABELS } from './launchCore'

/**
 * Model Routing Task 4b-1: Team helper routing (ImplementationSpec-4b-1; overview K3–K7, C1–C4).
 *
 * The pure rules main applies to a Team helper's routing tier: whether a helper can be
 * routed (K4), the exact refusal texts at team:launch and before each attempt (C1, C2),
 * the OpenCode model entry a routed helper declares (K7), and the note a routed
 * provider error carries (C3, K12). TeamService reaches them through teamRouting.ts.
 *
 * Pure: no clock, no randomness, no environment, no file system, no network. Every
 * result is a fresh plain-JSON value that shares no array or object with its input.
 */

// ── Eligibility (K4, C1, C4) ──

/** Exact texts (C1). `notOpencode` is also teamMemberSchema's refine message (shared/team.ts); HR7 pins the equality. */
export const HELPER_ROUTING_REFUSALS = {
  notOpencode: 'A routing tier applies only to an OpenCode helper on an OpenRouter API key.',
  unavailable: 'Model routing is not available right now. Launch this helper with OpenRouter default instead.',
  credentialRefused:
    "This helper's credential cannot be used for model routing. Routing needs an OpenRouter API-key credential for the OpenRouter gateway.",
  unknownModel: "Model routing does not know this helper's model."
} as const

export interface HelperRoutingFacts {
  readonly harness: string
  readonly authMode: string
  readonly tier: RoutingLaunchTier | null // the member's routingTier, or null (OpenRouter default)
  readonly credentialProfileId: string | null
  readonly model: string // member.model exactly as stored: an `openrouter/` prefix and a `:nitro` suffix are allowed
  readonly routingAvailable: boolean // false when the service is absent or one of its two lists could not be read
  readonly routingCredentialIds: readonly string[] // RoutingService.credentials() ids
  readonly registrySlugs: readonly string[] // RoutingService.models() slugs
}

export type HelperRoutingPlan =
  | { readonly kind: 'unrouted' }
  | { readonly kind: 'routed'; readonly model: string; readonly tier: RoutingLaunchTier; readonly credentialProfileId: string }
  | { readonly kind: 'refused'; readonly reason: string }

/**
 * K4 (C4). No tier → 'unrouted' (OpenRouter default: the member's model, unchanged). A tier: first failure wins, in the
 * order notOpencode, unavailable, credentialRefused, unknownModel. A routed plan's `model` is the BASE registry slug:
 * one `openrouter/` prefix and one `:nitro` suffix removed (K5, K6) — unlike 4a's launch planner, `:nitro` is eligible.
 */
export function planHelperRouting(f: HelperRoutingFacts): HelperRoutingPlan {
  if (f.tier === null) return { kind: 'unrouted' }
  const R = HELPER_ROUTING_REFUSALS
  if (f.harness !== 'opencode' || f.authMode !== 'api_key') return { kind: 'refused', reason: R.notOpencode }
  if (!f.routingAvailable) return { kind: 'refused', reason: R.unavailable }
  if (f.credentialProfileId === null || !f.routingCredentialIds.includes(f.credentialProfileId)) return { kind: 'refused', reason: R.credentialRefused }
  const model = routingBaseModelId(normalizeTeamModel(f.model))
  if (!f.registrySlugs.includes(model)) return { kind: 'refused', reason: R.unknownModel }
  return { kind: 'routed', model, tier: f.tier, credentialProfileId: f.credentialProfileId }
}

// ── Before each attempt (K8, C2) ──

/**
 * C2: why a routed helper attempt was refused, from main's own RoutingError (`code`, `message`). `model` is the base
 * slug. `maxAgeMinutes` is the settings' snapshotMaxAgeMinutes, read by the port only for SNAPSHOT_STALE; null (the
 * settings could not be read) falls back to the generic text, which carries main's own message.
 */
export function helperAttemptRefusal(
  tier: RoutingLaunchTier,
  model: string,
  code: RoutingErrorCode,
  message: string,
  maxAgeMinutes: number | null
): string {
  const label = LAUNCH_TIER_LABELS[tier]
  const refused = `${label} routing refused this helper attempt:`
  if (code === 'NO_SNAPSHOT') {
    return `${refused} no endpoint numbers are stored for ${model}. Refresh them in Settings → Model routing, then revise the task.`
  }
  if (code === 'SNAPSHOT_STALE' && maxAgeMinutes !== null) {
    return `${refused} the endpoint numbers for ${model} are more than ${maxAgeMinutes} minutes old. Refresh them in Settings → Model routing, or turn on background observation there to keep them fresh, then revise the task.`
  }
  if (code === 'TIER_EMPTY') {
    return `${refused} no endpoint for ${model} meets the ${label} rules right now. Revise the task to a helper on another tier, or refresh later.`
  }
  return `${label} routing could not be resolved for this helper attempt: ${message}`
}

// ── The helper's OpenCode model entry (K6, K7) ──

/**
 * K7: the `provider.openrouter.models[sentModelId]` entry a routed helper declares: `{ options: { provider }, ...measured }`
 * — the selection's provider object first, then the measured keys (today `variants.low` on the `:nitro` id) unchanged.
 * Nitro under dataCollection 'allow' (provider null) adds nothing. A measured entry that already declares `options`
 * throws (the adapter's never does) rather than silently replacing either half.
 */
export function helperRoutedModelEntry(
  selection: RoutingLaunchSelection,
  measuredEntry: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  if (Object.prototype.hasOwnProperty.call(measuredEntry, 'options')) throw new Error('A measured helper model entry already declares options.')
  const measured = JSON.parse(JSON.stringify(measuredEntry)) as Record<string, unknown>
  if (selection.provider === null) return measured
  const provider = JSON.parse(JSON.stringify(selection.provider)) as OpenRouterProviderPrefs
  return { options: { provider }, ...measured }
}

// ── A routed attempt's provider error (K12, C3) ──

/** `a`; `a and b`; `a, b and c` (no serial comma). */
function tagList(tags: readonly string[]): string {
  if (tags.length <= 1) return tags.join('')
  return `${tags.slice(0, -1).join(', ')} and ${tags[tags.length - 1]}`
}

/** C3: appended, after one space, to the parser's text when a routed attempt ends with OpenCode's generic provider error. */
export function routedHelperFailureNote(selection: RoutingLaunchSelection): string {
  const never = "Chorus never changes a helper's tier on its own."
  if (selection.tier === 'nitro') return `This attempt used the Nitro tier, which leaves the provider to OpenRouter. ${never}`
  return `This attempt used the ${LAUNCH_TIER_LABELS[selection.tier]} tier, pinned to ${tagList(selection.endpoints)} with no fallback. If those providers were unavailable, refresh the numbers in Settings → Model routing and revise the task: each attempt resolves its tier again. A helper on another tier can also take the revision. ${never}`
}
```

Rules (normative):

- **`planHelperRouting` reads facts only.** It never decides "available"; its caller (Task 4b-2's port) does, from one read of `RoutingService.credentials()` and `models()`. The model normalisation is exactly `routingBaseModelId(normalizeTeamModel(model))`: one `openrouter/` prefix (only when the rest still contains `/`), surrounding whitespace, and one trailing `:nitro`. A doubly prefixed or doubly suffixed model is `unknownModel` (HR3).
- **`helperAttemptRefusal`** names the **base** slug and the tier's label from `LAUNCH_TIER_LABELS`; `Settings → Model routing` uses U+2192. Task 4b-2 appends ` This attempt was consumed.` through the existing `preparation-failed` path (`teamService.ts:457–458`); this core never does.
- **`helperRoutedModelEntry`** keeps `buildRankedProvider`'s key order (a JSON deep copy) and the measured entry's key order, `options` first (HR6).
- **`routedHelperFailureNote`** applies to any tier; Task 4b-2 calls it only for a recorded `routing` and a `provider-error` failure (K12).

## `routingService.ts` (C5)

```ts
/** K4: a launch is ranked as an interactive session unless its request names a profile (Phase 4b K5: a Team helper attempt ranks 'helper'). */
const LAUNCH_PROFILE: RoutingProfileId = 'interactive'

  /**
   * Phase 4a (K2, K4, MR-D26, C2): the selection one launch uses — routing:tiers' computation for the launch's own
   * credential, profile and effort. The profile is the request's (Phase 4b C5: 'helper' for a Team helper attempt),
   * absent = 'interactive'. No network, no decrypt, no credential row. Nitro reads no store file.
   */
  resolveLaunch(request: RoutingLaunchRequest): RoutingLaunchSelection {
    // … unchanged except, at :392:
        if (stored !== null) result = this.rank({ model: entry, ...stored, profile: q.profile ?? LAUNCH_PROFILE, effort: q.effort, settings, now })
```

Nothing else changes: the same parse (an unknown or `null` profile is `INVALID_REQUEST`, V64), registry check, `assertLive`, one settings read, one clock read (V65), the same stored-input reads in the same order, the same refusals and the same output parse. Nitro ignores the profile and reads no store file (V62).

## `helpers/types.ts`

```ts
import type { RoutingLaunchSelection } from '../../../shared/routing' // after :1

  // in HelperExecutionInput, after allowedCommands (:41)
  /** Model Routing Phase 4b (K3, K6): this attempt's resolved selection, set by main (TeamService) only and read only by
   * the OpenCode helper. Absent = unrouted: the request is byte-identical to before. */
  routing?: RoutingLaunchSelection
```

LF file: the four new lines are LF.

## `helpers/opencode.ts` (K6, K7, C6)

```ts
import { routingBaseModelId } from '../../../shared/routing'            // after the teamProfiles import (:5)
import { helperRoutedModelEntry } from '../../routing/helperRoutingCore'

    // :16 `const modelId = normalizeTeamModel(input.model)` becomes:
    // Model Routing Phase 4b (K6, C6): a routed attempt sends its selection's id — the base slug for a ranked tier,
    // `<base>:nitro` for Nitro — and `--model`, the model entry and the measured options below are computed from it.
    // No routing: the member's own id and today's request, byte for byte.
    const memberModelId = normalizeTeamModel(input.model)
    if (input.routing && routingBaseModelId(memberModelId) !== input.routing.model) throw new Error('Helper routing does not match its model.')
    const modelId = input.routing?.sentModelId ?? memberModelId

    // :24
    const measuredCodeHelper = input.kind === 'code' && measuredVersion && isDeepSeekFlashHelperModel(input.routing ? modelId : input.model) && input.effort === 'low'

    // :42, inside OPENCODE_CONFIG_CONTENT, only the models entry changes:
    provider: { openrouter: { models: { [modelId]: input.routing ? helperRoutedModelEntry(input.routing, modelOptions) : modelOptions } } },
```

`const model = \`openrouter/${modelId}\`` (:17), `modelOptions` (:21–23: `variants.low` exactly when `modelId === defaultTeamHelperModel` on a measured version), the argv, `share`, `agent`, `permission` and every other line are unchanged; because they read `modelId`, they now follow the sent id.

Rules (normative):

- **Unrouted is byte-identical (C6).** With `routing` absent, `modelId` is today's value and `measuredCodeHelper` reads `input.model` exactly as today. It must **not** read `modelId` when unrouted: `normalizeTeamModel` is not idempotent on `openrouter/openrouter/…` (it strips one prefix per call), so `isDeepSeekFlashHelperModel(modelId)` would differ from today's `isDeepSeekFlashHelperModel(input.model)` for such a member. Verified in scratch: 540 unrouted inputs (9 models × 5 versions × 3 efforts × 2 kinds × 2 command lists) built identical JSON on the proposed and the `70d5dda` builder, and the `:nitro` content's SHA-256 is `a76a7ac9375b2cda7db4d8a2fb393f306a117f47a629d78cd03a0304c7770bd0` (1,498 bytes) on both.
- **Routed (K6).** The sent id is the selection's `sentModelId`: the base slug for Budget, Balanced and Fast (a `:nitro` member's suffix dropped), `<base>:nitro` for Nitro (a standard member gains it). `--model openrouter/<sent>`; the entry is keyed by the sent id; `variants.low` is declared exactly when the sent id is the `:nitro` default on a measured version, so a standard member on Nitro keeps `low` (MR-D4) and a `:nitro` member on Balanced declares none; `--agent build` and the 64k cap follow `isDeepSeekFlashHelperModel(sent id)` as before.
- **Mismatch (K7).** A selection whose `model` is not the member's base slug throws `Helper routing does not match its model.` before anything else is built (HO6).
- **Only here.** `routing` reaches no file, no argv and no log: it is merged into this process's `OPENCODE_CONFIG_CONTENT` only (MR-D3). Claude and Codex ignore it (HO8). `composeHelperEnv`'s allow-list already admits `OPENCODE_CONFIG_CONTENT` (`common.ts:23`).

## `helpers/common.ts` — the probe (K15), byte-wise

The file is mixed (lines 21 and 22 end in a lone LF). Edit it with a scratch Node script that reads the bytes, asserts the starting counts (9,363 bytes; 95 CRLF; 2 LF at lines 21 and 22; 0 CR), finds the CRLF anchor below exactly once (it starts at line 82, byte 8,192), splices the replacement with CRLF endings, writes, and reports the counts after. Never open it in the `Edit` tool.

Anchor (lines 82–86, each ending CRLF):

```ts
    const run = (args: string[]) => new Promise<string>((resolve, reject) => {
      execFile(cli.file, [...cli.args, ...args], { windowsHide: true, signal, timeout: 10000, maxBuffer: MAX_HELPER_RECORD_BYTES }, (err, stdout) => err ? reject(err) : resolve(stdout))
    })
    result.version = (await run(['--version'])).trim().split(/\r?\n/)[0]
    const help = await run(id === 'claude' ? ['--help'] : [id === 'codex' ? 'exec' : 'run', '--help'])
```

Replacement (each line ending CRLF):

```ts
    const run = (args: string[], withStderr = false) => new Promise<string>((resolve, reject) => {
      execFile(cli.file, [...cli.args, ...args], { windowsHide: true, signal, timeout: 10000, maxBuffer: MAX_HELPER_RECORD_BYTES }, (err, stdout, stderr) => err ? reject(err) : resolve(withStderr ? stdout + stderr : stdout))
    })
    result.version = (await run(['--version'])).trim().split(/\r?\n/)[0]
    // K15 (Model Routing Phase 4b): OpenCode 1.18.34 prints `run --help` on stderr (0 bytes on stdout), so the help
    // call reads both streams. `--version` stays stdout-only: a warning on stderr can never become the version.
    const help = await run(id === 'claude' ? ['--help'] : [id === 'codex' ? 'exec' : 'run', '--help'], true)
```

Expected after (computed by running exactly this splice on a copy of the `70d5dda` bytes): 9,660 bytes, 97 CRLF, 2 LF (still lines 21 and 22), 0 CR, 99 lines; `git ls-files --eol` still `w/mixed`.

Rules (normative): the help call reads `stdout + stderr` for **all three** CLIs (Claude and Codex print help on stdout, so for them nothing changes, PR5); `--version` stays stdout-only (PR3). Diagnostic only: `applyVerifiedHelperEvidence` (`evidence.ts:46–59`) promotes evidence only for `VERIFIED_HELPER_VERSIONS` (1.18.31 for OpenCode), so on 1.18.33 and 1.18.34 `structured` becomes `verified` and nothing else changes (PR2). No admission changes; `capabilities()` and `validateMember` do not read `structured`.

## `scripts/verify-routing-body.mjs` — the helper half (C17, MR-G2, MR-G3)

The TUI half (`runTui`, the eight TUI cases, checks 5–16 of today) is unchanged. The bundle `ENTRY` (:37–48) is unchanged: `opencodeHelper`, `resolveLaunchSelection` and `computeTiers` are already exported. Edits, by anchor line at `70d5dda` (CRLF: every new line CRLF):

| Line(s) | Change |
|---|---|
| :1 | `…extended by Phase 4a (ImplementationSpec-4a-2) and Phase 4b (ImplementationSpec-4b-1).` |
| before :7 | Four comment lines: "The helper cases are built by Chorus's REAL helper builder (`opencodeHelper.buildExecution`) with a REAL helper-profile selection (`resolveLaunchSelection` on the golden helper `TierResult`): a `:nitro` member on Balanced, a standard member on Nitro, and an unrouted `:nitro` control (Phase 4b, K6/K7); nothing is patched into their model entries." |
| :64 | `ROUTE` (a hand-picked order, now unused) is replaced by `HELPER_BALANCED_PROVIDER` and `EXPECTED_HELPER` (below). `DENY` (:65) stays. |
| :84 | `const helperRuns = {}` after `const tuiRuns = {}`. |
| :88–98 | `helperRequest` as below. |
| :107, :109 | `runHelper(name, memberModel, routing)` → `helperRequest(memberModel, routing)`; the rest of `runHelper` (`composeHelperEnv`, `NO_AUTOUPDATE`, isolated XDG, `assertNoAutoupdate`, the spawn and the `MARK` wait) is unchanged. |
| :212–228 | The golden: a `rank(profile)` helper over the same inputs; `golden = rank('interactive')` (unchanged meaning), `goldenHelper = rank('helper')`; `resolveOn(result, tier)`; `BALANCED`, `NITRO_SEL` as before; `HELPER_BALANCED`, `HELPER_NITRO` from `goldenHelper`. |
| :238–239 | The three helper cases (below). |
| :251 | `const a = main('helper-routed'), b = main('helper-nitro'), u = main('helper-unrouted'), c = …` (the rest unchanged). |
| before :255 | `HELPER_NAMES`, `after`, `helperAs` (below). |
| :256, :258 | Checks 1 and 3 as below. |
| after :259 | Checks 5 and 6 (below). |
| :276 | The report gains `helperRuns` after `requests`. |

```js
// Hand-written expectations (never computed by the code under test): ImplementationSpec-4b-1, K7 — the helper
// profile's golden Balanced provider object, and the `--model` and model entry each helper case must send.
const HELPER_BALANCED_PROVIDER = { order: ['streamlake/fp8', 'venice/fp8', 'gmicloud/fp8'], allow_fallbacks: false, require_parameters: true, quantizations: ['fp8'], data_collection: 'deny' }
const EXPECTED_HELPER = {
  'helper-routed': { model: 'openrouter/deepseek/deepseek-v4.1-flash', models: '{"deepseek/deepseek-v4.1-flash":{"options":{"provider":{"order":["streamlake/fp8","venice/fp8","gmicloud/fp8"],"allow_fallbacks":false,"require_parameters":true,"quantizations":["fp8"],"data_collection":"deny"}}}}' },
  'helper-nitro': { model: 'openrouter/deepseek/deepseek-v4.1-flash:nitro', models: '{"deepseek/deepseek-v4.1-flash:nitro":{"options":{"provider":{"data_collection":"deny"}},"variants":{"low":{"reasoning":{"effort":"low"}}}}}' },
  'helper-unrouted': { model: 'openrouter/deepseek/deepseek-v4.1-flash:nitro', models: '{"deepseek/deepseek-v4.1-flash:nitro":{"variants":{"low":{"reasoning":{"effort":"low"}}}}}' }
}

function helperRequest(memberModel, routing) {
  // The DETECTED version, exactly as Team does in production: checks 1–6 fail on a binary the
  // helper gate has not measured instead of passing on a hard-coded one (hotfix 0.9.1).
  // `routing` is a real helper-profile selection, or null for the unrouted control (Phase 4b):
  // the builder itself computes --model, the model entry and the measured options from it.
  const request = opencodeHelper.buildExecution({ attemptId: condition, cwd: evidence, kind: 'code', brief: `Respond ${MARK} without tools.`, model: memberModel, installedVersion: version, effort: 'low', route: { baseUrl: 'https://openrouter.ai/api/v1' }, credential: { envVarName: 'OPENROUTER_API_KEY', value: 'loopback-placeholder' }, allowedCommands: [], ...(routing ? { routing } : {}), signal: new AbortController().signal })
  const config = JSON.parse(request.envAdditions.OPENCODE_CONFIG_CONTENT)
  helperRuns[condition] = { args: [...request.args], models: JSON.stringify(config.provider.openrouter.models) }
  // The one harness patch (MR-G2): OpenRouter at the loopback stand-in. The models entry is the builder's, untouched.
  config.provider.openrouter.options = { baseURL }
  request.envAdditions.OPENCODE_CONFIG_CONTENT = JSON.stringify(config)
  return request
}

  // :212–228
  const rank = profile => computeTiers({
    model,
    snapshot,
    history: extractObservations(snapshot),
    account: { guardrailRemoved: fixture.guardrailRemoved, dataPolicyRemoved: fixture.dataPolicyDenyRemoved, checkedAt: CHECKED_AT },
    cache: Object.fromEntries(Object.entries(fixture.cacheVerified).map(([tag, verified]) => [tag, { verified, checkedAt: CHECKED_AT }])),
    profile,
    effort: 'low',
    settings: DEFAULT_ROUTING_SETTINGS,
    now: AT
  })
  // Interactive for the TUI cases (Phase 4a, K4); helper for the helper cases (Phase 4b, K5).
  const golden = rank('interactive'), goldenHelper = rank('helper')
  const resolveOn = (result, tier) => {
    const r = resolveLaunchSelection({ tier, model: SLUG, result, settings: DEFAULT_ROUTING_SETTINGS, computedAt: AT })
    if (!r.ok) throw Error(`The golden ${result.profile} ${tier} selection did not resolve: ${r.code}`)
    return r.selection
  }
  const BALANCED = resolveOn(golden, 'balanced'), NITRO_SEL = resolveOn(golden, 'nitro')
  const HELPER_BALANCED = resolveOn(goldenHelper, 'balanced'), HELPER_NITRO = resolveOn(goldenHelper, 'nitro')

  // :238–239
  // Phase 4b (K6): a ranked tier sends the BASE slug (a :nitro member's suffix dropped); Nitro sends <base>:nitro.
  await runHelper('helper-routed', NITRO, HELPER_BALANCED)
  await runHelper('helper-nitro', SLUG, HELPER_NITRO)
  await runHelper('helper-unrouted', NITRO, null)

  // before :255
  const HELPER_NAMES = ['helper-routed', 'helper-nitro', 'helper-unrouted']
  const after = (args, flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : null
  const helperAs = n => { const r = helperRuns[n]; return { model: after(r.args, '--model'), agent: after(r.args, '--agent'), variant: after(r.args, '--variant'), models: r.models } }
```

**Checks** (18, in this order; `a`, `b`, `u` are the main requests of `helper-routed`, `helper-nitro`, `helper-unrouted`, found as today by condition and `r.model` ∈ {`SLUG`, `NITRO`}):

| # | Name (exact) | Passes when |
|---|---|---|
| 1 | `helper base slug carries the exact provider object` | `a?.model === SLUG && isDeepStrictEqual(a.provider, HELPER_BALANCED_PROVIDER) && isDeepStrictEqual(a.provider, HELPER_BALANCED.provider)`; detail `{ model, provider }`. |
| 2 | `helper base slug keeps low effort and the 64k cap` | Unchanged expression: `a?.reasoning?.effort === 'low' && a?.max_tokens === 64000`. |
| 3 | `helper :nitro carries data_collection deny` | `b?.model === NITRO && isDeepStrictEqual(b.provider, DENY)`. |
| 4 | `helper :nitro keeps low effort and the 64k cap` | Unchanged expression on `b` (its `low` arrives through the declared variant: the member is standard, the sent id `:nitro`). |
| 5 | `real builders: the helper model entries and --model are the golden ones` | For each of `HELPER_NAMES`: `isDeepStrictEqual(helperAs(n), { model: EXPECTED_HELPER[n].model, agent: 'build', variant: 'low', models: EXPECTED_HELPER[n].models })`. |
| 6 | `unrouted helper: :nitro, no provider object, low effort, the 64k cap` | `u?.model === NITRO && u.provider === null && u.reasoning?.effort === 'low' && u.max_tokens === 64000`. |
| 7–18 | Today's checks 5–16, names and expressions unchanged | As in ImplementationSpec-4a-2 (the TUI cases). |

The final line becomes `PASS (18 checks)` (it is `checks.length`, :293). Cleanup, isolation (`isolated()` per helper run: its own `XDG_STATE_HOME` and `XDG_DATA_HOME`, MR-G3), `OPENCODE_DISABLE_AUTOUPDATE=true` on every spawn, the version precondition (`isVerifiedOpencodeStateVersion`, :205) and the stdout-only report are unchanged. Expected after (computed by applying exactly these edits to a copy): 320 lines, 28,817 bytes as CRLF; `node --check` passes; 18 `expect(` calls.

**Why these expectations hold on OpenCode 1.18.34 (zero-cost evidence):** check 1's entry is today's `helper-routed` shape (an `options.provider` entry on the base slug, which today's check 1 already proves arrives exactly), now from the real builder with the helper order and `data_collection: 'deny'`; check 4's entry is today's `helper-nitro-deny` shape (`variants.low` plus `options.provider`, key order now `options` first, which OpenCode's merge ignores); check 6 is today's production request for the default `:nitro` slot, measured on 1.18.33 and 1.18.34 (`opencode.ts:18–20`). The run itself is the implementer's MR-G2 proof.

## Test cases

Shared literals: `SLUG = 'deepseek/deepseek-v4.1-flash'`; `NITRO = SLUG + ':nitro'`; `C = '5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab'`; `D = '0b6d2c4e-1f3a-4b5c-8d7e-9f0a1b2c3d4e'`; `AT = '2026-10-02T09:20:00Z'`; `FETCHED = '2026-10-02T09:05:00Z'`; `PROVIDER(order) = { order, allow_fallbacks: false, require_parameters: true, quantizations: ['fp8'], data_collection: 'deny' }`; `HELPER_BALANCED = { tier: 'balanced', model: SLUG, sentModelId: SLUG, provider: PROVIDER(['streamlake/fp8','venice/fp8','gmicloud/fp8']), endpoints: ['streamlake/fp8','venice/fp8','gmicloud/fp8'], computedAt: AT, snapshotFetchedAt: FETCHED }`; `HELPER_NITRO = { tier: 'nitro', model: SLUG, sentModelId: NITRO, provider: { data_collection: 'deny' }, endpoints: [], computedAt: AT, snapshotFetchedAt: null }`; `NITRO_ALLOW = { ...HELPER_NITRO, provider: null }`; `LOW = { variants: { low: { reasoning: { effort: 'low' } } } }`; `TAIL = " with no fallback. If those providers were unavailable, refresh the numbers in Settings → Model routing and revise the task: each attempt resolves its tier again. A helper on another tier can also take the revision. Chorus never changes a helper's tier on its own."`. Key-shaped strings, if any, are built by concatenation.

**How every expected value was computed** (2026-10-05, nothing committed): a scratch mirror of the tracked tree at `70d5dda` (`git ls-files` copied into the scratchpad, `node_modules` junctioned) received exactly the edits in this specification; the cores were bundled with esbuild and run (the helper `TierResult` through `computeTiers` with `routingIpc.test.ts`'s recipe at `AT`, the selections through `resolveLaunchSelection`, the proposed builder and probe, and the proposed `RoutingService` over a real `RoutingStore` seeded with the fixture). Each table below was then written as vitest code in the mirror and run there: S8 (2), V5 (7), HR (7), TS (7), HO (8) and PR (6) all pass; `npm run typecheck`'s two commands pass on the mirror; the full suite reports 147 files and 4,273 tests with only three `councilCore.test.ts` rows failing, all three because the mirror has no `docs/` directory (they read brief fixtures from it), which the real checkout has.

**Table S8 — `src/shared/routing.test.ts`** (`valid = { model: SLUG, tier: 'balanced', effort: 'low', credentialProfileId: C }`).

| # | Case | Expect |
|---|---|---|
| S8-1 | Parse `{ ...valid, profile: 'helper' }`; `{ ...valid, profile: 'interactive' }`; `valid` | Each strictly equals its input; the third has no `profile` key (`'profile' in parsed` is `false`). |
| S8-2 | `profile` = `'team'`, `null`, `'Helper'`, `''`, `1`; `{ ...valid, profile: 'helper', extra: 1 }` | All six fail. |

**Table V5 — `routingService.test.ts`** (appended; `helper(h, over)` calls `resolveLaunch({ model: SLUG, tier: 'balanced', effort: 'low', credentialProfileId: C, profile: 'helper', ...over })` and pushes the value to `h.results`, so the V19 audit covers it; `bare(h, tier)` calls it with **no** `profile` key; "after a refresh" is `await h.refresh()` at `NOW`).

| # | Case | Expect |
|---|---|---|
| V60 | After a refresh, clear the two credential-read mocks: `helper(h, { tier })` for `budget`, `balanced`, `fast` | Each strictly `{ tier, model: SLUG, sentModelId: SLUG, provider: PROVIDER(GOLDEN_TIERS.helper[tier]), endpoints: GOLDEN_TIERS.helper[tier], computedAt: NOW, snapshotFetchedAt: NOW }` (Budget `streamlake → deepinfra → gmicloud`, Balanced `streamlake → venice → gmicloud`, Fast `venice → baidu → parasail`); each provider strictly equals `h.tiers({ profile: 'helper' }).tiers[tier]?.provider`; each parses back strictly; `h.requests` 45, `h.events` 18, `h.decrypts` `[C]`; `getCredentialProfileById` and `getProviderConfigById` not called. |
| V61 | After a refresh: `helper(h, { tier, profile: 'interactive' })` vs `bare(h, tier)` for all four tiers; `bare(h, 'balanced')`; `helper(h)` | Strictly equal pairs; `GOLDEN_TIERS.interactive.balanced` (`deepinfra → streamlake → makora`); `GOLDEN_TIERS.helper.balanced`. |
| V62 | Fresh harness whose store wraps the four ranking reads in one `vi.fn`: `helper(h, { tier: 'nitro' })`; `bare(h, 'nitro')` | `{ tier: 'nitro', model: SLUG, sentModelId: SLUG + ':nitro', provider: { data_collection: 'deny' }, endpoints: [], computedAt: NOW, snapshotFetchedAt: null }`, strictly equal to the bare one; the read spy never called. |
| V63 | Fresh harness: each ranked tier. Second harness after a refresh: clock `'2026-10-02T10:20:00Z'`, Balanced; `'…10:20:00.001Z'`, Balanced and Nitro; at that clock with `budgetMinTps: 100000`, Budget; clock `NOW`, Budget, Balanced; then `minUptimePct: 100, readmitUptimePct: 100`, Balanced and Fast | `NO_SNAPSHOT` `No endpoint snapshot is stored for this model yet. Refresh first.` ×3; ok with that `computedAt`; `SNAPSHOT_STALE` `The endpoint snapshot for this model is more than 60 minutes old. Refresh first.`, Nitro ok at `…10:20:00.001Z`; `SNAPSHOT_STALE` (stale before empty); `TIER_EMPTY` `Budget has no eligible endpoints. Choose another tier or OpenRouter default.`, Balanced `GOLDEN_TIERS.helper.balanced`; `TIER_EMPTY` with the Balanced and Fast texts. |
| V64 | After a refresh, a `readSnapshot` spy cleared: `profile` = `'team'`, `null`, `'Helper'` | Each `INVALID_REQUEST`, `Invalid routing request.`; the spy not called. |
| V65 | `makeHarness({ now: counting })`; after a refresh reset the count; `helper(h)`; reset; `helper(h, { tier: 'nitro' })` | One clock read each. |
| V66 | After a refresh: `Object.keys(helper(h))`; `JSON.stringify(helper(h))`; `helper(h, { effort: null })`; `helper(h, { credentialProfileId: UNKNOWN_ID })` | `['tier','model','sentModelId','provider','endpoints','computedAt','snapshotFetchedAt']`; does not contain `helper`; both orders `GOLDEN_TIERS.helper.balanced` (this fixture gives the same order for a null effort and an absent account file). |

**Table HR — `helperRoutingCore.test.ts`.**

| # | Case | Expect |
|---|---|---|
| HR1 | `HELPER_ROUTING_REFUSALS` | Strictly the four C1 texts (as in the code above). |
| HR2 | `BASE = { harness: 'opencode', authMode: 'api_key', tier: 'balanced', credentialProfileId: C, model: NITRO, routingAvailable: true, routingCredentialIds: [C], registrySlugs: [SLUG] }`; `model` = `SLUG`, `'openrouter/' + NITRO`, `'  ' + NITRO + ' '`; `tier: 'nitro'`; `tier: null`; `tier: null` with `harness: 'codex', routingAvailable: false` | `{ kind: 'routed', model: SLUG, tier: 'balanced', credentialProfileId: C }` for the first four; routed with `tier: 'nitro'`; `{ kind: 'unrouted' }` twice. |
| HR3 | `BASE` with `tier: 'fast'`, one change per row: `harness` `codex`, `claude`; `authMode: 'subscription'`; `routingAvailable: false`; `credentialProfileId` `null`, `D`; `model` `'z-ai/glm-5.3'`, `NITRO + ':nitro'`, `SLUG + ':free'`, `'openrouter/openrouter/' + SLUG`; `{ codex, unavailable, null }`; `{ unavailable, null, GLM }`; `{ D, GLM }` | `notOpencode` ×3; `unavailable`; `credentialRefused` ×2; `unknownModel` ×4; `notOpencode`; `unavailable`; `credentialRefused` (first failure wins). Each `{ kind: 'refused', reason }` with the exact text. |
| HR4 | `helperAttemptRefusal(...)`: `('balanced', SLUG, 'NO_SNAPSHOT', …, null)`; `('balanced', SLUG, 'NO_SNAPSHOT', 'x', 45)`; `('balanced', SLUG, 'SNAPSHOT_STALE', …, 60)`; `('fast', SLUG, 'SNAPSHOT_STALE', …, 45)`; `('balanced', SLUG, 'SNAPSHOT_STALE', 'The endpoint snapshot for this model is more than 60 minutes old. Refresh first.', null)`; `('budget', SLUG, 'TIER_EMPTY', …, null)`; `('nitro', SLUG, 'OPERATION_FAILED', 'Routing has stopped.', null)`; `INVALID_TIME` (Balanced) and `INVALID_REQUEST` (Fast) with main's messages | `Balanced routing refused this helper attempt: no endpoint numbers are stored for deepseek/deepseek-v4.1-flash. Refresh them in Settings → Model routing, then revise the task.` (twice: the message and N are ignored); `Balanced routing refused this helper attempt: the endpoint numbers for deepseek/deepseek-v4.1-flash are more than 60 minutes old. Refresh them in Settings → Model routing, or turn on background observation there to keep them fresh, then revise the task.`; the same with `Fast` and `45`; `Balanced routing could not be resolved for this helper attempt: The endpoint snapshot for this model is more than 60 minutes old. Refresh first.`; `Budget routing refused this helper attempt: no endpoint for deepseek/deepseek-v4.1-flash meets the Budget rules right now. Revise the task to a helper on another tier, or refresh later.`; `Nitro routing could not be resolved for this helper attempt: Routing has stopped.`; `Balanced routing could not be resolved for this helper attempt: The stored snapshot is newer than the current time; refresh again.`; `Fast routing could not be resolved for this helper attempt: Invalid routing request.` |
| HR5 | `routedHelperFailureNote` on `HELPER_BALANCED`; Balanced `['venice/fp8']`; Budget `['streamlake/fp8','deepinfra/fp8']`; Fast `['a/fp8','b/fp8','c/fp8','d/fp8']`; `HELPER_NITRO`; `NITRO_ALLOW` | `'This attempt used the Balanced tier, pinned to streamlake/fp8, venice/fp8 and gmicloud/fp8' + TAIL`; `'… Balanced tier, pinned to venice/fp8' + TAIL`; `'… Budget tier, pinned to streamlake/fp8 and deepinfra/fp8' + TAIL`; `'… Fast tier, pinned to a/fp8, b/fp8, c/fp8 and d/fp8' + TAIL`; `This attempt used the Nitro tier, which leaves the provider to OpenRouter. Chorus never changes a helper's tier on its own.` (twice). |
| HR6 | `JSON.stringify(helperRoutedModelEntry(…))` for `(HELPER_BALANCED, {})`, `(HELPER_NITRO, LOW)`, `(NITRO_ALLOW, LOW)`, `(NITRO_ALLOW, {})`; `Object.keys` of `(HELPER_BALANCED, LOW)`; mutate a result's `options.provider.order` and `variants.low.reasoning.effort`; `(HELPER_BALANCED, { options: {} })` | `{"options":{"provider":{"order":["streamlake/fp8","venice/fp8","gmicloud/fp8"],"allow_fallbacks":false,"require_parameters":true,"quantizations":["fp8"],"data_collection":"deny"}}}`; `{"options":{"provider":{"data_collection":"deny"}},"variants":{"low":{"reasoning":{"effort":"low"}}}}`; `{"variants":{"low":{"reasoning":{"effort":"low"}}}}`; `{}`; `['options','variants']`; the selection and the measured input unchanged; throws `A measured helper model entry already declares options.` |
| HR7 | `teamMemberSchema.safeParse` of a Codex subscription member with `routingTier: 'balanced'`; `routingLaunchSelectionSchema.parse` of the three fixtures | Fails with exactly `[HELPER_ROUTING_REFUSALS.notOpencode]`; each parses back strictly. |

**Table TS — `src/shared/team.test.ts`** (`HELPER` is the DeepSeek Nitro capability option's member shape: `{ id, label: 'DeepSeek Flash Nitro', harness: 'opencode', authMode: 'api_key', providerId, credentialProfileId, model: NITRO, effort: 'low', installedVersion: '1.18.34', customModel: true }`; `LEAD` a Claude 2.1.278 subscription member; `CODEX` a Codex 0.155.1 subscription member; `ATTEMPT` a reserved attempt in `reserveNextAttempt`'s shape with no `routing`; `NOT_OPENCODE` the C1 text).

| # | Case | Expect |
|---|---|---|
| TS1 | `HELPER` with each of the four tiers; `Object.keys` of `parse({ routingTier: 'nitro', ...HELPER })`; `parse(HELPER)` | Each keeps its tier; the last key is `routingTier`; no `routingTier` key, and `JSON.stringify(parse(HELPER)) === JSON.stringify(HELPER)`. |
| TS2 | `routingTier` = `'default'`, `'turbo'`, `null`, `''`, `'Balanced'` | Each fails with one issue at path `['routingTier']`. |
| TS3 | A tier on `CODEX`, on `LEAD`, on an OpenCode **subscription** member | Each fails with exactly `[NOT_OPENCODE]`. |
| TS4 | `{ ...HELPER, routing: <the Balanced selection> }` | Fails with one `unrecognized_keys` issue. |
| TS5 | `teamRunConfigSchema` with helpers `[Balanced, standard on Nitro, none]`; with `LEAD` carrying a tier; `teamLaunchSchema` with a Codex helper carrying `fast` | Tiers `['balanced', 'nitro', null]`; one issue `[['lead'], NOT_OPENCODE]`; one issue `[['config','helpers',0], NOT_OPENCODE]`. |
| TS6 | `teamAttemptSchema.parse(ATTEMPT)`; with the Balanced and the Nitro selection | No `routing` key and byte-identical JSON; each `routing` strictly equal, last key `routing`, JSON equal to the input's. |
| TS7 | `routing: null`; Balanced plus `extra: 1`; Balanced with `sentModelId: NITRO` | `['invalid_type']`; `['unrecognized_keys']`; `['selection fields disagree with its tier']`. |

**Table HO — `helpers.test.ts`** (appended; uses the file's `input()` and its mocked `resolveCli`; `API = { installedVersion: '1.18.34', effort: 'low', credential, route }` with the gateway route; `build(over) = helperRegistry.opencode.buildExecution(input({ ...API, ...over }))`; `models(r)` is `JSON.stringify` of the content's `provider.openrouter.models`; `ARGS(sent, measured = true) = ['run','--pure','--format','json','--model','openrouter/' + sent, ...(measured ? ['--agent','build'] : []), '--variant','low']`; `ENTRY.*` are the hand-written strings of K7 and the Grounding).

| # | Case | Expect |
|---|---|---|
| HO1 | Unrouted `NITRO` and `SLUG` members | `args` `ARGS(member)`; entries `{"deepseek/deepseek-v4.1-flash:nitro":{"variants":{"low":{"reasoning":{"effort":"low"}}}}}` and `{"deepseek/deepseek-v4.1-flash":{}}`; content keys `['share','agent','provider','permission']`; cap `'64000'`; `build({ model, routing: undefined })` strictly equals the request. |
| HO2 | `NITRO` member with `HELPER_BALANCED`, against the unrouted `NITRO` request | `ARGS(SLUG)`; entry `{"deepseek/deepseek-v4.1-flash":{"options":{"provider":{"order":["streamlake/fp8","venice/fp8","gmicloud/fp8"],"allow_fallbacks":false,"require_parameters":true,"quantizations":["fp8"],"data_collection":"deny"}}}}`; cap `'64000'`; content keys in today's order; `share`, `agent`, `permission` strictly equal to the unrouted request's; `executable`, `cwd`, `stdin`, `secretEnv`, `parserKind`, `permission` equal; argv contains no `data_collection`. |
| HO3 | `SLUG` member with `HELPER_NITRO` | `ARGS(NITRO)`; entry `{"deepseek/deepseek-v4.1-flash:nitro":{"options":{"provider":{"data_collection":"deny"}},"variants":{"low":{"reasoning":{"effort":"low"}}}}}`; cap `'64000'`. |
| HO4 | Balanced from `SLUG` vs from `NITRO`; Nitro from `NITRO` vs from `SLUG`; Balanced from `'openrouter/' + NITRO` | Strictly equal pairs (the two DeepSeek options differ only in their default tier, K6); HO2's entry. |
| HO5 | `SLUG` member with `NITRO_ALLOW` vs the unrouted `NITRO` request | Strictly equal. |
| HO6 | `'z-ai/glm-5.3'` member with `HELPER_BALANCED`; `NITRO` member with a selection for `z-ai/glm-5.3` | Both throw `Helper routing does not match its model.` |
| HO7 | `NITRO` + Balanced on `1.18.35`; `SLUG` + Nitro on `1.18.35`; `NITRO` + Balanced with `kind: 'analysis'` | `ARGS(SLUG, false)`, no cap, HO2's entry; entry `{"deepseek/deepseek-v4.1-flash:nitro":{"options":{"provider":{"data_collection":"deny"}}}}`; `ARGS(SLUG, false)`, no cap, `permission.edit` `'deny'`. |
| HO8 | Claude (`sonnet`) and Codex (`gpt-6-astra`) with and without `routing` | Strictly equal. |

**Table PR — `helpers/probe.test.ts`** (mocks `node:child_process` with an `execFile` that answers a table keyed by `args.join(' ')` and records each call, and `../../services/cliDetect` with `resolveCli(id) → { file: 'C:\\Program Files\\<id>.exe', args: [] }`; `HELP` is any text containing `--format`, standing in for OpenCode 1.18.34's 3,053-byte `run --help`, which goes to stderr).

| # | Case | Expect |
|---|---|---|
| PR1 | OpenCode: `--version` stdout `1.18.34\n`; `run --help` stdout `''`, stderr `HELP` | `version` `'1.18.34'`; `executable` `'C:\\Program Files\\opencode.exe'`; `structured` `{ status: 'verified', reason: '1.18.34: installed help advertises --format; this is syntax evidence only.' }`; `subscription` `{ status: 'unsupported', reason: 'No subscription account routing has been verified for this helper adapter.' }`; calls `[['--version'], ['run', '--help']]`, each with `windowsHide: true`, `timeout: 10000`, `maxBuffer: 1048576`. |
| PR2 | PR1's answers | `apiKey`, `analysis`, `code`, `cancellation`, `nativeSubagents` all `unverified`. |
| PR3 | `--version` stdout `1.18.34\n` plus stderr `Warning: a newer version is available\n`; then stdout `''`, stderr `1.18.34\n` | `'1.18.34'`; `''`. |
| PR4 | Help `usage` on both streams | `{ status: 'unsupported', reason: 'Installed help does not advertise --format.' }`. |
| PR5 | Codex `codex-cli 0.155.1`, `exec --help` stdout containing `--json`; Claude `2.1.278 (Claude Code)`, `--help` stdout containing `--output-format` | `{ status: 'verified', reason: 'codex-cli 0.155.1: installed help advertises --json; this is syntax evidence only.' }`; `{ status: 'verified', reason: '2.1.278 (Claude Code): installed help advertises --output-format; this is syntax evidence only.' }`. |
| PR6 | `--version` answers, the help call errors | `version` `'1.18.34'`; `structured` `{ status: 'unsupported', reason: 'CLI resolution/version/help probe failed.' }`. |

Scratch cross-check (not a test): the `70d5dda` probe on PR1's answers reports `structured` `unsupported` (`Installed help does not advertise --format.`), which is the defect K15 fixes.

## Golden values (computed, not typed)

The 2026-10-02 fixture through `computeTiers` with `routingIpc.test.ts`'s recipe at `AT`, effort `low`, `DEFAULT_ROUTING_SETTINGS`: helper Budget `streamlake/fp8 → deepinfra/fp8 → gmicloud/fp8`, Balanced `streamlake/fp8 → venice/fp8 → gmicloud/fp8`, Fast `venice/fp8 → baidu/fp8 → parasail/fp8` (equal to `GOLDEN_TIERS.helper`, `routingService.test.ts:79–90`); interactive Balanced `deepinfra/fp8 → streamlake/fp8 → makora/fp8`. `HELPER_BALANCED` above is `resolveLaunchSelection`'s output; its JSON is `{"tier":"balanced","model":"deepseek/deepseek-v4.1-flash","sentModelId":"deepseek/deepseek-v4.1-flash","provider":{"order":["streamlake/fp8","venice/fp8","gmicloud/fp8"],"allow_fallbacks":false,"require_parameters":true,"quantizations":["fp8"],"data_collection":"deny"},"endpoints":["streamlake/fp8","venice/fp8","gmicloud/fp8"],"computedAt":"2026-10-02T09:20:00Z","snapshotFetchedAt":"2026-10-02T09:05:00Z"}`. These are identical to the values the overview recorded at `0666f58`.

## Invariants

- An unrouted helper's request is byte-identical to today's for every member, version, effort and kind (C6); nothing sets `routing` until Task 4b-2.
- A routed helper's `--model`, model-entry key and measured options all name one id, the selection's `sentModelId` (K6); the provider object reaches only this process's `OPENCODE_CONFIG_CONTENT` (MR-D3).
- `resolveLaunch` with `profile: 'helper'` ranks exactly as `routing:tiers` does on the helper profile; without a profile every Phase 4a behaviour is unchanged; it still never decrypts, reads a credential row or sends a request (MR-G4).
- A member can carry a tier only as an OpenCode API-key helper; no member or run can carry a selection (K2, K9).
- `helperRoutingCore.ts` is pure; the purity and layering greps stay empty (MR-G8); no Phase 1–4a golden value changes; the ranker prints `PASS (30 checks)`.
- The probe's `--version` is stdout-only; admissions are unchanged (K15).

## Verification

```powershell
npm run typecheck
npx vitest run src/shared/routing.test.ts src/shared/team.test.ts src/main/routing/helperRoutingCore.test.ts src/main/services/routingService.test.ts src/main/adapters/helpers/helpers.test.ts src/main/adapters/helpers/probe.test.ts src/main/routing/launchCore.test.ts src/main/services/teamCore.test.ts
npm test
Get-ChildItem -Path src/main/routing, src/shared/routing.ts -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern 'Date\.now\(|Math\.random\(|new Date\(\)|from ''(node:|fs''|path''|electron|better-sqlite3)|require\('
Get-ChildItem -Path src/main/routing -Recurse -Include *.ts -Exclude *.test.ts | Select-String -Pattern "from '\.\./(services|db|adapters)/"
node scripts/verify-routing-ranker.mjs
$env:OPENCODE_DISABLE_AUTOUPDATE = 'true'; opencode --version
node scripts/verify-routing-body.mjs
npx electron-vite build
node scripts/verify-routing-ipc.mjs
npm run grep:secrets
git diff --check
git diff --stat -- src/shared/routing.ts src/shared/team.ts src/main/services/routingService.ts src/main/adapters/helpers/types.ts src/main/adapters/helpers/opencode.ts src/main/adapters/helpers/common.ts src/shared/routing.test.ts src/main/services/routingService.test.ts src/main/adapters/helpers/helpers.test.ts scripts/verify-routing-body.mjs
git ls-files --eol -- src/shared/routing.ts src/shared/team.ts src/main/services/routingService.ts src/main/adapters/helpers/types.ts src/main/adapters/helpers/opencode.ts src/main/adapters/helpers/common.ts src/shared/routing.test.ts src/main/services/routingService.test.ts src/main/adapters/helpers/helpers.test.ts scripts/verify-routing-body.mjs
git status --short
```

Both `Select-String` lines print nothing. `opencode --version` prints `1.18.34` (the body script refuses any version outside MR-D25's measured list). The body script ends `PASS (18 checks)`, exit 0, `providerTraffic: false`, no `%TEMP%\chorus-routing-body-*` left; paste its whole output. The IPC drive ends `PASS (20 checks)` (unchanged; it proves the build boots with the new `team.ts` value import). `npm run grep:secrets` runs after the body script deleted its bundle. **Line endings:** `git ls-files --eol` must still report `w/crlf` for every file above except `helpers/types.ts` (`w/lf`) and `helpers/common.ts` (`w/mixed`); with `core.autocrlf` true, `git diff --stat` cannot see a whole-file rewrite, so also compare byte and CRLF counts with the expected values in this specification (sources: `routing.ts` 32,798 bytes / 669 CRLF; `team.ts` 28,471 / 233; `routingService.ts` 44,272 / 1,010; `opencode.ts` 4,980 / 57; `types.ts` 3,296 bytes / 89 LF; `common.ts` 9,660 / 97 CRLF + 2 LF; `verify-routing-body.mjs` 28,817 / 320). The `Edit` tool can rewrite a CRLF file as LF: check after every edit and restore the endings if one changed. New files are LF. Record the vitest summary, every exit code, and that every pre-existing test in the touched files passed before the new tables were written.
