// Task 6-5 dropped `Project` from this import: `McpWriteContext` carries the
// project's ROOT PATH rather than the wire row, so the adapter layer no longer
// depends on the IPC schema for the MCP surface at all. See the interface's own
// docblock for why that turned out to matter.
import type { EffortLevel, PermissionMode } from '../../shared/ipc'
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
  /**
   * PLAN principle 009 — "CLI-native permission modes; app broker only for
   * automations". A non-null descriptor means THIS adapter's CLI takes a
   * permission flag and Chorus has MEASURED its vocabulary; null means nobody
   * has run `--help` for it yet, which is a different claim from "it has none"
   * and the only one an unverified adapter may make (spec §4.2's honesty rule).
   */
  readonly permissionMode: PermissionModeDescriptor | null
  readonly sessionResume: ResumeDescriptor | null
  readonly mcp: McpDescriptor | null
  readonly hooks: HooksDescriptor | null
  /** ⚠ REQUIRED AND NULLABLE, like its three siblings above. Every adapter has
   *  to ANSWER — `null` is an answer and an omission is not — which is what
   *  makes the capability-honesty test in `adapters.test.ts` able to prove
   *  declared-iff-implemented across the whole registry (D148). */
  readonly instructions: InstructionsDescriptor | null
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
  /**
   * The rung this adapter starts on when NOBODY CHOSE — added 2026-08-14.
   *
   * ⚠ IT IS NOT A UI HINT. `resolveLevelArgs` reads it on EVERY launch path
   * (dialog, restore, `session:restart`, profile relaunch), so a session that
   * comes back after an app restart comes back on the same rung it launched on.
   * A default that only the dialog knew about would be a default that quietly
   * stopped applying the moment the user was not looking, which is the failure
   * mode this field exists to close.
   *
   * Absent = no opinion, and the pre-2026-08-14 behaviour holds exactly: no
   * argument is emitted and the CLI's own default stands. That is still true of
   * every adapter except claude and (since D165) grok.
   */
  readonly defaultLevelId?: EffortLevel
}

/**
 * One position on the app-level permission control, mapped to what THIS
 * adapter's CLI actually wants. The exact twin of `EffortOption` — deliberately
 * so, because `resolveLevelArgs` serves both and a divergent shape would fork it.
 */
export interface PermissionModeOption {
  readonly id: PermissionMode
  readonly label: string
  /** e.g. `['--permission-mode', 'auto']`. Non-empty. */
  readonly args: readonly string[]
}

export interface PermissionModeDescriptor {
  readonly mode: DescriptorMode
  readonly levels: readonly PermissionModeOption[]
  /** See `EffortDescriptor.defaultLevelId` — same field, same rule, and the
   *  one that matters more: a permission default that evaporated on restore
   *  would silently hand a restored agent back its prompts. */
  readonly defaultLevelId?: PermissionMode
}

/** How an adapter is told about an MCP server. `launch-args` writes NOTHING —
 *  the servers travel as argv on every launch (codex's `-c mcp_servers.…`). */
export type McpMechanism = 'launch-args' | 'project-file' | 'env-named-file'

/**
 * The JSON SCHEMA a written MCP config must satisfy, named per CLI (Task 6-5).
 *
 * One value per CLI whose schema has actually been measured — never a generic
 * `'json'`, which is what `format` already says and which is precisely the
 * thing that turned out not to be enough. A CLI whose dialect nobody has
 * measured gets no entry here and therefore cannot be given a file descriptor
 * at all, which is the type doing the work a comment would do badly.
 */
export type McpDialect = 'claude' | 'opencode'

/**
 * ⚠ A DISCRIMINATED UNION, AND THE DISCRIMINANT IS LOAD-BEARING RATHER THAN
 * DESCRIPTIVE (Task 6-2 / spec §1). The previous shape could only describe an
 * adapter that writes a FILE, so codex's per-launch argv mechanism was not
 * expressible at all — and the one shape that fit it was
 * `{format:'toml', location:'home', configPath:'.codex/config.toml'}`, i.e.
 * THE TYPE'S OWN VOCABULARY NAMED THE FILE D49 FORBIDS WRITING. An implementer
 * following the types was being nudged into the violation.
 *
 * A `launch-args` adapter now has NO `configPath` field to fill in. That is the
 * type doing the work a comment was doing badly.
 *
 * ⚠ `format` / `location` STAY LITERAL UNIONS. Widening either to `string`
 * would be a silent loss of the constraint this change exists to tighten.
 */
