# Task 6-5 — Execution Prompt (paste into a fresh session)

> **⚠ AUTHORED 2026-08-10 against `main` at `402a970`. Every number, path and line reference below was
> re-run at that HEAD while authoring this document.** Where it disagrees with `Task-6-5.md` or
> `ImplementationSpec-6-5.md`, **this document is right and those are stale** — they were written
> 2026-07-28, before Stages 1–3 landed and before the D4 addendum settled opencode's schema. The
> specific corrections are enumerated under *"⚠ SIX WAYS THE TASK DOCS ARE STALE"* and you must read
> that section before you read them.

---

You are the **Coordinator** for **Task 6-5 — `writeMcpConfig` for claude and opencode**, Stage 4 of
Phase 6 and **the last task in the phase**. It is the task that **meets Phase 6's milestone**.

**Repo root:** `C:\Projects\ContactEstablished\Chorus`
**Expected branch:** `main` at `402a970`, or a fresh branch off it — confirm with
`git branch --show-current` and `git log --oneline -1`. **Do not switch branches without instruction.**

---

## ⚠ GATE 0 — THE TREE IS NOT CLEAN, AND TWO OF THE DIRTY FILES ARE NOT YOURS

`git status --porcelain` at authoring time:

```
 M src/renderer/src/assets/main.css
 M src/renderer/src/components/TerminalPane.vue
?? CLAUDE-PROJECT-MARKER.txt
```

**These are Matthew's own in-flight edits, made during the session that wrote this prompt.**

- **Do not revert, stage, commit or "tidy" `main.css` or `TerminalPane.vue`.** They are unrelated to
  this task and touching them would silently fold someone else's work into your commit.
- `CLAUDE-PROJECT-MARKER.txt` is a one-line write-permission probe (`claude-can-write-here`). It is
  **deliberately not committed**. Leave it.
- Run `git status --porcelain` yourself at the start. **If you find MORE than the three above, list
  what you found in your report and still touch none of it.**
- `_verify/` is gitignored working evidence. Never stage anything under it.

**⚠ AND ONE THE G2 TEST WILL CREATE: `.mcp.json` IS NOT GITIGNORED.** Verified 2026-08-10 —
`git check-ignore .mcp.json` matches nothing. claude's mechanism is a **project-scoped** file, so
running the milestone test against the Chorus project writes `.mcp.json` **into this repo's root**,
where it shows up in `git status` as untracked and is one careless `git add .` away from being
committed. **It is test output, not source. Do not commit it.** Deciding whether it should be
gitignored permanently is a real question — **raise it in your report; do not quietly add a
`.gitignore` line as part of this task.**

---

## ⚠ GATE 1 — ENVIRONMENT, AND THE FALSE GREEN IT PRODUCES

**`node_modules` in this repo has been found EMPTY at the start of two separate sessions** (2026-08-09
and 2026-08-10). It is **one shared directory**: every `.chorus` worktree junctions into
`C:\Projects\ContactEstablished\Chorus\node_modules`, so emptying it removes typecheck and vitest from
every worktree at once.

```bash
npm ci                          # not `npm install` — ci installs the lockfile exactly
npm run rebuild:better-sqlite3  # the /Od workaround; .npmrc documents why
```

`.npmrc` explains the rebuild: better-sqlite3 12.11.1 has no `electron-v148` prebuild on npm, so it
source-builds and MSVC 17.14 ICEs (C1001) on `sqlite3.c` at default optimization. `node-pty` needs no
rebuild — its N-API prebuilds ship in-package.

**⚠ THE FALSE GREEN, WHICH HAS NOW FIRED TWICE.** With the toolchain gone, `npm run typecheck` fails
with `'tsc' is not recognized` — which contains **no `error TS`**, so a grep for the compiler's error
string reports a clean pass. **Check the EXIT CODE, and grep for the toolchain's own failure, not only
for `error TS`.**

**Baseline measured 2026-08-10 at `402a970` — write your own down before touching code:**

