# Council Findings CR-3.1 — The `AgentAdapter` Interface Shape for Chorus

_Filed 2026-07-22 · Decision: REVISE · Confidence: 8/10 · Recorder: Kilo (Claude)_

---

## Council Verdict: **REVISE**

The council unanimously finds the sketched interface is on the right conceptual track but has critical structural flaws that must be addressed before implementation: the monolithic shape is type-dishonest (mandatory PTY methods on API adapters), capability booleans are uncorrelated with optional methods enabling silent runtime errors, and the credential/secret seam is not explicitly modeled.

---

## Issues (Severity-Ranked)

### HIGH

| # | Issue | Flagged By |
|---|-------|------------|
| 1 | **Monolithic, type-dishonest interface**: `buildLaunch` is mandatory even for `executionMode: 'api'`, while API behavior is optional, forcing mode checks and invalid method availability. | Kimi, GLM, Qwen |
| 2 | **Capability booleans uncorrelated with optional methods**: Callers must check both capability flags and method presence, potentially recreating provider-specific conditionals. | Kimi, GLM, Qwen |
| 3 | **Launch seam does not explicitly model required env vars and secret env entries**: The credential rules require secrets to be distinguishable and never passed via argv, but `ProcessLaunchRequest` has no such modeling. | Kimi |
| 4 | **`writeMcpConfig` and `writeHooks` return `void`**: Hides async filesystem failures and encourages blocking main-process I/O. | Kimi, Qwen |
| 5 | **`startApiSession?` is synchronous and optional on the shared interface**: Not honest for future API-mode agents that require async setup and lifecycle cleanup. | Kimi, GLM |

### MEDIUM

| # | Issue | Flagged By |
|---|-------|------------|
| 6 | **`detectState(chunk, current)` is a stateless raw-chunk hook**: Fragile across PTY chunk boundaries and ANSI/control sequences. Should be removed from core interface or reshaped as a stateful interpreter. | Kimi, GLM, Qwen |
| 7 | **Capability granularity too coarse for model/effort selection**: `reasoningEffort: boolean` plus separate `getEffortOptions(modelId)` leaves UI without self-contained model metadata. | Kimi, GLM |
| 8 | **Async methods lack cancellation**: `detectInstallation()`, `getModels()` lack `AbortSignal`, risking abandoned probes after dialog cancellation. | Kimi, Qwen |
| 9 | **No adapter registry and unknown persisted-id policy**: Adapter id must replace the persisted enum, but the sketch has no registry shape or degradation rule for unknown ids. | Kimi, GLM, Qwen |
| 10 | **One `LaunchSpec` for PTY and API modes**: Risks carrying terminal/process-only fields into API sessions. | Kimi |

---

## Top Priority Remediation

Split the adapter into a type-honest base plus `PtyAgentAdapter | ApiAgentAdapter` discriminated union and capability-gated extension interfaces, then define the launch/secret seam on the PTY side.

---

## Detailed Council Positions

### Per-Model Positions

**Kimi**: Q1 C / Q2 union (adapter + session boundary) / Q3 descriptors / Q4 out (remove from Phase 3, add stateful interpreter later) / Q5 stable id, static registry for now, explicit unknown-id degradation — The monolithic interface forces every adapter to carry dead methods; capability-gated extension interfaces make "supported" and "implemented" the same fact. The PTY/API split must be a discriminated union because the two modes share almost no implementation surface and a shared interface invites invalid method calls. — Strongest counterargument: Extension interfaces add complexity contributors must learn; the narrowing idiom is unfamiliar to many TS developers.

**GLM**: Q1 C / Q2 union (adapter boundary) / Q3 descriptors / Q4 out (remove entirely) / Q5 stable id, static registry, launch refusal on unknown — Capability booleans give callers nothing actionable — "mcp: true" doesn't tell you which config format or where to write it. detectState on raw chunks is fundamentally unreliable; Phase 4's plan already ranks it last and low-confidence, so declaring it now is speculative dead weight. — Strongest counterargument: Removing detectState entirely means Phase 4 has no placeholder to extend; the plan's detection tier must be designed from scratch.

