# Task 6-2 Execution Prompt: MCP Capability Honesty and codex Wiring

**Status**: Partially started. Uncommitted test-only work in `src/main/adapters/adapters.test.ts` is complete and green; production code must follow.

---

## 1. Role

You are the **Coordinator for the Foundation feature, Phase 6 (Neo4j Project Memory + Skills), Task 6-2 — Stage 1**.

- **Repo root:** `C:\Projects\ContactEstablished\Chorus`
- **Expected branch:** `main` — **confirm it; do not switch without instruction.**
- **Expected HEAD at start:** `40b3af5`

You are writing Phase 6 Stage 1's security core — the type and behavioural infrastructure that lets codex's per-launch argv mechanism express MCP servers without writing files or adding dependencies.

**Ground every fact against the code before you act on it.** This prompt's line numbers were verified at `40b3af5`; if the tree has moved, the code wins and you say so. This phase has already lost time twice to task docs built on stale facts — that is why section 5 carries a stale-counts table and a measured deviation rather than trusting its own governing spec.

---

## 2. Goal

Make the MCP surface able to express the mechanism Phase 6 needs — per-launch argv with environment-variable indirection — and make `codex.supportsMcp()` return true. Then prove, as a property over every adapter × every server ref, that no secret value can reach the output. The security core ships BEFORE anything can write a file. **PRIME CONSTRAINT**: this task writes no file anywhere and adds no dependency. Codex's mechanism is argv; the stage cannot cross a bright line by construction, and that property is the deliverable.

---

## 3. Ground yourself first

Read these files in this order before editing any code:

1. **`CLAUDE.md`** (repo root) — non-negotiable architecture rules.
2. **`docs/Features/Foundation/Tasks/Task-6-2.md`** and **`docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-6-2.md`** — governing docs. ⚠ Both predate Task 6-1; a measured deviation is documented in section 5 below.
3. **`docs/Features/Foundation/Tasks/Phase-6-Overview.md`** — read the "AMENDED 2026-08-08" block at the top first.
4. **`docs/Features/Foundation/Investigations/6-1-D4-Pass.md`** — the measured evidence this task rests on. If its codex probe had failed, this task's zero-write premise would be gone. It passed.
5. **`docs/Features/Foundation/roadmap.md`** — decisions D49, D88, D93, D100, D126, D127, D128, and the AUTH-PRECEDENCE FINDING.
6. **Code files** (reference these specific line ranges):
   - `src/main/adapters/types.ts`: lines 50, 56, 88, 170–174, 178–181, 337, 343, 383
   - `src/main/adapters/codex.ts`: lines 77, 82, 125, 140
   - `src/main/adapters/adapters.test.ts`: lines 41, 70, 549, 559, 571
   - `src/main/services/secret-patterns.json`
   - `src/main/ipc.ts`: lines 323, 356
   - `src/main/adapters/env.ts`: lines 10, 142
   - `scripts/secret-grep.mjs`

---

## 4. ⚠ Pre-existing changes — do not revert, stage, or commit these

### This task's own work (KEEP; include in final commit)
- `src/main/adapters/adapters.test.ts` — uncommitted, test-only, suite green at 62 tests (up from 55). Contains:
  - `capabilityAdapters` at line 70: `Object.values(staticRegistry).filter(isPtyAdapter)` (all four adapters: claude, codex, kimi, opencode)
  - Three capability loops repointed to `capabilityAdapters`
  - Drift guard asserting ids match `Object.keys(staticRegistry)`
  - `adapters` at line 41 remains unchanged (two adapters only)
  - Full suite now 1316 tests across 39 files; typecheck 0

### Other workstreams (DO NOT touch these)
```
?? CLAUDE-PROJECT-MARKER.txt
?? docs/Features/Foundation/CouncilBriefs/CouncilBrief-3g.0-ReasoningSpend-Findings.md
?? docs/Features/Foundation/CouncilBriefs/CouncilBrief-3g.0-ReasoningSpend.md
?? docs/Features/Foundation/Investigations/3f-0-SizeCost/case-C.md
?? docs/Features/Foundation/Investigations/3f-0-SizeCost/case-D.md
?? docs/Features/Foundation/Tasks/Phase-3h-ExecutionPrompt.md
?? docs/Features/Foundation/Tasks/Phase-3h-Overview.md
```

Do not revert, stage, or commit any of these.

---

## 5. Implementation scope

