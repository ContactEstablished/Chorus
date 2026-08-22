# Task 6b-3 §(c) — The Adoption Drive, step by step

_Written 2026-08-22 for Matthew to run by hand. Every label, command and marker below was
verified against this machine on that date — the app's own source for the button text, the
installed **claude 2.1.240** for the approval behaviour. Nothing here is quoted from memory._

> **This is the half of Task 6b-3 that is an act rather than a diff.** The code shipped and is on
> `main` (`1d9aedf`). What has never happened is somebody turning the feature on where the work
> actually gets done. **F90 exists because a feature nobody had switched on was assumed to be on**,
> so every step below is recorded as done or not done, never assumed.

---

## The one question first: before or after installing 0.7.5?

**After. Install 0.7.5 first, then provision.** Three reasons, in order of how much they cost you:

1. **⚠ Your current installed build would break codex.** It was built 2026-08-21 at 08:46 and
   carries contract v2 (6b-2) but **not** the F96 fix, which landed at 19:25 that evening. That
   exact combination — a contract in argv, spawned through `cmd.exe /c codex.cmd` — is what killed
   every codex launch into a memory-configured project and left a stray file named `(old)` in the
   repository root. Today your installed app is safe **only because it has zero memory-configured
   projects**. Provisioning now would arm it.
2. **There would be nothing to see.** Auto-start, the bolt-wait, the freshness line and the
   *Last launch* sentences are all 6b-3, and 6b-3 is not in your current build.
3. **Nothing is gained by going early.** The `project_memory` row lives in
   `%APPDATA%\chorus-app\chorus.db`, which the installer does not touch — so provisioning early
   would survive the upgrade, it just would not buy anything, and it costs you (1).

---

## Step 0 — Preconditions

| Check | How | Expected |
|---|---|---|
| Docker Desktop is running | `docker ps` | a table, not a daemon error |
| 0.7.5 is the build you are in | Chorus's status bar, bottom-left | `v0.7.5` |
| It carries 6b-3 | see below | `PRESENT` |

```powershell
# ⚠ SAME VERSION STRING IS NOT SAME CODE — that is exactly how 0.7.4 got confusing.
# This greps the installed bundle for a 6b-3-only symbol.
Select-String -Path "$env:LOCALAPPDATA\Programs\Chorus\resources\app.asar" `
  -Pattern "ensureStartedForLaunch" -Quiet
