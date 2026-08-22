# Task 6b-3 — Execution Prompt (paste into a fresh session)

> **⚠ AUTHORED 2026-08-21 AT `1c14603` ON BRANCH `agent/memory-contract-v2`, WHICH IS NOT THE COMMIT
> — OR THE BRANCH — THE TASK DOCUMENTS WERE WRITTEN AGAINST.** `Task-6b-3.md` and
> `ImplementationSpec-6b-3.md` were both authored at **`a3ba6f9`**, before 6b-1 and 6b-2 existed in
> any tree. Both have since landed, and between them they added 58 lines to `src/main/ipc.ts`, gave
> `withMcpEnv` a fifth parameter, moved `renderInstructionsFor` out of `ipc.ts`, and grew
> `memoryService.ts` by ~140 lines. **Every `ipc.ts` and `memoryService.ts` line number in both
> documents is now wrong, most of them by 40–140 lines.** Every anchor below was re-taken this
> session by opening the file, and the AST counters were executed rather than remembered.
>
> **There is no fatal spec bug in this task.** The design still holds against the code as it stands:
> 6b-2's MERGE is where the reachable gate lives, its contract context already carries a
> `lastIndexedHead` field wired to `null` with a comment naming this task, and `AgentSessionFacts` is
> a two-field object with room for the third. What there *is* — **line-number drift, three findings
> the documents predate, and two decisions this task must take rather than inherit** — is in
> **§C Corrections** below. **Read §C before the spec.**

---

## §A — Role

You are the **Coordinator** for **Task 6b-3 — Always on, at launch**, the **third of four tasks in
Phase 6b — Memory Adoption & Measurement**.

**Repo root:** `C:\Projects\ContactEstablished\Chorus`

