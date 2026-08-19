# Implementation Spec 6b-3 — Always on, at launch

_Pairs with [`../Tasks/Task-6b-3.md`](../Tasks/Task-6b-3.md). Authored 2026-08-19 against `a3ba6f9`;
amended 2026-08-19 after CR-6b.0 (D173)._

> **⚠ TWO FACTS IN D170 ARE WRONG AND THE CODE WINS.** (1) The Chorus-provisioned mode literal is
> **`'local-docker'`**, not `'container'` — `memoryConfigCore.ts:39`, `:116`; `shared/ipc.ts:3063`;
> `ProjectSettingsView.vue:450`; `memoryService.test.ts:661`. There is no value `'container'` anywhere
> in this codebase. (2) *"the pane shows 'starting memory graph…'"* is not implementable as written —
> the pane does not exist while the wait is happening, because the wait is inside the `session:launch`
> handler the renderer is blocked on. Task §*Exact Scope* states what replaces it.

---

## §0 — Probe before you build

Nothing below may be quoted from this document into a report. **Re-take every number**, save the raw
output under `_verify/6b-3/`, and if a probe disagrees with a number here, **the probe wins and the
disagreement is written down**.

```powershell
docker --version
docker inspect chorus-g2-neo4j --format '{{.HostConfig.RestartPolicy.Name}} {{json .NetworkSettings.Ports}}'
docker ps -a --format "{{json .}}"
```

Expected from the kickoff, 2026-08-19: restart policy **`no`**, `127.0.0.1:7688 -> 7687/tcp`, two
anonymous volumes. **A restart policy other than `no` changes this task's premise** — a container
docker restarts by itself needs no launch-time start — so read it, do not assume it.

**Re-measure stop → start → bolt, with the kickoff's method.** It is `waitbolt.cjs`: `net.connect` for
the TCP moment, `neo4j.driver(...).verifyConnectivity()` for the bolt moment, polled every **250 ms**,
90 s cap, printing `{tcpReadyMs, boltReadyMs}`.

> **⚠ RUN IT ON A CHORUS-PROVISIONED THROWAWAY CONTAINER.** Stopping `chorus-g2-neo4j` interrupts
> whatever is using the dev graph, including this session's own MCP tools. Use the dev container only
> with Matthew's knowledge, and say so in the report.

Kickoff values to beat or contradict: `docker start` returns in **358 ms**; TCP accepts at **2 ms**;
**bolt answers at 4296 ms** (warm volume, 710 nodes). **F93 is the whole reason the probe is bolt-level.**

**Confirm no graph migration is needed:**

```
node -e "const s=require('fs').readFileSync('src/main/services/graphSchemaCore.ts','utf8');console.log(s.match(/CREATE (CONSTRAINT|INDEX|FULLTEXT INDEX)/g).length,'schema statements;',(s.match(/version: \d+,/g)||[]).length,'migrations')"
```

`GRAPH_MIGRATIONS` (`graphSchemaCore.ts:51`) contains **only** `CREATE CONSTRAINT` and `CREATE INDEX`
statements. `p.lastIndexedHead` is a **property on a node Chorus already MERGEs**; it needs no
constraint (`project_id_unique` is the lookup key, `graphSchemaCore.ts:56`) and no index (nothing
queries by it — it is read by `id`). **`LATEST_GRAPH_VERSION` stays 2** (`:122`).

**Confirm the mode literal, from three places, before writing the guard:**

```
grep -n "MEMORY_MODES" src/main/services/memoryConfigCore.ts        # :39  ['local-docker','existing','aura']
grep -n "isChorusManaged" src/renderer/src/views/ProjectSettingsView.vue   # :450 mode === 'local-docker'
grep -n "store.row?.mode" src/main/services/memoryService.test.ts   # :661 toBe('local-docker')
```

---

## §1 — `src/main/services/indexFreshnessCore.ts` (new, pure)

The decision this task turns on is three lines of logic. It lives in a pure module because **main and
the freshness handler must both use the same one** — two copies of "is this stale" is how a graph gets
re-indexed on every launch, or never.

