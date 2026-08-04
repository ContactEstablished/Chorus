# Phase 6 — Neo4j Project Memory: design plan

**Status:** PRE-KICKOFF DESIGN. Authored 2026-07-28, against the codebase at
`35a592f`. **No code, no dependencies, no migration were written by the session
that produced this document.**

**Authority:** this document is subordinate to `roadmap.md` (§2's authority
split: the roadmap wins on current status) and supersedes `Plan.md` §10 only on
the four points D94 names. It exists so that Phase 6's `/phase-kickoff` starts
from settled design questions rather than re-deriving them.

**Sequencing:** Matthew's ruling, 2026-07-28 — **plan now, execute after 3e.**
The committed queue 3c → 3d → 3e is unchanged; this document does not reorder
it and no decision here licenses starting Phase 6 early.

**⚠ Every D4 fact in §10 was obtained 2026-07-28 and MUST be re-verified at
execution time.** Phase 6 runs several phases from now, and CLAUDE.md's standing
rule is explicit that CLI syntax moves fast. The findings are dated and
attributed by *how they were obtained*, because they are not equally strong.

---

## 1. Why this phase needs a plan before its kickoff

Neo4j project memory is in the product one-liner (`Plan.md:4`) and specified at
`Plan.md` §10, but **zero code exists** — no `neo4j-driver`, no `dockerode`, no
`memory_*` schema, no provisioner. Three things would otherwise be discovered at
the worst moment:

1. **Two of Phase 6's listed deliverables are already spent.** The roadmap entry
   still assigns it D34 Q5's adapter-registration seam and the widen-together
   rule — but **D86 lifted the freeze in Phase 3d and D90 widened the registry
   again**. A kickoff reading the old entry would inherit a false scope.
2. **The MCP seam is inert but wrong-shaped** (§3). It cannot express the
   mechanism this phase needs, and the vocabulary it *does* offer points
   directly at the file D49 forbids writing.
3. **`Plan.md` §10 is wrong in four checkable places** (§4). Finding that out at
   execution time means finding it out with a container already running.

---

## 2. The security design

Wiring a Neo4j MCP server into a CLI ordinarily means putting a bolt password
into that CLI's own on-disk config. **The repo forbids exactly that** — see the
AUTH-PRECEDENCE FINDING in §"Open items Phase 3 inherits" and D49: never write a
key into `~/.codex/config.toml`, a `--settings` file, or an `apiKeyHelper`
script, because each persists a decrypted credential outside DPAPI and outside
the vault, a threat model D33 never reviewed.

**The line is not about which file.** It protects four properties: no decrypted
secret at rest outside the DPAPI blob; vault lifecycle retained (rotate, revoke,
mark-unavailable); Chorus owns what it writes; and **detectability** — note that
`npm run grep:secrets` covers `src/`, `scripts/`, `_verify/` and root configs,
and reaches **neither** `~/.codex/` **nor** a project's `.mcp.json`.

### Resolution, per mode

- **Local Docker (default): `NEO4J_AUTH=none`, bolt and http published to
  `127.0.0.1` only.** There is no secret, so there is nothing to write, nothing
  to decrypt, and no vault interaction at any point in the container's life.

  The reasoning stated properly, because it looks like a weakening and is not:
  DPAPI's threat model is *another user account* and *an offline disk*. It is
  **not** *another process running as this user* — such a process can read
  `chorus.db` and call `CryptUnprotectData` regardless. A loopback-bound
  auth-disabled Neo4j is therefore **no more exposed to the adversary DPAPI
  actually addresses**, and strictly *less* exposed in the dimension that
  differs: there is no credential to steal, replay, or leak into a transcript.
  **Manufacturing a password whose only purpose is to be handed to a config file
  creates the problem the rest of the design then has to solve.**