```

---

## Step 1 — Baseline, captured before anything changes

Run this **before** provisioning. The whole point of the drive is a before-and-after, and the
"before" cannot be reconstructed afterwards.

```powershell
docker ps -a --filter "name=chorus-" --format "{{.Names}} | {{.Status}}"
docker volume ls --format "{{.Name}}" | Select-String chorus
git -C C:\Projects\ContactEstablished\Chorus rev-parse HEAD
```

**Expected, as of 2026-08-22:** the installed app's DB has **0 `project_memory` rows**, 8 projects,
8 sessions.

> **⚠ A container for this project ALREADY EXISTS, and provisioning will ADOPT it rather than
> create one.** Tonight's verification drive ran against a *copy* of your user-data-dir and left
> behind `chorus-chorus-f98f4cf5` (bolt `127.0.0.1:7691`) plus its volume
> `chorus-chorus-f98f4cf5-data`. The name is derived from the project — `chorus-<slug>-<id8>` — and
> your installed Chorus project has the same id, so it lands on the same name. **This is by design:
> `provision` adopts rather than creating a second container beside the first.** Two consequences:
> provisioning will be near-instant, and the graph is **already seeded (schema v2) and indexed
> (542 files, 39 folders, 200 commits at `1c14603`)**. If you would rather start from nothing, say
> so — but **do not remove the volume**; that is the one action Chorus itself refuses (F49/D151).

---

## Step 2 — Provision the memory

1. Open the **Chorus** project → the gear icon in the project rail → **Project settings**.
2. Scroll to the **Memory** section.
3. Press **`Start a database for me`** — it reads *"Starting a database…"* while it works.

**What that button does, so nothing is a surprise:** it runs Neo4j in Docker **bound to
`127.0.0.1` only**, with `NEO4J_AUTH=none`. The loopback binding is why credential-free is safe;
the two are one decision. It creates (or adopts) a named container and a named volume, waits for
bolt to answer, and writes the row.

> **⚠ The button only appears when the project has no memory configured AND Chorus detected
> docker.** If you do not see it, one of those two is false — the address form below it is the
> manual path and is not what you want here.

**Capture:**

```powershell
docker ps    --filter "name=chorus-chorus-f98f4cf5" --format "{{.Names}} | {{.Status}} | {{.Ports}}"
docker port  chorus-chorus-f98f4cf5      # must show 127.0.0.1: — the loopback promise, re-proven
docker volume ls --format "{{.Name}}" | Select-String chorus-chorus-f98f4cf5
```

The Memory section should now show a **`The database Chorus started`** block naming the container,
its state, and `on 127.0.0.1:<port>`.

---

## Step 3 — Give the graph a schema and a map

Both are one press each, in the same settings screen. Skip either and the memory works but has
nothing to answer with.

1. **`Apply schema`** (in *Memory schema*) → expect `Schema version 2`.
   *Already applied on the adopted container — it will report the cached version rather than
   re-applying.*
2. **`Index code`** (in *Code structure*) → expect a line like
   *"Indexed 542 files in 39 folders, and 200 commits."*
3. Underneath it you should now see the 6b-3 freshness line:
   **`Indexed at 1c14603 · just now.`**

> If it instead reads *"· your code has moved since (now …)"*, that is correct and expected — it
> means you have committed since the index ran. Press **`Index code`** again.

---

## Step 4 — Approve the server. This is the part only you can do.

**What "approve the server once" actually means.**

Chorus writes the memory server into the agent's own config — for Claude Code that is
**`.mcp.json` in the project root**, which Claude Code treats as *shared, project-scoped* config.
**Writing that file is not the same as connecting to it.** Claude Code will not use a
project-scoped server until a human says yes, once, per project. Until then it shows the server as:

```
⏸ Pending approval
```

and, in Claude Code's own words, is **"not connected to."**

**Chorus is forbidden from approving on your behalf** — that was the CR-6.0 council's unanimous
answer to Q6 and it is D126's rule. An app that silently approved its own tool into your agent
would be doing the one thing this whole phase is about not doing.

**How to do it:**

1. Launch a **claude** pane in the Chorus project from Chorus.
2. Claude Code will prompt about the project-scoped MCP server from `.mcp.json`. **Say yes, in the
   pane.** That is the entire act.
3. Note the **time**, because the drive records it as an act performed.

**How to check it took:**

```powershell
cd C:\Projects\ContactEstablished\Chorus
claude mcp list          # chorus-memory should read "✔ Connected", not "⏸ Pending approval"
claude mcp get chorus-memory
```

> **⚠ If no prompt appears, you may already be approved for this directory.** Approval is stored
> per project directory in `~/.claude.json`. On this machine the state is genuinely ambiguous — a
> CLI `claude mcp list` here reports `chorus-memory: ✔ Connected`, while the project's
> `enabledMcpjsonServers` list is empty, so I could not confirm which way a fresh pane will go.
> **Check in the pane rather than trusting a prior state.** To force the prompt back:
> ```powershell
> claude mcp reset-project-choices   # resets approved AND rejected .mcp.json servers for this project
> ```

> **⚠ Expect `.mcp.json` to show as a git change.** It is a committed file (D172), and Chorus
> rewrites it at launch to point at whichever port this project's database is on. If the installed
> app provisions a different port than the dev container's `7688`, that write will show up in
> `git status`. That is expected, not a fault — but do not commit it without meaning to.

---

## Step 5 — The cold launch, and the number that matters

This is the measurement D173 is waiting on.

1. In the Memory section, press **`Stop`** on the container.
2. **Quit Chorus entirely.**
3. Start Chorus again.
4. Launch a **claude** pane in the Chorus project — and **time it** (a stopwatch is fine; you are
   looking for seconds, not milliseconds).

**Expected:**

- `docker ps` afterwards shows the container **Up** — Chorus started it.
- The launch button reads **`Launching…`** while you wait.
- The Memory section's *Last launch* line reads:
  **`Last launch (HH:MM): Chorus started the graph (N.Ns) — the memory contract was sent to claude.`**

**⚠ Write the number down.** Measured on this machine, on the packaged build against a copy:
**6152 ms cold**, bolt answering at 4673 ms. **If your measured wait exceeds 10 s, that reopens
D173's declined cancel button** — the decision is explicitly revisitable on exactly that threshold,
and a wait nobody wrote down cannot be checked against it.

---

## Step 6 — The milestone drive. This is the point of the phase.

**The milestone is binary and is read off 6b-1's counters, never off a transcript.**

Do an **ordinary piece of work** in a claude pane in the Chorus project. The one rule:

> **⚠ YOUR PROMPT MUST NEVER MENTION THE GRAPH, THE MEMORY, OR THE TOOLS.** The whole question is
> whether an agent reaches for memory *unprompted*. Every previous "success" on this feature was a
> drive where a human pointed at it, which is why F90 exists. A prompt like *"have a look at the
> memory graph"* answers nothing.

Something like *"why does the launch dialog default to a new worktree?"* is ideal — a real question
whose answer might plausibly be in the graph.

**Then read the result**, in Project settings → Memory:

| Reading | Where | Passes when |
|---|---|---|
| Reads / writes for the session | the pane card's footer, live | ≥ 1 read |
| The ordinals | *Memory* section | **read-first**, not shell-first, not inconclusive |
| The provenance ratio | **`Count sources`** | **N of N, with N ≥ 1** |

**Pass = ≥1 graph read before any `Read`/`Glob`/`Grep`, AND ≥1 sourced `:Memory` write.**

---

## Step 7 — Record it, either way

Whatever happened, write it down. The honest failure is worth more than a vague success.

| Item | Record |
|---|---|
| Installed build carries 6b-1..3 | yes / no |
| Memory provisioned on the installed app | yes / no — and adopted or created |
| Server approved | yes / no — **with the timestamp** |
| Container auto-started at launch | yes / no — **with the wait as a number**, and whether > 10 s |
| Contract emitted | yes / no |
| **Milestone: reads ≥ 1 before exploration** | yes / no |
| **Milestone: sourced writes ≥ 1** | yes / no |

**The last row is the one that decides Task 6b-4.** Its first hard gate is *"6b-3's installed-app
milestone drive recorded writes = 0"* — so:

- **writes ≥ 1** → the agents use memory unprompted. **Phase 6b closes and 6b-4 never happens.**
- **writes = 0** → 6b-4's write-nudge becomes live work, still behind two more gates (listener-down
  behaviour measured silent in the pane, and your explicit authorisation).

---

## If something goes wrong

| Symptom | What it means | What to do |
|---|---|---|
| No `Start a database for me` button | Chorus did not detect docker, or memory is already configured | Start Docker Desktop and reopen the screen |
| Launch hangs ~15 s then the pane opens anyway | The graph did not answer in the budget. **Working as designed** — contract withheld, session still launched | Check the *Last launch* line; check `docker ps` |
| Launch returns instantly, memory not connected | `docker start` was refused — Docker Desktop down (D173 Q6's fail-fast: no poll against a container that never started) | Start Docker Desktop |
| `⏸ Pending approval` persists | The approval did not take | `claude mcp reset-project-choices`, relaunch, say yes |
| A codex pane dies with `stdout is not a terminal`, leaving a file named `(old)` | **You are on a pre-0.7.5 build.** That is F96 | Install 0.7.5 |

**Never remove a volume.** Chorus itself refuses to (F49/D151), there is no export/restore path
yet, and it is the one action in this whole drive that destroys something unrecoverable.