```ts
/**
 * ⚠ A NULL `headSha` IS **NOT** STALE, AND THIS IS THE BRANCH THAT MATTERS.
 * `git rev-parse HEAD` returns null for a project that is not a repository and
 * for a repository with no commits (`git.ts:472`'s own stated case). Returning
 * `true` there would schedule an index on EVERY launch, forever, for a project
 * `memoryService.index` refuses with "this project is not a git repository"
 * (`memoryService.ts:948`) — a retry loop with no timer in it.
 *
 * ⚠ EXACT STRING COMPARISON, NEVER CASE-FOLDED. git emits lowercase 40-hex and
 * nothing normalises it; folding would hide a genuinely different head.
 */
export function isIndexStale(
  lastIndexedHead: string | null | undefined,
  headSha: string | null
): boolean {
  if (headSha === null) return false
  if (lastIndexedHead === null || lastIndexedHead === undefined || lastIndexedHead === '') return true
  return lastIndexedHead !== headSha
}

/** 7 chars, the git default. Null-safe and short-input-safe: a graph property is
 *  data Chorus did not necessarily write. */
export function shortSha(sha: string | null): string | null

/** The once-per-run key — (project, HEAD), and D173 Q7 adopted exactly this.
 *  ⚠ BOTH HALVES: keyed on the project alone it would skip a legitimate re-index
 *  after a commit; keyed on the head alone two projects at the same head would
 *  block each other. ⚠ AND NEVER THE SESSION: two panes launched concurrently on
 *  the same project at the same HEAD must index ONCE, which a session-keyed guard
 *  cannot do. */
export function freshnessKey(projectId: string, headSha: string): string  // `${projectId}@${headSha}`
```

Plus the authored sentences, exported as constants so the UI, the log and the tests share one wording
(the `dockerCore.ts:307` / `:314` precedent):

- never indexed → `'Never indexed'`
- the launch timed out → `'The memory graph did not answer in time, so this session was not given the memory contract.'`
- Chorus started it → `'Chorus started this project'\''s memory graph.'`

---

## §2 — `src/main/services/git.ts` — one helper

Insert beside the other 6a-2 reads, after `countCommits` (`:519`).

```ts
/**
 * git rev-parse HEAD — the full 40-hex sha the structural index was built at.
 *
 * ⚠ NOT `currentBranch` (`:322`). That is `rev-parse --abbrev-ref HEAD`, a
 * BRANCH NAME — it does not move when you commit, which is exactly the event
 * this value exists to detect.
 *
 * Null is a NORMAL answer, not an error, on the same two cases `rootCommitShas`
 * (`:472`) names: not a repository, or a repository with no commits. The caller
 * treats it as "nothing to compare", never as a fault.
 */
export async function headSha(cwd: string): Promise<string | null> {
  try {
    const out = await runGit(cwd, ['rev-parse', 'HEAD'])
    const sha = out.trim()
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null
  } catch {
    return null
  }
}
```

`runGit` (`:92`) at the default `GIT_TIMEOUT_MS` (`:35`, 15 s) — this is a cheap query, not a checkout.
**The regex is not decoration:** the value becomes a graph property and later an equality test, and a
`rev-parse` that printed a warning line would otherwise be stored as a head.

---

## §3 — `src/main/services/codeIndexCore.ts` — one clause

At `:313`:

```ts
export const UPSERT_PROJECT = `
MERGE (p:Project {id: $projectId})
  SET p.name = $projectName, p.lastIndexedAt = $runId, p.lastIndexedHead = $headSha
`.trim()
```

**That is the entire edit to this file.** It is a `SET`, so the no-deletion sweep
(`codeIndexCore.test.ts:242`–`:253`, walking `ALL_INDEX_STATEMENTS` at `:377`) covers the new text
without being touched. Add one assertion to that suite — `expect(UPSERT_PROJECT).toContain('lastIndexedHead')`
— so a future edit cannot silently drop the clause and leave every graph permanently "never indexed".

> **⚠ THE HEAD IS A PROPERTY, NOT A NEW NODE, NOT A NEW LABEL, AND NOT A MIGRATION.** `:Project` is
> already MERGEd here by id; `project_id_unique` (`graphSchemaCore.ts:56`) already backs the lookup.
> Nothing queries `lastIndexedHead` except a read by project id, so there is no index to add.

---

## §4 — `src/main/services/memoryService.ts`

### 4.1 `CodeIndexSource` gains one method

At `:265`:

```ts
export interface CodeIndexSource {
  rootPathFor(projectId: string): string | null
  lsFiles(cwd: string): Promise<string[]>
  rootCommitShas(cwd: string): Promise<string[]>
  logNameOnly(cwd: string, limit: number): Promise<string>
  countCommits(cwd: string): Promise<number>
  /** Task 6b-3 — the commit the structural index is built at. Null is a normal
   *  answer (`git.ts` headSha). */
  headSha(cwd: string): Promise<string | null>
}
```

Wired in `src/main/index.ts:898` beside the other five. **Both test doubles must gain it**:
`FORBIDDEN_INDEX_SOURCE` (`memoryService.test.ts:21`) with a throwing implementation, matching the
comment already there — *"a stub that quietly returned an empty list would let an accidental call look
like a clean empty repository"*.

### 4.2 `index` passes it

`IndexReport` (`:284`) gains `readonly headSha: string | null`. In `index` (`:929`), read it **outside
the session**, beside `rootCommitShas` (`:956`) / `countCommits` (`:958`) — the reason is already
written at `:939`–`:941`. Then at `:994`:

```ts
await runner.run(UPSERT_PROJECT, { projectId, projectName: projectId, runId, headSha })
```

