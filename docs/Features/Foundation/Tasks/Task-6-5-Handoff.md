# Task 6-5 — HANDOFF, written 2026-08-10 before a reboot

> **Read this first when you come back.** The code is **written, green and committed**. What is
> left is the **live G2 test**, which needs Docker, an interactive approval and a question asked in
> a pane — none of which the assistant may do on its own.
>
> **Status: `DONE_WITH_CONCERNS`. The Phase 6 milestone is `NOT RUN`.**
> *A config file existing is not the milestone. No agent has yet answered a question from the graph.*

---

## Where things stand in one paragraph

Chorus now writes the memory MCP server into claude's and opencode's own configuration before a
session starts, in each CLI's own measured schema, with a guard that runs over the exact bytes and
refuses rather than writes if anything credential-shaped appears. codex still gets argv only and
`~/.codex/config.toml` is byte-identical. All gates are green. Nothing has been written to disk yet
in anger, because that happens at the first launch — which is Step 4 below.

## The commit

| | |
|---|---|
| **Commit** | **`e4f6161`** — *"Chorus tells claude and opencode where the project's memory lives"* |
| **Branch** | **`main`** — see the warning below |
| **Parent** | `2860825` (your terminal-selection commit) |
| **Files** | 15 changed, 2 new (`mcpConfigWrite.ts`, `mcpConfigWrite.test.ts`) |

> ⚠ **THE COMMIT IS ON `main`, NOT `agent/visible-terminal-selection`.** A `checkout main` plus a
> fast-forward to `2860825` happened **outside** the assistant's session (visible in
> `git reflog` at `HEAD@{2}` and `HEAD@{1}`) — no command it ran switched branches. `main` is the
> branch the execution prompt named as expected, and its parent is your terminal-selection commit,
> so the commit was left there. **If you wanted it on a task branch, say so and it can be moved.**

## Numbers, so you can tell later whether something moved

| Gate | Baseline (at `402a970`) | After |
|---|---|---|
| `npm run typecheck` | exit 0 | **exit 0** |
| `npx vitest run` | 1783 / 1783, 52 files | **1835 / 1835, 53 files** |
| `npm run grep:secrets` | clean | **clean** |
| `git diff -- package.json` | empty | **empty (0 lines)** |
| `IpcChannel` | 86 | **86** |
| `MIGRATIONS.length` | 18 | **18** |
| `grep -c "sqliteTable("` | 18 | **18** |
| `sha256sum ~/.codex/config.toml` | `e791bda36fa92fcca1483fbed6ae2728bb4fa0a8e9abfc92013ec8b9b23abdb4` | **identical** |

**Known flake, expected, not caused by this work:** `adapters.test.ts` failed once in five full-suite
runs (**F50**), on the pre-existing `buildLaunch reproduces resolveCli EXACTLY` test, which this task
does not touch. It passes **89/89 in isolation**, and four consecutive full runs afterwards were
clean. **Re-run before diagnosing.**

---

# ▶ WHAT IS LEFT: the live G2 test

**Three corrections to `Task-6-5-ExecutionPrompt.md`'s version of these steps**, taken from the code
as it actually stands:

1. **Step 3's "choose local mode" — the option is actually "Existing Neo4j".** `local-docker` is
   refused by design (`supportedMode`): *"Chorus cannot start a Neo4j container yet."*
2. **opencode's file is `%APPDATA%\chorus\mcp\opencode.json`** for the **dev** build (dev keeps the
   default userData). The **installed** Chorus uses `chorus-app` — so run the dev build, and do not
   touch the installed app.
3. **claude's file lands in the folder the session RUNS in, not the project root.** In
   **new-worktree** mode that is the worktree. **Launch in current-tree mode** and it lands at
   `C:\Projects\ContactEstablished\Chorus\.mcp.json`, which is what the commands below assume.

### Step 1 — start the Neo4j container