| Gate | Value |
|---|---|
| `npm run typecheck` | **exit 0**, node + web |
| `npx vitest run` | **1783 passed / 1783, across 52 files**, exit 0 |
| `IpcChannel` | **86** (you add none) |
| `MIGRATIONS.length` | **18** (**you add none — this task has no migration**) |
| `grep -c "sqliteTable(" src/main/db/schema.ts` | **18** (unchanged by this task) |

> **Known flake, recorded as F50:** `src/main/adapters/adapters.test.ts` fails intermittently in
> full-suite runs (observed once in nine) while passing 5/5 in isolation — cross-file interference,
> pre-existing. **⚠ THIS IS THE FILE YOU ARE EDITING, so you will see it.** Re-run before diagnosing.

---

## ⚠ SIX WAYS THE TASK DOCS ARE STALE — READ BEFORE READING THEM

`Task-6-5.md` and `ImplementationSpec-6-5.md` were authored **2026-07-28**. Stages 1–3 have landed
since, CR-6.0 closed as **D126**, and **D128(a)** cut the phase down. Six concrete corrections:

### 1. ⚠ OPENCODE'S SCHEMA IS SETTLED, AND IT IS NOT THE ONE THE SPEC RENDERS

`ImplementationSpec-6-5.md` §1 tells you to render opencode with claude's `{"mcpServers": …}` shape.
**That produces a config opencode rejects.** The real schema, established **three independent ways** —
`Investigations/6-1-D4-Pass.md` **Finding 1** (measured via `opencode debug config` on 1.18.15), the
published schema at `https://opencode.ai/config.json`, and an independent re-fetch on 2026-08-10 that
matched both exactly:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "chorus-memory": {
      "type": "local",
      "command": ["uvx", "mcp-neo4j-cypher"],
      "enabled": true,
      "environment": { "NEO4J_URL": "bolt://127.0.0.1:7688" }
    }
  }
}
```

| | claude `.mcp.json` | opencode |
|---|---|---|
| top-level key | `mcpServers` | **`mcp`** |
| command shape | `command` string **+** `args` array | **ONE `command` ARRAY holding both** |
| env key | `env` | **`environment`** |
| extra required | — | **`type: "local"`** (and `enabled: true`) |
| unknown keys | tolerated | **`additionalProperties: false` — REJECTED** |

**⚠ `renderMcpConfig` (`src/main/adapters/mcpConfigCore.ts:118`) EMITS CLAUDE'S SHAPE FOR BOTH
MECHANISMS TODAY, and its own docblock says so** (*"opencode's own JSON config is known to differ …
whoever wires a real file must settle the schema against the CLI first"*). **One renderer cannot serve
both.**

**⚠ AND THE DESCRIPTOR TYPE CANNOT TELL THEM APART.** `McpDescriptor` (`src/main/adapters/types.ts`)
carries `mechanism` / `format` / `location` / `configPath` / `pathEnvVar` — **no dialect field**. You
must add one. **Do NOT infer the dialect from `mechanism`**: `project-file` happens to mean claude and
`env-named-file` happens to mean opencode *today*, and that coincidence is exactly the accidental
coupling that breaks on the fourth adapter. Name the schema explicitly.

### 2. ⚠ THERE IS NO PASSWORD. MOST OF SPEC §6 IS MOOT.

**D128(a) (ACCEPTED 2026-08-08) took credentialed mode out of Phase 6 entirely — the phase ships
local mode only.** Local mode is `NEO4J_AUTH=none` on loopback, so:

- The rendered config **names no credential and carries no placeholder**. No `${NEO4J_PASSWORD}`, no
  `{env:NEO4J_PASSWORD}`. The spec's §1/§2/§3 examples all show one; **they are wrong for this phase.**
- **H3 cannot fire.** `secretEnv` stays empty, so `composeChildEnv`'s policy flip
  (`src/main/adapters/env.ts:142`, `if (Object.keys(secretEnv).length === 0)`) never happens. The
  conditional UI disclosure the spec asks for has **no condition that can be true this phase** —
  say so in your report rather than building a disclosure nobody can see.
- **H2 has no password to demonstrate with.** `LaunchOptions.secrets` still exists and is still the
  right seam (see correction 5), but a local-mode launch registers **zero** secrets — which
  `sessionManager.ts:649` already comments on in its own words.
- **⚠ THE GUARD STAYS, AND STAYS MANDATORY.** `assertNoSecretInRendered`
  (`mcpConfigCore.ts:177`) runs over bytes that **should be clean by construction**, which makes any
  match a **loud** failure rather than a marginal one. Wire it so it **refuses**, exactly as
  `Task-6-5.md` step 5 requires. Do not weaken it because there is nothing to find.

### 3. ⚠ OPENCODE FAILS OPEN ON AN UNSET VARIABLE — RECORD IT, DO NOT DEPEND ON IT

`6-1-D4-Pass.md` **Finding 3**, measured: an unset `{env:VAR}` resolves to **`""`** — silently, no
error, no warning. **This is the opposite of claude**, which reports `missingVars` and leaves the token
literal. It does not bite this phase (no placeholders exist in local mode) but it means **a future
credentialed opencode mode would silently ship an EMPTY PASSWORD while looking configured.** Carry the
warning into a code comment where the renderer emits `environment`, so whoever ships credentialed mode
meets it at the right place.

### 4. The non-goals quote dead counters

`Task-6-5.md` non-goals say *"`MIGRATIONS.length` **13**, `sqliteTable(` **17**"*. Both are stale.
**Current: 18 and 18.** The intent is unchanged and still binding — **this task adds no migration and
no table** — so assert *"unchanged from baseline"*, not the literal old numbers. (Per **G6**, re-count
after merging rather than trusting any number in any document, including this one.)

### 5. Two file paths in the docs do not exist

- `Task-6-5.md` scope names `src/renderer/src/views/SettingsMemory.vue`. **There is no such file.** The
  memory UI lives in **`src/renderer/src/views/ProjectSettingsView.vue`** (the views directory holds
  `CouncilView`, `ProjectSettingsView`, `SettingsAgentLock`, `SettingsCredentials`,
  `SettingsProviders`, `SettingsView` — and no memory view of its own).
- `ImplementationSpec-6-5.md` §6 cites `LaunchOptions.secrets` at **`sessionManager.ts:99`**. Line 99
  is `type StartListener`. The real seam is **`sessionManager.ts:108`** (`readonly secrets?: readonly
  string[]`), registered at **`sessionManager.ts:609`**
  (`const secrets = [...(opts.secrets ?? []), ...Object.values(request.secretEnv)]`) and passed at
  `:619`.

### 6. Where the adapters actually stand

| Adapter | `mcp` descriptor | Line |
|---|---|---|
| `claude` | **`null`** — you populate it | `src/main/adapters/claude.ts:95` |
| `opencode` | **`null`** — you populate it | `src/main/adapters/opencode.ts:140` |
| `codex` | `CODEX_MCP` (Stage 1, argv) | `src/main/adapters/codex.ts:83` |
| `kimi` | `null` — **stays null, by decision** | `src/main/adapters/kimi.ts:112` |

---

## Goal

**claude and opencode receive a Chorus-written MCP config naming a real Neo4j; codex receives it as
launch argv; and no secret value appears in any file Chorus wrote** — proven by
`assertNoSecretInRendered` over the **rendered bytes**, not by inspection.

**⚠ THIS IS THE FIRST COMMIT IN THIS REPO'S HISTORY THAT WRITES A FILE INTO ANOTHER TOOL'S
CONFIGURATION.** Everything before it either passed argv or wrote inside `%APPDATA%\chorus`. **D49 and
the AUTH-PRECEDENCE FINDING exist because the obvious way to do this is the forbidden way.**

**⚠ AND WRITING THE FILE DOES NOT MEET THE MILESTONE.** Measured on claude 2.1.225 and stated by the
CLI's own `claude mcp --help`: *"Unapproved `.mcp.json` servers are shown as ⏸ Pending approval and
not connected to."* **Approval is interactive and Chorus is forbidden to automate it** (see
*Bright lines*). The milestone is **an agent answering a question from the graph**, not a file
existing.

---

## Ground yourself first — read before editing

**Authoritative, read in full:**
- `docs/Features/Foundation/Tasks/Task-6-5.md` — scope, non-goals, acceptance criteria. **Read the
  six corrections above first.**
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-6-5.md` — the how. **§1/§2/§3's
  password examples are void; §4's guard wiring and §2's merge/atomic rules are binding.**
- `docs/Features/Foundation/Investigations/6-1-D4-Pass.md` — **the D4 evidence. Findings 1–4 near the
  end are the ones this task rests on.** Quote Finding 1 in your commit.
- `docs/Features/Foundation/Phase-6-MemoryPlan.md` **§2** — the security design in full.

**Roadmap** (`docs/Features/Foundation/roadmap.md`) — all RESOLVED, quote as constraints:
- **D49 (RESOLVED 2026-07-24)** — the bright line on writing another CLI's auth/config.
- **D88 (RESOLVED 2026-07-27)** — the three env lists. `BASELINE_ENV_VARS` is **COPY-FROM**, not
  IMPOSE and not REMOVE. Editing the wrong one yields a working pane and a broken security property.
- **D89 (RESOLVED 2026-07-27)** — the invariant that `envAdditions` is the non-secret channel.
- **D93 (ACCEPTED 2026-07-28)** — names, never values.
- **D126 (ACCEPTED 2026-08-08)** — CR-6.0; **Q6 mandates the four-state model** and was the run's only
  unqualified `APPROVED`.
- **D128 (ACCEPTED 2026-08-08)** — **(a) local mode only**; (c) Phase 6 ships the measurement, not the
  consequence.
- **G6 (2026-08-10)** — re-count shared counters after merging.
- **G2** — run it, do not just compile it.

**Code to inspect — line numbers verified 2026-08-10 at `402a970`; re-confirm before quoting.**

| File | Line | Why |
|---|---|---|
| `src/main/adapters/mcpConfigCore.ts` | `118` (`renderMcpConfig`), `177` (`assertNoSecretInRendered`) | The renderer you split per-dialect, and the guard you must not bypass. |
| `src/main/adapters/types.ts` | `McpDescriptor`, `McpWriteResult`, `SupportsMcp` | **Add the dialect field here.** Note `SupportsMcp` requires BOTH methods — a file adapter's `mcpLaunchArgs` returns `[]`. |
| `src/main/adapters/codex.ts` | `83` (`CODEX_MCP`), `176` | The worked example of a descriptor + both methods. |
| `src/main/adapters/adapters.test.ts` | `619` (`MCP_SUPPORT`), `634`, `708` | The capability table. **`:630` asserts the table names every registry adapter — a new key must decide.** |
| `src/main/adapters/env.ts` | `10` (`BASELINE_ENV_VARS`), `142` (the policy flip) | Only touch if a **measured** failure demands it. |
| `src/main/services/sessionManager.ts` | `108`, `609`, `619`, `649` | `LaunchOptions.secrets` and where it is registered. |
| `src/main/services/memoryService.ts` | `129` (`MemoryService`), `144` | The only module that decrypts. It assembles the `McpServerRef` and calls the writers. |
| `src/main/adapters/mcpConfigCore.test.ts` | whole file | The cross-product property test you extend to three mechanisms. |

---

## Implementation scope

- **Edit `src/main/adapters/types.ts`** — add the dialect discriminator to the file-mechanism variants.
- **Edit `src/main/adapters/mcpConfigCore.ts` + `.test.ts`** — per-dialect renderers. **Still pure —
  no `fs` in this module.** Render with `JSON.stringify(obj, null, 2)`; no hand-assembled JSON.
- **Edit `src/main/adapters/claude.ts`** — descriptor (`project-file`, `.mcp.json`, claude dialect) +
  `writeMcpConfig`.
- **Edit `src/main/adapters/opencode.ts`** — descriptor (`env-named-file`, `%APPDATA%\chorus\mcp\`,
  `pathEnvVar: 'OPENCODE_CONFIG'`, opencode dialect) + `writeMcpConfig`, and set `OPENCODE_CONFIG` on
  the launch via `envAdditions` (**a PATH, so `envAdditions` is exactly right — contrast a password,
  which would violate D89**).
- **Edit `src/main/adapters/adapters.test.ts`** — the capability table: **two `false` → `true`.**
- **Edit `src/main/services/memoryService.ts`** — assemble the `McpServerRef`, call the writers.
- **Edit `src/renderer/src/views/ProjectSettingsView.vue`** — the four-state model surface
  (**D126 Q6**), if and only if you can drive it. See *Non-goals* on what not to invent.

### Binding rules

- **⚠ MERGE, DO NOT CLOBBER, AND REFUSE RATHER THAN GUESS.** `.mcp.json` is a **project** file the
  user may own servers in. Read it, parse it, replace **only** the `chorus-memory` key, write the rest
  back untouched. **If it exists and does not parse, refuse with a reason naming the file** — silently
  overwriting a broken-but-precious config is worse than declining.
- **⚠ ATOMIC WRITES.** Temp + rename, with the temp file **beside the target, not in `TEMP`** (rename
  is only atomic on the same volume). A CLI reading a half-written config gets a parse error at best.
- **⚠ THE GUARD MUST BE STRUCTURALLY UNBYPASSABLE.** The order is
  `render → assertNoSecretInRendered → refuse OR write`. Make the write helper **take the guard's
  result as a required argument**, so a caller that has not run it **cannot compile**. *"A convention
  that the guard is called first is exactly what fails in the fourth adapter someone adds."*
- **Zero servers → `{ok:false, reason}`.** A zero-server write would truncate a config the user
  authored. **`writeMcpConfig` refuses; it never throws.**
- `knownSecrets` comes from `memoryService` — **the adapter never resolves a credential itself.**

### Bright lines — do not cross

- **⚠ NEVER WRITE ANOTHER CLI'S APPROVAL OR TRUST RECORD.** Chorus writes **configuration** only.
  Pre-approving would bypass a human trust gate and couple Chorus to undocumented internals. **The
  council was unanimous.** If the milestone needs approval, **a human approves it.**
- **⚠ NEVER `~/.codex/config.toml`, never `~/.claude/settings.json`, never a `--settings` file, never
  an `apiKeyHelper` script** (D49, verbatim). codex is **argv-only** and must remain observably so.
- **⚠ NO TOML WRITER, EVER.** Its absence from `package.json` is the machine-checkable evidence that
  `~/.codex/config.toml` is never written. `git diff -- package.json` must be **empty**.
- **⚠ KIMI KEEPS `mcp: null` AND `kimi: false`, AS A DECISION.** Keep the load-bearing comment: no
  evidence of env interpolation at 0.29.1. **D87's authorization to write `~/.kimi-code/config.toml`
  does not extend to writing a secret there.**

---

## Strict non-goals

- **No Stage 5.** No container, no `dockerode`, no `docker` CLI, no provisioning, no `skill.yaml`, no
  `index-codebase`. **Chorus starts no container in this phase** — the human starts it by hand.
- **No migration, no table, no IPC channel.** `MIGRATIONS.length` **18**, `sqliteTable(` **18**,
  `IpcChannel` **86** — all unchanged.
- **No new dependency.** `package.json` diff empty.
- **⚠ Do not route anything secret through `envAdditions`** — the plausible-looking wrong fix that
  destroys the invariant **D89 just repaired**. `OPENCODE_CONFIG` (a path) is correct there; a
  password never would be.
- **Do not invent a connection state you did not observe.** `Connected` is **earned by an observed
  probe read**, never by a written file (D126 Q6). If you cannot drive the state machine end to end,
  **ship what you can prove and say plainly what is unproven** — a green dot that means "we wrote a
  file" is exactly the dishonesty this phase's CR was called to prevent.
- Do not revert, stage or commit unrelated files (Gate 0).
- Do not push or open a PR unless explicitly asked.

---

## Required workflow

1. **Gates 0 and 1 first.** Record your own baseline before touching code.
2. Read the six corrections, then both task docs, then `6-1-D4-Pass.md` Findings 1–4.
3. Implement as a **coordinator**: worker pass → review against `ImplementationSpec-6-5.md` clause by
   clause (**noting which clauses the six corrections void**) → a code-quality pass → resolve findings
   → verification → commit narration.
4. **One intentional commit (G3)**, house style: a concise title, then a plain-language description a
   non-technical reader can follow first, technical detail second under a `--- technical ---` divider.
   **Quote 6-1's Finding 1 (the opencode schema) in the message** — it is the fact the whole mechanism
   rests on.
5. If any instruction here conflicts with `CLAUDE.md`, **`CLAUDE.md` wins** — say so in your report.

---

## Verification — run these, do not reason about them

```bash
npm run typecheck          # must exit 0 — check the EXIT CODE, not just for "error TS"
npx vitest run             # must pass; count >= 1783 across >= 52 files
npm run grep:secrets       # must be clean
git diff -- package.json   # MUST BE EMPTY — no TOML writer, no dep
grep -c "sqliteTable(" src/main/db/schema.ts   # 18
grep -n "kimi" src/main/adapters/adapters.test.ts  # still false, with its reason
```

**⚠ THE VERIFICATION G4 CANNOT PERFORM — run it by hand and PASTE THE OUTPUT IN YOUR REPORT.**
`npm run grep:secrets` scans `src/`, `scripts/`, `_verify/`, `package.json` and root configs. It does
**not** reach the files Chorus writes. This grep is what replaces it:

```bash
grep -rniE "neo4j.?password|bolt://[^ ]*:[^ ]*@|[A-Za-z0-9_-]{32,}" \
  "$APPDATA/chorus/mcp/" "C:/Projects/ContactEstablished/Chorus/.mcp.json"
```

**And the file that must not have changed at all** — hash before and after:

```bash
sha256sum ~/.codex/config.toml
```

**Property-test proof (mandatory):** the cross-product test must **go red if any renderer leaks a
value**. **Break one locally, watch it fail, revert, and say so in your report.** *A green property
test that cannot fail is decoration.*

---

## ⚠ THE MILESTONE (G2) — MATTHEW RUNS THIS PART

**Do not attempt to start a Neo4j container yourself, and do not attempt to approve the MCP server in
claude.** The first is Stage 5's territory and this phase starts no containers; the second is a human
trust gate this task is forbidden to automate.

**When your implementation is green and committed, STOP and hand Matthew the instructions below.**
Then execute the drives **with** him: he does the container, the approval and the final question; you
drive Chorus, read the DB, and record what actually happened.

**Report the milestone as `NOT RUN` until an agent has answered a question from the graph.** A config
file existing is not the milestone. *"A memory chip that renders is not a memory graph that answers."*

---

# 📋 SETUP INSTRUCTIONS FOR MATTHEW — the live G2 test

*Self-contained. Hand this section over verbatim; it assumes no prior context.*

## What you are proving

That a **real agent**, launched from Chorus, reaches a **real Neo4j** through a **config Chorus
wrote**, and **answers a question using it**. Phase 6's milestone is met at this step and nowhere
earlier.

## Before you start

- **Docker Desktop must be running.** Verified present on this machine: Docker **28.0.4**.
- Nothing else may be on port **7688**.
- This uses an **auth-disabled** database on loopback only. That is the phase's design (**D128(a)**,
  local mode only) — there is no password anywhere in this flow, which is why nothing secret can leak
  into a config file.

## Step 1 — Start the Neo4j container

Same command Task 6-3's G2 used (`ImplementationSpec-6-3.md:275`):

```powershell
docker run -d --name chorus-g2-neo4j -e NEO4J_AUTH=none -p 127.0.0.1:7688:7687 neo4j:5-community
```

Wait ~20–30 seconds for it to finish booting, then confirm it is up:

```powershell
docker logs chorus-g2-neo4j --tail 20     # look for "Started."
docker ps --filter name=chorus-g2-neo4j   # STATUS should read "Up"
```

> **If port 7688 is taken**, change the LEFT half only (`-p 127.0.0.1:7689:7687`) and use the new port
> everywhere below. The right half must stay `7687` — that is the port inside the container.

## Step 2 — Put one node in the graph by hand

**Do this before asking any agent anything.** An agent that finds an empty graph and says "I found
nothing" has proven nothing — you cannot tell that from a broken connection.

```powershell
docker exec -i chorus-g2-neo4j cypher-shell -d neo4j "CREATE (m:Memory {key:'chorus-g2-probe', note:'The milestone canary for Task 6-5'}) RETURN m;"
```

Confirm it is there:

```powershell
docker exec -i chorus-g2-neo4j cypher-shell -d neo4j "MATCH (m:Memory) RETURN m.key, m.note;"
```

You should see `chorus-g2-probe` and its note.

## Step 3 — Point Chorus at it

1. Launch Chorus (the dev build the session has been working in, **not** your installed copy — the
   assistant will tell you which and will not touch your installed app).
2. Open **Project Settings → Memory** for the project you are testing.
3. Choose **local** mode and set the bolt URI to:
   ```
   bolt://127.0.0.1:7688
   ```
4. Click **Test**. **You must see a successful probe (`probe: 1`) before going further.** If this
   fails, stop — nothing downstream can work, and the fault is the container or the URI, not the MCP
   wiring.
5. Click **Seed** to write the schema and provenance (Task 6-4's seeder).

## Step 4 — Launch each agent and check what Chorus wrote

For each of **claude**, **opencode** and **codex**, launch a session in that project from Chorus.

Then look at the files, because this is the security property the whole task exists for:

```powershell
# claude — a project-scoped file, in the project root
type C:\Projects\ContactEstablished\Chorus\.mcp.json

# opencode — a Chorus-owned file, NOT in your repo and NOT in your global config
type $env:APPDATA\chorus\mcp\opencode.json

# codex — there must be NO file. It gets argv only, and this file must be untouched.
Get-FileHash $env:USERPROFILE\.codex\config.toml
```

**What "correct" looks like:** the claude file uses `mcpServers`; the opencode file uses `mcp` with
`type: "local"` and a single `command` array. **Neither contains a password**, because in local mode
there is not one to contain.

## Step 5 — ⚠ Approve the server in claude (only you can do this)

Claude Code treats a Chorus-written `.mcp.json` as **untrusted until a human approves it** — its own
help text says unapproved servers are *"not connected to."* **Chorus is forbidden to write that
approval**, deliberately: doing so would forge your consent to run a program.

In the **claude** pane in Chorus:

1. Type `/mcp` and press Enter, **or** just interact with the session — Claude Code prompts about the
   new server on its own.
2. When it asks whether to trust `chorus-memory`, **approve it**.
3. Confirm it took:
   ```
   claude mcp list
   ```
   `chorus-memory` should no longer say **⏸ Pending approval**. A health-checked, approved server is
   what you want to see.

> If it still says pending, the approval did not register — re-run `/mcp` in the pane. Do not let
> anyone "fix" this by editing a claude settings file; that is the bright line.

## Step 6 — 🎯 The milestone: ask a question only the graph can answer

In the **claude** pane, ask:

```
Using the chorus-memory MCP server, look up the Memory node whose key is
'chorus-g2-probe' and tell me its note text.
```

**The milestone is met when the agent answers with the note text you wrote in Step 2**
("The milestone canary for Task 6-5"). It cannot invent that string — it is only in your database.

Repeat the same question in the **opencode** pane. For **codex**, the server arrives as launch argv
rather than a file, so it needs no approval — that is the control case, and it should just work.

## Step 7 — Tear down

```powershell
docker rm -f chorus-g2-neo4j
```

The container is disposable and holds nothing you need. **Chorus never started it and never stops
it** — that is Stage 5's job and Stage 5 is not built.

Optionally, remove the test config files if you do not want them lying around:

```powershell
del C:\Projects\ContactEstablished\Chorus\.mcp.json
del $env:APPDATA\chorus\mcp\opencode.json
```

## If something goes wrong

| Symptom | Most likely cause |
|---|---|
| **Test** button fails in Chorus | Container not up yet, or wrong port. Re-run `docker ps`. |
| Agent says it has no such tool | The MCP server never connected. For claude, check Step 5's approval. |
| `uvx` errors in the pane | The MCP server is `mcp-neo4j-cypher` from **PyPI via `uvx`** (uv 0.11.19 is installed). First run downloads it — give it a moment. |
| Connects but finds nothing | You skipped Step 2. An empty graph proves nothing. |
| opencode ignores the server | Its config schema is strict (`additionalProperties: false`) — a wrong key is silently rejected. This is a **code bug**, report it. |

> **Environment facts, measured 2026-08-08 and re-confirmed 2026-08-10:** the server package is
> `mcp-neo4j-cypher` **0.6.0** (PyPI, via `uvx`); it reads **`NEO4J_URL`** — which beats `NEO4J_URI` —
> and **`NEO4J_USERNAME`**, not `NEO4J_USER`; and it connects fine against an auth-disabled database.

---

## Failure honesty

If a verification command fails for an unrelated environment reason, **capture the exact output,
explain it, and do not claim success.** A gate you could not run is reported as **not run** — never as
passed, never silently omitted.

**Three false-green traps this repo has already produced, all real:**
- A missing toolchain makes `npm run typecheck` fail with `'tsc' is not recognized`, which contains no
  `error TS`. **Check exit codes.**
- A passing unit test says nothing about runtime behaviour. **Do not infer a passing runtime result
  from a passing suite.**
- **A written config file is not a connected MCP server.** claude reports an unapproved server as
  `⏸ Pending approval` and does not connect to it. **Do not report the milestone from the existence of
  a file.**

If the runtime gates cannot be driven (no Docker, no approval, agent will not connect), report
`DONE_WITH_CONCERNS` or `BLOCKED` with the evidence, and say exactly which of Steps 1–6 was reached.

---

## Final report — required structure

1. **Status:** `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`.
2. **The six staleness corrections** — which you confirmed, and anything else you found stale.
3. **Files changed**, with a one-line reason each.
4. **Build results:** typecheck exit code, vitest counts **before and after** (baseline 1783/52),
   secret-grep status, `package.json` diff empty, `sqliteTable(` still 18, `IpcChannel` still 86.
5. **The two greps G4 cannot do** — the written-file secret grep and the `~/.codex/config.toml` hash,
   before and after. **Paste the output.**
6. **Property-test proof** — what you broke, how it failed, that you reverted it.
7. **Runtime results:** what was actually observed at each of Steps 1–6, including **the exact answer
   the agent gave in Step 6**. If a step was not reached, say which and why.
8. **Review outcomes:** spec-compliance findings (naming the clauses the corrections voided) and
   code-quality findings, and how each was resolved.
9. **Non-goals confirmation:** no migration, no table, no channel, no dependency, no TOML writer,
   kimi still `false` by decision, `~/.codex/config.toml` byte-identical, nothing secret through
   `envAdditions`.
10. **The four-state model:** which states you could drive and observe, and which you could not.
    **Be explicit about anything unproven.**
11. **Residual risks and recorded findings** — anything found and deliberately not fixed.
12. **Final `git status`** (the three Gate 0 entries should still be there, untouched) and the commit
    hash.
