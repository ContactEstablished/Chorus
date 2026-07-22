# Council Brief CR-3.1 — The `AgentAdapter` Interface Shape for Chorus

_Issued 2026-07-21 · §3 amended 2026-07-22 with the D33 seam facts · Status: **CLOSED — findings filed 2026-07-22 (`CouncilBrief-3.1-AdapterInterface-Findings.md`), recorded as D34 with coordinator resolutions (a)–(f), Matthew-ratified** · Decision owner: Matthew Wilson · Recorder: Claude (roadmap §6)_

You are a review council of independent LLM models. Deliberate on the decision below and return findings in the **Required Output Format** at the end. You have no other context on this project — everything you need is in this document. Where you are uncertain about an external fact (a CLI's actual flags, a provider's API shape), **say so explicitly rather than guessing**; the implementer re-verifies every such fact against the tool's own `--help` before coding.

---

## 1. What Chorus is

Chorus is a local-first Windows desktop app (Electron 43 + Vue 3 + TypeScript + Vite + Pinia) for running multiple AI coding agents in parallel terminal panes. Each pane hosts an xterm.js terminal attached over typed IPC to a PTY session (node-pty/ConPTY) owned by the Electron **main** process. Today it runs two real interactive CLI TUIs: Claude Code (`claude.exe` 2.1.215) and Codex CLI (`codex` 0.144.6, an npm `.cmd` shim spawned through `cmd.exe /c`).

Locked rules (not up for review): sessions live in main, owned by `SessionManager`; the renderer never spawns processes and never resolves executables; all Zod validation in main only; the preload is a narrow, Zod-free typed forwarder; IPC payloads are plain objects; SQLite with hand-rolled versioned migrations; **capabilities, not provider names** — the UI must be driven by declared capability data, never by `if (agent === 'claude')`.

## 2. Why this decision exists now

Since Phase 0, "which agent" has been a **two-value string enum** — `'claude' | 'codex'` — threaded through the IPC schemas, the `sessions.agent` column, the launch dialog's hardcoded label map, and a single `resolveCli(agent)` call that locates the executable on `PATH` and hands it to `pty.spawn`. That was correct for two hardcoded CLIs and is now the ceiling.

Phase 3 introduces the first real abstraction: an **`AgentAdapter`** interface with declared capabilities, so that adding Gemini CLI, Aider, OpenCode, Ollama, or a direct-API chat session is an adapter, not a series of conditionals scattered across the launch dialog, the IPC layer, and the session manager.

This council is the phase's **pre-identified interface checkpoint**, and it is a checkpoint precisely because the interface is hard to reverse: every later phase builds on it. Phase 3a puts model catalogs, effort normalization, and launch profiles on top of it. Phase 3b (a native multi-model council review feature) runs its members through it in API mode. Phase 4 feeds an append-only event bus from its state detection. Phase 6 writes MCP configuration through it. Getting the shape wrong is a refactor across five phases; getting it over-elaborate is dead weight carried through all of them.

## 3. Current implementation state (verified 2026-07-21, commit `04a8a0d`)

- **No adapter layer exists.** There is no `adapters/` directory, no interface, no registry.
- **`AgentKind`** is `z.enum(['claude','codex'])` in the shared IPC module. It appears in the attach/launch/restart request and response schemas, in the persisted `sessions.agent` column, in the session manager's internal map, in the launch dialog's `labels` record and `AGENT_KINDS` array, and in the command palette.
- **CLI resolution** (`cliDetect.ts`): `resolveCli(name)` runs `where.exe`, prefers a real `.exe`, falls back to `cmd.exe /c <shim>` for npm `.cmd`/`.bat` shims, and throws a user-facing message when nothing spawnable is found. A memoized `detectClis()` probes a flat list — `['claude','codex','git','docker','node']` — running `<tool> --version` with a 10 s timeout, returning `{name, found, path, version}`. **Note that agent CLIs and supporting tools (git/docker/node) currently share one probe path**; only the agents belong behind an adapter.
- **Spawn** (`sessionManager.ts`): `resolveCli(agent)` → `pty.spawn(cli.file, cli.args, { name: 'xterm-256color', cols: 80, rows: 24, cwd, env: process.env, useConpty: true })`. No arguments beyond the shim path are passed today — no model flag, no effort flag, no permission mode.
- **Session lifecycle already settled** (not up for review): a session is a stable database row id; the PTY is ephemeral and re-created under the same id by restart and by a boot restore engine. Attach is a pure view binding with no spawn path. Status is a two-value `'running' | 'exited'` derived from process liveness and exit codes.
- **Immediately before this task**, a credential vault lands. Its own council (CR-3.0) has already ruled — see the subsection below, whose outcomes are **constraints on your answers, not open questions**.
- **Immediately after this task**, that injection is wired through the adapter, and a settings view configures providers and credentials.

