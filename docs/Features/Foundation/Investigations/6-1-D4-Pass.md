# 6-1 D4 Pass — the evidence, and how each fact was obtained

**Run 2026-08-07 against the codebase at `84dcf54`** (Phase 3h closed the same day). Method for every
entry is stated inline. **Nothing here is inherited from the design plan or from the kickoff, including
facts the plan already asserted** — the point of the rule is that ten days passed.

**⚠ THE THREE-WAY SPLIT IS THE DELIVERABLE, NOT THE FORMATTING.** A council reasoning from an unmarked
mix of live-probed, binary-inspected and unverified facts produces confident findings about facts
nobody established — the D70 failure, which came one ratification away from being adopted.

**Probe scripts live in the session scratchpad and are deliberately not in `src/` or `scripts/`**
(Task 6-1 non-goal). Reproduce from the commands quoted below.

---

## Ground state at probe time

| Fact | Method | Value |
|---|---|---|
| HEAD | `git rev-parse --short HEAD` | `84dcf54` |
| Runtime dependencies | `package.json` `dependencies` | **7** — no `neo4j-driver`, no `dockerode` |
| Neo4j in `src/` | `grep -ril "neo4j" src/` | **no matches** |
| `MIGRATIONS.length` | `src/main/services/storage.ts:171`, counted | **15** |
| `sqliteTable(` | `grep -c` over `src/main/db/schema.ts` | **16** |
| vitest | `npx vitest run` ×8 | **1305 passed / 39 files** |

**⚠ EVERY BASELINE NUMBER IN THE PHASE 6 TASK DOCS IS STALE.** They were written against `3fa295d` on
2026-07-28 and say **1055 across 30 files**, `MIGRATIONS.length` **13**, `IpcChannel` **58**. See
"Findings that change work" below.

---

## Live-probed (strong)

### Tool versions — `<tool> --version`, 2026-08-07

| Tool | Kickoff said (2026-07-28) | **Now** | Moved |
|---|---|---|---|
| `codex` | 0.145.0 | **0.147.0** | ✅ |
| `claude` | 2.1.218 | **2.1.224** | ✅ |
| `opencode` | 1.18.8 | **1.18.15** | ✅ |
| `kimi` | 0.29.1 | 0.29.1 | — |
| `docker` | 28.0.4 | 28.0.4 | — |
| `uv` / `uvx` | 0.11.19 | 0.11.19 | — |
| `npx` | 11.12.1 | 11.12.1 (ambient) | — |
| `node` | — | v22.14.0 | — |

All on PATH. **Three of seven moved in ten days**, which is the standing CLAUDE.md rule paying for
itself.

### ⭐ THE LINCHPIN — codex per-invocation `-c mcp_servers.*` still holds on 0.147.0

```bash
codex mcp list --json \
  -c 'mcp_servers.chorus_probe.command="uvx"' \
  -c 'mcp_servers.chorus_probe.args=["mcp-neo4j-cypher"]' \
  -c 'mcp_servers.chorus_probe.env={NEO4J_URI="bolt://127.0.0.1:7688"}' \
  -c 'mcp_servers.chorus_probe.env_vars=["NEO4J_PASSWORD"]'
```

**Raw answer** — the probe server appears in the parsed output:

```json
{
  "name": "chorus_probe",
  "enabled": true,
  "transport": {
    "type": "stdio",
    "command": "uvx",
    "args": ["mcp-neo4j-cypher"],
    "env": { "NEO4J_URI": "bolt://127.0.0.1:7688" },
    "env_vars": ["NEO4J_PASSWORD"],
    "cwd": null
  },
  "auth_status": "unsupported"
}
```

**And it wrote nothing.** `~/.codex/config.toml` before and after:

| | size | mtime | sha256 (first 16) |
|---|---|---|---|
| before | 4731 | 2026-08-07 15:40:10.187627900 -0400 | `eb3d7b2d11d777b3` |
| after | 4731 | 2026-08-07 15:40:10.187627900 -0400 | `eb3d7b2d11d777b3` |

**Byte-identical, mtime untouched. Stage 1's zero-write premise survives the version bump.**

