# Task 6b-3 — Always on, at launch

_Phase 6b, task 3 of 4. Authored 2026-08-19 against `a3ba6f9`; amended 2026-08-19 after CR-6b.0 (D173)._

> **⚠ THIS IS THE TASK F90 EXISTS FOR, AND ITS DELIVERABLE IS PARTLY AN ACT RATHER THAN A DIFF.**
> The memory feature works. Nobody has it on. The installed app has **0 `project_memory` rows**, the
> one configured row on this machine points at a hand-started container behind a Docker Desktop that
> was off, and the graph is **21 commits** behind HEAD. Code alone cannot close that: §(c) of this
> task is a **drive** — provisioning memory for the installed Chorus's own *Chorus* project and
> approving the server once — and it is recorded as **done or not done**, never assumed.

## Source Of Truth

| Document | Owns |
|---|---|
| `roadmap.md` §6 — **D170** | Launch-time only; what of D149(c) and D151(c) survives; the bolt-wait; `lastIndexedHead`; adoption as an act |
| `roadmap.md` §6 — **D173** (CR-6b.0) | The council adoptions this task folds in: **Q6** fail-fast when `docker start` itself fails, **Q7** the `(project, HEAD)` key — and the **declined** cancel button for the wait, with its revisit threshold |
| `roadmap.md` §6 — **D169** (6b-2) | The `:AgentSession` MERGE that **is** the reachability gate, and the contract this task fills a field of |
| `roadmap.md` §5 — **F93**, **F90** | TCP accepts 4 s before bolt answers; the feature has never been on in daily use |
| `roadmap.md` §6 — **D149(b)**, **D151**, **F49** | The indexer never deletes; no volume operation of any kind, ever |
| [`Phase-6b-Overview.md`](Phase-6b-Overview.md) | Verified ground facts, the milestone, the phase's purity contract |
| [`Task-6a-4.md`](Task-6a-4.md) / [`../ImplementationSpecs/ImplementationSpec-6a-4.md`](../ImplementationSpecs/ImplementationSpec-6a-4.md) | **The docker CLI adapter and `containerStart` this task reuses** — it writes no new docker code |
| [`Task-6a-2.md`](Task-6a-2.md) | The indexer, its report shape, and the no-deletion rule it must keep |
| [`../ImplementationSpecs/ImplementationSpec-6b-3.md`](../ImplementationSpecs/ImplementationSpec-6b-3.md) | Insertion points, the deadline arithmetic, the Cypher, the copy, the runtime drive |

## Initial Starting Point — verified 2026-08-19 at `a3ba6f9`; amended 2026-08-19 after CR-6b.0 (D173)

Every line below was opened and read this session. **Two facts contradict what D170 and the kickoff's
ground notes say, and the code wins** — see the two ⚠ rows.

