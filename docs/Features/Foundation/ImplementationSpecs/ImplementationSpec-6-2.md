# ImplementationSpec 6-2 — MCP Capability Honesty and codex Wiring

**Normative for:** [`../Tasks/Task-6-2.md`](../Tasks/Task-6-2.md). **Design input:
[`../Phase-6-MemoryPlan.md`](../Phase-6-MemoryPlan.md) §2 and §3.**

## 1. `McpMechanism` — the discriminant

**The defect (plan §3.1):** `McpDescriptor` at `types.ts:88` assumes every adapter writes a file. The
only shape that fits codex is `{format:'toml', location:'home', configPath:'.codex/config.toml'}` —
**so the type's own vocabulary names the file D49 forbids writing.** An implementer following the
types is being nudged into the violation.

Replace with a discriminated union. `format` / `location` / `configPath` exist **only** on the file
variants:

```ts
export type McpMechanism = 'launch-args' | 'project-file' | 'env-named-file'

/** ⚠ A DISCRIMINATED UNION, AND THE DISCRIMINANT IS LOAD-BEARING RATHER THAN
 *  DESCRIPTIVE. The previous shape could only describe adapters that write a
 *  FILE, so codex's per-launch argv mechanism was not expressible — and the one
 *  shape that fit it named `.codex/config.toml`, the file D49 forbids. A
 *  `launch-args` adapter now has NO `configPath` field to fill in, which is the
 *  type doing the work a comment was doing badly. */
export type McpDescriptor =
  | { readonly mode: DescriptorMode; readonly mechanism: 'launch-args' }
  | {
      readonly mode: DescriptorMode
      readonly mechanism: 'project-file' | 'env-named-file'
      readonly format: 'json' | 'toml' | 'yaml'
      readonly location: 'project' | 'home' | 'custom'
      /** Relative to the location root, e.g. '.mcp.json'. */
      readonly configPath: string
      /** `env-named-file` only: the env var that names the file (opencode's
       *  `OPENCODE_CONFIG`). */
      readonly pathEnvVar?: string
    }
```

**⚠ `configPath` becomes non-nullable on the file variants.** It was `string | null` because
`launch-args` had nowhere else to live; with the discriminant, a null path on a file mechanism is
meaningless. **A file adapter that cannot name its file is a bug, and the type should say so.**

## 2. `McpServerRef.env` — the mechanism that was untypeable

**The defect (plan §3.2):** `{name, command, args}` has no `env`, so **the entire recommended
security mechanism cannot be expressed.**

```ts
export interface McpServerRef {
  readonly name: string
  readonly command: string
  readonly args: readonly string[]
  /**
   * ⚠ VALUES ARE PLACEHOLDERS, NEVER SECRETS — `${NEO4J_PASSWORD}` for claude,
   * `{env:NEO4J_PASSWORD}` for opencode. A real value here is the D49/D93
   * violation this field exists to make unnecessary, and
   * `assertNoSecretInRendered` refuses the write if one appears.
   */
  readonly env?: Readonly<Record<string, string>>
  /** codex's `env_vars`: names to pass through from the parent environment, with
   *  no value travelling at all. The strongest of the three mechanisms. */
  readonly envPassthrough?: readonly string[]
}
```

**Do not add a `password` or `value` field in any form.** The comment above is load-bearing; keep it.

## 3. `writeMcpConfig` returns a result, and argv gets a sibling

**The defect (plan §3.3):** `Promise<void>` at `types.ts:344` has no refusal channel, contrary to the
house `{ok:false, reason}` idiom — **and there is nothing to *write* for codex at all.**

```ts
export type McpWriteResult =
  | { readonly ok: true; readonly path: string; readonly serversWritten: number }
  | { readonly ok: false; readonly reason: string }

export interface SupportsMcp {
  /** ⚠ REFUSES RATHER THAN THROWS, and `assertNoSecretInRendered` is what makes
   *  the refusal mandatory rather than polite. */
  writeMcpConfig(
    project: Project,
    servers: readonly McpServerRef[],
    signal?: AbortSignal
  ): Promise<McpWriteResult>
  /** The argv mechanism. Pure, synchronous, writes nothing — which is why
   *  codex can implement MCP support in a commit that touches no filesystem. */
  mcpLaunchArgs(servers: readonly McpServerRef[]): readonly string[]
}
```

**⚠ BOTH MEMBERS ARE REQUIRED, AND THAT IS DELIBERATE.** A file adapter's `mcpLaunchArgs` returns
`[]`; an argv adapter's `writeMcpConfig` returns `{ok:false, reason:'codex is configured by launch
arguments, not by a file.'}`. **The alternative — optional members — reintroduces the
declared-but-not-implemented hole `supportsMcp` exists to close**, and `types.ts:383`'s guard checks
`writeMcpConfig` specifically.

**⚠ `supportsMcp` MUST BE WIDENED TO CHECK BOTH METHODS**, or an adapter implementing only
`mcpLaunchArgs` narrows to `false` while genuinely supporting MCP.

## 4. `mcpConfigCore.ts` — the security core

**Pure. No `fs`, no `electron`, no adapters imported for their side effects.** Per plan §9: *"logic
that is not in a pure core is logic that cannot be tested."*

Exports:

```ts
/** Render a file-mechanism config to the exact bytes that would be written. */
export function renderMcpConfig(
  descriptor: Extract<McpDescriptor, { mechanism: 'project-file' | 'env-named-file' }>,
  servers: readonly McpServerRef[]
): string

/** The argv tokens for a launch-args mechanism. */
export function renderMcpLaunchArgs(servers: readonly McpServerRef[]): readonly string[]

/**
 * ⚠ THE GUARD. Runs over the RENDERED BYTES — not the inputs, not the intent.
 * Returns a refusal reason, or null when clean.
 */
export function assertNoSecretInRendered(
  rendered: string,
  knownSecrets: readonly string[]
): string | null
```

