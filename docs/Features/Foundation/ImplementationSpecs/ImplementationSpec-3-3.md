# Implementation Spec 3-3 — `AgentAdapter` Interface + Launch-Path Refactor

_Companion to `Tasks/Task-3-3.md`. The task doc governs **scope**; this doc governs **exact contents, insertion points, and rationale**._

> **This document is NORMATIVE under D34.** The CR-3.1 findings' verbatim TypeScript is its strong draft and **does not compile as written**; four coordinator resolutions patch it. Where this spec and the findings differ, **this spec is the contract**. §2 in particular is to be transcribed, not paraphrased — and any deviation from it must be flagged in the commit message with its reason.

**Anchored to commit `fb3201e`, verified 2026-07-22.** All insertion points are named symbols, never line numbers (house rule).

---

## 1. What the findings got wrong, and why the fixes are what they are

Four defects, each with a resolution in D34. Understanding *why* matters, because a reviewer comparing this spec to the findings will otherwise read the differences as drift.

**1. The type guards do not compile.** The findings declare `getCapabilities(): AgentCapabilities` as a core **method**, then write guards reading `a.capabilities.mcp !== null` — a **property** that does not exist. This spec keeps the method (Q1's unanimous ruling names it) and fixes the guards. It also drops the findings' `readonly capabilities: AgentCapabilities & { readonly mcp: McpDescriptor }` member on the extension interfaces: intersecting two declarations of the same method produces an overload set whose resolution order is a trap nobody should have to reason about. **The extension interfaces declare only their methods**; the guard is what ties "descriptor is non-null" to "method exists", which is the actual Q1 goal — *supported* and *implemented* become the same fact at the call site.

**2. `SupportsStateDetection` and `OutputInterpreter` contradict Q4.** The findings' Q4 synthesis removes `detectState` by a 2-1 majority, and its own code block then declares the outvoted position — under a name (`SupportsStateDetection`) that does not even match the synthesis text (`SupportsOutputParsing`). **D34(a) strikes both.** They are absent from this spec. Do not add them back on the grounds that "types are free": a declared seam is a promise about a design Phase 4 has not made.

**3. `AgentKind = keyof typeof staticRegistry` violates the process boundary.** `staticRegistry` lives in `src/main/`; `AgentKind` is consumed by `src/shared/ipc.ts` and by renderer components. Shared and renderer code can never import a main-process module. The findings' own TS also annotates the registry `Record<string, AgentAdapter>`, which widens `keyof` to `string` — so the derivation would not have produced a two-value union anyway. **D34(b):** `agentKindSchema` stays the wire authority and the registry is typed **`Record<AgentKind, AgentAdapter>`** via a **type-only** import. Same single source of truth, exhaustiveness still compiler-enforced, no boundary violation.

**4. `PtyLaunchRequest.env` gives every adapter a copy of the env policy.** The findings hand each adapter the full environment *and* separately declare `requiredEnvVars` so main can build the same list — two owners of one rule, which is how allow-lists drift. **D34(d): env policy has exactly one owner, main.** `buildLaunch` contributes *additions* and *secrets*; `SessionManager` composes the child environment. `cols`/`rows` leave the request entirely — terminal geometry is session state, not adapter knowledge.

---

## 2. `src/main/adapters/types.ts` — the normative interface

**Create.** Types and type guards only; no I/O, no side effects.

```ts
import type { AgentKind, Project } from '../../shared/ipc'

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
```

`Project` is imported type-only from `src/shared/ipc` (it already exists there as `z.infer<typeof projectSchema>`). **`src/main` importing `src/shared` is fine and established; the reverse is what D34(b) forbids.**

---

## 3. `src/main/adapters/capabilities.ts`

```ts
/**
 * Merge detected capabilities over an adapter's static declaration.
 *
 * The null/undefined distinction is MEANINGFUL and is the whole reason this is
 * a function rather than a spread (CR-3.1 risk 7):
 *   undefined -> the probe did not determine this; keep the static value.
 *   null      -> the probe determined the capability is ABSENT; override.
 * A naive `{...base, ...detected}` gets this right for `undefined` only by
 * accident of how the object was constructed, and wrong the moment a probe
 * builds its result with explicit `undefined` fields.
 */
export function mergeCapabilities(
  base: AgentCapabilities,
  detected?: Partial<AgentCapabilities>
): AgentCapabilities {
  if (!detected) return base
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(detected)) {
    if (v !== undefined) out[k] = v
  }
  return out as AgentCapabilities
}
```

The single `as AgentCapabilities` at the boundary is the one cast this module needs; it is not `any`, not `unknown as`, and not `@ts-expect-error`, all three of which are banned in `src/main/adapters/`.

---

## 4. The two adapters

### 4.1 The neutrality rule

Both `buildLaunch` implementations must produce **exactly** what `resolveCli` produces today, because `SessionManager.spawn` currently does nothing but `pty.spawn(cli.file, cli.args, …)`.

```ts
buildLaunch(spec: PtyLaunchSpec): PtyLaunchRequest {
  // Behavior-neutral (Task 3-3): resolveCli is the same synchronous
  // where.exe resolution SessionManager used directly before this refactor.
  // The .exe-vs-.cmd shim decision stays inside cliDetect where it has been
  // proven; the adapter's job here is to OWN the knowledge, not change it.
  const cli = resolveCli(this.id)
  return {
    executable: cli.file,
    args: cli.args,
    cwd: spec.cwd,
    envAdditions: {},
    secretEnv: buildSecretEnv(spec.credential)
  }
}
```

where `buildSecretEnv` is a tiny shared helper: `credential ? { [credential.envVarName]: credential.value } : {}`. It is written now and exercised by a unit test so Task 3-6 inherits a tested seam, but **`spec.credential` is always `undefined` in this task** — nothing constructs one.

**`envAdditions` must be `{}` for both adapters in Phase 3.** Any non-empty value is a behavior change: it would alter the child environment, which this task's own acceptance criteria forbid.

### 4.2 Declared capabilities — honesty rules

Declare only what has been **verified this session** against the installed CLIs (D4). For anything unverified, `null`/`false` is the correct answer and "we'll fill it in later" is not a reason to guess.

Concretely, for Phase 3 both adapters should declare:
- `interactiveTerminal: true` — observed since Phase 0; both render TUIs.
- `worktreeSafe: true` — proven across all of Phase 2.
- `subscriptionLogin: true` — both authenticate this way today.
- `apiKey: true` — the capability Phase 3 is building; declare it, since the auth-method list is what 3-4 renders and 3-6 acts on.
- `reasoningEffort: null` — **Phase 3a's job.** Declaring an `EffortDescriptor` with guessed CLI flags would put unverified flags on a seam other phases build on.
- `mcp`, `hooks`, `sessionResume`: `null` unless verified against `--help` in this session. If a probe *does* confirm one, declare the descriptor — and say in the commit message what command proved it.
- `skills`: whatever `--help` supports; `false` if unverified.

`getAuthMethods()` returns one `subscription` entry and one `api_key` entry per adapter. **The `requiredEnvVar` value is the one thing here that must be D4-verified before it is written down** — it is what Task 3-6 will inject into. If verification is inconclusive in this session, declare it `null` and make that a flagged finding for 3-6 rather than writing a remembered guess.

---

## 5. `src/main/adapters/registry.ts`

```ts
import type { AgentKind } from '../../shared/ipc'   // TYPE-ONLY (D34(b))

/**
 * The static registry. Typed `Record<AgentKind, AgentAdapter>` so the compiler
 * enforces exact coverage of the wire vocabulary: adding a kind to
 * agentKindSchema without adding an adapter here is a BUILD failure, and vice
 * versa. That is the property D34(b) preserved when it rejected deriving
 * AgentKind from this object (which would have made the two trivially
 * agree while letting them agree on the wrong thing).
 *
 * Frozen deliberately. Phase 6 adds register() behind a Map-backed registry
 * that merges static + runtime entries; getAdapter's signature does not change.
 */
export const staticRegistry: Readonly<Record<AgentKind, AgentAdapter>> = Object.freeze({
  claude: claudeAdapter,
  codex: codexAdapter
})

/** Lookup by an ARBITRARY string — the persisted `sessions.agent` value, which
 *  is a TEXT column and can hold anything (a hand-edited row, a downgrade
 *  after a kind was added). The widening cast is the honest expression of
 *  that: the input genuinely is not known to be an AgentKind. */
export function getAdapter(id: string): AgentAdapter | undefined {
  return (staticRegistry as Record<string, AgentAdapter | undefined>)[id]
}

export function getAdapterOrThrow(id: string): AgentAdapter {
  const adapter = getAdapter(id)
  if (!adapter) throw new UnknownAgentError(id)
  return adapter
}
```

---

## 6. `cliDetect.ts` — splitting the probe

`detectClis()` keeps its memoization and its response shape. The change is which function answers for which tool:

```ts
export function detectClis(): Promise<DetectedCli[]> {
  detection ??= Promise.all(
    DETECTED_TOOLS.map((name) => {
      const adapter = getAdapter(name)
      // Agents answer through their own adapter (CR-3.1 action 6); git, docker
      // and node stay on the plain tool probe, which is all they ever were.
      return adapter ? detectViaAdapter(adapter) : detectOne(name)
    })
  )
  return detection
}
```

`detectViaAdapter` maps `InstallationStatus` onto the `DetectedCli` wire shape and supplies the D34(f) display fields:

```ts
async function detectViaAdapter(adapter: AgentAdapter): Promise<DetectedCli> {
  const status = await adapter.detectInstallation()
  return {
    name: adapter.id,
    found: status.found,
    path: status.path,
    version: status.version,
    displayName: adapter.displayName,
    agentKind: adapter.id as AgentKind   // registry membership proves this
  }
}
```

`detectOne` gains `displayName: null, agentKind: null` for the three plain tools.

**`resolveCli` stays exported and unchanged.** The adapters call it; it is the proven resolution logic and moving it would be an unforced behavior risk. **Watch for a circular import:** `cliDetect.ts` importing `registry.ts` which imports `claude.ts` which imports `cliDetect.ts` is a cycle. Break it by having the adapters import `resolveCli` from `cliDetect` (a leaf function) while `cliDetect` imports `getAdapter` from `registry` — ESM tolerates this because `getAdapter` is only *called* at detect time, not at module-evaluation time. If the bundler complains anyway, extract `resolveCli`/`pickSpawnable` into a small `cliResolve.ts` that neither imports; do that rather than fighting the cycle.

Each adapter's `detectInstallation()` reuses the existing probe logic (`where.exe`, then `--version`, 10 s timeout, `windowsHide`, first line, `'unknown'` on failure). **Do not "improve" it** — the byte-identical `cli:detect` response is an acceptance criterion.

---

## 7. `SessionManager.spawn`

```ts
  private spawn(agent: AgentKind, cwd: string, sessionId: string): PtySession {
    // Task 3-3: the adapter owns HOW this agent starts. The registry lookup is
    // a genuine RUNTIME check even though `agent` is typed — sessions.agent is
    // a TEXT column, so the caller's cast is unsound by construction and this
    // is where that unsoundness is caught. UnknownAgentError propagates to the
    // restore engine's existing catch, which heals the row to 'exited' and
    // logs it (D34(c)) — no new failure path, no new status value.
    const adapter = getAdapterOrThrow(agent)
    if (!isPtyAdapter(adapter)) {
      throw new Error(`Agent '${agent}' is not a PTY agent`)
    }
    const request = adapter.buildLaunch({ sessionId, cwd })

    const child = pty.spawn(request.executable, [...request.args], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: request.cwd,
      // UNCHANGED (D5 still stands until Task 3-6): both agents use their own
      // subscription logins; no credentials are injected or logged here.
      // Task 3-6 replaces this line and this comment together.
      env: process.env as Record<string, string>,
      useConpty: true
    })
    …
```

Three things to hold onto:

- **`cols`/`rows` stay here.** D34(d). They are session geometry, not adapter knowledge, and `SessionManager` is already where resize lives.
- **`env` is untouched.** `request.envAdditions` and `request.secretEnv` are both `{}` this task and are **deliberately not merged in** — merging empty objects would look harmless and would quietly move env composition into this commit, where it cannot be reviewed against D33. Task 3-6 introduces the composition with its own tests and its own runtime proof.
- **`[...request.args]`** copies the readonly array into the mutable `string[]` node-pty expects.

The restore engine's existing `this.spawn(row.agent as AgentKind, …)` call site keeps its cast. It is a lie about a TEXT column, and the registry lookup above is what catches it — that is the design, not an oversight worth "fixing" by widening the signature.

---

## 8. The wire

### 8.1 `detectedCliSchema` grows two required-nullable fields

```ts
  /** D34(f): adapter-supplied label for agent entries; null for plain tool
   *  probes (git/docker/node). Required-nullable so a producer that forgets it
   *  fails the outbound parse (the 1b-1 `title` discipline). */
  displayName: z.string().nullable(),
  /** D34(f): the AgentKind when this row IS an agent; null when it is a plain
   *  tool. A TYPED value rather than the `agent: boolean` flag D34(f) sketched
   *  — the renderer needs an AgentKind for the launch payload, and a boolean
   *  would force a cast at exactly the boundary this refactor exists to type. */
  agentKind: agentKindSchema.nullable()
```

The `agentKind`-instead-of-boolean choice is a **coordinator refinement of D34(f)**; flag it in the commit message. It is strictly stronger than the ruling it implements and costs nothing.

### 8.2 `adapter:list` — a new declarative channel

D34(f) put display data on `cli:detect` so the renderer could drop its hardcoded labels. Task 3-4 needs more than labels: it renders **auth methods** in the provider form. Stuffing capability descriptors into `cli:detect` rows would be dishonest — three of those five rows are `git`, `docker`, and `node`, which have no capabilities and no auth methods.

So: `cli:detect` stays the **installation probe** (found / path / version, plus display data), and `adapter:list` becomes the **static declaration** (id, displayName, executionMode, authMethods, capabilities). No probing, no I/O, no memoization needed.

```ts
  /** invoke: static adapter declarations — capabilities + auth methods. No
   *  probing; cli:detect owns installation state. */
  AdapterList: 'adapter:list',
```

with Zod mirrors of `AuthMethodDefinition` and `AgentCapabilities` (descriptors included). The handler is a map over `staticRegistry` values, outbound-parsed like every other response.

Without this channel, Task 3-4 would hardcode auth methods in a Vue file — reintroducing exactly the coupling D34(f) exists to remove, one layer up. **Flag `adapter:list` as a coordinator addition** in the commit message; it is new surface that neither council question asked for.

### 8.3 `session:restart` — D34(c)

```ts
-   const agent = agentKindSchema.parse(row.agent)
+   // D34(c): an unknown persisted agent is a REFUSAL, not a throw. There is no
+   // 'failed' session status (running|exited only) and no notification centre
+   // until Phase 4, so the unknown-agent rule maps onto what exists: an inline
+   // {ok:false} here, and the D16 spawn-failure heal path at restore.
+   const adapter = getAdapter(row.agent)
+   if (!adapter) {
+     return { ok: false, reason: `Unknown agent '${row.agent}' — this session cannot be restarted.` }
+   }
```

`sessions.launch(...)` still takes an `AgentKind`; keep the existing cast at that call, now justified by the lookup immediately above it.

---

## 9. `LaunchDialog.vue`

Delete both constants. The card list becomes a filter over the detect response:

```ts
const clis = await window.chorus.detectClis()
agents.value = clis
  .filter((c): c is DetectedCli & { agentKind: AgentKind } => c.agentKind !== null)
  .map((c) => ({
    name: c.agentKind,
    label: c.displayName ?? c.agentKind,
    found: c.found,
    version: c.version
  }))
```

and the template renders `{{ a.label }}` where it read `{{ labels[a.name] }}`.

Two consequences to keep honest:

1. **Card order now comes from `DETECTED_TOOLS`**, not from the deleted `AGENT_KINDS` array. Both are `['claude', 'codex', …]`-ordered today, so the rendered order is unchanged — verify it visually rather than assuming, since it is user-visible and this task forbids user-visible change.
2. **An agent missing from the detect response now renders no card at all**, where previously `AGENT_KINDS` guaranteed a card with a "not found" note. That regression matters: a not-found agent should still show as a disabled card (the component's own documented contract, in its header comment). Since `DETECTED_TOOLS` enumerates all agents unconditionally and `detectViaAdapter` returns `found: false` rather than omitting the row, the row is always present — **confirm this at runtime by renaming `codex` off `PATH` and checking the card still appears, disabled.**

---

## 10. `AdapterAuthoring.md`

CR-3.1 action item 12. One page, `docs/Features/Foundation/AdapterAuthoring.md`:

- the narrowing idiom, in three lines (`if (supportsMcp(adapter)) { await adapter.writeMcpConfig(...) }`);
- why the guard checks both halves;
- a worked example: a minimal fictional PTY adapter with one capability descriptor and its extension interface;
- **an explicit "declared but not implemented in Phase 3" list**, so the next author does not write code against `startApiSession` expecting it to exist;
- the `null` vs `undefined` rule for `mergeCapabilities`.

The worked example must compile against the shipped types. If it does not, the interface is harder to use than the council believed, and that is a finding worth raising rather than papering over with prose.

---

## 11. Verification notes

**The neutrality proof is a diff, not an assertion.** Capture before touching code:

```
cli:detect JSON  ·  Win32_Process command lines for the agent processes  ·  a screenshot of the launch dialog
```

Re-capture after. The detect JSON must differ **only** by the two added fields. The command lines must be identical — this is what catches a `cmd.exe /c` wrapper that changed shape for Codex, which is the single most likely silent regression in this task.

**The unknown-agent proof** needs a hand-edited row. Set one session's `agent` to `'gemini'`, cold-boot, and confirm: the restore engine logs the failure through pino, heals the row to `exited`, the other session restores normally, and the app does not crash. Then attempt a restart on that pane and confirm the inline refusal. **Restore the row to `'claude'` afterwards** — it is part of the standing dev fixture.

**Do not skip the "renamed off PATH" check** in §9. It is the only way to prove the not-found card path still works, and it is a genuine regression risk of deleting `AGENT_KINDS`.