```powershell
docker run -d --name chorus-g2-neo4j -e NEO4J_AUTH=none -p 127.0.0.1:7688:7687 neo4j:5-community
docker logs chorus-g2-neo4j --tail 20     # wait ~20-30s for "Started."
docker ps --filter name=chorus-g2-neo4j   # STATUS should read "Up"
```

If port 7688 is taken, change **only the left half** (`-p 127.0.0.1:7689:7687`) and use the new port
everywhere below.

### Step 2 — put one node in the graph BY HAND

Do this **before** asking any agent anything. An agent that finds an empty graph and says "I found
nothing" has proven nothing — that is indistinguishable from a broken connection.

```powershell
docker exec -i chorus-g2-neo4j cypher-shell -d neo4j "CREATE (m:Memory {key:'chorus-g2-probe', note:'The milestone canary for Task 6-5'}) RETURN m;"
docker exec -i chorus-g2-neo4j cypher-shell -d neo4j "MATCH (m:Memory) RETURN m.key, m.note;"
```

### Step 3 — point Chorus at it

1. Launch the **dev** build (not your installed copy).
2. Project Settings → **Memory** for this project.
3. Mode **Existing Neo4j** (see correction 1), address `bolt://127.0.0.1:7688`.
4. **Test** — you must see `probe: 1` before going further. If this fails, stop: the fault is the
   container or the port, not the MCP wiring.