**⚠ AND `env_vars` IS A DISTINCT FIELD FROM `env`, ACCEPTED PER-INVOCATION.** `env` carries a map of
name→**value**; `env_vars` carries a list of **names** to pass through from the parent environment.
That is D93's "names not values" mechanism existing natively in codex's own vocabulary, and it was
**not** established at kickoff — the kickoff only knew `-c` was accepted at all.

**⚠ NOTE FOR WHOEVER WRITES STAGE 1:** `-c mcp_servers.*` **merges into** the existing config rather
than replacing it. The probe output also contained a pre-existing `node_repl` server from this
machine's `~/.codex/config.toml`. Chorus's launch argv adds a server; it does not define the set.

### ⭐ ITEM 2 — the Neo4j MCP server, and it CONNECTS WITH AUTH DISABLED

**Package resolved:** `mcp-neo4j-cypher` on **PyPI via `uvx`** (not npm).

```bash
uvx --from mcp-neo4j-cypher python -c "import importlib.metadata as m; print(m.version('mcp-neo4j-cypher'))"
# -> 0.6.0
```

**⚠ THE SERVER MISREPORTS ITS OWN VERSION OVER MCP.** `initialize` returns
`serverInfo = mcp-neo4j-cypher 2.13.3`, which is **FastMCP's** version, not the package's **0.6.0**.
Any version-pinning or compatibility check that trusts `serverInfo` is reading the wrong number.

**Env var names — read from the installed source, `mcp_neo4j_cypher/utils.py`, not from docs:**

| Var | Line | Note |
|---|---|---|
| `NEO4J_URL` | `utils.py:68` | **checked FIRST — it WINS over `NEO4J_URI`** |
| `NEO4J_URI` | `utils.py:71` | only consulted when `NEO4J_URL` is unset |
| `NEO4J_USERNAME` | `utils.py:83` | **not `NEO4J_USER`** |
| `NEO4J_PASSWORD` | `utils.py:93` | |
| `NEO4J_DATABASE` | `utils.py:105` | |

The plan asked "`NEO4J_URI` vs `NEO4J_URL`, `NEO4J_USERNAME` vs `NEO4J_USER`". **Answer: both URI
forms are read with URL taking precedence; the username var is `NEO4J_USERNAME` and `NEO4J_USER` is
not read at all.** Precedence confirmed live (probe C below) by setting `NEO4J_URL` correct and
`NEO4J_URI` deliberately wrong — the server connected.

**⚠ IT ALSO ACCEPTS `--password` AS A COMMAND-LINE ARGUMENT.** `mcp-neo4j-cypher --help` lists
`--db-url`, `--username`, `--password`, `--database`. **Chorus must never use that path** — it is
exactly the argv-is-world-readable hazard `types.ts:174` warns about. The env-var path is proven
below and is the only one Chorus should emit.

#### The connect matrix — measured, both directions, with controls

