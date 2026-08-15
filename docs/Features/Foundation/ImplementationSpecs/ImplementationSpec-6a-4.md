# Implementation Spec 6a-4 — The Provisioner

_Pairs with [`../Tasks/Task-6a-4.md`](../Tasks/Task-6a-4.md). Authored 2026-08-14 against `47f633c`._

> **⚠ THE DROPPABLE TASK.** If the phase runs long this is what gets cut (D91), and nothing else in
> Phase 6a weakens. Do not start it before 6a-1 … 6a-3 are landed and driven.

---

## §0 — D4 the installed docker before writing argv

**`docker` is 29.7.2 on this machine, a whole major above the 28.0.4 the Phase 6 investigation
recorded.** Quote nothing from that document. Run each of these and save the output under
`_verify/6a-4/`:

```powershell
docker --version
docker ps -a --filter "name=^chorus-probe$" --format "{{json .}}"     # and read a real line back
docker run -d --name chorus-probe -p 127.0.0.1:7699:7687 -e NEO4J_AUTH=none -v chorus-probe-data:/data neo4j:5-community
docker port chorus-probe
docker stop chorus-probe ; docker start chorus-probe ; docker rm -f chorus-probe
docker volume ls --filter "name=chorus-probe-data" --format "{{json .}}"
```

**⚠ The last line is the one to look at hardest: after `docker rm`, the volume is still listed.**
That is the property D151 and F49 depend on, and it should be observed rather than believed.

---

## §1 — The binding, which is the security content of this task

Every Phase 6 drive used `-p 7688:7687`. **That binds `0.0.0.0`** — an auth-disabled Neo4j published
to the whole local network. It was a by-hand probe on a dev box and it was fine; **it is not fine for
something Chorus starts on a user's machine.**

```
-p 127.0.0.1:<port>:7687
```

**This is a literal in a tested constant.** D93's whole no-credential argument is *"local Docker runs
`NEO4J_AUTH=none` on `127.0.0.1`, so no secret exists"* — the loopback half of that sentence has been
the operator's habit until now and becomes the app's code here. A test asserts the token contains
`127.0.0.1:`, because a regression in it is invisible in every functional check: the database works
perfectly either way.

**The HTTP port (7474) is not published at all.** `http_port` stays NULL. A second published port is
a second exposure for a browser UI nothing in Chorus uses, and the copy says the Neo4j browser is not
exposed rather than leaving the user to find a dead link.

---

## §2 — `src/main/services/dockerCore.ts` (new, pure)

### Naming

```ts
/** ⚠ PURE AND STABLE: the same project must always resolve to the same names, or
 *  a second provision creates a second container beside the first. The id
 *  suffix is what keeps two projects called "api" apart; the sanitised name is
 *  what makes `docker ps` readable to a human. D92 fixes the `chorus-` prefix
 *  (the plan's `agentdesk-neo4j-<slug>` is stale). */
export function containerNameFor(projectId: string, projectName: string): string
export function volumeNameFor(containerName: string): string   // `${containerName}-data`
```

Sanitisation: lower-case, non-`[a-z0-9]` runs to `-`, trimmed, truncated, then
`-${projectId.replace(/-/g,'').slice(0,8)}`. Docker requires
`[a-zA-Z0-9][a-zA-Z0-9_.-]*`, so a name starting with a digit or empty after sanitising falls back to
`chorus-<id8>`. **Test the empty, unicode-only, leading-digit and duplicate-name cases**; a user's
project name is arbitrary text.

### argv builders

```ts
export function runArgs(o: { containerName: string; volumeName: string; boltPort: number; image: string }): readonly string[]
export function psArgs(containerName: string): readonly string[]
export function startArgs(containerName: string): readonly string[]
export function stopArgs(containerName: string): readonly string[]
export function removeArgs(containerName: string): readonly string[]
```

`runArgs` produces, exactly:

```
run -d --name <container> -p 127.0.0.1:<port>:7687 -e NEO4J_AUTH=none -v <volume>:/data <image>
```

**⚠ NO `--rm`. NO `-v` ON `remove`. NO `volume rm` BUILDER AT ALL.** The absence is the feature:
**F49 gates durability on an export/restore path that does not exist**, so there must be no code path
in Chorus that can destroy a graph. A test greps the exported builders for `--rm`, `rm -v` and
`volume` + `rm`, and the review checklist repeats it, because this is the kind of thing that gets
added later by someone being helpful.

