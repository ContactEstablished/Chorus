# Task 6-2 — MCP Capability Honesty and codex Wiring (Stage 1)

**Phase:** 6 · **Task 2 of 5** · **Depends on:** **6-1 — hard (G5).**

## Source Of Truth

- [`Phase-6-Overview.md`](Phase-6-Overview.md) — the purity contract, and **FINDING 1: the capability
  test covers 2 of 5 adapters.**
- [`../Phase-6-MemoryPlan.md`](../Phase-6-MemoryPlan.md) **§2 (the security design) and §3 (the three
  defects)** — this task's specification.
- `../ImplementationSpecs/ImplementationSpec-6-2.md`.
- **`Investigations/6-1-D4-Pass.md`** — **if it does not exist, this task is not startable**, and if
  its codex probe failed, **stop and report** rather than proceeding.
- Roadmap §6 **D49**, **D88**, **D93**, and the AUTH-PRECEDENCE FINDING.

## Initial Starting Point (verified 2026-07-28 at `3fa295d`)

- `src/main/adapters/types.ts:88` — `McpDescriptor` is `{mode, format:'json'|'toml'|'yaml',
  location:'project'|'home'|'custom', configPath: string | null}`. **File-shaped, with no way to
  express "per-launch argv".**
- `types.ts:337` — `McpServerRef` is `{name, command, args}`. **No `env`.**
- `types.ts:344` — `writeMcpConfig(project, servers, signal?): Promise<void>`. **No refusal channel.**
- `types.ts:383` — `supportsMcp` checks `getCapabilities().mcp !== null` **and** `typeof
  writeMcpConfig === 'function'`.
- `types.ts:174` — the argv-is-world-readable note, on `extraArgs`.
- `mcp: null` on all five adapters: `claude.ts:86` · `codex.ts:77` · `kimi.ts:112` ·
  `opencode.ts:140` · `noHarness.ts:86`.
- **⚠ `adapters.test.ts:41` — `const adapters = [claudeAdapter, codexAdapter]`. TWO of five.** The
  blanket-false case is `:498`; the generic declared-iff-implemented case is `:515` (describe at
  `:507`).
- `src/main/adapters/env.ts:142` — the policy flip, `if (Object.keys(secretEnv).length === 0)`.
- `src/main/adapters/env.ts:10` — `BASELINE_ENV_VARS`.
- `src/main/ipc.ts:252` — `headersContainSecret`, the refuse-the-write precedent.
- Baseline: typecheck **0** · vitest **1055 / 1055 across 30 files** · `IpcChannel` **58**.

## Goal

Make the MCP surface able to express **the mechanism this phase actually needs** — per-launch argv
with environment-variable indirection — and make the first adapter's `supportsMcp()` return true.
**Then prove, as a property over every adapter and every server ref, that no secret value can reach
the output.** Ship the security core **before** anything can write a file, which is the entire reason
D91 put this stage first.

## Exact Scope

**Create:**
- `src/main/adapters/mcpConfigCore.ts` — **the security core.**
- `src/main/adapters/mcpConfigCore.test.ts`

**Edit:**
- `src/main/adapters/types.ts` — the three defects.
- `src/main/adapters/codex.ts` — the descriptor and `mcpLaunchArgs`.
- `src/main/adapters/adapters.test.ts` — **widen the list 2 → 5, then split the mcp arm.**
- `scripts/secret-grep.mjs` — **the scope comment only.**

## Non-Goals

- **⚠ WRITE NO FILE. NOWHERE.** Not `~/.codex/config.toml`, not `.mcp.json`, not a temp file. codex's
  mechanism is argv; **this stage cannot cross a bright line by construction, and that property is
  the deliverable.** `writeMcpConfig` gets a *type*, not an implementation, for anyone.
- **⚠ ADD NO DEPENDENCY.** Especially **no TOML writer** — its absence from `package.json` is the
  machine-checkable evidence that `~/.codex/config.toml` is never written (plan §2).
- **⚠ DO NOT LOOSEN `adapters.test.ts:498`.** Widen the list and split the arm. **A blanket-false
  that becomes `toBeGreaterThanOrEqual`-shaped, or an arm deleted, is the failure this task is most
  likely to commit.** If an arm must weaken, **stop and report.**
- **Do not touch `env.ts`.** H3 is real but belongs to the task that first puts a secret in
  `secretEnv` — Task 6-3 at the earliest. Adding `BASELINE_ENV_VARS` entries here would be a guess.