Neo4j started as `neo4j:5-community` with `NEO4J_AUTH=none`, published `127.0.0.1:60970:7687`. MCP
spoken over stdio directly (raw JSON-RPC, no client library, so the result is the server's behaviour
and not a harness's).

| Server auth | Client credentials | `initialize` | `tools/list` | `RETURN 1` | write |
|---|---|---|---|---|---|
| **`NEO4J_AUTH=none`** | **none at all** | ok | 3 tools | **OK `[{"probe": 1}]`** | **OK, 1 node created** |
| `NEO4J_AUTH=none` | username + bogus password | ok | 3 tools | OK | OK |
| `NEO4J_AUTH=none` | `NEO4J_URL` correct, `NEO4J_URI` wrong | ok | 3 tools | OK | OK |
| **`neo4j/probeProbe12345`** | **none** | ok | 3 tools | **`Neo.ClientError.Security.Unauthorized`** | Unauthorized |
| **`neo4j/probeProbe12345`** | **correct password via `NEO4J_PASSWORD`** | ok | 3 tools | **OK** | **OK, 1 node created** |
| `neo4j/probeProbe12345` | **wrong** password | ok | 3 tools | `…Security.Unauthorized` | Unauthorized |

**✅ Plan §2's local-mode recommendation SURVIVES ITS MEASUREMENT.** The server connects, reads and
writes against an auth-disabled Neo4j with no username and no password. The feared fallback
("if it refuses, env-var indirection in every mode") **is not triggered**.

**✅ And env-var indirection itself is proven, with controls.** Correct password via `NEO4J_PASSWORD`
succeeds; wrong password fails; absent password fails. Row 2 alone would have been a false positive —
it "passes" only because the server had auth off.

**Tools exposed:** `get_neo4j_schema`, `read_neo4j_cypher`, `write_neo4j_cypher`.

#### ⚠ A CONNECTION TEST THAT STOPS AT `tools/list` REPORTS A FALSE GREEN

**`initialize` and `tools/list` succeed on every row above, including all three failing ones.** The
server starts and advertises its three tools without ever opening a bolt session; authentication
failure surfaces **only on `tools/call`**. **`memory:test` (Task 6-3) must issue a real query** — a
handshake is not a connection. This was not anticipated in the plan.

### ⭐ ITEM 3 — the loopback publish IS loopback-only

Container published `-p 127.0.0.1:60970:7687`.

```powershell
Get-NetTCPConnection -LocalPort 60970 -State Listen
# LocalAddress LocalPort State
# 127.0.0.1        60970 Listen
```

Reachability from every non-loopback IPv4 address on this machine, via
`Test-NetConnection -Port 60970 -InformationLevel Quiet`:

| Address | Reachable |
|---|---|
| 192.168.1.194 (LAN) | **False** |
| 100.114.89.92 | **False** |
| 172.30.0.1 (vEthernet) | **False** |
| 10.100.0.2 | **False** |
| 169.254.* ×8 (link-local) | **False** |
| **127.0.0.1 (control)** | **True** |

**✅ Bound to `127.0.0.1` exactly; unreachable on all 12 other interfaces; the control proves the
method detects a reachable port.** Plan §2's "no more exposed than DPAPI" argument rests on this and
**the premise holds**.

**⚠ HONEST LIMIT OF THIS PROBE.** It was run from the Windows host against a Docker Desktop
(WSL2-backed, `OperatingSystem=Docker Desktop`, `Driver=overlayfs`) publish. It does **not**
establish what a process running *inside* a WSL2 distribution sees, and it is one machine's network
configuration. It refutes the off-host exposure worry; it is not a general proof.

### ⭐ ITEM 1 — `neo4j:5-community` resolves to 5.26.29, and APOC is ABSENT

```bash
docker manifest inspect neo4j:5-community   # tag exists
docker pull neo4j:5-community               # 968MB, linux/amd64
```

```cypher
CALL dbms.components() YIELD name, versions, edition RETURN name, versions, edition;
-- "Neo4j Kernel", ["5.26.29"], "community"
```

```cypher
SHOW PROCEDURES YIELD name WHERE name STARTS WITH 'apoc' RETURN count(*) AS apocProcs;
-- 0
```

**✅ Tag alive, resolves to Neo4j 5.26.29 Community.** **APOC ships zero procedures in this image** —
so the plan's "drop it unless a seed statement requires it" resolves to **drop it**. Requiring APOC
would mean an extra `NEO4J_PLUGINS` env var and a download at container start; **6-4's seed and
validator must be written in plain Cypher.**

**⚠ The image carries no `org.opencontainers.image.version` label** (`docker image inspect` returned
empty), so the version above comes from the running database, not from image metadata. Anything that
wants to check the version before starting a container cannot read it off the label.

### ⭐ ITEM 4 — `CREATE DATABASE` IS refused on Community

```cypher
CREATE DATABASE chorusprobe;
-- Unsupported administration command: CREATE DATABASE chorusprobe
```

```cypher
SHOW DATABASES;
-- "neo4j"  standard  read-write  online  default
-- "system" system    read-write  online
```

**✅ D94's second correction and D92's premise are both CONFIRMED by measurement.** One database per
project is unachievable on Community Edition. Exactly two databases exist and neither can be joined
by a third. **Isolation must come from the container boundary, not from a database boundary** —
which is what D92 already says, now on evidence rather than on inference.

### ⭐ ITEM 5 — free-port allocation, and the TOCTOU window measured

```js
const s = net.createServer()
s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(...) })
```

Works. Ports allocated this session: **60970**, **63620**; both bound successfully by Docker
afterwards.

**⚠ THE WINDOW IS REAL AND IS RECORDED RATHER THAN PRETENDED AWAY.** Allocate-and-close measured
**9.33 ms**, and the window stays open from that moment until Docker completes its own bind — far
longer than 9 ms, since a `docker run` intervenes. **Nothing prevents another process taking the port
in between.** The mitigation is to detect the failed bind and retry with a fresh port, not to assume
the reservation held.

### ⭐ ITEM 6 — the allow-list environment, and the plan predicted the WRONG variable

`composeChildEnv`'s credentialed branch emits `BASELINE_ENV_VARS` (`env.ts:10`) + `PINNED_ENV_VARS` +
the secret, and nothing else. Composed env used for the probe:

```
COLORTERM, HOMEDRIVE, HOMEPATH, NEO4J_PASSWORD, PATH, SystemRoot, TEMP, TERM, TMP, USERPROFILE
```

`LOCALAPPDATA` absent, as the plan says.

| Probe | Result |
|---|---|
| `uvx mcp-neo4j-cypher --help` under the credentialed allow-list | **exit 0, 2070 ms** |
| same + `LOCALAPPDATA` restored | exit 0, 1815 ms |
| `uvx mcp-neo4j-cypher` full MCP session under the allow-list | **connected, queried, wrote** |

**✅ THE PLAN'S PREDICTION IS REFUTED. `uv` does NOT need `LOCALAPPDATA`** — it derives its cache
location from `USERPROFILE`, which **is** on the allow-list. No `BASELINE_ENV_VARS` addition is
required for `uvx`. Every MCP probe in this document ran under the credentialed allow-list, so this
is proven by the whole exercise and not by a single `--help`.

**⚠ CAVEAT: the uv cache was WARM.** `%LOCALAPPDATA%\uv\cache` was already populated. A genuinely
cold cache is not covered by this probe.

#### ⚠ BUT A DIFFERENT VARIABLE IS MISSING, AND IT SILENTLY DOWNGRADES `npx`

Not predicted anywhere:

| Environment | `npx --version` |
|---|---|
| ambient host | **11.12.1** |
| credentialed allow-list | **10.9.2** |
| allow-list + `APPDATA` | **11.12.1** |

**Mechanism identified, not guessed:** `npm prefix -g` is `C:\Users\matth\AppData\Roaming\npm`, i.e.
`%APPDATA%\npm`. Without `APPDATA` on the list, `npx` cannot find the globally-installed npm and
falls back to the npm bundled inside node 22.14.0 — **a silent two-major-version downgrade, exit code
0, no warning.**

**This does not block Phase 6**, because the Neo4j MCP server resolves via `uvx`/PyPI. **It does mean
any npm-distributed MCP server would run under a different npm than the user's**, and it is a
candidate `BASELINE_ENV_VARS` addition under **D88's three-lists trap** (`APPDATA` would be a
COPY-FROM entry — it carries host state — not an IMPOSE). **Recorded, not actioned:** Task 6-1 writes
no code, and nothing in this phase currently needs npm.

