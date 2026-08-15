# Task 6a-4 — The Provisioner

_Phase 6a, task 4 of 4. Authored 2026-08-14 against `47f633c`._

> **⚠ THIS IS THE TAIL, AND IT IS ALLOWED TO BE CUT.** D91's ruling — *"if the phase runs long that is
> where it gets cut"* — applied to Stage 5 as a whole and survives inside it. The complete memory path
> already works against a container started by hand with one `docker run`. **If this task is dropped,
> nothing else in Phase 6a is weakened.**

## Source Of Truth

| Document | Owns |
|---|---|
| [`../Phase-6a-Proposal.md`](../Phase-6a-Proposal.md) §3 (6a-4) | Why this is last, and why it is a CLI adapter |
| `roadmap.md` §6 — **D151**, D147(d), D92, D93, D123, D58, D76, **F49** | No `dockerode`; no volume deletion; typed confirmation; user-initiated only |
| [`Phase-6a-Overview.md`](Phase-6a-Overview.md) | Verified ground facts |
| `src/main/services/git.ts` | **The pattern this task copies** — a controlled process adapter, not a library |
| [`../ImplementationSpecs/ImplementationSpec-6a-4.md`](../ImplementationSpecs/ImplementationSpec-6a-4.md) | Exact argv, parsing, refusals, runtime checks |

## Initial Starting Point — verified 2026-08-14 at `47f633c`

| Fact | Where | Value |
|---|---|---|
| **`project_memory`'s container columns already exist and are NULL** | `schema.ts:686`–`:695` | `container_id`, `container_name`, `volume_name`, `bolt_port`, `http_port` — created by v16 *"because `MIGRATIONS.length` moves EXACTLY ONCE in this phase"* |
| **So this task needs NO migration** | — | `MIGRATIONS.length` stays **19** |
| `git.ts`'s runner | `git.ts:31`–`:47` | `promisify(execFile)`, **never a shell**, args always an array, cwd explicit, two named timeouts |
| `docker` detection | `cliDetect.ts:78` | already in `DETECTED_TOOLS`; `probeCli` at `:91` |
| `docker` version | probed 2026-08-14 | **29.7.2** — ⚠ **a whole major above the Phase 6 D4 pass's 28.0.4** |
| `memoryService.configure` | `memoryService.ts:279` | writes the row, **normalises the URI**, and disposes the driver on change |
| `memoryService.disable` | `memoryService.ts:334` | *"DELETES THE CONFIG. IT DOES NOT DESTROY GRAPH DATA"* — the sentence this task must keep true |
| `validateBoltUri` | `memoryConfigCore.ts` | refuses userinfo (D93); `mode` vocabulary is `local-docker \| existing \| aura` and **only `existing` is admitted today** |
| The typed-confirmation precedent | `project:delete` (D123), `worktree:remove` (D26 clause 7) | main-side gate, never a renderer-only guard |
| Memory UI | `views/ProjectSettingsView.vue:655` onward | the section the lifecycle controls join |
| The chip | `StatusBar.vue` / `memory.ts` store | `Connected` is earned by an **observed read** (D126) |
| `IpcChannel` keys | `shared/ipc.ts:14` | **87** after 6a-2 — this task makes it **92** |
| Image measured in Phase 6 | roadmap Phase 6 note | `neo4j:5-community` resolving to **Kernel 5.26.29**, **no APOC**, idle ~496 MiB |

## Goal

Let a user give a project a working memory database by pressing one button, and see and control that
container's life from the same place they configured it — without Chorus ever being able to destroy
the data inside it.

## ⚠ The security fact that changes the `docker run` line

The Phase 6 drives used `docker run -d --name … -p 7688:7687 -e NEO4J_AUTH=none neo4j:5-community`.
**`-p 7688:7687` binds `0.0.0.0`** — every interface on the machine. Combined with `NEO4J_AUTH=none`,
that publishes an unauthenticated graph database to the local network. It was acceptable for a
by-hand probe on a dev box; **it is not acceptable for something Chorus starts on a user's machine.**

**The provisioner publishes to loopback explicitly: `-p 127.0.0.1:<port>:7687`.** The whole
no-credential design (D93: local Docker runs `NEO4J_AUTH=none` **on `127.0.0.1`**, so no secret
exists) rests on that binding, and until now the binding was the operator's habit rather than the
app's code.

## Exact Scope

**Create**

- `src/main/services/dockerCore.ts` — **pure**: container and volume naming, the `run`/`ps`/`start`/
  `stop`/`rm` argv builders, the `--format '{{json .}}'` line parser, the refusal sentences. No
  `child_process`, no `electron`.
