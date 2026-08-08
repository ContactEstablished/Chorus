import type { EffortLevel, Project } from '../../shared/ipc'
// Task 3b-1 / D63 risk 1: TYPE-ONLY, for the signature assertion at the bottom
// of the api-mode section. It erases completely, so the adapter layer gains no
// runtime edge to the transport (which reaches electron through vault.ts's
// safeStorage) and the import cycle exists only in the type graph.
import type { createApiSession } from '../services/apiSession'

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

/**
 * One position on PLAN §4's app-level Fast / Balanced / Deep / Max slider,
 * mapped to what THIS adapter's CLI actually wants.
 *
 * ⚠ Task 3a-4 replaced `cliFlag: string` with `args: readonly string[]`. A
 * single string cannot express `['-c', 'model_reasoning_effort="high"']`
 * without a whitespace split that breaks on quoted values — and codex's values
 * ARE TOML-quoted. The alternative (a per-adapter `switch` in `buildLaunch`)
 * would give the mapping two homes. THE DESCRIPTOR IS THE MAPPING TABLE;
 * `buildLaunch` only reads it.
 */
export interface EffortOption {
  /** The app-level level id — 'fast' | 'balanced' | 'deep' | 'max'. One
   *  vocabulary, shared with the wire (`effortLevelSchema`) and, later, 3a-5's
   *  `launch_profiles.effort`. */
  readonly id: EffortLevel
  readonly label: string
  /** The EXACT argv tokens this level contributes, e.g. `['--effort','high']`
   *  or `['-c','model_reasoning_effort="high"']`. Non-empty. */
  readonly args: readonly string[]
}

/** `levels` is the whole mapping. A COLLAPSED mapping (two app levels
 *  resolving to the same adapter value) is legal and must be VISIBLE — the
 *  descriptor is the one home for that fact. */
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
  /** Task 3a-4: the app-level effort level chosen for THIS launch. Absent
   *  means Chorus emits no effort argument at all — the CLI's own default.
   *  Typed `string` rather than `EffortLevel` deliberately: it arrives from a
   *  wire payload, and `resolveEffortArgs` returns `[]` for anything outside
   *  the vocabulary rather than throwing. */
  readonly effortOptionId?: string
  /** Task 3a-4: the user's RAW CLI override tokens. Rank 1 of the effort
   *  precedence order — when these contain the adapter's own effort knob,
   *  Chorus emits none of its own.
   *
   *  ⚠ There is NO INPUT SURFACE for this in Task 3a-4, deliberately. The
   *  text field and its storage arrive with `launch_profiles` in 3a-5, which
   *  must carry the warning recorded here: EXTRA ARGS BECOME ARGV, AND ARGV IS
   *  WORLD-READABLE (`Get-CimInstance Win32_Process`). Shipping a free-text
   *  argv field in the same commit as a second key-bearing network call is a
   *  blast-radius decision nobody has made. */
  readonly extraArgs?: readonly string[]
  /** Absent for subscription-auth and ambient-env launches — the FIRST-CLASS
   *  path, not a fallback (D33 clause 9). Present only for BYOK (Task 3-6). */
  readonly credential?: ResolvedCredential
  /** The ROUTE half of D43's (agent × route × model): present only when the
   *  credential's provider carries a base_url — i.e. an OpenAI-compatible
   *  endpoint (D47's OpenRouter vehicle). All fields are NON-SECRET and may
   *  legally travel in argv (`-c` overrides); the key itself never does. */
  readonly route?: PtyLaunchRoute
  /** Where this session reports its lifecycle. Present only when the adapter
   *  declares a `hooks` descriptor AND main has a listener bound — an adapter
   *  without hook support never sees this field. */
  readonly hooks?: PtyLaunchHooks
}

/**
 * The per-session hook wiring, composed by main and handed to the adapter.
 *
 * The split is the same one `envAdditions` draws: MAIN owns policy (which
 * port, which token, where a config file may legally be written), the ADAPTER
 * owns format (what that file has to say for THIS CLI to load it). Neither
 * half can be written without the other, and putting the path in main is what
 * keeps adapters ignorant of Electron's userData layout.
 */
export interface PtyLaunchHooks {
  /**
   * The full URL this session's hook command POSTs to, token included.
   *
   * ⚠ IT IS A CAPABILITY — treat it like `ResolvedCredential.value` in every
   * respect but one. Never log it, never put it in an Error message, never
   * return it across IPC. The one difference is that it MAY be written to
   * `configPath`, because a hook command has no other way to learn it: the CLI
   * spawns hooks itself, and an env var would have to survive an unknown
   * shell's expansion rules to reach the command line intact.
   *
   * ⚠ AND IT MUST NEVER REACH ARGV. `PtyLaunchSpec.extraArgs` already carries
   * the standing warning that argv is world-readable
   * (`Get-CimInstance Win32_Process`); a token in argv would be readable by
   * every process on the machine, which is the one thing the token exists to
   * prevent. The file is the delivery mechanism precisely because argv is not.
   */
  readonly endpointUrl: string
  /** Absolute path main has reserved for this session's config file. Main
   *  creates the parent directory and deletes the file at session end, so the
   *  adapter only writes. */
  readonly configPath: string
}

/** Non-secret connection metadata for a custom-provider launch (D47/D48).
 *  `providerKey` is the `model_providers.<key>` id; `providerName` is the
 *  user-authored provider_configs.name — codex 0.145.0 REQUIRES a non-empty
 *  provider `name` (D4, probed this session: "provider name must not be
 *  empty"). `modelId` is the route's default model (D48): a default, not an
 *  authority — Phase 3a's launch_profiles will override it. */