export type McpDescriptor =
  | { readonly mode: DescriptorMode; readonly mechanism: 'launch-args' }
  | {
      readonly mode: DescriptorMode
      readonly mechanism: 'project-file' | 'env-named-file'
      readonly format: 'json' | 'toml' | 'yaml'
      readonly location: 'project' | 'home' | 'custom'
      /**
       * ⚠ WHICH CLI'S JSON SCHEMA THESE BYTES MUST SATISFY — added by Task 6-5,
       * and it is NOT decoration. `format: 'json'` says the file is JSON; it
       * says nothing about the SHAPE, and 6-1's D4 addendum (Finding 1,
       * measured through `opencode debug config` on 1.18.15) settled that the
       * two shapes differ in every part that matters: `mcpServers` vs `mcp`,
       * a command string + args array vs ONE command array, `env` vs
       * `environment`, plus a required `type: 'local'`. opencode's schema is
       * `additionalProperties: false`, so claude's shape is not merely
       * unidiomatic there — it is REJECTED.
       *
       * ⚠ AND IT IS NAMED EXPLICITLY RATHER THAN INFERRED FROM `mechanism`.
       * Today `project-file` happens to mean claude and `env-named-file`
       * happens to mean opencode, and that coincidence is exactly the
       * accidental coupling that breaks on the fourth adapter — the first CLI
       * that reads a project-scoped file in its own dialect would silently get
       * claude's. A renderer picks its dialect from THIS field and from nothing
       * else.
       */
      readonly dialect: McpDialect
      /** Relative to the location root, e.g. '.mcp.json'. ⚠ NON-NULLABLE on the
       *  file variants: it was `string | null` only because `launch-args` had
       *  nowhere else to live. A file adapter that cannot name its file is a
       *  bug, and the type should say so. */
      readonly configPath: string
      /** `env-named-file` only: the env var that names the file (opencode's
       *  `OPENCODE_CONFIG`). */
      readonly pathEnvVar?: string
    }

/**
 * The file-mechanism half of the union — the only variants that name a file,
 * and therefore the only ones a renderer or a writer can be asked about.
 *
 * ⚠ IT IS AN `Extract` OVER BOTH MECHANISM LITERALS AT ONCE, NOT ONE PER
 * MECHANISM. `Extract<McpDescriptor, {mechanism:'project-file'}>` is `never`,
 * because the union member's own `mechanism` is the two-value union and a union
 * does not extend one of its members. That `never` is silent at the definition
 * and only surfaces as an unrelated-looking error at the first property access,
 * which is worth one comment to save the next person the same ten minutes.
 */
export type McpFileDescriptor = Extract<
  McpDescriptor,
  { mechanism: 'project-file' | 'env-named-file' }
>

export interface HooksDescriptor {
  readonly mode: DescriptorMode
  readonly mechanism: 'http_listener' | 'script' | 'file_watch'
}

/**
 * How an adapter is given session-level instructions (D148, Task 6a-1).
 *
 * ⚠ `append-system-prompt-file` WRITES A CHORUS-OWNED FILE AND `config-override`
 * WRITES NOTHING AT ALL. Neither touches a file the user authored — that is the
 * whole point of the capability, and D49 is why it exists in this shape rather
 * than as a `CLAUDE.md` writer. The natural home for "query the graph before
 * assuming" is the user's own hand-authored instruction file, and that is
 * exactly the file Chorus is forbidden to write.
 *
 * ⚠ AND `--settings` IS NOT ONE OF THESE MECHANISMS, THOUGH D147(e) NAMED IT.
 * `--settings` takes a settings JSON file and has no system-prompt field at
 * all; Chorus's own use of it writes `{hooks:{…}}` (claude.ts). Measured
 * against the installed claude 2.1.232 on 2026-08-14, the vehicle that exists
 * is `--append-system-prompt-file <file>`.
 */
export interface InstructionsDescriptor {
  readonly mode: DescriptorMode
  readonly mechanism: 'append-system-prompt-file' | 'config-override'
}