**Qwen**: Q1 C / Q2 union (session boundary) / Q3 descriptors / Q4 reshaped (stateful output interpreter) / Q5 stable id, runtime registry, refuse launch + surface error — The existing monorepo already has 142 tests proving two PTY agents; the interface should encode what we KNOW they differ on (argv, env, auth, detection) and leave everything else for its own phase. A frozen compile-time registry is wrong for user-defined OpenAI-compatible endpoints, but Phase 3 only needs a static list. — Strongest counterargument: A stateful output interpreter is a new abstraction with its own design surface; the Phase 4 plan may render it unnecessary if agent-native hooks prove sufficient.

---

## Council Synthesis

### Q1 — Interface Surface

**Ruling: C (narrow core + capability-gated extension interfaces)** — unanimous 3-0.

Declare a small always-implemented core interface with `id`, `displayName`, `executionMode`, `detectInstallation`, `getAuthMethods`, and `getCapabilities`. All domain-specific concerns live on extension interfaces (`SupportsMcp`, `SupportsHooks`, `SupportsResume`, `SupportsApiMode`, etc.) that an adapter optionally implements. Callers narrow with a type guard (`'mcp' in adapter.capabilities && isMcpAdapter(adapter)`). Capabilities become type-level facts rather than booleans a caller must trust independently. Phase 3 implements the core + PTY-launch methods only; all extension interfaces are declared but unimplemented.

### Q2 — PTY/API Execution Split

**Ruling: Discriminated union — boundary at BOTH adapter and session** — unanimous 3-0.

`PtyAgentAdapter | ApiAgentAdapter` at the adapter level. At the session level, `SessionManager` gains `PtySession` and `ApiSession` variants. The two modes share almost no implementation surface (one owns a PTY handle + ring buffer, the other owns an HTTP stream + message buffer), and a shared interface invites invalid method calls the compiler cannot prevent.

### Q3 — Capability Granularity

**Ruling: Descriptors, with static base and per-installation override** — unanimous 3-0.

`AgentCapabilities` becomes a record of descriptors, not booleans:
- `reasoningEffort: EffortOption[] | null` — `null` means unsupported; the array carries the actual levels and their CLI flags.
- `mcp: McpConfigDescriptor | null` — carries format (json/toml), location (project/home), and schema.
- `hooks: HooksDescriptor | null` — describes the hooks mechanism available.
- Simple booleans remain only for truly binary facts (`interactiveTerminal`, `worktreeSafe`).

**Static-vs-per-installation ruling**: Each capability descriptor has a `mode: 'static' | 'dynamic'` field. Static capabilities are frozen on the adapter instance. Dynamic capabilities are populated by `detectInstallation()` — a newer CLI version may report new capabilities in its `InstallationStatus.capabilities` field, which a `mergeCapabilities(static, detected)` utility combines. This avoids the split-brain problem where `detectInstallation()` reports version and auth state separately from `getCapabilities()`.

### Q4 — detectState

**Ruling: Out of the core interface; reshaped as an optional OutputInterpreter in Phase 4** — majority 2-1 (Kimi out, GLM out, Qwen reshaped).

`detectState` is removed from the `AgentAdapter` interface entirely. Phase 3 does not declare or implement it. When Phase 4 arrives and needs output-derived state, it introduces a dedicated `OutputInterpreter` concept that operates on a buffered, newline-delimited view (not raw chunks) and maintains internal state across invocations. If it turns out agents need adapter-specific parsing, `OutputInterpreter` becomes a capability an adapter can provide via a `SupportsOutputParsing` extension interface — but that decision is deferred.

_Qwen dissent_: A reshaped stateful interpreter declared now as an optional extension interface would cost little and give Phase 4 a concrete seam to fill in. Deferring entirely risks Phase 4 accidentally coupling to raw-chunk parsing.

### Q5 — Identity, Registry, and Unknown-Agent Rule

**Ruling: Adapter id IS the persisted value; static compile-time registry for Phase 3 with a future registration seam; unknown-agent rows produce a REFUSED launch with a user-facing error** — unanimous 3-0.

- `sessions.agent` continues to store the adapter `id` directly — no mapping layer. The existing `'claude' | 'codex'` values become the adapter ids.
- Phase 3 ships a `staticRegistry: Record<string, AgentAdapter>` — a frozen record of known adapter instances. The registry is the single source of truth; `AgentKind` becomes a type derived from it (`type AgentKind = keyof typeof staticRegistry`).
- Phase 6 (configurable endpoints) adds a `register(adapter)` function behind the registry for user-defined adapters, but that is a future concern.
- **Unknown-agent rule**: On boot, the restore engine iterates persisted sessions. For each row whose `agent` column does not exist as a key in the registry, the session is marked `failed` with status message `"Unknown agent: <id>"` and the user sees a non-blocking error notification. The app continues; no crash, no data loss.

