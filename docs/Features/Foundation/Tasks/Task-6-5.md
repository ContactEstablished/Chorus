# Task 6-5 — `writeMcpConfig` for claude and opencode (Stage 4) — ⚠ MILESTONE

**Phase:** 6 · **Task 5 of 5** · **Depends on:** **6-4 — hard.**

> ## ⚠ AMENDED 2026-08-08 BY TASK 6-1 — THE MILESTONE'S WORDING WAS FALSE AND IS CHANGED
>
> **1. ⚠ WRITING THE FILE DOES NOT ENABLE THE FEATURE. MEASURED.** claude **2.1.224** reports a Chorus-written project-scoped `.mcp.json` as **`⏸ Pending approval (run \`claude\` to approve)`**, and `claude mcp list --help` states in its own text that unapproved servers are **"not connected to."** Approval is **interactive**. The old milestone — *"claude and opencode receive a Chorus-written MCP config naming a real Neo4j"* — would have been declared met by a feature that does not work.
>
> **2. THE STATE MODEL IS MANDATORY (CR-6.0 Q6, the run's only unqualified `APPROVED`):** **`Configured → Pending approval → Connected → Failed`**, per agent **and** per project. **⚠ `Connected` IS EARNED BY AN OBSERVED PROBE READ, NEVER BY A WRITTEN FILE.** While pending, show the agent, the server identity, that the graph is **not connected yet**, concise instructions to approve it in the interactive CLI, and a **re-check** control.
>
> **3. ⚠ DO NOT PRE-APPROVE. THIS IS A BRIGHT LINE, NOT A PREFERENCE.** Chorus writes **configuration** only and **never** another CLI's approval or trust record. Writing approval state would bypass a human trust gate and couple Chorus to undocumented internals. The council was unanimous.
>
> **4. CAPABILITY-BASED, NOT CLAUDE-SHAPED.** Whether opencode imposes a comparable gate is **[UNVERIFIED]** — the D4 pass could not confirm it non-interactively. **Detect and display actual connection state per agent; do not assume claude's behaviour is universal**, and do not assume its absence either.
>
> **5. THE TWO EXPANSION CLAIMS ARE STILL BINARY-INSPECTED, NOT LIVE-PROVEN — BUDGET FOR IT.** claude's `${VAR}` machinery **is present** in 2.1.224's binary (the regex and a `missingVars` path are both visible) but its **runtime behaviour was never observed**, because `claude mcp get` prints no resolved values and an unapproved server is never connected to. opencode's `{env:VAR}` / `{file:}` / `OPENCODE_CONFIG` tokens are likewise present-but-unexercised. **⚠ CONFIRMING EITHER REQUIRES AN INTERACTIVE SESSION. Budget that step into this task rather than discovering it.**
>
> **6. Local mode only (D128(a)),** so the rendered config names **no credential at all** and `assertNoSecretInRendered` runs over bytes that should contain no secret by construction — which makes a match a **loud** failure, not a near-miss.

## Source Of Truth

- [`Phase-6-Overview.md`](Phase-6-Overview.md) — the purity contract, and **the milestone statement**.
- [`../Phase-6-MemoryPlan.md`](../Phase-6-MemoryPlan.md) **§2 (the security design, in full)** — this
  task is the one that could violate it.
- `../ImplementationSpecs/ImplementationSpec-6-5.md`.
- **`Investigations/6-1-D4-Pass.md`** — **the claude `${VAR}` and opencode `{env:VAR}` confirmations
  live there. If either was refuted, this task's mechanism changes and 6-1 should already have amended
  this doc. Check before starting.**
- Roadmap §6 **D49**, **D88**, **D89**, **D93**, and the AUTH-PRECEDENCE FINDING.

## Initial Starting Point

**Re-verify at execution time; these are the states 6-2 … 6-4 leave behind.**

- 6-2 shipped `McpMechanism`, `McpServerRef.env` / `envPassthrough`, `McpWriteResult`,
  `mcpLaunchArgs`, and **`assertNoSecretInRendered` with its cross-product property test.**
- `supportsMcp(codexAdapter)` is **true**; claude, opencode, kimi, none are **false**, each asserted
  by name in the capability table.
- **No code in this repo has ever written a file into another tool's configuration.** That is what
  this task changes.
- 6-3 gave `project_memory` a credential id and `memoryService` the only decrypt path.
- `src/main/adapters/env.ts:142` — the policy flip. `env.ts:10` — `BASELINE_ENV_VARS`.
- Baseline: whatever 6-4 left. **Never fewer.**

## Goal

claude and opencode receive **a Chorus-written MCP config naming a real Neo4j**, codex receives it as
launch argv, and **no secret value appears in any file Chorus wrote** — proven by
`assertNoSecretInRendered` over the **rendered bytes**, not by inspection. **This is the phase's
milestone, and it is met here.**

## Exact Scope

**Edit:**
- `src/main/adapters/claude.ts` — the descriptor + `writeMcpConfig` (`project-file`, `.mcp.json`).
- `src/main/adapters/opencode.ts` — the descriptor + `writeMcpConfig` (`env-named-file`,
  `%APPDATA%\chorus\mcp\`, reached by `OPENCODE_CONFIG`).
- `src/main/adapters/adapters.test.ts` — **the capability table: two `false` → `true`.**
- `src/main/adapters/mcpConfigCore.ts` + `.test.ts` — the renderers for the two new mechanisms.
- `src/main/services/memoryService.ts` — assemble the `McpServerRef` and call the writers.
- `src/main/adapters/env.ts` — **`BASELINE_ENV_VARS` ONLY IF a measured failure demands it.**
- `src/renderer/src/views/SettingsMemory.vue` — the H3 disclosure, if 6-3 deferred it.

## Non-Goals

- **⚠ NO SECRET VALUE IN ANY FILE. THIS IS THE ONE THAT MATTERS AND THIS IS THE TASK THAT COULD DO
  IT.** claude gets `${NEO4J_PASSWORD}`; opencode gets `{env:NEO4J_PASSWORD}`; codex gets
  `env_vars=["NEO4J_PASSWORD"]`. **A resolved value in any of the three is a stop-and-revert, not a
  fix-forward.**
- **⚠ DO NOT WRITE INTO THE USER'S GLOBAL CONFIG, AND DO NOT WRITE INTO THE REPO FOR OPENCODE.**
  claude's `.mcp.json` is **project-scoped and belongs to the project** (that is the mechanism);
  opencode's file is **Chorus-owned, under `%APPDATA%\chorus\mcp\`**, reached by `OPENCODE_CONFIG`.
  **Never `~/.codex/config.toml`, never `~/.claude/settings.json`, never a `--settings` file, never an
  `apiKeyHelper` script** (D49, verbatim).
- **⚠ DO NOT GIVE KIMI A DESCRIPTOR.** `mcp: null` stays, and the capability table keeps `kimi: false`
  **as an explicit decision**. D87's scoped authorization to write `~/.kimi-code/config.toml` **does
  not extend to writing a secret there.**
- **⚠ DO NOT "FIX" H3 BY ROUTING THE PASSWORD THROUGH `envAdditions`.** That puts a secret in the
  channel D33 defines as non-secret and destroys the invariant **D89 just finished repairing.** Accept
  the flip; disclose it.
- **Do not add a TOML writer.** Its absence from `package.json` is the standing evidence that
  `~/.codex/config.toml` is never written.
- **No new channel, no migration, no table.** `MIGRATIONS.length` **13**, `sqliteTable(` **17**.
- **Do not implement Stage 5.** No container, no `dockerode`, no `docker` CLI, no provisioning.
- **Do not revert or commit unrelated changes.**

## Dependencies

**6-4, hard** — and substantively 6-2, whose guard is what makes this task safe to attempt at all.

## Step-by-step Work

1. **Re-read 6-1's claude/opencode interpolation confirmations** and quote them in the report.
2. The two renderers in `mcpConfigCore.ts` (spec §1).
3. claude's `writeMcpConfig` — atomic temp+rename (spec §2).
4. opencode's `writeMcpConfig` + `OPENCODE_CONFIG` (spec §3).
5. **Wire the guard so it REFUSES rather than warns** (spec §4).
6. The capability table: two `false` → `true` (spec §5).
7. **H2 and H3** — register the value via `LaunchOptions.secrets`; disclose the env flip (spec §6).
8. **G2: a real agent, a real graph, a real query** (spec §7).

## Test Expectations

- **The cross-product property test from 6-2 now covers three mechanisms** — every adapter × every
  ref × every mode. **It must go red if any renderer leaks a value**; prove that by breaking one
  locally and watching it fail.
- `renderMcpConfig` for claude emits `${NAME}`; for opencode `{env:NAME}`. **Asserted as exact bytes.**
- `writeMcpConfig` returns `{ok:false, reason}` — never throws — when the guard refuses, when the
  directory is unwritable, and when `servers` is empty.
- **A test that a resolved secret in a `McpServerRef.env` VALUE is refused**, not written. This is the
  single most important new test in the phase.
- **Never fewer than 6-4's figure.**

## Verification Commands

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

```bash
git diff -- package.json                          # EMPTY — no TOML writer, no dep
grep -c "sqliteTable(" src/main/db/schema.ts      # 17
grep -n "kimi" src/main/adapters/adapters.test.ts # still false in the table
# ⚠ AND THE ONE G4 CANNOT DO — over the files Chorus actually wrote:
grep -rniE "neo4j.*password|bolt://[^ ]*:[^ ]*@" "$APPDATA/chorus/mcp/" <project>/.mcp.json
```

## Acceptance Criteria

- [ ] Gates green; vitest **≥ 6-4's figure**; no existing assertion weakened.
- [ ] `supportsMcp` true for **claude, codex, opencode**; false for **kimi, none** — each by name.
- [ ] **A `.mcp.json` and an opencode config exist on disk and contain NO secret value** — verified by
      grepping **the written files**, which G4 does not reach. **Record that grep's output in the
      report.**
- [ ] **`~/.codex/config.toml` is byte-identical before and after** — hash it. codex is argv-only and
      that must remain observably true.
- [ ] Writes are **atomic** (temp + rename), so an interrupted write cannot leave a half-config that a
      CLI then parses.
- [ ] **G2, and this is the milestone: a real agent session reaches the real Neo4j through the
      Chorus-written config and answers a query.** *"A memory chip that renders is not a memory graph
      that answers."*
- [ ] **The H2 mitigation is wired** — the resolved value registered via `LaunchOptions.secrets`
      (`sessionManager.ts:99`), so an MCP server printing its own password to stderr is scrubbed in the
      pane. **Demonstrated, not asserted.**
- [ ] **H3 is disclosed in the UI** for credentialed mode, and the report states what a subscription
      pane loses.
- [ ] **If `BASELINE_ENV_VARS` had to grow, the report records WHAT BROKE WITHOUT IT** and which of
      D88's three lists was edited.

## Review Checklist

1. **Grep the written files for a secret.** Not the source — **the files on disk.** G4 cannot see
   them, and this is the review step that replaces it.
2. **`~/.codex/config.toml` hash unchanged.**
3. **The property test goes red when a renderer is broken.** Verify by breaking it; a green property
   test that cannot fail is decoration.
4. **`envAdditions` was not used for the password.** Read the diff for it specifically — it is the
   plausible-looking wrong fix, and D89 just repaired that invariant.
5. **kimi is still `false`, by decision rather than omission**, with the reason in a comment.
6. **`package.json` unchanged** — no TOML writer, ever.
7. **The milestone claim is evidenced by a query result**, not by a config file existing.