- **Do not add a `memory:*` channel, a table, or a migration.** `IpcChannel` stays **58**,
  `sqliteTable(` **16**, `MIGRATIONS.length` **12**.
- **Do not give kimi an MCP descriptor.** `mcp: null` until its interpolation behaviour is
  established (plan §10) — and the new capability table makes that an explicit `false`, not silence.
- **Do not revert or commit unrelated changes.**

## Dependencies

**6-1, hard.** G5 blocks coding. **And specifically: if 6-1's codex probe shows `-c mcp_servers.…` no
longer works per-invocation, this task's zero-write premise is gone and the staging must be
re-thought — that is a stop-and-report, not a workaround.**

## Step-by-step Work

1. **Re-read 6-1's D4 pass.** Quote, in the report, the codex probe result this task depends on.
2. **The `McpMechanism` discriminant** — spec §1.
3. **`McpServerRef.env` / `envPassthrough`** — spec §2.
4. **`McpWriteResult` + `mcpLaunchArgs`** — spec §3.
5. **`mcpConfigCore.ts` and `assertNoSecretInRendered`** — spec §4. **The property test is the
   headline.**
6. **codex's descriptor and its argv** — spec §5.
7. **Widen the capability list 2 → 5, then split the mcp arm into a table** — spec §6.
8. **`secret-grep.mjs`'s scope comment** — spec §7.

## Test Expectations

- **The headline: a PROPERTY over every adapter × every server ref — no known-secret value ever
  appears in the rendered output or the argv.** Not one example; the cross product.
- `assertNoSecretInRendered` refuses when a secret **is** present, and returns null when only its
  **name** is, and the difference is asserted both ways.
- `mcpLaunchArgs` for codex emits `-c mcp_servers.<name>.command=…`, `.args=[…]`,
  `.env_vars=[NAME,…]` — **and never `.env=` with a value.**
- The capability table asserts **all five** adapters explicitly.
- The generic declared-iff-implemented case **stays byte-identical** and now covers five adapters.
- **Never fewer than 1055 across 30 files.**

## Verification Commands

```bash
npm run typecheck && npx vitest run && npm run grep:secrets
```

```bash
git diff --stat -- package.json package-lock.json                    # EMPTY — no dep, no TOML writer
grep -rn "writeFile\|writeFileSync\|rename" src/main/adapters/        # NO new write call anywhere
grep -oE "^\s+[A-Za-z]+: '[a-z0-9:-]+'" src/shared/ipc.ts | wc -l    # 58 — unchanged
grep -c "sqliteTable(" src/main/db/schema.ts                          # 16 — unchanged
grep -n "const adapters" src/main/adapters/adapters.test.ts           # now FIVE adapters
```

## Acceptance Criteria

- [ ] Gates green; vitest **≥ 1055**, no existing assertion weakened.
- [ ] `supportsMcp(codexAdapter)` is **true**; the other four are **false**, each asserted by name.
- [ ] **`git grep` finds no new file-write call in `src/main/adapters/`.**
- [ ] `package.json` is **unchanged** — no dependency, and **no TOML writer**, which the report must
      name as the corollary it is.
- [ ] **The property test exists and covers the cross product**, and its failure message names the
      adapter and the ref.
- [ ] `secret-grep.mjs`'s scope comment states that **CLI config files are outside its reach.**
- [ ] **G2: a real codex session launches with MCP argv present** and the pane still works — argv is
      not a compile-time claim.
- [ ] The report quotes 6-1's codex probe result.

## Review Checklist

1. **No file write.** `grep` for it; do not take the diff's word.
2. **`package.json` untouched.** The absent TOML writer is evidence, and evidence has to stay absent.
3. **The blanket-false case was WIDENED and SPLIT, not relaxed.** Read the test, not the diff — and
   check that `supportsHooks` / `supportsResume` are still blanket-false for all five.
4. **`McpServerRef.env` values are placeholders, never values**, and the type's comment says so.
5. **`configPath` is not reachable on the `launch-args` variant** — if the discriminant still lets
   codex name a file path, the defect that *"the type's own vocabulary names the forbidden file"* has
   not actually been fixed.
6. **The property test would fail if the guard were removed.** Delete the guard locally, watch it go
   red, restore it. A property test that passes without its subject is decoration.
