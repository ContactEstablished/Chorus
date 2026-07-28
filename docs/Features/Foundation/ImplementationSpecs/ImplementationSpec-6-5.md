# ImplementationSpec 6-5 — `writeMcpConfig` for claude and opencode

**Normative for:** [`../Tasks/Task-6-5.md`](../Tasks/Task-6-5.md). **Design input:
[`../Phase-6-MemoryPlan.md`](../Phase-6-MemoryPlan.md) §2 — read it in full before writing a line of
this task.**

**⚠ THIS IS THE FIRST COMMIT IN THE HISTORY OF THIS REPO THAT WRITES A FILE INTO ANOTHER TOOL'S
CONFIGURATION.** Everything before it either passed argv or wrote inside `%APPDATA%\chorus`. D49 and
the AUTH-PRECEDENCE FINDING exist because the obvious way to do this is the forbidden way.

## 1. The two renderers

Extend `mcpConfigCore.ts` (6-2) with the file mechanisms. **Still pure — no `fs` in this module.**

**claude — `project-file`, `.mcp.json`, JSON:**

```json
{
  "mcpServers": {
    "chorus-memory": {
      "command": "uvx",
      "args": ["<the package 6-1 established>", "--db-url", "bolt://127.0.0.1:7687"],
      "env": { "NEO4J_PASSWORD": "${NEO4J_PASSWORD}" }
    }
  }
}
```

**⚠ `${NAME}` IS THE PAYLOAD AND THE VALUE NEVER IS.** 6-1 confirmed claude expands `${VAR}` /
`${VAR:-default}` from `process.env` in `command`, `args` and every `env` value, and reports an unset
one as `missingVars` while leaving it literal. **Quote that confirmation in the commit** — it is the
fact the whole mechanism rests on, and it was binary-inspected before it was live-probed.