- **Existing / Aura:** the password lives in `credential_profiles`, is decrypted
  per launch, and **only its variable NAME travels** — codex via
  `-c mcp_servers.<name>.env_vars=[NAME]` (no file at all), claude via `${NAME}`
  in `.mcp.json`, opencode via a **Chorus-owned** file under
  `%APPDATA%\chorus\mcp\` reached by `OPENCODE_CONFIG` — never the repo, never
  the user's global config. This is the same class of fact D47/D49 already
  ratified for `model_providers.<key>.env_key`: **a name in argv, not a value.**

- **kimi keeps `mcp: null`** until its config location and interpolation
  behaviour are established (§10). The capability-honesty test makes that free
  and honest rather than a silent omission.

### Rejected: a scoped, low-value generated password written to the config file

Not because the secret is cheap, but because a key in a vendor file **cannot be
rotated by the vault, revoked by `deleteProfile`, or seen by `grep:secrets`** —
and it establishes the precedent that Chorus writes secrets into vendor files
when the secret is judged low-value. **The next such judgement gets made by
someone who never read D33.** That is how bright lines die. "Low value" is also
not obviously true: the graph will hold the project's decisions, architecture,
file map and agent observations — the most concentrated description of the
codebase in the app.

### Three hazards to carry into the task docs, not discover

- **H1 — argv is world-readable** (`Get-CimInstance Win32_Process`), the same
  fact `types.ts:170` records against `extraArgs`. codex's mechanism carries
  only names, so this is no widening over the existing
  `-c model_providers.x.env_key=` line — but say so explicitly rather than
  leaving it to be re-derived.
- **H2 — the secret reaches a grandchild.** Chorus → codex → `uvx` → the MCP
  server. `SessionOutput`'s scrubber sees the PTY stream, so an MCP server that
  prints its own password to stderr surfaces it in the pane. **Mitigation costs
  one line:** register the value via `LaunchOptions.secrets`
  (`sessionManager.ts:99`), exactly as a BYOK key is. The seam exists and is
  proven (D45(1), 19 streamed chunks).
- **⚠ H3 — the `composeChildEnv` policy flip, and this is the non-obvious one.**
  `env.ts:142` selects its policy on `Object.keys(secretEnv).length === 0`.
  Turning **credentialed** memory on for a **subscription** session would put a
  value in `secretEnv` for the first time and silently flip that pane from
  "inherit `process.env` wholesale" to the eight-variable allow-list — **the
  developer's ambient environment vanishes from a pane that worked yesterday.**
  Accept the flip and surface it in the UI. **Do NOT "fix" it by routing the
  password through `envAdditions`**: that would put a secret in the channel D33
  defines as non-secret and destroy the structural invariant D89 just finished
  repairing. Note that local mode's `NEO4J_AUTH=none` makes H3 disappear
  entirely — `secretEnv` stays empty.

### One structural guard, not a convention

A pure `assertNoSecretInRendered(rendered, knownSecrets): Refusal | null` runs
over the **rendered bytes** of anything Chorus writes to a CLI config file or
emits as MCP argv, reusing `scrubber.ts` + `secret-patterns.json`. It **refuses
the write**. Precedent: `headersContainSecret` (`ipc.ts:1350`).

Also update `scripts/secret-grep.mjs`'s scope comment to record that CLI config
files are **outside its reach** — the guard is where the coverage is, and a
gate that is believed to cover more than it does is worse than one that states
its limit.

**A machine-checkable corollary worth narrating in the commit:** if this design
is followed, Phase 6 adds **no TOML writer dependency**, and its absence from
`package.json` is evidence that `~/.codex/config.toml` is never written.

---

## 3. Three defects in the already-declared MCP surface

These are in `src/main/adapters/types.ts` **today**, and must be fixed in Stage 1
because as written they nudge an implementer toward the violation §2 forbids.

1. **`McpDescriptor` (`types.ts:88`) assumes every adapter writes a file** —
   `{mode, format:'json'|'toml'|'yaml', location, configPath}`. codex's
   mechanism is per-launch argv and is **not expressible**; the only shape that
   fits codex is `{format:'toml', location:'home', configPath:'.codex/config.toml'}`
   — i.e. **the type's own vocabulary names the forbidden file.** Needs a
   discriminant: `type McpMechanism = 'launch-args' | 'project-file' | 'env-named-file'`,
   with `format`/`location`/`configPath` present only on the file variants.
2. **`McpServerRef` (`types.ts:337`) cannot express env indirection** —
   `{name, command, args}` has no `env`. **The entire recommended security
   mechanism is currently untypeable.** Add
   `env?: Readonly<Record<string,string>>` (values may be `${NAME}` /
   `{env:NAME}` placeholders) and `envPassthrough?: readonly string[]` (codex's
   `env_vars`).
3. **`writeMcpConfig` returns `Promise<void>` (`types.ts:343`)** — no refusal
   channel, contrary to the house `{ok:false, reason}` idiom, and there is
   nothing to *write* for codex at all. Return `Promise<McpWriteResult>`, with a
   sibling `mcpLaunchArgs(servers): readonly string[]` for the argv mechanism.

**⚠ The capability-honesty test must be SPLIT, not loosened.**
`adapters.test.ts:497` currently asserts `supportsMcp` is false for every
adapter. Keep the `supportsHooks` / `supportsResume` arms blanket-false; replace
the mcp arm with an **explicit table** (`{claude:true, codex:true,
opencode:true, kimi:false, none:false}`) so a future adapter is **forced to
decide** rather than inherit an answer. The generic declared-iff-implemented
test at `:507` stays **byte-identical** and starts doing real work — it has been
vacuous since Phase 3.

---

## 4. Where `Plan.md` §10 is wrong

Recorded as **D94**. Annotate the spec; do not rewrite it — the D42/LiteLLM
precedent is that the roadmap wins and the spec is left standing.

1. **"Uniqueness on `File.path` / `Class.fqn`" breaks on worktrees** — Chorus's
   own core feature — and on any project with more than one repository. Must be
   **composite with a repo key**: `(File.repo, File.path)`, `(Class.repo, Class.fqn)`.
2. **"One database per project" is not achievable on `neo4j:5-community`**
   (multi-database is Enterprise). Superseded by **D92**: the boundary is the
   **container**, and each container's default `neo4j` database serves exactly
   one project — which delivers the isolation §10 was reaching for, without an
   Enterprise licence.
3. **`confidence: number` should be dropped.** Self-reported LLM confidence is
   uncalibrated, not comparable across models, and **will be read as rigor** —
   the failure D55 legislated against. Replace with checkable facts:
   `assertedBy` (model id + adapter id) and a **derived** `corroborations` count
   of independent `:SUPPORTED_BY` sources.
4. **Relationships, not string properties, for the three fields that matter.**
   `supersededBy` as a string makes the commonest query a scan — model it as
   `(:Memory)-[:SUPERSEDES]->(:Memory)` with `validTo` set on the superseded
   node, so "current facts" becomes the indexable `WHERE m.validTo IS NULL`.
   `sourceReference` keeps its human-readable citation **and** carries a real
   `(:Memory)-[:SUPPORTED_BY]->(:File|:Commit)` edge, or provenance is
   unverifiable. `agentSessionId?` becomes `(:AgentSession)-[:PRODUCED]->(:Memory)`
   — attribution is the whole point of this phase, and **the optional field is
   the one that gets omitted.**

### The unstated consequence of "agents write via MCP directly in v1"

**Chorus then cannot ENFORCE provenance.** The MCP write tool takes Cypher, and
nothing stops an agent creating a `:Memory` with no source and no session. Say
that plainly rather than implying a guarantee that does not exist — and ship
`memory:validate` as the answer: a query reporting *"43 of 512 memories have no
source."*

That converts an unenforceable rule into a **measured** one, which is the same
move `attributionCore`'s "% of spend attributed" already makes, and it is a
direct answer to the CR's own question — *what memory schema and provenance
model keeps agent-written knowledge trustworthy and attributable?*

---

## 5. The five stages

| # | Stage | New deps | Ships |
|---|---|---|---|
| 0 | **CR brief + D4 pass** | — | The council gate fires. No code. |
| 1 | **MCP capability honesty + codex wiring** | **none** | `supportsMcp()` returns true for the first adapter. |
| 2 | **Connect to an existing Neo4j** | `neo4j-driver` | Migration **v14** (⚠ corrected from v13, 2026-08-01 — see §6), `memory:*` IPC, Settings surface, status chip. |
| 3 | **Graph schema + provenance + validator** | — | Seeded constraints, versioned graph migrations, provenance completeness report. |
| 4 | **`writeMcpConfig` for claude + opencode** | — | **⚠ MILESTONE MET.** The first commit that writes another tool's config file. |
| 5 | **Docker provisioner, then skills** | `dockerode` *or* none | One-click provision; `skill.yaml`, `index-codebase`. |

**Stage 1 goes first because it writes nothing.** codex's MCP mechanism is
per-launch argv, which `codexAdapter.buildLaunch` already emits tokens into for
the D47 route. **The first MCP commit therefore cannot cross a bright line by
construction**, and needs no file-writing guard yet.

**Stage 2 before Stage 5 is the load-bearing ordering choice.** "Connect to an
existing Neo4j" is smaller than the provisioner, and — more importantly — it
lets the schema and provenance work of Stage 3 be proven against a real graph
**without simultaneously debugging container lifecycle**. Two hard problems in
one commit is how a phase loses a week.

---

## 6. Schema shape (Stage 2, migration v14)

**⚠ CORRECTED 2026-08-01 — THIS SECTION SAID `v13` AND `=== 13`, AND IT WAS RIGHT WHEN WRITTEN.**
`MIGRATIONS.length` was **12** at `35a592f` (`storage.ts:75`, last entry `model_shortlist`), so v13
was genuinely free on 2026-07-28. It has since been spent by unrelated work — `projects.color` +
`projects.description`, which names itself v13 at `schema.ts:20` — making `MIGRATIONS.length` **13**
(now at `storage.ts:95`) and the next free version **14**. This is the first time in the project's
history that a waiting phase's fixed migration number has decayed.

**Standing rule applies and OUTRANKS the number above: assert `MIGRATIONS.length + 1 === 14`
before appending and STOP on divergence** rather than renumbering. **⚠ The displacing v13 is
UNCOMMITTED**; if it is reverted the assertion fails at 12 and the correct response is still stop
and report, not "the plan says 14".

`Plan.md` §13 puts `memory_mode` / `neo4j_container_id` / `neo4j_bolt_port` /
`neo4j_http_port` on `projects`. **Use a separate `project_memory` table
instead** — the D85 precedent, where `model_shortlist` was split off
`model_catalog` because *"a `favourite` column on a cache row would make one
table mean two things."*

The same argument applies with more force here: **`mode` is durable user
intent, while `container_id`/ports are OBSERVED runtime facts about a resource
that vanishes behind the app's back** — and D92 makes that the *expected* case,
not an error. Different writers, different lifetimes, different homes. `projects`
is also the app's hottest table (`getOrCreateProject`, `listProjects`, the 3c
rail), and "turn memory off" should be a DELETE rather than four coordinated
NULLs.

```sql
-- v14 (Phase 6): per-project memory configuration.  [corrected from v13, 2026-08-01]
-- ⚠ THERE IS NO PASSWORD COLUMN HERE, IN ANY FORM, AND THERE MUST NEVER BE ONE.
--   A credentialed mode NAMES a credential_profiles row; the secret stays in the
--   DPAPI envelope and is resolved per launch by vault.decryptForLaunch (D93).
CREATE TABLE project_memory (
  project_id            TEXT PRIMARY KEY REFERENCES projects(id),
  mode                  TEXT NOT NULL,           -- 'local-docker' | 'existing' | 'aura'
  bolt_uri              TEXT NOT NULL,
  database_name         TEXT NOT NULL,           -- 'neo4j' — Community has exactly one
  auth_mode             TEXT NOT NULL,           -- 'none' | 'credential'
  credential_profile_id TEXT REFERENCES credential_profiles(id),
  container_id          TEXT,                    -- OBSERVED; reconciled at boot
  container_name        TEXT,                    -- chorus-neo4j-<slug>, human-readable (D92)
  volume_name           TEXT,
  bolt_port             INTEGER,
  http_port             INTEGER,
  schema_version        INTEGER NOT NULL DEFAULT 0,  -- a CACHE; the graph is authority
  last_seeded_at        TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
```

**FK rulings, in the D62 idiom.** These rows are **live instructions, not
history**, so they carry real `REFERENCES` — the inverse of `dispatches` /
`model_catalog` / `model_shortlist`:

- `projects(id)` — **enforced.** A memory config naming a deleted project is a
  lie, not a historical fact.
- `credential_profiles(id)` — **enforced, RESTRICT, and the FK's job is to make
  the refusal MANDATORY rather than to author it.**
  **⚠ `credential:delete` today counts TWO dependents**
  (`countLaunchProfilesForCredential`, `countCouncilMembersForCredential`).
  **A third is required** — `countProjectMemoryForCredential` — or the first
  delete of a memory credential surfaces a raw
  `SQLITE_CONSTRAINT_FOREIGNKEY` straight through a flow that has worked since
  Task 3-2. **This is precisely the defect D62 records and 3a-5 already paid
  for**, and it goes in the task doc as an explicit step. Per 3b-2's lesson, the
  new guard must be isolated on a route where **no pre-existing guard can mask
  it** — an earlier 3a-5 run proved nothing because the 3-2 guard fired first.
- `container_id` gets no constraint — it is reconcilable, like `worktrees`.

---

## 7. IPC surface (Stage 2+)

Four layers as always: schema in `src/shared/ipc.ts` → `ipcMain.handle` in
`src/main/ipc.ts` parsing **in and out** → thin forwarder in
`src/preload/index.ts` (**no Zod — CSP**) → a new
`src/renderer/src/stores/memory.ts`. Refusals are `{ok:false, reason}` unions,
never thrown. Snapshot reactive payloads before sending (D14).

| Channel | Notes |
|---|---|
| `memory:get` | **No password field**, and no bolt URI that could embed credentials. Extend `ipc.test.ts`'s key-set assertion — that is the discipline that catches a password field being added later, and it is the whole reason D85's headcount test was updated rather than relaxed. |
| `memory:configure` / `memory:disable` | Takes a credential **id**, never a key (D33 clause 2). Disable deletes the row; it does **not** destroy data. |
| `memory:status` | **⚠ PURE READ — decrypts nothing, opens no bolt session.** Pollable by the status chip. This is the `model:list` vs `model:refresh` split, and getting it wrong turns a chip into a 15-second unattended-decrypt loop, which D33/D60 forbid outright. |
| `memory:test` | **ONE live connect + `RETURN 1`, USER-INITIATED ONLY.** Admitted on D58's terms verbatim: no boot hook, no timer, no restore path, no retry. Reuses `vault.decryptForLaunch`; never forks it. Reason strings use the `vaultCore.failureMessage` vocabulary — never a URI, never a driver stack trace. |
| `memory:seed` | Applies pending graph migrations; returns `{fromVersion, toVersion, applied[]}`. |
| `memory:validate` | Provenance completeness **always with its denominator** (D55, D76). "43 of 512", never "43". |
| Stage 5: `memory:provision` / `start` / `stop` / `destroy` | `destroy` takes a typed `confirmation` that must equal the container name — the `worktree:remove` D26 clause-6 gate. |
| Stage 5 event: `memory:progress` | Image pull is slow. Validated in main **before** send — the `council:progress` precedent. |

**D76 governs the status chip.** The `● neo4j :7688` chip was **omitted** from
Phase 3c, not stubbed, because it had no data source. It returns in Stage 2 when
`memory:status` gives it one — and it renders **nothing at all** for a project
with no memory configured. No placeholder, no zero, no skeleton.

---

## 8. Graph schema versioning (Stage 3)

**The graph is authority on its own version; `project_memory.schema_version` is
a cache.** The same graph can be restored from a dump or reached by a second
Chorus install; a version kept only in SQLite would claim a schema the graph
does not have. The seeder **always re-reads the graph first** and writes the
cache only after success.

The ledger lives inside the graph and deliberately mirrors `schema_migrations`
so there is one mental model: a `(:ChorusSchema {id:'chorus', version})`
singleton plus `(:ChorusMigration {version, name, appliedAt, checksum})` per
applied step. **Every statement is idempotent (`IF NOT EXISTS`)**, so a partial
apply is safe to re-run — the correct failure mode for something that runs
before the feature is usable, and assertable in a pure test rather than trusted.

Seed v1 constraints (**Neo4j 5 syntax — D4-verify against the actual image
before hardcoding**):

```cypher
CREATE CONSTRAINT project_id_unique   IF NOT EXISTS FOR (p:Project)      REQUIRE p.id IS UNIQUE;
CREATE CONSTRAINT file_path_unique    IF NOT EXISTS FOR (f:File)         REQUIRE (f.repo, f.path) IS UNIQUE;
CREATE CONSTRAINT class_fqn_unique    IF NOT EXISTS FOR (c:Class)        REQUIRE (c.repo, c.fqn)  IS UNIQUE;
CREATE CONSTRAINT commit_sha_unique   IF NOT EXISTS FOR (c:Commit)       REQUIRE (c.repo, c.sha)  IS UNIQUE;
CREATE CONSTRAINT memory_id_unique    IF NOT EXISTS FOR (m:Memory)       REQUIRE m.id IS UNIQUE;
CREATE CONSTRAINT session_id_unique   IF NOT EXISTS FOR (s:AgentSession) REQUIRE s.id IS UNIQUE;
CREATE INDEX memory_current           IF NOT EXISTS FOR (m:Memory) ON (m.validTo);
CREATE INDEX memory_project           IF NOT EXISTS FOR (m:Memory) ON (m.chorusProjectId);
CREATE FULLTEXT INDEX memory_text     IF NOT EXISTS FOR (m:Memory) ON EACH [m.content];
```

Every node also carries `chorusProjectId` and `writtenVia: 'mcp'|'app'|'skill'`
— the second because "which path wrote this" is exactly the question a
provenance audit asks first, and it cannot be reconstructed later.

---

## 9. Pure cores vs shells

The `*Core.ts` split is **not stylistic**. Tests cannot import `storage.ts` or
`better-sqlite3` (Electron ABI 148 vs Node 127), so **logic that is not in a
pure core is logic that cannot be tested.**

**Pure (Vitest; no electron, dockerode, neo4j-driver, or storage):**

- `src/main/services/memoryConfigCore.ts` — mode vocabulary, bolt-URI validation
  and normalisation, port-range checks, **Docker-legal container/volume naming
  from a project slug** (`[a-zA-Z0-9][a-zA-Z0-9_.-]*`), and the launchability
  predicate + authored `disabledReason` (the `resolveLaunchProfile` precedent).
- `src/main/adapters/mcpConfigCore.ts` — **the security core.**
  `(McpDescriptor, McpServerRef[]) → rendered text | argv tokens`, plus
  `assertNoSecretInRendered`. **Its headline test is a PROPERTY over every
  adapter × every ref: no known-secret value ever appears in the output.**
- `src/main/services/graphSchemaCore.ts` — the ordered migration list,
  `pendingMigrations(current)`, the version-node Cypher as strings, and an
  assertion that **every** statement is `IF NOT EXISTS`.
- `src/main/services/provenanceCore.ts` — `MemoryRecord` → Cypher parameters,
  the validator queries, and the completeness ratio computed **with its
  denominator**.

**Shells (driven at G2, not unit-tested):** `neo4jClient.ts` (owns the driver;
one per config, lazily created, disposed on config change and on `before-quit`;
**never logs a URI**), `neo4jProvisioner.ts`, `memoryService.ts` (**the only
module that decrypts**), and the adapter `writeMcpConfig` implementations
(atomic temp+rename). Note `neo4j-driver` is **pure JS with no native build**,
so `neo4jClient.ts` *could* be unit-tested — unlike `storage.ts`.

**⚠ Wiring position in `src/main/index.ts` is load-bearing.** The memory boot
reconcile belongs in the same band as `worktrees.reconcileAll()` and
`dispatches.healOrphansAtBoot()`, i.e. **before `sessions.restore(...)`** —
otherwise restore can launch a session whose MCP config points at a container
the reconcile is about to mark dead.

### Vault contract vs a long-lived container

The conflict with D33/D53 (decrypt-per-launch, no unattended decryption) is
real, and the design **dissolves it rather than managing it**:

- **Local mode: the conflict does not exist.** `NEO4J_AUTH=none` means nothing
  is decrypted at container start. The first start should still be
  **user-initiated** (Docker Desktop may not be up), with a per-project "start
  memory when Chorus launches" toggle defaulting **off** — which also matches
  D92's premise that the user is in charge of their own containers.
- **Credentialed modes: resolve at session launch only** — a human clicking
  Launch, the same distance argument D49 made for `session:relaunch`. **Never at
  boot, never on a timer, never on restore, never on retry.** D53 declined
  boot-time re-resolution and D49 declined it again; a container auto-start that
  needed a password would re-open both.
- **Restore parity must be CHECKED, not assumed.** A session that is
  credentialed *only* by way of memory is a case
  `launchProfiles.sessionIsCredentialed` has never seen. Verify it classifies —
  the F26 shape.

---

## 10. D4 obligations

**⚠ Obtained 2026-07-28; Phase 6 executes after 3e. RE-VERIFY ALL OF IT.**

### Live-probed (strong — still re-verify)

- **codex 0.145.0 accepts `-c mcp_servers.<name>.command/.args/.env/.env_vars`
  per-invocation and writes nothing.** Confirmed by running
  `codex mcp list --json -c 'mcp_servers.chorus_probe.command="uvx"' …` and
  seeing the probe server in the parsed output. **This is the linchpin of Stage
  1** — if it regresses, Stage 1 is no longer a zero-write commit and the
  staging must be re-thought rather than pushed through.
- `docker` **28.0.4**, `uvx`, `uv` and `npx` are all on PATH on this machine.
  `docker` is already in `cliDetect.DETECTED_TOOLS`.

### Binary-inspected only (weaker — confirm live before depending on it)

- claude 2.1.218 expands `${VAR}` / `${VAR:-default}` from `process.env` in MCP
  `command`, `args` and every `env` value; unset vars are reported as
  `missingVars` and left literal. **Confirm by writing a `.mcp.json` in a
  scratch dir and reading back `claude mcp get <name>`.**
- opencode 1.18.8 supports `{env:VAR}` / `{file:path}` substitution and an
  `OPENCODE_CONFIG` env var naming a config **file path**.
- kimi 0.29.1 has MCP config in three scopes (`mcp.json`, with global timeouts
  under `[mcp]` in `config.toml`) but **no evidence of env interpolation** —
  hence `mcp: null` until established. Note D87 already grants a *scoped,
  additive* authorization to write `~/.kimi-code/config.toml`; **that
  authorization does not extend to writing a secret there**, and its own risk
  (1) is exactly the plaintext-key problem §2 refuses.

### Not verified at all — must be established in the phase

1. **`neo4j:5-community`** — does the tag still exist, which Neo4j major does it
   resolve to, and **is APOC needed for v1 at all**? Drop it unless a seed
   statement requires it.
2. **The Neo4j MCP server** — real package name, registry (PyPI via `uvx` vs
   npm via `npx`), exact env var names (`NEO4J_URI` vs `NEO4J_URL`,
   `NEO4J_USERNAME` vs `NEO4J_USER`, `NEO4J_DATABASE`), and **critically: does
   it connect at all with auth disabled?** Some clients require a username.
   **§2's local-mode recommendation is conditional on this** — if it refuses,
   the design falls back to env-var indirection in every mode.
3. **Docker Desktop / WSL2 loopback semantics** for a `127.0.0.1:<port>`
   publish on this machine (`Get-NetTCPConnection -LocalPort <p>`, plus an
   attempt to reach it from a non-loopback interface). **The whole "no more
   exposed than DPAPI" argument in §2 rests on it.**
4. **Whether `CREATE DATABASE` is genuinely Enterprise-only** on this image —
   D92's premise and D94's second correction both depend on it.
5. **Free-port allocation** — bind `127.0.0.1:0`, read the port, close, hand to
   Docker. **Accept and RECORD the TOCTOU window** rather than pretending it
   away.
6. **⚠ The MCP server under a Chorus-composed allow-list environment.** The
   codex probe above ran under the ambient shell. `composeChildEnv`'s
   credentialed branch emits only `PATH, SystemRoot, TEMP, TMP, HOMEDRIVE,
   HOMEPATH, USERPROFILE` + pins + the secret. `uvx`/`npx` resolve via `PATH`,
   **but `uv` caches under `%LOCALAPPDATA%`, which is not on the list.** D49 left
   this open in as many words — *"deeper features (MCP servers, plugin sync)
   were not exercised and remain unknown."* **Phase 6 is the phase that closes
   it.** Expect to need an empirical `BASELINE_ENV_VARS` addition, and **record
   what broke without it**; `env.ts:18` already reserves the slot, and D88's
   three-lists trap (COPY-FROM / IMPOSE / REMOVE) applies to whoever edits it.

---

## 11. Dependencies — the CLAUDE.md ask

| Dep | Stage | Note |
|---|---|---|
| `neo4j-driver` | 2 | The only supported way to speak bolt; needed by `memory:test`, the seeder and the validator. **Named in `Plan.md` §2's locked stack.** Pure JS, no native build — so it does **not** inherit better-sqlite3's Electron-ABI problem. **Recommend approving.** |
| `dockerode` | 5 | Named in `Plan.md` §2 — **but recommend evaluating a `git.ts`-style `docker` CLI adapter FIRST and recording the outcome as a numbered decision.** `docker` is already probed by `cliDetect`; `git.ts` is a proven controlled-process pattern; `docker … --format '{{json .}}'` gives structured output for **zero** new dependencies, while dockerode pulls `docker-modem`/`tar-fs`/`ssh2` into an app with 8 runtime deps. The one thing the CLI path does worse is **streaming pull progress**. **Decide at Stage 5, not now** — it is a defensible deviation from `Plan.md` §2 either way, but it should be a decision rather than a default. |
| *(none)* | 1, 3, 4 | JSON via `JSON.stringify`; codex via argv. **Deliberately no TOML writer** (§2). |

---

## 12. What the CR brief must contain (Stage 0)

Phase 6 carries **`[CR: memory schema + provenance model]`**, and **G5 makes it
mandatory** — the gate has not fired. It runs **natively** now (Phase 3b),
against D71's roster: budget **~$0.83 and ~14 minutes** per run, pre-authorized
against a $10 minted cap. **State the envelope before the first run and measure
against it** (3b-1's standing lesson), and remember **F39** — kimi contributes
no usage block, so Chorus's own reported figure under-reports the truth whenever
it participates; check against OpenRouter's billing page, not only Chorus's
number.

Author as `CouncilBriefs/CouncilBrief-6.0-MemorySchemaProvenance.md` at kickoff,
**against the code as it stands then**, not now.

**⚠ Open the brief with an explicit instruction — "answer these questions; do
not review this document."** Without it the council reviews the brief instead of
answering it. This is a known, repeated failure mode.

**Questions the brief must put:**

1. The four `Plan.md` §10 corrections (§4) — are they right, and is anything
   else in §10 wrong?
2. **Is provenance advisory-and-measured, or enforced app-side?** §4's closing
   note is the crux: "agents write via MCP directly" means Chorus *cannot*
   enforce it. Is `memory:validate` a sufficient answer, or does v1 need
   app-mediated writes after all?
3. **The H3 environment-policy flip** — is silently narrowing a subscription
   pane's environment acceptable with a UI disclosure, or does credentialed
   memory need a different mechanism entirely?
4. **The D93 posture** — does the "names not values" argument genuinely hold the
   D49 line, or is it a rationalisation? This is the question most worth an
   adversarial read.
5. **D92's cost** — one container per project at ~512 MB–1 GB heap each. At what
   project count does this stop being reasonable, and does the answer change the
   design?

**Evidence appendix:** ship §10's D4 results, clearly split into live-probed vs
binary-inspected vs unverified. **A council reasoning from an unmarked mix of
those three produces confident findings about facts nobody established** — the
D70 failure, which came one ratification away from being adopted as fact by the
roadmap.

---

## 13. Execution checklist (for the eventual `/phase-kickoff`)

- [ ] Re-run every §10 D4 probe against the then-current binaries. Record the
      date and the method, not just the answer.
- [ ] Author and run the CR (§12). **G5 blocks coding until it closes.**
- [ ] Confirm `MIGRATIONS.length + 1 === 14` before appending (⚠ **corrected from
      13, 2026-08-01 — see §6**). **Stop on divergence** rather than renumbering.
- [ ] Add `countProjectMemoryForCredential` to `credential:delete`, isolated on
      a route where no pre-existing guard masks it (§6).
- [ ] Split — do not loosen — `adapters.test.ts:497` (§3).
- [ ] G4 (`npm run grep:secrets`) is **load-bearing** from Stage 2 onward, and
      §2's note about its blind spot goes in the commit narration.
- [ ] G2: drive the real app. A memory chip that renders is not a memory graph
      that answers.