### Current state
- Repo: `C:\Projects\ContactEstablished\Chorus`, branch `main`, HEAD `40b3af5`
- Stack: Electron · Vue 3 + TypeScript + Vite + Pinia · xterm.js · node-pty · better-sqlite3 · Zod
- Runtime deps: 7 (must stay 7)
- Vitest suite: 1316 tests / 39 files (up from 1055 / 30 at `3fa295d`)
- `sqliteTable(` count: 16 (must stay 16)

| Metric | Task-6-2.md said | Actually at 40b3af5 | This task may change |
|--------|-----------------|-------------------|----------------------|
| vitest count | 1055 / 30 files | 1316 / 39 files | yes (to ≥1316) |
| `IpcChannel` count | 58 | 68 | no |
| `MIGRATIONS.length` | 12 | 15 | no |
| `sqliteTable(` count | 16 | 16 | no |
| runtime deps | 8 | 7 | no |

⚠ Do not change any metric except the test count.

### A measured deviation from ImplementationSpec-6-2.md §6

The spec says widen `adapters` (line 41) from two to five. **This breaks 8 tests** because `adapters` drives the `describe.each` of launch-behaviour tests, four of which dereference `reasoningEffort`, and both `kimi.ts:107` and `opencode.ts:134` carry `reasoningEffort: null`. The spec read `adapters` as the capability list; it is actually the launch-behaviour list. **A SECOND list is the resolution, and it is already in place** — `capabilityAdapters` exists in `adapters.test.ts` at line 70, derived from the registry. **It is UNCOMMITTED work-in-progress belonging to this task** (see section 4); it is not yet in git history.

The spec's capability table names five keys including `none`. **`none` is NOT an adapter** — `src/main/adapters/noHarness.ts` exports metadata and auth methods only, no `PtyAgentAdapter`. There is no object with `getCapabilities()` to test. Creating one would require widening `staticRegistry`, which `src/shared/ipc.ts:441` forbids: `agentKindSchema` and `staticRegistry` must widen together (D34 Q5 / D63 Q1). **The table is FOUR keys**, and `none`'s absence is already asserted in the existing D84 describe block. That is the honest form.

**THE IMPLEMENTATION MUST KNOW THIS**: do not "fix" it back. This is the correct interpretation.

### Work to complete, in order (order is load-bearing)

#### STEP 1: Fix three defects in `src/main/adapters/types.ts` (pure type change, stays green)

Safe first because nothing implements these yet (`mcp` is null on all five adapters; no adapter has `writeMcpConfig`).

**`McpDescriptor` at line 88** — currently `{ mode, format, location, configPath: string | null }`. This is file-shaped, so codex's per-launch argv mechanism is not expressible. Replace with a discriminated union on a new `McpMechanism`:

**⚠ KEEP THE LITERAL UNIONS FOR `format` AND `location`. Do not widen them to `string`** — the existing type already constrains them, and widening would be a silent loss of type safety in a task whose whole point is making the type do the work a comment was doing badly.

```typescript
export type McpMechanism = 'launch-args' | 'project-file' | 'env-named-file'

export type McpDescriptor =
  | { readonly mode: DescriptorMode; readonly mechanism: 'launch-args' }
  | {
      readonly mode: DescriptorMode
      readonly mechanism: 'project-file' | 'env-named-file'
      readonly format: 'json' | 'toml' | 'yaml'
      readonly location: 'project' | 'home' | 'custom'
      /** Relative to the location root, e.g. '.mcp.json'. */
      readonly configPath: string
      /** `env-named-file` only: the env var naming the file (opencode's
       *  `OPENCODE_CONFIG`). */
      readonly pathEnvVar?: string
    }
```

`format`, `location`, and `configPath` exist only on file variants. `configPath` becomes **non-nullable** on file variants.

**`McpServerRef` at line 337** — currently `{ name, command, args }`. No `env`, so the recommended security mechanism is untypeable. Add two optional fields:

```typescript
env?: Readonly<Record<string, string>>        // placeholder values only: '${NEO4J_PASSWORD}', '{env:NEO4J_PASSWORD}'
envPassthrough?: readonly string[]            // codex: names passed through from parent environment, no value in the ref
```

**⚠ DO NOT add `password`, `value`, or any secret field in any form.**

**`SupportsMcp` at line 343** — currently `writeMcpConfig(project, servers, signal?)` returns `Promise<void>`. No refusal channel, contrary to the house `{ok:false, reason}` idiom. Change the return type and add a second required member.

**⚠ KEEP THE EXISTING PARAMETER LIST — `project` FIRST AND THE OPTIONAL `signal` LAST.** Only the return type changes:

