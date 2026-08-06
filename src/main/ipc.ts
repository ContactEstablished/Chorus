import { BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'node:fs'
import path from 'node:path'
import { logger, scrubSecrets } from './services/logger'
import {
  LEGACY_CREDENTIALED_PROFILE_ID,
  resolveLaunchProfile,
  validateProfileShape
} from './services/launchProfiles'
import {
  parseMemberParams,
  parseParamsJson,
  resolveCouncilMember,
  resolveMemberModel,
  validateMemberShape
} from './services/councilMembers'
import {
  IpcChannel,
  layoutSetRequestSchema,
  attachRequestSchema,
  launchRequestSchema,
  launchResponseSchema,
  launchContextRequestSchema,
  launchContextResponseSchema,
  writeRequestSchema,
  resizeRequestSchema,
  killRequestSchema,
  sessionDataEventSchema,
  sessionExitEventSchema,
  sessionRestoredEventSchema,
  cliDetectRequestSchema,
  layoutGetRequestSchema,
  layoutGetResponseSchema,
  projectAddRequestSchema,
  projectAddResponseSchema,
  projectsListSchema,
  projectSelectRequestSchema,
  projectUpdateRequestSchema,
  projectUpdateResponseSchema,
  restartRequestSchema,
  restartResponseSchema,
  deleteSessionRequestSchema,
  setTitleRequestSchema,
  suggestMode,
  viewGetRequestSchema,
  viewSetRequestSchema,
  viewStateSchema,
  worktreeListRequestSchema,
  worktreeListResponseSchema,
  worktreeRemoveRequestSchema,
  worktreeRemoveResponseSchema,
  worktreeDirtyFilesRequestSchema,
  worktreeDirtyFilesResponseSchema,
  worktreeDiffRequestSchema,
  worktreeDiffResponseSchema,
  dirtyRemovalAllowed,
  branchForceAllowed,
  providerListRequestSchema,
  providerListResponseSchema,
  providerCreateRequestSchema,
  providerCreateResponseSchema,
  providerUpdateRequestSchema,
  providerUpdateResponseSchema,
  providerDeleteRequestSchema,
  providerDeleteResponseSchema,
  credentialListRequestSchema,
  credentialListResponseSchema,
  credentialCreateRequestSchema,
  credentialCreateResponseSchema,
  credentialReplaceRequestSchema,
  credentialReplaceResponseSchema,
  credentialDeleteRequestSchema,
  credentialDeleteResponseSchema,
  credentialTestRequestSchema,
  credentialTestResponseSchema,
  modelListRequestSchema,
  modelListResponseSchema,
  modelRefreshRequestSchema,
  modelRefreshResponseSchema,
  modelShortlistSetRequestSchema,
  modelShortlistSetResponseSchema,
  adapterListRequestSchema,
  adapterListResponseSchema,
  attentionReportSchema,
  attentionSummaryRequestSchema,
  attentionSummaryResponseSchema,
  attributionSummaryRequestSchema,
  attributionSummaryResponseSchema,
  MANAGEMENT_AUTH_MODE,
  type AdapterListResponse,
  type AttributionSummary,
  type AgentKind,
  type AttentionSummary,
  type AttachResponse,
  type CliDetectResponse,
  type CredentialCreateResponse,
  type CredentialDeleteResponse,
  type CredentialListResponse,
  type CredentialReplaceResponse,
  type CredentialTestResponse,
  type LaunchResponse,
  type LaunchContextResponse,
  type LayoutGetResponse,
  type ModelListResponse,
  type ModelRefreshResponse,
  type ModelShortlistSetResponse,
  agentKindSchema,
  launchProfileListResponseSchema,
  launchProfileCreateRequestSchema,
  launchProfileCreateResponseSchema,
  launchProfileUpdateRequestSchema,
  launchProfileUpdateResponseSchema,
  launchProfileDeleteRequestSchema,
  launchProfileDeleteResponseSchema,
  councilMemberListResponseSchema,
  councilMemberCreateRequestSchema,
  councilMemberCreateResponseSchema,
  councilMemberUpdateRequestSchema,
  councilMemberUpdateResponseSchema,
  councilMemberDeleteRequestSchema,
  councilMemberDeleteResponseSchema,
  type CouncilMemberListResponse,
  type CouncilMemberCreateResponse,
  type CouncilMemberUpdateResponse,
  type CouncilMemberDeleteResponse,
  type CouncilMemberWire,
  relaunchRequestSchema,
  relaunchResponseSchema,
  councilPickBriefRequestSchema,
  councilPickBriefResponseSchema,
  councilStartRequestSchema,
  councilStartResponseSchema,
  councilCancelRequestSchema,
  councilCancelResponseSchema,
  councilProgressEventSchema,
  councilSummaryEventSchema,
  councilTranscriptRequestSchema,
  councilTranscriptResponseSchema,
  councilDocketRequestSchema,
  councilDocketResponseSchema,
  councilFindingsRequestSchema,
  councilFindingsResponseSchema,
  councilForgetRunRequestSchema,
  councilForgetRunResponseSchema,
  councilVerdictRequestSchema,
  councilVerdictResponseSchema,
  windowMaximizedSchema,
  type CouncilDocketResponse,
  type CouncilFindingsResponse,
  type CouncilForgetRunResponse,
  type CouncilVerdictResponse,
  type CouncilPickBriefResponse,
  type CouncilStartResponse,
  type CouncilCancelResponse,
  type CouncilTranscriptResponse,
  type CouncilTranscriptTurn,
  type LaunchProfileListResponse,
  type LaunchProfileCreateResponse,
  type LaunchProfileUpdateResponse,
  type LaunchProfileDeleteResponse,
  type LaunchProfileWire,
  type RelaunchResponse,
  type EffortLevel,
  type PickableWorktree,
  type Project,
  type ProjectAddResponse,
  type ProjectsList,
  type ProjectUpdateResponse,
  type ProviderConfig,
  type ProviderCreateResponse,
  type ProviderDeleteResponse,
  type ProviderListResponse,
  type ProviderUpdateResponse,
  type RestartResponse,
  type ViewState,
  type WorktreeDiffSummary,
  type WorktreeRemoveResponse,
  type WorktreeSummary
} from '../shared/ipc'
import { collectSessionIds } from '../shared/layout'
import { detectClis, refreshClis } from './services/cliDetect'
import { getAdapter, staticRegistry } from './adapters/registry'
// D84: the harness-less provider-type declaration. NOT in `staticRegistry` and
// NOT an `AgentAdapter` — see src/main/adapters/noHarness.ts.
import { NO_HARNESS_DESCRIPTOR, noHarnessAuthMethods } from './adapters/noHarness'
import { resolveEnvVarName } from './adapters/env'
import type { PtyLaunchRoute, ResolvedCredential } from './adapters/types'
import { failureMessage, type ResolvedEnvelope } from './services/vaultCore'
import { refreshProviderModels } from './services/modelCatalog'
import { catalogFreshness, computeCatalogDiff } from './services/modelCatalogCore'
// Task 3b-1: the api-mode transport, and the ONE ingest-scrub seam it is
// driven through (D45(1)/D46). The factory holds no scrubber; this side does.
import type { CredentialProfileRow } from './db/schema'
import {
  resolveRepoRoot,
  currentBranch,
  aheadBehind,
  listWorktrees,
  diffShortstat,
  statusPorcelain
} from './services/git'
import type { AttentionTracker } from './services/attention'
import type { DispatchAttribution, MintForDispatchResult } from './services/dispatchAttribution'
import {
  createCouncilService,
  defaultMaxOutputTokens,
  validateBriefPath,
  type CouncilService,
  type MemberRoute
} from './services/councilService'
import { assembleVerdictStrip, digestFor, toDocketRow } from './services/councilDocketCore'
import { parseBriefQuestions } from './services/councilCore'
import { OPENROUTER_GATEWAY_BASE_URL, type OpenRouterKeyClient } from './services/openrouterKeys'
import type { LaunchOptions, SessionManager } from './services/sessionManager'
import type { ProjectRecord, StorageService } from './services/storage'
import type { CouncilRunRow } from './db/schema'
import type { CredentialVault } from './services/vault'
import { worktreeRootFor, type GitWorktreeManager } from './services/worktrees'
import type { CouncilMemberRow, LaunchProfileRow, NewProviderConfigRow, ProviderConfigRow, WorktreeRow } from './db/schema'

/** Soft cap on panes per project (spec §6/§12): bounds how many agent
 *  processes one project can hold; launches beyond it are rejected. */
const LAUNCH_PANE_CAP = 16

/**
 * Ceiling on one `council:transcript` response (D97 / Task 3e-4).
 *
 * ⚠ A MEASURED MULTIPLE, NOT A ROUND NUMBER THAT LOOKS GENEROUS — 3e-2 has just
 * finished rewriting `RESPONSE_CAP_BYTES`'s comment for being the latter. The
 * largest transcript stored on this machine is **112,531 characters over 8
 * turns** (run `c06874ad`, a FULL four-member council; the partial run before it
 * stored 93,868 over 7). Per-turn mean 14,066, so a 13-turn run projects to
 * ~183,000. This is **~8.9× the largest measured and ~5.5× that projection**.
 *
 * ⚠ CHARACTERS, NOT BYTES, AND THE NAME SAYS SO. `content` is a JS string and
 * `.length` counts UTF-16 code units. F39's retraction is the standing lesson: a
 * figure whose unit is assumed rather than stated is how a measurement becomes
 * an argument.
 *
 * When a run exceeds it the response returns what fits and sets `truncated`.
 * Silence would be the real defect — a truncated transcript that does not admit
 * truncation is worse than no reader at all.
 */
const COUNCIL_TRANSCRIPT_CAP_CHARS = 1_000_000

/** Map the internal record onto the IPC wire shape (snake_case root_path). */
function toWireProject(p: ProjectRecord): Project {
  return {
    id: p.id,
    name: p.name,
    root_path: p.rootPath,
    color: p.color,
    description: p.description
  }
}

/** Map a provider row onto the IPC wire shape (snake_case columns). Explicit
 *  construction, same discipline as toWireProject — a spread would silently
 *  re-admit any column a future migration adds. */
function toWireProvider(row: ProviderConfigRow): ProviderConfig {
  return {
    id: row.id,
    name: row.name,
    adapter_type: row.adapterType,
    auth_mode: row.authMode,
    env_var_name: row.envVarName,
    base_url: row.baseUrl,
    extra_headers_json: row.extraHeadersJson,
    model: row.model,
    created_at: row.createdAt
  }
}

/**
 * Task 3-2 / spec §6.4 — WIDENED FROM ONE FIELD TO ALL FOUR.
 *
 * ⚠ THE GUARD WAS ALWAYS RIGHT; ITS SCOPE WAS THE BUG. `extra_headers_json` has
 * been refused since 3-2 because provider headers are stored in PLAINTEXT — but
 * `env_var_name`, `base_url` and `model` sit in the SAME plaintext row under
 * D33(e), and nothing stopped a key being typed into any of them. Observed in
 * the wild: an OpenRouter key pasted into the env-var-NAME box, which stored it
 * unencrypted AND created no credential, so the user was left with a key on
 * disk and a council they could not staff.
 *
 * ⚠ ONE PATTERN LIST, ONE HOME. This reuses `containsSecret` -> `scrubSecrets`
 * -> secret-patterns.json, the canonical shapes Task 3-1 shipped and the G4
 * gate tests against. A second list here would be a second thing to keep in
 * step, and the one that drifted would be the one that mattered.
 *
 * ⚠ AND THE REFUSAL IS MAIN'S ALONE. The form renders whatever comes back in
 * `formError` — there is deliberately no matching check in the .vue file, for
 * the reason this file states everywhere else: main never trusts the renderer,
 * so a renderer copy would be decoration that can disagree with the authority.
 *
 * Returns the refusal to show, or null when every field is clean. Exported for
 * the unit test — the `sanitizeTitle` precedent.
 */
export function providerSecretRefusal(req: {
  env_var_name?: string | null
  base_url?: string | null
  extra_headers_json?: string | null
  model?: string | null
}): string | null {
  // Ordered as the form is, so the message names the first field a reader's eye
  // would reach. Every one of these is a plaintext column (D33 resolution e).
  const fields: [label: string, value: string | null | undefined][] = [
    ['Environment variable name', req.env_var_name],
    ['Base URL', req.base_url],
    ['Extra headers', req.extra_headers_json],
    ['Model', req.model]
  ]
  for (const [label, value] of fields) {
    // undefined = unchanged (patch semantics), null = cleared. Only a STRING
    // can carry a key, so both absent forms fall through untouched.
    if (typeof value !== 'string' || !containsSecret(value)) continue
    // ⚠ THE MATCHED TEXT IS NEVER ECHOED. Naming the field is what the user
    // needs; quoting the value back would put the key in a renderer string, a
    // log line and possibly a screenshot — reintroducing the exposure the
    // refusal exists to prevent.
    return (
      `${label} looks like it contains a credential (a known key shape matched). ` +
      'Every field on this form is stored in PLAINTEXT — put the credential on a credential profile instead (+ credential), where it is encrypted with Windows DPAPI.'
    )
  }
  return null
}

/** Task 3a-5: the SAME test, for one env value. Injected into
 *  `validateProfileShape` so the pure core stays free of the logger — ONE
 *  pattern list, one home, the `extra_headers_json` precedent above. */
function containsSecret(value: string): boolean {
  return scrubSecrets(value) !== value
}

/** Task 3a-5: `agentKindSchema`'s membership test, for a persisted free-text
 *  `sessions.agent`. D34(c): an unknown persisted agent is a REFUSAL, never a
 *  throw. */
function isAgentKind(agent: string): agent is AgentKind {
  return agentKindSchema.safeParse(agent).success
}

/** Strip C0 control chars + DEL from a captured title; titles are raw terminal
 *  output. Returns the trimmed remainder (possibly empty — the caller rejects
 *  an empty result rather than writing a blank title). */
export function sanitizeTitle(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\x00-\x1F\x7F]/g, '').trim()
}

/** The fixed, sanitized probe-failure vocabulary (spec §7.2). NOTHING from a
 *  response body or an exception ever reaches the renderer: status codes map
 *  to fixed strings, fetch exceptions collapse to one, and every outbound
 *  message passes through scrubSecrets as a final net. */
function probeFailure(message: string): { ok: false; reason: string } {
  return { ok: false, reason: scrubSecrets(message) }
}

/** Task 3-6 test-key: ONE live call. No retry, no backoff, no cache, no
 *  catalog (D28). The endpoint and header shape are the OpenAI-compatible
 *  /chat/completions probe (D4: OpenRouter rejects bad keys with 401 and
 *  authenticates good ones before any model error — verified against
 *  OpenRouter's own API reference this session); `max_tokens: 1` bounds the
 *  cost of a successful probe. If the provider names a default model (D48)
 *  the probe uses it; otherwise OpenRouter's `openrouter/auto` meta-model —
 *  D42 made OpenRouter the single gateway. */
