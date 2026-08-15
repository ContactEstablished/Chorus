# Task 6a-3 — codex's argv (F75)

_Phase 6a, task 3 of 4. Authored 2026-08-14 against `47f633c`._

> **⚠ THIS TASK CLOSES A FINDING WHOSE SURVIVAL WAS CAUSED BY A COMMENT.** F75: `mcpLaunchArgs` is
> built, unit-tested and **never called**, while `mcpConfigWrite.ts:179` states the missing half as
> though it were the shipped half — *"the servers reach them through `mcpLaunchArgs` on every launch,
> **which `buildLaunch` composes**"*. It composes no such thing. **The comment dies with the fix**,
> and it is named in the acceptance criteria so it cannot be left behind.

## Source Of Truth

| Document | Owns |
|---|---|
| `roadmap.md` §5 — **F75** | The two gaps, measured on a real codex pane |
| [`../Phase-6a-Proposal.md`](../Phase-6a-Proposal.md) §3 (6a-3) | Why this is third rather than first |
| `roadmap.md` §6 — **D150**, D93, D49, D33 clause 5, D89 | Names travel in argv; values travel in the environment |
| [`Phase-6a-Overview.md`](Phase-6a-Overview.md) | Verified ground facts |
| [`../ImplementationSpecs/ImplementationSpec-6a-3.md`](../ImplementationSpecs/ImplementationSpec-6a-3.md) | Exact edits, argv ordering, runtime checks |

## Initial Starting Point — verified 2026-08-14 at `47f633c`

| Fact | Where | Value |
|---|---|---|
| `codex.mcpLaunchArgs` | `codex.ts:114` | delegates to `renderMcpLaunchArgs` — **correct, and dead** |
| `renderMcpLaunchArgs` | `mcpConfigCore.ts:84` | emits `command`, `args`, and `env_vars` **only when `envPassthrough` is non-empty** |
| `McpServerRef.env` is deliberately NOT rendered to argv | `mcpConfigCore.ts:78` (docblock) | because it holds the FILE mechanisms' `${VAR}` / `{env:VAR}` placeholders |
| What `mcpLaunchInput` actually puts in `env` | `memoryService.ts:265` | **literal values** — `NEO4J_URL: <bolt uri>`, `NEO4J_DATABASE: <name>` — because D128(a) ships local mode only |
| `PtyLaunchSpec` | `types.ts:335` | **no field can carry a server** |
| `codex.buildLaunch` | `codex.ts:131`–`:213` | never mentions MCP |
| `wireMcpForLaunch` | `mcpConfigWrite.ts:170` | returns `NOTHING_TO_DO` for a `launch-args` adapter at `:183` |
| The false comment | `mcpConfigWrite.ts:178`–`:182` | **to be deleted, not softened** |
| `McpLaunchWiring` | `mcpConfigWrite.ts:142` | `{ envAdditions, result }` — the shape that gains the servers |
| `guardRendered` / `assertNoSecretInRendered` | `mcpConfigCore.ts:407` / `:342` | the unbypassable guard, and the only legal way to bless bytes |
| `withMcpEnv` | `ipc.ts:638`–`:685` | the one call site, per launch, with the right cwd — and its `envAdditions` merge rule (profile wins, and says so) |
| `envAdditions` is the non-secret channel | `types.ts` (`PtyLaunchRequest`), D33/D89 | **a password through it destroys the invariant D89 repaired** |
| `composeChildEnv` | `adapters/env.ts:142` | where a launch's environment is assembled |
| `adapters.test.ts:985` | — | already asserts claude and opencode return `[]` from `mcpLaunchArgs` |
| codex version | probed 2026-08-14 | **0.147.0** |
| `~/.codex/config.toml` | Phase 6 G2 | **byte-identical across the drive** — this task must keep it so |

## Goal

Make codex actually receive the memory server. `PtyLaunchSpec` gains a field that carries MCP servers,
`buildLaunch` composes the argv the adapter has always known how to render, and the values the server
needs — the bolt URL and the database name — reach the child **through the environment**, while only
their **names** appear in argv. When this task lands, the criterion Task 6-5 could not meet —
*"codex receives it as launch argv"* — is met and driven.

## ⚠ The second gap, which is why fixing the call site alone would ship nothing