```typescript
export type McpWriteResult =
  | { readonly ok: true; readonly path: string; readonly serversWritten: number }
  | { readonly ok: false; readonly reason: string }

export interface SupportsMcp {
  writeMcpConfig(
    project: Project,
    servers: readonly McpServerRef[],
    signal?: AbortSignal
  ): Promise<McpWriteResult>
  mcpLaunchArgs(servers: readonly McpServerRef[]): readonly string[]
}
```

**BOTH members required** — a file adapter's `mcpLaunchArgs` returns `[]`; an argv adapter's `writeMcpConfig` returns `{ ok: false, reason: 'codex is configured by launch arguments, not by a file.' }`. Making them optional reintroduces the declared-but-not-implemented hole that `supportsMcp` exists to close.

**`supportsMcp` at line 383** — currently checks `mcp !== null && typeof writeMcpConfig === 'function'`. **Widen to check BOTH methods**, or an adapter implementing only `mcpLaunchArgs` narrows to false while genuinely supporting MCP.

```typescript
mcp !== null && typeof writeMcpConfig === 'function' && typeof mcpLaunchArgs === 'function'
```

---

#### STEP 2: Create `src/main/adapters/mcpConfigCore.ts` and `src/main/adapters/mcpConfigCore.test.ts` (security core, land BEFORE codex)

**PURE**: no `fs`, no `electron`, no adapter imports. Importing `secret-patterns.json` directly IS allowed (precedent: `src/main/services/councilService.ts:5`).

**Exports:**
- `renderMcpConfig(descriptor, servers): string` — for file mechanisms
- `renderMcpLaunchArgs(servers): readonly string[]` — for argv
- `assertNoSecretInRendered(rendered, knownSecrets): string | null` — returns refusal reason or null when clean

**The guard runs over rendered bytes**, not the `McpServerRef` objects that produced it. A secret that survives escaping into the file is still in the file. Precedent: `providerSecretRefusal` at `src/main/ipc.ts:323` and `containsSecret` at `src/main/ipc.ts:356`, which is `scrubSecrets(value) !== value`.

**BOTH halves, not either:**
- The **shape half** from `src/main/services/secret-patterns.json` (6 patterns: anthropic, openrouter, openai-project, openai-classic, github, aws-access-key-id)
- The **exact-value half** as substring check against `knownSecrets`

An **empty `knownSecrets` must not make the guard vacuous** — the pattern half still runs. Test both directions.

⚠ `src/main/services/scrubber.ts` is an exact-value streaming scrubber; its docblock forbids applying `secret-patterns.json` to it. Do not route the shape half through it.

**The headline test**: a PROPERTY over every adapter × every server ref. No known-secret value ever appears in rendered output or argv. Not one example — the cross product. Failure message must name the adapter and ref.

**Validate the property test:** delete the guard locally, watch the test go red, restore it. A property test that passes without its subject is decoration. Report that this was done in the final report.

---

#### STEP 3 + STEP 4: Atomic change — `src/main/adapters/codex.ts` and the mcp-arm table in `adapters.test.ts` (MUST land together)

The moment codex's descriptor is non-null and its methods exist, `supportsMcp(codexAdapter)` flips true and the existing blanket-false assertion at line 549 goes red. Landing one without the other leaves the tree broken.

**In `codex.ts:77`:** change `mcp: null` to:

```typescript
mcp: {
  mode: 'static',
  mechanism: 'launch-args'
}
```

⚠ `mode` is `DescriptorMode` ('static' means "known ahead of time, not probed"), **NOT a support flag**. Do NOT invent `mode: 'supported'`.

**Implement `mcpLaunchArgs`:** emit per server exactly:

```
mcp_servers.<name>.command="<command>"
mcp_servers.<name>.args=["<a>","<b>"]
mcp_servers.<name>.env_vars=["NEO4J_PASSWORD"]
```

⚠ **NEVER** `mcp_servers.<name>.env=` with a VALUE. `env_vars` passes NAMES; the value comes from the environment `composeChildEnv` built.

⚠ **MATCH `buildLaunch`'s EXISTING `-c` IDIOM EXACTLY** at line 82: it pushes `'-c'` and the `` `key=${tomlString(value)}` `` as TWO SEPARATE argv entries. Read `buildLaunch` before writing. The route overrides it already emits are the pattern.

**`tomlString`** is a private helper at line 140. Its docblock says there must not be a second quoter in that file. **RECOMMENDED**: move the quoter into `mcpConfigCore.ts` and have `codex.ts` delegate to it. Same algorithm; existing behaviour-neutrality test proves output stays byte-identical.

**Implement `writeMcpConfig`:** return the structured refusal:

```typescript
{ ok: false, reason: 'codex is configured by launch arguments, not by a file.' }
```

Not a throw; not a no-op.