export interface PtyLaunchRoute {
  readonly providerKey: string
  readonly providerName: string
  readonly baseUrl: string
  readonly modelId: string | null
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
  /**
   * `@deferred` Phase 3d. THE IMPLEMENTATION ALREADY EXISTS — it is
   * `createApiSession()` in `services/apiSession.ts` (Task 3b-1). This
   * declaration stays DORMANT until the D34-Q5 registry lift, which D52 gives
   * to Phase 3d, at which point it becomes a one-line delegation:
   *
   *   `async startApiSession(spec) { return createApiSession(spec, deps) }`
   *
   * — the `async` absorbing the factory's synchronous return. See CR-3b.0 /
   * D63 Q1: the producer is a standalone factory OUTSIDE the registry, so
   * `agentKindSchema` and `staticRegistry` stay untouched until the lift.
   *
   * `_StartApiSessionIsDelegable` below is what keeps the two from silently
   * drifting apart in the meantime (D63 risk 1's mitigation).
   */
  startApiSession(spec: ApiLaunchSpec, signal?: AbortSignal): Promise<ApiSessionHandle>
}

export interface ApiLaunchSpec {
  readonly sessionId: string
  readonly modelId: string
  readonly credential: ResolvedCredential
  readonly systemPrompt?: string
}

/**
 * The SHARED api-mode primitive (D45(2)): the council in Phase 3b and the
 * native chat pane later are two consumers of THIS, never two mechanisms.
 * Ratified unchanged by CR-3b.0 Q3.
 *
 * ⚠ `dispose()` IS THE SOLE CANCELLATION MECHANISM (CR-3b.0 Q3, 2-of-3).
 * There is no per-operation cancel — no way to stop one generation while
 * keeping conversation context — and that is DEFERRED, not overlooked. Kimi's
 * dissent is preserved in D63: revisit the moment the interactive chat pane
 * design begins, because by then this interface has implementations and adding
 * a parameter is a breaking change.
 *
 * ⚠ There is deliberately NO `usage` field and NO failure channel here. Both
 * facts belong to the producer, not to the shared contract, and both are
 * reported through `ApiSessionDeps` callbacks (`onUsage` / `onRefusal`,
 * D63(g)) — so a chat pane that meters nothing carries no field it never
 * reads, and a refusal never travels as text through the scrubber and the ring
 * buffer to be rendered as though the model had said it.
 *
 * `receive()` may be consumed ONCE per `send()`: the first iterator to start
 * claims the stream, and a second gets an empty iterable rather than
 * interleaving two consumers over one connection.
 */
export interface ApiSessionHandle {
  readonly sessionId: string
  send(message: string): Promise<void>
  receive(): AsyncIterable<string>
  dispose(): Promise<void>
}

/**
 * D63 risk 1's mitigation: a COMPILE-TIME tie between the dormant declaration
 * above and the factory that will eventually implement it, so the two cannot
 * drift apart across the two phases they are separated by.
 *
 * `_Assert` is what makes it bite. A bare `… ? true : never` alias would
 * simply evaluate to `never` and compile happily — an assertion that passes
 * vacuously is worse than none, because it gets cited as coverage. Constraining
 * to `T extends true` turns a mismatch into a typecheck ERROR.
 *
 * `deps: never` is deliberate: the adapter method takes no deps, so the deps
 * parameter is intentionally out of scope for this check. What IS checked is
 * that the factory accepts the declaration's OWN spec parameter and produces
 * the value the declaration's `Promise` resolves to.
 */
type _Assert<T extends true> = T
type _StartApiSessionIsDelegable = _Assert<
  typeof createApiSession extends (
    spec: Parameters<ApiAgentAdapter['startApiSession']>[0],
    deps: never
  ) => Awaited<ReturnType<ApiAgentAdapter['startApiSession']>>
    ? true
    : false
>
export type { _StartApiSessionIsDelegable }

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

/**
 * ⚠ RESHAPED when the hook listener was actually built. It was declared
 * `writeHooksConfig(project, listenerUrl, signal): Promise<void>` — PROJECT
 * scoped, async, returning nothing — and never implemented by anything, which
 * is the only reason changing it is a definition rather than a breaking change.
 * Three things the implementation proved wrong about that shape:
 *
 *  1. **Per PROJECT is unattributable.** Events must be traceable to one
 *     session or the lights point at the wrong card; two sessions in one
 *     project (or one cwd) are indistinguishable without a per-session token.
 *  2. **Async cannot be called from `buildLaunch`**, which is synchronous by
 *     necessity (`SessionManager.launch()` returns a snapshot to its IPC
 *     caller synchronously). A config that must exist BEFORE spawn has to be
 *     written on the synchronous path.
 *  3. **`Promise<void>` strands the argv.** Writing the file is only half the
 *     job — something has to make the CLI LOAD it, and that something is
 *     adapter-specific argv. Returning the tokens keeps both halves in the one
 *     place that knows the format.
 *
 * The METHOD NAME is deliberately unchanged: `adapters.test.ts`'s generic
 * honesty test pairs `['hooks', 'writeHooksConfig']`, and D34 Q1's invariant —
 * declared and implemented are the same fact — is worth more than a tidier name.
 */
export interface SupportsHooks {
  /**
   * Write this session's hook configuration in whatever format this CLI reads,
   * and return the argv tokens that make it load that file. Synchronous: see
   * (2) above. Returning `[]` is a legal answer meaning "nothing to add".
   */
  writeHooksConfig(hooks: PtyLaunchHooks): readonly string[]
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