`renderMcpLaunchArgs` can emit `env_vars=["NEO4J_URL"]` — a **name**. It has no way to emit the
**value**, and `mcp-neo4j-cypher` cannot find a database without one. **D150 settles where the value
goes: `envAdditions`.** Main converts the ref for the `launch-args` mechanism — `envPassthrough`
becomes the env map's **keys**, and the map's **values** become `envAdditions` — so:

- argv carries names only, exactly as it already does for `model_providers.<key>.env_key` (D47/D49);
- the value travels the channel that D33 clause 5 and D89 built for non-secret launch data;
- `renderMcpLaunchArgs` and its docblock are **unchanged and still true**, which is the point of
  doing the conversion in the one place that knows the mechanism.

**⚠ AND THE GUARD STILL RUNS.** A file mechanism gets its bytes guarded before they are written; the
argv mechanism has no bytes, so this task guards **the composed env map and the rendered argv** with
the same `assertNoSecretInRendered`, and **refuses the server rather than the launch** on a hit. A
launch never fails because memory could not be wired — that rule is already `wireMcpForLaunch`'s
(`:166`) and it does not change.

## Exact Scope

**Edit**

- `src/main/adapters/types.ts` — `PtyLaunchSpec.mcpServers?: readonly McpServerRef[]`.
- `src/main/adapters/mcpConfigWrite.ts` — `McpLaunchWiring` gains `launchServers`; the `launch-args`
  branch converts the refs and returns them instead of `NOTHING_TO_DO`; **the false comment is
  deleted and replaced by one that describes what the code now does**.
- `src/main/adapters/codex.ts` — `buildLaunch` composes `this.mcpLaunchArgs(spec.mcpServers ?? [])`.
- `src/main/services/sessionManager.ts` — `LaunchOptions.mcpServers` through to the `buildLaunch`
  call.
- `src/main/ipc.ts` — `withMcpEnv` carries `launchServers` onto the returned options.
- `src/main/adapters/adapters.test.ts`, `mcpConfigWrite.test.ts`, `mcpConfigCore.test.ts` — the pins.

**Nothing else.** No new file, no new channel, no schema change.

## Non-Goals

- **⚠ `~/.codex/config.toml` IS NEVER READ AND NEVER WRITTEN.** codex stays *nothing*-configured,
  which is what makes D49 hold for it. `writeMcpConfig`'s permanent refusal (`codex.ts:127`) stays.
- **No secret in argv, in any mode.** `knownSecrets` is empty this phase by construction
  (`memoryService.ts:274`) — that is a fact, not a reason to skip the guard.
- **No `mcp_servers.<name>.env=` token.** codex accepts that field and it carries name→VALUE pairs;
  `mcpConfigCore.ts:78` forbids it and this task does not reopen the question (D150).
- **No change to claude's or opencode's launch path.** Both return `[]` from `mcpLaunchArgs` by
  contract; their argv must stay byte-identical.