---

## Binary-inspected only (weaker — confirmed / refuted live)

**Both claims were carried from kickoff as binary-inspected against OLDER versions. Both were
re-inspected against the versions installed today. Neither could be upgraded to live-probed, and the
reason is recorded rather than papered over.**

### claude `${VAR}` expansion — mechanism PRESENT in 2.1.224, expansion NOT observed

The spec's suggested method — write a `.mcp.json` in a scratch dir, then `claude mcp get <name>` —
**does not work on 2.1.224.** Measured:

```
claude mcp list
# chorus_probe: uvx mcp-neo4j-cypher - ⏸ Pending approval (run `claude` to approve)

claude mcp get chorus_probe
#   Scope: Project config (shared via .mcp.json)
#   Status: ⏸ Pending approval (run `claude` to approve)
```

**`claude mcp get` prints scope and status only — never the resolved command or env**, and
`claude mcp get --help` offers no verbose or JSON mode. So expansion cannot be read back
non-interactively.

Binary inspection of `claude.exe` (2.1.224, 284,981,920 bytes) does place the mechanism in **this**
version:

```
missingVars   : 5 matches
mcpServers    : 94 matches
```

with the expansion regex visible in the binary —
``String.raw`\$\{([A-Za-z_][A-Za-z0-…`` — alongside `missingVars` and `wildcardVars`, applied in a
`switch (e.type) { case "stdio": … }`.

**STATUS: the mechanism demonstrably exists in the installed binary. Its runtime behaviour —
`${VAR:-default}` handling, and whether an unset var is left literal and reported — remains
UNCONFIRMED live.** Stage 4 depends on this. See "Still unverified" below.

### opencode `{env:VAR}` / `{file:}` / `OPENCODE_CONFIG` — all present in 1.18.15

`opencode.exe` (178,673,032 bytes), binary inspection:

| Token | Matches |
|---|---|
| `OPENCODE_CONFIG` | 8 |
| `{env:` | 33 |
| `{file:` | 81 |

**STATUS: present in the installed binary. Substitution semantics not exercised live.**

---

## Established this session (was: not verified at all)

All six of plan §10's unverified items are now answered. **Four confirm the design, one refutes a
prediction in the design's favour, and one is a correction the design did not anticipate.**

| # | Item | Outcome |
|---|---|---|
| 1 | `neo4j:5-community` | ✅ exists → **5.26.29 Community**; **APOC absent → drop it** |
| 2 | Neo4j MCP server | ✅ `mcp-neo4j-cypher` **0.6.0**, PyPI/`uvx`; **connects auth-disabled**; `NEO4J_URL` beats `NEO4J_URI`; `NEO4J_USERNAME` (not `NEO4J_USER`) |
| 3 | Loopback publish | ✅ **loopback-only**, 12 interfaces refuted, control passes |
| 4 | `CREATE DATABASE` | ✅ **refused on Community** — D92/D94 confirmed |
| 5 | Free port | ✅ works; **TOCTOU window measured at ≥9.33 ms and accepted** |
| 6 | Allow-list env | ⚠ **`LOCALAPPDATA` NOT needed** (prediction refuted); **`APPDATA` absence silently downgrades `npx` 11.12.1 → 10.9.2** |

---

## Still unverified, and what that blocks

| Item | Why it stayed unverified | Blocks |
|---|---|---|
| **claude's `${VAR}` runtime expansion** | `claude mcp get` prints no resolved values on 2.1.224, and an unapproved `.mcp.json` server is never connected to. Confirming it needs an **interactive** `claude` session to approve the server first. | **Stage 4 (Task 6-5).** The mechanism is in the binary; the semantics are not measured. **Do not let 6-5's implementer discover this** — budget an interactive approval step into that task. |
| **opencode `{env:VAR}` substitution semantics** | Binary strings prove the feature exists; no non-interactive read-back path was found. | Stage 4 (Task 6-5). |
| **Cold `uv` cache under the allow-list** | The cache was warm on this machine. | Nothing today; a first-run-on-a-clean-machine risk worth naming in Stage 5. |
| **kimi env interpolation** | Unchanged at 0.29.1; no new evidence either way. | Nothing — `mcp` stays `null` for kimi, exactly as the plan has it. |

### ⚠ AND A NEW BLOCKER THE PLAN DOES NOT CONTAIN

**A `.mcp.json` written by Chorus does NOT take effect on its own.** claude 2.1.224 reports every
project-scoped server from `.mcp.json` as **"⏸ Pending approval (run `claude` to approve)"** and
states plainly that unapproved servers are **"not connected to"**. Confirmed live above, and stated
in `claude mcp list --help`'s own text.

**This bears directly on Phase 6's milestone**, which reads *"claude and opencode receive a
Chorus-written MCP config naming a real Neo4j."* Writing the file is necessary and **not sufficient**
for the agent to actually use the memory graph. Either the milestone's wording admits the approval
step, or Stage 4 acquires a disclosure obligation — and pre-approving on the user's behalf would mean
writing claude's approval state, which is a **new** bright-line question rather than a detail.
**Raised as question 6 of the council case.**

---

## Findings that change work, and where they were filed

1. **Three CLI versions moved in ten days** (codex, claude, opencode). Linchpin re-proven on the new
   codex; the two Stage-4 claims re-inspected on the new binaries.
2. **`MIGRATIONS.length` is 15, not 13.** Task 6-3 and `ImplementationSpec-6-3.md` instruct asserting
   `MIGRATIONS.length + 1 === 14`. **That assertion now fails at 15 and must become `=== 16`.** This
   is the **second** decay of the same pinned number (12→13 corrected 2026-08-01, now 13→15). The
   rule outranks the number in both directions, exactly as the Overview says.
3. **Baselines are stale across every Phase 6 doc:** vitest **1055/30 → 1305/39**, `IpcChannel`
   **58 → 68**. Task 6-1's own verification step quotes 1055/30 and would read a correct tree as
   broken.
4. **`memory:test` must issue a real query**, not a handshake — a false green is otherwise guaranteed.
5. **APOC must not be a dependency** of 6-4's seed or validator.
6. **`serverInfo` reports FastMCP's version, not the package's.**
7. **claude gates a Chorus-written `.mcp.json` behind interactive approval.**
8. **`APPDATA` absence downgrades `npx`** — recorded for whoever next edits `BASELINE_ENV_VARS`.

---

## ⚠ A trap in `parseBriefQuestions` this case hit, and it would have cost a paid run

**[MEASURED] The first draft of `CouncilBrief-6.0` parsed as TWELVE questions, not six.**

`parseBriefQuestions` (`councilCore.ts:434`) takes **every** line in the questions section matching
`^(\d{1,2})[.)]\s+(.+)$` with ≥8 characters of text. `questionsSectionOf` (`:485`) defines that
section as everything from the questions heading down to the next heading **at the same or higher
level**. So **any numbered list inside the elaboration counts as questions.** The draft put the six
`Plan.md` corrections as a numbered list under `## 3. The questions`, and Q1's own sub-list became
Q7–Q12.

**Nothing refuses this** — `assembleRun` only refuses a case with *no* questions. The run would have
proceeded, deliberated over twelve items, and the verdict machinery would have keyed on `Q7`…`Q12`
that no member was asked.

**Fixed by structure, not by wording:** the flat numbered list is now alone under
`## 3. The questions`, and all elaboration moved to `## 4. Notes on each, in order`. Re-checked
against a faithful transcription of the parser — **6 parsed, in order.**

**⚠ VERIFY THE PARSE BEFORE EVERY PAID RUN.** The check costs nothing and the failure is silent. This
also bears on **D107**'s mandatory-heading template: the template needs to say that the questions
section holds the questions **and nothing else numbered**.

---

## Unrelated observation, filed rather than actioned

**`src/main/adapters/adapters.test.ts` has an intermittent failure in full-suite runs.** Observed
**once in nine** full-suite runs at `84dcf54`, in *"⚠ a raw override in extraArgs suppresses Chorus's
own effort tokens ENTIRELY"* (`adapters.test.ts:117`). The file passes **5/5 in isolation** and the
suite passed **8/9** overall, so it is cross-file interference rather than a broken assertion.

**Not this task's scope and not caused by it — Task 6-1 changes no code.** Recorded here because a
phase whose standing rule is *"never fewer tests"* needs to know its baseline is intermittently red
before it starts measuring against it.

---

## Cleanup

Both probe containers removed (`docker rm -f chorus-neo4j-probe chorus-neo4j-authed`); `docker ps -a
--filter name=chorus-` is empty. **The `neo4j:5-community` image (968 MB) was deliberately kept** —
Phase 6 needs it and re-pulling costs ten minutes. The first pull failed mid-stream
(`failed to read expected number of bytes: unexpected EOF`) and succeeded on retry; **a provisioner
in Stage 5 must expect that and retry rather than treat a partial pull as a permanent failure.**