| Fact | Where | Value |
|---|---|---|
| **⚠ THE CHORUS-PROVISIONED MODE LITERAL IS `'local-docker'`, NOT `'container'`** | `memoryConfigCore.ts:39` `MEMORY_MODES` · `:104` `supportedMode` · `:116` the admitted case · `shared/ipc.ts:3063` `memoryModeSchema` | `['local-docker', 'existing', 'aura']`. **D170's prose says `mode = 'container'`; there is no such value anywhere in the code.** The renderer agrees: `ProjectSettingsView.vue:450` `isChorusManaged` is `mode === 'local-docker'`, and `memoryService.test.ts:661` asserts `store.row?.mode === 'local-docker'` after a provision. |
| **⚠ `waitForBolt` IS ATTEMPT-BOUNDED, NOT TIME-BOUNDED, AND IT CANNOT BE REUSED AS-IS** | `memoryService.ts:478` (`waitForBolt`) · `:57` `BOLT_READY_ATTEMPTS = 30` · `:58` `BOLT_READY_INTERVAL_MS = 2_000` | 30 × 2 s of *sleep* **plus** 30 probes. A probe against an open port whose server is not answering yet costs up to `CONNECT_TIMEOUT_MS` (`neo4jClient.ts:53`, **5000**), so the real worst case is **~3.5 minutes**. Correct for a Provision click; **impossible for a launch** (D170 bounds it at ≤ 20 s). The launch path needs a **wall-clock deadline**, not an attempt count. |
| `withMcpEnv` | `ipc.ts:728` | `mcpLaunchInput` at `:734`, `if (!input) return opts` — the one gate today. Called at `:1577`, `:1630`, `:1660` (launch) and `:2821` (restore relaunch) |
| Everything after `await withMcpEnv(...)` at each call site is **synchronous** | `ipc.ts:1573`–`:1592`, `:1626`–`:1638`, `:1656`–`:1670`, `:2817`–`:2842` | `sessions.launch` · `linkAttribution` · `storage.*` · `…ResponseSchema.parse` — **no `await`**. This is what makes `setImmediate` mean "after the launch returned" |
| `containerStart` / `containerStatus` | `memoryService.ts:780` / `:776` → `actOnContainer` `:537` / `readContainer` `:495` | Both already refuse without `row.containerName`, refuse without `docker.available()`, and report **what docker says after acting**. **This task adds no docker code** |
| The docker CLI adapter | `docker.ts:171` `startContainer` → `dockerCore.ts:139` `startArgs` = `['start', name]` | `execFile`, never a shell (`docker.ts:45`); `DOCKER_QUERY_TIMEOUT_MS = 15_000` (`:50`) |
| `isRunning` / `publishedBoltEndpoint` | `dockerCore.ts:268` / `:280` | the pure state readers the launch path reuses |
| `UPSERT_PROJECT` | `codeIndexCore.ts:313` | `MERGE (p:Project {id: $projectId}) SET p.name = $projectName, p.lastIndexedAt = $runId` — **no head sha**. Run at `memoryService.ts:994` with `{ projectId, projectName: projectId, runId }`; `runId` is minted at `:974` |
| The no-deletion guard | `codeIndexCore.ts:377` `ALL_INDEX_STATEMENTS` · `codeIndexCore.test.ts:242`–`:253` | a `DELETE`/`DETACH`/`REMOVE` sweep over the exported constants. **A statement not in that list is not covered** |
| `GRAPH_MIGRATIONS` | `graphSchemaCore.ts:51`; `LATEST_GRAPH_VERSION` `:122` | **two** entries, **constraints and indexes only**. A `:Project` property is neither — **no graph migration, `LATEST_GRAPH_VERSION` stays 2** |
| `git.ts` has **no full-HEAD-sha helper** | `git.ts:322` `currentBranch` = `rev-parse --abbrev-ref HEAD` · `:472` `rootCommitShas` = `rev-list --max-parents=0` · `:519` `countCommits` = `rev-list --count` | the smallest helper must be written; `runGit` `:92` at `GIT_TIMEOUT_MS` `:35` is the shape to copy |
| `CodeIndexSource` | `memoryService.ts:265`–`:273` | five injected git reads, wired at `main/index.ts:898` — the sixth joins them |
| `withSession` | `neo4jClient.ts:148`; `BoltRunner` `:130` | `run(cypher, params) => Array<Record<string, unknown>>`, **multiple statements per session** — so 6b-2's MERGE and this task's freshness read are **one round-trip** |
| **⚠ `withSession`'s docblock still says "never a boot hook, a timer, a restore path or a retry"** | `neo4jClient.ts:143` | 6b-2 widens it to *a launch*; 6b-3 must confirm it still states the truth afterwards. **A comment that outlives its code is the F90 failure one level down** |
| `memoryIndexResponseSchema` | `shared/ipc.ts:3216` · handler `ipc.ts:4127` | seven counts + `elapsed_ms`; **no head, no timestamp**. (The roadmap's F90 row cites `ipc.ts:4130`; the handler is at **`:4127`** today) |
| `MemoryContainerStart` handler | `ipc.ts:4225` | (F90 cites `:4229`; it is **`:4225`** today) |
| **No memory timestamp is rendered anywhere** | `ProjectSettingsView.vue` — grep for `toLocale`/`Intl`/`Date(` returns nothing | `memoryStatusSchema` (`shared/ipc.ts:3087`) carries `last_seeded_at` (`:3099`) and `updated_at` (`:3100`) and **neither reaches the screen**. There is no `last_indexed_at` on the wire at all |
| The Memory UI | `ProjectSettingsView.vue:810` section · `:811` heading · `:948` *Memory schema* section · `:987` *The database Chorus started* · `:989`–`:994` the container state line (built at `:459`) · `:1092` *Code structure* · `:1104`–`:1110` **Index code** · `:1111` `indexSummary` (`:390`) · `:1114` `indexCaveats` (`:404`) · `:323` `refreshContainer()` on mount | `indexByProject` (`stores/memory.ts:60`) is **session-lifetime by design** (`:58`–`:59`) |
| **⚠ At `a3ba6f9` there is NO main→renderer channel carrying a free-text session or project notice** | `preload/index.ts:555`–`:744` (the full event set) | the only `message: z.string().nullable()` anywhere is `voiceStateEventSchema` (`shared/ipc.ts:4415`), which carries no `sessionId` and no `projectId`. **6b-2 adds one** — `memory:launch`, `{project_id, session_id, agent, reachable, at}` — and **6b-3 extends that payload rather than adding a second channel** |
| **⚠ 6b-2 REFUSED A PANE-LEVEL NOTICE, WITH REASONS, AND 6b-3 DOES NOT REOPEN IT** | `ImplementationSpec-6b-2.md` §7 | the only way to put a sentence *in* a pane is PTY bytes, which are mirrored and **persisted** (`sessionManager.ts:735`–`:751`) — a Chorus sentence would become indistinguishable from agent output in a saved transcript, *"the worst possible provenance failure in a phase about provenance"*. The outcome lives on the Memory section's **`Last launch (10:41): …`** line |
| The launch's own pending UI | `LaunchDialog.vue:71` `busy` · `:640` · `:698` · `:1148` `:disabled` · `:1151` the label | **a greyed-out button reading the static word `Launch`, and nothing else.** No spinner, no copy change |
| Provision already starts + waits | `memoryService.ts:672`–`:686` (adopt-and-start), `:731` (`waitForBolt`) | the precedent this task narrows for the launch path |
| Measured, this machine, 2026-08-19 | kickoff `waitbolt.cjs` → `{"tcpReadyMs":2,"boltReadyMs":4296}` | `docker start` **358 ms** · TCP **2 ms** · **bolt 4296 ms** (F93). Index cost **3006 / 2517 ms** for 447–468 files + 200 commits (`_verify/6a-2/drive-index-output.txt`) |
| Baseline gates | Phase-6b-Overview | typecheck **0** · vitest **2618 / 74 files** · `grep:secrets` clean · `IpcChannel` **107** · `MIGRATIONS.length` **20** (→ **21** after 6b-1) · runtime deps **9** · app version **0.7.2** |

## Goal

Make the memory feature **on by default for the projects a user actually opens**, without anything in
Chorus ever running unattended. A launch is a click; that click may start the project's own container
and wait a bounded few seconds for the graph to answer, and — once the session is running — refresh
the structural index if HEAD has moved since it was last built. **And when the start itself fails** —
Docker Desktop down, the daemon refusing — the launch spends nothing on the wait: the refusal returns
**before any bolt poll**, because a container that never started will never answer (**D173 Q6**,
adopted from CR-6b.0; the shape is already the spec's §4.3 guard order). Then **go and turn it on for
real**, on the installed app, on this repository, and record whether it worked.

## ⚠ What survives of D149(c) and D151(c), stated precisely

D170 **narrows** them; it does not discard them. After this task all of the following are still true,
and each is a line a reviewer can grep for:

- **No timer.** No `setInterval`, no polling loop that is not inside a single bounded launch wait.
- **No file watcher.** *"A watcher would fight the agents for the database"* — still true, still refused.
- **No git hook.** A post-commit hook writes into the user's repository (D49). Refused.
- **No boot-time action.** Nothing starts, indexes, probes or connects because the app launched, a
  window opened, a session restored, or a project list rendered. **~0.5–1 GB of heap per project**
  (D147(c)) for projects the user may not touch today, and it would be the app's first unattended
  docker call.
- **`mode = 'existing'` rows are NEVER started by Chorus.** Chorus does not own that container. The dev
  DB's hand-run row stays by-hand, by design.
- **No docker volume operation of any kind.** No `volume rm`, no `rm -v`, no `--rm`, no `volume create`,
  no volume anything. F49 gates durability on an export/restore path that does not exist. The 6a-4
  grep test (`dockerCore.test.ts:129`) still passes, unchanged.
- **The indexer still deletes nothing** (D149(b)). `codeIndexCore.test.ts:242` still passes, and this
  task adds a property to `UPSERT_PROJECT` — a `SET`, never a `REMOVE`.

**What changes is one word:** *user-initiated* stops meaning *"a button in a settings screen the user
never opens"* and starts also meaning *"the launch the user just asked for"*. That is the whole of
D170, and F90 is the evidence that the narrower reading shipped a feature nobody has.

## Exact Scope

**Create**

- `src/main/services/indexFreshnessCore.ts` — **pure**: the staleness predicate, the short-sha
  formatter, the once-per-HEAD key, and the authored sentences. No `fs`, no driver, no `electron`.
- `src/main/services/indexFreshnessCore.test.ts`

**Edit**

- `src/main/services/git.ts` — one helper: `headSha(cwd)` (`rev-parse HEAD`), at the query timeout,
  returning `null` on failure exactly as `rootCommitShas` (`:472`) does.
- `src/main/services/codeIndexCore.ts` — `UPSERT_PROJECT` (`:313`) gains `p.lastIndexedHead = $headSha`.
  **Nothing else in that file changes.**
- `src/main/services/memoryService.ts` — `CodeIndexSource` (`:265`) gains `headSha`; `index` (`:929`)
  reads it beside the other git calls and passes it (`:994`); `IndexReport` (`:284`) gains `headSha`;
  a **new** `ensureStartedForLaunch(projectId)` beside `containerStart` (`:780`); a launch-budgeted
  bolt wait beside `waitForBolt` (`:478`); a new `freshness(projectId)` read.
- `src/main/index.ts` — `headSha` wired into the `codeIndex` block at `:898`.
- `src/main/ipc.ts` — `withMcpEnv` (`:728`) calls `ensureStartedForLaunch` **before** 6b-2's MERGE;
  schedules the background index **after** the launch returns; feeds 6b-2's `broadcastMemoryLaunch`
  two more facts; the `MemoryIndex` handler (`:4127`) passes `head_sha` through; one new handler for
  the freshness read.
- `src/shared/ipc.ts` — `memoryIndexResponseSchema` (`:3216`) gains `head_sha`; **6b-2's
  `memoryLaunchEventSchema` gains `started` and `waited_ms`** (no new event channel); **one** new
  request channel + schemas for the freshness read.
- `src/preload/index.ts` + `index.d.ts` — one thin forwarder beside `indexMemory` (`:269`).
- `src/renderer/src/stores/memory.ts` — `MemoryIndexReport` (`:95`) gains `headSha`; 6b-2's
  `launchByProject` entry gains the two new facts; a `freshnessByProject` field and its action, beside
  `refreshContainer` (`:421`).
- `src/renderer/src/views/ProjectSettingsView.vue` — one freshness line in the *Code structure* block
  (beside `:1111`), fetched on mount beside `refreshContainer()` (`:323`); two more sentences on
  6b-2's *Last launch* line.
- `src/renderer/src/components/LaunchDialog.vue` — **one line**: the primary button's label (`:1151`)
  becomes `Launching…` while `busy` (`:71`). See the ⚠ below for why this is in scope.
- `src/main/services/neo4jClient.ts` — the `withSession` docblock (`:143`) confirmed to state the
  post-6b-2 truth. **Comment only.**

**Nothing else.**

### ⚠ The correction D170's copy needs, and it is not cosmetic

**D170 says the pane shows *"starting memory graph…"*. The pane does not exist yet.** `withMcpEnv` is
awaited *inside* the `sessions.launch(...)` call at `ipc.ts:1577` / `:1630` / `:1660`, which is inside
the `session:launch` handler the renderer is blocked on. During the wait there is **no session and no
pane**, and at `a3ba6f9` there was no notice channel at all — verified against the complete
main→renderer event set (`preload/index.ts:555`–`:744`). What the user sees is a greyed-out button
reading the static word `Launch` (`LaunchDialog.vue:1148`, `:1151`).

So the copy splits in two, and **neither half adds a channel**:

1. **During the wait** — the only surface that exists is the launch button. Its label becomes
   `Launching…` while `busy`. **Deliberately not memory-specific:** the renderer is not told *why* the
   launch is slow, because telling it would need a mid-flight channel this task refuses to add — and
   *"Launching…"* is true of every launch. A 15-second launch behind a button that still says `Launch`
   reads as a frozen app, which is precisely the *"this feature is flaky"* impression D169 exists to
   prevent.
2. **After the launch returns** — the outcome rides on **6b-2's `memory:launch` broadcast and the
   Memory section's `Last launch (10:41): …` line**. 6b-3 adds **two fields to that event**
   (`started`, `waited_ms`) and **two sentences to that line**, and **no new event channel**:
   - *"Last launch (10:41): the graph did not answer within 15s — contract withheld. The agent
     launched without it."*
   - *"Last launch (10:41): Chorus started the graph (4.3s) — the memory contract was sent to claude."*
     — the *started* clause appears **only when Chorus actually started something**, because a line
     that appears on every launch is noise within a day.

   **⚠ 6b-2 REFUSED A PANE-LEVEL NOTICE AND 6b-3 DOES NOT REOPEN IT.** Its three recorded reasons all
   still hold — the strongest being that the only way into a pane is PTY bytes, which are **mirrored
   and persisted** (`sessionManager.ts:735`–`:751`), so a Chorus sentence would become
   indistinguishable from agent output in a saved transcript. That is the provenance failure this
   whole phase exists to prevent, and a 20-second wait does not buy it.

## Non-Goals

- **No boot-time reconciliation, no timer, no `setInterval`, no file watcher, no post-commit hook.**
  See *"What survives of D149(c) and D151(c)"* above; each has its own reason and each is greppable.
- **No docker volume operation of any kind**, and **no new argv builder** — this task calls
  `docker start` through `containerStart` and reads state through `containerStatus`. It writes **no**
  docker code. `dockerCore.ts`'s `ARGV_BUILDERS` (`:164`) is unchanged and its F49 sweep
  (`dockerCore.test.ts:129`) still passes.
- **No `dockerode`, no new npm dependency.** Runtime deps stay at **9**.
- **Chorus never starts a `mode = 'existing'` container.** Asserted as a unit test, not a review habit.
- **No SQLite migration and no graph migration.** `MIGRATIONS.length` stays at whatever 6b-1 left
  (**21**); `LATEST_GRAPH_VERSION` stays **2**. A property on a node is data, not schema — confirmed
  against `GRAPH_MIGRATIONS` (`graphSchemaCore.ts:51`), whose every statement is a `CREATE CONSTRAINT`
  or `CREATE INDEX`.
- **No deletion of any graph node or edge**, and no new statement outside `ALL_INDEX_STATEMENTS`
  (`codeIndexCore.ts:377`).
- **No change to the `-o NUL` hook entry** (`claude.ts:200`). That is 6b-4's territory and only 6b-4's.
- **No nudge, no context injection, no new counter.** 6b-1 owns counters; 6b-4 owns the nudge, and only
  if this task's drive says it is needed.
- **No new renderer route.** Memory stays in `ProjectSettingsView.vue`'s Memory sections (`:810`, `:948`).
- **No retry.** A container that fails to start, or a graph that fails to answer inside the budget, is
  reported and left alone until the next launch. A retry loop is a timer wearing a different hat.
- **⚠ NO CANCEL BUTTON FOR THE LAUNCH WAIT — DECLINED BY MATTHEW ON 2026-08-19** (D173, CR-6b.0 Q6).
  The council asked for one; the reasons for declining are recorded and the decision is revisitable.
  The wait is **wall-clock bounded at 20 s** and **measured 4.3 s warm** on this machine, and a cancel
  needs a **new IPC channel plus an abort path through `withMcpEnv`** — the same mid-flight plumbing
  this task already refuses for the mid-flight notice (see *"The correction D170's copy needs"*).
  **Revisit if the installed-app drive measures a wait above 10 s**, which is why Part 3 records the
  measured wait rather than merely asserting the bound.
- **Do not revert, stage, commit or delete unrelated working-tree changes.** Do not bump the version.

## Dependencies

**Task 6b-2 must have landed.** It is what makes this task mean anything:

- its **MERGE is the reachability gate** — this task's container start exists to make that MERGE
  succeed, and its background index is scheduled only when that MERGE succeeded;
- its **contract context** carries a `lastIndexedHead` that 6b-2 leaves `null` (rendered *"unknown"*);
  filling it is §(b) of this task;
- its **`memory:launch` broadcast** (`{project_id, session_id, agent, reachable, at}`) and the Memory
  section's *"Last launch (10:41): …"* line are the surface this task's two sentences extend — **two
  fields added to an existing event, not a second channel.**

Sequential. 6b-1, 6b-2 and 6b-3 all edit `src/main/ipc.ts` and `src/shared/ipc.ts`.

## Step-by-step Work

1. **Probe first (spec §0).** `docker --version`; `docker inspect chorus-g2-neo4j` for restart policy
   and ports; **re-measure stop → start → bolt** with the kickoff's `waitbolt.cjs` method
   (`net.connect` for TCP, `driver.verifyConnectivity()` for bolt, 250 ms poll) — **on a
   Chorus-provisioned throwaway container, or on the dev one only with Matthew's knowledge, because
   stopping it interrupts whatever is using it.** Confirm `GRAPH_MIGRATIONS` needs nothing and confirm
   the mode literal is `'local-docker'`. **Quote no number from this document that you have not
   re-taken.**

2. **`indexFreshnessCore.ts` — the pure half, written and tested before anything calls it.**
   `isIndexStale(lastIndexedHead, headSha)`:
   - `headSha === null` → **not stale**. A repository with no commits, or a project that is not a git
     repository, has no HEAD to compare — and a predicate that returned `true` there would re-run the
     indexer on every launch, forever, for a project it cannot index.
   - `lastIndexedHead` null / absent / empty → **stale**. Every graph indexed before this task.
   - otherwise `lastIndexedHead !== headSha` → stale. **Exact string comparison**; git emits lowercase
     40-hex and nothing normalises it.

   Plus `shortSha(sha)` (7 chars, `null`-safe) and `freshnessKey(projectId, headSha)`.

3. **`git.ts` — `headSha(cwd)`.** `rev-parse HEAD`, trimmed, `null` inside a `catch` — `rootCommitShas`
   (`:472`) is the shape and its comment gives the reason: *"does not have any commits yet" / not a
   repository — both mean the caller handles it as a stated limit rather than a fault.* Query timeout
   (`GIT_TIMEOUT_MS`, `:35`), never the checkout one.

4. **`UPSERT_PROJECT` gains one clause** (`codeIndexCore.ts:313`):
   `SET p.name = $projectName, p.lastIndexedAt = $runId, p.lastIndexedHead = $headSha`.
   **It is still a `SET`.** `ALL_INDEX_STATEMENTS` (`:377`) already lists it, so the no-deletion sweep
   (`codeIndexCore.test.ts:242`) covers the new text for free — confirm that it does rather than
   assume it.

5. **`memoryService.index` passes the head.** Read it beside the other git calls, **outside the
   session** — the reason is already written at `:939`–`:941` (*"spawning four git processes while
   holding a bolt session would pin a connection open for the duration of the walk"*). `IndexReport`
   (`:284`) gains `headSha: string | null`; the run at `:994` passes `headSha`.
   **⚠ `$headSha` must be present in the parameter map even when null** — an absent parameter is a
   Cypher error, not a null property.

6. **`ensureStartedForLaunch(projectId)` — the container half.** In `memoryService.ts`, beside
   `containerStart` (`:780`), reusing `readContainer` (`:495`) and `options.docker`. It **returns a
   report and never throws**, and it refuses early, in this order:
   1. no row → nothing (`mcpLaunchInput` already guaranteed one; restated so the method is total);
   2. **`row.mode !== 'local-docker'` → nothing, and not one docker call.** This is the
      *"`existing` is never started"* rule, and it is a unit test;
   3. `row.containerName === null` → nothing. A `local-docker` row whose container was removed by hand
      is `readContainer`'s honest-report case, not a thing to recreate at launch;
   4. `docker.available()` false → report it, no start. Docker Desktop being down is an ordinary
      condition on a user's machine (`dockerRefusal`'s posture, `:419`);
   5. `docker.inspect` returns `null` (removed behind Chorus's back) → report it, **do not provision**.
      Provisioning is a click, always;
   6. `isRunning(state)` (`dockerCore.ts:268`) → **return immediately. Zero docker start, zero bolt
      wait.** This is the common case and it must cost nothing;
   7. otherwise `docker.start(name)` — and **⚠ if that call itself fails, report it and return
      immediately, without one bolt probe** (**D173 Q6**, adopted: no poll against a container that
      never started; spec §4.3's `catch` on the start is already exactly this shape) — then, on a
      successful start only, the **launch-budgeted bolt wait**.

7. **The launch-budgeted bolt wait — a DEADLINE, not an attempt count.** See the ⚠ row in *Initial
   Starting Point*: reusing `waitForBolt` (`:478`) would allow ~3.5 minutes. The launch wait computes
   `deadline = Date.now() + LAUNCH_BOLT_BUDGET_MS` **once** and checks it **before every probe and
   before every sleep**, so the total is bounded no matter how long an individual probe takes.
   **`LAUNCH_BOLT_BUDGET_MS = 15_000`, poll `250 ms`** — and the arithmetic is stated in the code:
   15 s of budget, plus at most one in-flight probe of `CONNECT_TIMEOUT_MS` (5 s, `neo4jClient.ts:53`)
   = **20 s worst case, exactly D170's ceiling.** Measured warm on this machine: **4296 ms** (F93).
   **The probe is `driver.probe` — bolt-level, never a TCP connect (F93: TCP accepts at 2 ms while
   bolt answers at 4.3 s, so a socket test declares the graph up ~4 seconds early and hands the agent
   a contract for a server that refuses its first query).**

8. **Wire it into `withMcpEnv`** (`ipc.ts:728`), **after** `mcpLaunchInput` returns non-null and
   **before** 6b-2's MERGE — the MERGE is what a started container exists to let succeed. Log at info
   when Chorus started something and at warn when it could not; **on timeout the launch proceeds
   exactly as 6b-2 already handles an unreachable graph**: MCP wiring written, contract withheld,
   session launched, and the `memory:launch` broadcast carries the outcome to the Memory section's
   *Last launch* line.

9. **The freshness read rides 6b-2's round-trip.** `withSession` (`neo4jClient.ts:148`) runs many
   statements per session, so 6b-2's MERGE gains a tail — `OPTIONAL MATCH (p:Project {id: $projectId})
   RETURN p.lastIndexedHead AS lastIndexedHead, p.lastIndexedAt AS lastIndexedAt` — and **one
   round-trip serves the reachability gate, the attribution node and the freshness read**. This is
   where the contract's `lastIndexedHead` is read: **from the `:Project` node, in the graph, in the
   same session as the MERGE.** There is no SQLite column for it and none is added.
   **⚠ `OPTIONAL MATCH`, not `MATCH`** — a project whose index has never run has no `:Project` node,
   and a plain `MATCH` there would return zero rows and silently take the MERGE's result with it.

10. **Schedule the background index** — in `withMcpEnv`, guarded by *the MERGE succeeded* **and**
    `isIndexStale(lastIndexedHead, headSha)`, using `setImmediate` so it runs **after the launch
    handler has returned its response**. This is verifiable rather than hopeful: everything between
    `await withMcpEnv(...)` and the `…ResponseSchema.parse(...)` at all four call sites (`ipc.ts:1573`,
    `:1626`, `:1656`, `:2817`) is **synchronous**. Guarded by an in-flight `Set<string>` keyed
    `freshnessKey(projectId, headSha)` — **(project, HEAD), never the session and never the project
    alone** (**D173 Q7**, adopted) — so **two panes launched at once index once, and a launch at a
    different HEAD indexes again.** Entry removed in a
    `finally`; **the graph is the memo**, not the Set: a successful run writes `lastIndexedHead = HEAD`,
    so the next launch is not stale. A *failed* run leaves the head stale and the next launch retries —
    **once per launch, which is once per click, which is the rule.** Log the result at **info** with
    counts and the short sha; **never a path** (D33).

11. **The freshness channel** — one channel, one handler, one preload forwarder, one store action, one
    line of UI. It reads `p.lastIndexedHead` / `p.lastIndexedAt` over `withSession` and `headSha(cwd)`
    over git, and returns the pair plus `stale`. **Why a channel and not a piggyback:** the index
    response is session-lifetime (`stores/memory.ts:58`), so a freshness line built from it would be
    blank every time the settings screen is opened without pressing Index — and *"is my graph stale"*
    is precisely the question F90 says nobody could ask. `memoryStatus` cannot carry it: `status()`
    (`memoryService.ts:392`, interface `:210`) is a **pure read that opens no bolt session**, pinned by
    a structural test that constructs the service with a driver which throws if touched
    (`memoryService.test.ts:111`) — adding a graph read there would break the invariant the test
    exists to hold. Called **on mount, and after an index**, never on a timer — the same rule
    `refreshContainer()` (`:323`) already follows.

12. **The UI copy**, in the *Code structure* block (`ProjectSettingsView.vue:1092`), beside
    `indexSummary` (`:1111`):

    > `Indexed at 78c0893 · 4 days ago` — when fresh
    > `Indexed at 78c0893 · 4 days ago · 21 commits behind HEAD (f9a01fe)` — when stale
    > `Never indexed` — when the property is absent

    **⚠ THERE IS NO DATE FORMATTER IN THIS FILE TODAY** (grep for `toLocale`/`Intl`/`Date(` returns
    nothing) and no memory timestamp has ever been rendered. Write the smallest relative formatter
    beside the other string-assembly computeds (`:390`, `:404`, `:459`); do not reach for a library.
    The "N commits behind" half is **optional and only if it is free** — it costs a `rev-list --count
    <head>..HEAD`, and a number Chorus cannot compute must be omitted rather than guessed (D76).

13. **The contract line** — 6b-2's context field is filled: *"the structural index was built at commit
    `78c0893`"*, or *"the structural index has never been built for this project"*. **One line, and it
    counts against 6b-2's ≤ 25 (D147(e)) — check the pinned line-count test still passes.**

14. **Confirm the `withSession` docblock** (`neo4jClient.ts:143`) states the post-6b-2, post-6b-3
    truth. If it still reads *"never a boot hook, a timer, a restore path or a retry"* with no mention
    of a launch, **amend it** — and keep the four refusals, because all four are still refused.

15. **THE ADOPTION DRIVE — §(c), and it is not optional.** See *Verification Commands*.

## Test Expectations

`indexFreshnessCore.test.ts` — **pure, and the branch table is the test**:

- `isIndexStale(null, 'abc…')` → **true** (never indexed);
- `isIndexStale(undefined, 'abc…')` → true; `isIndexStale('', 'abc…')` → true;
- `isIndexStale('abc…', 'abc…')` → **false**;
- `isIndexStale('abc…', 'def…')` → true;
- **`isIndexStale(anything, null)` → false** — with the comment saying why: a project with no HEAD
  would otherwise re-index on every launch forever;
- case sensitivity is asserted, not assumed (`'ABC'` vs `'abc'` → stale), so nobody "fixes" it into a
  fold;
- `shortSha` is 7 chars, `null`-safe, and does not throw on a short input;
- `freshnessKey` is stable and distinguishes two projects at the same HEAD.

`memoryService.test.ts` — `ensureStartedForLaunch`, with the file's existing doubles
(`FORBIDDEN_DOCKER` `:42`, `fakeDocker` `:600`-ish, `stubDriver` `:131`, `fakeStore` `:92`, `row()` `:72`):

- **not configured** → no docker call at all (asserted against `FORBIDDEN_DOCKER`, which throws);
- **⚠ `mode: 'existing'` → NOT ONE DOCKER CALL.** The headline test of this task's non-goals, made with
  the forbidden double so the assertion is structural rather than a `calls` array read;
- `mode: 'local-docker'` with `containerName: null` → no docker call;
- **already running → `start` is never called and no probe is made** (the common case costs nothing);
- **not running → `start` called exactly once, then bolt polled until it answers**, driven with
  `vi.useFakeTimers()` and a probe double that fails N times then succeeds — asserting **the number of
  probes** and **that the reported wait is the fake clock's elapsed time**, not a sleep;
- **timeout path** → after the budget the method reports failure, **`start` was still called exactly
  once** (no retry), and the elapsed time is `≤ LAUNCH_BOLT_BUDGET_MS + CONNECT_TIMEOUT_MS`;
- docker unavailable → reported, no `start`;
- `inspect` returning `null` → reported, **no provision, no run**;
- **⚠ `docker.start` ITSELF FAILS (rejects) → reported, and NOT ONE BOLT PROBE** — **D173 Q6's
  fail-fast**, asserted structurally with a probe double that **throws if it is called at all**, so
  *a failed `docker start` costs no bolt poll*. `waitedMs` is **0**, `started` is **false**, and the
  runtime drive measures the same case end-to-end as **wall time < 2 s**.

`memoryService.test.ts` — the index half:

- **`index` writes `lastIndexedHead`**: a recording `withSession` runner captures the `UPSERT_PROJECT`
  call and the test asserts `params.headSha` is the value `codeIndex.headSha` returned — and that the
  key is **present** when the value is `null`;
- `IndexReport.headSha` reaches the report;
- a project whose `headSha` returns `null` still indexes, and reports `headSha: null`.

The launch path (`ipc.ts`-level, or the extracted helper — prefer extracting so it is testable without
Electron):

- **the once-per-HEAD guard, and its key is the assertion** — `freshnessKey(projectId, headSha)`,
  i.e. **(project, HEAD)**, never the session (**D173 Q7**, adopted): two panes launched
  **concurrently** on the same project at the same HEAD produce **one** `index` call; a launch at a
  *different* HEAD indexes **again**; two different projects at the same HEAD produce two;
- a launch whose MERGE **failed** schedules **no** index;
- a launch whose graph is **fresh** schedules no index;
- the index is **not awaited** — the launch's returned value is produced before the index resolves
  (assert ordering with a deferred promise, not a timeout).

`src/shared/ipc.test.ts`:

- `memoryIndexResponseSchema` accepts `head_sha: null` and a 40-hex string, and **rejects a missing
  `head_sha`** (required-nullable, the house discipline — `z.object` strips unknown keys, so an
  optional field a producer forgets vanishes in silence);
- the freshness response schema round-trips and rejects an unknown key;
- **both `IpcChannel` length assertions move together** (`ipc.test.ts:3510`, `:3897`).

Guard tests that must still pass, re-run and named in the report:

- **`codeIndexCore.test.ts:242`** — no `DELETE`/`DETACH`/`REMOVE` in any statement, **including the
  amended `UPSERT_PROJECT`** (D149(b));
- **`dockerCore.test.ts:129`** — no `--rm`, no `rm -v`, no `volume` in any argv builder (F49/D151);
- **`memoryService.test.ts:146`** — `status` still opens no bolt session.

## Verification Commands

```
npm run typecheck                 # 0, node + web
npx vitest run                    # >= the 6b-2 baseline, plus this task's cases
npm run grep:secrets              # clean, 6 patterns

# D149(b) and F49, as commands
grep -nE "\bDELETE\b|\bDETACH\b|\bREMOVE\b" src/main/services/codeIndexCore.ts        # nothing
grep -nE "volume\s+rm|rm\s+-v|--rm" src/main/services/docker*.ts                      # nothing

# D170's refusals, as commands
grep -rnE "setInterval|setTimeout\(.*index|fs\.watch|chokidar" src/main/services/memoryService.ts src/main/ipc.ts   # only the bounded wait's own sleep
grep -rn "post-commit\|\.git/hooks" src/main                                          # nothing

# MIGRATIONS.length unchanged, AST-parsed rather than grepped
node -e "const ts=require('typescript'),fs=require('fs');const f=ts.createSourceFile('s.ts',fs.readFileSync('src/main/services/storage.ts','utf8'),ts.ScriptTarget.Latest,true);let n=null;f.forEachChild(function w(d){if(ts.isVariableStatement(d))for(const v of d.declarationList.declarations)if(v.name.getText()==='MIGRATIONS'&&v.initializer&&ts.isArrayLiteralExpression(v.initializer))n=v.initializer.elements.length;});console.log('MIGRATIONS.length:',n)"   # 21 (6b-1's v21; this task adds none)

# graph schema unchanged
node -e "const s=require('fs').readFileSync('src/main/services/graphSchemaCore.ts','utf8');console.log('graph migrations:',(s.match(/version: \d+,/g)||[]).length)"   # 2

# counters (record before/after; 6b-1 and 6b-2 move the first)
node -e "const s=require('fs').readFileSync('src/shared/ipc.ts','utf8');console.log('IpcChannel keys:',(s.match(/^\s+[A-Za-z]+: '/gm)||[]).length)"
node -e "console.log('runtime deps:',Object.keys(require('./package.json').dependencies).length)"   # 9
```

### Runtime drive — three parts, and the third is the point of the task

**Docker Desktop must be running.** It was **down** on the morning of 2026-08-19; if it is down, say so
and start it — do not report the step as passed.

**Part 1 — the auto-start, measured (dev app, CDP on 9222).**

1. Provision a **throwaway** project through the Memory section so there is a `mode = 'local-docker'`
   row that is not the dev container. `docker ps` **before** — captured verbatim.
2. Stop it (`memory:container-stop`, through the UI). `docker ps -a` — captured.
3. Launch a claude session in that project **and time it.** Record: `docker ps` after; the measured
   bolt wait from the `[memory]` log line; that the contract arrived (6b-2's evidence); and that the
   launch was **never blocked past the bound**.
4. **The timeout path, driven rather than argued.** Point a `local-docker` row at a port nothing will
   ever answer on (edit `bolt_port` / `bolt_uri` on a throwaway row), launch, and confirm: the wait
   ends inside the budget, the session **still launches**, the contract is **withheld**, and the
   *Last launch* line says the graph did not come up in time.
   **And the fail-fast half (D173 Q6), timed with a stopwatch:** with **Docker Desktop stopped**,
   launch again in that project and confirm the launch returns in **under 2 s**, with the refusal in
   the `[memory]` log and **no bolt-wait line at all** — a failed `docker start` costs no bolt poll.
   Restart Docker Desktop afterwards and say in the report that you did.
5. **The `existing` proof.** With the dev row (`mode = 'existing'`, container `chorus-g2-neo4j`)
   **stopped**, launch a session in the Chorus project and confirm **Chorus did not start it** —
   `docker ps` unchanged, no `[memory]` start line. Then start it by hand and carry on.

**Part 2 — index freshness, measured.**

```
git rev-parse HEAD
# in the graph, before and after:
MATCH (p:Project) RETURN p.id, p.lastIndexedHead, p.lastIndexedAt
```

6. With the graph stale (it is — `lastIndexedAt` 2026-08-15, HEAD 21 commits ahead), launch a session
   and **do not press Index.** Confirm from the `[memory]` log that the background index ran **after**
   the launch returned, and that `p.lastIndexedHead` now equals `git rev-parse HEAD`.
7. Launch again immediately. Confirm **no second index** (the graph is now fresh).
8. Launch **two** panes at once on a stale HEAD and confirm **exactly one** index ran (the in-flight
   guard) — read it off the log, not off the graph.
9. Open the Memory section and capture the freshness line **via CDP DOM read and a screenshot**.
   Confirm it shows the short sha and an age. **CDP is 9222 for the dev app; never drive the installed
   app via CDP unless it was started with the flag.**

**Part 3 — THE ADOPTION DRIVE, on the INSTALLED app (D170(c)).**

> **⚠ THE INSTALLED BUILD MUST CONTAIN THIS PHASE'S CODE.** A drive on the installed 0.7.2 proves
> nothing about 6b-1..3. So **a release build and install is part of this drive**: `npm run dist`, then
> install the produced installer from `release/`. **The version bump itself (0.7.2 → next) is a
> separate, later commit that Matthew authorises** — do not bump `package.json` as part of this task.

10. **Identify the right app and the right DB.** The real instance is `Chorus.exe` on
    `%APPDATA%\chorus-app`; its database is `%APPDATA%\chorus-app\chorus.db` — **not** `%APPDATA%\chorus\chorus.db`
    (the dev one) and not any of the copies. Baseline, re-read before touching anything: the installed
    DB had **0 `project_memory` rows**, **6 projects**, **9 sessions**. **Kill the dev instance by its
    command line (`*9222*`), never by process name** — killing every `electron.exe` takes the installed
    app with it.
11. **Provision, through the UI, on the installed app.** Open the *Chorus* project's settings → Memory →
    **Start a database for me** (`ProjectSettingsView.vue:822`). Capture: the provision report, `docker ps`,
    `docker port <name>` showing **`127.0.0.1:`**, `docker volume ls` showing the volume, and the new
    `project_memory` row (mode **`local-docker`**, container columns non-null). **No volume is ever
    removed, at any point in this drive.**
12. **Seed and index once by hand**, so the graph has a schema and a structural map to be fresh about.
13. **Approve the server, once.** Launch a claude pane; the `chorus-memory` server shows as **"Pending
    approval"** — Chorus never pre-approves (D126 Q6). Approve it, **as the human**, and capture the
    screen. Record it as an act performed, with its timestamp.
14. **Cold launch.** Stop the container. Quit the installed app. Start it. Launch a claude session in
    the Chorus project. Capture: `docker ps` before and after, **the measured wait**, the contract's
    arrival, and — after the session settles — that the background index ran and the Memory section
    shows `lastIndexedHead == git rev-parse HEAD`.
    **⚠ RECORD THE MEASURED WAIT AS A NUMBER**, in the report and under `_verify/6b-3/`. It is the
    input to D173's declined-cancel decision: **a wait above 10 s on the installed app reopens the
    cancel button**, and a wait nobody wrote down cannot be checked against that threshold.
15. **Record the answer to the milestone's precondition list**, item by item: installed build carries
    6b-1..3 (yes/no); memory provisioned on the installed app (yes/no); server approved (yes/no);
    container auto-started at launch (yes/no, **with the measured wait as a number, and whether it
    exceeded 10 s** — D173's revisit threshold for the declined cancel button); contract emitted
    (yes/no).

> **⚠ IF THE BUILD OR THE INSTALL CANNOT BE DONE**, the drive is run on the **dev app with a copied
> user-data-dir**, and the report says **in plain words** that the installed-app half is **outstanding**,
> naming what is untested. It is not reported as passed, and it is not quietly dropped. F90 exists
> because a feature nobody turned on was assumed to be on.

**Failure-honesty clause.** Any command that fails — for any reason, including an environmental one
(Docker Desktop down, an ABI mismatch, a locked DB, a missing CLI, a build that will not produce an
installer) — is reported **with its output**, and the step it belonged to is **not claimed**. A drive
that ran on the dev app says so. A wait that was not measured is not quoted from this document.

Evidence under `_verify/6b-3/`. Leave every container **running** at the end.

## Acceptance Criteria

- [ ] `mode = 'local-docker'` is the **only** value that can cause a docker start, and a
      `mode = 'existing'` row provably causes **not one docker call** (unit test against the throwing
      double, plus the runtime step 5).
- [ ] The launch wait is a **wall-clock deadline** — 15 s budget, ≤ 20 s worst case with one in-flight
      probe — and the measured warm wait is recorded from **this machine, this session**.
- [ ] **A failed `docker start` costs no bolt poll** (**D173 Q6**, adopted). When the daemon is down,
      Docker Desktop is not running, or docker refuses the start, `ensureStartedForLaunch` returns on
      the refusal **before the wait is ever entered** — `waitedMs` **0**, not one probe — and the
      **measured wall time of such a launch is < 2 s**, taken with a stopwatch and recorded.
- [ ] The readiness probe is **`driver.probe` (bolt)**, and no TCP-only socket test exists anywhere in
      the launch path (F93).
- [ ] A launch is **never blocked past the bound**, and a timeout still launches the session, still
      writes the MCP config, and **withholds the contract**, with the *Last launch* line stating why.
- [ ] Nothing runs at boot, on a timer, on a watcher, or from a git hook. Grep is the check and its
      output is in the report.
- [ ] `p.lastIndexedHead` is written by `UPSERT_PROJECT`, and `MATCH (p:Project) RETURN p.lastIndexedHead`
      equals `git rev-parse HEAD` after a launch on a stale graph.
- [ ] The background index runs **after** the launch returned, **once per (project, HEAD)**, and two
      simultaneous launches produce **one** run.
- [ ] **The in-flight guard and the once-per-run memo are keyed by `(project, HEAD)`** —
      `freshnessKey(project.id, head)` (**D173 Q7**, adopted), never by session and never by project
      alone: **two panes launched concurrently on the same project+HEAD index once, and a launch on a
      different HEAD indexes again**. Asserted as unit tests **and** read off the `[memory]` log in
      the drive.
- [ ] The contract's `lastIndexedHead` is read **from the `:Project` node in the same `withSession` as
      6b-2's MERGE** — one round-trip, verified by reading the code, not by a comment.
- [ ] `memoryIndexResponseSchema` carries `head_sha`, validated **in main only**.
- [ ] The Memory section shows the short sha and its age, captured **via CDP DOM + screenshot**.
- [ ] `codeIndexCore.test.ts:242` (no delete) and `dockerCore.test.ts:129` (no volume op) **both still
      pass**, and both are named in the report.
- [ ] `MIGRATIONS.length` **21**, AST-parsed · `LATEST_GRAPH_VERSION` **2** · runtime deps **9** ·
      `IpcChannel` = 6b-2's count **+ 1**, both assertions moved together.
- [ ] typecheck **0** · vitest **≥ the 6b-2 baseline + this task's cases** · `grep:secrets` clean.
- [ ] **The adoption drive is reported as done or not done**, with the installed DB's `project_memory`
      row count before and after, the approval recorded as an act with its timestamp, and **the
      installed-app launch wait recorded as a number** (D173's 10 s revisit threshold for the
      declined cancel button).

## Review Checklist

1. **Find every caller of `docker.start`.** There must be exactly two: the Memory section's Start
   button (through `containerStart`, `memoryService.ts:780`) and `ensureStartedForLaunch`. A third —
   in a boot hook, a restore path, a `setInterval` — is a defect against D170 and D151(c), not a
   nice-to-have.
2. **Read the guard order in `ensureStartedForLaunch` and check the mode test comes before any docker
   call.** The `existing`-mode refusal is worthless if it happens after `docker.available()`.
   **And read the tail of that order: a `docker start` that throws must return on the spot, before
   the wait is entered — D173 Q6's fail-fast.**
3. **The bound is a deadline, not a count.** Re-derive the worst case from the constants in the file:
   budget + one `CONNECT_TIMEOUT_MS`. If the code multiplies attempts by an interval, the bound is
   fiction — that is exactly why `waitForBolt` (`:478`) could not be reused.
4. **`setImmediate`, and what it depends on.** Confirm by reading all four call sites (`ipc.ts:1573`,
   `:1626`, `:1656`, `:2817`) that nothing between `await withMcpEnv(...)` and the response `parse`
   awaits. If a later edit adds an `await` there, "after the launch returned" quietly stops being true.
5. **The in-flight Set is keyed on `(projectId, HEAD)` and cleared in a `finally`.** A key on
   `projectId` alone would skip a legitimate re-index after a commit; a Set never cleared would leak.
6. **Nothing in the new Cypher deletes**, and `UPSERT_PROJECT` is still listed in `ALL_INDEX_STATEMENTS`
   (`codeIndexCore.ts:377`) so the sweep covers it. Read the amended constant, not the test's name.
7. **`$headSha` is in the parameter map even when null.** An absent parameter is a Cypher error at
   runtime that no unit test with a permissive fake runner will catch.
8. **`OPTIONAL MATCH`, not `MATCH`, on the freshness tail.** A never-indexed project has no `:Project`
   node, and a plain `MATCH` would return zero rows and take 6b-2's MERGE result with it — a failure
   that looks exactly like an unreachable graph.
9. **The freshness read is user-initiated.** Its only callers are the settings screen's mount and the
   post-index refresh. Not a timer, not a watch, not a poll.
10. **`status()` still opens no bolt session** (`memoryService.ts:392`; `memoryService.test.ts:111`
    is the enforcement). Freshness lives on its own channel precisely so that stays true.
11. **`withSession`'s docblock (`neo4jClient.ts:143`) states the truth after this task.** A comment
    that says "never a boot hook, a timer, a restore path or a retry" while a launch reaches it is the
    same class of defect D168 amends in the hook listener's header.
12. **The two new sentences on the *Last launch* line are outcomes, not promises**, and neither claims the
    graph is connected. `Connected` is still earned by an observed read (D126); a container that
    started is not a connection.
13. **No number without its denominator** (D55) in any new UI or log line — *"21 commits behind
    `f9a01fe`"*, never *"21 behind"*.
14. **The drive's third part actually happened on the installed app**, or the report says plainly that
    it did not. That sentence is the deliverable, not a caveat.