### CR-3.0 outcomes that bind this interface (vault council — findings `CouncilBrief-3.0-Vault-Findings.md`, filed 2026-07-22 → D33)

The vault council ran first. Four of its rulings are load-bearing facts for YOUR questions:

1. **BYOK launches construct an allow-list environment; adapters DECLARE their required env vars.** A launch carrying a credential profile does **not** inherit `process.env` wholesale: main builds a clean environment — a baseline of Windows system variables, plus the injected key, plus **variables the adapter declares it needs**. The interface must therefore give an adapter a place to make that declaration (weigh it in Q1 and Q3 — is it static data, or per-installation?). A launch with **no** credential profile inherits the environment wholesale, exactly as today — the no-credential path is first-class, so whatever carries the credential into `buildLaunch` must be **optional**.
2. **The injected variable's NAME has two candidate homes — rule on the split.** The vault schema sketch puts an `env_var_name` column on `provider_configs`, while the natural reading of `buildLaunch` is that the adapter knows its own CLI's conventions (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). Decide where that knowledge lives: adapter code, provider-config data, or adapter default with config override. A wrong split forces either an adapter edit for every custom OpenAI-compatible endpoint, or a config row that can silently override an adapter's own correctness.
3. **The launch seam must expose which values are SECRET.** Main runs a per-session PTY scrubber that exact-matches injected key values in terminal output (CR-3.0 majority ruling, dissent preserved), and the logger redacts credential-bearing fields wholesale. Whatever shape `ProcessLaunchRequest` takes, main must be able to distinguish ordinary env entries from secret ones — e.g. a separate `secretEnv` map, or a list of secret keys — so the scrubber can register the exact values and no generic code path ever logs them.
4. **Keys travel in env, never argv** (reaffirmed unanimously), and **a decrypt failure REFUSES the launch upstream** rather than degrading to no-key — so `buildLaunch` is never asked to improvise around a missing credential: either a resolved credential arrives, or the launch was already refused before the adapter was consulted.

## 4. What the master plan already sketches

The project's plan document proposes this interface. **It is a sketch, not a ratified decision** — you are being asked whether to adopt it, trim it, or restructure it.

```ts
export interface AgentAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly executionMode: 'pty' | 'api';

  detectInstallation(): Promise<InstallationStatus>;        // found? version? authed?
  getAuthMethods(): AuthMethodDefinition[];                 // subscription | api_key
  getModels(cred?: CredentialProfile): Promise<ModelInfo[]>; // static or live
  getEffortOptions(modelId: string): EffortOption[];
  getCapabilities(): AgentCapabilities;

  buildLaunch(spec: LaunchSpec): ProcessLaunchRequest;      // pty mode
  startApiSession?(spec: LaunchSpec): ApiSessionHandle;     // api mode
  resumeSession?(spec: ResumeSpec): ProcessLaunchRequest;   // e.g. claude --resume
  detectState(chunk: string, current: SessionState): SessionState;
  writeMcpConfig?(project: Project, servers: McpServer[]): void;
  writeHooks?(project: Project, listenerUrl: string): void; // Claude Code only
}

interface AgentCapabilities {
  interactiveTerminal: boolean; sessionResume: boolean;
  reasoningEffort: boolean; subscriptionLogin: boolean; apiKey: boolean;
  mcp: boolean; hooks: boolean; skills: boolean; worktreeSafe: boolean;
}
```

**Phase 3 will implement only a subset**: installation detection, auth methods, capabilities, and `buildLaunch` for the two existing PTY agents. Model listing shrinks to a single "test this key" probe; effort options, API sessions, resume, MCP, and hooks are all later phases. The question is what the *interface* should declare now, given that only part of it gets a body.

## 5. The decision

**What is the right shape for the `AgentAdapter` interface and its capability model, given that Phase 3 implements only PTY launch for two agents but Phases 3a/3b/4/6 build model selection, API-mode council members, an event bus, and MCP wiring on top of it?**

### Q1 — Interface surface: declare it all now, or grow it?