> **⚠ `headSha` MUST BE IN THE MAP EVEN WHEN NULL.** Neo4j raises `ParameterMissing` for a `$name` with
> no entry; a `null` value sets the property to null, which is what "no head" should mean. A permissive
> fake runner in a unit test will not catch the difference — the runtime drive will.

### 4.3 `ensureStartedForLaunch` — insert beside `containerStart` (`:780`)

```ts
export interface LaunchStartReport {
  /** Did Chorus **successfully** start the container for this launch?
   *  ⚠ FALSE WHEN THE START WAS REFUSED (D173 Q6's fail-fast path). A refused
   *  start is an unreachable-graph outcome, not a "Chorus started the graph"
   *  one, so the *Last launch* line renders §6.2's false/false row — and
   *  `waitedMs` is 0, because no poll happened. */
  readonly started: boolean
  /** Did bolt answer inside the budget? False also when nothing was attempted. */
  readonly ready: boolean
  /** Wall-clock ms spent waiting. 0 when nothing was attempted or it was already up. */
  readonly waitedMs: number
  /** An authored sentence when something notable happened, else null. NEVER
   *  docker's stderr (`dockerRefusal`'s rule, `:419`). */
  readonly reason: string | null
}
```

**⚠ THE NAME IS NOT `ensureReachableForLaunch`, DELIBERATELY.** *Reachable* is D169's word and D169's
MERGE owns it — one round-trip that answers reachability and writes the attribution node, so there is
no second probe to drift from the first. This method's job is narrower: **get the process running**.
Naming it after reachability would invite a future edit to make it the gate, and then two things would
answer "is the graph up".

**Guard order, and every step's reason:**

```ts
async ensureStartedForLaunch(projectId): Promise<LaunchStartReport> {
  const row = store.getProjectMemory(projectId)
  if (!row) return NOTHING                       // 1. no memory row
  // 2. ⚠ THE MODE TEST IS FIRST, BEFORE ANY DOCKER CALL. D170: Chorus does not
  //    own an `existing` container and never starts one. A refusal placed after
  //    `docker.available()` would already have spawned a process for a project
  //    Chorus has no business touching.
  if (row.mode !== 'local-docker') return NOTHING
  // 3. A `local-docker` row whose container was removed by hand. `readContainer`
  //    (:495) already reports this honestly; a launch does not re-provision,
  //    because provisioning is a click (D58) and may pull ~600 MB.
  if (!row.containerName) return NOTHING
  // 4. Docker Desktop down is an ORDINARY condition, not a fault (`dockerRefusal`).
  if (!(await options.docker.available())) return { …, reason: DOCKER_NOT_AVAILABLE }
  let state; try { state = await options.docker.inspect(row.containerName) }
  catch (err) { return { …, reason: dockerRefusal('read the container', err) } }
  if (state === null) return { …, reason: CONTAINER_GONE }        // 5. removed behind our back
  // 6. ⚠ THE COMMON CASE COSTS NOTHING: no start, NO PROBE. A bolt probe here
  //    would add 4–12 ms to every launch of an already-running graph for an
  //    answer D169's MERGE is about to give anyway.
  if (isRunning(state)) return { started: false, ready: true, waitedMs: 0, reason: null }
  // 7. ⚠ FAIL-FAST, AND THE `catch` RETURNS (D173 Q6, CR-6b.0 — adopted, and this
  //    is the shape the council cited rather than a change to it). A start docker
  //    refused — daemon down, Docker Desktop stopped, a refusal of any kind — is
  //    NEVER followed by a bolt poll: a container that never started will never
  //    answer, and polling it would spend the whole 15 s budget proving so.
  //    Measured expectation: such a launch costs < 2 s of wall time, waitedMs 0.
  try { await options.docker.start(row.containerName) }
  catch (err) { return { …, reason: dockerRefusal('start the memory database', err) } }
  const waited = await waitForBoltWithin(row.boltUri, row.databaseName, LAUNCH_BOLT_BUDGET_MS)
  return { started: true, ready: waited.ok, waitedMs: waited.elapsedMs, reason: waited.ok ? null : LAUNCH_BOLT_TIMEOUT }
}
```

**No retry.** A failed start is reported and left alone until the next launch. A retry loop is a timer
with a different name. **And no wait either** — the only path into `waitForBoltWithin` is a `start`
that resolved, which is D173 Q6's fail-fast read straight off the guard order above.

### 4.4 The launch-budgeted wait — a DEADLINE, and this is the invariant