/**
 * ⚠ DISCRIMINATED ON `kind` BY TASK 4a-2 (D139, RESOLVED 2026-08-13 by CR-4a.0).
 * `kind` is the assign-versus-discover distinction D140 measured: claude accepts
 * a Chorus-minted id at launch, codex names its own conversation and must be
 * asked afterwards what it chose.
 *
 * ⚠ `mode` IS RETAINED DELIBERATELY AND IS *NOT* THE DISCRIMINATOR. Three
 * council members flagged it as surplus beside `kind`; it stays because it is a
 * VALIDATED WIRE FIELD (`resumeDescriptorSchema.mode`, `shared/ipc.ts`) and
 * removing it would be a breaking schema change made for tidiness. It carries
 * the same "known ahead of time rather than probed" meaning it carries on every
 * other descriptor.
 */
export interface AssignedResumeDescriptor {
  readonly mode: DescriptorMode
  readonly kind: 'assigned'
  /** e.g. '--resume'; null when resumption is not CLI-flag driven. */
  readonly cliFlag: string | null
}

export interface DiscoveredResumeDescriptor {
  readonly mode: DescriptorMode
  readonly kind: 'discovered'
  /** e.g. '--resume'; null when resumption is not CLI-flag driven. */
  readonly cliFlag: string | null
}

export type ResumeDescriptor = AssignedResumeDescriptor | DiscoveredResumeDescriptor

/**
 * A modifier on the single `buildLaunch` path (D139 Q1).
 *
 * Assigned/create is used by claude for a fresh conversation whose vendor id
 * Chorus minted. Resume is used for an existing persisted vendor id.
 */
export type AgentSessionLaunch =
  | {
      readonly strategy: 'assigned'
      readonly action: 'create' | 'resume'
      readonly agentSessionId: string
    }
  | {
      readonly strategy: 'discovered'
      readonly action: 'resume'
      readonly agentSessionId: string
    }

export interface DiscoverSessionContext {
  /**
   * The CHORUS session-row id this launch belongs to (F64).
   *
   * ⚠ IT IS HERE SO DISCOVERY CAN BE AN IDENTITY MATCH RATHER THAN A GUESS. An
   * adapter that can stamp its launch with a per-session marker can then look
   * for exactly that marker, instead of inferring ownership from a directory and
   * a clock — which cannot separate two panes launched in the same directory
   * half a second apart, and restore staggers panes by exactly 500 ms.
   *
   * It is NOT a secret and NOT the agent's own id: it is the id Chorus already
   * puts in `PtyLaunchSpec.sessionId`, so an adapter can derive the same marker
   * at launch and at discovery without anything having to be remembered between.
   */
  readonly sessionId: string
  readonly cwd: string
  /** Epoch milliseconds captured immediately before the fresh PTY spawn.
   *  Discovery must not accept an older rollout as this launch's result. */
  readonly launchedAt: number
  /** Aborted on app quit, session disposal, restart, or superseding spawn.
   *  An aborted result must never be persisted. */
  readonly signal: AbortSignal
}

export type ResumeFailureReason =
  | 'not-found'
  | 'in-use'
  | 'transcript-unavailable'
  | 'unusable-pointer'