### Q6 — Option-Fixation Check

**Ruling: None load-bearing** — unanimous 3-0.

The council does not recommend dropping the interface entirely (two CLIs differ on enough dimensions to justify the abstraction), process-shaped adapters (adds a serialization format without clear benefit at two agents; revisit when user-contributed agents are an active use case), or inverting the abstraction (capabilities, auth, and detection are richer than `LaunchSpec → ProcessLaunchRequest` and an interface with minimal methods is strictly more adoptable than none).

---

## The Interface (Verbatim TypeScript, Implementable)

```ts
// ─── Core Interface (always implemented) ───

export interface BaseAgentAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly executionMode: ExecutionMode;

  detectInstallation(signal?: AbortSignal): Promise<InstallationStatus>;
  getAuthMethods(): AuthMethodDefinition[];
  getCapabilities(): AgentCapabilities;
}

export type ExecutionMode = 'pty' | 'api';

// ─── Capability Descriptors ───

export interface AgentCapabilities {
  readonly interactiveTerminal: boolean;
  readonly worktreeSafe: boolean;
  readonly skills: boolean;

  readonly reasoningEffort: EffortDescriptor | null;
  readonly sessionResume: ResumeDescriptor | null;
  readonly subscriptionLogin: boolean;
  readonly apiKey: boolean;
  readonly mcp: McpDescriptor | null;
  readonly hooks: HooksDescriptor | null;
}

export interface EffortDescriptor {
  readonly mode: 'static' | 'dynamic';
  readonly levels: EffortOption[];  // empty until detectInstallation for dynamic
}

export interface EffortOption {
  readonly id: string;
  readonly label: string;
  readonly cliFlag: string;
}

export interface McpDescriptor {
  readonly mode: 'static' | 'dynamic';
  readonly format: 'json' | 'toml' | 'yaml';
  readonly location: 'project' | 'home' | 'custom';
  readonly configPath?: string;  // relative to location root, e.g. '.mcp.json'
}

export interface HooksDescriptor {
  readonly mode: 'static' | 'dynamic';
  readonly mechanism: 'http_listener' | 'script' | 'file_watch';
}

export interface ResumeDescriptor {
  readonly mode: 'static' | 'dynamic';
  readonly cliFlag: string | null;  // e.g. '--resume', or null if not CLI-based
}

// ─── Installation Detection ───

export interface InstallationStatus {
  readonly found: boolean;
  readonly path?: string;
  readonly version?: string;
  readonly authenticated?: boolean;
  readonly capabilities?: Partial<AgentCapabilities>;  // detected overrides
}

export function mergeCapabilities(
  base: AgentCapabilities,
  detected?: Partial<AgentCapabilities>
): AgentCapabilities;

// ─── Auth ───

export interface AuthMethodDefinition {
  readonly type: 'subscription' | 'api_key';
  readonly label: string;
  readonly requiredEnvVar?: string;    // e.g. 'ANTHROPIC_API_KEY'
  readonly helpUrl?: string;
}

// ─── Launch Seam ───

export interface PtyAgentAdapter extends BaseAgentAdapter {
  readonly executionMode: 'pty';

  /** Required env var names this adapter needs beyond the credential. */
  readonly requiredEnvVars: readonly string[];

  buildLaunch(spec: PtyLaunchSpec): PtyLaunchRequest;
  resumeSession?(spec: ResumeSpec): PtyLaunchRequest;
}

export interface PtyLaunchSpec {
  readonly sessionId: string;
  readonly cwd: string;
  readonly modelId?: string;
  readonly effortOptionId?: string;
  readonly credential?: ResolvedCredential;
  readonly signal?: AbortSignal;
}

export interface ResolvedCredential {
  readonly envVarName: string;
  readonly value: string;          // Already decrypted — NEVER log this
  readonly isSecret: true;         // Discriminant for scrubber
}

export interface PtyLaunchRequest {
  readonly executable: string;     // Resolved path
  readonly args: readonly string[];

  /** Non-secret environment variables. Inherits process.env unless credential is present. */
  readonly env: Record<string, string>;

  /** Secret environment entries — scrubber registers exact values, logger redacts. */
  readonly secretEnv: Record<string, string>;

  readonly cols: number;
  readonly rows: number;
  readonly cwd: string;
}

export interface ResumeSpec {
  readonly sessionId: string;
  readonly cwd: string;
}

// ─── API Session (future, declared now) ───

export interface ApiAgentAdapter extends BaseAgentAdapter {
  readonly executionMode: 'api';

  getModels(credential?: ResolvedCredential, signal?: AbortSignal): Promise<ModelInfo[]>;

  startApiSession(
    spec: ApiLaunchSpec,
    signal?: AbortSignal
  ): Promise<ApiSessionHandle>;
}

export interface ApiLaunchSpec {
  readonly sessionId: string;
  readonly modelId: string;
  readonly credential: ResolvedCredential;
  readonly systemPrompt?: string;
  readonly signal?: AbortSignal;
}

export interface ApiSessionHandle {
  readonly sessionId: string;
  send(message: string): Promise<void>;
  receive(): AsyncIterable<string>;
  dispose(): Promise<void>;
}

export interface ModelInfo {
  readonly id: string;
  readonly displayName: string;
  readonly effortOptions: EffortOption[];
  readonly maxTokens?: number;
}

// ─── Extension Interfaces (declared, not implemented in Phase 3) ───

export interface SupportsMcp {
  readonly capabilities: AgentCapabilities & { readonly mcp: McpDescriptor };
  writeMcpConfig(project: Project, servers: McpServer[], signal?: AbortSignal): Promise<void>;
}

export interface SupportsHooks {
  readonly capabilities: AgentCapabilities & { readonly hooks: HooksDescriptor };
  writeHooksConfig(project: Project, listenerUrl: string, signal?: AbortSignal): Promise<void>;
}

export interface SupportsResume {
  readonly capabilities: AgentCapabilities & { readonly sessionResume: ResumeDescriptor };
  resumeSession(spec: ResumeSpec): PtyLaunchRequest;
}

export interface SupportsStateDetection {
  readonly capabilities: AgentCapabilities;
  createOutputInterpreter(): OutputInterpreter;  // Phase 4
}

export interface OutputInterpreter {
  feed(line: string): void;
  readonly state: SessionStatus;
  reset(): void;
}

// ─── Type Guards ───

export function isPtyAdapter(a: BaseAgentAdapter): a is PtyAgentAdapter {
  return a.executionMode === 'pty';
}

export function isApiAdapter(a: BaseAgentAdapter): a is ApiAgentAdapter {
  return a.executionMode === 'api';
}

export function supportsMcp(a: BaseAgentAdapter): a is BaseAgentAdapter & SupportsMcp {
  return a.capabilities.mcp !== null && 'writeMcpConfig' in a;
}

export function supportsHooks(a: BaseAgentAdapter): a is BaseAgentAdapter & SupportsHooks {
  return a.capabilities.hooks !== null && 'writeHooksConfig' in a;
}

// ─── Registry ───

export type AgentAdapter = PtyAgentAdapter | ApiAgentAdapter;

export const staticRegistry: Record<string, AgentAdapter> = {
  claude: claudeAdapter,   // PtyAgentAdapter
  codex: codexAdapter,     // PtyAgentAdapter
} as const;

export type AgentKind = keyof typeof staticRegistry;

export function getAdapter(id: string): AgentAdapter | undefined {
  return staticRegistry[id];
}

export function getAdapterOrThrow(id: string): AgentAdapter {
  const adapter = staticRegistry[id];
  if (!adapter) throw new UnknownAgentError(id);
  return adapter;
}

export class UnknownAgentError extends Error {
  constructor(public readonly agentId: string) {
    super(`Unknown agent: ${agentId}`);
    this.name = 'UnknownAgentError';
  }
}
```

