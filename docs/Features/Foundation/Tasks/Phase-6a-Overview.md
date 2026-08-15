# Phase 6a — Memory In Practice — Task Overview

**Kicked off 2026-08-14** against the verified codebase at **`47f633c`**, immediately after Phase 6
closed at its milestone. **Scope authority is [`../Phase-6a-Proposal.md`](../Phase-6a-Proposal.md)**
(adopted as **D147**); this overview adds the part a proposal cannot: **the code as it stands now**,
and the two places the adopted decision does not survive contact with the installed CLI.

## The one thing to read before this document

**[`../Phase-6a-Proposal.md`](../Phase-6a-Proposal.md) is AUTHORITATIVE ON SCOPE and this overview
does not restate its argument.** The roadmap entry records placement and status. Where this document
and the proposal disagree on a *mechanism*, this one wins, because it was measured this session
against the installed binaries and the proposal was not — and every such disagreement is called out
below rather than silently corrected.

## Verified ground facts — every one checked 2026-08-14 at `47f633c`

**Nothing below is inherited on trust, including from D147 and from the Phase 6 documents.**

| Fact | Where | Value |
|---|---|---|
| Baseline gates | — | typecheck **0** (node + web) · vitest **2012 / 2012 across 59 files** · `grep:secrets` **clean (6 patterns)** |
| `IpcChannel` keys | `src/shared/ipc.ts:14` | **86** |
| `ipcMain.handle(` | `src/main/ipc.ts` | **76** |
| `sqliteTable(` | `src/main/db/schema.ts` | **18** |
| `MIGRATIONS` | `src/main/services/storage.ts:171` | last entry is **v19**; **next free is `v20`** — ⚠ **and no task in this phase needs one** (see below) |
| Runtime dependencies | `package.json` | **8** — `@electron-toolkit/preload`, `@electron-toolkit/utils`, `better-sqlite3`, `neo4j-driver`, `node-pty`, `pino`, `splitpanes`, `zod` |
| `GRAPH_MIGRATIONS` | `src/main/services/graphSchemaCore.ts:51` | **one** entry, `LATEST_GRAPH_VERSION` **1** |
| `PtyLaunchSpec` | `src/main/adapters/types.ts:335` | `sessionId, cwd, modelId?, effortOptionId?, extraArgs?, credential?, route?, hooks?, resume?` — **no MCP field, no instructions field** |
| `codex.mcpLaunchArgs` | `src/main/adapters/codex.ts:114` | delegates to `renderMcpLaunchArgs` — **and has no caller in `src/` outside the adapters and their tests (F75)** |
| The misleading comment | `src/main/adapters/mcpConfigWrite.ts:179` | *"which `buildLaunch` composes"* — **`buildLaunch` composes no such thing** |
| `renderMcpLaunchArgs` | `src/main/adapters/mcpConfigCore.ts:84` | emits `command`, `args`, and `env_vars` (**names only**) — **no path for an env VALUE** |
| The hook-file idiom this phase copies | `sessionManager.ts:277` (`bindHooks`), `:698` (mint), `:338` (`retireHooks`), `index.ts:339` (`agent-hooks` dir) | main owns the path, the adapter owns the format, every exit path deletes the file |
| `CODEX_BASELINE_ARGS` | `src/main/adapters/codex.ts:742` | **already carries `-c developer_instructions=…`** (the jade rule) |
| `tomlBasicString` | `mcpConfigCore.ts:40` | escapes `\` and `"` — **and NOT newlines**, which is why the jade rule is authored as one physical line (`codex.ts:697`) |
| `memoryService.mcpLaunchInput` | `memoryService.ts:254` | pure read; returns `null` when the project has no memory — **the gate this phase's injection reuses** |
| Graph identity | `Phase-6-IdentityModel.md` §2 · `graphSchemaCore.ts:61` | `workspaceInstanceId` = `'wt:'+worktrees.id` or `'pj:'+projects.id`; `:File` keyed `(workspaceInstanceId, relPath)` |
| `repoId` | identity model §3 | the repository's **root-commit SHA**, lexicographically smallest on a tie |
| `worktrees` accessors | `storage.ts:1782`, `:1796` | `getWorktreesForProject`, `getWorktreeById` |
| `git.ts` surface | `services/git.ts` | worktree/status/branch/diff only — **no `ls-files`, no `log`, no root-commit probe** |
| `docker` detection | `cliDetect.ts:78` | already in `DETECTED_TOOLS` |
| Memory settings UI | `views/ProjectSettingsView.vue:655` (`<span class="ps-label">Memory</span>`) | the per-project section every new control joins — **there is no Settings route to add** (D131) |
| Memory IPC handlers | `ipc.ts:3842`–`:3933` | seven `memory:*` handlers, contiguous |
| `.mcp.json` | `git ls-files` | **TRACKED** (D147's answer to open question 4) |

### D4 versions, probed this session rather than inherited

Method was `<tool> --version` / `--help` on this machine, **2026-08-14**:

`claude` **2.1.232** · `codex-cli` **0.147.0** · `opencode` **1.18.18** · `kimi` **0.29.1** ·
`git` **2.50.0.windows.1** · **`docker` 29.7.2**.

**⚠ `docker` HAS MOVED A WHOLE MAJOR SINCE THE PHASE 6 D4 PASS** — 28.0.4 → **29.7.2**. Task 6a-4
verifies its own flags against this binary and quotes nothing from the Phase 6 investigation.

### ⚠ TWO OF D147's OWN MECHANISMS DO NOT SURVIVE THE INSTALLED CLI, AND BOTH CHANGE WORK

**FINDING 1 — `--settings` CANNOT CARRY AN INSTRUCTION, SO D147(e)'s NAMED CLAUDE MECHANISM DOES NOT
EXIST.** D147(e) says injection *"uses claude's `--settings` (already the hook mechanism, D130)"*.
`--settings` takes a **settings JSON file**; nothing in that schema is a system prompt, and Chorus's
own use of it writes `{hooks:{…}}` (`claude.ts:213`). Measured against the installed **2.1.232**:
`--append-system-prompt <prompt>` is documented in `--help`, and **`--append-system-prompt-file
<file>` exists** — probed by omitting its argument, which returned
`error: option '--append-system-prompt-file <file>' argument missing`. **Resolved as D148: the file
variant is the vehicle**, chosen by Matthew 2026-08-14. It is the same shape `--settings` already
gives hooks — main reserves a path, the adapter writes it, every exit path deletes it — and it keeps
a multi-line snippet out of a world-readable command line.

**FINDING 2 — `-c developer_instructions` IS ALREADY OCCUPIED, AND `-c` REPLACES RATHER THAN
APPENDS.** `CODEX_BASELINE_ARGS` (`codex.ts:742`) already sets that exact key to the jade formatting
rule, and `codex.ts:708` states the replacement semantics in its own words. **A second `-c
developer_instructions=` token would therefore silently destroy the jade rule or be destroyed by it**
— and codex ignores an unknown or duplicated `-c` path **without a word** (`codex.ts:680`), so the
only symptom would be a formatting rule that quietly stopped working. **Task 6a-1 composes ONE
value** and probes the duplicate-key behaviour before relying on either outcome.

## The decisions this kickoff settles — D148 … D151

Recorded in the roadmap's §6 table; stated here because the task docs are written against them.

| # | Ruling |
|---|---|
| **D148** | **6a-1 delivers the usage contract through `claude --append-system-prompt-file` and codex's existing `-c developer_instructions`, to those TWO adapters only.** Corrects D147(e)'s `--settings`. `kimi`, `opencode` and `noHarness` declare the capability **null** — honest, and the capability-honesty loops then cover all five. **The snippet is emitted ONLY when the project has memory configured** (`mcpLaunchInput !== null`): telling an agent about a graph that does not exist is worse than saying nothing. |
| **D149** | **`index-codebase` v1 indexes FILES, DIRECTORIES and COMMITS — no parser, no symbols, no `CALLS`.** The roadmap's `Class`/`Method`/`CALLS` list is **cut, and the cut is stated in the UI as well as the doc**: this finds code, it does not read it. Declarations would require promoting `typescript` to a runtime dependency; a call graph needs a type checker and is a phase, not a task. **⚠ AND THE INDEXER NEVER DELETES A `:File` NODE** — see the provenance trap below. **Refresh is manual only.** |
| **D150** | **codex's MCP env VALUES travel through `envAdditions`, never through argv.** `env_vars=[…]` keeps carrying NAMES (D93's rule, in codex's own vocabulary) and the value arrives through the environment `composeChildEnv` builds. The alternative — `mcp_servers.<n>.env=` — is forbidden by `mcpConfigCore.ts:78`'s own docblock and would put configuration values in a world-readable command line for no gain. |
| **D151** | **The provisioner ships create / start / stop / status / remove-container. It NEVER removes a volume.** Container removal sits behind the typed-confirmation gate (the `worktree:remove` precedent, D123). **F49 gates durability on export/restore, which this phase does not build** — so no code path in Chorus may destroy a graph. `docker` is driven through a `git.ts`-style CLI adapter; **`dockerode` remains unapproved** (D147(d)). |

### ⚠ THE PROVENANCE TRAP D149 EXISTS TO CLOSE — read this before writing any indexer Cypher

`memory:validate` counts a `:Memory` as **sourced** iff it has an outgoing `:SUPPORTED_BY` to a
`:File` or `:Commit` **that exists in the graph** (identity model §6). An indexer that re-builds the
structural namespace by wiping it — `MATCH (f:File {workspaceInstanceId:$w}) DETACH DELETE f` — would
**delete the provenance edges the validator counts**, and the ratio would fall without a single
memory having been touched. The graph would report itself less trustworthy because a *refresh* ran.
**So: MERGE only.** A file that has disappeared from the tree is marked, never deleted, and the mark
is a property (`missingSince`) rather than an absence.

## The tasks

Ordered by D147(b); **each depends on the previous one having landed**, because four of them edit
`src/main/ipc.ts` and three edit `src/main/adapters/types.ts`. They are not parallelisable and the
docs do not pretend otherwise.

| Task | Scope | New deps | Migration | Depends on |
|---|---|---|---|---|
| **[6a-1](Task-6a-1.md)** | **The usage contract.** An `instructions` capability descriptor, a pure snippet core, claude's `--append-system-prompt-file`, codex's composed `developer_instructions`. | **none** | **none** | None |
| **[6a-2](Task-6a-2.md)** | **`index-codebase`.** `git ls-files` + `git log` → `:File` / `:Directory` / `:Commit` upserts, graph migration **v2**, one IPC channel, one button. | **none** | **none** (SQLite); **graph v2** | 6a-1 |
| **[6a-3](Task-6a-3.md)** | **codex's argv (F75).** `PtyLaunchSpec.mcpServers`, the `buildLaunch` composition, env values via `envAdditions`, and the death of the `mcpConfigWrite.ts:179` comment. | **none** | **none** | 6a-2 |
| **[6a-4](Task-6a-4.md)** | **The provisioner.** A `docker` CLI adapter, five IPC channels, container lifecycle in the Memory section. | **none** | **none** — `project_memory`'s Stage-5 columns already exist | 6a-3 |

**⚠ NO TASK IN THIS PHASE AUTHORS A SQLITE MIGRATION, AND THAT IS A MEASURED CLAIM RATHER THAN A
PLAN.** 6a-4's container columns — `container_id`, `container_name`, `volume_name`, `bolt_port`,
`http_port` — were created by v16 and have sat NULL ever since (`schema.ts:686`), deliberately,
*"because `MIGRATIONS.length` moves EXACTLY ONCE in this phase"*. Phase 6 paid for Phase 6a's schema
in advance. **If any task nonetheless finds it needs one, the number is `v20` confirmed at the moment
of writing, never quoted from here** (G6 — the number has decayed three times in this project's
history).

## The purity contract for this phase

- **No new runtime dependency.** The count stays **8**. `dockerode` is refused by D147(d);
  `typescript` is refused by D149; no TOML writer exists and none is added (D49's structural
  evidence, `mcpConfigCore.ts:190`).
- **No user file is written, edited or read for the usage contract.** Not `CLAUDE.md`, not
  `AGENTS.md`, not `~/.codex/config.toml`. D49's bright line is the phase's central constraint, and
  6a-1 is the task that would break it.
- **No app-mediated graph writes** (D126). Agents write through MCP; Chorus measures. The indexer is
  the single exception and it writes only machine-generated structural labels — **never `:Memory`,
  `:Decision`, `:Observation` or `:Risk`**, and never a `:SUPPORTED_BY` edge.
- **No destructive graph path.** Nothing this phase ships can delete a `:Memory`, a provenance edge,
  or a docker volume.
- **`Connected` is still earned by an observed read** (D126). A running container is not a
  connection, and 6a-4 may not colour the chip green for one.

## Verification every task runs

```
npm run typecheck          # 0 errors, node + web
npx vitest run             # never fewer tests than the baseline above
npm run grep:secrets       # clean, 6 patterns
```

Plus, per task, the runtime drive named in its own Verification Commands section — **this project
does not accept a compiled feature as a delivered one** (§3 of the roadmap, step 4).

## ⚠ Pre-existing working-tree state at kickoff

`git status` at `47f633c` shows **one untracked file: `CLAUDE-PROJECT-MARKER.txt`**. It is not this
phase's, it is not to be committed, and it is not to be deleted. **Any task that finds other
modified files must report them rather than reverting or absorbing them.**