export interface ResumeExitObservation {
  readonly exitCode: number | null
  readonly signal: string | null
  /**
   * The bounded terminal text needed for adapter-local failure recognition.
   *
   * ⚠ IT IS THE POST-SCRUB STRING FROM THE SINGLE EMIT PATH IN
   * `services/sessionOutput.ts`, NOT RAW PTY BYTES. (D143(a).)
   *
   * A failure classifier reading session output is a NEW CONSUMER OF SESSION
   * TEXT, and D45(1) makes scrubbing a property of "a session emits text": ONE
   * `scrubber.push()` per chunk, whose single result feeds the ring buffer, the
   * renderer broadcast and the disk mirror. This must hang off that same
   * computed string.
   *
   * ⚠ A TAP ON RAW PTY BYTES HERE IS F26'S EXACT SHAPE — the live A/B that
   * found unredacted output reaching a new destination the moment a new
   * destination was added. Vendor error strings are not credentials, but this
   * contract is GENERIC and the next adapter's failure output is not ours to
   * predict.
   *
   * ⚠ AND IT MUST NOT BE LOGGED. The classifier reads it, returns a reason, and
   * the string goes nowhere else.
   *
   * The TYPE and this constraint ship in 4a-2. The WIRING — capturing bounded
   * output off the emit path and handing it to the classifier — is 4a-3's, and
   * 4a-3 must satisfy this without adding a second emit point.
   */
  readonly output: string
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
   *  wire payload, and `resolveLevelArgs` falls back to the descriptor's
   *  declared default (then to `[]`) for anything outside the vocabulary rather
   *  than throwing. */
  readonly effortOptionId?: string
  /** The app-level permission mode chosen for THIS launch. Absent means "the
   *  adapter's declared default" — which, unlike every other field on this
   *  spec, is NOT necessarily nothing: see `PermissionModeDescriptor`. Typed
   *  `string` for the same reason `effortOptionId` is. */
  readonly permissionModeId?: string
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
  /**
   * D148 (Task 6a-1): the memory usage contract for THIS launch.
   *
   * ⚠ ABSENT WHENEVER THE PROJECT HAS NO MEMORY CONFIGURED — which is most
   * launches — AND ARGV MUST THEN BE BYTE-IDENTICAL TO PRE-6a-1. Telling an
   * agent about a graph that does not exist is worse than saying nothing, so
   * the gate is `mcpLaunchInput !== null` and it lives in ONE place (ipc.ts).
   */
  readonly instructions?: PtyLaunchInstructions
  /**
   * F75/D150 (Task 6a-3): the MCP servers this launch should be told about, for
   * an adapter whose declared mechanism is `launch-args`. A file-mechanism
   * adapter ignores it — its config was already written by `wireMcpForLaunch`,
   * and both claude and opencode return `[]` from `mcpLaunchArgs` by contract.
   *
   * ⚠ NON-SECRET BY CONSTRUCTION AND BY GUARD. Only NAMES reach argv — the
   * refs arrive here already converted, carrying `envPassthrough` and no `env`
   * — and every VALUE travels `envAdditions` into the child environment.
   * `assertNoSecretInRendered` runs over the rendered argv AND the env values
   * before either leaves `wireMcpForLaunch`, and a hit costs the memory server
   * rather than the launch.
   *
   * Absent — the overwhelmingly common case — means argv is byte-identical to
   * pre-6a-3, because `mcpLaunchArgs([])` returns `[]`.
   */
  readonly mcpServers?: readonly McpServerRef[]
  /**
   * Phase 4a / D139: the agent conversation this launch belongs to.
   *
   * ⚠ IT IS THE AGENT-SESSION LAUNCH MODIFIER, AND A FIELD NAMED `resume`
   * LEGALLY CONTAINS A `create`. That is the ruling's own deliberate cost:
   * claude must receive the Chorus-minted id on its FIRST launch, not only on a
   * restore, and the alternative was a second launch API that would rebuild
   * credential, route, effort, extraArgs and hook handling beside this one. All
   * three council members raised the naming objection and all three accepted
   * it. DO NOT "fix" it with a second field.
   *
   * Absent — the overwhelmingly common case today, and the only case codex ever
   * sees on a fresh launch — means "a fresh conversation, named by whatever the
   * CLI chooses", and argv MUST then be byte-identical to what HEAD produced.
   * That identity is a test, not a hope: every launch in the app flows through
   * here.
   *
   * ⚠ THE TWO CLAUDE ACTIONS ARE MUTUALLY EXCLUSIVE AT THE CLI, NOT MERELY BY
   * CONVENTION. `--session-id` REFUSES an id that already exists ("Session ID …
   * is already in use.") and `--resume` REQUIRES one that does. An adapter that
   * emits both has emitted a guaranteed failure.
   */
  readonly resume?: AgentSessionLaunch
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

/**
 * The memory usage contract for one launch (D148, Task 6a-1).
 *
 * ⚠ THE SAME MAIN-OWNS-PATH / ADAPTER-OWNS-FORMAT SPLIT AS `PtyLaunchHooks`
 * ABOVE, AND FOR THE SAME REASON: main knows Electron's userData layout and
 * owns the delete-on-exit rule; the adapter knows what its own CLI will read.
 * Neither half can be written without the other.
 *
 * ⚠ IT IS THE EXACT OPPOSITE OF `PtyLaunchHooks.endpointUrl` IN ONE RESPECT.
 * That field is a capability and must never reach argv. This one is NON-SECRET
 * BY CONSTRUCTION — a static string plus an MCP server name, with no user input
 * on any path into it — which is why `config-override` may legally place it on
 * a world-readable command line.
 */
export interface PtyLaunchInstructions {
  /** The contract text main composed, already rendered for THIS adapter's
   *  mechanism (Markdown for a file, one physical line for a `-c` override). */
  readonly text: string
  /** Absolute path main reserved for an adapter that needs a file. Main creates
   *  the parent directory and deletes the file at session end; the adapter only
   *  writes. IGNORED by a `config-override` adapter, which writes nothing. */
  readonly filePath: string
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

/* NOTE: `ResumeSpec` was DELETED by Task 4a-2 (D139 Q1). It described a second
 * launch entry point — `resumeSession(spec)` — that would have rebuilt
 * credential, route, effort, extraArgs and hook handling beside `buildLaunch`,
 * and the two would then have had to agree forever. Resumption is now a
 * MODIFIER on the one launch path: `PtyLaunchSpec.resume`. Do not add it back. */

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
  /**
   * ⚠ VALUES ARE PLACEHOLDERS OR NON-SECRET LITERALS, NEVER SECRETS.
   *
   * Which of the two depends on the consuming MECHANISM, and both are legal:
   *  · FILE mechanisms take INTERPOLATION PLACEHOLDERS — `${NEO4J_PASSWORD}`
   *    for claude, `{env:NEO4J_PASSWORD}` for opencode. The CLI expands them;
   *    Chorus writes the placeholder text and never the value.
   *  · The `launch-args` MECHANISM (codex, D150) takes NON-SECRET LITERAL
   *    VALUES — the bolt URI and the database name — because codex interpolates
   *    nothing. `wireMcpForLaunch` moves them to `envAdditions` and puts only
   *    their NAMES in `envPassthrough`, so a literal here still never reaches
   *    argv. See `renderMcpLaunchArgs`, which does not render this field at all.
   *
   * A real SECRET here is the D49/D93 violation this field exists to make
   * unnecessary, and `assertNoSecretInRendered` refuses on either path — the
   * bytes for a file mechanism, the rendered argv and env values for the argv
   * one. That guard is what makes the placeholder/literal distinction checkable
   * rather than a convention.
   */
  readonly env?: Readonly<Record<string, string>>
  /** codex's `env_vars`: NAMES to pass through from the parent environment,
   *  with no value travelling at all. The strongest of the three mechanisms —
   *  6-1 measured `env_vars` as a distinct field from `env`, accepted
   *  per-invocation on codex 0.147.0. */
  readonly envPassthrough?: readonly string[]
}

/** The house `{ok:false, reason}` idiom, for a surface where "there is no file
 *  to write" is a legitimate answer rather than an error. */
export type McpWriteResult =
  | { readonly ok: true; readonly path: string; readonly serversWritten: number }
  | { readonly ok: false; readonly reason: string }

/**
 * Everything an adapter needs to write ONE project's MCP config — composed by
 * main and handed over whole (Task 6-5).
 *
 * ⚠ RESHAPED FROM `(project, servers, signal?)`, ON EXACTLY THE GROUNDS
 * `SupportsHooks.writeHooksConfig` was reshaped: it was declared and never
 * implemented by anything but codex's permanent refusal, which is the only
 * reason changing it is a definition rather than a breaking change. Three
 * things the implementation proved wrong about the old shape:
 *
 *  1. **`Project` was the wire type, and the launch path holds a
 *     `ProjectRecord`.** The two spell the same field `root_path` and
 *     `rootPath`. Passing the ROOT PATH itself removes the trap and drops the
 *     adapter layer's dependency on the IPC schema for this surface entirely.
 *  2. **An adapter cannot know where Chorus may legally write.** opencode's
 *     file is Chorus-owned under the app's userData directory, which is
 *     `app.getPath('userData')` — an Electron fact the adapter layer must stay
 *     ignorant of, because `adapters.test.ts` imports these modules under plain
 *     node. Main owns the DIRECTORY, the adapter owns the FILENAME and the
 *     FORMAT. That is the same split `PtyLaunchHooks` draws.
 *  3. **`knownSecrets` had nowhere to travel.** The guard's exact-value half
 *     needs the values the caller knows it injected, and spec §4 puts their
 *     origin in `memoryService` — *"the adapter never resolves a credential
 *     itself"*. With no parameter for them, every adapter would have had to go
 *     and find them, which is the one thing it must not do.
 */
export interface McpWriteContext {
  /**
   * Absolute path to the root of the tree the session will run in. A
   * `project-file` config lands here — claude's `.mcp.json` is project-scoped
   * and that is the mechanism, not an accident.
   *
   * ⚠ IT IS THE LAUNCH'S CWD, WHICH IS NOT ALWAYS THE PROJECT ROW'S PATH. A
   * new-worktree launch runs in `.chorus/worktrees/<x>` — a separate checkout,
   * where a file written at the project root simply is not present. The caller
   * passes the directory it is about to spawn in; see `withMcpEnv` in `ipc.ts`.
   */
  readonly projectRoot: string
  /** Absolute path to the Chorus-owned directory main has reserved for adapter
   *  MCP configs. ⚠ NOT the repo and NOT the user's global config: for
   *  `env-named-file` adapters the LOCATION IS THE SECURITY PROPERTY. Main
   *  creates nothing here; the writer does. */
  readonly chorusConfigDir: string
  readonly servers: readonly McpServerRef[]
  /** Values the caller knows it injected, for the guard's exact-value half.
   *  ⚠ EMPTY IS THE NORMAL CASE THIS PHASE (D128(a): local mode, `NEO4J_AUTH=none`)
   *  and does NOT make the guard vacuous — its shape half still runs. */
  readonly knownSecrets: readonly string[]
  readonly signal?: AbortSignal
}

export interface SupportsMcp {
  /** ⚠ REFUSES RATHER THAN THROWS, and `assertNoSecretInRendered` is what makes
   *  the refusal mandatory rather than polite. */
  writeMcpConfig(ctx: McpWriteContext): Promise<McpWriteResult>
  /** The argv mechanism. Pure, synchronous, writes nothing — which is why codex
   *  can implement MCP support in a commit that touches no filesystem.
   *
   *  ⚠ BOTH MEMBERS ARE REQUIRED, AND THAT IS DELIBERATE. A file adapter's
   *  `mcpLaunchArgs` returns `[]`; an argv adapter's `writeMcpConfig` returns a
   *  structured refusal. Making either optional would reintroduce the
   *  declared-but-not-implemented hole `supportsMcp` exists to close. */
  mcpLaunchArgs(servers: readonly McpServerRef[]): readonly string[]
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

/**
 * Implemented by an adapter that can be told something at launch (D148).
 *
 * ⚠ THE PARAMETER IS NULLABLE RATHER THAN THE METHOD OPTIONAL, AND THAT IS THE
 * WHOLE DESIGN. `null` means "no memory contract for this launch". A file
 * adapter must then return `[]` and write nothing — but codex still has to emit
 * its own baseline developer instruction (the jade formatting rule), because
 * `-c developer_instructions` has exactly ONE emitter in this codebase and it is
 * this method. A method that could simply not be called would give that key a
 * second home the moment the contract was absent.
 */
export interface SupportsInstructions {
  /** Returns the argv tokens, writing a file first if this adapter's mechanism
   *  needs one. MUST NOT THROW: losing the contract costs a hint, refusing to
   *  launch costs the session. */
  instructionsArgs(instructions: PtyLaunchInstructions | null): readonly string[]
}

/**
 * Implemented by an adapter whose CLI accepts a Chorus-minted conversation id at
 * launch (claude's `--session-id`). Deterministic: no discovery, no watcher, no
 * race — which is why `discoverSessionId` is FORBIDDEN here rather than merely
 * unused. `?: never` is the compile-time half of that; the guard below is the
 * runtime half, and `adapters.test.ts` asserts it.
 *
 * ⚠ THE DESCRIPTOR IS NOT DECLARED HERE, AND THAT IS A DELIBERATE DEPARTURE
 * FROM THE RULED TYPESCRIPT (spec §4.4(ii)). The findings open this interface
 * with `readonly sessionResume: AssignedResumeDescriptor`, but in THIS tree the
 * descriptor lives on the return value of `getCapabilities()` — no adapter
 * carries it as a property. Declaring it here would make claude and codex fail
 * to satisfy their own interfaces, and "fixing" that by adding a property would
 * BYPASS `capabilities.ts`'s detected-override merge, leaving the guard reading
 * a stale descriptor while `getCapabilities()` returned a live one. Methods
 * only, exactly as `SupportsHooks` does it; the guard reads the descriptor
 * through `getCapabilities()`. The ruling's kind/method linkage is preserved in
 * full — it is enforced at the guard rather than in the interface.
 */
export interface AssignedResumeSupport {
  readonly discoverSessionId?: never
  /** Returns a reason only for a FAILED assigned/resume launch. A clean exit,
   *  and every ordinary end of an ordinary session, returns null. */
  classifyResumeFailure(observation: ResumeExitObservation): ResumeFailureReason | null
}

/**
 * Implemented by an adapter whose CLI names its own conversation and must be
 * asked afterwards what it chose (codex). Discovery is ADAPTER-OWNED because a
 * SessionManager that reads rollout headers is shared code that has learned a
 * vendor file format — the ruling's Q2 reasoning applied to files instead of
 * argv.
 */
export interface DiscoveredResumeSupport {
  /** ⚠ BOUNDED AND ABORTABLE, AND IT OWNS NO TIMER OF ITS OWN. `context.signal`
   *  is aborted on quit, restart, disposal or a superseding spawn, and an
   *  aborted result must never be persisted. `null` means "not found, not
   *  certain, or not in time" — all three are the same answer, because a wrong
   *  pointer resumes SOMEONE ELSE'S CONVERSATION INTO THIS PANE and an empty one
   *  costs a manual relaunch (D140). Reads rollout-file `session_meta` headers
   *  ONLY; never `session_index.jsonl`, which carries no cwd (F57). 4a-3 owns
   *  when this is called. */
  discoverSessionId(context: DiscoverSessionContext): Promise<string | null>
  classifyResumeFailure(observation: ResumeExitObservation): ResumeFailureReason | null
}

export type SupportsResume = AssignedResumeSupport | DiscoveredResumeSupport

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
// ⚠ Task 6-2 WIDENED THIS TO CHECK BOTH METHODS. Checking only
// `writeMcpConfig` would narrow an argv adapter — one that genuinely supports
// MCP and implements `mcpLaunchArgs` — to `false`: the same
// declared-vs-implemented lie, in the other direction.
export function supportsMcp(a: BaseAgentAdapter): a is BaseAgentAdapter & SupportsMcp {
  return (
    a.getCapabilities().mcp !== null &&
    typeof (a as Partial<SupportsMcp>).writeMcpConfig === 'function' &&
    typeof (a as Partial<SupportsMcp>).mcpLaunchArgs === 'function'
  )
}

export function supportsHooks(a: BaseAgentAdapter): a is BaseAgentAdapter & SupportsHooks {
  return (
    a.getCapabilities().hooks !== null &&
    typeof (a as Partial<SupportsHooks>).writeHooksConfig === 'function'
  )
}

export function supportsInstructions(
  a: BaseAgentAdapter
): a is BaseAgentAdapter & SupportsInstructions {
  return (
    a.getCapabilities().instructions !== null &&
    typeof (a as Partial<SupportsInstructions>).instructionsArgs === 'function'
  )
}

/**
 * ⚠ TASK 4a-2 REPLACED THE NAME-PAIRING WITH A STRUCTURAL CHECK (CR-4a.0 Q5).
 * The old form asked "is there a method called `resumeSession`?" — a question
 * about a name. This asks whether the adapter provides what its OWN DECLARED
 * KIND requires: `assigned` forbids discovery, `discovered` requires it, and
 * both must classify their failures. D34 Q1's invariant is unchanged and the
 * check is strictly stronger.
 *
 * ⚠ THE `BaseAgentAdapter &` INTERSECTION IS KEPT, AGAINST THE RULED SIGNATURE
 * (spec §4.4(i)). The findings write `supportsResume(adapter: unknown): adapter
 * is SupportsResume`, which drops it — but both siblings above narrow to
 * `BaseAgentAdapter & …`, and 4a-3's call sites need `buildLaunch` off the same
 * value they just narrowed. A guard returning bare `SupportsResume` would force
 * a cast back at every use, which is how a narrowing helper becomes decoration.
 */
export function supportsResume(a: BaseAgentAdapter): a is BaseAgentAdapter & SupportsResume {
  const descriptor = a.getCapabilities().sessionResume
  if (descriptor === null) return false
  // ⚠ NOT `Partial<AssignedResumeSupport & DiscoveredResumeSupport>`. That
  // intersection reduces to `never`, because `discoverSessionId?: never` and
  // `discoverSessionId(...): Promise<…>` have no common inhabitant — every
  // property read off it then fails to compile. The probe names what it reads.
  const ext = a as {
    readonly discoverSessionId?: unknown
    readonly classifyResumeFailure?: unknown
  }
  if (typeof ext.classifyResumeFailure !== 'function') return false
  return descriptor.kind === 'assigned'
    ? ext.discoverSessionId === undefined
    : typeof ext.discoverSessionId === 'function'
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
