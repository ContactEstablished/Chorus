import type { Project } from '../../shared/ipc'

/* ─── Core (always implemented) ──────────────────────────────────────── */

export type ExecutionMode = 'pty' | 'api'

/**
 * The always-implemented surface. Everything domain-specific lives on an
 * extension interface a caller narrows to (D34 Q1, unanimous) — so a caller
 * that reaches `writeMcpConfig` has already proven, to the compiler, that this
 * adapter has one.
 *
 * `id` is typed `string`, not `AgentKind`, deliberately: Phase 6 adds
 * user-registered adapters with ids no compile-time union can enumerate. The
 * exhaustiveness Phase 3 needs comes from the REGISTRY's type, not from here.
 */
export interface BaseAgentAdapter {
  readonly id: string
  readonly displayName: string
  readonly executionMode: ExecutionMode

  detectInstallation(signal?: AbortSignal): Promise<InstallationStatus>
  getAuthMethods(): readonly AuthMethodDefinition[]
  /** The adapter's STATIC declared capabilities. Effective capabilities for a
   *  particular installation are `mergeCapabilities(getCapabilities(), detected)`. */
  getCapabilities(): AgentCapabilities
}

/* ─── Capability descriptors (D34 Q3, unanimous) ─────────────────────── */

/**
 * Descriptors, not booleans. `mcp: true` tells a caller nothing it can act on;
 * `{format: 'json', location: 'project', configPath: '.mcp.json'}` tells it
 * where to write. Booleans survive ONLY for facts that are genuinely binary.
 */
export interface AgentCapabilities {
  readonly interactiveTerminal: boolean
  readonly worktreeSafe: boolean
  readonly skills: boolean
  readonly subscriptionLogin: boolean
  readonly apiKey: boolean

  readonly reasoningEffort: EffortDescriptor | null
  readonly sessionResume: ResumeDescriptor | null
  readonly mcp: McpDescriptor | null
  readonly hooks: HooksDescriptor | null
}

/** `'static'` = frozen on the adapter. `'dynamic'` = populated or refined by
 *  detectInstallation(); its fields may be empty until a probe has run. */
export type DescriptorMode = 'static' | 'dynamic'

export interface EffortOption {
  readonly id: string
  readonly label: string
  readonly cliFlag: string
}

export interface EffortDescriptor {
  readonly mode: DescriptorMode
  readonly levels: readonly EffortOption[]
}

export interface McpDescriptor {
  readonly mode: DescriptorMode
  readonly format: 'json' | 'toml' | 'yaml'
  readonly location: 'project' | 'home' | 'custom'
  /** Relative to the location root, e.g. '.mcp.json'. */
  readonly configPath: string | null
}

export interface HooksDescriptor {
  readonly mode: DescriptorMode
  readonly mechanism: 'http_listener' | 'script' | 'file_watch'
}

export interface ResumeDescriptor {
  readonly mode: DescriptorMode
  /** e.g. '--resume'; null when resumption is not CLI-flag driven. */
  readonly cliFlag: string | null
}

/* ─── Installation detection ─────────────────────────────────────────── */

/**
 * Required-nullable on `path`/`version` (house discipline since 1b-1): a
 * producer that forgets one fails loudly instead of omitting it silently.
 * `authenticated` stays OPTIONAL and UNSET in Phase 3 — probing it means
 * running a real CLI command, which would break the behavior-neutral gate.
 */
export interface InstallationStatus {
  readonly found: boolean
  readonly path: string | null
  readonly version: string | null
  readonly authenticated?: boolean
  /** Detected overrides merged over the static set. `null` for a field means
   *  "probe determined this is absent"; `undefined` means "not probed". */
  readonly capabilities?: Partial<AgentCapabilities>
  /** CR-3.1 risk 4's seam: a newer CLI may need env vars the static list does
   *  not know about. Unused in Phase 3. */
  readonly requiredEnvVars?: readonly string[]
}

/* ─── Auth ───────────────────────────────────────────────────────────── */

export interface AuthMethodDefinition {
  readonly type: 'subscription' | 'api_key'
  readonly label: string
  /** The env var this method injects into, e.g. 'ANTHROPIC_API_KEY'. The
   *  DEFAULT only — a provider_configs.env_var_name overrides it (D34(e)).
   *  Null for subscription methods, which inject nothing. */
  readonly requiredEnvVar: string | null
  readonly helpUrl: string | null
}

/* ─── PTY launch seam ────────────────────────────────────────────────── */

export interface PtyAgentAdapter extends BaseAgentAdapter {
  readonly executionMode: 'pty'
  /** Env var names this adapter needs preserved when main builds a
   *  credential-bearing allow-list environment (D33 clause 4). Beyond the
   *  Windows baseline, which main owns. Empty is a legitimate answer. */
  readonly requiredEnvVars: readonly string[]
  /** SYNCHRONOUS by necessity: SessionManager.launch() is synchronous and
   *  returns a snapshot to its IPC caller synchronously. Do not make this
   *  async without changing that first. */
  buildLaunch(spec: PtyLaunchSpec): PtyLaunchRequest
}

export interface PtyLaunchSpec {
  readonly sessionId: string
  readonly cwd: string
  readonly modelId?: string
  readonly effortOptionId?: string
  /** Absent for subscription-auth and ambient-env launches — the FIRST-CLASS
   *  path, not a fallback (D33 clause 9). Present only for BYOK (Task 3-6). */
  readonly credential?: ResolvedCredential
}