**⚠ "RENDERED BYTES" IS THE INVARIANT AND IT IS EASY TO GET SUBTLY WRONG.** Check the **output
string**, after `JSON.stringify` and after any escaping — not the `McpServerRef` objects that produced
it. A secret that survives an escaping transform into the file is still in the file. Precedent:
`headersContainSecret` (`src/main/ipc.ts:252`) checks the JSON it is handed.

Reuse `scrubber.ts` + `secret-patterns.json` for the shape-based half; the exact-value half is a
substring check against `knownSecrets`. **Both, not either** — 6-1's own brief will note that the
pattern list cannot recognise a credential that looks like prose.

**Empty `knownSecrets` must not make the guard vacuous.** The pattern half still runs. Assert that.

## 5. codex's descriptor and its argv

`codex.ts:77` becomes:

```ts
mcp: { mode: 'static', mechanism: 'launch-args' },
```

**⚠ `mode` IS `DescriptorMode = 'static' | 'dynamic'` (`types.ts:56`), NOT a support flag.** `'static'`
is correct here and means *"this descriptor is known ahead of time rather than probed"* — the same
value `CODEX_EFFORT` carries at `codex.ts:182`. **Support is expressed by the descriptor being
non-null plus the methods existing** (`types.ts:383`); a `mode: 'supported'` would be inventing a
third value into a closed union.

`mcpLaunchArgs` emits, per server, exactly:

```
-c mcp_servers.<name>.command="<command>"
-c mcp_servers.<name>.args=["<a>","<b>"]
-c mcp_servers.<name>.env_vars=["NEO4J_PASSWORD"]
```

**⚠ NEVER `-c mcp_servers.<name>.env=…` WITH A VALUE.** `env_vars` passes **names**; the value comes
from the process environment `composeChildEnv` built. This is the same class of fact D47/D49 already
ratified for `model_providers.<key>.env_key` — **a name in argv, not a value** — and H1 (argv is
world-readable, `types.ts:174`) is therefore **no widening over the line codex already emits.** Say
that explicitly in the commit rather than leaving it to be re-derived.

**Follow `buildLaunch`'s existing `-c` idiom exactly** — the D47 route already emits these tokens, so
match its quoting rather than inventing a second convention. **Read that code before writing this.**

**`writeMcpConfig` returns the structured refusal** quoted in §3. It is not a throw and not a no-op:
a caller that reaches it has made a category error and deserves a reason.

## 6. The capability test — widen first, then split

**⚠ THE PLAN'S §3 INSTRUCTION CANNOT BE FOLLOWED AS WRITTEN.** It proposes the table
`{claude:true, codex:true, opencode:true, kimi:false, none:false}` — but `adapters.test.ts:41` is:

```ts
const adapters: readonly PtyAgentAdapter[] = [claudeAdapter, codexAdapter]
```

**Three of those five keys name adapters the loops never iterate.** kimi and opencode arrived in
Phase 3d (D86, D90); both are imported and individually tested in the same file, and **neither has
ever been through capability honesty.**

**Order matters:**

1. **Widen the list to all five** — claude, codex, kimi, opencode, noHarness. Note the type: the
   list is `readonly PtyAgentAdapter[]` and `noHarness` may not be one; use the narrowest type that
   admits all five rather than casting.
2. **Keep `supportsHooks` and `supportsResume` blanket-false** for all five. They are still
   unimplemented, and blanket-false over a wider list is strictly stronger.
3. **Replace only the mcp arm** with an explicit table:

```ts
const MCP_SUPPORT: Readonly<Record<string, boolean>> = {
  claude: false,   // Stage 4 (Task 6-5)
  codex: true,     // Stage 1 — argv, writes nothing
  opencode: false, // Stage 4 (Task 6-5)
  kimi: false,     // plan §10: no evidence of env interpolation. NOT an oversight.
  none: false      // no harness, no MCP
}
```

**⚠ THE TABLE'S PURPOSE IS TO FORCE A FUTURE ADAPTER TO DECIDE** rather than inherit an answer from a
blanket assertion. Assert that **every** adapter id has a key — a missing key must fail, not default.

4. **The generic declared-iff-implemented case at `:515` stays BYTE-IDENTICAL.** It has been vacuous
   since Phase 3 because every descriptor was null. It now does real work **for five adapters for the
   first time** — which is a stronger claim than the plan's *"starts doing real work"*, and worth
   stating in the report.

## 7. `secret-grep.mjs`'s scope comment

**Comment only — do not change what it scans.** Add, in its own words:

> ⚠ CLI CONFIG FILES ARE OUTSIDE THIS GATE'S REACH. It scans `src/`, `scripts/`, `_verify/`,
> `package.json` and root configs — **not** `~/.codex/`, not `~/.claude/`, not a project's
> `.mcp.json`, not `%APPDATA%\chorus\mcp\`. From Phase 6 Stage 2 onward the app writes files in
> those places, and **`assertNoSecretInRendered` is what covers them.** A gate believed to cover
> more than it does is worse than one that states its limit.

## 8. Verification

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
git diff --stat -- package.json package-lock.json          # EMPTY
grep -rn "writeFile\|writeFileSync\|rename\|mkdir" src/main/adapters/   # no new write
```

**Runtime (G2): launch a real codex session with an MCP server ref present** and confirm from the
pane that codex started and the argv reached it (`codex mcp list` inside the session, or the probe
form 6-1 established). **⚠ Then confirm `~/.codex/config.toml` is byte-identical before and after —
hash it.** That file staying untouched is this stage's entire claim, and it is cheap to check and
expensive to assume.