**Precedent to cite in commit:** `types.ts:178–181` already records that route fields "may legally travel in argv (`-c` overrides); the key itself never does" (D47/D49). H1 — extra args become argv and argv is world-readable via `Get-CimInstance Win32_Process` (docblock at `types.ts:170–171`) — is no widening over the line codex already emits. State this explicitly.

**In `adapters.test.ts`:** replace **ONLY the `supportsMcp` line inside the blanket-false loop at line 549.** Leave `supportsHooks` and `supportsResume` in that loop untouched.

**⚠ THE GENERIC DECLARED-IFF-IMPLEMENTED CASE AT LINE 571 IS A DIFFERENT TEST AND MUST NOT BE TOUCHED** apart from the list it already iterates. Do not treat 549–571 as one range.

```typescript
const MCP_SUPPORT: Readonly<Record<string, boolean>> = {
  claude: false,   // Stage 4 (Task 6-5)
  codex: true,     // Stage 1 — argv, writes nothing
  opencode: false, // Stage 4 (Task 6-5)
  kimi: false      // no evidence of env interpolation. NOT an oversight.
}
```

Drive it from `capabilityAdapters` so each adapter is its own named case, and assert that **every** registry adapter id has a key — a missing key must **fail**, not default to false.

**Assert that EVERY registry adapter id has a key** — a missing key must FAIL, not default.

`supportsHooks` and `supportsResume` **STAY BLANKET-FALSE** for all four. Blanket-false over four is strictly stronger than over two.

The generic declared-iff-implemented case must stay **BYTE-IDENTICAL** apart from the list it iterates.

---

#### STEP 5: Comment-only change to `scripts/secret-grep.mjs`

Add to the header docblock, in its own words:

```
CLI config files are outside this gate's reach — not ~/.codex/, not ~/.claude/, not a project's .mcp.json.
From Phase 6 Stage 2 onward, the app writes files in those places, and assertNoSecretInRendered is what covers them.
A gate believed to cover more than it does is worse than one that states its limit.
```

Do not change what it scans.

---

#### STEP 6: G2 runtime verification (last, run the actual app)

Argv is not a compile-time claim.

1. **Launch a REAL codex session** with an MCP server ref present and confirm from the pane that codex started and the argv reached it.
2. **Hash `~/.codex/config.toml` before and after** and confirm byte-identical. That file staying untouched is this stage's entire claim.
   - ⚠ That file already contains a pre-existing `node_repl` MCP server from the user's Codex install — the hash must be the SAME both times. It is not expected to be empty.
3. **Quote in the final report:** the 6-1 probe result from `docs/Features/Foundation/Investigations/6-1-D4-Pass.md`. On codex 0.147.0, the probe server was returned in parsed JSON with `env_vars` intact, and `~/.codex/config.toml` was byte-identical by size, mtime, and sha256 before and after.

---

## 6. Strict non-goals

- **WRITE NO FILE, NOWHERE.** Not `~/.codex/config.toml`, not `.mcp.json`, not a temp file. `writeMcpConfig` gets a TYPE, not an implementation, for anyone in this phase.
- **ADD NO DEPENDENCY.** Especially NO TOML WRITER — its absence from `package.json` is machine-checkable evidence that `~/.codex/config.toml` is never written.
- **DO NOT LOOSEN the blanket-false assertion.** Widen and split. A blanket-false that becomes `toBeGreaterThanOrEqual`-shaped, or an arm deleted, is the failure this task is most likely to commit. If an arm must weaken, STOP AND REPORT.
- **DO NOT TOUCH `src/main/adapters/env.ts`.** H3 is real but belongs to the task that first puts a secret in `secretEnv` — Task 6-3 at earliest. D128(a) may remove it entirely.
- **DO NOT add a `memory:*` channel, a table, or a migration.**
- **DO NOT give kimi an MCP descriptor.**
- **DO NOT revert, stage, or commit** the unrelated dirty files listed in section 4.
- **DO NOT push or open a PR** unless explicitly asked.

---

## 7. Required workflow

No `.codex/workflows/subagents/` kit in this repo. Follow `CLAUDE.md` conventions: small reviewable changes, explain architectural choices briefly before large edits, ask before adding dependencies.