```ts
/**
 * ⚠ WALL-CLOCK BOUNDED, NOT ATTEMPT-BOUNDED — AND `waitForBolt` (:478) CANNOT BE
 * REUSED FOR THIS. That one is 30 × 2 s of SLEEP plus 30 probes; a probe against
 * an open port whose server has not finished booting costs up to
 * CONNECT_TIMEOUT_MS (neo4jClient.ts:53, 5000 ms), so its real worst case is
 * about 3.5 MINUTES. Correct for a Provision click a person is watching;
 * impossible for a launch, which D170 bounds at <= 20 s.
 *
 * THE ARITHMETIC, WRITTEN DOWN BECAUSE A REVIEWER MUST BE ABLE TO RE-DERIVE IT:
 *   budget 15 s + at most ONE in-flight probe of CONNECT_TIMEOUT_MS (5 s) = 20 s,
 *   which is D170's ceiling exactly.
 * Measured warm on this machine 2026-08-19: bolt answered at 4296 ms (F93).
 *
 * ⚠ THE PROBE IS `driver.probe` — BOLT, NEVER TCP. F93: the published port
 * accepts TCP at 2 ms while bolt answers at 4.3 s, so a socket test declares the
 * graph up about four seconds early and hands the agent a contract for a server
 * that refuses its first query.
 */
const LAUNCH_BOLT_BUDGET_MS = 15_000
const LAUNCH_BOLT_POLL_MS = 250

async function waitForBoltWithin(uri, database, budgetMs): Promise<{ok: boolean; elapsedMs: number}> {
  const startedAt = Date.now()
  const deadline = startedAt + budgetMs
  for (;;) {
    if (Date.now() >= deadline) break              // checked BEFORE the probe
    const probe = await driver.probe(uri, database)
    if (probe.ok) return { ok: true, elapsedMs: Date.now() - startedAt }
    if (Date.now() + LAUNCH_BOLT_POLL_MS >= deadline) break   // and BEFORE the sleep
    await delay(LAUNCH_BOLT_POLL_MS)
  }
  return { ok: false, elapsedMs: Date.now() - startedAt }
}
```

`delay` already exists at `:60`. `driver.probe` is `neo4jClient.ts:247`; it disposes the driver on a
failed probe (the comment at `:272`), which is correct here — a pool that could not answer is not worth
keeping warm across a 250 ms poll.

### 4.5 `freshness(projectId)` — the settings screen's read

```ts
export interface FreshnessReport {
  readonly lastIndexedHead: string | null
  readonly lastIndexedAt: string | null
  readonly headSha: string | null
  readonly stale: boolean
}
/** ⚠ USER-INITIATED (D58): its only callers are the settings screen's mount and
 *  the refresh after an index. Never a timer, never a poll. */
freshness(projectId: string): Promise<MemoryResult<FreshnessReport>>
```

One `withSession` running `READ_PROJECT_FRESHNESS` plus one `codeIndex.headSha(cwd)`. `stale` comes
from `isIndexStale` — **the same function the launch path uses**, not a second copy.

```
MATCH (p:Project {id: $projectId})
RETURN p.lastIndexedHead AS lastIndexedHead, p.lastIndexedAt AS lastIndexedAt
```

Zero rows is the never-indexed answer, not an error.

> **⚠ THIS DOES NOT GO ON `memory:status`.** `status()` (`:392`, interface `:210`) is a **pure read
> that opens no bolt session**, and that is pinned structurally: `memoryService.test.ts:146` constructs
> the service with `forbiddenDriver` (`:111`), a driver whose every method throws with the message
> *"memory:status opened a bolt session — D33/D53/D58 forbid it"*. Adding a graph read there breaks the
> invariant the test exists to hold. `memoryStatusSchema` (`shared/ipc.ts:3087`) is `.strict()`, so it
> could not carry the fields anyway.

---

## §5 — `src/main/ipc.ts`

### 5.1 Inside `withMcpEnv` (`:728`)

Order, and each position is load-bearing:

```ts
const input = memory.mcpLaunchInput(project.id)
if (!input) return opts                      // unchanged — the one gate for the whole feature

// 6b-3(a): start the container the user's launch needs, BEFORE the MERGE, because
// the MERGE is the thing a started container exists to let succeed.
const start = await memory.ensureStartedForLaunch(project.id)
if (start.started) {
  logger.info(
    `[memory] started the memory database for '${project.name}' (${project.id}) — ` +
      `bolt ${start.ready ? `answered in ${start.waitedMs} ms` : `did not answer in ${start.waitedMs} ms`}`
  )
} else if (start.reason) {
  logger.warn(`[memory] could not start the memory database for '${project.name}': ${start.reason}`)
}

// 6b-2: THE MERGE — still the gate, still bolt-level, unchanged by this task
// except for the freshness tail it now returns (§5.2).
const reach = await memory.mergeAgentSessionForLaunch(/* 6b-2's shape */)
```

**On `start.ready === false` nothing special happens here.** The MERGE will fail, 6b-2's existing
unreachable path takes over — contract withheld, MCP wiring written, launch proceeds — and the only
6b-3 addition is that 6b-2's *Last launch* line says *the graph did not come up in time* rather than
the generic *unreachable*. **One failure path, not two.**