- `src/main/services/dockerCore.test.ts`
- `src/main/services/docker.ts` — the controlled process adapter, modelled on `git.ts`: one private
  `execFile` runner, never a shell, one timeout constant per class of command, thin typed wrappers.
- `src/main/services/docker.test.ts` (parser/wrapper level — no container is started in CI)

**Edit**

- `src/main/services/memoryService.ts` — `provision`, `containerStatus`, `containerStart`,
  `containerStop`, `containerRemove`; the `local-docker` mode becomes reachable.
- `src/main/services/memoryConfigCore.ts` — admit `local-docker` to `supportedMode`.
- `src/shared/ipc.ts` — five channels + schemas.
- `src/preload/index.ts` + `index.d.ts`, `src/main/ipc.ts` — the five handlers, including the typed
  confirmation on remove.
- `src/renderer/src/stores/memory.ts`, `src/renderer/src/views/ProjectSettingsView.vue` — the
  lifecycle controls and their honest copy.

**Nothing else.**

## Non-Goals

- **⚠ NO `docker volume rm`, NO `docker rm -v`, NO `--rm`, ANYWHERE.** **F49 gates durability on an
  export/restore path that does not exist**, so no code path in Chorus may destroy a graph. The
  volume outlives the container and a re-provision re-attaches it. Grep is the check.