`IMAGE = 'neo4j:5-community'` — the tag Phase 6 measured (resolving to Kernel **5.26.29**, **no
APOC**, idle ~496 MiB). The tag floats within 5.x; the provision report records the version the
database actually answers with, read over bolt after it comes up, so the number in the UI is
observed rather than assumed.

### Parsing

```ts
export interface ContainerState {
  readonly id: string
  readonly name: string
  /** docker's own `State` string — 'running' | 'exited' | 'created' | … */
  readonly state: string
  readonly status: string
  readonly ports: string
}
/** ⚠ EMPTY OUTPUT IS "NO SUCH CONTAINER", NOT AN ERROR. `docker ps -a --filter`
 *  exits 0 with no lines when nothing matches, and treating that as a failure
 *  would make the ordinary unprovisioned case look broken. */
export function parsePsJsonLines(out: string): readonly ContainerState[]
```

Written against the **captured** `{{json .}}` output from §0, not against the field names in docker's
documentation.

### Refusals

Authored sentences, exported as constants so the UI and the tests share one wording:

- docker not installed — names docker and says the memory feature still works against a database the
  user starts themselves (which is true, and is what Phase 6 shipped);
- the container name is already taken by something Chorus did not create;
- no free port in the probed range;
- **the typed-confirmation mismatch on remove.**

**No refusal quotes docker's raw stderr wholesale** — the same rule
`mergeMcpConfig` follows for a file it cannot parse (`mcpConfigCore.ts:229`): a message can contain
anything, including a path or an environment value.

---

## §3 — `src/main/services/docker.ts` (new)

**A copy of `git.ts`'s shape, deliberately.** One private `promisify(execFile)` runner; **never a
shell**; arguments always an array; **two timeout constants**:

```ts
/** ps / port / inspect: docker's own latency, nothing that scales. */
const DOCKER_QUERY_TIMEOUT_MS = 15_000
/** `run` may PULL ~1 GB on first use. The git.ts precedent (`GIT_CHECKOUT_TIMEOUT_MS`)
 *  is explicit that sharing the query budget kills long operations mid-flight and
 *  reports the kill as `code=null` with no stated cause. */
const DOCKER_RUN_TIMEOUT_MS = 15 * 60_000
```

A project name reaching a shell would be a command-injection site; `execFile` with an array is what
makes that structurally impossible, and it is why this is a CLI adapter rather than a `child_process`
call at the call site.

### Port allocation

```ts
/** Probe upward from 7688 for a port that will actually bind on loopback. A
 *  port held by another Chorus project's container fails the bind and is
 *  skipped, so no registry of allocations is needed — the OS is the registry. */
export async function findFreeBoltPort(from = 7688, tries = 40): Promise<number | null>
```

Bind with `net.createServer().listen({ host: '127.0.0.1', port })` and close. **Bind to the same host
the container will publish on** — a port free on `0.0.0.0` and taken on `127.0.0.1` is exactly the
mismatch this would otherwise hit.

---

## §4 — `memoryService` additions

```ts
  provision(projectId: string): Promise<MemoryResult<ProvisionReport>>
  containerStatus(projectId: string): Promise<MemoryResult<ContainerStatusView>>
  containerStart(projectId: string): Promise<MemoryResult<ContainerStatusView>>
  containerStop(projectId: string): Promise<MemoryResult<ContainerStatusView>>
  /** ⚠ REMOVES THE CONTAINER. NEVER THE VOLUME. */
  containerRemove(projectId: string, typedName: string): Promise<MemoryResult<{ removed: boolean }>>
```

**`provision` order, and why each step is where it is:**

1. refuse if `docker` is absent (`probeCli('docker')`, `cliDetect.ts:91` — already in
   `DETECTED_TOOLS`, so no new detection is written);
2. compute names; if a container with that name already exists, **adopt it** rather than failing —
   the second provision of the same project is the ordinary case after a machine restart;
3. allocate a port; refuse with a sentence if none is free;
4. `docker run`;
5. **wait for readiness with the existing `driver.probe`**, polling with a bounded number of attempts
   — *"`Connected` is earned by an observed read"* (D126) applies here too, and a fixed `sleep` would
   be a guess that fails on a cold pull and wastes time on a warm one;
6. `configure({ mode: 'local-docker', authMode: 'none', boltUri: 'bolt://127.0.0.1:<port>', databaseName: 'neo4j' })`
   — reusing the existing method so URI normalisation, the userinfo refusal and the driver dispose
   all happen exactly once, in the place that already owns them;
7. persist `container_id`, `container_name`, `volume_name`, `bolt_port` on the row.

`memoryConfigCore.supportedMode` admits `'local-docker'` — **one line, in one place**. The UI reads
`row.mode`, never `container_id !== null`, so there is one answer to "is this a Chorus-managed
database".