- **No new adapter, no descriptor change, no capability widening.**
- **No migration, no IPC channel.** `IpcChannel` stays at **87** (86 + 6a-2's one).
- **Do not revert, stage, commit or delete unrelated working-tree changes.**

## Dependencies

**Task 6a-2 must have landed** — it shares `src/main/ipc.ts`, and 6a-1 owns the `codex.ts`
`buildLaunch` composition this task appends to.

## Step-by-step Work

1. **Reproduce F75 first.** Launch a codex pane in a memory-configured project and dump its command
   line (`Get-CimInstance Win32_Process`). **Record the absence of `mcp_servers.*`** — a fix with no
   before-state is a claim, not a repair.
2. **Widen `PtyLaunchSpec`** with `mcpServers`, documented as *non-secret by construction; values
   travel `envAdditions`*.
3. **Convert in `wireMcpForLaunch`**, in the `launch-args` branch: build `envPassthrough` from the
   env map's keys, strip `env`, return the converted refs **and** the env map as `envAdditions`.
   Guard both before returning; on a refusal return no servers and no additions, with the reason for
   the caller to log.
4. **Compose in `codex.buildLaunch`** — appended in a fixed, tested position, after the baseline and
   instruction tokens and before the route overrides, so `CODEX_BASELINE_ARGS` stays a genuine argv
   prefix and every existing exact-equality pin survives.
5. **Thread it**: `LaunchOptions.mcpServers` → `sessionManager.launch` → the `buildLaunch` call at
   `sessionManager.ts:735`, beside `hooks` and `resume`.
6. **Delete the false comment** and write the true one.
7. **Add the generic pin** (see below) so the fifth adapter cannot repeat F75.

## Test Expectations

- **The generic anti-F75 case, for every PTY adapter**: given `mcpServers`, `buildLaunch`'s argv
  **contains `adapter.mcpLaunchArgs(servers)` as a contiguous subsequence**. For claude and opencode
  that is the empty sequence and the case is trivially true; for codex it is the whole fix; **for the
  fifth adapter it is the test that would have caught F75 on the day it was written.**
- codex with no `mcpServers` → argv **byte-identical to HEAD** (exact equality, not difference).
- codex with one server → exactly the tokens `renderMcpLaunchArgs` produces, including
  `env_vars=["NEO4J_URL","NEO4J_DATABASE"]`, **and no `mcp_servers.*.env=` token anywhere**.
- `wireMcpForLaunch` for a `launch-args` adapter returns the converted servers **and**
  `envAdditions` carrying the values; for a `project-file` adapter its behaviour is unchanged
  (claude's `.mcp.json` path is pinned by the existing suite and must not move).
- **A ref whose env value matches a secret pattern produces a refusal, no servers and no
  `envAdditions`** — the guard proven to bite on the argv path, not only on the file path.
- A grep-style assertion that `mcp_servers` and `env=` never appear together in any rendered argv.

## Verification Commands

```
npm run typecheck
npx vitest run
npm run grep:secrets
```

**Runtime drive — F75 is closed by a codex session, not by a green suite:**

1. Hash `~/.codex/config.toml` **before** anything (`Get-FileHash`). Re-baseline it immediately
   before the launch, because **codex writes that file itself** — a stale hash reports a change
   Chorus did not make (the Phase 6 G2 lesson).
2. Launch a codex pane in a memory-configured project. Dump the live command line and confirm
   `-c mcp_servers.chorus-memory.command="uvx"`, `.args=["mcp-neo4j-cypher"]` and
   `.env_vars=["NEO4J_URL","NEO4J_DATABASE"]` are present — **and that no bolt URL appears in argv at
   all**.
3. In that pane, ask codex to list its MCP servers. **`chorus-memory` must be listed**, where the F75
   drive got *"chorus-memory is not registered"*.
4. Ask it a question that requires reading the graph — the canary node, or a file the 6a-2 index
   wrote — and record the transcript.
5. Re-hash `~/.codex/config.toml`: **byte-identical**.
6. Launch a **claude** pane in the same project and confirm its argv is unchanged from before this
   task.

Evidence under `_verify/6a-3/`.

## Acceptance Criteria

- [ ] The before-state of F75 was captured from a live process, not asserted.
- [ ] A codex pane in a memory-configured project carries `mcp_servers.*` argv, and **codex itself
      reports `chorus-memory` as available**.
- [ ] codex answers a question from the graph.
- [ ] **No bolt URL, database name, or any env VALUE appears in argv** — checked against the live
      command line, not only against a unit test.
- [ ] `~/.codex/config.toml` is byte-identical, hashed before and after.
- [ ] A codex launch in a project **without** memory is byte-identical to HEAD.
- [ ] claude's and opencode's argv are unchanged.
- [ ] `mcpConfigWrite.ts`'s false comment is **gone**, and the replacement describes the shipped
      behaviour — grep for *"which `buildLaunch` composes"* returns nothing.
- [ ] The generic subsequence case exists and covers every adapter in `staticRegistry`.
- [ ] `IpcChannel` **87** · `MIGRATIONS.length` **19** · runtime deps **8**.
- [ ] typecheck **0** · vitest **≥ baseline** · `grep:secrets` clean.

## Review Checklist

1. **The conversion happens in exactly one place** — `wireMcpForLaunch`. If any adapter or the
   session manager also inspects `McpServerRef.env`, there are two homes for the mechanism rule.
2. **`renderMcpLaunchArgs` is unchanged**, and its docblock is still true after the change. If the
   implementer had to edit that function, the design was misread.
3. **The guard runs on the argv path and can refuse.** Find the call and the refusal branch; confirm
   the refusal costs the memory server and never the launch.
4. **`envAdditions` carries no secret and cannot** — the values are a bolt URI validated to reject
   userinfo (`validateBoltUri`, D93) and a database name.
5. **The argv position is pinned by an exact-equality test**, not by a `toContain`.
6. **The false comment is deleted rather than annotated.** A softened comment is still a comment that
   was wrong once.