- **No `dockerode` and no new dependency of any kind** (D147(d)). Runtime deps stay at **8**.
- **No auto-start, no boot reconciliation, no timer, no retry.** Every docker call is user-initiated
  (D58's rule, applied to a second kind of connection). A stored `container_id` may be stale; the
  status read is what heals it, when a person opens the screen.
- **No image pull progress UI, no log streaming, no `docker exec`, no shell.**
- **No second published port.** Bolt only, on loopback. The Neo4j browser's HTTP port is **not**
  published; `http_port` stays NULL and the copy says the browser is not exposed.
- **No change to what the status chip may claim.** A running container is **not** a connection —
  `Connected` is still earned by an observed read (D126). A dot that goes green because a process
  exists is the dishonesty CR-6.0 was convened to prevent.
- **No credentialed mode.** `NEO4J_AUTH=none` on loopback, `auth_mode` stays `'none'` (D128(a)).
- **No migration.** `MIGRATIONS.length` stays **19**.
- **Do not revert, stage, commit or delete unrelated working-tree changes.**

## Dependencies

**Task 6a-3 must have landed** — shared `src/main/ipc.ts` and `src/shared/ipc.ts`.

## Step-by-step Work

1. **D4 the installed docker, 29.7.2, before writing argv.** Verify by running them:
   `docker ps -a --filter name=… --format '{{json .}}'` (and read a real line back),
   `docker run -d --name … -p 127.0.0.1:<p>:7687 -e NEO4J_AUTH=none -v <vol>:/data neo4j:5-community`,
   `docker start/stop/rm`, `docker volume ls`. **A major version moved since the last pass; quote
   nothing from Phase 6's investigation.**
2. **Write `dockerCore.ts`** — naming, argv, parsing, refusals. Container name is
   `chorus-<sanitised project name>-<8 hex of project id>` (D92's `chorus-` prefix; the id suffix is
   what makes it unique when two projects share a name), volume `<container>-data`, both **pure
   functions of the project row** so the same project always resolves to the same names.
3. **Port allocation**: probe upward from a base until a loopback bind succeeds, and **record the
   chosen port in `project_memory.bolt_port`**. A port already used by another Chorus project's
   container is skipped by the same probe.
4. **Write `docker.ts`** — the runner, with a **short timeout for queries** (`ps`, `inspect`) and a
   **long one for `run`**, because the first `run` may pull ~1 GB. `git.ts`'s own two-budget comment
   is the precedent and the reason.
5. **`memoryService.provision(projectId)`**: refuse if docker is absent (authored sentence naming
   docker), create the volume implicitly via `run`, wait for bolt to answer using **the existing
   `probe`** rather than a sleep, then `configure` the row to `bolt://127.0.0.1:<port>` in
   `local-docker` mode, then report. **The readiness check is an observed read** — the same standard
   the rest of the feature is held to.
6. **`containerRemove`** goes behind main's typed-confirmation gate: the caller must send the exact
   container name. **The refusal throws** (matching `project:delete`'s shape), and the copy states —
   at the control, not in a tooltip — that the data volume is kept and how to remove it by hand if
   the user really wants to.
7. **UI**: state, four buttons, and the copy. Nothing renders for a project with no memory (D76).

## Test Expectations

`dockerCore.test.ts`:

- naming is pure and stable: same project → same container and volume names; two projects with the
  same display name → **different** names; a name with spaces, unicode or a leading digit is
  sanitised to something docker accepts;
- **the `run` argv contains `127.0.0.1:` in its `-p` token** — asserted as a literal, because this is
  the security property and a regression here is invisible;
- the `run` argv contains `NEO4J_AUTH=none`, a named volume, and **no `--rm`**;
- **a grep-style assertion over every exported argv builder: no `volume` + `rm` pair, no `-v` flag on
  `rm`** (the F49 rule as a test);
- `--format '{{json .}}'` parsing against **captured real output**, including the not-found case
  (empty output, not an error) and a container in `Exited` state;
- every refusal sentence names the action and never quotes a command's raw stderr wholesale.

`memoryService` tests: provision refuses without docker; remove refuses without the exact typed name;
`disable` still deletes only the config row and touches no container.

## Verification Commands

```
npm run typecheck
npx vitest run
npm run grep:secrets

# the F49 rule, as a command
grep -nE "volume\s+rm|rm\s+-v|--rm" src/main/services/docker*.ts    # must print nothing

# counters
node -e "const s=require('fs').readFileSync('src/shared/ipc.ts','utf8');console.log('IpcChannel keys:',(s.match(/^\s+[A-Za-z]+: '/gm)||[]).length)"  # 92
node -e "console.log('runtime deps:',Object.keys(require('./package.json').dependencies).length)"  # 8
```

**Runtime drive — on this machine's docker 29.7.2:**

1. Provision a throwaway project. Record: the container appears in `docker ps`, the report names the
   port, and `project_memory` carries `container_id`, `container_name`, `volume_name`, `bolt_port`.
2. **Prove the binding.** `docker port <name>` must show `127.0.0.1:<port>`, and
   `Test-NetConnection -ComputerName <this machine's LAN IP> -Port <port>` must **fail**. This is the
   task's most important single check.
3. Seed and index against it (6a-2's path) — the provisioned database must be indistinguishable from
   a hand-started one.
4. Stop, re-read status (**stopped**, and the chip does **not** claim `Connected`), start, re-read.
5. Remove the container with the typed confirmation. Confirm the container is gone **and the volume
   still exists** (`docker volume ls`). Re-provision and confirm **the previously indexed data is
   still there** — this is the F49 promise, driven.
6. Attempt removal with a wrong typed name and confirm the refusal.
7. Rename the container behind Chorus's back (or `docker rm` it manually), re-open the screen, and
   confirm the status read reports honestly instead of showing a stale row.

Evidence under `_verify/6a-4/`.

## Acceptance Criteria

- [ ] docker argv D4-verified against **29.7.2** by running it, this session.
- [ ] `-p 127.0.0.1:<port>:7687` — proven by `docker port` **and** by a failed connection from another
      address.
- [ ] Provision → seed → index → query works end to end against a Chorus-started container.
- [ ] Stop / start / status are honest, and **no status makes the chip green**.
- [ ] Container removal is gated by a typed name **in main**, and **the volume survives** — proven by
      re-provisioning and finding the data.
- [ ] `grep` for volume deletion, `rm -v` and `--rm` returns nothing.
- [ ] No new dependency: runtime deps **8**; `dockerode` absent from `package.json`.
- [ ] `IpcChannel` **92** · `MIGRATIONS.length` **19** · `sqliteTable(` **18**.
- [ ] `disable` still says, and does, exactly what it said before: removes the config, destroys
      nothing.
- [ ] typecheck **0** · vitest **≥ baseline** · `grep:secrets` clean.

## Review Checklist

1. **No shell, anywhere.** Every docker invocation is `execFile` with an argument array. A
   string-concatenated command line with a user-authored project name in it is a command-injection
   site.
2. **The loopback binding is a literal in a tested constant**, not built by string interpolation that
   a later edit could drop.
3. **Nothing deletes a volume**, and nothing passes `-v` to `rm`. Read every argv builder.
4. **Every docker call has exactly one user-initiated entry point.** Grep the callers of `docker.ts`;
   a boot hook or a `setInterval` anywhere is a defect against D58.
5. **The typed confirmation is enforced in main**, not by a disabled button.
6. **The copy distinguishes three different destructions** the user will otherwise conflate: turning
   memory off (config only), removing the container (process only), and deleting the data (Chorus
   cannot).
7. **`local-docker` mode is admitted in exactly one place** (`supportedMode`) and the row's `mode`
   value is what drives the UI — not an inference from `container_id` being non-null.