---

## What Phase 3 Implements vs Declares

| Status | Items |
|--------|-------|
| **Implemented now** | `BaseAgentAdapter`, `PtyAgentAdapter`, `AgentCapabilities` (descriptors), `InstallationStatus`, `mergeCapabilities`, `AuthMethodDefinition`, `PtyLaunchSpec`, `PtyLaunchRequest`, `ResolvedCredential`, `staticRegistry`, `AgentKind`, `getAdapter`, `getAdapterOrThrow`, `UnknownAgentError`, type guards for PTY, `claudeAdapter` instance, `codexAdapter` instance |
| **Declared but empty** | `ApiAgentAdapter`, `ApiLaunchSpec`, `ApiSessionHandle`, `ModelInfo`, extension interfaces (`SupportsMcp`, `SupportsHooks`, `SupportsResume`, `SupportsStateDetection`), `OutputInterpreter`, type guards for non-PTY extensions |
| **Deliberately absent** | `detectState(chunk, current)` — removed; Phase 4 introduces `OutputInterpreter` if needed. `writeMcpConfig` and `writeHooks` on the base interface — moved to extension interfaces. `getEffortOptions(modelId)` — effort options live on `ModelInfo` instead |

---

## Risks & Mitigations for the Winner

1. **Extension interface narrowing is unfamiliar to contributors** → Provide a one-file `AdapterAuthoring.md` with the narrowing idiom, the type guards, and a worked example. The idiom is a single `supportsMcp(adapter)` call; keep it simple.