**One intentional narrated commit** for the whole task (gate G3). Commit message: layman's-terms first, technical detail second, matching recent commit style. End with:
```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## 8. Verification commands

All runnable from repo root. Run in this order:

```bash
npm run typecheck
```
Expect exit 0. Gate G1.

```bash
npx vitest run
```
Expect **≥ 1316** tests, all passing. The standing rule is **"never fewer"** — an assertion that had to weaken to go green is a stop-and-report, not a pass.

```bash
npm run grep:secrets
```
Expect clean across 6 patterns (anthropic, openrouter, openai-project, openai-classic, github, aws-access-key-id). Gate **G4** — and note its stated blind spot: it does **not** reach CLI config files, which is exactly what step 5 makes it admit.

### The gates, named correctly

| Gate | What it is |
|---|---|
| **G1** | `npm run typecheck` exits 0. |
| **G2** | **Run it, don't just compile it** — the real codex session and the `~/.codex/config.toml` hash in step 6. Argv is not a compile-time claim. |
| **G3** | One narrated commit for the task. |
| **G4** | `npm run grep:secrets` clean across 6 patterns. |

```bash
git diff --stat -- package.json package-lock.json
```
Expect EMPTY — no dependency and no TOML writer.

```bash
grep -rn "writeFile\|writeFileSync\|rename\|mkdir" src/main/adapters/
```
Expect NO new write calls.

```bash
node -e "console.log(Object.keys(require('./package.json').dependencies).length)"
```
Expect 7.

```bash
grep -c "sqliteTable(" src/main/db/schema.ts
```
Expect 16.

```bash
grep -n "const adapters\|const capabilityAdapters" src/main/adapters/adapters.test.ts
```
Expect `adapters` still TWO (line 41 unchanged), `capabilityAdapters` derived from registry (line 70).

---

## 9. Failure honesty

- **Unrelated environment failures:** If a verification command fails for environment reasons unrelated to your changes, capture exact output, explain it, do not claim success.
- **Codex regression:** If the codex CLI's per-invocation `-c mcp_servers.…` behaviour has regressed since 0.147.0, this task's zero-write premise is gone. STOP AND REPORT; do not work around it.
- **⚠ Known flaky test** (Finding F50): `src/main/adapters/adapters.test.ts` fails intermittently in full-suite runs (observed once in nine at `84dcf54`), in the case "a raw override in extraArgs suppresses Chorus's own effort tokens ENTIRELY". It passes 5/5 in isolation; it is cross-file interference, pre-existing, not caused by this task. **Re-run before diagnosing a regression.**

---

## 10. Final reporting requirements

Report as status enum: **DONE** / **DONE_WITH_CONCERNS** / **NEEDS_CONTEXT** / **BLOCKED**.

Include:

1. **Files changed** (git paths, absolute preferred)
2. **Build and runtime results**
   - Full `npm run typecheck` output
   - Full `npx vitest run` output (last 50 lines if >200)
   - Full `npm run grep:secrets` output
   - Full output of each verification command in section 8
3. **G2 runtime observation** (what was actually observed, not a summary)
   - Codex session launched successfully
   - `~/.codex/config.toml` hash before and after
   - Confirmation of byte-identity
4. **Quote from 6-1:** the measured evidence from `docs/Features/Foundation/Investigations/6-1-D4-Pass.md` that the codex probe succeeded
5. **Review outcomes**
   - Property test validated by deleting guard and watching failure (report that this was done)
   - No assertion weakened; blanket-false widened only, not replaced
6. **Explicit non-goals confirmation** — state which non-goals applied and were met (e.g., "no file written, no dep added, env.ts untouched")
7. **Residual risks** — anything that requires follow-up or Phase 6 Stage 2 to handle
8. **Final `git status --porcelain`** (should show only tracked, modified files if commit was made)
9. **Resolved decisions cited** — name D49, D88, D93, D100, D126, D127, D128(a), D128(b), AUTH-PRECEDENCE FINDING in the commit message or report

---

## Summary of decisions this task rests on

- **D49 + AUTH-PRECEDENCE FINDING** — Never a key in `~/.codex/config.toml`, a `--settings` file, or an `apiKeyHelper` script.
- **D93** (2026-07-28) — NO SECRET VALUE REACHES ANY CLI'S CONFIG FILE, IN ANY MODE. Not "not by default": never. A credentialed mode passes a variable NAME.
- **D88** — The three-lists trap (COPY-FROM / IMPOSE / REMOVE) for anyone editing `BASELINE_ENV_VARS`.
- **D100** (2026-07-28) — `neo4j-driver` approved for TASK 6-3 ONLY. Not this task.
- **D126** (2026-08-08) — CR-6.0 closed, G5 discharged. Task 6-2 is unblocked.
- **D128(a)** (2026-08-08) — Phase 6 ships LOCAL-MODE ONLY; credentialed mode left the phase.
- **D128(b)** (2026-08-08) — NO `BASELINE_ENV_VARS` ADDITION in this phase.
