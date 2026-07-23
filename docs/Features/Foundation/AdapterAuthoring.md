# Authoring an Agent Adapter

_How to add an agent to Chorus's adapter surface (`src/main/adapters/`), Phase 3 edition. The contract is D34 (roadmap §6); the normative interface text is `ImplementationSpec-3-3.md` §2. This page is CR-3.1 action item 12: the minimum a new author needs so the type system helps instead of surprises._

## The shape in one paragraph

Every adapter implements `BaseAgentAdapter` (`id`, `displayName`, `executionMode`, `detectInstallation`, `getAuthMethods`, `getCapabilities`) plus exactly one side of the `PtyAgentAdapter | ApiAgentAdapter` union. Domain concerns (MCP, hooks, resume) live on **extension interfaces** (`SupportsMcp`, `SupportsHooks`, `SupportsResume`) that an adapter implements *additionally* — and a caller can only reach those methods through a **type guard**. That is D34 Q1: *supported* and *implemented* are the same fact at the call site, enforced by the compiler, not by convention.

## The narrowing idiom, in three lines

```ts
if (supportsMcp(adapter)) {
  await adapter.writeMcpConfig(project, servers)
}
```

Inside the block, `adapter` is narrowed to `BaseAgentAdapter & SupportsMcp`, so `writeMcpConfig` typechecks. Outside it, the method does not exist on the type. Never call an extension method without narrowing first, and never cast around the guard.

## Why the guard checks BOTH halves

Each capability guard tests two things:

1. the adapter's **descriptor** for that capability is non-null (`getCapabilities().mcp !== null`), and
2. the **method** is actually present (`typeof a.writeMcpConfig === 'function'`).

Either half alone lies. A descriptor without a method is a promise nobody keeps; a method with a `null` descriptor is a capability the rest of the app (capability merging, the `adapter:list` wire shape, the future Settings UI) cannot see. Declaring one without the other narrows the guard to `false`, and the **capability-honesty test** in `adapters.test.ts` fails — that failure is the mechanism working, not a nuisance. If you add a descriptor, implement the method in the same change; if you remove the method, null the descriptor.

## Worked example

A minimal fictional PTY adapter with one capability (MCP) and its extension interface. **This exact code was compiled against the shipped types** (`npm run typecheck`, zero errors) before this page was written.

```ts
import { probeCli, resolveCli } from '../services/cliDetect'
import { buildSecretEnv } from './capabilities'
import type {
  AgentCapabilities,
  AuthMethodDefinition,
  InstallationStatus,
  PtyAgentAdapter,
  PtyLaunchRequest,
  PtyLaunchSpec
} from './types'
import { supportsMcp, type AgentAdapter, type McpServerRef, type SupportsMcp } from './types'
import type { Project } from '../../shared/ipc'

export const exampleAdapter: PtyAgentAdapter & SupportsMcp = {
  id: 'example',
  displayName: 'Example CLI',
  executionMode: 'pty',
  requiredEnvVars: [],

  async detectInstallation(): Promise<InstallationStatus> {
    return probeCli(this.id)
  },

  getAuthMethods(): readonly AuthMethodDefinition[] {
    return [
      { type: 'subscription', label: 'Example account login', requiredEnvVar: null, helpUrl: null },
      { type: 'api_key', label: 'Example API key', requiredEnvVar: 'EXAMPLE_API_KEY', helpUrl: null }
    ]
  },

  getCapabilities(): AgentCapabilities {
    return {
      interactiveTerminal: true,
      worktreeSafe: true,
      skills: false,
      subscriptionLogin: true,
      apiKey: true,
      reasoningEffort: null,
      sessionResume: null,
      mcp: { mode: 'static', format: 'json', location: 'project', configPath: '.example-mcp.json' },
      hooks: null
    }
  },

  buildLaunch(spec: PtyLaunchSpec): PtyLaunchRequest {
    const cli = resolveCli(this.id)
    return {
      executable: cli.file,
      args: cli.args,
      cwd: spec.cwd,
      envAdditions: {},
      secretEnv: buildSecretEnv(spec.credential)
    }
  },

  async writeMcpConfig(_project: Project, servers: readonly McpServerRef[]): Promise<void> {
    // Write `.example-mcp.json` at the project root here — the SAME fact the
    // mcp descriptor above declares.
    void servers
  }
}

// The call site narrows before it calls:
export async function configureMcp(adapter: AgentAdapter, project: Project): Promise<void> {
  if (supportsMcp(adapter)) {
    await adapter.writeMcpConfig(project, [{ name: 'docs', command: 'npx', args: ['-y', '@example/mcp'] }])
  }
}
```

Notes on the example:

- **`buildLaunch` is synchronous and must stay so** — `SessionManager.launch()` returns a snapshot synchronously.
- **`buildLaunch` contributes `envAdditions` + `secretEnv`, never a full environment.** Env policy has exactly one owner, main (D34(d)). A credential's value goes to `secretEnv` via the shared `buildSecretEnv` helper — never to `envAdditions`, so the non-secret half of a launch request can never carry key material.
- **`detectInstallation` shares `probeCli`** from `cliDetect.ts` — one probe implementation, not a per-adapter copy that drifts.
- **The descriptor says where, not whether.** `mcp: true` would tell a caller nothing actionable; `{format: 'json', location: 'project', configPath: '.example-mcp.json'}` tells it what to write and where (D34 Q3: descriptors over booleans).
- Register the instance in `registry.ts`'s `staticRegistry`. The registry is typed `Record<AgentKind, AgentAdapter>`, so adding a wire kind without a registry entry (or vice versa) is a **compile error** — that is D34(b) working.

## Declared but NOT implemented in Phase 3

Do not write code against these expecting them to exist at runtime:

- **`ApiAgentAdapter` and everything API-side** — `ApiLaunchSpec`, `ApiSessionHandle`, `ModelInfo`, `startApiSession`, `getModels`, `isApiAdapter` narrowing to anything real. Zero instances exist; the session layer is PTY-only.
- **`SupportsMcp` / `SupportsHooks` / `SupportsResume` methods** — the interfaces exist; no shipped adapter implements them (MCP is Phase 6, hooks Phase 4, resume Phase 4+).
- **`InstallationStatus.capabilities` / `requiredEnvVars`** — the dynamic-override seams; no probe populates them yet.
- **`InstallationStatus.authenticated`** — deliberately unset; probing auth runs a real CLI command.
- **`PtyLaunchSpec.credential`, `modelId`, `effortOptionId`** — `credential` arrives in Task 3-6; model/effort are Phase 3a.
- **`PtyLaunchRequest.envAdditions` / `secretEnv`** — both `{}` from both shipped adapters and **not merged** into the spawn env by `SessionManager`; declared and inert until 3-6.
- **Registry mutation** — `staticRegistry` is frozen; `register()` is Phase 6.

## The `null` vs `undefined` rule for `mergeCapabilities`

`mergeCapabilities(staticCaps, detectedCaps)` merges a probe's overrides over the static declaration, and the two "empty" values are **different facts** (CR-3.1 risk 7):

- `undefined` — *not probed*: keep the static value.
- `null` — *probed, and determined ABSENT*: override the static value, even over a non-null descriptor.

So a probe result must only carry keys it actually determined. `{ mcp: null }` says "this installation cannot do MCP"; `{}` says "I didn't look". Never write a key you did not determine, and never read a merged capability without remembering which of the three states (declared / determined-absent / not-probed) produced it.