5. **Apply schema** (Task 6-4's seeder).

### Step 4 — launch each agent, then look at the files

Launch **claude**, **opencode** and **codex** sessions in that project (**current-tree** mode).

```powershell
type C:\Projects\ContactEstablished\Chorus\.mcp.json      # claude — project-scoped
type $env:APPDATA\chorus\mcp\opencode.json                # opencode — Chorus-owned
Get-FileHash $env:USERPROFILE\.codex\config.toml          # codex — MUST still be E791BDA3...
```

**What correct looks like:** claude's file uses `mcpServers` with `command` + `args`; opencode's uses
`mcp` with `type: "local"` and a **single `command` array** and `environment`. **Neither contains a
password**, because in local mode there is not one to contain.

**And the grep that `npm run grep:secrets` cannot reach — this one is still owed and must be pasted
into the final report:**

```bash
grep -rniE "neo4j.?password|bolt://[^ ]*:[^ ]*@|[A-Za-z0-9_-]{32,}" \
  "$APPDATA/chorus/mcp/" "C:/Projects/ContactEstablished/Chorus/.mcp.json"
```

### Step 5 — ⚠ approve the server in claude (ONLY YOU CAN DO THIS)

Claude Code treats a Chorus-written `.mcp.json` as **untrusted until a human approves it** — its own
help text says unapproved servers are *"not connected to."* **Chorus is forbidden to write that
approval** and the assistant will not attempt it: doing so would forge your consent to run a program.

In the **claude** pane: type `/mcp`, approve `chorus-memory`, then confirm with `claude mcp list` —
it should no longer say **⏸ Pending approval**.

> If it still says pending, re-run `/mcp` in the pane. **Do not let anyone "fix" this by editing a
> claude settings file** — that is the bright line (D49).

### Step 6 — 🎯 THE MILESTONE

In the **claude** pane:

```
Using the chorus-memory MCP server, look up the Memory node whose key is
'chorus-g2-probe' and tell me its note text.
```

**The milestone is met when the agent answers with `The milestone canary for Task 6-5`** — it cannot
invent that string; it exists only in your database. Repeat in the **opencode** pane. **codex** is the
control case: it gets the server as launch argv, needs no approval, and should just work.

### Step 7 — tear down

```powershell
docker rm -f chorus-g2-neo4j
del C:\Projects\ContactEstablished\Chorus\.mcp.json          # optional
del $env:APPDATA\chorus\mcp\opencode.json                    # optional
```

Chorus never started this container and never stops it — that is Stage 5's job, and Stage 5 is not
built.

### If something goes wrong

| Symptom | Most likely cause |
|---|---|
| **Test** fails in Chorus | Container not up yet, or wrong port. `docker ps`. |
| Agent says it has no such tool | The server never connected. For claude, check Step 5. |
| `uvx` errors in the pane | Server is `mcp-neo4j-cypher` **0.6.0** from PyPI via `uvx`. First run downloads it — give it a moment. |
| Connects but finds nothing | You skipped Step 2. |
| opencode ignores the server | Its schema is `additionalProperties: false` — a wrong key is silently rejected. **That would be a code bug: report it.** |
| `.mcp.json` written but empty of `chorus-memory` | Check you launched **current-tree**, not new-worktree (correction 3). |

**Environment facts, measured 2026-08-08, re-confirmed 2026-08-10:** the server package is
`mcp-neo4j-cypher` **0.6.0**; it reads **`NEO4J_URL`** (which beats `NEO4J_URI`) and
**`NEO4J_USERNAME`** (not `NEO4J_USER`); it connects fine against an auth-disabled database.

---

## Open items to carry into the final report

1. **The written-file secret grep** — `NOT RUN`, because nothing is written until Step 4. Owed.
2. **`~/.codex/config.toml` hash after the drive** — must still be `e791bda3…`.
3. **Runtime results for Steps 1–6**, including **the exact answer the agent gives in Step 6**.

## Residual risks — found, deliberately not fixed

- **`.mcp.json` is NOT gitignored** (`git check-ignore` matches nothing) and is now written into the
  worktree an agent may commit from — one careless `git add .` from being committed. **Raised, not
  fixed**, per Gate 0: whether the repo should ignore it is a real decision and yours.
- **opencode's config is one file per app, not per project.** It is rewritten at every launch from
  the launching project, so a session always starts pointed at the right graph; two *live* opencode
  sessions in *different* projects share the file. Documented at the method; the fix is a per-session
  filename and needs no caller change.
- **H2 is not wired, because there is nothing to wire.** A local-mode launch registers zero secrets.
  `LaunchOptions.secrets` (`sessionManager.ts:108`, registered `:609`) is untouched and already
  unions `request.secretEnv` values, so credentialed mode inherits the seam intact.
- **claude's `${VAR}` expansion is still unverified** — unchanged, and Phase 6 no longer depends on it
  (D128(a): local mode carries no placeholder to expand).
- **The four-state model (D126 Q6) is only partly driven.** `Configured` and `Connected`/`Failed` are
  real, from the Test button's observed probe — but they describe **Chorus's own** connection.
  **There is no per-agent state and deliberately no per-agent green light**, because observing one
  needs an IPC channel this task's non-goals forbid, and a dot that meant "we wrote a file" is
  exactly the dishonesty CR-6.0 existed to prevent. The settings screen says so in words instead.

## One defect worth remembering, caught in review before commit

The first wiring wrote claude's `.mcp.json` to `project.rootPath`. **A new-worktree launch runs in
`.chorus/worktrees/<x>`** — a separate checkout, where an untracked file at the project root does not
exist. Chorus would have written a real file, logged success, and handed the agent **no memory server
at all**, in the workspace mode this app is built around. It only looks right in current-tree mode,
which is the first thing anyone would test. Fixed by passing the cwd each launch site is about to
spawn in (four sites, including relaunch).

---

## How to restart the assistant on this

Paste something like:

> Resuming Task 6-5. Read `docs/Features/Foundation/Tasks/Task-6-5-Handoff.md`. The implementation is
> committed at `e4f6161`; we are at the G2 live test. I have started the container / I am about to —
> drive Chorus with me and record what actually happens.

It will need to: drive the dev Chorus, read the DB, run the written-file secret grep, re-hash
`~/.codex/config.toml`, and report Steps 1–6 honestly. **It must not** start the container, approve
the MCP server, or claim the milestone from a file existing.
