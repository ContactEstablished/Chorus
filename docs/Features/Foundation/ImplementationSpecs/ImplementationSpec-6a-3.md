# Implementation Spec 6a-3 — codex's argv (F75)

_Pairs with [`../Tasks/Task-6a-3.md`](../Tasks/Task-6a-3.md). Authored 2026-08-14 against `47f633c`._

---

## §0 — Reproduce the finding first

A repair with no captured before-state is a claim.

```powershell
# with a memory-configured project, launch a codex pane, then:
Get-CimInstance Win32_Process | Where-Object CommandLine -like '*codex*' |
  Select-Object -Expand CommandLine > _verify\6a-3\before.txt
Get-FileHash $env:USERPROFILE\.codex\config.toml > _verify\6a-3\config-before.txt
```

Expect: `-c tui.status_line=…` and `-c developer_instructions=…`, and **no `mcp_servers.*` at all**.
That is F75, on this machine, today.

---

## §1 — The two gaps, and the one design decision between them

**Gap 1 — nothing calls `mcpLaunchArgs`.** `PtyLaunchSpec` has no field that can carry a server, so
`codex.buildLaunch` (`codex.ts:131`) has nothing to render even if it wanted to.

**Gap 2 — there is no path for an env VALUE.** `renderMcpLaunchArgs` (`mcpConfigCore.ts:84`) emits
`env_vars=[…]`, which is a list of **names**. `mcp-neo4j-cypher` needs `NEO4J_URL` as a **value**
(`memoryService.ts:247` — measured: it reads `NEO4J_URL` first, `NEO4J_URI` only as a fallback).

**D150 resolves it without touching the renderer.** The `McpServerRef` that `memoryService`
assembles carries `env: { NEO4J_URL, NEO4J_DATABASE }` — literal, non-secret values, because
D128(a) ships local mode only. `wireMcpForLaunch` — **the one function that knows which mechanism an
adapter uses** — converts that ref for a `launch-args` adapter:

```
env: { NEO4J_URL: 'bolt://127.0.0.1:7688', NEO4J_DATABASE: 'neo4j' }
        │                                   │
        ├── keys  ──►  envPassthrough  ──►  argv:  -c mcp_servers.chorus-memory.env_vars=["NEO4J_URL","NEO4J_DATABASE"]
        └── whole map ──►  envAdditions ──►  the child's ENVIRONMENT (composeChildEnv)
```

so argv carries **names** and the environment carries **values** — the same shape D47/D49 already
ratified for `model_providers.<key>.env_key`, and the shape `mcpConfigCore.ts:70` describes in its
own docblock. **`renderMcpLaunchArgs` is not edited**, and its warning that `env` must never reach
argv stays literally true.

**One docblock does need a clarifying line.** `McpServerRef.env` (`types.ts:583`) says *"VALUES ARE
PLACEHOLDERS, NEVER SECRETS"*. After this task a **non-secret literal value** legitimately travels
there for the argv mechanism. Amend it to say so — placeholders for the file mechanisms, non-secret
values for the argv mechanism, and **the guard is what makes the difference checkable rather than a
convention**.

---

## §2 — `types.ts`

On `PtyLaunchSpec`, after `hooks` / `instructions`:

```ts
  /**
   * F75/D150: the MCP servers this launch should be told about, for an adapter
   * whose mechanism is `launch-args`. A file-mechanism adapter ignores it —
   * its config was already written by `wireMcpForLaunch`.
   *
   * ⚠ NON-SECRET BY CONSTRUCTION AND BY GUARD. Only NAMES reach argv; every
   * value travels `envAdditions`. `assertNoSecretInRendered` runs over both
   * before either leaves `wireMcpForLaunch`.
   */
  readonly mcpServers?: readonly McpServerRef[]
```

---

## §3 — `mcpConfigWrite.ts`

**Delete `:178`–`:182` entirely.** The comment states the missing half as though it were shipped, and
that is why F75 survived review. Its replacement describes what the code does:

```ts
  // `launch-args` adapters (codex) write NOTHING: the servers travel as argv on
  // every launch, composed by `buildLaunch` from `PtyLaunchSpec.mcpServers` —
  // which this function supplies through `launchServers` below.
  // ⚠ THIS COMMENT WAS ONCE FALSE (F75) AND THE FALSEHOOD COST A MILESTONE
  // CRITERION. If the wiring below is ever removed, remove this sentence with
  // it rather than leaving it to describe an intention.
```

`McpLaunchWiring` (`:142`) gains:

```ts
  /** For a `launch-args` adapter: the refs to hand to `buildLaunch`, already
   *  converted so only NAMES can reach argv. Empty for every other mechanism. */
  readonly launchServers: readonly McpServerRef[]
```

`NOTHING_TO_DO` (`:155`) gains `launchServers: []`.

The `launch-args` branch replaces its early return:

```ts
  if (descriptor?.mechanism === 'launch-args') {
    const converted = ctx.servers.map((s) => ({
      name: s.name,
      command: s.command,
      args: s.args,
      // ⚠ `env` IS DROPPED, NOT FORWARDED. It is the file mechanisms'
      // placeholder channel; codex interpolates nothing, so forwarding it would
      // put literal `${VAR}` text into argv.
      envPassthrough: Object.keys(s.env ?? {})
    }))
    const envAdditions = Object.assign({}, ...ctx.servers.map((s) => s.env ?? {}))
    // ⚠ THE GUARD RUNS ON THIS PATH TOO. A file mechanism guards its BYTES; the
    // argv mechanism has no bytes, so it guards the two surfaces that leave
    // here — the rendered argv and the env values. A hit costs the memory
    // server, never the launch (see this function's own contract, :166).
    const rendered = [adapter.mcpLaunchArgs(converted).join('\u0000'), Object.values(envAdditions).join('\u0000')].join('\u0000')
    const refusal = assertNoSecretInRendered(rendered, ctx.knownSecrets)
    if (refusal) return { ...NOTHING_TO_DO, result: { ok: false, reason: refusal } }
    return { envAdditions, launchServers: converted, result: null }
  }
```