6b-2's `broadcastMemoryLaunch(project.id, sessionId, agent, registration.ok)` gains the two facts:

```ts
broadcastMemoryLaunch(project.id, sessionId, agent, registration.ok, start.started, start.started ? start.waitedMs : null)
```

### 5.2 The freshness tail on 6b-2's MERGE

`withSession` (`neo4jClient.ts:148`) hands a `BoltRunner` (`:130`) whose `run` returns
`Array<Record<string, unknown>>`, and the callback may run any number of statements. So append the read
**to the same statement**:

```
MERGE (s:AgentSession {id: $sessionId})
  SET s.chorusProjectId = $projectId, s.agent = $agent, s.model = $model,
      s.startedAt = $startedAt, s.writtenVia = 'app'
WITH s
OPTIONAL MATCH (p:Project {id: $projectId})
RETURN p.lastIndexedHead AS lastIndexedHead, p.lastIndexedAt AS lastIndexedAt
```

> **⚠ `OPTIONAL MATCH`, NOT `MATCH`.** A project whose structural index has never run has no `:Project`
> node — the label is created by `UPSERT_PROJECT` and by nothing else. A plain `MATCH` returns zero
> rows, the MERGE's result vanishes with them, and the launch path reads it as *"the graph is
> unreachable"*. That failure is indistinguishable from a stopped container by every symptom the user
> can see, and every project that has never been indexed hits it.

**One round-trip serves three purposes:** the reachability gate (D169(b)), the attribution node
(D169(a)) and the freshness read (D170(b)). That is why the contract's `lastIndexedHead` is read
**from the `:Project` node in the graph** rather than carried in a main-side cache — a cache would be
empty on the first launch after every app start, which is the launch that matters.

### 5.3 Scheduling the background index

```ts
// ⚠ setImmediate, AND WHAT IT DEPENDS ON. Everything between `await withMcpEnv(...)`
// and the `…ResponseSchema.parse(...)` at all four call sites (ipc.ts:1573, :1626,
// :1656, :2817) is SYNCHRONOUS — `sessions.launch`, `linkAttribution`, the storage
// writes, the parse. So a callback queued here runs AFTER the handler has returned
// its response, which is what D170 means by "after the launch returns". If a later
// edit puts an `await` in that stretch, this stops being true silently; the review
// checklist says to re-read it.
if (reach.ok && isIndexStale(reach.lastIndexedHead, head) && head !== null) {
  const key = freshnessKey(project.id, head)
  if (!indexInFlight.has(key)) {
    indexInFlight.add(key)
    setImmediate(() => {
      void memory
        .index(project.id)
        .then((r) => {
          if (!r.ok) return logger.warn(`[memory] background index refused for '${project.name}': ${r.reason}`)
          const v = r.value
          logger.info(
            `[memory] background index for '${project.name}' (${project.id}) at ${shortSha(v.headSha)}: ` +
              `${v.filesSeen} file(s), ${v.directories} folder(s), ${v.commitsLinked} commit(s) linked, ` +
              `${v.commitsSkippedBeyondLimit} beyond the cap, ${v.filesMarkedMissing} marked missing, ${v.elapsedMs} ms`
          )
        })
        .finally(() => indexInFlight.delete(key))
    })
  }
}
```

- **`indexInFlight` is a module-level `Set<string>`** in the same scope as `withMcpEnv`, keyed
  `freshnessKey(projectId, headSha)` — **(project, HEAD), never the session** (D173 Q7, adopted). It
  is the **in-flight** guard: two panes launched at once on the same project+HEAD index once, and a
  launch at a different HEAD indexes again.
- **The graph is the memo, not the Set.** A successful run writes `lastIndexedHead = HEAD`, so the next
  launch reads it back through §5.2 and is not stale. **A failed run leaves the head stale and the
  next launch retries — once per launch, which is once per click, which is the rule.** Say this in the
  code comment; a reader will otherwise assume the Set is meant to be permanent.
- **Counts, never paths** (D33). `filesSeen` and the rest; no `relPath`, no `cwd`, no `boltUri`.
- **⚠ ACCEPTED LIMIT, NAMED RATHER THAN HIDDEN:** if `sessions.launch` throws *after* this is queued,
  the index still runs. That is harmless — the user asked for the launch, the graph answered, and the
  work is identical to the button's — but it is a divergence from *"after a successful launch"* and it
  is written down instead of discovered.

### 5.4 Handlers