**Expected branch: `agent/memory-contract-v2`** at **`1c14603`** ("Agents are now told how to use the
project's memory, and their notes can be traced back"). Confirm with `git branch --show-current` and
`git log --oneline -1`.

> **⚠ 6b-2 HAS NOT BEEN MERGED TO `main` YET.** Checked this session with `git merge-base
> --is-ancestor`: `10a2bee` (6b-1) **is** an ancestor of `main` (`616d89b`); `1c14603` (6b-2) **is
> not**. This task depends on 6b-2 having landed, so it must start from
> `agent/memory-contract-v2`. **Do not switch or create branches without instruction.** If Matthew
> has merged that branch to `main` before you start, work from `main` instead and say so in your
> report — but verify the merge is actually there (`git log --oneline main | head -5`) rather than
> assuming it.

---

## §B — Goal

Make the memory feature **on by default for the projects a user actually opens**, with nothing in
Chorus ever running unattended. Three halves, and the third is an act rather than a diff:

- **(a) Start it.** A launch into a project whose memory row is `mode = 'local-docker'` may
  `docker start` the container and wait — **wall-clock bounded, bolt-level, never TCP** (F93) — for
  the graph to answer, so 6b-2's MERGE succeeds and the contract is emitted. **A failed `docker start`
  costs no bolt poll at all** (D173 Q6).
- **(b) Keep it fresh.** After a reachable launch returns, refresh the structural index **once per
  HEAD**, in the background, filling `:Project.lastIndexedHead` — the field 6b-2's contract already
  renders as `unknown`.
- **(c) Turn it on for real.** Provision memory on the **installed** app for its own *Chorus* project,
  approve the server once, and drive the milestone. **Record whether it worked.** F90 exists because
  a feature nobody had turned on was assumed to be on.

**Scope authority is `Task-6b-3.md` as amended by §C below**; `ImplementationSpec-6b-3.md` owns
insertion points, deadline arithmetic, Cypher and copy. Where the two disagree, the task document
wins; where either disagrees with the code you read, **the code wins and you write the disagreement
down.**

---

## §C — Corrections and cross-references (READ BEFORE THE SPEC)

### C1. Every `ipc.ts` and `memoryService.ts` anchor has moved

Re-taken 2026-08-21 at `1c14603`. **Left column is what the documents say; right column is the truth.**

| Anchor | Docs say | **Actually** |
|---|---|---|
| `withMcpEnv` definition | `ipc.ts:728` | **`ipc.ts:767`** — and it now takes a **fifth positional parameter, `sessionId: string`** |
| `withMcpEnv` call sites | `:1577` · `:1630` · `:1660` · `:2821` | **`:1674` · `:1727` · `:1757`** (launch) · **`:2918`** (restore relaunch) |
| `MemoryIndex` handler | `ipc.ts:4127` | **`ipc.ts:4239`** |
| `CodeIndexSource` | `memoryService.ts:265` | **`memoryService.ts:363`** |
| `IndexReport` | `memoryService.ts:284` | **`memoryService.ts:382`** |
| `index` | `memoryService.ts:929` | **`memoryService.ts:1071`**; its `UPSERT_PROJECT` run moved `:994` → **`:1136`** |
| `containerStatus` / `containerStart` | `:776` / `:780` | **`:874` / `:878`** |
| `waitForBolt` | `memoryService.ts:478` | **`memoryService.ts:576`** (`BOLT_READY_ATTEMPTS` **`:57`**, `BOLT_READY_INTERVAL_MS` **`:58`** — both unchanged) |
| `readContainer` / `actOnContainer` | `:495` / `:537` | **`:593` / `:635`** |
| `provision` / `validate` | `:643` / `:1058` | **`:741` / `:1200`** |
| `withSession` docblock | `neo4jClient.ts:143` | interface **`:154`**, implementation **`:226`**; `probe` is **`:253`**; `CONNECT_TIMEOUT_MS` **`:53`** unchanged |
| `memoryIndexResponseSchema` | `shared/ipc.ts:3216` | **`shared/ipc.ts:3365`**; `memoryLaunchEventSchema` is **`:3312`** |
| `indexMemory` forwarder | `preload/index.ts:269` | **`preload/index.ts:271`**; `onMemoryLaunch` is **`:673`** |
| `MemoryIndexReport` | `stores/memory.ts:95` | **`stores/memory.ts:126`**; `launchByProject` state **`:88`**, `refreshContainer` action **`:517`** |
| `isChorusManaged` | `ProjectSettingsView.vue:450` | **`:480`**; *Code structure* label **`:1135`**; the mount-time `refreshContainer()` **`:347`**; the provision button **`:853`** |
| `-o NUL` hook command | `claude.ts:200` | **`claude.ts:223`** (do not touch it — 6b-4's territory) |

**Unchanged, verified rather than assumed:** `git.ts` `runGit` `:92`, `GIT_TIMEOUT_MS` `:35`,
`currentBranch` `:322`, `rootCommitShas` `:472`, `countCommits` `:519` — **and there is still no
full-HEAD-sha helper**, so §2's `headSha` really must be written. `codeIndexCore.ts` `UPSERT_PROJECT`
`:313`, `ALL_INDEX_STATEMENTS` `:377` (**7 statements**). `dockerCore.ts` `startArgs` `:139`,
`isRunning` `:268`, `publishedBoltEndpoint` `:280`. `docker.ts` `startContainer` `:171`,
`DOCKER_QUERY_TIMEOUT_MS` `:50`. `graphSchemaCore.ts` `GRAPH_MIGRATIONS` `:51` (**2 entries**),
`LATEST_GRAPH_VERSION` `:122`. `memoryConfigCore.ts` `MEMORY_MODES` `:39`, `supportedMode` `:104`.
`main/index.ts` `createMemoryService` `:891`, its `codeIndex` block `:898`. `LaunchDialog.vue`
`busy` `:71`, the disabled binding `:1148`, the literal `Launch` label `:1151`.

### C2. `withMcpEnv` is not the function the spec describes

Spec §5.1 says "inside `withMcpEnv` (`:728`)" and describes a function that takes four parameters and
ends at `wireMcpForLaunch`. **Open `ipc.ts:767` and read it top to bottom before writing a line.**
What is actually there now:

1. `memory.mcpLaunchInput(project.id)`, `if (!input) return opts` — **the CONFIGURED gate**.
2. `getAdapter(agent)` — one lookup for both consumers.
3. **`await memory.registerAgentSession(...)` — the REACHABLE gate**, whose result decides whether the
   contract is composed. Its docblock says in capitals that **this await can never fail a launch**.
4. `broadcastMemoryLaunch(project.id, sessionId, agent, registration.ok)` — `ipc.ts:716`.
5. `renderInstructionsFor(...)` with a `MemoryContractContext | null`, in which
   **`lastIndexedHead: null` already sits with the comment `6b-3 fills this from
   :Project.lastIndexedHead`** — that is your insertion point, already labelled.
6. `wireMcpForLaunch`, then the `envAdditions` merge and three early returns.

**Your start goes BEFORE step 3** (a container that is not running cannot answer the MERGE), and the
freshness read rides **inside** step 3's existing round trip — `registerAgentSession`
(`memoryService.ts:942`) already runs `MERGE_AGENT_SESSION` (`:233`) and then `READ_SESSION_FACTS`
(`:259`) in one `withSession`. Add the head sha to **that** statement and to `AgentSessionFacts`
(`:210`), rather than opening a second connection.

**⚠ There is a comment at `ipc.ts:831` that says there are now TWO gates and that "no third gate may
be added here."** Your container start is **not** a third gate — it is a precondition that runs before
the reachable gate and never decides the contract on its own. Say so in a comment, or the next reader
will think the rule was broken.

### C3. Three findings the task documents predate

- **F95 — the contract's self-verifying `RETURN` never reaches the agent.** `write_neo4j_cypher`
  discards result rows and returns `{nodes_created, relationships_created, properties_set}`, or `{}`
  when the MATCH found nothing. Contract line 14 tells the agent to read `m.id`, `produced` and
  `supportedBy` — fields it will never see. **You are editing the contract context anyway (b).
  DECIDE, EXPLICITLY: fix the wording in this task, or leave it and say why.** The templates are
  D169/D173 text and the contract's line count is pinned by a test, so a rewrite is a real change —
  but "the drive's agent worked it out anyway" is not a reason to ship instructions that are wrong.
- **F96 / D175 — how codex and opencode are spawned changed on 2026-08-21.** `pickSpawnable`
  (`cliDetect.ts:24`) now resolves an npm `.cmd` shim to the file it actually launches; codex runs as
  `node.exe …\@openai\codex\bin\codex.js` and opencode as its own `.exe`. **Nothing in 6b-3 touches
  this**, but if a codex pane behaves oddly in your drive, that is the recent change and
  `_verify/6b-2/28-F96-FIX-RESULTS.md` is its evidence.
- **F97 — a boot-restored session gets no `:AgentSession` node.** `sessionManager.restore()` calls
  `spawn()` directly with no `LaunchOptions`, so it never reaches `withMcpEnv`: no contract, **and no
  session node**, which means a memory written from a restored session is unsourced by construction.
  **The roadmap names 6b-3 as the owner of this ruling.** Decide it: either the restore path joins the
  `withMcpEnv` call sites, or it does not and the reason is written down. Note that `withMcpEnv` is
  already called on the **restore relaunch** path (`ipc.ts:2918`) — it is `restore()` at boot that
  misses. Whichever way you rule, record it; the next free decision number is **D176**.

### C4. Counters, re-run this session rather than inherited

| Counter | Value at `1c14603` | Method |
|---|---|---|
| `IpcChannel` keys | **109** (0 spreads) | AST, `ObjectLiteralExpression` property count |
| Assertions that must move together | **`ipc.test.ts:3523`**, **`:3939`**, **and the `memory:*` enumeration at `:4136`–`:4156`** | 6b-2 found the third one the hard way — it lists **14** memory channels today; `memory:freshness` makes **15** |
| `MIGRATIONS.length` | **21** — next free **v22**, and this task claims none | AST array-literal length |
| `GRAPH_MIGRATIONS` | **2** entries; `LATEST_GRAPH_VERSION` **2** | AST — every statement is `CREATE CONSTRAINT` / `CREATE INDEX`, so a node property is not schema |
| `ALL_INDEX_STATEMENTS` | **7** | AST — a new statement not added here is one the no-deletion test does not cover |
| `sqliteTable(` | **19** | AST |
| `ipcMain.handle(` | **94** | AST |
| Runtime dependencies | **9** — this task adds none | `package.json` |
| Baseline gates | typecheck **0** (node + web) · vitest **2813 / 2813 across 76 files** · `grep:secrets` **clean, 6 patterns** | run this session |

**⚠ The vitest baseline is 2813, not the "2792" 6b-2's summary recorded** — that number was measured
on a different branch. **Re-run it yourself at pickup and use your own number.**

### C5. Machine state, measured 2026-08-21

- `chorus-g2-neo4j`: **Up**, restart policy **`no`**, `127.0.0.1:7688 -> 7687/tcp`. Docker **29.7.2**.
  A restart policy other than `no` would change this task's premise — read it again, do not assume.
- The graph holds **7 `:AgentSession` nodes** (4 from 6b-2's drive, 3 from the F96 drive on the 21st)
  and **2 `:Memory`** — the Task 6-5 canary with no `chorusProjectId`, and one sourced memory, so
  `memory:validate` reads **1 of 1**. `lastIndexedAt` is still **2026-08-15** and HEAD is far ahead:
  **the graph is stale, which is exactly the state part (b) needs.**
- Dev DB (`%APPDATA%\chorus\chorus.db`): **one** `project_memory` row — the Chorus project, mode
  **`existing`**, `bolt://127.0.0.1:7688`. **`existing` is never started by Chorus**, so Part 1's
  auto-start test needs a **throwaway `local-docker` project**, as the task document says.
- `.mcp.json` is back to `bolt://127.0.0.1:7688` (a stale `192.0.2.1` blackhole address from 6b-2's
  timing test was cleared on the 21st). Its `git diff` is line-endings only. **Leave it.**

---

## §D — Pre-existing working-tree changes: DO NOT REVERT, STAGE, OR COMMIT

`git status --porcelain` at authoring time — **three entries, none of them yours**:

```
 M .mcp.json
 M package-lock.json
 M package.json
```

- **`.mcp.json`** has no content diff — a CRLF artefact. Leave it.
- **`package.json` / `package-lock.json`** carry a version bump **0.7.2 → 0.7.4** and nothing else.
  That is somebody's release prep. **Do not revert it, do not commit it, and do not bump the version
  yourself** — the task document says the bump for the installed-app drive is a separate, later commit
  that Matthew authorises.

If you find **any other** modified file, **report it — do not absorb it and do not revert it.**

---

## §E — Ground yourself first (before editing anything)

1. **Read, in this order:** `CLAUDE.md` · `docs/Features/Foundation/roadmap.md` §6 **D169, D170,
   D173** and §5 **F90, F93, F94, F95, F96, F97** · `Tasks/Phase-6b-Overview.md` · `Tasks/Task-6b-3.md`
   (whole) · `ImplementationSpecs/ImplementationSpec-6b-3.md` (whole) · `Tasks/Task-6b-2-CompletionSummary.md`
   (what actually shipped, including the three findings and the deliberate spec deviation).
2. **Open and read** — not grep, read: `ipc.ts:767`–`:920` (all of `withMcpEnv`),
   `memoryService.ts:185`–`:265` (the `:AgentSession` types and both Cypher statements),
   `memoryService.ts:942`–`:990` (`registerAgentSession`), `memoryService.ts:576`–`:600`
   (`waitForBolt`, and why it cannot be reused as-is), `memoryService.ts:874`–`:890`
   (`containerStatus` / `containerStart`), `codeIndexCore.ts:313` and `:377`.
3. **Run the spec's §0 probes** (`ImplementationSpec-6b-3.md:15`) and save the raw output under
   `_verify/6b-3/`. **If a probe disagrees with a number in any document, the probe wins and you write
   the disagreement down.** ⚠ Run the stop→start→bolt re-measurement on a **throwaway** container —
   stopping `chorus-g2-neo4j` interrupts whatever is using the dev graph.
4. **Run the gates before you touch anything**, so you know what you inherited: `npm run typecheck`,
   `npx vitest run`, `npm run grep:secrets`.
5. **Confirm the mode literal from three places** before writing the guard —
   `memoryConfigCore.ts:39`, `ProjectSettingsView.vue:480`, `memoryService.test.ts:275`.
   **D170's prose says `mode = 'container'`; there is no such value anywhere in the code** — and the
   spec's own pointer for the third of those (`memoryService.test.ts:661`) is stale too; the
   `local-docker` assertions are at **`:265`–`:275`**.

---

## §F — Implementation scope

**Follow `Task-6b-3.md` §Exact Scope and `ImplementationSpec-6b-3.md` §1–§7 as written**, with every
line number replaced by §C1's. In outline — create `indexFreshnessCore.ts` (**pure**: staleness
predicate, short-sha formatter, once-per-HEAD key, authored sentences) and its test; add `headSha` to
`git.ts`; add `p.lastIndexedHead = $headSha` to `UPSERT_PROJECT`; add `ensureStartedForLaunch`, a
**wall-clock-deadline** bolt wait and `freshness(projectId)` to `memoryService.ts`; wire `headSha`
into `main/index.ts:898`; in `ipc.ts` start before the MERGE, schedule the background index **after
the launch returns**, and feed `broadcastMemoryLaunch` two more facts; extend
`memoryLaunchEventSchema` with `started` and `waited_ms` (**no new event channel**) and add **one**
new request channel for the freshness read; thin forwarders in preload; store and
`ProjectSettingsView.vue` surfaces; **one line** in `LaunchDialog.vue` (`:1151` → `Launching…` while
`busy`); and a comment-only correction to `neo4jClient.ts`'s `withSession` docblock.

**The four decisions this task must take rather than inherit**, each recorded in the report:

1. **F97** — does `restore()` join the `withMcpEnv` sites? (next free decision number **D176**)
2. **F95** — is the contract's line 14 wording fixed here, or deferred with a reason?
3. Whether the measured installed-app wait **exceeds 10 s**, which per D173 reopens the declined
   cancel button.
4. Whether the installed-app drive could be run at all (see §H Part 3's fallback).

---

## §G — Strict non-goals

Itemised in `Task-6b-3.md` §Non-Goals; the ones that are greppable gates:

- **No timer, no `setInterval`, no file watcher, no post-commit hook, no boot-time action.** The only
  loop permitted is the single bounded wait inside one launch.
- **No docker volume operation of any kind** — no `volume rm`, `rm -v`, `--rm`, `volume create`.
- **No new docker argv builder.** Call `containerStart` / `containerStatus`; write no docker code.
- **Chorus never starts a `mode = 'existing'` container.** Assert it as a unit test.
- **No SQLite migration** (stays **21**) and **no graph migration** (`LATEST_GRAPH_VERSION` stays **2**).
- **No deletion of any node or edge**; no statement outside `ALL_INDEX_STATEMENTS`.
- **No change to `claude.ts:223`'s `-o NUL`** — 6b-4's territory.
- **No nudge, no new counter, no new renderer route, no retry, no cancel button** (declined by Matthew
  2026-08-19, D173 Q6 — revisit only on the >10 s measurement).
- **No new npm dependency** (deps stay **9**), **no version bump**, and **no pane-level notice** —
  6b-2 refused it and 6b-3 does not reopen it, because PTY bytes are mirrored and persisted
  (`sessionManager.ts`), so a Chorus sentence would be indistinguishable from agent output in a saved
  transcript.

---

## §H — Verification

### Build and structural gates

```
npm run typecheck            # 0, node + web
npx vitest run               # >= your own measured pickup baseline (2813 / 76 files at authoring), plus this task's cases
npm run grep:secrets         # clean, 6 patterns

grep -nE "\bDELETE\b|\bDETACH\b|\bREMOVE\b" src/main/services/codeIndexCore.ts   # only prose, if anything
grep -nE "volume\s+rm|rm\s+-v|--rm" src/main/services/docker*.ts                 # nothing
grep -rnE "setInterval|fs\.watch|chokidar" src/main/services/memoryService.ts src/main/ipc.ts
grep -rn "post-commit" src/main                                                  # nothing
docker ps -a --filter name=chorus-g2-neo4j --format '{{.Status}}'                # must be Up for dev drives
```

Plus the AST counters in §C4, re-run **before and after**, with `IpcChannel` expected to move
**109 → 110** and `MIGRATIONS.length` expected **not to move**.

> **⚠ THE DELETION-VERB GREP SELF-MATCHES.** 6b-2 hit this: the only hit in `instructionsCore.ts` was
> the prose line *forbidding* deletion. Read what a grep hit actually says before calling it a
> failure — and before calling a clean grep a pass, check the grep can fail at all.

### Runtime drive — three parts, and the third is the point

**Run `Task-6b-3.md`'s drive as written** (`:439`–`:528`): Part 1 the auto-start including the
timeout path and the **fail-fast** path (Docker Desktop stopped → launch returns in **under 2 s**,
refusal in the log, **no bolt-wait line at all**) and the `existing`-is-never-started proof; Part 2
index freshness including the two-panes-one-index guard; **Part 3 the adoption drive on the INSTALLED
app**, which requires `npm run dist` and installing from `release/` so the installed build actually
contains 6b-1..3.

**Drive notes this session's experience earns you:**

- CDP on **9222** for the dev app. Kill the dev instance **by command line (`*9222*`), never by
  process name** — `taskkill` on `electron.exe` takes the installed app with it.
- A built instance is driven as `npm run build`, then
  `./node_modules/electron/dist/electron.exe . --remote-debugging-port=9222`. Working CDP helpers
  already exist in `_verify/6b-2/`: `cdp-lib.cjs`, `pane-text.cjs`, `read-sessions.cjs`,
  `drive-codex.cjs`. Reuse them rather than rewriting.
- Read the dev DB through **`ELECTRON_RUN_AS_NODE=1 electron.exe <script>`** against a **copy** with
  its `-wal`/`-shm`, never the live file.
- **Record the measured wait as a number** in the report and under `_verify/6b-3/`. A wait above 10 s
  on the installed app reopens D173's declined cancel button, and a wait nobody wrote down cannot be
  checked against that threshold.
- Leave every container **running** at the end.

### Failure honesty

**Any command that fails — for any reason, including an environmental one** (Docker Desktop down, an
ABI mismatch, a locked DB, a missing CLI, a build that will not produce an installer) — **is reported
with its exact output, and the step it belonged to is not claimed.** A drive that ran on the dev app
says so, in plain words, naming what is untested. **F90 exists because a feature nobody turned on was
assumed to be on.**

---

## §I — Required workflow

- **Small, reviewable changes; explain architectural choices briefly before large edits** (CLAUDE.md).
- **Ask before adding any dependency.** The stack is locked.
- **All IPC Zod-validated in main only**; payloads crossing the bridge are **plain objects** —
  snapshot with `JSON.parse(JSON.stringify(x))` before sending, and runtime-verify every new
  renderer→main payload (D14). A Pinia proxy fails at runtime with no compile-time signal.
- **One intentional commit** at the end, in this repo's house style: a layman's-terms title, a *What
  this does* section a non-technical reader can follow, then *Technical detail*. End with
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Do not push and do not open a PR unless explicitly asked.**
- **Roadmap:** record the task's close-out in `roadmap.md` §7 Phase 6b (the 6b-3 row and a `####`
  block in 6b-1's style), plus any new decision (**next free D176**) or finding (**next free F98**).
  ⚠ **`roadmap.md` is LF-only except for ONE lone CR byte.** Edit it byte-wise — read and write as
  utf8 with Node and never let a text-mode round-trip normalise newlines, or you will manufacture a
  ~3,800-line phantom diff. Verify after editing that the lone-CR count is still **1** and that
  `git diff --stat` shows only the hunks you meant.

---

## §J — Final report

State each of these explicitly:

1. **Status** — `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`.
2. **Files changed**, with the counter before/after table from §C4.
3. **Build results** — typecheck, vitest (your own pickup baseline → final), `grep:secrets`, each with
   its actual number.
4. **Runtime results, per drive part**, with **what you actually observed**, not what was expected:
   the measured `docker start` and bolt-ready times, the measured launch wait, the fail-fast timing,
   the `existing`-not-started proof, the once-per-HEAD proof, and the two-panes-one-index proof.
5. **Part 3's precondition list, item by item** — installed build carries 6b-1..3 (yes/no); memory
   provisioned on the installed app (yes/no); server approved, with timestamp (yes/no); container
   auto-started at launch (yes/no, **with the wait as a number and whether it exceeded 10 s**);
   contract emitted (yes/no). **If the installed-app half could not be run, say so plainly and name
   what is untested.**
6. **The four decisions from §F**, each with its ruling and reason.
7. **Non-goals confirmation** — each greppable gate, with the command and its output.
8. **Residual risks and anything you found that neither document records.**
9. **Final `git status`**, confirming the three pre-existing entries in §D are still there, unstaged
   and unreverted.

**Do not report a compiled feature as a delivered one.** This project's standing rule (roadmap §3,
step 4) is that a runtime drive is part of the work, not evidence for it.