2. **`ApiAgentAdapter` is declared but has zero implementations through Phase 3** → The types are compile-time-only; no runtime code references `ApiAgentAdapter` until Phase 3b. If the shape proves wrong, it can be revised before any adapter implements it, with no migration cost.

3. **Static registry blocks user-defined adapters** → Phase 3's scope is explicitly two PTY agents; the registry is deliberately frozen. Phase 6 adds `register(adapter)` behind a `Map`-backed registry that merges static + runtime entries. The `getAdapter` function signature stays the same.

4. **`requiredEnvVars` is a static array but some adapters may need dynamic env vars based on installation** → If this emerges, `detectInstallation()` can return `requiredEnvVars` in `InstallationStatus`, and `buildLaunch` merges the union of static + detected requirements. The field exists on both types so the seam doesn't change.

5. **Capability descriptors may grow to need nested configuration (e.g. MCP server permission models)** → Descriptors are opaque interfaces today; adding fields is backward-compatible. Adapters that don't support the new field return `undefined`/`null`, and callers check before accessing.

6. **The `OutputInterpreter` abstraction may be entirely wrong for the actual terminal output patterns Phase 4 encounters** → It is deliberately not declared on the core interface; Phase 4 is free to design whatever state machine it needs. The only cost of deferring is the absence of a placeholder.

7. **`mergeCapabilities` must handle partial detection results from a CLI that partially fails probing** → The utility accepts `Partial<AgentCapabilities>` and shallow-merges only defined fields. If a detection probe returns `{ reasoningEffort: null }` (probe determined the CLI lacks it), that overwrites the static default. Null vs undefined is meaningful.

---

## Action Items for Implementation

1. Define the TypeScript types in `src/main/adapters/types.ts` exactly as specced above (core, PTY, capabilities, launch, credential, registry, errors).
2. Create `src/main/adapters/registry.ts` with `staticRegistry`, `getAdapter`, `getAdapterOrThrow`, and `AgentKind` derived from registry keys.
3. Create `src/main/adapters/capabilities.ts` with `mergeCapabilities(base, detected)`.
4. Create `src/main/adapters/claude.ts` implementing `PtyAgentAdapter` for Claude Code — extract argv/env from current `resolveCli` + hardcoded knowledge.
5. Create `src/main/adapters/codex.ts` implementing `PtyAgentAdapter` for Codex CLI — same extraction pattern.
6. Update `cliDetect.ts` so `detectClis()` delegates to `adapter.detectInstallation()` for agent entries (leave git/docker/node on existing probe path).
7. Update `SessionManager` to use `getAdapter(session.agent)?.buildLaunch(spec)` instead of `resolveCli(agent)` + inline `pty.spawn`. The no-credential path must remain first-class (credential is optional on `PtyLaunchSpec`).
8. Replace all uses of the string-literal `AgentKind` type with the registry-derived type; remove the hardcoded `AGENT_KINDS` array and `labels` record.
9. Implement the unknown-agent boot rule: iterate persisted sessions, mark unknown as failed with error message, surface non-blocking notification.
10. Add adapter-level unit tests: each adapter's `buildLaunch` produces correct argv/env for its CLI; `mergeCapabilities` handles null/undefined/partial correctly.
11. Run the full 142-test suite and confirm behavior-neutral refactor (launch, attach, restart, restore identical).
12. Create `docs/Features/Foundation/AdapterAuthoring.md` with the narrowing idiom, extension interface pattern, and a worked example.