**`disable` is untouched.** Its docblock — *"DELETES THE CONFIG. IT DOES NOT DESTROY GRAPH DATA"* —
must stay true, and after this task it must also not stop the container. Three different destructions
now exist and the copy names all three (§6).

---

## §5 — The wire

Five channels, after `MemoryIndex`:

```
MemoryProvision        'memory:provision'
MemoryContainerStatus  'memory:container-status'
MemoryContainerStart   'memory:container-start'
MemoryContainerStop    'memory:container-stop'
MemoryContainerRemove  'memory:container-remove'
```

`IpcChannel` goes **87 → 92**. Validation in main only; preload invokes and nothing else.

**The remove handler carries the typed-confirmation gate, in main:**

```ts
// ⚠ ENFORCED HERE, NOT BY A DISABLED BUTTON. The project:delete precedent
// (D123) and the worktree:remove one (D26 clause 7): a renderer-only guard is
// walked past by the command palette, by a second window, and by any future
// caller. THROWS on mismatch, matching project:delete's shape.
if (payload.typed_name !== row.containerName) throw new Error(CONTAINER_NAME_MISMATCH)
```

---

## §6 — The UI, and the three destructions

In the Memory section, inside `v-if="memoryStatus?.configured"` — plus one **Provision** button that
appears for an *unconfigured* project **only when docker is detected**.

State line, from `containerStatus`, refreshed **when the screen opens and after each action** — never
on a timer (D58's rule, applied to a second kind of connection):

> `chorus-chorus-3f2a9c11` · running · published on 127.0.0.1:7688

**⚠ AND IT DOES NOT COLOUR THE CHIP.** A running container is not a connection. `Connected` is still
earned by the Test button's observed read (D126), and a dot that goes green because a process exists
is exactly the dishonest signal CR-6.0 was convened to prevent.

The copy must separate three things a user will otherwise conflate — **stated at the controls, not in
a tooltip**:

| Action | What it destroys |
|---|---|
| **Turn memory off** | Chorus's record of *where* the database is. Nothing inside Neo4j. |
| **Remove container** | The container process. **The data volume is kept**, and re-provisioning re-attaches it. |
| **Delete the data** | **Chorus cannot.** Until Chorus can export and restore a graph, it will not offer to destroy one (F49). Remove the volume yourself with `docker volume rm <name>` if you mean it. |

That third row is not a limitation to be apologised for; it is the only honest position while no
backup path exists.

---

## §7 — Verification

```
npm run typecheck
npx vitest run
npm run grep:secrets
grep -nE "volume\s+rm|rm\s+-v|--rm" src/main/services/docker*.ts    # must print nothing
node -e "console.log('runtime deps:',Object.keys(require('./package.json').dependencies).length)"   # 8
```

### Runtime — in this order

1. **Provision** a throwaway project. Record the report; confirm the row carries `container_id`,
   `container_name`, `volume_name`, `bolt_port`.
2. **Prove the binding — the single most important check in this task:**

```powershell
docker port <container>                                   # expect 7687/tcp -> 127.0.0.1:<port>
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' })[0].IPAddress
Test-NetConnection -ComputerName $ip -Port <port>          # MUST FAIL
```

3. Seed and index against it (6a-2's path). A Chorus-started database must be indistinguishable from
   a hand-started one.
4. **Stop** → status reads `exited`, the chip does **not** claim `Connected`, a query fails with the
   authored refusal rather than a driver stack trace. **Start** → status reads `running`.
5. **Remove** with the typed name. Confirm: container gone, **`docker volume ls` still lists the
   volume**. **Re-provision, then re-run a query for a node the index wrote** — the data must still
   be there. That round trip is F49's promise, driven rather than asserted.
6. Attempt removal with a wrong typed name → refusal, container untouched.
7. `docker rm` the container **behind Chorus's back**, re-open the screen → the status read reports
   honestly (no container) instead of echoing a stale row.
8. Rename or stop the docker daemon and open the screen → the authored "docker is not available"
   sentence, and **the rest of the memory UI still works** against a manually started database.

Evidence under `_verify/6a-4/`.

### What a reviewer should distrust

- **A passing test suite says nothing about the port binding** — only `docker port` and a failed
  remote connection do.
- **"It worked on the second provision"** may mean a second container was created beside the first.
  Check `docker ps -a` for duplicates after two provisions.
- **A helpful future edit adds `-v` to `rm`.** That is the one change in this task that destroys user
  data silently, and the grep is cheap.