**opencode — `env-named-file`, under `%APPDATA%\chorus\mcp\`, reached by `OPENCODE_CONFIG`:**

Use `{env:NEO4J_PASSWORD}`, opencode's own substitution form. **⚠ THE FILE IS CHORUS-OWNED AND ITS
LOCATION IS THE SECURITY PROPERTY** — not the repo, not the user's global config. `OPENCODE_CONFIG`
names a **file path**, not a directory (6-1 confirms).

**Render with `JSON.stringify(obj, null, 2)`.** No template strings, no hand-assembled JSON —
`JSON.stringify` escapes correctly and **`assertNoSecretInRendered` runs on its output**, which is the
seam that matters.

## 2. claude's `writeMcpConfig`

```ts
async writeMcpConfig(project, servers, signal?): Promise<McpWriteResult>
```

1. `servers.length === 0` → `{ok:false, reason:'No MCP servers to write.'}`. **A zero-server write
   would truncate a config the user may have authored** — refuse rather than write `{}`.
2. Render via `mcpConfigCore`.
3. **`assertNoSecretInRendered(rendered, knownSecrets)` → if it returns a reason, RETURN THE REFUSAL
   AND WRITE NOTHING.** Not a log line. Not a warning. **The refusal is the guard's only job** —
   `headersContainSecret` (`src/main/ipc.ts:252`) is the precedent and it refuses.
4. **Atomic: write `<path>.chorus-tmp`, then rename over the target.** ⚠ A CLI reading a
   half-written `.mcp.json` gets a parse error at best; at worst it caches a truncated config.
   Rename is atomic on the same volume — keep the temp file **beside** the target, not in `TEMP`.
5. Return `{ok:true, path, serversWritten}`.

**⚠ MERGE, DO NOT CLOBBER — AND IF YOU CANNOT MERGE SAFELY, REFUSE.** `.mcp.json` is a **project**
file and the user may have their own servers in it. Read it, parse it, replace **only the
Chorus-owned key** (`chorus-memory`), and write the rest back untouched. **If it exists and does not
parse, refuse with a reason naming the file** — silently overwriting a user's broken-but-precious
config is worse than declining.

## 3. opencode's `writeMcpConfig`

Same five steps, three differences:

- Path is `%APPDATA%\chorus\mcp\opencode.json`. **`mkdir -p` the directory** — first run has no
  `mcp\`.
- **No merge concern** — Chorus owns the file. But **still write atomically**; a truncated file breaks
  the next launch either way.
- **`OPENCODE_CONFIG` must be set on the launch**, or the file is inert. That is an `envAdditions`
  entry — **a PATH, not a secret, so `envAdditions` is exactly the right channel for it** (contrast
  the password, §6).

## 4. Wiring the guard so it cannot be bypassed

**The call order is the design:**

```
render → assertNoSecretInRendered → refuse OR write
```

**⚠ THERE MUST BE NO PATH FROM `render` TO `write` THAT SKIPS THE GUARD.** The cheapest way to
guarantee that is structural: have the write helper **take the guard's result as a required
argument**, so a caller that has not run it cannot compile. **A convention that the guard "is called
first" is exactly what fails in the fourth adapter someone adds.**

`knownSecrets` comes from `memoryService` — the only module that decrypts (6-3). **The adapter never
resolves a credential itself**, and there is no code path where an adapter holds a plaintext password
for any purpose other than being refused for holding it.

## 5. The capability table

In `adapters.test.ts`, two entries move:

```ts
const MCP_SUPPORT = {
  claude: true,     // Stage 4 — THIS task
  codex: true,      // Stage 1
  opencode: true,   // Stage 4 — THIS task
  kimi: false,      // plan §10: no evidence of env interpolation. A DECISION, not an omission.
  none: false
}
```

**⚠ THE `kimi: false` COMMENT IS LOAD-BEARING.** Without it, the next person reads the table as
incomplete and "fixes" it — into the one adapter whose interpolation behaviour is unestablished, i.e.
the one where a `${VAR}` that does not expand leaves **a literal placeholder where a password was
expected**, and the natural next step is to write the value. **D87's authorization to write
`~/.kimi-code/config.toml` does not extend to writing a secret there.**

The generic declared-iff-implemented case at `adapters.test.ts:515` **stays byte-identical** and now
has three real subjects.

## 6. H2 and H3 — the two hazards that bite here

**H2 — the secret reaches a grandchild.** Chorus → the CLI → `uvx`/`npx` → the MCP server.
`SessionOutput`'s scrubber sees the PTY stream, so **an MCP server that prints its own password to
stderr surfaces it in the pane.** **Mitigation is one line: register the resolved value via
`LaunchOptions.secrets` (`sessionManager.ts:99`)**, exactly as a BYOK key is. The seam is proven
(D45(1), 19 streamed chunks). **Demonstrate it** — start a server, make it echo, confirm the pane
shows the redaction.

**H3 — the `composeChildEnv` policy flip, and it is the non-obvious one.**
`src/main/adapters/env.ts:142` selects policy on `Object.keys(secretEnv).length === 0`. Turning
**credentialed** memory on for a **subscription** session puts a value in `secretEnv` **for the first
time** and silently flips that pane from *inherit `process.env` wholesale* to the eight-variable
allow-list — **the developer's ambient environment vanishes from a pane that worked yesterday.**

- **Accept the flip and disclose it in the UI.**
- **⚠ DO NOT ROUTE THE PASSWORD THROUGH `envAdditions` TO AVOID IT.** That is the plausible-looking
  wrong fix: it puts a secret in the channel D33 defines as non-secret and **destroys the structural
  invariant D89 just finished repairing.** `OPENCODE_CONFIG` (a path) through `envAdditions` is
  correct; the password through it is not, and the difference is the whole of D33 clause 5.
- **Local mode makes H3 disappear** — `NEO4J_AUTH=none` means `secretEnv` stays empty. So the
  disclosure is **conditional on the mode**, and local mode is the default.

**And plan §10 item 6, which 6-1 measured:** the MCP server runs under the allow-list environment,
where `uvx`/`npx` resolve via `PATH` **but `uv` caches under `%LOCALAPPDATA%`, which is not on the
list.** If it broke, **`BASELINE_ENV_VARS` (`env.ts:10`) grows — and the report records what broke
without it.** ⚠ **D88's three-lists trap applies:** `BASELINE_ENV_VARS` is the **COPY-FROM** list, not
IMPOSE and not REMOVE. Editing the wrong one produces a pane that works and a security property that
does not.

## 7. Verification

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
git diff -- package.json      # EMPTY. No TOML writer. Ever.
```

**⚠ THE VERIFICATION G4 CANNOT PERFORM — run it by hand and PASTE THE OUTPUT IN THE REPORT:**

```bash
# over the files Chorus actually wrote, which grep:secrets does not reach
grep -rniE "neo4j.?password|bolt://[^ ]*:[^ ]*@|[A-Za-z0-9_-]{32,}" \
  "$APPDATA/chorus/mcp/" "<project>/.mcp.json"
# and the file that must not have changed at all
sha256sum ~/.codex/config.toml   # before and after — identical
```

**Runtime (G2) — the milestone, and it is not "a config file exists":**

- [ ] Configure memory against the real Neo4j from 6-3, seeded by 6-4.
- [ ] Launch a **claude** session. Confirm `claude mcp get chorus-memory` resolves and reports **no
      `missingVars`**.
- [ ] **Ask the agent a question that requires the graph, and get an answer from it.** Write one
      `:Memory` node by hand first so there is something to find. **This is the milestone; everything
      before it is scaffolding.**
- [ ] Repeat for **opencode** via `OPENCODE_CONFIG`, and for **codex** via argv (which needs no file
      and is the control case).
- [ ] **Grep the written files. Paste the output.** Zero secrets, or the task has failed regardless of
      what the tests say.