/**
 * A decrypted credential, resolved by main immediately before launch.
 * `isSecret` is a discriminant, not decoration: it is what lets the scrubber
 * registration and the logger's redaction find these values structurally
 * rather than by guessing at field names.
 *
 * NEVER log a value of this type. NEVER put one in an Error message. NEVER
 * return one across IPC.
 */
export interface ResolvedCredential {
  readonly envVarName: string
  readonly value: string
  readonly isSecret: true
}

/**
 * What an adapter contributes to a launch — NOT the whole environment.
 *
 * D34(d): env policy has one owner, main. A no-credential launch inherits
 * process.env wholesale (today's behavior, preserved); a credential-bearing
 * launch gets a constructed allow-list. Either way `SessionManager` composes
 * it, and the adapter only says what IT needs added.
 *
 * `cols`/`rows` are deliberately absent — terminal geometry is session state.
 */
export interface PtyLaunchRequest {
  readonly executable: string
  readonly args: readonly string[]
  readonly cwd: string
  /** Non-secret additions, merged over the composed base environment. */
  readonly envAdditions: Readonly<Record<string, string>>
  /** Secret entries, kept separate so main can register them with the PTY
   *  scrubber and keep them out of every log path. Empty in Phase 3 until
   *  Task 3-6. */
  readonly secretEnv: Readonly<Record<string, string>>
}

export interface ResumeSpec {
  readonly sessionId: string
  readonly cwd: string
}

/* ─── API mode: DECLARED, zero implementations in Phase 3 ────────────── */

export interface ApiAgentAdapter extends BaseAgentAdapter {
  readonly executionMode: 'api'
  getModels(credential?: ResolvedCredential, signal?: AbortSignal): Promise<readonly ModelInfo[]>
  startApiSession(spec: ApiLaunchSpec, signal?: AbortSignal): Promise<ApiSessionHandle>
}

export interface ApiLaunchSpec {
  readonly sessionId: string
  readonly modelId: string
  readonly credential: ResolvedCredential
  readonly systemPrompt?: string
}

export interface ApiSessionHandle {
  readonly sessionId: string
  send(message: string): Promise<void>
  receive(): AsyncIterable<string>
  dispose(): Promise<void>
}

export interface ModelInfo {
  readonly id: string
  readonly displayName: string
  readonly effortOptions: readonly EffortOption[]
  readonly maxTokens?: number
}

/* ─── Extension interfaces: DECLARED, none implemented in Phase 3 ────── */

/** Phase 6 defines the real MCP server record; this is the minimum the
 *  extension interface needs to be writable now without inventing it. */
export interface McpServerRef {
  readonly name: string
  readonly command: string
  readonly args: readonly string[]
}

export interface SupportsMcp {
  writeMcpConfig(
    project: Project,
    servers: readonly McpServerRef[],
    signal?: AbortSignal
  ): Promise<void>
}

export interface SupportsHooks {
  writeHooksConfig(project: Project, listenerUrl: string, signal?: AbortSignal): Promise<void>
}

export interface SupportsResume {
  resumeSession(spec: ResumeSpec): PtyLaunchRequest
}

/* NOTE: SupportsStateDetection and OutputInterpreter are DELIBERATELY ABSENT.
 * D34(a): the findings declared them in contradiction of their own Q4 majority
 * (detectState is out). Phase 4 designs its own interpreter if hooks prove
 * insufficient. Do not add them back. */

/* ─── Union + guards ─────────────────────────────────────────────────── */

export type AgentAdapter = PtyAgentAdapter | ApiAgentAdapter

export function isPtyAdapter(a: AgentAdapter): a is PtyAgentAdapter {
  return a.executionMode === 'pty'
}

export function isApiAdapter(a: AgentAdapter): a is ApiAgentAdapter {
  return a.executionMode === 'api'
}

/**
 * Capability guards. Each checks BOTH halves — the descriptor is non-null AND
 * the method is actually present — which is what makes "supported" and
 * "implemented" one fact at the call site (D34 Q1). An adapter that declares a
 * descriptor without implementing the method narrows to `false` and is caught
 * by the capability-honesty unit test rather than at runtime in Phase 6.
 */
export function supportsMcp(a: BaseAgentAdapter): a is BaseAgentAdapter & SupportsMcp {
  return (
    a.getCapabilities().mcp !== null &&
    typeof (a as Partial<SupportsMcp>).writeMcpConfig === 'function'
  )
}

export function supportsHooks(a: BaseAgentAdapter): a is BaseAgentAdapter & SupportsHooks {
  return (
    a.getCapabilities().hooks !== null &&
    typeof (a as Partial<SupportsHooks>).writeHooksConfig === 'function'
  )
}

export function supportsResume(a: BaseAgentAdapter): a is BaseAgentAdapter & SupportsResume {
  return (
    a.getCapabilities().sessionResume !== null &&
    typeof (a as Partial<SupportsResume>).resumeSession === 'function'
  )
}

/* ─── Errors ─────────────────────────────────────────────────────────── */

/** Thrown by getAdapterOrThrow for an id the registry does not know. Reaching
 *  this is NORMAL, not exceptional: `sessions.agent` is a TEXT column and a
 *  database can hold anything. Callers degrade (D34(c)); they never crash. */
export class UnknownAgentError extends Error {
  constructor(public readonly agentId: string) {
    super(`Unknown agent: ${agentId}`)
    this.name = 'UnknownAgentError'
  }
}