async function probeCredential(
  envelope: ResolvedEnvelope,
  provider: ProviderConfigRow
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const baseUrl = (envelope.baseUrl ?? provider.baseUrl)?.replace(/\/+$/, '')
  if (!baseUrl) {
    return probeFailure(`Provider '${provider.name}' has no base URL to probe.`)
  }
  // Provider-level headers are documented NON-SECRET (D33 resolution e);
  // the envelope's own extraHeaders override them. A hand-edited headers
  // column degrades to no extra headers rather than breaking the probe.
  let providerHeaders: Record<string, string> = {}
  try {
    const parsed: unknown = provider.extraHeadersJson ? JSON.parse(provider.extraHeadersJson) : {}
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string') providerHeaders[k] = v
      }
    }
  } catch {
    providerHeaders = {}
  }
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${envelope.key}`,
        ...providerHeaders,
        ...(envelope.extraHeaders ?? {})
      },
      body: JSON.stringify({
        model: provider.model ?? 'openrouter/auto',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1
      }),
      signal: AbortSignal.timeout(10_000)
    })
    // The body is NEVER read into a message — a 401 body can echo the
    // submitted key (leakage path 1). Cancel and discard it.
    void res.body?.cancel().catch(() => undefined)
    if (res.status >= 200 && res.status < 300) return { ok: true }
    if (res.status === 401 || res.status === 403) {
      return probeFailure('Authentication failed — the credential was rejected.')
    }
    if (res.status === 429) return probeFailure('Rate limited by the provider.')
    if (res.status >= 500) return probeFailure('The provider returned an error.')
    return probeFailure(`Unexpected response (${res.status}).`)
  } catch {
    // Leakage path 2: a fetch exception's cause chain can carry the request,
    // headers included. Discard it wholesale.
    return probeFailure('Could not reach the provider.')
  }
}

/**
 * Register all IPC handlers. Every renderer payload is Zod-parsed before use;
 * a payload that fails validation rejects the invoke and never reaches the PTY.
 *
 * Task 1-5: no closure over a single project — every project-scoped handler
 * resolves `project_id` from its parsed request and FK-checks it against the
 * projects table (schema validity ≠ existence) before touching anything.
 *
 * Task 2-2: the GitWorktreeManager is threaded in from index.ts (the single
 * instance constructed for the boot reconcile) — session:launch's new-worktree
 * path is its first caller.
 *
 * Task 3-2: the CredentialVault is threaded in the same way (D33). The
 * credential:* handlers are WRITE-ONLY inbound — the plaintext key arrives on
 * credential:create / credential:replace and no response ever carries key
 * material or a fingerprint; the outbound .parse on every provider and
 * credential handler is what makes that structural rather than aspirational.
 */
export function registerIpc(
  sessions: SessionManager,
  storage: StorageService,
  worktrees: GitWorktreeManager,
  vault: CredentialVault,
  // 3a-2: a fifth positional parameter, exactly as `vault` was added in 3-2.
  attention: AttentionTracker,
  // 3a-3: the sixth, on the same precedent (vault -> 3-2, attention -> 3a-2).
  attribution: DispatchAttribution,
  /**
   * 3b-3: the seventh, on the same precedent again — and it is THE SAME
   * INSTANCE `DispatchAttribution` holds, threaded from `index.ts` rather than
   * constructed here. A council run mints its own key, and building a second
   * client to do it would create a second management-key path beside the one
   * whose decrypt-per-use discipline was designed in 3a-3.
   */
  keys: OpenRouterKeyClient,
  /** The eighth, from the SAME `managementProfileId()` thunk `DispatchAttribution`
   *  already uses — one home for "is there a management key", not a second
   *  query that can disagree with the first. */
  hasManagementKey: () => boolean
): CouncilService {
  function requireProject(projectId: string): ProjectRecord {
    const p = storage.getProjectById(projectId)
    if (!p) throw new Error(`Unknown project_id: ${projectId}`)
    return p
  }

  /**
   * Resolve + decrypt a credential profile for one launch (Task 3-6, D33
   * clause 4 + action 6). The plaintext exists in this function's scope and
   * in the returned object, and nowhere else in main — it is not cached, not
   * memoized, not attached to any long-lived object, and never passed to
   * anything that logs its arguments.
   *
   * Returns a discriminated result rather than throwing, because every
   * failure here is a CONTRACT path (clause 8) that must surface as an
   * inline refusal — and the refusal happens BEFORE any session row exists.
   *
   * ⚠ D84 (Task 3d-1): `harness` IS NULLABLE, AND NULL IS NOT "UNKNOWN" — it is
   * the caller stating that IT IS NOT AN AGENT CLI. Only the council passes it
   * (see `resolveMemberRoute`), and it replaces the manufactured `AgentKind`
   * that used to be parsed out of the provider's own `adapter_type` purely to
   * satisfy this parameter. That manufacture was Blocker A: it REFUSED any
   * provider that named no agent, in order to feed an ownership check the
   * comment at the call site already described as "a no-op HERE" — the check
   * compared `provider.adapterType` against a value derived FROM
   * `provider.adapterType`, so it could never fail and never protected
   * anything, while the parse in front of it rejected exactly the providers
   * this task exists to admit.
   *
   * ⚠ EVERY OTHER REFUSAL BELOW STAYS IN FORCE FOR BOTH KINDS OF CALLER, and
   * the ownership check itself (Blocker B) is UNCHANGED for every caller that
   * names a harness — all three launch call sites pass a real `AgentKind`.
   */
  async function resolveCredential(
    profileId: string,
    harness: AgentKind | null
  ): Promise<
    | {
        ok: true
        credential: ResolvedCredential
        route: PtyLaunchRoute | null
        /** 3a-3 (D42): the attribution discriminator, resolved HERE because
         *  this is the one place that has both the provider row and the
         *  adapter's declarations. `null` when the provider's auth_mode matches
         *  no AuthMethodDefinition the adapter declares — in which case nothing
         *  is minted, because a strategy cannot be chosen from a mode we cannot
         *  identify. */
        authType: 'subscription' | 'api_key' | null
      }
    | { ok: false; reason: string }
  > {
    // 1. Load the profile row.
    const profile = storage.getCredentialProfileById(profileId)
    if (!profile) return { ok: false, reason: 'That credential profile no longer exists.' }
    // 2. Already known-bad: refuse WITHOUT re-attempting decryption — the row
    //    is marked, and a retry only widens the window (D33 clause 8).
    if (profile.unavailableSince) {
      return { ok: false, reason: failureMessage('undecryptable', profile.label) }
    }
    // 3. Load the provider; it must belong to THIS agent (the dialog filters,
    //    but main never trusts the renderer) and resolve the env var name —
    //    provider override beats the adapter's api_key default (D34(e)).
    const provider = storage.getProviderConfigById(profile.providerId)
    if (!provider) {
      return { ok: false, reason: `The provider for credential profile '${profile.label}' no longer exists.` }
    }
    // ⚠ BLOCKER B, AND IT IS DELIBERATELY NOT WEAKENED (D84). The guard is
    // GATED, not relaxed: a caller that names a harness gets the identical
    // comparison it has always got, and a credential for a Claude provider
    // still cannot launch under codex. `harness === null` skips it because a
    // caller with no CLI has nothing to own the credential — which is what the
    // council was already asserting, badly, by passing the provider's own
    // column back in.
    if (harness !== null && provider.adapterType !== harness) {
      return {
        ok: false,
        reason: `Credential profile '${profile.label}' belongs to provider '${provider.name}', which is not a ${harness} provider.`
      }
    }
    // 3a-3 / D42 operational note: the OpenRouter MANAGEMENT key is a distinct,
    // higher-privilege credential class — it mints and revokes keys and cannot
    // do inference. It must never reach a child PTY.
    //
    // ⚠ THIS REFUSAL SITS BEFORE `vault.decryptForLaunch`, DELIBERATELY, so a
    // management profile is not even DECRYPTED on a launch path — the plaintext
    // never exists in this function's scope at all. OpenRouter enforces the
    // same rule server-side, but a guarantee that depends on a third party is
    // not a guarantee.
    //
    // LaunchDialog.vue already filters `auth_mode === 'api_key'`, so this is
    // not reachable through the UI — and that is exactly why it is here: main
    // never trusts the renderer, and a filter in a dialog is not an invariant.
    if (provider.authMode === MANAGEMENT_AUTH_MODE) {
      // Label only (D33 clause 8) — never the provider name's secrets, never a
      // hint about the key.
      return {
        ok: false,
        reason: `Credential profile '${profile.label}' is an OpenRouter management key and cannot be used to launch an agent.`
      }
    }
    // D84: the declarations to resolve against. With a harness that is the
    // adapter's own; with none it is `noHarnessAuthMethods()` — the SAME
    // declaration `adapter:list` publishes to the provider form, so what the
    // user was offered and what main resolves cannot disagree. There is no
    // third branch and no inline literal here.
    const authMethods =
      harness !== null ? staticRegistry[harness].getAuthMethods() : noHarnessAuthMethods()
    // The discriminator, resolved from the adapter's OWN declarations rather
    // than from the provider row's free-text column.
    const authType = authMethods.find((m) => m.type === provider.authMode)?.type ?? null
    const apiKeyMethod = authMethods.find((m) => m.type === 'api_key') ?? null
    const envVarName = resolveEnvVarName(provider.envVarName, apiKeyMethod?.requiredEnvVar ?? null)
    if (envVarName === null) {
      return {
        ok: false,
        reason: `Provider '${provider.name}' has no API-key environment variable configured.`
      }
    }
    // 4. Decrypt. On failure the vault has already marked unavailable_since;
    //    its message is label-only by construction (D33 clause 8).
    const dec = await vault.decryptForLaunch(profileId)
    if (!dec.ok) return { ok: false, reason: dec.message }
    // 5. The envelope -> credential join (3-2 finding F-3): value + resolved
    //    name + isSecret. extraHeaders has NO PTY env mapping (api-mode
    //    concern, Phase 3b) — it launches fine and is simply unused here.
    //    baseUrl (envelope overrides provider, D33(e)) becomes the ROUTE's
    //    endpoint metadata — non-secret argv material for codex's -c
    //    overrides, never an env var guess (ANTHROPIC_BASE_URL is not
    //    D4-verifiable from `claude --help`, so the base-URL env mapping is
    //    deliberately deferred).
    const credential: ResolvedCredential = { envVarName, value: dec.value.key, isSecret: true }
    const baseUrl = dec.value.baseUrl ?? provider.baseUrl
    const route: PtyLaunchRoute | null = baseUrl
      ? { providerKey: 'chorus', providerName: provider.name, baseUrl, modelId: provider.model }
      : null
    return { ok: true, credential, route, authType }
  }

  /**
   * Task 3a-5: one launch-profile row -> its wire shape.
   *
   * The RESOLVED model (rank 1 -> rank 2 -> null) and `disabled_reason` are
   * both computed HERE, in main, so the renderer never re-implements 3a-4's
   * precedence table and never decides eligibility for itself.
   *
   * ⚠ An unlaunchable profile gets a `disabled_reason`, NOT omission. The
   * picker shows it, disables it, and renders the reason: a launch profile is a
   * row the USER NAMED, and a named entry that silently vanishes is worse than
   * one that says why it cannot launch.
   *
   * Every free-text field on the way out is scrubbed — labels and provider
   * names are user-authored, so a user who pasted a key into one must not have
   * it echoed back into the DOM.
   */
  function toWire(row: LaunchProfileRow): LaunchProfileWire {
    const provider = row.providerId ? storage.getProviderConfigById(row.providerId) : null
    const credential = row.credentialProfileId
      ? storage.getCredentialProfileById(row.credentialProfileId)
      : null
    const resolution = resolveLaunchProfile(row, provider, credential)
    return {
      id: row.id,
      label: scrubSecrets(row.label),
      agent: row.agent as AgentKind,
      provider_id: row.providerId,
      provider_name: provider ? scrubSecrets(provider.name) : null,
      credential_profile_id: row.credentialProfileId,
      credential_label: credential ? scrubSecrets(credential.label) : null,
      model: resolution.ok ? resolution.plan.model : (row.model ?? provider?.model ?? null),
      effort: resolution.ok ? resolution.plan.effort : null,
      permission_mode: row.permissionMode,
      workspace_mode: row.workspaceMode === 'new-worktree' ? 'new-worktree' : 'current-tree',
      env_json: row.envJson,
      disabled_reason: resolution.ok ? null : scrubSecrets(resolution.reason),
      created_at: row.createdAt,
      updated_at: row.updatedAt
    }
  }

  /** Ordered by label in MAIN — the renderer sorts nothing. */
  function listLaunchProfileWire(): LaunchProfileWire[] {
    return storage
      .listLaunchProfiles()
      .map(toWire)
      .sort((a, b) => a.label.localeCompare(b.label))
  }

  /**
   * Task 3b-2 / D62: a council member row -> the wire shape.
   *
   * ⚠ THE ROUTE IS RESOLVED THROUGH THE CREDENTIAL, and there is no other way
   * to reach it — the row carries no `provider_id` and no `base_url` (D48's
   * one-home rule). What comes back out is a NAME, never an endpoint.
   *
   * ⚠ `model` AND `resolvedModel` ARE BOTH ON THE WIRE, AND THAT IS THE PROOF
   * D56 ASKS FOR. `model` is the raw column — NULL means this member inherits;
   * `resolvedModel` is rank 1 > rank 2 > null, computed here and NEVER written
   * back. Collapsing them into one field is how a "helpful" back-write into
   * rank 1 gets written by someone reading the UI.
   *
   * An unresolvable member is SHOWN, DISABLED AND EXPLAINED — never filtered
   * out. A council member is a row the USER NAMED, and a named entry that
   * silently vanishes is worse than one that says why it cannot deliberate.
   *
   * Every free-text field on the way out is scrubbed — labels and route names
   * are user-authored, so a user who pasted a key into one must not have it
   * echoed back into the DOM. `params_json` is deliberately NOT on the wire at
   * all: it is the field most able to carry a pasted value, it is refused at
   * write if it matches a known key shape, and it never round-trips.
   *
   * ⚠ THAT RULE SURVIVES THE EDIT FORM, AND THE PROJECTION BELOW IS HOW. A form
   * that could not read the row could not edit it — so rather than relax the
   * rule, main sends two things that CANNOT carry a key by construction: the
   * `max_tokens` NUMBER, and the NAMES of the other parameters. No parameter
   * VALUE crosses the bridge, which is the whole content of the rule.
   */
  function toCouncilMemberWire(row: CouncilMemberRow): CouncilMemberWire {
    // ONE lookup path, shared with the create/update handlers: through the
    // credential, because that is the only pointer the row has.
    const { credential, provider } = councilRouteFor(row.credentialProfileId)
    const resolution = resolveCouncilMember(row, provider, credential)
    // The DEFENSIVE reader (degrades to {} on a corrupt row) — the list is what
    // lets a user fix such a row, so it must never be what breaks on one.
    const params = parseMemberParams(row.paramsJson)
    const rawMaxTokens = params.max_tokens
    const role = row.role === 'arbiter' ? 'arbiter' : 'member'
    return {
      id: row.id,
      label: scrubSecrets(row.label),
      credentialProfileId: row.credentialProfileId,
      credentialLabel: credential ? scrubSecrets(credential.label) : null,
      providerName: provider ? scrubSecrets(provider.name) : null,
      // THE RAW COLUMN. Untouched by resolution — the proof is a column.
      model: row.model,
      // D56, resolved. A refused member still reports what it WOULD resolve to,
      // so the list can explain the row rather than blanking it.
      resolvedModel: resolveMemberModel(row, provider),
      // ⚠ The wire vocabulary is CLOSED (councilRoleSchema), so a hand-edited
      // `role` has nowhere legal to go. It is NOT silently accepted: the same
      // row comes back `available: false` with `unavailableReason` naming the
      // unrecognised role, because `resolveCouncilMember` refuses it. Falling
      // back here rather than throwing is the defensive-READ discipline — the
      // list is what lets a user FIX such a row, so a bad row must never be
      // able to break it (the `getWindowBounds` / `readAttentionSpans` rule).
      role,
      available: resolution.ok,
      unavailableReason: resolution.ok ? null : scrubSecrets(resolution.reason),
      // A hand-edited row can hold a string, a float or nonsense here. Anything
      // that is not a whole number reads as "not set" and the row shows the
      // default — the same defensive-READ discipline as `role` above, and the
      // council's own resolver reaches the identical conclusion at run time.
      maxTokens:
        typeof rawMaxTokens === 'number' && Number.isFinite(rawMaxTokens)
          ? Math.floor(rawMaxTokens)
          : null,
      defaultMaxTokens: defaultMaxOutputTokens(role),
      // ⚠ `Object.keys`, NEVER `Object.entries`. Names only.
      otherParamNames: Object.keys(params)
        .filter((k) => k !== 'max_tokens')
        .slice(0, 32)
        .map((k) => scrubSecrets(k).slice(0, 120))
    }
  }

  /** Ordered by label in MAIN — the renderer sorts nothing. */
  function listCouncilMemberWire(): CouncilMemberWire[] {
    return storage
      .listCouncilMembers()
      .map(toCouncilMemberWire)
      .sort((a, b) => a.label.localeCompare(b.label))
  }

  /**
   * The `params_json` patch, resolved to the string that will be stored.
   *
   * Two INDEPENDENT controls over one column, which is what lets the settings
   * form offer "set max_tokens" and "replace the other parameters" separately:
   *   · `paramsJson` REPLACES the whole object — absent = keep, null/empty = clear;
   *   · `maxTokens` is then merged ON TOP of that result — absent = keep,
   *     null = remove the key (fall back to the role default), a number = set.
   *
   * ⚠ THE RESULT IS ASSEMBLED HERE AND VALIDATED ELSEWHERE. This returns a
   * CANDIDATE; `validateMemberShape` still runs over the merged row afterwards,
   * so a value carrying a known key shape is refused exactly as it always was.
   * Nothing about the secret refusal moves into this function.
   *
   * ⚠ AND UNPARSEABLE JSON IS HANDED ON VERBATIM RATHER THAN MERGED INTO. The
   * defensive reader answers `{}` for a string it cannot understand, so merging
   * through it would swallow a user's typo and save an object they never typed —
   * and, for a row that was already corrupt, would quietly discard whatever the
   * row held. Passing it through means `validateMemberShape` refuses the save
   * with the sentence it has for exactly this ("not valid JSON"), and the user
   * can repair the row with the replacement field.
   */
  function mergeParamsPatch(
    existing: string | null,
    replacement: string | null | undefined,
    maxTokens: number | null | undefined
  ): string | null {
    // Neither control was touched: the column, byte for byte.
    if (replacement === undefined && maxTokens === undefined) return existing
    const base = replacement === undefined ? existing : replacement
    if (maxTokens === undefined) return base
    const strict = parseParamsJson(base)
    if (!strict.ok) return base
    const params: Record<string, unknown> = { ...strict.value }
    if (maxTokens === null) delete params.max_tokens
    else params.max_tokens = maxTokens
    // NULL, not "{}", for an empty result — one representation of "no
    // parameters", and it is the one every existing row already uses.
    return Object.keys(params).length === 0 ? null : JSON.stringify(params)
  }

  /** The two row views the pure core wants, read through the credential. A
   *  member has no provider pointer of its own — that is the ruling, restated
   *  as the only lookup path there is. */
  function councilRouteFor(credentialProfileId: string): {
    credential: {
      id: string
      providerId: string
      label: string
      unavailableSince: string | null
    } | null
    provider: { id: string; name: string; authMode: string; model: string | null } | null
  } {
    const credential = storage.getCredentialProfileById(credentialProfileId)
    if (!credential) return { credential: null, provider: null }
    const provider = storage.getProviderConfigById(credential.providerId)
    return {
      credential: {
        id: credential.id,
        providerId: credential.providerId,
        label: credential.label,
        unavailableSince: credential.unavailableSince
      },
      provider: provider
        ? { id: provider.id, name: provider.name, authMode: provider.authMode, model: provider.model }
        : null
    }
  }

  /** F17: git reports forward-slash paths and Windows is case-insensitive —
   *  every path comparison goes through this key (worktrees.ts's pathKey is
   *  the reference; duplicated here because main/ipc may not reach into that
   *  module's private helper). */
  function pathKey(p: string): string {
    return path.win32.normalize(p).toLowerCase()
  }

  /** F18 resolution (a) — decided at 2-2 execution: the branch label resolves
   *  from the WORKTREES side (worktrees.session_id, the authoritative pointer
   *  per D26(a)), never from sessions.worktree_id. The crash window between
   *  `git worktree add` and activation leaves sessions.worktree_id NULL while
   *  the row side is already set, and re-owning a worktree leaves the previous
   *  owner's sessions.worktree_id stale — row-side resolution renders the
   *  correct label in both cases. Task 2-4's diff summary MUST resolve the
   *  worktree the identical way. */
  function worktreeForSession(sessionId: string, projectId: string): WorktreeRow | null {
    return storage.getWorktreesForProject(projectId).find((w) => w.sessionId === sessionId) ?? null
  }

  function branchForSession(sessionId: string, projectId: string): string | null {
    return worktreeForSession(sessionId, projectId)?.branch ?? null
  }

  ipcMain.handle(IpcChannel.SessionAttach, (_event, payload): AttachResponse => {
    const { sessionId } = attachRequestSchema.parse(payload)
    // The sessionId is a sessions DB row id; the row supplies the persisted
    // exit state and cwd for the manager-unknown path below.
    const row = storage.getSessionById(sessionId)
    if (!row) throw new Error(`Unknown sessionId: ${sessionId}`)
    // 2-2: the branch label resolves row-side (F18a) — see worktreeForSession.
    // 2-3: the owning worktree row's id rides along for the close flow.
    const wt = worktreeForSession(row.id, row.projectId)
    const branch = wt?.branch ?? null
    const worktreeId = wt?.id ?? null
    const snap = sessions.attach(sessionId)
    if (snap) {
      // Live in the manager. The restored flag lets a pane that mounted after
      // the session:restored event still wear the badge — consumed here, so
      // exactly one attach reports it per restore relaunch. The snapshot has
      // no title of its own; the row is the source (1b-1).
      // v14: name/description come off the ROW for the same reason `title`
      // does — the manager's snapshot knows nothing about either.
      const authored = { name: row.name, description: row.description }
      return sessions.consumeRestoredBadge(sessionId)
        ? { ...snap, title: row.title, ...authored, branch, worktreeId, restored: true }
        : { ...snap, title: row.title, ...authored, branch, worktreeId }
    }
    // Unknown to the SessionManager (row from a previous app run, or a session
    // the restore engine has not reached yet): attach never spawns — report
    // the row's persisted exit state plus the restore chrome signals.
    return {
      sessionId: row.id,
      buffer: '',
      status: 'exited',
      exitCode: row.exitCode,
      title: row.title,
      name: row.name,
      description: row.description,
      branch,
      worktreeId,
      ...(sessions.isRestorePending(sessionId) ? { restorePending: true } : {}),
      ...(!fs.existsSync(row.cwd) ? { cwdMissing: true } : {})
    }
  })

  ipcMain.handle(IpcChannel.SessionLaunch, async (_event, payload): Promise<LaunchResponse> => {
    const req = launchRequestSchema.parse(payload)
    const p = requireProject(req.project_id)
    // Security boundary: cwd must be absolute and exist. Main-only, before
    // any row is created or PTY spawned; the renderer is never trusted.
    if (!path.isAbsolute(req.cwd) || !fs.existsSync(req.cwd)) {
      return { ok: false, reason: `Directory not found or not absolute: ${req.cwd}` }
    }
    // Soft pane cap (spec §6): a pathological layout cannot fork dozens of
    // agent processes. Panes = layout leaves for this project. Applies to
    // every mode — a worktree launch adds a pane too.
    const layout = storage.getPaneLayout(p.id)
    const paneCount = layout ? collectSessionIds(layout.root).length : 0
    if (paneCount >= LAUNCH_PANE_CAP) {
      return { ok: false, reason: `Pane cap reached (${LAUNCH_PANE_CAP} per project)` }
    }

    // Task 3-6 (D33 clauses 4/8): resolve + decrypt the credential BEFORE any
    // session row is created — a refusal here leaves no orphan row, and there
    // is NO ambient-credential fallback: a launch naming a profile either gets
    // its key or does not happen. The plaintext's lifetime is: this variable
    // -> buildLaunch's secretEnv -> the child env block + the scrubber match
    // set (the D33(a) sanctioned retention). Nowhere else.
    // Task 3a-4: the app-level effort level, threaded from the parsed request
    // alongside secrets/credential/route. Absent when the dialog offered no
    // control (a null descriptor) or the user chose nothing — and absent means
    // NO effort argument is emitted, which is what keeps a no-effort launch
    // byte-identical to a pre-3a-4 one. Nothing persists it: it is per-launch
    // until 3a-5's launch_profiles exists.
    // Task 3a-5 / D43. The division of authority, stated once so it is not
    // re-invented at the call site:
    //   PROFILE -> credential, route, model, effort, permission mode, env
    //   PAYLOAD -> agent, cwd, workspace_mode  (the user may change all three
    //              after picking a profile, and cwd is the SECURITY BOUNDARY
    //              main validates ITSELF above — a stored row is untrusted
    //              input like any other, so a profile supplies no cwd at all).
    if (req.launch_profile_id && req.credential_profile_id) {
      return { ok: false, reason: 'Pick a launch profile or a credential, not both.' }
    }
    let launchProfileId: string | null = null
    // The credential this launch will resolve: from the profile when one was
    // named, else from the payload. ONE resolver either way.
    let credentialProfileId: string | null = req.credential_profile_id ?? null
    let profileEffort: EffortLevel | null = null
    let profileEnv: Readonly<Record<string, string>> = {}
    /**
     * D90: rank 1 of D56's order — the saved profile's model.
     *
     * ⚠ THIS CAPTURE FIXES A LATENT GAP RATHER THAN ADDING A FEATURE.
     * `resolveLaunchProfile` has computed `plan.model` (rank 1 -> rank 2) since
     * 3a-5, and `toWire` DISPLAYS it in the profile chip — but no launch path
     * ever read it, so the route always carried `provider_configs.model` and a
     * profile's own model silently did nothing. It surfaces now because D90
     * adds rank 0 directly above it, and a live rank 0 sitting on top of a dead
     * rank 1 would be worse than either.
     */
    let profileModel: string | null = null
    if (req.launch_profile_id) {
      const profile = storage.getLaunchProfileById(req.launch_profile_id)
      if (!profile) return { ok: false, reason: 'That launch profile no longer exists.' }
      // Main never trusts the renderer: a mismatched pair is a renderer bug,
      // not a user intent.
      if (profile.agent !== req.agent) {
        return { ok: false, reason: `That launch profile is for ${profile.agent}, not ${req.agent}.` }
      }
      const resolution = resolveLaunchProfile(
        profile,
        profile.providerId ? storage.getProviderConfigById(profile.providerId) : null,
        profile.credentialProfileId
          ? storage.getCredentialProfileById(profile.credentialProfileId)
          : null
      )
      if (!resolution.ok) return { ok: false, reason: resolution.reason }
      launchProfileId = profile.id
      credentialProfileId = resolution.plan.credentialProfileId
      profileEffort = resolution.plan.effort
      profileEnv = resolution.plan.envAdditions
      profileModel = resolution.plan.model
    }
    // ⚠ THE PAYLOAD WINS over the profile's stored effort, because the payload
    // is what the user is looking at in the dialog; the profile is the DEFAULT
    // the dialog prefilled. 3a-4's precedence order is otherwise unchanged and
    // unextended — a profile supplies a rank-2 value and does not create a
    // rank 0.
    const effortValue: EffortLevel | null = req.effort ?? profileEffort
    const effortOpt: Pick<LaunchOptions, 'effort'> = effortValue ? { effort: effortValue } : {}
    const envOpt: Pick<LaunchOptions, 'envAdditions'> =
      Object.keys(profileEnv).length > 0 ? { envAdditions: profileEnv } : {}
    let launchOpts: LaunchOptions = { ...effortOpt, ...envOpt }
    // 3a-3 (D42): what attribution decided for this launch, carried to
    // linkDispatch once the dispatch row exists. Holds a HASH and two numbers —
    // never key material.
    let mint: MintForDispatchResult = { credential: null, pending: null, stateIfNoMint: null }
    if (credentialProfileId) {
      // ⚠ REUSE, DO NOT FORK. Exactly one function in main calls
      // vault.decryptForLaunch for a launch, so D33 clause 8's refusals have
      // exactly one place to live and cannot drift.
      const resolved = await resolveCredential(credentialProfileId, req.agent)
      if (!resolved.ok) return { ok: false, reason: resolved.reason }
      // ⚠ THE ONE PLACE A KEY IS MINTED, and the branch that decides is inside
      // mintForDispatch, keyed on AuthMethodDefinition.type. A null authType
      // (an auth_mode no adapter declares) mints NOTHING — it degrades to
      // 'none' rather than guessing.
      mint = await attribution.mintForDispatch({
        authType: resolved.authType ?? 'subscription',
        hasRoute: resolved.route !== null,
        userCredential: resolved.credential
      })
      // The MINTED key replaces the user's — which means, on an attributed
      // launch, the user's long-lived key is decrypted but never injected. The
      // route is unchanged: it is non-secret argv metadata and does not depend
      // on which key is used.
      const credential = mint.credential ?? resolved.credential
      // D90: RANK 0 of D56's precedence order — the model chosen for THIS
      // launch, applied here and nowhere else.
      //
      // ⚠ IT OVERRIDES THE ROUTE'S `modelId` FIELD AND WRITES NOTHING. The
      // route object is rebuilt as a fresh literal with one field replaced;
      // `provider_configs` is untouched, exactly as it is by every other rank
      // (grep this handler for `UPDATE provider_configs`: zero). The stored
      // default survives the launch unchanged, which is what makes this a
      // choice for today rather than D48's second home for the same fact.
      //
      // ⚠ ORDER: payload > launch profile > route default. The payload wins for
      // the same reason it already wins for `effort` a few lines above — it is
      // what the user is looking at in the dialog; the stored rows are the
      // defaults the dialog prefilled from.
      const chosenModel = req.model ?? profileModel
      const route =
        resolved.route && chosenModel
          ? { ...resolved.route, modelId: chosenModel }
          : resolved.route
      launchOpts = {
        ...effortOpt,
        ...envOpt,
        secrets: [credential.value],
        credential,
        ...(route ? { route } : {})
      }
    } else {
      // No profile named: a subscription or ambient-env launch (D33 resolution
      // c — the FIRST-CLASS path, not a fallback). It is passed through
      // mintForDispatch anyway so the row still gets an honest state, and it
      // CANNOT mint: the subscription branch returns before anything else is
      // read.
      mint = await attribution.mintForDispatch({
        authType: 'subscription',
        hasRoute: false,
        userCredential: null
      })
    }
    // Task 3a-5 / D49: the credentialed fact is now the session's own
    // `launch_profile_id`, written on the SAME INSERT as the row (below, in all
    // three workspace-mode branches) rather than marked afterwards.
    //
    // ⚠ THAT ORDERING IS THE POINT. 3-6 marked the row AFTER a successful
    // launch, which left a window in which a crash produced a live credentialed
    // session with no mark — the silent-keyless-restore failure. Same-insert
    // closes it structurally, and the fact now dies with the row, so
    // session:delete needs no unmark call at all.
    //
    // A launch with no credential at all writes NULL, which the fail-safe
    // predicate reads as "not credentialed" — correct, because there was no
    // credential to lose.
    //
    // ⚠ A LAUNCH ON A BARE CREDENTIAL WITH NO PROFILE WRITES THE SENTINEL, NOT
    // NULL. That path is still first-class (D33 clause 9 / the 3-6 dialog
    // flow), and such a session IS credentialed but has no profile to point at.
    // Writing NULL would make sessionIsCredentialed return FALSE and the
    // restore engine would relaunch it KEYLESS — reintroducing the exact F26
    // failure Task 3-6's global list existed to prevent, through the retirement
    // that was supposed to preserve it. The sentinel says "credentialed, and
    // Chorus cannot reproduce this launch", which is the honest statement and
    // is what makes Relaunch correctly refuse it with the use-the-dialog
    // message.
    const sessionProfilePointer: string | null =
      launchProfileId ?? (credentialProfileId ? LEGACY_CREDENTIALED_PROFILE_ID : null)
    /**
     * v14: the authored identity, normalized ONCE for all three workspace-mode
     * branches below rather than three times inside them.
     *
     * Trimmed, and an all-whitespace value folds to NULL so "" and NULL cannot
     * both be storable — the projects.description rule, and the reason a user
     * who clears the suggested name gets a genuinely unnamed session rather than
     * a session named "". Main NEVER substitutes a name of its own here: the
     * suggestion is the dialog's, visible and editable before it is sent.
     */
    const authored = {
      name: req.name?.trim() || null,
      description: req.description?.trim() || null
    }
    // 3a-3: the write-ahead ledger write. Called IMMEDIATELY after
    // sessions.launch(...) returns, because 3a-1's DispatchRecorder creates the
    // dispatches row on the onStart announcement fired synchronously INSIDE
    // that call — before it there is no row to write a ledger onto, and this
    // service is forbidden from creating one. See dispatchAttribution.ts's
    // linkDispatch for the full ordering argument and what the residual window
    // costs (matrix row 3, bounded by the hard $0.50 limit).
    const linkAttribution = (sessionId: string): void => {
      attribution.linkDispatch(sessionId, mint.pending, mint.stateIfNoMint)
    }

    // 2-2 (D22/D26f): the chosen workspace_mode is authoritative. Main
    // validates it and returns {ok:false} inline on any failure — NEVER a
    // silent fallback to another mode.
    if (req.workspace_mode === 'new-worktree') {
      // The mode is validated against the ACTUAL cwd, not the (project-root)
      // suggestion — the dialog's default may be stale for a typed cwd.
      const repoRoot = await resolveRepoRoot(req.cwd)
      if (repoRoot === null) {
        return { ok: false, reason: `Not a git repository: ${req.cwd}` }
      }
      const baseBranch = await currentBranch(repoRoot)
      // F16 (FKs enforced): the sessions row MUST exist before createWorktree
      // inserts its journal row carrying session_id — row-before-worktree is
      // mandatory, not stylistic. cwd starts as req.cwd; activation rewrites
      // it to the worktree path in the same transaction as both pointers.
      const row = storage.createSession({
        id: randomUUID(),
        projectId: p.id,
        agent: req.agent,
        cwd: req.cwd,
        status: 'running',
        exitCode: null,
        createdAt: new Date().toISOString(),
        launchProfileId: sessionProfilePointer,
        ...authored
      })
      let wt: WorktreeRow
      try {
        wt = await worktrees.createWorktree(row.id, repoRoot, baseBranch) // DB-first journal (2-1)
      } catch (err) {
        // createWorktree deletes its own journal row on every failure branch,
        // so deleting the never-surfaced session row cannot trip the F16 FK
        // (no leaf, no pane ever saw it — pure debris). Do NOT reorder.
        storage.deleteSession(row.id)
        return {
          ok: false,
          reason: `Worktree creation failed: ${err instanceof Error ? err.message : String(err)}`
        }
      }
      // Resolution (a): both pointers + status='active' + session cwd →
      // worktree path, in ONE synchronous transaction.
      storage.activateWorktreeForSession(wt.id, row.id, wt.path)
      const snap = sessions.launch(req.agent, wt.path, row.id, launchOpts) // spawn IN the worktree
      linkAttribution(row.id)
      if (launchProfileId) storage.setLastLaunchProfileId(p.id, launchProfileId)
      storage.pushRecentCwd(req.cwd)
      return launchResponseSchema.parse({
        ...snap,
        title: row.title,
        ...authored,
        branch: wt.branch,
        worktreeId: wt.id
      })
    }

    if (req.workspace_mode === 'existing-worktree') {
      // Attachability is enforced here, independently of what the picker
      // offered: the row must exist, belong to THIS project, be in a settled
      // state, not be owned by a live session, and still be on disk.
      const wt = req.worktree_id ? storage.getWorktreeById(req.worktree_id) : null
      if (!wt) return { ok: false, reason: 'Select an existing worktree to attach' }
      if (wt.projectId !== p.id) {
        return { ok: false, reason: 'That worktree belongs to another project' }
      }
      if (wt.status !== 'detached' && wt.status !== 'active') {
        return { ok: false, reason: `That worktree is not attachable (status: ${wt.status})` }
      }
      if (wt.sessionId !== null && sessions.isRunning(wt.sessionId)) {
        return { ok: false, reason: 'That worktree is in use by a live session' }
      }
      if (!fs.existsSync(wt.path)) {
        return { ok: false, reason: `Worktree directory is gone: ${wt.path}` }
      }
      const row = storage.createSession({
        id: randomUUID(),
        projectId: p.id,
        agent: req.agent,
        cwd: wt.path,
        status: 'running',
        exitCode: null,
        createdAt: new Date().toISOString(),
        launchProfileId: sessionProfilePointer,
        ...authored
      })
      storage.activateWorktreeForSession(wt.id, row.id, wt.path) // re-own, one txn
      const snap = sessions.launch(req.agent, wt.path, row.id, launchOpts)
      linkAttribution(row.id)
      if (launchProfileId) storage.setLastLaunchProfileId(p.id, launchProfileId)
      return launchResponseSchema.parse({
        ...snap,
        title: row.title,
        ...authored,
        branch: wt.branch,
        worktreeId: wt.id
      })
    }

    // current-tree — the pre-2-2 launch path, unchanged.
    const row = storage.createSession({
      id: randomUUID(),
      projectId: p.id,
      agent: req.agent,
      cwd: req.cwd,
      status: 'running',
      exitCode: null,
      createdAt: new Date().toISOString(),
      launchProfileId: sessionProfilePointer,
      ...authored
    })
    const snap = sessions.launch(req.agent, req.cwd, row.id, launchOpts)
    linkAttribution(row.id)
    if (launchProfileId) storage.setLastLaunchProfileId(p.id, launchProfileId)
    storage.pushRecentCwd(req.cwd)
    // Fresh row: title is NULL until a capture event lands (1b-1). The AUTHORED
    // name/note, by contrast, are already on the row — they arrived with the
    // payload rather than from the agent.
    return launchResponseSchema.parse({
      ...snap,
      title: row.title,
      ...authored,
      branch: null,
      worktreeId: null
    })
  })

  ipcMain.handle(
    IpcChannel.SessionLaunchContext,
    async (_event, payload): Promise<LaunchContextResponse> => {
      const req = launchContextRequestSchema.parse(payload)
      const p = requireProject(req.project_id)
      // 2-2 (D26f): repo context for the workspace-mode default, computed in
      // main against the PROJECT ROOT (the dialog's default cwd — a typed cwd
      // change does not re-fetch; main re-validates the chosen mode against
      // the actual cwd at launch). resolveRepoRoot never throws: a non-git
      // project root yields null (findings risk 3) → current-tree only.
      const repoRoot = await resolveRepoRoot(p.rootPath)

      let liveSessionsInRepo = 0
      let pickable: PickableWorktree[] = []
      if (repoRoot !== null) {
        const repoKey = pathKey(repoRoot)
        // OTHER live sessions writing the same MAIN tree: iterate the
        // project's rows and ask the manager (isRunning — no SessionManager
        // API growth; exited rows never count). A live session inside a
        // WORKTREE does NOT match repoRoot: --show-toplevel there returns the
        // worktree's OWN toplevel, so already-isolated agents are excluded —
        // the intended D22 semantics, do not "fix" with --git-common-dir.
        for (const row of storage.getSessionsForProject(p.id)) {
          if (!sessions.isRunning(row.id)) continue
          const rowRoot = await resolveRepoRoot(row.cwd)
          if (rowRoot !== null && pathKey(rowRoot) === repoKey) liveSessionsInRepo++
        }
        // Pickable: detached, or active with no live owning session.
        pickable = storage
          .getWorktreesForProject(p.id)
          .filter((w) => pathKey(w.repoRoot) === repoKey)
          .filter(
            (w) =>
              w.status === 'detached' ||
              (w.status === 'active' && !(w.sessionId !== null && sessions.isRunning(w.sessionId)))
          )
          .map(
            (w): PickableWorktree => ({ id: w.id, branch: w.branch, path: w.path, status: w.status })
          )
      }

      // Outbound parse re-filters recent cwds to strings: the renderer never
      // trusts raw disk contents.
      return launchContextResponseSchema.parse({
        projectRoot: p.rootPath,
        recentCwds: storage.getRecentCwds(),
        // v14: what the dialog's name suggestion must avoid. EVERY row in the
        // project, not just the live ones — an exited pane is still on screen
        // with its name on it, so reusing that name would collide visibly.
        usedAgentNames: storage
          .getSessionsForProject(p.id)
          .map((row) => row.name)
          .filter((n): n is string => n !== null),
        repoRoot,
        liveSessionsInRepo,
        suggestedMode: suggestMode(repoRoot, liveSessionsInRepo),
        worktrees: pickable,
        // Task 3a-5: the picker's rows ride in on this existing call — no
        // fifth round trip (spec §8.1).
        launchProfiles: listLaunchProfileWire(),
        // ⚠ A DANGLING pointer resolves to null, NEVER to a label match: the
        // profile was deleted, so there is no default, and the dialog behaves
        // exactly as it does today. Computed in MAIN — the renderer never
        // derives a default and never persists one.
        lastLaunchProfileId: (() => {
          const id = storage.getLastLaunchProfileId(p.id)
          return id && storage.getLaunchProfileById(id) ? id : null
        })()
      })
    }
  )

  ipcMain.handle(IpcChannel.SessionRestart, (_event, payload): RestartResponse => {
    const { sessionId } = restartRequestSchema.parse(payload)
    // D16 clause 4: one path for in-run and post-restart restarts. Read the
    // row, re-validate cwd, spawn via the launch path under the SAME row id
    // (no row creation), write 'running' only after the spawn succeeds.
    const row = storage.getSessionById(sessionId)
    if (!row) return { ok: false, reason: `Unknown sessionId: ${sessionId}` }
    if (sessions.isRunning(sessionId)) {
      return { ok: false, reason: 'Session is still running — kill it before restarting' }
    }
    if (!fs.existsSync(row.cwd)) {
      return { ok: false, reason: `Working directory not found: ${row.cwd}` }
    }
    // D34(c): an unknown persisted agent is a REFUSAL, not a throw. There is
    // no 'failed' session status (running|exited only) and no notification
    // centre until Phase 4, so the unknown-agent rule maps onto what exists:
    // an inline {ok:false} here, and the D16 spawn-failure heal path at
    // restore. sessions.agent is a TEXT column and can hold anything.
    const adapter = getAdapter(row.agent)
    if (!adapter) {
      return { ok: false, reason: `Unknown agent '${row.agent}' — this session cannot be restarted.` }
    }
    // Task 3-6 Step 7 (decision b): a credential-bearing session is never
    // relaunched keyless — not by the restore engine (healed to exited
    // chrome) and not by a manual restart. Restarting here would spawn on
    // AMBIENT credentials while the user believes the session runs on their
    // profile; the honest answer is an inline refusal.
    //
    // Task 3a-5: the PREDICATE's source changed (derived per-session from the
    // launch profile) and the MESSAGE is byte-identical, deliberately. Restart
    // and Relaunch are different verbs — restart means "same configuration, NO
    // credential"; relaunch means "same configuration, credential RE-RESOLVED
    // because you asked" — and this refusal is what makes the difference
    // legible. Changing it would be a gratuitous user-visible diff in a task
    // whose whole claim is that behaviour did not regress.
    if (storage.isSessionCredentialed(sessionId)) {
      return {
        ok: false,
        reason:
          'This session ran on a stored credential, which Chorus never re-supplies automatically. Launch a new session from the launch dialog to re-enter it.'
      }
    }
    try {
      // The cast is now justified by the registry lookup immediately above.
      const snap = sessions.launch(row.agent as AgentKind, row.cwd, row.id)
      storage.updateSessionStatus(sessionId, 'running', null)
      return restartResponseSchema.parse({
        ...snap,
        title: row.title,
        // v14: a restart is the SAME row, so it keeps its name — the pane header
        // must not lose who it is because the process was recycled.
        name: row.name,
        description: row.description,
        branch: branchForSession(row.id, row.projectId),
        worktreeId: worktreeForSession(row.id, row.projectId)?.id ?? null
      })
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IpcChannel.SessionDelete, (_event, payload): void => {
    const { sessionId } = deleteSessionRequestSchema.parse(payload)
    // Pane close ordering is kill -> awaited exit -> leaf removed -> delete;
    // a live PTY must never lose its row (the invisible-process guard's twin:
    // no PTY may exist that no pane can reach).
    if (sessions.isRunning(sessionId)) {
      throw new Error(`Refusing to delete live session: ${sessionId} (kill it first)`)
    }
    // 2-3 (F16/F18): detach any worktree this session owns BEFORE deleting the
    // row, keyed off the AUTHORITATIVE worktrees side (worktrees.session_id —
    // D26(a)), never sessions.worktree_id alone: crash windows and re-owns
    // leave that pointer NULL/stale while the enforced FK still bites.
    // detachWorktree clears BOTH pointers in ONE transaction (resolution a).
    // This step is LOAD-BEARING, not tidiness: better-sqlite3 enforces FKs
    // (default RESTRICT), so deleteSession throws while any worktrees row
    // references this session. The handler only ever DETACHES — the
    // remove-when-clean offer is renderer UX and runs before this call.
    const row = storage.getSessionById(sessionId)
    if (row) {
      for (const w of storage.getWorktreesForProject(row.projectId)) {
        if (w.sessionId === sessionId) storage.detachWorktree(w.id)
      }
    }
    // Task 3a-5: NOTHING unmarks the session here any more. The credentialed
    // fact lives in the row's own launch_profile_id, so it dies with the row —
    // structurally, rather than because a handler remembered to clear it.
    storage.deleteSession(sessionId)
  })

  /* ------------------------------------------------------------------ */
  /* Task 2-3: worktree cleanup channels (D26 clauses 5-8, Q4, (i), (j)) */
  /* ------------------------------------------------------------------ */

  ipcMain.handle(IpcChannel.WorktreeList, async (_event, payload): Promise<WorktreeSummary[]> => {
    const { project_id } = worktreeListRequestSchema.parse(payload)
    const p = requireProject(project_id)

    // F19 (2-3): the panel must surface what the table does not know about.
    // Same union scan the boot reconcile now runs — adopt managed worktrees
    // with a git entry but no row (population 4, the boot reconcile's own
    // rule applied to post-boot discoveries) and collect orphan directories
    // (population 5) for informational surfacing. Rows from the table alone
    // would leave a fresh/external worktree invisible here.
    const orphanDirs: string[] = []
    const repoRoot = await resolveRepoRoot(p.rootPath)
    if (repoRoot !== null) {
      try {
        const managedRoot = worktreeRootFor(repoRoot)
        const managedKey = pathKey(managedRoot)
        const gitEntries = (await listWorktrees(repoRoot)).filter((e) =>
          pathKey(e.path).startsWith(`${managedKey}\\`)
        )
        const rowKeys = new Set(storage.getWorktreesForProject(p.id).map((r) => pathKey(r.path)))
        for (const entry of gitEntries) {
          if (rowKeys.has(pathKey(entry.path))) continue
          // Population 4b (git metadata for a vanished dir, no row): the boot
          // reconcile logs it as a prune candidate; nothing here to act on.
          if (!fs.existsSync(entry.path)) continue
          storage.createWorktreeRow({
            id: randomUUID(),
            projectId: p.id,
            sessionId: null,
            path: path.win32.normalize(entry.path),
            branch: entry.branch ?? '',
            baseBranch: '',
            repoRoot,
            status: 'detached',
            createdAt: new Date().toISOString()
          })
          logger.info(`[worktrees] list: found untracked worktree ${entry.path}; adopted as detached`)
          rowKeys.add(pathKey(entry.path))
        }
        const entryKeys = new Set(gitEntries.map((e) => pathKey(e.path)))
        if (fs.existsSync(managedRoot)) {
          for (const d of fs.readdirSync(managedRoot, { withFileTypes: true })) {
            if (!d.isDirectory()) continue
            const dir = path.join(managedRoot, d.name)
            if (!entryKeys.has(pathKey(dir)) && !rowKeys.has(pathKey(dir))) orphanDirs.push(dir)
          }
        }
      } catch (err) {
        logger.warn({ err }, '[worktrees] list: repo scan failed; listing table rows only')
      }
    }

    const out: WorktreeSummary[] = []
    for (const w of storage.getWorktreesForProject(p.id)) {
      const dirGone = !fs.existsSync(w.path)
      // A status read can fail on a row whose dir lost its git metadata (P3);
      // treat it as DIRTY so removal still requires the typed token — the
      // protective default, and the panel stays loadable.
      const dirty = dirGone ? [] : await worktrees.getDirtyFiles(w.path).catch(() => ['(unreadable)'])
      // Adopted rows carry branch/baseBranch '' — an empty ref fails
      // rev-list, so skip git there; -1/-1 tells the panel to render —
      // instead of counts (also for prune candidates and git read failures).
      const { ahead, behind } =
        dirGone || w.branch === '' || w.baseBranch === ''
          ? { ahead: -1, behind: -1 }
          : await aheadBehind(w.repoRoot, w.branch, w.baseBranch).catch(() => ({
              ahead: -1,
              behind: -1
            }))
      out.push({
        id: w.id,
        path: w.path,
        branch: w.branch,
        status: w.status,
        clean: !dirGone && dirty.length === 0,
        dirtyCount: dirty.length,
        ahead,
        behind,
        isPruneCandidate: dirGone // population-2 surfacing (dir gone, git meta may remain)
      })
    }
    // Population 5 (orphan directories): surfaced INFORMATIONALLY with the
    // nil-uuid sentinel (no row exists). Reconcile never auto-deletes them —
    // they may be agent output, not debris — and the panel gives them no
    // action affordance (removal would be bespoke recursive fs deletion,
    // the data-loss surface D26(i) rejected for worktree removal).
    for (const dir of orphanDirs) {
      out.push({
        id: '00000000-0000-0000-0000-000000000000',
        path: dir,
        branch: '',
        status: 'orphan-dir',
        clean: true,
        dirtyCount: 0,
        ahead: -1,
        behind: -1,
        isPruneCandidate: true
      })
    }
    return worktreeListResponseSchema.parse(out)
  })

  ipcMain.handle(IpcChannel.WorktreeDirtyFiles, async (_event, payload): Promise<string[]> => {
    const { worktreeId } = worktreeDirtyFilesRequestSchema.parse(payload)
    const w = storage.getWorktreeById(worktreeId)
    if (!w || !fs.existsSync(w.path)) return []
    return worktreeDirtyFilesResponseSchema.parse(await worktrees.getDirtyFiles(w.path))
  })

  // Task 2-4: READ-ONLY diff summary for the pane header. Worktree resolution
  // goes through worktreeForSession (worktrees.session_id, F18 resolution a) —
  // the IDENTICAL path as the branch label, so the two can never disagree
  // about whether a session is in a worktree (a crash-window promote leaves
  // sessions.worktree_id NULL while the row-side pointer stands). No staging,
  // no commit, no merge, no removal, no --force: git diff + git status only.
  ipcMain.handle(
    IpcChannel.WorktreeDiffSummary,
    async (_event, payload): Promise<WorktreeDiffSummary | null> => {
      const { sessionId } = worktreeDiffRequestSchema.parse(payload)
      const row = storage.getSessionById(sessionId)
      if (!row) return null
      const wt = worktreeForSession(sessionId, row.projectId)
      if (!wt || !fs.existsSync(wt.path)) return null
      const stat = await diffShortstat(wt.path)
      const untracked = (await statusPorcelain(wt.path)).filter((l) => l.startsWith('??')).length
      return worktreeDiffResponseSchema.parse({ ...stat, untracked })
    }
  )

  ipcMain.handle(IpcChannel.WorktreeRemove, async (_event, payload): Promise<WorktreeRemoveResponse> => {
    const req = worktreeRemoveRequestSchema.parse(payload)
    const w = storage.getWorktreeById(req.worktreeId)
    if (!w) return worktreeRemoveResponseSchema.parse({ ok: false, reason: 'Worktree not found' })
    // The owning session must not be live (D26 clause 8: removal sequences
    // after the process tree has exited).
    if (w.sessionId && sessions.isRunning(w.sessionId)) {
      return worktreeRemoveResponseSchema.parse({
        ok: false,
        reason: 'Kill the owning session before removing its worktree'
      })
    }
    // LIVE cleanliness re-check (D26 clause 6): the renderer's fresh read
    // narrows the race window; this re-check closes it. Never trust the
    // panel's list-time clean flag — it may be hours stale.
    const dirGone = !fs.existsSync(w.path)
    const clean =
      dirGone || (await worktrees.getDirtyFiles(w.path).catch(() => ['(unreadable)'])).length === 0
    if (!dirtyRemovalAllowed({ path: w.path, clean }, req.confirmation)) {
      return worktreeRemoveResponseSchema.parse({
        ok: false,
        reason: 'Type the worktree path to confirm removing uncommitted work'
      })
    }
    try {
      await worktrees.removeWorktree(w.id, {
        deleteBranch: req.deleteBranch,
        // D26(i): --force reaches git ONLY here — the gated dirty-removal
        // path, after the live re-check AND the typed token. Every other
        // caller passes forceDirty: false.
        forceDirty: !clean,
        // D26(j) as amended by F21: -D escalation is licensed by its OWN
        // acknowledgment naming the branch. The dirty-removal token no longer
        // reaches this decision — a main-side gate, so the escalation is
        // unreachable regardless of what any renderer sends.
        forceBranch: branchForceAllowed(w, req.branchForceConfirmation)
      })
    } catch (err) {
      // A genuine removal failure leaves the row journaled 'removing' —
      // revert so the panel keeps offering it. (A branch-deletion refusal
      // deletes the row inside removeWorktree first, making this a no-op
      // there; the surfaced message still reaches the user.)
      storage.updateWorktreeStatus(w.id, 'detached')
      return worktreeRemoveResponseSchema.parse({
        ok: false,
        reason: err instanceof Error ? err.message : String(err)
      })
    }
    return worktreeRemoveResponseSchema.parse({ ok: true })
  })

  /* ------------------------------------------------------------------ */
  /* Task 3-2: providers + credential vault (D33)                        */
  /* ------------------------------------------------------------------ */

  ipcMain.handle(IpcChannel.ProviderList, (_event, payload): ProviderListResponse => {
    providerListRequestSchema.parse(payload ?? {})
    return providerListResponseSchema.parse(storage.listProviderConfigs().map(toWireProvider))
  })

  ipcMain.handle(IpcChannel.ProviderCreate, (_event, payload): ProviderCreateResponse => {
    const req = providerCreateRequestSchema.parse(payload)
    // spec §6.4: EVERY column on this form is PLAINTEXT (documented non-secret,
    // D33 resolution e) — a credential pasted into any of them defeats the
    // design. Refuse and redirect the user to a credential profile, where it is
    // encrypted.
    const secretRefusal = providerSecretRefusal(req)
    if (secretRefusal !== null) {
      return providerCreateResponseSchema.parse({ ok: false, reason: secretRefusal })
    }
    const row = storage.createProviderConfig({
      id: randomUUID(),
      name: req.name,
      adapterType: req.adapter_type,
      authMode: req.auth_mode,
      envVarName: req.env_var_name ?? null,
      baseUrl: req.base_url ?? null,
      extraHeadersJson: req.extra_headers_json ?? null,
      model: req.model ?? null,
      createdAt: new Date().toISOString()
    })
    return providerCreateResponseSchema.parse({ ok: true, provider: toWireProvider(row) })
  })

  ipcMain.handle(IpcChannel.ProviderUpdate, (_event, payload): ProviderUpdateResponse => {
    const req = providerUpdateRequestSchema.parse(payload)
    if (!storage.getProviderConfigById(req.id)) {
      return providerUpdateResponseSchema.parse({ ok: false, reason: 'Provider not found' })
    }
    // The same four-field check as create. ⚠ IT MUST BE ON BOTH: a row created
    // clean and then EDITED is the likelier path to a key on disk, because by
    // then the form is prefilled and the user is only changing one box.
    const secretRefusal = providerSecretRefusal(req)
    if (secretRefusal !== null) {
      return providerUpdateResponseSchema.parse({ ok: false, reason: secretRefusal })
    }
    // Patch semantics: absent = unchanged; null = clear; a value = set.
    const patch: Partial<Omit<NewProviderConfigRow, 'id' | 'createdAt'>> = {}
    if (req.name !== undefined) patch.name = req.name
    if (req.adapter_type !== undefined) patch.adapterType = req.adapter_type
    if (req.auth_mode !== undefined) patch.authMode = req.auth_mode
    if (req.env_var_name !== undefined) patch.envVarName = req.env_var_name
    if (req.base_url !== undefined) patch.baseUrl = req.base_url
    if (req.extra_headers_json !== undefined) patch.extraHeadersJson = req.extra_headers_json
    if (req.model !== undefined) patch.model = req.model
    storage.updateProviderConfig(req.id, patch)
    return providerUpdateResponseSchema.parse({ ok: true })
  })

  ipcMain.handle(IpcChannel.ProviderDelete, (_event, payload): ProviderDeleteResponse => {
    const { id } = providerDeleteRequestSchema.parse(payload)
    const existing = storage.getProviderConfigById(id)
    if (!existing) {
      return providerDeleteResponseSchema.parse({ ok: false, reason: 'Provider not found' })
    }
    // F16: credential_profiles.provider_id REFERENCES provider_configs(id) is
    // ENFORCED (default RESTRICT) — count-and-refuse BEFORE SQLite can throw,
    // never reverse-engineer a caught SQLITE_CONSTRAINT_FOREIGNKEY into a user
    // message (the failure mode Task 2-3 already paid for once).
    const referencing = storage.countCredentialProfilesForProvider(id)
    if (referencing > 0) {
      return providerDeleteResponseSchema.parse({
        ok: false,
        reason: `Provider '${existing.name}' still has ${referencing} credential profile${referencing === 1 ? '' : 's'} — delete ${referencing === 1 ? 'it' : 'them'} first`
      })
    }
    // Task 3a-5: the SECOND count on this handler. launch_profiles.provider_id
    // REFERENCES provider_configs(id) and is likewise ENFORCED, so it needs its
    // own authored refusal for exactly the same reason. (3a-4's model_catalog
    // needs none: it deliberately carries NO REFERENCES and is purged
    // explicitly inside deleteProviderConfig's own transaction — a cache must
    // not block a user flow, an instruction must.)
    const profilesUsing = storage.countLaunchProfilesForProvider(id)
    if (profilesUsing > 0) {
      return providerDeleteResponseSchema.parse({
        ok: false,
        reason: `Provider '${existing.name}' is used by ${profilesUsing} launch profile${profilesUsing === 1 ? '' : 's'} — delete ${profilesUsing === 1 ? 'it' : 'them'} first`
      })
    }
    storage.deleteProviderConfig(id)
    return providerDeleteResponseSchema.parse({ ok: true })
  })

  ipcMain.handle(IpcChannel.CredentialList, (_event, payload): CredentialListResponse => {
    credentialListRequestSchema.parse(payload ?? {})
    // Two independent barriers keep key material off the wire: toProfileMeta's
    // explicit construction inside the vault, then this OUTBOUND parse — a
    // handler returning a raw row (blob, fingerprint) fails loudly HERE.
    return credentialListResponseSchema.parse(vault.listProfiles())
  })

  // credential:create is NEVER logged — not at any level, behind any flag
  // (D33 redaction rule 4). The plaintext key enters exactly here, travels
  // renderer -> main once, and no response field ever carries it back.
  ipcMain.handle(IpcChannel.CredentialCreate, (_event, payload): CredentialCreateResponse => {
    const req = credentialCreateRequestSchema.parse(payload)
    if (!storage.getProviderConfigById(req.providerId)) {
      return credentialCreateResponseSchema.parse({ ok: false, reason: 'Provider not found' })
    }
    const result = vault.createProfile({
      providerId: req.providerId,
      label: req.label,
      key: req.key,
      baseUrl: req.baseUrl,
      extraHeaders: req.extraHeaders
    })
    return credentialCreateResponseSchema.parse(
      result.ok ? { ok: true, id: result.value.id } : { ok: false, reason: result.message }
    )
  })

  // credential:replace — same write-only discipline as create; never logged.
  ipcMain.handle(IpcChannel.CredentialReplace, (_event, payload): CredentialReplaceResponse => {
    const req = credentialReplaceRequestSchema.parse(payload)
    const result = vault.replaceProfile(req.id, {
      key: req.key,
      baseUrl: req.baseUrl,
      extraHeaders: req.extraHeaders
    })
    return credentialReplaceResponseSchema.parse(
      result.ok ? { ok: true } : { ok: false, reason: result.message }
    )
  })

  ipcMain.handle(IpcChannel.CredentialDelete, (_event, payload): CredentialDeleteResponse => {
    const { id } = credentialDeleteRequestSchema.parse(payload)
    if (!storage.getCredentialProfileById(id)) {
      return credentialDeleteResponseSchema.parse({ ok: false, reason: 'Credential profile not found' })
    }
    // ⚠ Task 3a-5: this handler had NO GUARD AT ALL before now, and did not
    // need one — nothing referenced credential_profiles. launch_profiles does,
    // with an ENFORCED FK, so without this count SQLite would throw
    // SQLITE_CONSTRAINT_FOREIGNKEY straight through a flow that has worked
    // since Task 3-2. Count and refuse BEFORE the statement runs; never
    // reverse-engineer the throw into a user message.
    //
    // ⚠ Task 3b-2 adds ONE COUNT to this guard; it does NOT add a second guard
    // and does NOT replace the one above. `council_members.credential_profile_id`
    // carries a REAL, ENFORCED `REFERENCES` for exactly the same reason
    // `launch_profiles` does (D62: a member is a live INSTRUCTION, not a
    // historical fact), so a credential can now be held by BOTH kinds of row and
    // both must be counted before the statement runs.
    //
    // The two counts are named DISTINCTLY in the refusal, because "used by 2
    // things" does not tell a user what to go and delete.
    const usedByProfiles = storage.countLaunchProfilesForCredential(id)
    const usedByMembers = storage.countCouncilMembersForCredential(id)
    if (usedByProfiles > 0 || usedByMembers > 0) {
      const parts: string[] = []
      if (usedByProfiles > 0) {
        parts.push(`${usedByProfiles} launch profile${usedByProfiles === 1 ? '' : 's'}`)
      }
      if (usedByMembers > 0) {
        parts.push(`${usedByMembers} council member${usedByMembers === 1 ? '' : 's'}`)
      }
      const total = usedByProfiles + usedByMembers
      return credentialDeleteResponseSchema.parse({
        ok: false,
        reason: `This credential is used by ${parts.join(' and ')} — delete ${total === 1 ? 'it' : 'them'} first`
      })
    }
    vault.deleteProfile(id)
    return credentialDeleteResponseSchema.parse({ ok: true })
  })

  // Task 3-6 test-key (D33 resolution d): ONE live auth probe, fired ONLY by
  // the renderer's Test-key button — never at boot, at launch, on a timer, or
  // on profile creation ("at your request" is load-bearing). The response is
  // a boolean plus a sanitized message; on success last_verified_at updates
  // (markCredentialVerified's one caller).
  ipcMain.handle(IpcChannel.CredentialTest, async (_event, payload): Promise<CredentialTestResponse> => {
    const { id } = credentialTestRequestSchema.parse(payload)
    const profile = storage.getCredentialProfileById(id)
    if (!profile) {
      return credentialTestResponseSchema.parse({ ok: false, reason: 'That credential profile no longer exists.' })
    }
    const provider = storage.getProviderConfigById(profile.providerId)
    if (!provider) {
      return credentialTestResponseSchema.parse({
        ok: false,
        reason: 'The provider for this credential profile no longer exists.'
      })
    }
    const dec = await vault.decryptForLaunch(id)
    if (!dec.ok) return credentialTestResponseSchema.parse({ ok: false, reason: dec.message })
    const result = await probeCredential(dec.value, provider)
    if (result.ok) storage.markCredentialVerified(id, new Date().toISOString())
    return credentialTestResponseSchema.parse(result.ok ? { ok: true } : { ok: false, reason: result.reason })
  })

  /* ------------------------------------------------------------------ */
  /* Task 3a-4: the model catalog. Registered HERE, immediately after the */
  /* test-key handler, so the app's two live-call channels sit together   */
  /* and a reviewer reads them as a pair.                                 */
  /*                                                                      */
  /* ⚠ NEITHER HANDLER WRITES provider_configs. The catalog is a list of  */
  /* what exists — never authoritative over the route's default model, and */
  /* a catalog miss warns rather than clearing, defaulting or             */
  /* substituting. Grep this diff for `UPDATE provider_configs`: zero.    */
  /* ------------------------------------------------------------------ */

  /** PURE READ — no network call, no decryption, nothing user-initiated about
   *  it. Freshness is computed HERE (one home for the 24 h threshold); the
   *  renderer does no date arithmetic. */
  ipcMain.handle(IpcChannel.ModelList, (_event, payload): ModelListResponse => {
    const { provider_id } = modelListRequestSchema.parse(payload)
    const rows = storage.getModelCatalogForProvider(provider_id)
    const refreshedAt = storage.getCatalogRefreshedAt(provider_id)
    return modelListResponseSchema.parse({
      models: rows.map((r) => ({
        modelId: r.modelId,
        displayName: r.displayName,
        contextLength: r.contextLength,
        expiresAt: r.expiresAt,
        missingSince: r.missingSince
      })),
      refreshedAt,
      freshness: catalogFreshness(refreshedAt, new Date().toISOString()),
      // D85: read from a DIFFERENT table than `models` above, and that is the
      // point — the shortlist is not a projection of the catalog. An id here
      // with no row above is a model the user chose that the last refresh did
      // not return, which is a fact worth keeping rather than one to filter out.
      shortlist: storage.getModelShortlistForProvider(provider_id).map((r) => r.modelId)
    })
  })

  /**
   * D85: the shortlist write. ⚠ THE CHEAPEST HANDLER IN THIS FILE, AND IT MUST
   * STAY THAT WAY. It touches one local table. It makes no network call, reads
   * no credential, and calls nothing in `modelCatalog.ts` — a "helpfully"
   * refresh-then-shortlist convenience here would send the user's key on a
   * click that asked for nothing of the sort, which is the exact shape
   * `model:refresh`'s one-caller rule exists to prevent.
   *
   * ⚠ AND IT DOES NOT VALIDATE THE ID AGAINST THE CATALOG. See v12: a shortlist
   * constrained to ids a refresh happened to return would make the catalog
   * authoritative by construction, against D48/D56.
   */
  ipcMain.handle(IpcChannel.ModelShortlistSet, (_event, payload): ModelShortlistSetResponse => {
    const req = modelShortlistSetRequestSchema.parse(payload)
    if (!storage.getProviderConfigById(req.provider_id)) {
      return modelShortlistSetResponseSchema.parse({
        ok: false,
        reason: 'That provider no longer exists.'
      })
    }
    storage.setModelShortlisted(
      req.provider_id,
      req.model_id,
      req.shortlisted,
      new Date().toISOString()
    )
    // The list AFTER the write, so the renderer never renders its own guess.
    return modelShortlistSetResponseSchema.parse({
      ok: true,
      shortlist: storage.getModelShortlistForProvider(req.provider_id).map((r) => r.modelId)
    })
  })

  /**
   * ONE live GET <base_url>/models. USER-INITIATED ONLY — this handler has
   * exactly one caller, the Refresh button, and nothing in main calls it at
   * boot, at launch, on a timer, on settings-open, or on profile creation.
   *
   * The body is a call into modelCatalog.ts plus storage.applyCatalogDiff. It
   * CONTAINS NO POLICY, and in particular no write to provider_configs — not
   * even a "helpful" clear of a model that just went missing, which is the
   * exact convenience this whole task exists to refuse.
   *
   * ⚠ A success does NOT call markCredentialVerified. This endpoint answers
   * 200 with no credential at all, so a 200 is not evidence of authentication
   * and must not be dressed up as one (Task 3a-4 Goal §3).
   */
  ipcMain.handle(IpcChannel.ModelRefresh, async (_event, payload): Promise<ModelRefreshResponse> => {
    const req = modelRefreshRequestSchema.parse(payload)
    const provider = storage.getProviderConfigById(req.provider_id)
    if (!provider) {
      return modelRefreshResponseSchema.parse({
        ok: false,
        reason: 'That provider no longer exists.'
      })
    }
    // A named-but-missing profile is a refusal, never a silent downgrade to
    // the unauthenticated path: the user asked for that credential.
    let profile: CredentialProfileRow | null = null
    if (req.credential_id !== null) {
      profile = storage.getCredentialProfileById(req.credential_id)
      if (!profile) {
        return modelRefreshResponseSchema.parse({
          ok: false,
          reason: 'That credential profile no longer exists.'
        })
      }
      if (profile.providerId !== provider.id) {
        return modelRefreshResponseSchema.parse({
          ok: false,
          // Scrubbed, like every message probeFailure emits: the label and the
          // provider name are user-authored free text, so a user who pasted a
          // key into one must not have it echoed back into the DOM.
          reason: scrubSecrets(
            `Credential profile '${profile.label}' does not belong to provider '${provider.name}'.`
          )
        })
      }
    }

    const result = await refreshProviderModels({ provider, profile, vault })
    if (!result.ok) {
      return modelRefreshResponseSchema.parse({ ok: false, reason: result.reason })
    }

    const nowIso = new Date().toISOString()
    const existing = storage.getModelCatalogForProvider(provider.id)
    const diff = computeCatalogDiff(existing, result.models, nowIso, result.droppedCount)
    storage.applyCatalogDiff(provider.id, diff)
    // droppedCount is REPORTED, never silently swallowed — a provider that
    // suddenly fails validation on part of its list is a finding. Counts only;
    // no ids, no provider text.
    logger.info(
      `[models] refresh ${provider.name}: ${diff.addedCount} added · ${diff.updatedCount} updated · ${diff.markMissing.length} newly missing · ${diff.droppedCount} dropped · authenticated=${profile !== null}`
    )
    return modelRefreshResponseSchema.parse({
      ok: true,
      added: diff.addedCount,
      updated: diff.updatedCount,
      missing: diff.markMissing.length,
      dropped: diff.droppedCount,
      refreshedAt: nowIso
    })
  })

  /* ------------------------------------------------------------------ */
  /* Task 3a-5 / D43: launch profiles                                     */
  /* ------------------------------------------------------------------ */

  ipcMain.handle(IpcChannel.LaunchProfileList, (): LaunchProfileListResponse => {
    return launchProfileListResponseSchema.parse({ profiles: listLaunchProfileWire() })
  })

  ipcMain.handle(IpcChannel.LaunchProfileCreate, (_event, payload): LaunchProfileCreateResponse => {
    const req = launchProfileCreateRequestSchema.parse(payload)
    const provider = req.provider_id ? storage.getProviderConfigById(req.provider_id) : null
    const shape = validateProfileShape(
      {
        label: req.label,
        agent: req.agent,
        providerId: req.provider_id,
        credentialProfileId: req.credential_profile_id,
        model: req.model,
        effort: req.effort,
        permissionMode: req.permission_mode,
        workspaceMode: req.workspace_mode,
        envJson: req.env_json
      },
      provider,
      containsSecret
    )
    if (!shape.ok) {
      return launchProfileCreateResponseSchema.parse({ ok: false, reason: shape.reason })
    }
    // Checked HERE so the refusal is an AUTHORED sentence. The UNIQUE(label)
    // constraint stays as a backstop; it is never the thing the user reads.
    if (storage.getLaunchProfileByLabel(req.label.trim())) {
      return launchProfileCreateResponseSchema.parse({
        ok: false,
        reason: `A launch profile named '${req.label.trim()}' already exists.`
      })
    }
    // A credential must belong to the route it is being saved against — main
    // never trusts the renderer's pairing.
    if (req.credential_profile_id) {
      const cred = storage.getCredentialProfileById(req.credential_profile_id)
      if (!cred) {
        return launchProfileCreateResponseSchema.parse({
          ok: false,
          reason: 'That credential profile no longer exists.'
        })
      }
      if (cred.providerId !== req.provider_id) {
        return launchProfileCreateResponseSchema.parse({
          ok: false,
          reason: scrubSecrets(`Credential '${cred.label}' does not belong to that route.`)
        })
      }
    }
    const now = new Date().toISOString()
    const row = storage.createLaunchProfile({
      id: randomUUID(),
      label: req.label.trim(),
      agent: req.agent,
      providerId: req.provider_id,
      credentialProfileId: req.credential_profile_id,
      model: req.model,
      effort: req.effort,
      permissionMode: req.permission_mode,
      workspaceMode: req.workspace_mode,
      envJson: req.env_json,
      createdAt: now,
      updatedAt: now
    })
    // Ids and counts only — a label is user-authored free text, so it is
    // scrubbed like every other outbound string.
    logger.info(`[launch-profile] created ${row.id} (agent ${row.agent})`)
    return launchProfileCreateResponseSchema.parse({ ok: true, profile: toWire(row) })
  })

  ipcMain.handle(IpcChannel.LaunchProfileUpdate, (_event, payload): LaunchProfileUpdateResponse => {
    const req = launchProfileUpdateRequestSchema.parse(payload)
    const existing = storage.getLaunchProfileById(req.id)
    if (!existing) {
      return launchProfileUpdateResponseSchema.parse({
        ok: false,
        reason: 'That launch profile no longer exists.'
      })
    }
    // Patch semantics: absent = unchanged, null = clear, a value = set. The
    // MERGED shape is validated, never the patch alone.
    const merged = {
      label: req.label ?? existing.label,
      agent: existing.agent,
      providerId: existing.providerId,
      credentialProfileId:
        req.credential_profile_id === undefined
          ? existing.credentialProfileId
          : req.credential_profile_id,
      model: req.model === undefined ? existing.model : req.model,
      effort: req.effort === undefined ? existing.effort : req.effort,
      permissionMode:
        req.permission_mode === undefined ? existing.permissionMode : req.permission_mode,
      workspaceMode: req.workspace_mode ?? existing.workspaceMode,
      envJson: req.env_json === undefined ? existing.envJson : req.env_json
    }
    const provider = merged.providerId ? storage.getProviderConfigById(merged.providerId) : null
    const shape = validateProfileShape(merged, provider, containsSecret)
    if (!shape.ok) {
      return launchProfileUpdateResponseSchema.parse({ ok: false, reason: shape.reason })
    }
    if (req.label !== undefined) {
      const clash = storage.getLaunchProfileByLabel(req.label.trim())
      if (clash && clash.id !== req.id) {
        return launchProfileUpdateResponseSchema.parse({
          ok: false,
          reason: `A launch profile named '${req.label.trim()}' already exists.`
        })
      }
    }
    const updated = storage.updateLaunchProfile(req.id, {
      label: merged.label.trim(),
      credentialProfileId: merged.credentialProfileId,
      model: merged.model,
      effort: merged.effort,
      permissionMode: merged.permissionMode,
      workspaceMode: merged.workspaceMode,
      envJson: merged.envJson,
      updatedAt: new Date().toISOString()
    })
    if (!updated) {
      return launchProfileUpdateResponseSchema.parse({
        ok: false,
        reason: 'That launch profile no longer exists.'
      })
    }
    // ⚠ A RENAME HAS NO DOWNSTREAM CONSEQUENCE (D43). Nothing else is touched:
    // sessions.launch_profile_id and last_launch_profile:<projectId> both store
    // the IMMUTABLE ID, so they keep pointing at this row without being
    // rewritten, and a live session is entirely unaffected.
    return launchProfileUpdateResponseSchema.parse({ ok: true, profile: toWire(updated) })
  })

  ipcMain.handle(IpcChannel.LaunchProfileDelete, (_event, payload): LaunchProfileDeleteResponse => {
    const { id } = launchProfileDeleteRequestSchema.parse(payload)
    // ⚠ NO COUNT-AND-REFUSE HERE, deliberately, and this is the asymmetry the
    // FK design buys: sessions hold a SOFT pointer with no REFERENCES clause,
    // so deleting a profile cannot throw for a session that used it, and the
    // now-dangling pointer is absorbed by the FAIL-SAFE predicate — such a
    // session reads as credentialed and is healed rather than relaunched
    // keyless. A guard here would block a delete for a reason the user cannot
    // act on.
    storage.deleteLaunchProfile(id)
    logger.info(`[launch-profile] deleted ${id}`)
    return launchProfileDeleteResponseSchema.parse({ ok: true })
  })

  /* ------------------------------------------------------------------ */
  /* Task 3b-2 / D62: council members                                     */
  /*                                                                      */
  /* ⚠ NOTHING HERE ORCHESTRATES ANYTHING, MAKES AN API CALL, OR SPENDS A */
  /* CENT. These four channels configure WHO the council is; 3b-3 is what  */
  /* runs it. There is deliberately no "test this member" button — it      */
  /* would be a live billable call, and D57 is the standing warning about  */
  /* tests that cannot fail.                                              */
  /*                                                                      */
  /* ⚠ NO `provider_id` CROSSES THIS BOUNDARY IN EITHER DIRECTION. A       */
  /* member names a ROUTE BY NAMING A CREDENTIAL (D48/D56); the route is   */
  /* derived through `credential_profiles.provider_id`, which is the only  */
  /* home it has.                                                          */
  /* ------------------------------------------------------------------ */

  /** PURE READ — decrypts nothing, calls nothing, spends nothing. */
  ipcMain.handle(IpcChannel.CouncilMemberList, (): CouncilMemberListResponse => {
    return councilMemberListResponseSchema.parse({ members: listCouncilMemberWire() })
  })

  ipcMain.handle(IpcChannel.CouncilMemberCreate, (_event, payload): CouncilMemberCreateResponse => {
    const req = councilMemberCreateRequestSchema.parse(payload)
    const { credential, provider } = councilRouteFor(req.credentialProfileId)
    // Every OTHER member's label — on create that is all of them. The
    // UNIQUE(label) constraint stays a BACKSTOP; it is never what a user reads.
    const existingLabels = storage.listCouncilMembers().map((m) => m.label)
    const shape = validateMemberShape(
      {
        label: req.label,
        credentialProfileId: req.credentialProfileId,
        model: req.model,
        role: req.role,
        paramsJson: req.paramsJson
      },
      existingLabels,
      credential,
      provider,
      containsSecret
    )
    if (!shape.ok) {
      return councilMemberCreateResponseSchema.parse({ ok: false, reason: shape.reason })
    }
    const now = new Date().toISOString()
    const row = storage.createCouncilMember({
      id: randomUUID(),
      label: req.label.trim(),
      credentialProfileId: req.credentialProfileId,
      // ⚠ WRITTEN EXACTLY AS SENT. A NULL model STAYS NULL — the route's
      // default is NEVER copied in here (D56). That back-write is the second
      // home D48 exists to prevent, and it is one line away at all times.
      model: req.model,
      role: req.role,
      paramsJson: req.paramsJson,
      createdAt: now,
      updatedAt: now
    })
    // Ids and counts only — a label is user-authored free text, so it is
    // scrubbed like every other outbound string.
    logger.info(`[council-member] created ${row.id} (role ${row.role})`)
    return councilMemberCreateResponseSchema.parse({ ok: true, member: toCouncilMemberWire(row) })
  })

  ipcMain.handle(IpcChannel.CouncilMemberUpdate, (_event, payload): CouncilMemberUpdateResponse => {
    const req = councilMemberUpdateRequestSchema.parse(payload)
    const existing = storage.getCouncilMemberById(req.id)
    if (!existing) {
      return councilMemberUpdateResponseSchema.parse({
        ok: false,
        reason: 'That council member no longer exists.'
      })
    }
    // Patch semantics: absent = unchanged, null = clear, a value = set. The
    // MERGED shape is validated, never the patch alone.
    const merged = {
      label: req.label ?? existing.label,
      credentialProfileId: req.credentialProfileId ?? existing.credentialProfileId,
      model: req.model === undefined ? existing.model : req.model,
      role: req.role ?? existing.role,
      paramsJson: mergeParamsPatch(existing.paramsJson, req.paramsJson, req.maxTokens)
    }
    const { credential, provider } = councilRouteFor(merged.credentialProfileId)
    // ⚠ THIS MEMBER'S OWN LABEL IS EXCLUDED. A rename must be able to keep a
    // name this row already holds, and re-saving without a rename must not
    // refuse itself (D43: the label is freely renameable).
    const existingLabels = storage
      .listCouncilMembers()
      .filter((m) => m.id !== req.id)
      .map((m) => m.label)
    const shape = validateMemberShape(merged, existingLabels, credential, provider, containsSecret)
    if (!shape.ok) {
      return councilMemberUpdateResponseSchema.parse({ ok: false, reason: shape.reason })
    }
    const updated = storage.updateCouncilMember(req.id, {
      label: merged.label.trim(),
      credentialProfileId: merged.credentialProfileId,
      model: merged.model,
      role: merged.role,
      paramsJson: merged.paramsJson,
      updatedAt: new Date().toISOString()
    })
    if (!updated) {
      return councilMemberUpdateResponseSchema.parse({
        ok: false,
        reason: 'That council member no longer exists.'
      })
    }
    // ⚠ A RENAME HAS NO DOWNSTREAM CONSEQUENCE (D43). Nothing else is touched,
    // and nothing else NEEDS to be: `council_messages.member_id` stores the
    // IMMUTABLE ID, so every transcript keeps pointing at this row without
    // being rewritten. If this ever grows a "fix up the references" step, the
    // id-vs-label rule has been broken somewhere upstream.
    return councilMemberUpdateResponseSchema.parse({
      ok: true,
      member: toCouncilMemberWire(updated)
    })
  })

  ipcMain.handle(IpcChannel.CouncilMemberDelete, (_event, payload): CouncilMemberDeleteResponse => {
    const { id } = councilMemberDeleteRequestSchema.parse(payload)
    // ⚠ NO COUNT-AND-REFUSE HERE, deliberately, and it is the same asymmetry
    // the FK design buys for launch profiles above: `council_runs` and
    // `council_messages` hold SOFT pointers with no REFERENCES clause (D62), so
    // deleting a member cannot throw for a run it joined, and a transcript
    // stays true once the member that spoke it is gone. A guard here would
    // block a delete for a reason the user cannot act on — and a FK here would
    // make deleting a member throw for EVERY run it ever joined.
    storage.deleteCouncilMember(id)
    logger.info(`[council-member] deleted ${id}`)
    return councilMemberDeleteResponseSchema.parse({ ok: true })
  })

  /**
   * Task 3a-5 / D49 + D53: one-click relaunch of a session that was healed to
   * `exited` because it held a credential.
   *
   * ⚠⚠ THE INVARIANT THIS HANDLER EXISTS TO PRESERVE.
   *
   * Restore stays decision (b), and there is NO UNATTENDED RESOLUTION OF A
   * LAUNCH CREDENTIAL. Option (a) — re-resolving credentials inside restore() —
   * was DECLINED because D33 never sanctioned decrypting a launch credential
   * with no user present, and this task does not reintroduce it by the side
   * door. The ONLY thing added is this handler, which decrypts BECAUSE A HUMAN
   * CLICKED SOMETHING.
   *
   * That distance is the entire security argument, and it is ONE CARELESS
   * `await` WIDE: if any part of this logic is ever factored into a helper that
   * restore() also calls, the invariant is gone and NOTHING WILL FAIL TO
   * COMPILE. `SessionManager` contains zero references to the vault; keep it
   * that way.
   *
   * ⚠ On the call-site census: after this task `vault.decryptForLaunch` has
   * FIVE call sites, not three. Four are INFERENCE-credential paths and every
   * one of them is user-initiated — resolveCredential (launch), credential:test
   * (Test key), modelCatalog (Refresh), and this handler. The fifth is 3a-3's
   * MANAGEMENT-key thunk in index.ts, which does run at boot; that is a
   * different credential class that cannot do inference, is refused by
   * resolveCredential before decryption, and never reaches a child PTY. The
   * invariant is about the launch class. See _verify/3a-5/INVARIANT.md.
   */
  ipcMain.handle(IpcChannel.SessionRelaunch, async (_event, payload): Promise<RelaunchResponse> => {
    const { sessionId } = relaunchRequestSchema.parse(payload)
    const row = storage.getSessionById(sessionId)
    if (!row) {
      return relaunchResponseSchema.parse({ ok: false, reason: `Unknown sessionId: ${sessionId}` })
    }
    if (sessions.isRunning(sessionId)) {
      return relaunchResponseSchema.parse({
        ok: false,
        reason: 'Session is still running — kill it first'
      })
    }
    if (!fs.existsSync(row.cwd)) {
      return relaunchResponseSchema.parse({
        ok: false,
        reason: `Working directory not found: ${row.cwd}`
      })
    }
    if (!isAgentKind(row.agent)) {
      return relaunchResponseSchema.parse({
        ok: false,
        reason: `Unknown agent '${row.agent}' — this session cannot be relaunched.`
      })
    }
    // The LEGACY population and every bare-credential session land HERE, and
    // correctly: the retired settings list recorded ids only, so there is
    // nothing to resolve, and the honest answer is the one the healed title
    // already gives. Nothing special-cases the sentinel — it is simply a
    // pointer that does not resolve.
    const profile = row.launchProfileId ? storage.getLaunchProfileById(row.launchProfileId) : null
    if (!profile) {
      return relaunchResponseSchema.parse({
        ok: false,
        reason:
          'This session has no saved launch profile — start a new one from the launch dialog.'
      })
    }
    const resolution = resolveLaunchProfile(
      profile,
      profile.providerId ? storage.getProviderConfigById(profile.providerId) : null,
      profile.credentialProfileId
        ? storage.getCredentialProfileById(profile.credentialProfileId)
        : null
    )
    if (!resolution.ok) {
      return relaunchResponseSchema.parse({ ok: false, reason: resolution.reason })
    }
    const effortOpt: Pick<LaunchOptions, 'effort'> = resolution.plan.effort
      ? { effort: resolution.plan.effort }
      : {}
    const envOpt: Pick<LaunchOptions, 'envAdditions'> =
      Object.keys(resolution.plan.envAdditions).length > 0
        ? { envAdditions: resolution.plan.envAdditions }
        : {}
    let opts: LaunchOptions = { ...effortOpt, ...envOpt }
    if (resolution.plan.credentialProfileId) {
      // REUSE, do not fork: exactly one function in main resolves a launch
      // credential, so D33 clause 8's refusals have one place to live. A row
      // carrying unavailable_since is refused by resolveLaunchProfile ABOVE,
      // by label, WITHOUT re-attempting decryption.
      const resolved = await resolveCredential(resolution.plan.credentialProfileId, row.agent)
      if (!resolved.ok) return relaunchResponseSchema.parse({ ok: false, reason: resolved.reason })
      opts = {
        ...effortOpt,
        ...envOpt,
        secrets: [resolved.credential.value],
        credential: resolved.credential,
        ...(resolved.route ? { route: resolved.route } : {})
      }
    }
    try {
      // Same row id, the session:restart shape: no row creation, and 'running'
      // written ONLY AFTER the spawn succeeds.
      const snap = sessions.launch(row.agent, row.cwd, row.id, opts)
      storage.updateSessionStatus(sessionId, 'running', null)
      // ⚠ The healed title is NOT cleared. If the agent emits its own OSC title
      // it will replace it (D18's mechanism, already running); clearing it here
      // would be main inventing a title, which nothing else in the app does.
      const wt = row.worktreeId ? storage.getWorktreeById(row.worktreeId) : null
      return relaunchResponseSchema.parse({
        ...snap,
        title: row.title,
        // Same row, same name — see session:restart above.
        name: row.name,
        description: row.description,
        branch: wt?.branch ?? null,
        worktreeId: wt?.id ?? null
      })
    } catch (err) {
      return relaunchResponseSchema.parse({
        ok: false,
        reason: scrubSecrets(err instanceof Error ? err.message : String(err))
      })
    }
  })

  /* ------------------------------------------------------------------ */
  /* Task 3b-3: the council run                                          */
  /* ------------------------------------------------------------------ */

  /**
   * ⚠ THE THIRD PATH A STORED INFERENCE CREDENTIAL TRAVELS, and it inherits
   * D58's terms whole. Numbered so the count stays auditable:
   *   1. credential:test  (Task 3-6, D33 resolution d)
   *   2. model:refresh    (Task 3a-4)
   *   3. council:start    (this)
   *
   * ⚠ IT IS THE THIRD AND NOT THE FOURTH BECAUSE `api:probe` WAS DELETED IN
   * THIS COMMIT. 3b-1 shipped it labelled *"a DELIBERATELY TEMPORARY proof
   * surface … 3b-3 adopts this or deletes it"*, and the honest answer is
   * delete: the transport now has a real consumer with real tests and a live
   * drive, which is strictly better proof than a probe with no product behind
   * it. Adopting it would have meant keeping a permanently-reachable billable
   * path that no user interface can reach — the exact shape D58 exists to stop
   * accumulating.
   *
   * ⚠ AND D60 IS THE INVARIANT, NOT THE COUNT: no code path reachable WITHOUT A
   * USER GESTURE may resolve a LAUNCH credential. `council:start` is reachable
   * only by invoke, and a council run writes no `sessions` row (D63 Q2), so the
   * restore engine structurally cannot reach it either — the guarantee holds by
   * construction rather than by a guard.
   *
   * ⚠ THE CREDENTIAL IS DECRYPTED AND THROWN AWAY. `resolveCredential` is
   * REUSED for its five ordered refusals and for the effective ROUTE; the key
   * that actually goes into the `Authorization` header is the run's MINTED one,
   * because that is what gives the run a single bounded spend surface (D64(2)).
   * Decrypting a key we never send is a real cost, paid deliberately: the
   * alternative is a second, shorter refusal ladder that drifts from the first.
   */
  const resolveMemberRoute = async (
    credentialProfileId: string
  ): Promise<{ ok: true; route: MemberRoute | null } | { ok: false; reason: string }> => {
    // ⚠ D84 — THIS IS WHAT USED TO BE BLOCKER A, AND THE FIX IS A DELETION.
    // The council has no agent CLI, so it now says so: `null`. It previously
    // parsed an `AgentKind` out of `provider.adapterType` and passed it back
    // in — the comment here said in as many words that this made
    // `resolveCredential`'s ownership check "a no-op HERE", which is true and
    // is the point: the parse existed ONLY to manufacture an argument for a
    // check it then defeated by construction. Its only real effect was the
    // REFUSAL when the parse failed, which fired on precisely the providers
    // that name a route rather than a harness — a configuration Settings
    // accepted and a council run then rejected at spend time.
    //
    // Every other refusal in `resolveCredential` still runs, in the same order:
    // missing profile, known-bad row, missing provider, MANAGEMENT class,
    // no env var name, decrypt failure.
    //
    // ⚠ THE TWO PRE-LOOKUPS THAT USED TO STAND HERE ARE GONE WITH THE PARSE
    // THEY FED. They re-derived `profile` and `provider` only to reach
    // `adapterType`, and re-emitted two refusals `resolveCredential` already
    // emits WORD FOR WORD. Keeping them would be exactly the "second, shorter
    // refusal ladder that drifts from the first" the note above warns against.
    const resolved = await resolveCredential(credentialProfileId, null)
    if (!resolved.ok) return { ok: false, reason: resolved.reason }
    // ⚠ THE PLAINTEXT DIES HERE. Only the route survives this function, and the
    // env var name on it is non-secret metadata.
    if (!resolved.route) return { ok: true, route: null }
    return {
      ok: true,
      route: { baseUrl: resolved.route.baseUrl, envVarName: resolved.credential.envVarName }
    }
  }

  const council = createCouncilService({
    storage,
    keys,
    hasManagementKey,
    resolveMemberRoute,
    // The broadcast, following `session:data` exactly: validated HERE in main
    // (the preload cannot run Zod under the page CSP) and fanned out to every
    // window. Its text already came through SessionOutput's scrubber.
    emitProgress: (event) => {
      const parsed = councilProgressEventSchema.parse(event)
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IpcChannel.CouncilProgress, parsed)
      }
    },
    // The at-a-glance vector, once per run, when the positions round closes.
    // Same validate-here-then-fan-out shape as the progress broadcast above —
    // and the `.parse` is what puts the outbound payload through the same
    // boundary the response's copy of it goes through, so a live strip and a
    // finished one cannot be validated to different standards.
    emitSummary: (event) => {
      const parsed = councilSummaryEventSchema.parse(event)
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IpcChannel.CouncilSummary, parsed)
      }
    },
    gatewayBaseUrl: OPENROUTER_GATEWAY_BASE_URL
  })

  /**
   * The brief picker. `dialog.showOpenDialog` in MAIN — the `project:add`
   * precedent down to the structured cancel — filtered to `.md`.
   *
   * ⚠ IT IS NOT THE SECURITY BOUNDARY AND MUST NOT BE MISTAKEN FOR ONE. The
   * renderer can call `council:start` with any string it likes; what makes the
   * path safe is `councilService.validateBriefPath`, which runs on every start
   * regardless of where the path came from. This handler only saves the user
   * from typing one.
   */
  ipcMain.handle(IpcChannel.CouncilPickBrief, async (_event, payload): Promise<CouncilPickBriefResponse> => {
    councilPickBriefRequestSchema.parse(payload ?? {})
    const result = await dialog.showOpenDialog({
      title: 'Choose a council brief',
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (result.canceled || !result.filePaths[0]) {
      return councilPickBriefResponseSchema.parse({ cancelled: true })
    }
    return councilPickBriefResponseSchema.parse({ path: result.filePaths[0] })
  })

  ipcMain.handle(IpcChannel.CouncilStart, async (_event, payload): Promise<CouncilStartResponse> => {
    const req = councilStartRequestSchema.parse(payload)
    // ⚠ THE PATH GOES IN RAW AND THE SERVICE REFUSES IT. Nothing is checked
    // here: one boundary, in one place, that every caller crosses.
    const result = await council.start({ projectId: req.project_id, briefPath: req.brief_path })
    if (!result.ok) {
      return councilStartResponseSchema.parse({ ok: false, reason: result.reason })
    }
    return councilStartResponseSchema.parse({
      ok: true,
      run_id: result.runId,
      findings: result.findings,
      findings_path: result.findingsPath,
      findings_error: result.findingsError,
      // The per-question glance. Derived by the core from the same verdict
      // vector the findings document is assembled from, so the strip and the
      // file can never say different things about the same run.
      question_summary: result.questionSummary,
      // ⚠ D55: the cost never travels without its denominator, and the outbound
      // `.parse` is what enforces that rather than a convention.
      accounting: result.accounting,
      cost_usd: result.costUsd,
      // F41: says whether the figure above is the settled ledger reading or the
      // early one that omits the final turn. Required by the schema, so it
      // cannot be dropped and leave the number looking authoritative.
      cost_is_provisional: result.costIsProvisional
    })
  })

  ipcMain.handle(IpcChannel.CouncilCancel, (_event, payload): CouncilCancelResponse => {
    const req = councilCancelRequestSchema.parse(payload)
    return councilCancelResponseSchema.parse({ cancelled: council.cancel(req.run_id) })
  })

  /**
   * D97 / Task 3e-4 — the transcript reader. **Validates, reads, bounds,
   * returns, and mutates nothing.**
   *
   * ⚠ IT CALLS THE READ FUNCTION THAT ALREADY EXISTS (`storage.ts:1819`) rather
   * than writing a second query over `council_messages`. That function shipped
   * in 3b-2 with zero callers and its ordering — round, then insertion — is the
   * shape the `council_messages_run` index was created for. A second read path
   * over one table is the two-homes hazard this codebase keeps ruling against.
   */
  ipcMain.handle(IpcChannel.CouncilTranscript, (_event, payload): CouncilTranscriptResponse => {
    const req = councilTranscriptRequestSchema.parse(payload)
    const rows = storage.getCouncilMessagesForRun(req.run_id)
    const turns: CouncilTranscriptTurn[] = []
    let chars = 0
    let truncated = false
    for (const row of rows) {
      const remaining = COUNCIL_TRANSCRIPT_CAP_CHARS - chars
      if (remaining <= 0) {
        truncated = true
        break
      }
      // The last turn admitted may be CUT rather than dropped, so a single
      // enormous turn still shows its beginning instead of the read returning
      // nothing at all. Either way `truncated` says so.
      const text = row.content.length <= remaining ? row.content : row.content.slice(0, remaining)
      if (text.length < row.content.length) truncated = true
      chars += text.length
      turns.push({
        member_id: row.memberId,
        phase: row.phase,
        round: row.round,
        text
      })
    }
    if (turns.length < rows.length) truncated = true
    // ⚠ D14: plain objects only. `better-sqlite3` rows already are, and the
    // literals above keep them that way — nothing reactive, nothing decorated.
    return councilTranscriptResponseSchema.parse({
      run_id: req.run_id,
      turns,
      total_turns: rows.length,
      truncated,
      chars,
      cap_chars: COUNCIL_TRANSCRIPT_CAP_CHARS
    })
  })

  /* ══════════════ The Docket — D112–D115 ══════════════ */

  /**
   * Read a run's brief back and enumerate its questions.
   *
   * ⚠ THE QUESTIONS ARE THE STRIP'S SPINE, AND THEY LIVE ONLY IN THE BRIEF.
   * `council_messages` stores answers, never the prompt, so a brief that has been
   * moved or deleted takes the strip with it — which is a stated absence, exactly
   * as a missing findings document is, and never a silently empty strip that
   * would read as "this council decided nothing".
   *
   * Same validator as everywhere else in this file, with its own noun (D112).
   */
  const questionsForBrief = (briefPath: string): { questions: string[]; reason: string | null } => {
    const checked = validateBriefPath(briefPath, 'brief', 'It is too large to read back.')
    if (!checked.ok) return { questions: [], reason: checked.reason }
    try {
      return { questions: [...parseBriefQuestions(fs.readFileSync(checked.path, 'utf8'))], reason: null }
    } catch {
      return { questions: [], reason: 'That brief could not be read.' }
    }
  }

  /** A run's roster label, falling back to the id — a member deleted since the
   *  run still has to appear in its own transcript (D62). */
  const labelForMember = (memberId: string): string =>
    storage.getCouncilMemberById(memberId)?.label ?? memberId

  /** Group the two phases this feature reads into one run's inputs. */
  const verdictInputsFor = (
    source: readonly { runId: string; memberId: string | null; phase: string; content: string }[]
  ): Map<string, { positions: { memberId: string; content: string }[]; arbitration: string | null }> => {
    const out = new Map<string, { positions: { memberId: string; content: string }[]; arbitration: string | null }>()
    for (const row of source) {
      const entry = out.get(row.runId) ?? { positions: [], arbitration: null }
      if (row.phase === 'positions' && row.memberId !== null) {
        entry.positions.push({ memberId: row.memberId, content: row.content })
      } else if (row.phase === 'arbitration' && entry.arbitration === null) {
        entry.arbitration = row.content
      }
      out.set(row.runId, entry)
    }
    return out
  }

  /**
   * One compact digest per run, for the Docket list.
   *
   * ⚠ BRIEFS ARE READ ONCE PER PATH, NOT ONCE PER RUN. Re-running one brief is
   * the ordinary case rather than the exception, so a project with five runs
   * across two briefs performs two file reads here, not five.
   */
  const verdictDigestsFor = (runs: readonly CouncilRunRow[]): Map<string, string | null> => {
    const inputs = verdictInputsFor(storage.getCouncilVerdictSource(runs.map((r) => r.id)))
    const briefCache = new Map<string, { questions: string[]; reason: string | null }>()
    const out = new Map<string, string | null>()
    for (const run of runs) {
      let brief = briefCache.get(run.briefPath)
      if (!brief) {
        brief = questionsForBrief(run.briefPath)
        briefCache.set(run.briefPath, brief)
      }
      if (brief.questions.length === 0) {
        out.set(run.id, null)
        continue
      }
      const io = inputs.get(run.id) ?? { positions: [], arbitration: null }
      out.set(
        run.id,
        digestFor(
          assembleVerdictStrip({
            questions: brief.questions,
            positions: io.positions,
            arbitration: io.arbitration,
            labelFor: labelForMember
          })
        )
      )
    }
    return out
  }

  /**
   * One run's full Verdict strip (D106).
   *
   * ⚠ NOTHING IS STORED AND NOTHING NEEDED TO BE. The members' verdict tokens are
   * in their positions turns and the arbiter's ruling is in its arbitration turn,
   * both on disk since 3b-3. Deriving here rather than adding a column is the
   * house rule (CR-3f.1 A12: derive at render, never persist) and it is what kept
   * this feature out of migration v14, which Phase 6's `project_memory` has
   * already claimed.
   */
  ipcMain.handle(IpcChannel.CouncilVerdict, (_event, payload): CouncilVerdictResponse => {
    const req = councilVerdictRequestSchema.parse(payload)
    const empty = (reason: string | null): CouncilVerdictResponse =>
      councilVerdictResponseSchema.parse({
        run_id: req.run_id,
        rows: [],
        ruled: 0,
        total: 0,
        arbiter_asked: false,
        reason
      })

    const run = storage.getCouncilRunById(req.run_id)
    if (!run) return empty('That run is no longer in the Docket.')

    const brief = questionsForBrief(run.briefPath)
    if (brief.questions.length === 0) {
      // The brief is where the questions live; without it there is no spine to
      // hang rows on. Say which it was rather than showing an empty strip.
      return empty(brief.reason ?? 'That brief enumerates no questions.')
    }

    const io =
      verdictInputsFor(storage.getCouncilVerdictSource([run.id])).get(run.id) ??
      { positions: [], arbitration: null }
    const strip = assembleVerdictStrip({
      questions: brief.questions,
      positions: io.positions,
      arbitration: io.arbitration,
      labelFor: labelForMember
    })
    // ⚠ D14: plain objects only — `assembleVerdictStrip` returns fresh literals,
    // and the nested `consensus` came from `summariseQuestions`, which does too.
    return councilVerdictResponseSchema.parse({
      run_id: req.run_id,
      rows: strip.rows.map((r) => ({
        index: r.index,
        question: r.question,
        consensus: {
          index: r.consensus.index,
          question: r.consensus.question,
          path: r.consensus.path,
          state: r.consensus.state,
          votes: r.consensus.votes.map((v) => ({ label: v.label, verdict: v.verdict })),
          silent: [...r.consensus.silent]
        },
        verdict: r.verdict
      })),
      ruled: strip.ruled,
      total: strip.total,
      arbiter_asked: strip.arbiterAsked,
      reason: null
    })
  })

  /**
   * One project's council history, newest first.
   *
   * ⚠ TWO QUERIES FOR N RUNS, NOT N+1. The rows come back in one ordered read and
   * their turn/token aggregates in one `GROUP BY` — `countSessionsByProject`'s
   * precedent (D80). A per-run stats call would be a transcript scan each, and
   * `council_messages.content` holds whole model turns: the largest single
   * transcript on this machine is 112,531 characters. Counting them in JS would
   * drag megabytes across the process to render a list of dates.
   *
   * ⚠ AND IT SHAPES NOTHING ITSELF. Duration, partial-token detection and the
   * cost floor are `councilDocketCore`'s, so the rules that must not be got wrong
   * — never measure against "now", never turn a null into a zero — are covered by
   * tests that cost nothing to run instead of by a $1.09 live council.
   */
  ipcMain.handle(IpcChannel.CouncilDocket, (_event, payload): CouncilDocketResponse => {
    const req = councilDocketRequestSchema.parse(payload)
    const rows = storage.listCouncilRunsForProject(req.project_id)
    const stats = storage.getCouncilRunStats(rows.map((r) => r.id))
    // ⚠ DERIVED FOR EVERY ROW, UNCACHED, AND THAT IS THE RATIFIED CHOICE.
    // CR-3f.1's Q5 ruling: "the session is a duration, and durations are not
    // correctness conditions" — ship uncached first and add a cache only behind
    // a recorded measurement. The costs are bounded by construction: the query
    // pulls only positions and arbitration turns, and briefs are read once per
    // PATH rather than once per run, which matters because re-running one brief
    // is the ordinary case (D98 ordered exactly that, and this project's own
    // 3b.0 brief has three runs against it).
    const digests = verdictDigestsFor(rows)
    // ⚠ D14: plain objects only. `better-sqlite3` rows already are, and
    // `toDocketRow` returns fresh literals built from primitives.
    return councilDocketResponseSchema.parse({
      runs: rows.map((run) => {
        const r = toDocketRow(run, stats.get(run.id))
        return {
          run_id: r.runId,
          label: r.label,
          brief_path: r.briefPath,
          status: r.status,
          started_at: r.startedAt,
          ended_at: r.endedAt,
          duration_ms: r.durationMs,
          turns: r.turns,
          tokens_in: r.tokensIn,
          tokens_out: r.tokensOut,
          tokens_are_partial: r.tokensArePartial,
          turns_with_tokens: r.turnsWithTokens,
          cost_floor_usd: r.costFloorUsd,
          has_findings: r.hasFindings,
          verdict_digest: digests.get(run.id) ?? null
        }
      })
    })
  })

  /**
   * A stored run's findings document, read back off disk.
   *
   * ⚠ IT RE-VALIDATES A PATH MAIN WROTE ITSELF, and that is not paranoia theatre.
   * `findings_path` was derived from a validated brief path when the run ended,
   * but it has been sitting in a SQLite file on disk ever since — a file no
   * integrity check covers and any local process can edit. Reading it back
   * unchecked would turn "someone edited chorus.db" into "main opens an arbitrary
   * file", which is the exact primitive `validateBriefPath` exists to deny. Same
   * validator, different noun (D112), rather than a second copy of a boundary.
   *
   * ⚠ AND EVERY FAILURE IS A RESPONSE, NOT A THROW. A branch switch, a rename, a
   * findings file the user tidied away — these are the ORDINARY fate of a
   * document in someone's own repository, not exceptional conditions. Each comes
   * back as a stated reason carrying the path that was looked in, because "we
   * looked and found nothing" is only actionable if it says where.
   */
  ipcMain.handle(IpcChannel.CouncilFindings, (_event, payload): CouncilFindingsResponse => {
    const req = councilFindingsRequestSchema.parse(payload)
    const say = (
      p: string | null,
      text: string | null,
      reason: string | null
    ): CouncilFindingsResponse =>
      councilFindingsResponseSchema.parse({ run_id: req.run_id, path: p, text, reason })

    const run = storage.getCouncilRunById(req.run_id)
    if (!run) return say(null, null, 'That run is no longer in the Docket.')
    if (run.findingsPath === null) {
      // A run that failed, was cancelled, or crashed before synthesis. Its
      // transcript may still be worth reading, and `council:transcript` serves it.
      return say(null, null, 'This run recorded no findings document.')
    }

    const checked = validateBriefPath(
      run.findingsPath,
      'findings document',
      'It is too large to read back.'
    )
    if (!checked.ok) {
      // ⚠ The refusal is reported ALONGSIDE the recorded path, which is the one
      // deviation from `validateBriefPath`'s no-echo rule and it is safe here:
      // this path is one Chorus itself wrote and already showed the user when the
      // run finished. It is not a fragment an attacker supplied and learns from.
      return say(run.findingsPath, null, checked.reason)
    }

    try {
      return say(checked.path, fs.readFileSync(checked.path, 'utf8'), null)
    } catch {
      // Raced between the stat and the read, or unreadable for a reason the stat
      // could not see. Still a stated absence rather than a thrown handler.
      return say(checked.path, null, 'That findings document could not be read.')
    }
  })

  /**
   * "Remove from Docket" (D109).
   *
   * ⚠ THE FIRST COUNCIL WRITE THE RENDERER HAS EVER HAD, and it calls the
   * transaction D99 kept alive uncalled for exactly this. `deleteCouncilRun`
   * purges `council_messages` explicitly because `run_id` is a soft pointer with
   * no `REFERENCES` (D62) and SQLite will not cascade it.
   *
   * ⚠ IT TOUCHES NO FILE, AND NO PAYLOAD HERE COULD MAKE IT. The channel takes a
   * run id; the handler reaches the filesystem nowhere. The `-Findings.md`
   * document sits beside the user's own brief in the user's own repository —
   * Chorus did not create that folder and does not delete from it. D109's second
   * action, "Delete case…", would, and deliberately does not exist yet.
   *
   * The turn count is read BEFORE the delete so the number reported afterwards is
   * the same one the confirm stated.
   */
  ipcMain.handle(IpcChannel.CouncilForgetRun, (_event, payload): CouncilForgetRunResponse => {
    const req = councilForgetRunRequestSchema.parse(payload)
    const run = storage.getCouncilRunById(req.run_id)
    // No such run: a double-click, or a second window that got there first. A
    // race the user cannot see is not an error worth showing them —
    // `council:cancel`'s existing precedent.
    if (!run) return councilForgetRunResponseSchema.parse({ forgot: false, turns: 0 })

    const turns = storage.getCouncilRunStats([run.id]).get(run.id)?.turns ?? 0
    storage.deleteCouncilRun(run.id)
    // ⚠ The log names what SURVIVED, not only what went. A line reading "removed
    // run X" would leave the next person reading it unsure whether the findings
    // document went with it — which is the same ambiguity D109 split the action
    // in two to avoid.
    logger.info(
      `[council] run ${run.id} removed from the docket: ${turns} turns purged; ` +
        `findings file ${run.findingsPath === null ? 'never written' : 'left on disk'}`
    )
    return councilForgetRunResponseSchema.parse({ forgot: true, turns })
  })

  ipcMain.handle(IpcChannel.SessionSetTitle, (_event, payload): void => {
    const { sessionId, title } = setTitleRequestSchema.parse(payload)
    // Titles are raw terminal output: strip controls, re-bound, and never
    // persist a blank — an empty post-sanitize result is a silent no-op.
    const clean = sanitizeTitle(title).slice(0, 120)
    if (clean.length === 0) return
    storage.updateSessionTitle(sessionId, clean)
    // Write cadence is the debounce's observable: ~1 line per settle, never
    // one per TUI redraw. Titles are terminal output, not secrets.
    logger.info(`[title] persisted ${sessionId}: ${JSON.stringify(clean)}`)
  })

  ipcMain.handle(IpcChannel.CliDetect, (_event, payload): Promise<CliDetectResponse> => {
    const req = cliDetectRequestSchema.parse(payload ?? {})
    // ⚠ THE PROBE IS `where.exe` PLUS `--version` PER TOOL, NOT AN ARBITRARY
    // COMMAND. `refresh` chooses between a memo and a re-run of the SAME fixed
    // probe over the SAME hardcoded tool list — the renderer cannot name a tool,
    // a path or a flag here, so the flag widens when the work happens and never
    // what the work is.
    if (req.refresh !== true) return detectClis()
    // One line per re-probe, matching the `[cli-detect]` summary `index.ts`
    // already logs at boot. It is what makes "my version is stale" answerable
    // from the log rather than by reasoning about a memo nobody can see.
    return refreshClis().then((tools) => {
      const agents = tools.filter((t) => t.agentKind !== null)
      logger.info(
        `[cli-detect] re-probed on request: ${agents.map((t) => `${t.name} ${t.found ? t.version : 'not found'}`).join(' · ')}`
      )
      return tools
    })
  })

  // Task 3-3 (coordinator addition beyond D34(f)): the STATIC adapter
  // declarations — auth methods + capabilities, no probing, no installation
  // state (cli:detect owns that), no secret-adjacent field. Task 3-4's
  // provider form renders auth methods from this instead of hardcoding them.
  //
  // ⚠ D84: this channel now publishes the PROVIDER-TYPE vocabulary, which is
  // the agent registry PLUS the harness-less declaration — appended LAST so the
  // provider form's default (`settings.adapters[0]`) is unchanged. The two
  // sources stay structurally separate: `staticRegistry` is still exactly two
  // frozen `AgentAdapter`s, and `NO_HARNESS_DESCRIPTOR` is not one and is not
  // in it. `executionMode` is what tells them apart on the wire ('pty' vs
  // 'api'), which is why that field already existed with no producer for 'api'.
  ipcMain.handle(IpcChannel.AdapterList, (_event, payload): AdapterListResponse => {
    adapterListRequestSchema.parse(payload ?? {})
    return adapterListResponseSchema.parse([
      ...Object.values(staticRegistry).map((adapter) => ({
        id: adapter.id,
        displayName: adapter.displayName,
        executionMode: adapter.executionMode,
        authMethods: adapter.getAuthMethods(),
        capabilities: adapter.getCapabilities()
      })),
      NO_HARNESS_DESCRIPTOR
    ])
  })

  ipcMain.handle(IpcChannel.LayoutGet, (_event, payload): LayoutGetResponse => {
    const req = layoutGetRequestSchema.parse(payload)
    const p = requireProject(req.project_id)
    // Session data rides the layout:get response (no new channel). Outbound
    // parse keeps the boundary schema-checked in both directions. 2-2: the
    // branch label joins the rows here — resolved from the WORKTREES side
    // (worktrees.session_id, F18a) in a single pass over the project's
    // worktree rows, NOT per-row lookups via sessions.worktree_id.
    const branchBySession = new Map<string, string>()
    for (const w of storage.getWorktreesForProject(p.id)) {
      if (w.sessionId !== null) branchBySession.set(w.sessionId, w.branch)
    }
    // D37 (F25): tolerate unknown-agent rows at the PROJECTION, never the
    // schema. sessionInfoSchema.agent stays the two-value enum, so the
    // outbound parse below would reject the WHOLE aggregate over one row
    // whose agent column holds an unknown value — the project's load watcher
    // then took an uncaught rejection and rendered the empty state despite a
    // real layout. Filtering here drops such rows from the RESPONSE only:
    // the tree passes through untouched (the affected leaf renders
    // LayoutRenderer's leaf-without-row placeholder) and the DB row is left
    // alone (reconcile/restore own row state). Registry membership implies
    // enum membership today — staticRegistry is keyed by AgentKind.
    const knownAgentRows = storage.getSessionsForProject(p.id).filter((row) => {
      if (getAdapter(row.agent)) return true
      logger.warn(
        `[layout] layout:get dropping session row ${row.id}: unknown agent '${row.agent}'`
      )
      return false
    })
    return layoutGetResponseSchema.parse({
      layout: storage.getPaneLayout(p.id),
      sessions: knownAgentRows.map((row) => ({
        ...row,
        branch: branchBySession.get(row.id) ?? null
      }))
    })
  })

  ipcMain.handle(IpcChannel.LayoutSet, (_event, payload): void => {
    // layoutSetRequestSchema enforces shape + ratio bounds at the boundary;
    // savePaneLayout normalizes again on write (clamp + dedupe) — defense in
    // depth per council D9. A null tree means the last pane closed: DELETE the
    // row — its absence is the empty signal. Per project, as 1-4 established.
    const req = layoutSetRequestSchema.parse(payload)
    const p = requireProject(req.project_id)
    if (req.layout === null) {
      storage.clearPaneLayout(p.id)
      return
    }
    storage.savePaneLayout(p.id, req.layout)
  })

  ipcMain.handle(IpcChannel.ViewGet, (_event, payload): ViewState => {
    const req = viewGetRequestSchema.parse(payload)
    const p = requireProject(req.project_id)
    // D20: filmstrip is the DEFAULT, applied when no row exists — this is what
    // makes existing DBs open in the filmstrip on first post-1b boot. Outbound
    // parse keeps the boundary schema-checked (storage already collapses
    // corrupt rows to null, so the default covers them too).
    return viewStateSchema.parse(
      storage.getViewState(p.id) ?? { mode: 'filmstrip', focusedSessionId: null }
    )
  })

  ipcMain.handle(IpcChannel.ViewSet, (_event, payload): void => {
    const req = viewSetRequestSchema.parse(payload)
    const p = requireProject(req.project_id)
    // focusedSessionId is deliberately NOT FK-checked (F4): it legitimately
    // outlives its session; views resolve staleness by first-leaf fallback.
    storage.setViewState(p.id, req.state)
  })

  /* ---------------------------------------------------------------- */
  /* Task 3a-2: attention capture (spec §5.3). Modelled on the         */
  /* ViewGet/ViewSet pair above — parse in, requireProject, call,      */
  /* outbound .parse on the way back.                                  */
  /* ---------------------------------------------------------------- */

  ipcMain.handle(IpcChannel.AttentionReport, (_event, payload): void => {
    const req = attentionReportSchema.parse(payload)
    // sessionId is deliberately NOT FK-checked, exactly as view:set's
    // focusedSessionId is not (F4): a report can legitimately name a session
    // main has just seen exit, and a throw here would break the renderer's
    // fire-and-forget send. There is no read-back on this channel.
    attention.applyReport(req)
  })

  ipcMain.handle(IpcChannel.AttentionSummary, (_event, payload): AttentionSummary => {
    const req = attentionSummaryRequestSchema.parse(payload)
    const p = requireProject(req.project_id)
    // ⚠ THE OUTBOUND PARSE IS WHAT MAKES THE DENOMINATOR RULE STRUCTURAL rather
    // than aspirational — the same move D33 clause 3 used for key material. If
    // a future edit drops coveragePct or byClass from the returned object, this
    // handler THROWS rather than shipping a bare number that will be believed.
    return attentionSummaryResponseSchema.parse(attention.summary(p.id, req.from, req.to))
  })

  /* ---------------------------------------------------------------- */
  /* Task 3a-3: "% of spend attributed" (D42). Deliberately NOT        */
  /* project-scoped: a minted key's spend is an ACCOUNT fact, and the  */
  /* denominator (total gateway spend) has no project dimension at all */
  /* — scoping the numerator while the denominator stays global would  */
  /* produce a ratio of two different things.                          */
  /* ---------------------------------------------------------------- */

  ipcMain.handle(IpcChannel.AttributionSummary, async (_event, payload): Promise<AttributionSummary> => {
    const req = attributionSummaryRequestSchema.parse(payload)
    const summary = await attribution.summary(req.from, req.to)
    // ⚠ THE OUTBOUND PARSE IS WHAT MAKES D55 STRUCTURAL HERE, exactly as it
    // does on attention:summary. If a future edit drops a denominator —
    // gatewayTotalUsd, totalDispatches, subscriptionDispatches — or adds a
    // field capable of carrying key material, this handler THROWS rather than
    // shipping a bare percentage that will be believed, or a key that will not.
    return attributionSummaryResponseSchema.parse({
      from: req.from,
      to: req.to,
      spendPct: summary.spendPct,
      dispatchPct: summary.dispatchPct,
      attributedUsd: summary.attributedUsd,
      unattributedUsd: summary.unattributedUsd,
      gatewayTotalUsd: summary.gatewayTotalUsd,
      totalDispatches: summary.totalDispatches,
      attributedDispatches: summary.attributedDispatches,
      subscriptionDispatches: summary.subscriptionDispatches,
      tokensSourceBreakdown: summary.tokensSourceBreakdown,
      spendBasis: 'gateway-only',
      managementKeyConfigured: summary.managementKeyConfigured
    })
  })

  ipcMain.handle(IpcChannel.ProjectAdd, async (_event, payload): Promise<ProjectAddResponse> => {
    projectAddRequestSchema.parse(payload ?? {})
    // D3: the native picker runs in main; the renderer never enumerates
    // directories itself. Cancel is a structured no-op, not an error.
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) {
      return projectAddResponseSchema.parse({ cancelled: true })
    }
    const project = storage.getOrCreateProject(result.filePaths[0])
    return projectAddResponseSchema.parse({ project: toWireProject(project) })
  })

  ipcMain.handle(IpcChannel.ProjectList, (_event): ProjectsList => {
    const activeId = storage.getActiveProjectId()
    // D80: `sessionCount` joins `active` as a list-only field, built explicitly
    // beside it rather than folded into toWireProject — that mapper's job is
    // the bare projects-row shape `project:add` also returns. ONE extra read
    // for the whole list, never one per project.
    const counts = storage.countSessionsByProject()
    return projectsListSchema.parse(
      storage.listProjects().map((p) => ({
        ...toWireProject(p),
        active: p.id === activeId,
        sessionCount: counts.get(p.id) ?? 0
      }))
    )
  })

  ipcMain.handle(IpcChannel.ProjectSelect, (_event, payload): void => {
    const req = projectSelectRequestSchema.parse(payload)
    const p = requireProject(req.project_id)
    storage.setActiveProjectId(p.id)
    BrowserWindow.getAllWindows()[0]?.setTitle(p.name)
    // Lazy restore (D16): relaunch this project's persisted 'running' rows
    // now — never before its first activation. restore() is idempotent within
    // a run (live-guarded, healed rows stay healed), so re-selects are cheap.
    void sessions.restore(p.id)
  })

  /**
   * The project settings screen's save. Name, colour and description in one
   * write — the screen edits them together, and three channels would let a
   * half-saved form leave the rail disagreeing with the row.
   *
   * ⚠ THE WINDOW TITLE IS RETITLED HERE, and only when the edited project is
   * the ACTIVE one. `project:select` is the only other place that sets the
   * title; without this, renaming the project you are looking at would leave
   * the titlebar showing the old name until the next time you switched away
   * and back.
   */
  ipcMain.handle(IpcChannel.ProjectUpdate, (_event, payload): ProjectUpdateResponse => {
    const req = projectUpdateRequestSchema.parse(payload)
    requireProject(req.project_id)
    // "" -> NULL, so an emptied description is stored as the SAME absence a
    // never-written one is. Two representations of "no description" would read
    // differently everywhere they are tested for.
    const description = req.description.trim() === '' ? null : req.description
    const updated = storage.updateProject(req.project_id, {
      name: req.name,
      color: req.color,
      description
    })
    if (!updated) throw new Error(`Unknown project_id: ${req.project_id}`)
    if (storage.getActiveProjectId() === updated.id) {
      BrowserWindow.getAllWindows()[0]?.setTitle(updated.name)
    }
    return projectUpdateResponseSchema.parse({ project: toWireProject(updated) })
  })

  ipcMain.handle(IpcChannel.SessionWrite, (_event, payload) => {
    const { sessionId, data } = writeRequestSchema.parse(payload)
    sessions.write(sessionId, data)
  })

  ipcMain.handle(IpcChannel.SessionResize, (_event, payload) => {
    const { sessionId, cols, rows } = resizeRequestSchema.parse(payload)
    sessions.resize(sessionId, cols, rows)
  })

  ipcMain.handle(IpcChannel.SessionKill, (_event, payload) => {
    const { sessionId } = killRequestSchema.parse(payload)
    sessions.kill(sessionId)
  })

  /* ═══ Task 3c-2 / D74 — window controls ═══════════════════════════════════
   *
   * The three handlers `frame: false` makes necessary. They live HERE, with the
   * other 48, because `registerIpc` is the one home for IPC registration and a
   * second registration site in `index.ts` is exactly the drift this codebase
   * keeps ruling against. Only the two window LISTENERS live in `index.ts`,
   * because those attach to the window instance beside the `resized`/`moved`
   * wiring.
   *
   * ⚠ They act on the window that ASKED — `fromWebContents(event.sender)` —
   * rather than on `getAllWindows()[0]`.
   *
   * ImplementationSpec-3c-2 §3 pointed at the `getAllWindows()` precedent, and
   * for the maximized-changed BROADCAST that is right: an event fans out to
   * every window. But a window control is not a broadcast, it is an imperative
   * on one window, and `[0]` is correct today only because exactly one window
   * exists. Phase 7's pop-out windows are the declared plan to change that, and
   * `[0]` would then close the main window when a pop-out's close button was
   * pressed — a defect that would look like a Phase 7 bug and be attributed
   * there. Asking the sender costs nothing and presumes nothing.
   *
   * A null sender is not an error path worth throwing over: the window was
   * destroyed between the click and the handler, and there is nothing to do.
   */
  ipcMain.handle(IpcChannel.WindowMinimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle(IpcChannel.WindowClose, (event) => {
    // close(), not destroy(): this is the normal quit path, so 'before-quit'
    // still runs and sessions tear down exactly as they did with a native frame.
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle(IpcChannel.WindowToggleMaximize, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return windowMaximizedSchema.parse({ maximized: false })
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    // Read the state BACK from the window rather than assuming the toggle took:
    // the returned value is what settles the caller's icon.
    return windowMaximizedSchema.parse({ maximized: win.isMaximized() })
  })

  // Outbound events are validated here in main (the preload cannot run Zod
  // under the page CSP), so both directions of the boundary stay schema-checked.
  sessions.onData((sessionId, data) => {
    const event = sessionDataEventSchema.parse({ sessionId, data })
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannel.SessionData, event)
    }
  })

  sessions.onExit((sessionId, exitCode) => {
    const event = sessionExitEventSchema.parse({ sessionId, exitCode })
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannel.SessionExit, event)
    }
  })

  // 3a-3: the FIFTH independent onExit listener (event forward · D11 status
  // persist · 3a-1 recorder close · 3a-2 attention stop · this). Read the key's
  // usage, then revoke it, then enrich the row.
  //
  // ⚠ DELIBERATELY NOT FOLDED INTO ANY EXISTING LISTENER. exitListeners is a
  // Set and a throw inside one must not stop the exit event reaching the
  // renderer, the sessions table, 3a-1's row close, or 3a-2's clock. The async
  // body is fire-and-forget for the same reason — settleDispatch swallows its
  // own failures and an unhandled rejection here would be a telemetry bug that
  // reaches the user.
  sessions.onExit((sessionId) => {
    void attribution.settleDispatch(sessionId)
  })

  sessions.onRestored((sessionId) => {
    const event = sessionRestoredEventSchema.parse({ sessionId })
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannel.SessionRestored, event)
    }
  })

  return council
}