**⚠ `descriptor === null` must still return `NOTHING_TO_DO`** — the current line tests both
conditions at once (`!descriptor || descriptor.mechanism === 'launch-args'`) and splitting it is the
easiest place in this task to introduce a null dereference.

---

## §4 — `codex.ts`

```ts
    const args = [
      ...cli.args,
      ...CODEX_BASELINE_ARGS,
      ...this.instructionsArgs(spec.instructions ?? null),   // 6a-1
      ...this.mcpLaunchArgs(spec.mcpServers ?? [])           // 6a-3
    ]
```

**Position rationale:** `-c` overrides distinct keys and are order-independent (`codex.ts:137`), so
position is free — and putting the MCP tokens immediately after the baseline keeps
`CODEX_BASELINE_ARGS` a genuine argv **prefix**, which is what lets `adapters.test.ts`'s assertions
stay exact-equality pins instead of reasoning about a tail. The route overrides, `-m`, the effort
tokens and `codexResumeArgs` all keep their existing positions; **`resume` stays last**, because it
changes argv *shape* rather than contents.

With `mcpServers` absent, `mcpLaunchArgs([])` returns `[]` (`mcpConfigCore.ts:85`) — so a launch in a
project with no memory is byte-identical to HEAD.

---

## §5 — Threading

`LaunchOptions` (`sessionManager.ts:154`):

```ts
  /** F75/D150. Non-secret; values travel `envAdditions`. */
  readonly mcpServers?: readonly McpServerRef[]
```

`launch()` passes it straight into `buildLaunch` (`:735`) beside `hooks`, `instructions` and
`resume`. **No conditional in `SessionManager`** — an adapter that ignores the field is the
mechanism working, and a `supportsMcp` check here would be a second home for a rule
`wireMcpForLaunch` already owns.

`ipc.ts`'s `withMcpEnv` (`:638`) returns `{ ...opts, mcpServers: wiring.launchServers, envAdditions: … }`.
**The existing profile-wins merge for `envAdditions` (`:670`–`:684`) is unchanged**, and its warning
log now covers `NEO4J_URL` too: a launch profile that sets it wins, and the user can see why in the
log.

---

## §6 — Tests

**The generic case that would have caught F75 the day it was written** — add beside the capability
honesty block (`adapters.test.ts:992`):

```ts
it.each(capabilityAdapters.map((a) => [a.id, a] as const))(
  '%s composes its own mcpLaunchArgs into buildLaunch',
  (_id, adapter) => {
    if (!supportsMcp(adapter)) return
    const servers = [{ name: 'chorus-memory', command: 'uvx', args: ['mcp-neo4j-cypher'], envPassthrough: ['NEO4J_URL'] }]
    const expected = adapter.mcpLaunchArgs(servers)
    const argv = adapter.buildLaunch({ sessionId: 's', cwd: 'C:\\Projects', mcpServers: servers }).args
    expect(containsSubsequence(argv, expected)).toBe(true)   // contiguous
  }
)
```

For claude and opencode `expected` is `[]` and the case is trivially true; for codex it is the whole
fix; **for the fifth adapter it is the guardrail.**

Also pin:

- codex, no `mcpServers` → **exact equality** with the HEAD argv expression;
- codex, one server → exactly the six tokens `renderMcpLaunchArgs` produces for it;
- **no rendered argv anywhere contains `mcp_servers` and `env=` together** (a string assertion over
  the joined argv);
- `wireMcpForLaunch` with a `launch-args` adapter → `launchServers` populated, `envAdditions`
  carrying both values, `result` null;
- `wireMcpForLaunch` with a `project-file` adapter → **unchanged behaviour**, `launchServers` empty
  (the existing `.mcp.json` suite must pass untouched);
- a ref whose env value matches a secret pattern → refusal, **no servers, no envAdditions**.

---

## §7 — Verification

```
npm run typecheck
npx vitest run
npm run grep:secrets
grep -rn "which \`buildLaunch\` composes" src/     # must print nothing
```

### Runtime

1. Launch a codex pane in the memory-configured project; capture the command line to
   `_verify/6a-3/after.txt` and diff against `before.txt`. Expect exactly the new `mcp_servers.*`
   tokens and **no bolt URL anywhere in argv**.
2. Ask codex, in the pane, to list its MCP servers. **`chorus-memory` must appear** — the F75 drive
   got *"chorus-memory is not registered"*, and that sentence flipping is the repair.
3. Ask it for a node the graph holds (the 6a-2 index is the easiest source: *"what files does project
   memory say the last commit touched?"*). Save the transcript.
4. `Get-FileHash $env:USERPROFILE\.codex\config.toml` — **byte-identical to `config-before.txt`**.
   Re-baseline immediately before the launch, not days earlier: codex writes that file itself.
5. Launch a **claude** pane and diff its command line against a pre-task capture: unchanged.
6. Launch codex in a project **without** memory: argv byte-identical to `before.txt`.

### The failure this task is most likely to ship

**A server codex can see but cannot reach.** The tokens appear in argv, codex lists `chorus-memory`,
and every query fails because `NEO4J_URL` never made it into the child environment. **Step 3 is the
only step that distinguishes those two outcomes** — do not accept step 2 as sufficient.