`MemoryIndex` (`:4127`) — add `head_sha: r.headSha` to the `parse` and the short sha to the existing
`logger.info`. **Validation in main only**; preload stays a thin forwarder (`preload/index.ts:269`,
whose own comment gives the reason: Zod in preload throws `EvalError` under this app's CSP).

6b-2's `memoryLaunchEventSchema` gains `started` and `waited_ms` (§6.2). **That is an existing event, so
it costs no `IpcChannel` key.**

One new **request** channel beside `MemoryIndex` (`shared/ipc.ts:542`):

```
MemoryFreshness  'memory:freshness'
```

Request `{ project_id: z.uuid() }`; response a union, `ok:true` carrying
`last_indexed_head: z.string().nullable()`, `last_indexed_at: z.string().nullable()`,
`head_sha: z.string().nullable()`, `stale: z.boolean()` — **required-nullable, never optional**
(`z.object` strips unknown keys, so a field a producer forgets vanishes on the wire in silence;
`sessionActivityEventSchema`'s `reason` comment, `shared/ipc.ts:2160`–`:2165`, is the statement of the rule).

`IpcChannel` moves by **+1** from whatever 6b-2 left. **Both assertions move together**
(`src/shared/ipc.test.ts:3510` and `:3897`) — record the before and after numbers.

### 5.5 `memoryIndexResponseSchema` (`shared/ipc.ts:3216`)

```ts
    files_marked_missing: z.number().int().nonnegative(),
    /** 6b-3 / D170: the commit this run indexed at, written to
     *  `:Project.lastIndexedHead`. NULL for a project with no git history —
     *  required-nullable so a producer that forgets it fails the outbound parse
     *  in main, loudly, where it is diagnosable. */
    head_sha: z.string().nullable(),
    elapsed_ms: z.number().int().nonnegative()
```

---

## §6 — The renderer

### 6.1 The launch's own pending state — one line

`LaunchDialog.vue:1151` today is the static literal `Launch` on a button whose only busy affordance is
`:disabled` (`:1148`). With a 15-second worst case in front of it, that reads as a frozen app.

```html
<button … :disabled="…busy…">{{ busy ? 'Launching…' : 'Launch' }}</button>
```

**⚠ NOT `Starting memory graph…`.** The renderer is not told why the launch is slow, and telling it
would need a mid-flight channel this task refuses to add. *"Launching…"* is true of every launch, costs
nothing, and does not claim knowledge the renderer does not have. **This is the whole of the "during"
half of D170's copy, and the task says so plainly rather than pretending the pane can be reached.**

### 6.2 The outcome sentence — on 6b-2's line, not a new one

6b-2 already broadcasts `memory:launch` and renders the Memory section's *Last launch* line
(`ImplementationSpec-6b-2.md` §6/§7; `stores/memory.ts` gains `launchByProject`). **6b-3 adds two
fields to that event and two sentences to that line — no new event channel:**

```ts
export const memoryLaunchEventSchema = z.object({
  project_id: z.uuid(),
  session_id: z.uuid(),
  agent: z.string().max(64),
  reachable: z.boolean(),
  /** 6b-3: did Chorus issue `docker start` for this launch? */
  started: z.boolean(),
  /** 6b-3: wall-clock ms spent waiting for bolt. NULL when nothing was waited for
   *  — required-nullable, never optional (D143(f)). */
  waited_ms: z.number().int().nonnegative().nullable(),
  at: z.string().max(64)
})
```

| `reachable` | `started` | Line |
|---|---|---|
| true | false | `Last launch (10:41): the graph answered — the memory contract was sent to claude.` *(6b-2's, unchanged)* |
| true | true | `Last launch (10:41): Chorus started the graph (4.3s) — the memory contract was sent to claude.` |
| false | true | `Last launch (10:41): the graph did not answer within 15s — contract withheld. The agent launched without it.` |
| false | false | `Last launch (10:41): memory graph unreachable — contract withheld. The agent launched without it.` *(6b-2's, unchanged)* |

**The *started* clause appears only when Chorus actually started something.** A line printed on every
launch is noise inside a day, and noise is how a user learns to stop reading a surface.

> **⚠ AND NOT IN THE PANE. 6b-2 REFUSED THAT, WITH REASONS, AND 6b-3 DOES NOT REOPEN IT.** The only way
> to put a sentence *in* a pane is to write bytes into the PTY stream, which is mirrored and
> **persisted** (`sessionManager.ts:735`–`:751`) — a Chorus sentence would become indistinguishable
> from agent output in a saved transcript, which is *"the worst possible provenance failure in a phase
> about provenance"*. A 20-second wait does not buy that. `attachResponseSchema` (`shared/ipc.ts:907`)
> would be the cheapest way to reopen it and is **deliberately not used**: 6b-2's reason for keeping the
> outcome out of the pane is about the pane, not about the transport.

### 6.3 The freshness line

Store: `MemoryIndexReport` (`stores/memory.ts:95`) gains `headSha`; a `freshnessByProject` record and a
`refreshFreshness(projectId)` action beside `refreshContainer` (`:421`). Called on mount beside
`refreshContainer()` (`ProjectSettingsView.vue:323`) — **guarded by `memoryStatus?.configured` exactly
as that call is** — and again after an index.

Rendered in the *Code structure* block (`:1092`), beside `indexSummary` (`:1111`):

| State | Copy |
|---|---|
| Fresh | `Indexed at 78c0893 · 4 days ago` |
| Stale | `Indexed at 78c0893 · 4 days ago · your code has moved since (now f9a01fe)` |
| Never | `Never indexed — press Index code to build the map` |
| No git | `This project has no git history, so there is nothing to date the index against` |

> **⚠ THERE IS NO DATE FORMATTER IN THIS FILE.** Grep `ProjectSettingsView.vue` for
> `toLocale|Intl|format|Date(` — nothing. No memory timestamp has ever been rendered: `last_seeded_at`
> (`shared/ipc.ts:3099`) and `updated_at` (`:3100`) both reach the store and neither reaches the screen.
> Write the smallest relative-age helper beside the other string-assembly computeds (`:390` `indexSummary`,
> `:404` `indexCaveats`, `:459` `containerStateLine`). **Do not add a dependency.**

**A "N commits behind" number is optional and only if it is free.** It costs a `rev-list --count
<lastIndexedHead>..HEAD`, which fails when the stored head is not an ancestor (a rebase, a force-push).
**A number Chorus cannot compute is omitted, never guessed** (D76) — and per D55 it never appears
without its reference: *"21 commits behind `f9a01fe`"*, never *"21 behind"*.

---

## §7 — `neo4jClient.ts:143` — the docblock that must stop being wrong

```
⚠ USER-INITIATED CALLERS ONLY (D58). This is a bigger door than `probe`, so
the rule is restated where the door is: `memory:seed` and `memory:validate`
are clicks. Nothing here may be reached from a boot hook, a timer, a restore
path or a retry.
```

After 6b-2 and 6b-3, a **launch** reaches `withSession` — twice (the MERGE, and the background index).
6b-2 widens the sentence; **6b-3 confirms it states the truth afterwards**, and the four refusals stay:
no boot hook, no timer, no restore path, no retry. The wording to land on is *"a click, or the launch a
click asked for"*. **A comment that outlives its code is exactly the defect D168 amends in the hook
listener's header** — and this one guards the app's only unattended-connection rule.

---

## §8 — Verification

### Build

```
npm run typecheck        # 0, node + web
npx vitest run           # >= the 6b-2 baseline + this task's cases
npm run grep:secrets     # clean, 6 patterns
```

### Structural

```
# D149(b) — the indexer still deletes nothing
grep -nE "\bDELETE\b|\bDETACH\b|\bREMOVE\b" src/main/services/codeIndexCore.ts     # nothing

# F49/D151 — no volume operation entered anywhere
grep -nE "volume\s+rm|rm\s+-v|--rm|volume" src/main/services/docker*.ts            # only volumeNameFor / -v <name>:/data

# D170's refusals
grep -rn "setInterval" src/main/services/memoryService.ts src/main/ipc.ts          # nothing
grep -rn "fs.watch\|chokidar\|post-commit\|\.git/hooks" src/main                   # nothing
grep -rn "net.connect\|createConnection" src/main/services/memoryService.ts        # nothing — the probe is bolt (F93)

# exactly two callers of the docker start path
grep -rn "containerStart\|ensureStartedForLaunch\|docker.start" src/main --include=*.ts | grep -v test

# migrations unchanged
node -e "const ts=require('typescript'),fs=require('fs');const f=ts.createSourceFile('s.ts',fs.readFileSync('src/main/services/storage.ts','utf8'),ts.ScriptTarget.Latest,true);let n=null;f.forEachChild(d=>{if(ts.isVariableStatement(d))for(const v of d.declarationList.declarations)if(v.name.getText()==='MIGRATIONS'&&v.initializer&&ts.isArrayLiteralExpression(v.initializer))n=v.initializer.elements.length});console.log('MIGRATIONS.length:',n)"   # 21
node -e "const s=require('fs').readFileSync('src/main/services/graphSchemaCore.ts','utf8');console.log('graph migrations:',(s.match(/version: \d+,/g)||[]).length)"   # 2
node -e "console.log('runtime deps:',Object.keys(require('./package.json').dependencies).length)"   # 9
```

### Runtime

Full script in [`../Tasks/Task-6b-3.md`](../Tasks/Task-6b-3.md) *Verification Commands* — three parts:
the auto-start measured on the dev app (CDP **9222**), index freshness, and **the adoption drive on the
installed app**. Evidence under `_verify/6b-3/`. Exact outputs required, verbatim:

```powershell
docker ps                                      # before and after each launch
git rev-parse HEAD
# in the graph, before and after:
#   MATCH (p:Project) RETURN p.id, p.lastIndexedHead, p.lastIndexedAt
docker port <container>                        # 127.0.0.1: — the 6a-4 binding, re-proven on the new one
docker volume ls                               # the volume exists, before AND after. Nothing removes it.
```

Plus: the measured bolt wait (from the `[memory]` log line **and** from a re-run of the `waitbolt`
method), and the Memory section's freshness line captured as **both** a CDP DOM read and a screenshot.

**⚠ AND THE INSTALLED APP'S WAIT IS RECORDED AS A NUMBER** (D173). Matthew declined the council's
cancel button for the launch wait on 2026-08-19 because the wait is bounded at 20 s and measured
4.3 s warm — **revisitable if the installed-app drive ever measures a wait above 10 s**. That
threshold is only checkable if the drive writes the number down, so Part 3's cold launch records it.
The **fail-fast** case is timed too (D173 Q6): with Docker Desktop stopped, a launch must return in
**under 2 s** with no bolt-wait line in the log at all.

**Operational notes that will otherwise cost an hour each:**

- **Docker Desktop must be running** — it was down on the morning of 2026-08-19.
- **The installed app is `Chorus.exe` on `%APPDATA%\chorus-app`**, and its DB is
  `%APPDATA%\chorus-app\chorus.db`. Several `chorus.db` files exist on this machine; check which one
  is growing before reading one. Baseline: **0 `project_memory` rows, 6 projects, 9 sessions.**
- **Kill the dev instance by its command line (`*9222*`), never by process name** — a blanket
  `electron.exe` kill takes the installed app down with it.
- **Never drive the installed app via CDP** unless it was started with the remote-debugging flag. The
  installed-app steps are done by hand, with screenshots.
- **The installed build must contain 6b-1..3**: `npm run dist`, install from `release/`. **The version
  bump (0.7.2 → next) is a separate, later commit Matthew authorises** — not part of this task.
- **If the build or install cannot be done**, run the drive on the dev app with a copied
  user-data-dir and **say in plain words that the installed-app half is outstanding**, naming what is
  untested.

**Failure-honesty clause.** A command that fails for any reason, including an environmental one, is
reported **with its output** and its step is **not claimed**.

### The invariant a reviewer should test hardest

**Three, and they are the whole task:**

1. **The launch is never blocked past the bound.** Not "usually returns in 4 seconds" — *bounded*.
   Re-derive it from the constants in the file: `LAUNCH_BOLT_BUDGET_MS` + one `CONNECT_TIMEOUT_MS`
   (`neo4jClient.ts:53`). **If the bound is expressed as attempts × interval, it is fiction** — that is
   precisely why `waitForBolt` (`memoryService.ts:478`) could not be reused, and why a reviewer who
   sees a `for (let i = 0; i < N; i++)` in the launch path should stop and read `CONNECT_TIMEOUT_MS`.
   Drive it: point a `local-docker` row at a dead port and **time the launch with a stopwatch**.
   **And drive the other end of it (D173 Q6): with Docker Desktop stopped, the same launch must
   return in under 2 s** — a `docker start` that was refused is never followed by a poll, so the
   budget is not spent proving that a container which never started will not answer.
2. **Nothing runs unless a launch happened.** Grep every caller of `docker.start`, `withSession`,
   `probe` and `index`. Each must trace to a click: a button in the Memory section, or `withMcpEnv`.
   **A `setInterval`, an `app.whenReady` hook, a restore-path call or a retry loop is a defect against
   D170, D149(c) and D151(c), not a nice-to-have.** Then prove the negative half at runtime: with a
   `mode = 'existing'` container **stopped**, launch a session and confirm `docker ps` is unchanged.
3. **The indexer never deletes.** `UPSERT_PROJECT` gained a `SET` clause; confirm the amended constant
   is still in `ALL_INDEX_STATEMENTS` (`codeIndexCore.ts:377`) and that `codeIndexCore.test.ts:242`
   sweeps it. Then the 6a-2 round trip, driven: hand-create a `:Memory` with `SUPPORTED_BY` to an
   indexed `:File`, note `memory:validate`'s ratio, let the **background** index run twice via two
   launches, and confirm the ratio is **byte-for-byte unchanged**. A trust ratio that falls because a
   refresh ran is a corruption wearing a measurement's clothes — and this task is the first thing that
   makes the indexer run without anybody pressing a button.

### What a reviewer should distrust

- **A green test suite says nothing about the bound.** Every unit test uses a fake clock; only a
  stopwatch against a dead port proves the launch is not hostage to a probe timeout.
- **"It only indexed once" may mean it never ran.** Read the `[memory]` log line and the graph's
  `lastIndexedHead`, not the absence of a second line.
- **A helpful future edit turns the timeout into a retry.** That is the change that converts this task
  from launch-time into a timer, and it will look like robustness in review.
- **"Adoption done" without the installed DB's row count before and after.** F90 exists because a
  feature nobody had turned on was assumed to be on.