- **Option A — adopt the sketch as-is.** Every method declared now, optional ones (`?`) left unimplemented. One place to look; later phases fill in bodies without touching the contract. Weakness: five phases of speculative signatures written before their requirements are understood, and an optional method is a lie the type system cannot check — callers must handle `undefined` everywhere.
- **Option B — minimal core now, extend per phase.** Declare only what Phase 3 uses (`id`, `displayName`, `executionMode`, `detectInstallation`, `getAuthMethods`, `getCapabilities`, `buildLaunch`). Later phases widen the interface as their needs become concrete. Weakness: the interface churns, and every widening touches every adapter.
- **Option C — narrow core + capability-gated extension interfaces.** A small always-implemented core, plus separate optional interfaces (`SupportsMcp`, `SupportsHooks`, `SupportsResume`, `SupportsApiMode`) that an adapter implements and a caller narrows to. Capabilities become type-level facts rather than booleans a caller must trust. Weakness: more type machinery; contributors must learn the narrowing idiom.

### Q2 — The PTY/API execution split

Chorus will eventually run two fundamentally different execution modes behind one concept: an interactive terminal process, and a streaming API chat session with no PTY at all. The sketch handles this with an `executionMode` discriminator plus two optional methods (`buildLaunch`, `startApiSession`).

Is one interface with a discriminator right, or should these be **two interfaces in a discriminated union** (`PtyAgentAdapter | ApiAgentAdapter`) so the compiler can guarantee that a PTY code path never receives an API adapter? Consider that Phase 3b needs 3–5 API-mode council members running *concurrently with* PTY agents in the same app, and that `SessionManager` — which owns PTY handles, ring buffers, and exit codes — would need a parallel concept for API sessions either way. State where the union boundary should sit: at the adapter, at the session, or at both.

### Q3 — Capability granularity: are booleans enough?

The sketched `AgentCapabilities` is a flat bag of nine booleans, and the project's stated principle is that the UI renders from capabilities and never from provider names.

