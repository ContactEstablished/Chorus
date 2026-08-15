import { NO_HARNESS_ADAPTER_TYPE } from '../../shared/ipc' // VALUE + TYPE-ONLY (D34(b))
import type { AdapterDescriptor } from '../../shared/ipc'
import type { AuthMethodDefinition } from './types'

/**
 * D84 (Task 3d-1): the declaration for a provider that NO LOCAL HARNESS RUNS.
 *
 * ⚠ THIS IS NOT AN `AgentAdapter` AND IT IS NOT IN `staticRegistry`. It has no
 * `buildLaunch`, no `detectInstallation`, and it can never produce a PTY. It
 * lives in its own file precisely so that distinction is STRUCTURAL rather than
 * a comment: `getAdapter('none')` returns `undefined`, `staticRegistry` still
 * has exactly two frozen entries, and `agentKindSchema` is still
 * `['claude','codex']`. Those two widen TOGETHER or not at all (D34 Q5 / D63
 * Q1 / F25) and this task widens neither.
 *
 * ⚠ AND IT RIDES `adapter:list` RATHER THAN BEING APPENDED IN A VUE FILE. The
 * renderer-side precedent is `MANAGEMENT_METHOD` in `SettingsProviders.vue` —
 * but that entry gets away with living there because it is a bare marker with
 * `requiredEnvVar: null` and no capabilities. This one carries a LABEL and an
 * ENV-VAR DEFAULT, which is exactly the hardcoding Task 3-3's `adapter:list`
 * exists to keep out of `.vue` files, and main has to agree with it anyway:
 * `resolveCredential` reads the same declaration when it resolves a
 * harness-less credential. One home, on the wire, read by both sides.
 *
 * The wire was already shaped for this and had no producer for it:
 * `adapterDescriptorSchema.id` is `z.string()` (not `agentKindSchema`) and
 * `executionMode` is `z.enum(['pty','api'])` — `'api'` had ZERO producers
 * before this file. Nothing in the schema changes.
 *
 * ⚠ WHAT IT DOES NOT LEAK INTO. `LaunchDialog.vue` builds its agent picker
 * from `cli:detect` rows filtered on `agentKind !== null`, NOT from
 * `adapter:list` — it consults `adapter:list` only to look an effort descriptor
 * up by id. So a harness-less descriptor cannot appear as something to launch.
 */

/**
 * ⚠ `requiredEnvVar` IS NON-NULL AND THAT IS REQUIRED BY THE RULING, not a
 * style choice. `resolveCredential` refuses outright when the resolved env var
 * name is null ("has no API-key environment variable configured"), and a
 * harness-less provider is resolved on the COUNCIL path — so a null default
 * would produce a provider that looks valid in Settings and dies at spend time,
 * which is the precise failure D84 exists to prevent.
 *
 * ⚠ AND IT IS METADATA ONLY ON THIS PATH. No child process exists to receive
 * it: the council's transport sends `Authorization: Bearer <minted key>`
 * (`apiSession.ts`) and `model:refresh` sends the key in a header too. The name
 * is carried so the credential handed to the transport is shaped honestly
 * rather than with an invented variable name (`MemberRoute.envVarName`).
 *
 * The value is OpenRouter's conventional name because that is the only gateway
 * a council run can spend on — `routeAcceptsMintedKey` refuses any route
 * outside it, so the single capped key that bounds the run stays valid. A
 * provider's own `env_var_name` overrides it (D34(e)), which is how a
 * DeepSeek-direct row says `DEEPSEEK_API_KEY`.
 */
const NO_HARNESS_AUTH_METHODS: readonly AuthMethodDefinition[] = [
  {
    type: 'api_key',
    label: 'API key (OpenAI-compatible endpoint)',
    requiredEnvVar: 'OPENROUTER_API_KEY',
    helpUrl: 'https://openrouter.ai/docs/api-reference/overview'
  }
]

/**
 * ⚠ NO `subscription` METHOD. A subscription auth mode means "some CLI is
 * already logged in"; with no CLI there is nothing to be logged into, and
 * offering it would create a provider that can never resolve a credential.
 */
export const NO_HARNESS_DESCRIPTOR: AdapterDescriptor = {
  id: NO_HARNESS_ADAPTER_TYPE,
  displayName: 'No agent — API route only (council · model list)',
  executionMode: 'api',
  authMethods: [...NO_HARNESS_AUTH_METHODS],
  // Every capability is the honest `false`/`null`: this declaration runs
  // nothing locally. `apiKey: true` is the one true statement — a credential
  // CAN be stored against it and used by the council and by model:refresh.
  capabilities: {
    interactiveTerminal: false,
    worktreeSafe: false,
    skills: false,
    subscriptionLogin: false,
    apiKey: true,
    reasoningEffort: null,
    // There is no CLI here to hold an opinion about permissions — 'none' names
    // the ABSENCE of a harness (D84). Null is the only honest value.
    permissionMode: null,
    sessionResume: null,
    mcp: null,
    hooks: null,
    // D148: a bare shell has no agent to instruct.
    instructions: null
  }
}

/** The auth methods `resolveCredential` reads when a provider names no
 *  harness — the SAME declaration `adapter:list` publishes, never a copy. */
export function noHarnessAuthMethods(): readonly AuthMethodDefinition[] {
  return NO_HARNESS_AUTH_METHODS
}