- Do booleans carry enough information to actually drive a UI? Consider `reasoningEffort: boolean` — the launch dialog needs to know *which* effort levels exist and what they map to, not merely that the concept applies. Consider `mcp: true` when one agent takes a project-level JSON file and another takes a TOML section in a home-directory config; a boolean tells a caller nothing it can act on.
- Should capabilities instead be **descriptors** (`reasoningEffort: EffortOption[] | null`, `mcp: McpConfigStrategy | null`), so "supported" and "how" are the same fact and cannot drift apart?
- Which capabilities are **static per adapter** versus **dynamic per installation** (a CLI's newer version may gain a feature; a subscription-only install cannot use api-key auth)? The sketch has `getCapabilities()` returning statically while `detectInstallation()` reports version and auth state separately. Should capabilities take the detected installation as input?

### Q4 — `detectState(chunk, current)`: right shape, right place, right time?

The sketch has each adapter classify session state by inspecting raw PTY output chunks — for approval prompts, input waits, idle, completion — feeding a `SessionStatus` state machine (`created | preparing | starting | running | waiting-for-user | waiting-for-permission | idle | completed | failed | stopped | archived`) and an append-only event bus in Phase 4.

Chorus's real experience with terminal output argues for caution: the agents emit ANSI alt-screen TUIs that repaint continuously, one of them animates a spinner in its terminal title roughly once a second, and PTY data arrives in arbitrary chunks that split escape sequences and even words. A stateless `(chunk, current) => next` function sees none of that context.

Rule on: whether output-derived state belongs in the adapter interface at all right now; if yes, whether the signature should be chunk-based or given a buffered view; and whether **declaring it in Phase 3 without implementing it** is better or worse than leaving it out until Phase 4 has real hook data to compare against. (Phase 4's plan explicitly ranks detection tiers: agent-native hooks first, process exit second, output heuristics *last and low-confidence*.)

### Q5 — Identity, registry, and the persisted enum

`sessions.agent` persists `'claude' | 'codex'` in the database, and the same two-value enum validates every IPC payload. Phase 3 deliberately keeps that wire vocabulary unchanged to avoid a migration.

- Should the adapter `id` **be** that string (so the registry is keyed by the persisted value), or should adapters carry richer ids with a mapping layer?
- Is a **static compile-time registry** right (a frozen record of adapter instances), or should it support registration at runtime (needed eventually for user-defined OpenAI-compatible endpoints and Phase 3b's configurable council members, which are *provider* configurations rather than new agent binaries — say whether those are adapters at all, or configuration *of* one generic adapter)?
- What happens when a persisted session row names an agent whose adapter no longer exists (removed, renamed, or a database from a newer version)? The restore engine reads these rows at every boot and must not crash.

### Q6 — Option-fixation check

Is there a failure mode above that should force a different shape entirely? Named candidates, only if load-bearing: **no interface at all** (a data-driven descriptor table plus a couple of pure functions, on the grounds that two PTY CLIs differ only in argv and env and an interface is premature ceremony); **process-shaped adapters** (each adapter is a manifest file rather than TypeScript, enabling user-contributed agents without recompiling); or **inverting the abstraction** so the seam is `LaunchSpec → ProcessLaunchRequest` as a pure function and everything else stays plain data. Name one only if you would actually argue for it.

## 6. Constraints the winner must survive

1. **Phase 3 is a behavior-neutral refactor.** After the adapter lands, both agents must launch, attach, restart, and restore *exactly* as before; the detection channel returns the same shape; the existing 142-test suite stays green. The interface must be adoptable without changing what the app does.
2. **Capabilities, not provider names** (locked principle). After this task, no UI code may branch on the agent's identity string. If your shape cannot deliver that, say so.
3. **The renderer never resolves executables or spawns.** `buildLaunch` runs in main and produces a request main executes; nothing about the interface may leak process-launching ability toward the renderer.
4. **The credential seam.** `buildLaunch` receives a resolved credential **optionally** — the no-credential path is first-class — and must place it in the child's **environment**, never in arguments, with secret entries distinguishable from ordinary ones and required env vars declarable by the adapter (the CR-3.0 outcomes in §3 — those rulings are fixed). The interface should make the wrong thing hard to write.
5. **No new dependencies.** One is already approved this phase (a logger); the adapter layer adds none.
6. **Windows-only v1**, with a per-profile WSL2 runtime contemplated later — the interface should not assume a native Windows path forever, but need not implement WSL now.
7. **Bounded implementation.** One task in a five-task phase. Prefer a shape an implementer can land and a reviewer can check in a single session; a beautiful interface that takes three sessions to adopt is a worse answer than a plain one that lands.

## 7. Evaluation rubric (weigh in this order)

1. **Correctness of the seam** — the interface cuts the system where it actually varies (argv, env, auth, detection), so future agents drop in without touching call sites (30%).
2. **Forward compatibility without speculation** — it survives API-mode council members, effort/model selection, an event bus, and MCP wiring **without** carrying five phases of guessed signatures (25%).
3. **Type-level honesty** — capability claims cannot silently drift from behavior; optional methods do not become runtime landmines (20%).
4. **Adoptability in one session** — the refactor is behavior-neutral and reviewable (15%).
5. **Simplicity** — a contributor can add an adapter by reading one file (10%).

## 8. Questions for the council

1. Q1: A, B, C, or a named hybrid — with the **exact interface you would write today**, in TypeScript, and the strongest argument against it.
2. Q2: one interface with a discriminator vs a union — and where the PTY/API boundary sits (adapter, session, or both).
3. Q3: booleans vs descriptors, plus the static-vs-per-installation ruling.
4. Q4: a ruling on `detectState` — in, out, or reshaped — with the signature if in.
5. Q5: adapter identity, registry shape, and the unknown-agent-row rule.
6. Q6 as posed: load-bearing alternative shapes only.

## 9. Success criteria for this council session

The council **succeeds** if it returns: (a) one committed answer per question Q1–Q5, or an explicit tie with the tie-breaker named; (b) **the interface written out as TypeScript an implementer can paste and fill in**, including the capability type; (c) an enumerated risk list with mitigations; (d) explicit dissents preserved — do not average away disagreement. The council **fails** if it returns a survey without commitment, if it produces an interface no one could adopt in one session, or if it achieves unanimity by dropping the rubric.

## 10. Required output format

```
## Per-model positions
<model>: Q1 <choice> / Q2 <discriminator|union + boundary> / Q3 <booleans|descriptors> / Q4 <in|out|reshaped> / Q5 <one-line rule> — <2-4 sentence rationale> — Strongest counterargument: <1-2 sentences>

## Council synthesis
Q1: <A|B|C|hybrid(named)> (<unanimous | majority N-of-M>)
Q2: <ruling + where the boundary sits, 2-4 sentences> (<vote>)
Q3: <ruling + static-vs-per-installation, 2-4 sentences> (<vote>)
Q4: <detectState ruling + signature if in, 2-4 sentences> (<vote>)
Q5: <identity + registry + unknown-row rule, 2-4 sentences> (<vote>)
Dissents: <model: position and unresolved reason, or "none">

## The interface (verbatim TypeScript, implementable)
```ts
<the full interface + capability type as you would have it written today>
```

## What Phase 3 implements vs declares
<short list: implemented now / declared but empty / deliberately absent>

## Risks & mitigations for the winner
1. <risk> → <mitigation>
...

## Answer to question 6
<concise; "none load-bearing" is acceptable>

## Action items for implementation
<numbered, imperative, each verifiable>
```
