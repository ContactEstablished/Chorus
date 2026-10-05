# Implementation specification 4b-2 — Helper execution wiring and the main-process Team harness

Paired [task](../Tasks/Task-4b-2.md). Decisions: [roadmap](../roadmap.md) MR-D3, MR-D10, MR-D18, MR-D26, MR-D32 (and MR-D18/D214 unchanged: no new key-bearing call); gates MR-G1, MR-G2, MR-G4–MR-G6; [overview](../Tasks/Phase-4b-Overview.md) K1–K5, K8, K9, K12, K14(b) and clarifications C7–C9, C14–C16, C18. Builds on [ImplementationSpec-4b-1](ImplementationSpec-4b-1.md) (every contract and pure rule this task wires). **Not started.**

## Files and insertion points

Verified 2026-10-05 at `70d5dda`, by opening each file. Line numbers are those of `70d5dda`; Task 4b-1 does not touch any file below, so they hold when this task starts (recheck at execution).

| File | Endings at `70d5dda` | Action |
|---|---|---|
| `src/main/services/teamRouting.ts` | New (LF) | The port, exactly as below. |
| `src/main/services/teamRouting.test.ts` | New (LF) | Table TR. |
| `src/main/services/teamService.ts` | CRLF (748 CRLF, 69,272 bytes) | Three imports after :14. `TeamServiceDependencies.routing?` after `validateProject` (:48). Two private methods after `assertCombination` (:113–116). `createRun`'s helper loop (:247, one line → six). `executeAttempt`: nine lines after the fence check (:401), before `let credential` (:402); the combination check on the sent id (:414); `routing` into `buildExecution` (:416). `finishAttempt`: two comment lines and `failureText` after `persisted` (:471); the `blocker` expression (:472). Nothing else. |
| `src/main/services/teamStorage.ts` | CRLF (384 CRLF, 42,373 bytes) | `writeAttempt` (:318–326): three lines after the identity check (:322), before `const row` (:323). |
| `src/main/services/teamRuntime.ts` | CRLF (315 CRLF, 32,361 bytes) | Two imports after :25. `TeamRuntimeDependencies` (:28–32): a two-line doc comment and `routing?` after `memory(…)` (:31), before `}` (:32). In `new TeamService({ … })` (:65–79): a comment and the `routing` property after `validateMember: …, autoActivate: true,` (:75). |
| `src/main/index.ts` | CRLF (1,616 CRLF, 86,487 bytes) | A comment and `routing: () => routing,` after `bridgeScript: …` (:1361), inside `new TeamRuntime({ … })` (:1359–1370). |
| `scripts/verify-routing-team.mjs` | New (LF) | The launcher, exactly as below. |
| `scripts/verify-routing-team.ts` | New (LF) | The Electron-hosted driver (reference below). |

Unchanged (verified): `teamCore.ts` (`failPreparation` :111–115 already settles a refused preparation as `failed` with `cessation: 'confirmed'`, and `reviseTask` :116–122 re-queues it), `teamIpc.ts` (`team:launch` :34 parses `teamLaunchSchema` in main; its error mapping :25 turns a `TeamDomainError` into `{ ok: false, code, message }` and a `ZodError` into `INVALID_REQUEST` with a generic message), `teamStatusCore.ts`, `helperProcess.ts`, the preload, every renderer file, and every file Task 4b-1 owns. **The Team regression verifier is not touched:** its v28 repair shipped in 0.9.2 (`efabe9b`: `verify-team-storage.ts` :94/:115 pin 28, :110 and :120 drop `sessions.routing_json`; `verify-team-members.ts:58` drops it and deletes migrations ≥ 27). This task re-runs `node scripts/verify-team-storage.mjs` as a regression check only.

## Recorded contract amendments

| Amendment | Test or script that changes with it |
|---|---|
| `TeamServiceDependencies.routing?: TeamRoutingPort` and `TeamRuntimeDependencies.routing?: () => RoutingService \| null` (both optional) | None: the four scripts that construct `TeamRuntime` (`verify-team-evaluation.ts:34`, `verify-team-pilot.ts:85`, `verify-team-production.ts:32`, `verify-team-recovery.ts:175`) and `verify-team-runtime.ts`'s `TeamService` keep compiling and behave as before (their members carry no tier). |
| `teamStorage.writeAttempt` refuses to change or drop a recorded `routing`, to add one to an attempt that is no longer `preparing`, and to insert an attempt that carries one (`IMMUTABLE_ATTEMPT`) | None: every existing writer spreads the attempt it read (`teamService.ts` :87, :383, :397, :420, :426, :437, :450, :459, :476, :498, :522, :671, :718, :742; `teamStorage.ts:232`, :241; `teamRuntime.ts:292`; `teamRecoveryCore.ts:20`), so a recorded selection survives every later write, and `reserveNextAttempt` (`teamCore.ts:76–83`) inserts none. |

## Normative contracts — `src/main/services/teamRouting.ts` (C7)

```ts
import { HELPER_ROUTING_REFUSALS, helperAttemptRefusal, planHelperRouting, type HelperRoutingPlan } from '../routing/helperRoutingCore'
import { LAUNCH_MESSAGES } from '../routing/launchCore'
import type { RoutingLaunchSelection } from '../../shared/routing'
import type { TeamMember } from '../../shared/team'
import { RoutingError, type RoutingService } from './routingService'

/**
 * Model Routing Task 4b-2 (ImplementationSpec-4b-2; overview K2–K5, K8, C7): how TeamService reaches the routing
 * service for a helper's tier. `check` (team:launch) reads only the two lists eligibility needs — no snapshot, no
 * clock. `resolve` (immediately before each routed attempt's decrypt) plans, then asks RoutingService.resolveLaunch
 * on the helper profile for the member's own credential and effort (MR-D32). Neither decrypts, sends a request,
 * calls anything else on RoutingService, or throws: every failure is a stated reason.
 */

export type TeamRoutingServiceLike = Pick<RoutingService, 'credentials' | 'models' | 'resolveLaunch' | 'getSettings'>
export type HelperRoutingCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string }
/** `selection` is null exactly for a member with no routingTier (OpenRouter default). */
export type HelperRoutingResolution =
  | { readonly ok: true; readonly selection: RoutingLaunchSelection | null }
  | { readonly ok: false; readonly reason: string }

export interface TeamRoutingPort {
  check(member: TeamMember): HelperRoutingCheck
  resolve(member: TeamMember): HelperRoutingResolution
}

export function createTeamRoutingPort(routing: () => TeamRoutingServiceLike | null): TeamRoutingPort {
  /** One thunk read, then both lists. A null service, a throwing thunk or a throwing list read is "unavailable". */
  function plan(member: TeamMember): { plan: HelperRoutingPlan; service: TeamRoutingServiceLike | null } {
    let service: TeamRoutingServiceLike | null = null
    let lists: { credentialIds: string[]; registrySlugs: string[] } | null = null
    try {
      service = routing()
      if (service !== null) {
        lists = {
          credentialIds: service.credentials().credentials.map((c) => c.id),
          registrySlugs: service.models().models.map((m) => m.slug)
        }
      }
    } catch {
      lists = null
    }
    return {
      service,
      plan: planHelperRouting({
        harness: member.harness,
        authMode: member.authMode,
        tier: member.routingTier ?? null,
        credentialProfileId: member.credentialProfileId,
        model: member.model,
        routingAvailable: lists !== null,
        routingCredentialIds: lists?.credentialIds ?? [],
        registrySlugs: lists?.registrySlugs ?? []
      })
    }
  }

  return {
    check(member) {
      if (member.routingTier === undefined) return { ok: true }
      const { plan: p } = plan(member)
      return p.kind === 'refused' ? { ok: false, reason: p.reason } : { ok: true }
    },
    resolve(member) {
      if (member.routingTier === undefined) return { ok: true, selection: null }
      const { plan: p, service } = plan(member)
      if (p.kind === 'refused') return { ok: false, reason: p.reason }
      // A member with a tier never plans 'unrouted', and a null service plans 'refused'; refuse rather than go unrouted.
      if (p.kind !== 'routed' || service === null) return { ok: false, reason: HELPER_ROUTING_REFUSALS.unavailable }
      try {
        const selection = service.resolveLaunch({
          model: p.model,
          tier: p.tier,
          effort: member.effort,
          credentialProfileId: p.credentialProfileId,
          profile: 'helper'
        })
        return { ok: true, selection }
      } catch (err) {
        const code = err instanceof RoutingError ? err.code : 'OPERATION_FAILED'
        const message = err instanceof RoutingError ? err.message : LAUNCH_MESSAGES.failed
        return { ok: false, reason: helperAttemptRefusal(p.tier, p.model, code, message, code === 'SNAPSHOT_STALE' ? maxAgeMinutes(service) : null) }
      }
    }
  }
}

/** SNAPSHOT_STALE's `<N>` (C2): the settings' snapshotMaxAgeMinutes, or null when the settings cannot be read. */
function maxAgeMinutes(service: TeamRoutingServiceLike): number | null {
  try {
    return service.getSettings().snapshotMaxAgeMinutes
  } catch {
    return null
  }
}
```

Rules (normative):

- **`check`** (team:launch) reads the thunk once, then `credentials()` and `models()` once each: no snapshot, no clock, no decrypt (TR2). **`resolve`** (each routed attempt) does the same, then calls `resolveLaunch` exactly once with `{ model: <base slug>, tier, effort: member.effort, credentialProfileId, profile: 'helper' }` (K5, TR3); it reads `getSettings()` only after a `SNAPSHOT_STALE` refusal, for C2's `<N>` (TR6).
- **A member with no tier** never reaches the thunk (TR1). TeamService skips the port for such a member anyway (C9).
- **Unavailable** (C1's `unavailable`): a thunk that returns null or throws, or a list read that throws (TR4). A tier is never silently dropped.
- **Errors.** A `RoutingError` maps through `helperAttemptRefusal` with its own code and message; anything else is `OPERATION_FAILED` with `Routing operation failed.` (`LAUNCH_MESSAGES.failed`), so no arbitrary error text reaches a blocker (TR7). The port never throws to TeamService.
- **Nothing else.** The port calls only `credentials`, `models`, `resolveLaunch` and `getSettings` (`TeamRoutingServiceLike`; TR2's proxy fails on any other property). It never decrypts and sends no request (MR-G4).

## Normative contracts — `teamService.ts` (C8, C9, K9, K12, C14)

```ts
// Imports, after :14
import type { TeamRoutingPort } from './teamRouting'
import { HELPER_ROUTING_REFUSALS, routedHelperFailureNote } from '../routing/helperRoutingCore'
import type { RoutingLaunchSelection } from '../../shared/routing'

// TeamServiceDependencies, after `validateProject(projectId: string): void` (:48)
  /**
   * Model Routing Phase 4b (K3, K8, C7): how a helper's routing tier is checked at launch and resolved before each
   * attempt. Optional, so the scripts that build a TeamService keep compiling; without it every routingTier is
   * refused as unavailable, never silently unrouted (C8).
   */
  routing?: TeamRoutingPort

// After assertCombination (:113–116)
  /** Model Routing Phase 4b (K4, C8): why this helper's routing tier cannot be served, or null (no tier, or servable). Reads no snapshot. */
  private routingRefusal(member: TeamMember): string | null {
    if (member.routingTier === undefined) return null
    const check = this.deps.routing ? this.deps.routing.check(member) : { ok: false as const, reason: HELPER_ROUTING_REFUSALS.unavailable }
    return check.ok ? null : check.reason
  }
  /** Model Routing Phase 4b (K8, MR-D32): this attempt's selection, or null for an unrouted member. A refusal throws its stated reason. */
  private resolveRouting(member: TeamMember): RoutingLaunchSelection | null {
    if (member.routingTier === undefined) return null
    const resolution = this.deps.routing ? this.deps.routing.resolve(member) : { ok: false as const, reason: HELPER_ROUTING_REFUSALS.unavailable }
    if (!resolution.ok) throw new TeamDomainError('ROUTING_REFUSED', resolution.reason)
    if (resolution.selection === null) throw new TeamDomainError('ROUTING_REFUSED', HELPER_ROUTING_REFUSALS.unavailable)
    return resolution.selection
  }

// createRun (:247) — the helper loop becomes
    for (const member of command.config.helpers) {
      await this.deps.validateMember(member, 'helper'); this.assertCombination(member)
      // Model Routing Phase 4b (K4, C8): a tier main cannot serve refuses the whole launch, before anything is stored.
      const refusal = this.routingRefusal(member)
      if (refusal !== null) throw new TeamDomainError('ROUTING_REFUSED', `Helper "${scrubSecrets(member.label)}": ${refusal}`)
    }

// executeAttempt — after the fence check (:401), before `let credential` (:402)
      // Model Routing Phase 4b (K8, C9, MR-D32): this attempt's tier, resolved on main's own numbers immediately before the
      // decrypt. A refusal throws into preparation-failed below: no decrypt, no spawn, the attempt consumed. The selection
      // is recorded on the attempt (K9) before the decrypt, so what was sent can never be lost.
      const routing = this.resolveRouting(member)
      if (routing !== null) {
        current = this.storage.attempts(run.id).find(a => a.id === original.id)!
        teamAssert(current.status === 'preparing' && !current.terminalIntent, 'ATTEMPT_REVOKED', 'Attempt preparation was cancelled.')
        this.storage.command(this.operation(run, 'helper-routing-resolved', { role: 'system' }), tx => { tx.writeAttempt({ ...current, routing, version: current.version + 1 }, current.version); return { acknowledgment: {}, event: { attemptId: current.id, tier: routing.tier, sentModelId: routing.sentModelId, endpoints: [...routing.endpoints] } } })
      }

// :414 — the combination check names the SENT id: `model: member.model` becomes
model: routing?.sentModelId ?? member.model

// :416 — buildExecution: `allowedCommands: helperCheckCommands(run.config.verificationProfile), signal: controller.signal })` becomes
allowedCommands: helperCheckCommands(run.config.verificationProfile), ...(routing ? { routing } : {}), signal: controller.signal })

// finishAttempt — after `const persisted = …` (:471); :472's summary branch calls failureText
    // Model Routing Phase 4b (K12, C3): a routed attempt that ends with OpenCode's generic provider error names its tier and
    // what to do; result.summary keeps the parser's text. Chorus never changes a helper's tier on its own.
    const failureText = (result: NonNullable<HelperProcessOutcome['result']>): string => persisted.routing && result.failure?.category === 'provider-error' ? `${result.summary} ${routedHelperFailureNote(persisted.routing)}` : result.summary
    const blocker = (outcome.permissionBlocked || outcome.protocolError) && persisted.blocker ? persisted.blocker : outcome.result?.failure && outcome.cessation === 'confirmed' && !outcome.intent ? failureText(outcome.result).slice(0, 3000) : settled.attempt.blocker
```

`HelperProcessOutcome` (:5), `TeamDomainError` and `teamAssert` (:4) and `scrubSecrets` (:12) are already imported. `buildExecution`'s `model: member.model` stays the member's own model: the builder derives the sent id from the selection (ImplementationSpec-4b-1) and refuses a mismatch.

Rules (normative):

- **`createRun` (C8).** Order unchanged: parse (:241) → replay (:242, a replayed request returns its stored acknowledgment before any check, as today) → `validateProject` → lead `validateMember` and `assertCombination` → **for each helper: `validateMember`, `assertCombination`, then the routing check** → closing and project re-check → `storage.createRun` (:251). A refusal throws `TeamDomainError('ROUTING_REFUSED', 'Helper "<label>": <reason>')` with the label scrubbed; nothing is stored. Through `team:launch` it reaches the window as `{ ok: false, code: 'ROUTING_REFUSED', message: 'Helper "<label>": <reason>' }` (`teamIpc.ts:25`). A member-refine failure (C1's `notOpencode` on a non-OpenCode member) and a member `routing` object are `ZodError`s thrown by the parse (:241) and by `team:launch`'s own parse before it: the window sees only `INVALID_REQUEST` with `Team operation failed. Refresh the current state and retry.`; the C1 text is visible only in main (the harness reads the ZodError's issues).
- **`executeAttempt` (C9), exact order:** reservation (unchanged) → workspace → second `validateMember` (:398) → fence checks (:399–401) → **resolve** (port) → **re-read the attempt and assert `preparing` with no terminal intent** → **`helper-routing-resolved`** (attempt version + 1, payload `{ attemptId, tier, sentModelId, endpoints }`, actor `system`) → decrypt `credentials.resolve` (:403) → `authorize` → combination check **on the sent id** → `buildExecution({ …, routing })` → `helper-spawn-intent` → spawn. An unrouted member skips the three new steps entirely (`resolveRouting` returns null without touching the port) and its request is byte-identical to today's.
- **A refusal** (`ROUTING_REFUSED`) is thrown before the decrypt and before any spawn, so it takes the existing `preparation-failed` path (:453–461): blocker `fitUtf8(scrubSecrets(reason), 3500)` + ` This attempt was consumed.`, attempt and task `failed`, one of three attempts used (K8, Q1). The lead's `team_revise` re-queues the task; the next attempt resolves again on the latest numbers (MR-D10). No refresh is ever triggered.
- **A failure after the record** (the decrypt, `authorize`, the combination check or the build throws) also takes `preparation-failed`; the attempt keeps its `routing` (every writer spreads it), which is the truth: that selection was resolved for it.
- **K12.** The note is added only when the persisted attempt has `routing` **and** the parser reported `failure.category === 'provider-error'` **and** the existing condition for using the summary as the blocker holds (a result with a failure, cessation confirmed, no termination intent). `result.summary` itself is unchanged; the task's blocker is the attempt's (`if (blocker) settled.task.blocker = blocker`, :474). Generation-truncated and unsuccessful-finish failures, unrouted attempts and permission or protocol blockers are unchanged.
- **C14 needs no code.** `team_roster` returns `run.config.helpers` (:171), which now carry `routingTier`; `team_detail`'s task section returns whole attempt records (:210), which now carry `routing`; `compactTeamStatus` is unchanged.
- **C15.** A selection passes `json()`'s `scrubSecrets` identity check by construction (Phase 2 drops any tag that fails `ROUTING_TAG_PATTERN` or `scrubSecrets`); one that would fail it makes the `helper-routing-resolved` write throw `SECRET_IN_RECORD`, which fails the attempt through `preparation-failed`. The harness proves the storage half (T14).
- **MR-D18/D214.** The port never decrypts; a routing refusal precedes `credentials.resolve`; the attempt's only decrypt is still `credentials.resolve` (`teamRuntime.ts:66–73`).

## `teamStorage.ts` (K9, C16)

After the identity check (:322), before `const row` (:323):

```ts
    // Model Routing Phase 4b (K9, C16): the routing an attempt sent is recorded once — by helper-routing-resolved, while
    // the attempt is still preparing — and never changes or disappears. A new attempt carries none.
    teamAssert(prior?.routing !== undefined ? json(prior.routing) === json(attempt.routing ?? null) : attempt.routing === undefined || prior?.status === 'preparing', 'IMMUTABLE_ATTEMPT', 'An attempt\'s recorded routing cannot change.')
```

Rules: a prior record with `routing` requires the same JSON (a change or a drop throws); a prior record without it accepts a first `routing` only while its status is `preparing`; an insert (`expectedVersion` undefined, so no prior) cannot carry one. The code is `IMMUTABLE_ATTEMPT` (K9), with its own message. The check runs before `json(attempt)` (:323), so a legitimate first write of a key-shaped selection reaches `SECRET_IN_RECORD` there (C15).

## `teamRuntime.ts` and `src/main/index.ts` (K3)

```ts
// teamRuntime.ts imports, after :25
import { createTeamRoutingPort } from './teamRouting'
import type { RoutingService } from './routingService'

// TeamRuntimeDependencies, after memory(…) (:31)
  /** Model Routing Phase 4b (K3): the routing service, read on every helper check and attempt — index.ts builds it after
   *  this runtime and resets it to null if routing fails to start. Absent: every helper routingTier is refused as unavailable. */
  routing?: () => RoutingService | null

// new TeamService({ … }), after `validateMember: (m, role) => this.validateMember(m, role), autoActivate: true,` (:75)
      // Model Routing Phase 4b (K3, C7): helper tiers are checked at launch and resolved before each attempt through this port.
      routing: createTeamRoutingPort(() => deps.routing?.() ?? null),

// src/main/index.ts, inside new TeamRuntime({ … }) after `bridgeScript: …,` (:1361)
    // Model Routing Phase 4b: a THUNK, like registerIpc's below — `routing` is constructed after this runtime and reset to null on failure.
    routing: () => routing,
```

`TeamRuntime` is constructed (:1359) and started (:1371) before `routing` is assigned (:1428) and may be reset to null (:1438); the thunk is read at every check and attempt, never at construction (the precedent is `registerIpc`'s routing thunk, :1417–1419). `routingService.ts` imports `storage.ts` and `vault.ts` as types only, so `teamRuntime.ts`'s value import of `teamRouting.ts` (which imports `RoutingError`) adds no cycle.

## Expected byte counts after the edits

Computed by applying exactly these edits to a scratch copy of the `70d5dda` sources and converting to the file's own endings: `teamService.ts` 72,807 bytes / 788 CRLF; `teamStorage.ts` 42,839 / 387; `teamRuntime.ts` 32,971 / 322; `index.ts` 86,660 / 1,618; all four still `w/crlf`, 0 LF, 0 CR. With `core.autocrlf` true, `git diff --stat` cannot see a whole-file rewrite; compare these counts as well. The `Edit` tool can rewrite a CRLF file as LF: check after every edit.

## The harness — `scripts/verify-routing-team.mjs` and `scripts/verify-routing-team.ts` (C18, K14(b))

**Host.** The launcher bundles the driver with esbuild (`packages: 'external'`) into `_verify/routing-team-<pid>.cjs` and runs it with `require('electron')` as a **windowless** Electron main script (no `BrowserWindow`), `ELECTRON_RUN_AS_NODE` removed, exactly as `verify-team-storage.mjs` does: `TeamStorage` needs `better-sqlite3` built for Electron, which is why no vitest test can reach `TeamService`. The driver sets `userData` to its evidence directory before anything else.

**Real:** `StorageService`/`TeamStorage` on a throwaway `chorus.db` (a fresh database runs every migration, v28 included); a provider row and a credential row whose blob is `not-a-real-DPAPI-envelope` (never decrypted; the `verify-team-recovery.ts:38–39` pattern); `RoutingService` with a **pinned clock** over a `RoutingStore` in the evidence directory, seeded through the store's own writers with the golden fixture exactly as `routingIpc.test.ts` ranks it (snapshot with the fixture's `fetchedAt` `09:05:00Z`, observations from it, cache and the credential's account file from the fixture with `checkedAt 09:15:39Z`); the real port; the real `TeamService`; the real `opencodeHelper.buildExecution` (reached through `helperRegistry`) and the real helper parser. **Fakes:** the process executor (records the built request and never spawns), the workspace, the lead, `validateMember` (the real one probes the installed CLI) and the decrypt (`credentials.resolve` returns a fake key built at run time). The routing service gets a vault and a `fetchImpl` that count and throw, and a captured log; no observer is started.

**Zero cost.** No helper, lead or OpenCode process is started and no request is sent. The only child processes are the `where.exe` PATH lookups inside the real builder's `resolveCli` (and `where.exe node` for an npm shim), the same lookups the app makes before every helper launch; T1 records the resolved executable, which the fake executor never runs. No real key exists anywhere in the run.

**Wiring note.** The harness builds `TeamService` itself (with `createTeamRoutingPort` over a counting wrapper of the real `RoutingService`), so `teamRuntime.ts`'s one-line port construction and `index.ts`'s thunk are proven by the typecheck, the build and the IPC drive's boot, not by the harness.

### Launcher (normative)

```js
// Model Routing Task 4b-2 (ImplementationSpec-4b-2, overview C18): the main-process Team routing harness.
// Bundles scripts/verify-routing-team.ts into _verify/ and runs it in a WINDOWLESS Electron host against a throwaway
// database and routing store under %TEMP%\chorus-routing-team-*. Zero cost: no helper, lead or OpenCode process, no
// request, no paid call. Prints one line per check (T1-T16) and, last, `PASS (16 checks)` (exit 0) or
// `FAIL (k of 16 checks)` (exit 1). The bundle and the whole evidence directory are deleted on every exit path;
// nothing is written anywhere else. T15 is completed here (the child's own stdout and stderr are scanned too) and
// T16 is decided here (the child exited 0 and everything it left is gone).
// Usage: node scripts/verify-routing-team.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TOTAL = 16
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-routing-team-'))
const bundle = path.join(ROOT, '_verify', `routing-team-${process.pid}.cjs`)
const FAKE_KEY = 'sk-or-v1-' + 'f'.repeat(64) // the driver's fake decrypt value; the child must never print it
const patterns = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'main', 'services', 'secret-patterns.json'), 'utf8')).patterns.map((p) => ({ name: p.name, re: new RegExp(p.source) }))
const redact = (text) => { let out = String(text).split(FAKE_KEY).join('[redacted]'); for (const { re } of patterns) out = out.replace(new RegExp(re.source, 'g'), '[redacted]'); return out }

let checks = [], code = null, output = '', failure = null
try {
  await require('esbuild').build({ entryPoints: [path.join(ROOT, 'scripts', 'verify-routing-team.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'error' })
  const env = { ...process.env, CHORUS_ROUTING_TEAM_EVIDENCE: evidence }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [bundle], { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (c) => { output += c }); child.stderr.on('data', (c) => { output += c })
  const timer = setTimeout(() => child.kill(), 300000)
  ;[code] = await once(child, 'close'); clearTimeout(timer)
  const report = path.join(evidence, 'report.json'), failed = path.join(evidence, 'failure.json')
  if (fs.existsSync(report)) checks = JSON.parse(fs.readFileSync(report, 'utf8')).checks
  if (fs.existsSync(failed)) failure = JSON.parse(fs.readFileSync(failed, 'utf8'))
} catch (err) {
  failure = { message: err instanceof Error ? err.message : String(err) }
} finally {
  // T15, completed: the child's own output holds no key material either.
  const t15 = checks.find((c) => c.name.startsWith('T15 '))
  if (t15) {
    const hits = [output.includes(FAKE_KEY) ? 'the child output contains the fake key' : null, ...patterns.filter(({ re }) => re.test(output)).map(({ name }) => `the child output matches the ${name} pattern`)].filter(Boolean)
    t15.ok = t15.ok && hits.length === 0
    t15.detail = { ...t15.detail, childOutputHits: hits }
  }
  const gone = []
  for (const target of [bundle, evidence]) {
    try { fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); if (fs.existsSync(target)) throw new Error('it still exists') }
    catch (err) { gone.push(`${target} was not deleted (${err instanceof Error ? err.message : String(err)})`) }
  }
  const left = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('chorus-routing-team-'))
  checks.push({ name: 'T16 cleanup', ok: code === 0 && failure === null && gone.length === 0 && left.length === 0, detail: { exitCode: code, failure, notDeleted: gone, leftInTemp: left } })
}
for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.ok ? '' : ` — ${redact(JSON.stringify(c.detail))}`}`)
const failed = checks.filter((c) => !c.ok).length + Math.max(0, TOTAL - checks.length)
console.log(failed === 0 && checks.length === TOTAL ? `PASS (${TOTAL} checks)` : `FAIL (${failed} of ${TOTAL} checks)`)
process.exitCode = failed === 0 && checks.length === TOTAL ? 0 : 1
```

The launcher writes nothing outside `_verify/` and its own `%TEMP%\chorus-routing-team-*`, deletes both on every exit path, and prints no key: details are redacted against the fake key and every secret pattern before printing.

### Steps and checks (normative)

Routing clock: `AT = 2026-10-02T09:20:00Z` (15 minutes after the fixture's `fetchedAt`), then `LATER = 2026-10-02T10:21:00Z` (the fixture's numbers are 76 minutes old). The roster: lead Claude `2.1.278 (Claude Code)` subscription `claude-sonnet-5`; helpers in the DeepSeek capability options' member shape (`opencode`, `api_key`, the harness provider and credential, effort `low`, installed `1.18.34`, `customModel: true`): **H1** `DeepSeek :nitro` with `routingTier: 'balanced'`, **H2** standard `deepseek/deepseek-v4.1-flash` with `'nitro'`, **H3** `:nitro` with no tier. `concurrency: 4`, `leadContext: 'standard'`, `autoActivate: true`.

| Step | What the driver does |
|---|---|
| S0 | Storage, the two rows, the seeded store, `RoutingService`, the counting wrapper (`credentials`, `models`, `resolveLaunch`, `getSettings`), `TeamService` with the fakes and `routing: createTeamRoutingPort(() => routingAvailable ? counted : null)`. |
| S1 | Two refused launches (GLM-5.3 with a tier; Codex with a tier) and one rejected launch (H1 plus a `routing` object). |
| S2 | `createRun([H1, H2, H3])`; wait for `leadSessionId`; `markBridgeReady`; wait for `active`; `team_roster` through `dispatch` as the lead. |
| S3 | Tasks A1 (H1), A2 (H2), A3 (H3), one at a time, each waited until spawned (captured); then A1 and A3 finish successfully, A2 finishes with OpenCode's `{"type":"step_finish","part":{"reason":"length"}}` through its real parser (generation truncated). |
| S4 | Clock → `LATER`. Task B1 (H1) → refused. Task B2 (H2) → spawned, left running. |
| S5 | Re-seed the snapshot through the store: `fetchedAt 2026-10-02T10:20:00Z`, the fixture's rows without `streamlake/fp8` (33 → 32 rows). The lead's `team_revise` re-queues B1 for H1; attempt 2 spawns. |
| S6 | `routingAvailable = false` (the thunk answers null). Task C1 (H1) → refused. Task C2 (H3) → spawned. `routingAvailable = true`. |
| S7 | B1's attempt 2, B2 and C2 finish with OpenCode's `{"type":"error"}` through their real parsers. |
| S8 | `service.shutdown()`; record `JSON.stringify(attempts)`; close the storage; reopen it; then a fixture run in the same database (its helper a copy of H1) with one reserved, `preparing` attempt, for the storage controls. |
| S9 | The key scan and the counters; write `report.json`; exit 0. |

Hand-written expectations (computed in scratch by running the proposed cores, never by the code under test): `GOLDEN = ['streamlake/fp8','venice/fp8','gmicloud/fp8']`; `RESEED = ['venice/fp8','gmicloud/fp8','deepinfra/fp8']` (the helper Balanced on the re-seeded snapshot at `LATER`; Budget there is `deepinfra/fp8 → gmicloud/fp8 → nextbit/fp8`, Fast unchanged); `PROVIDER(order)` as in 4b-1; the K7 entry strings of ImplementationSpec-4b-1 and `{"deepseek/deepseek-v4.1-flash":{"options":{"provider":{"order":["venice/fp8","gmicloud/fp8","deepinfra/fp8"],"allow_fallbacks":false,"require_parameters":true,"quantizations":["fp8"],"data_collection":"deny"}}}}` for the re-seeded request; `ARGS_BASE = ['run','--pure','--format','json','--model','openrouter/deepseek/deepseek-v4.1-flash','--agent','build','--variant','low']`, `ARGS_NITRO` the same with `…:nitro` (compared from the `run` token, so the shim's own prefix is ignored).

| # | Name (exact) | Passes when |
|---|---|---|
| T1 | `T1 setup: v28 database, seeded store, pinned clock, the credential listed, nothing decrypted or sent` | A read-only connection reports `MAX(version)` 28 and `sessions.routing_json`; the routing store holds exactly `account-<C>.json`, `cache.json`, `observations.json`, `snapshot.json`; `routing.tiers({ profile: 'helper', … })` has `computedAt` `AT`, `snapshotFetchedAt` `2026-10-02T09:05:00Z`, `stale` false; `routing.credentials()` lists exactly the harness credential; `resolveCli('opencode')` resolves; decrypts, routing-vault calls and fetches 0; `requestsSinceStart` 0. |
| T2 | `T2 launch refuses a tier on GLM-5.3 and on a Codex helper; no run row` | GLM: `TeamDomainError` code `ROUTING_REFUSED`, message exactly `Helper "GLM-5.3 helper": Model routing does not know this helper's model.`; Codex: a `ZodError` whose issues are exactly `[{ code: 'custom', path: ['config','helpers',0], message: 'A routing tier applies only to an OpenCode helper on an OpenRouter API key.' }]`; `listRunIds()` empty; no `resolveLaunch`, no decrypt. |
| T3 | `T3 launch rejects a member routing object; no run row` | A `ZodError` with exactly one issue `{ code: 'unrecognized_keys', path: ['config','helpers',0], message: 'Unrecognized key: "routing"', keys: ['routing'] }`; `listRunIds()` empty. |
| T4 | `T4 launch stores tier names only; team_roster returns them` | `getRun(run).config.helpers` tiers `['balanced','nitro',null]`; `team_roster`'s members the same (C14); the stored `team_runs.config_json` contains no `"routing":` key; H3's `team_members.config_json` contains no `routingTier`; no `resolveLaunch`, no decrypt. |
| T5 | `T5 Balanced from a :nitro member resolves on the helper profile before the decrypt` | A1's `routing` deep-equals `{ tier: 'balanced', model: SLUG, sentModelId: SLUG, provider: PROVIDER(GOLDEN), endpoints: GOLDEN, computedAt: AT, snapshotFetchedAt: '2026-10-02T09:05:00Z' }` and main's own `routing.tiers({ profile: 'helper', effort: 'low', credentialProfileId: C }).tiers.balanced` provider and endpoints; at H1's decrypt the preparing attempt already carried exactly that selection; the first `resolveLaunch` request was `{ model: SLUG, tier: 'balanced', effort: 'low', credentialProfileId: C, profile: 'helper' }`. |
| T6 | `T6 the routed request: base slug, the golden entry, every measured option kept` | A1's request: args from `run` equal `ARGS_BASE`; models entry exactly the K7 Balanced string; cap `64000`; content keys `['share','agent','provider','permission']`; `share`, `agent`, `permission` deep-equal A3's (unrouted) content. |
| T7 | `T7 Nitro from a standard member: :nitro, deny and variants.low` | A2's `routing` deep-equals `{ tier: 'nitro', model: SLUG, sentModelId: NITRO, provider: { data_collection: 'deny' }, endpoints: [], computedAt: AT, snapshotFetchedAt: null }`; args `ARGS_NITRO`; entry exactly the K7 Nitro string; cap `64000`. |
| T8 | `T8 one helper-routing-resolved event per routed attempt, before helper-spawn-intent` | Exactly one such event for A1 and for A2, actor `system`, each after its `attempt-workspace-ready` and before its `helper-spawn-intent`; payloads exactly `{ attemptId, tier: 'balanced', sentModelId: SLUG, endpoints: GOLDEN }` and `{ attemptId, tier: 'nitro', sentModelId: NITRO, endpoints: [] }`; none for A3. |
| T9 | `T9 a stale ranked tier refuses the attempt before any decrypt or spawn` | B1's attempt: status `failed`, no `routing`, `process` null, blocker exactly `Balanced routing refused this helper attempt: the endpoint numbers for deepseek/deepseek-v4.1-flash are more than 60 minutes old. Refresh them in Settings → Model routing, or turn on background observation there to keep them fresh, then revise the task. This attempt was consumed.`; the task's blocker the same; decrypts and spawns unchanged; `resolveLaunch` +1 (outcome `SNAPSHOT_STALE`), `getSettings` +1; a `preparation-failed` event for it and no `helper-routing-resolved`. |
| T10 | `T10 Nitro resolves on the same stale numbers` | B2's `routing` deep-equals T7's with `computedAt` `LATER`; decrypts +1, spawns +1; its entry the K7 Nitro string. |
| T11 | `T11 after a re-seed, the revised task resolves again on the new numbers` | B1's attempt 2: number 2, `routing` deep-equals `{ tier: 'balanced', model: SLUG, sentModelId: SLUG, provider: PROVIDER(RESEED), endpoints: RESEED, computedAt: LATER, snapshotFetchedAt: '2026-10-02T10:20:00Z' }` (a later `computedAt` and another order than A1's); its entry the re-seeded string; B1's attempt 1 byte-identical to its T9 record; A1's `routing` byte-identical to its T5 record. |
| T12 | `T12 routing unavailable: a routed attempt is refused, an unrouted helper sends today's request` | C1's blocker exactly `Model routing is not available right now. Launch this helper with OpenRouter default instead. This attempt was consumed.`, no `routing`, no `resolveLaunch` call; C2 has no `routing`, args `ARGS_NITRO`, entry `{"deepseek/deepseek-v4.1-flash:nitro":{"variants":{"low":{"reasoning":{"effort":"low"}}}}}`, and its `OPENCODE_CONFIG_CONTENT` equals A3's byte for byte; decrypts +1, spawns +1 (C2 only). |
| T13 | `T13 a routed provider error names its tier; other failures do not` | B1 attempt 2: attempt and task blockers `opencode reported an unsuccessful run. This attempt used the Balanced tier, pinned to venice/fp8, gmicloud/fp8 and deepinfra/fp8 with no fallback. If those providers were unavailable, refresh the numbers in Settings → Model routing and revise the task: each attempt resolves its tier again. A helper on another tier can also take the revision. Chorus never changes a helper's tier on its own.` (392 characters), `result.summary` `opencode reported an unsuccessful run.`, `failure` `{ category: 'provider-error', finishReason: null }`; B2: `opencode reported an unsuccessful run. This attempt used the Nitro tier, which leaves the provider to OpenRouter. Chorus never changes a helper's tier on its own.`; C2 (unrouted): exactly `opencode reported an unsuccessful run.`; A2 (routed, generation truncated): exactly `opencode ended with finish reason length. Generation was truncated; reduce the assignment or use a verified model budget before a counted retry.` with `failure` `{ category: 'generation-truncated', finishReason: 'length' }`. |
| T14 | `T14 attempts read back unchanged; recorded routing is immutable and secret-free` | After `shutdown()` and a reopen from disk, `JSON.stringify(attempts)` is byte-identical and exactly four attempts carry `routing` (A1, A2, B2, B1#2). On the fixture run: a first `routing` whose tag is key-shaped (`'sk-or-v1-' + 'e'.repeat(40)` in `order` and `endpoints`) on the `preparing` attempt throws `SECRET_IN_RECORD` and leaves the attempt unchanged (C15); a valid first `routing` (T5's) succeeds; changing its `computedAt`, dropping it, adding one to the main run's terminal unrouted A3, and inserting a new attempt that carries one each throw `IMMUTABLE_ATTEMPT` with `An attempt's recorded routing cannot change.` (C16). |
| T15 | `T15 no key material anywhere; every routing call accounted for` | Positive controls: the patterns match `'sk-or-v1-' + '0123456789abcdef'.repeat(2)`; the scan reports a planted fake key as `['scratch contains the fake key', 'scratch matches the openrouter pattern']`; all six captured requests carry the fake key in `secretEnv.OPENROUTER_API_KEY`. Scan (none may hit): every row of every table of the database, every routing-store file, the routing log and store warnings, each captured request without `secretEnv`, the checks recorded so far, and (in the launcher) the child's stdout and stderr. Counters exactly `{ decrypts: 6, spawns: 6, routingVault: 0, fetches: 0, credentials: 8, models: 8, resolveLaunch: 5, getSettings: 1 }`; `requestsSinceStart` 0. |
| T16 | `T16 cleanup` | Decided by the launcher: the child exited 0 with no `failure.json`; the bundle and the evidence directory are deleted; no `%TEMP%\chorus-routing-team-*` remains. |

The counters follow from the steps: `credentials`/`models` once each for the GLM check, twice at S2 (H1, H2; H3 has no tier), and once per routed resolution (A1, A2, B1#1, B2, B1#2); `resolveLaunch` five times (B1#1 refused stale); C1 never reaches the service (null thunk); decrypts and spawns A1, A2, A3, B2, B1#2, C2.

### Driver (reference)

The driver below was typechecked (`tsc --noEmit` with `tsconfig.node.json`'s settings) and bundled with esbuild against the proposed 4b-1 and 4b-2 code in a scratch mirror of `70d5dda`; it was **not executed** (Electron was outside this drafting session's zero-cost allowance). Its checks and expectations are normative (the table above); its structure is a reference the implementer may adjust, recording any change in the report.

```ts
// Model Routing Task 4b-2 (ImplementationSpec-4b-2, overview C18): the main-process Team routing harness.
// Driven by scripts/verify-routing-team.mjs, which bundles this file into _verify/ and runs it in a WINDOWLESS
// Electron host (better-sqlite3 is built for Electron). REAL: StorageService/TeamStorage on a throwaway database,
// RoutingService over a throwaway routing store seeded with the golden fixture under a PINNED clock, the routing
// port, TeamService, opencodeHelper.buildExecution and the helper parser. FAKES: the process executor (it never
// spawns), the workspace, the lead, validateMember and the decrypt. Zero cost: no helper, lead or OpenCode
// process, no request (the only child processes are the real builder's `where.exe` PATH lookups), no paid call.
// Writes report.json into its evidence directory and exits; the launcher prints the checks and deletes everything.
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import Database from 'better-sqlite3'
import { StorageService } from '../src/main/services/storage'
import { TeamService } from '../src/main/services/teamService'
import type { HelperProcessOptions, HelperProcessOutcome } from '../src/main/services/helperProcess'
import { reserveNextAttempt, TeamDomainError, type TeamLease } from '../src/main/services/teamCore'
import { RoutingService, type RoutingServiceDeps } from '../src/main/services/routingService'
import { RoutingStore } from '../src/main/services/routingStore'
import { createTeamRoutingPort, type TeamRoutingServiceLike } from '../src/main/services/teamRouting'
import { extractObservations, parseEndpointsResponse } from '../src/main/routing/endpointsCore'
import { resolveCli } from '../src/main/services/cliDetect'
import { DEFAULT_ROUTING_SETTINGS, type RoutingLaunchSelection } from '../src/shared/routing'
import type { TeamAttempt, TeamEvent, TeamMember, TeamRunConfig } from '../src/shared/team'
import type { HelperLaunchRequest } from '../src/main/adapters/helpers/types'

const evidence = process.env.CHORUS_ROUTING_TEAM_EVIDENCE!
app.setPath('userData', path.join(evidence, 'electron-profile'))
const ROOT = path.resolve(__dirname, '..') // the bundle runs from _verify/

// ── Constants and hand-written expectations (ImplementationSpec-4b-2; never computed by the code under test) ──
const SLUG = 'deepseek/deepseek-v4.1-flash'
const NITRO = SLUG + ':nitro'
const GATEWAY = 'https://openrouter.ai/api/v1'
const PROVIDER_ID = '3b9d7c1e-2f4a-4c6b-8d0e-1a2b3c4d5e6f'
const C = '5f0c1a2e-8a3b-4c5d-9e6f-0123456789ab'
const AT = '2026-10-02T09:20:00Z' // the pinned routing clock: 15 min after the fixture's fetchedAt
const LATER = '2026-10-02T10:21:00Z' // 61 min after AT: the fixture's numbers are 76 min old
const RESEED_AT = '2026-10-02T10:20:00Z'
const CHECKED_AT = '2026-10-02T09:15:39Z'
const SHA = 'a'.repeat(40)
/** Built at run time so no source file holds a complete key shape (npm run grep:secrets). */
const FAKE_KEY = 'sk-or-v1-' + 'f'.repeat(64)
const ROUTING_IMMUTABLE = "An attempt's recorded routing cannot change."
const PROVIDER = (order: string[]) => ({ order, allow_fallbacks: false, require_parameters: true, quantizations: ['fp8'], data_collection: 'deny' })
const GOLDEN_ORDER = ['streamlake/fp8', 'venice/fp8', 'gmicloud/fp8'] // Phase 1's golden helper Balanced
const RESEED_ORDER = ['venice/fp8', 'gmicloud/fp8', 'deepinfra/fp8'] // the same ranking without streamlake/fp8
const EXPECTED = {
  balanced: { tier: 'balanced', model: SLUG, sentModelId: SLUG, provider: PROVIDER(GOLDEN_ORDER), endpoints: GOLDEN_ORDER, computedAt: AT, snapshotFetchedAt: '2026-10-02T09:05:00Z' },
  nitro: { tier: 'nitro', model: SLUG, sentModelId: NITRO, provider: { data_collection: 'deny' }, endpoints: [], computedAt: AT, snapshotFetchedAt: null },
  nitroLater: { tier: 'nitro', model: SLUG, sentModelId: NITRO, provider: { data_collection: 'deny' }, endpoints: [], computedAt: LATER, snapshotFetchedAt: null },
  reseeded: { tier: 'balanced', model: SLUG, sentModelId: SLUG, provider: PROVIDER(RESEED_ORDER), endpoints: RESEED_ORDER, computedAt: LATER, snapshotFetchedAt: RESEED_AT },
  argsBase: ['run', '--pure', '--format', 'json', '--model', 'openrouter/deepseek/deepseek-v4.1-flash', '--agent', 'build', '--variant', 'low'],
  argsNitro: ['run', '--pure', '--format', 'json', '--model', 'openrouter/deepseek/deepseek-v4.1-flash:nitro', '--agent', 'build', '--variant', 'low'],
  modelsBalanced: '{"deepseek/deepseek-v4.1-flash":{"options":{"provider":{"order":["streamlake/fp8","venice/fp8","gmicloud/fp8"],"allow_fallbacks":false,"require_parameters":true,"quantizations":["fp8"],"data_collection":"deny"}}}}',
  modelsReseeded: '{"deepseek/deepseek-v4.1-flash":{"options":{"provider":{"order":["venice/fp8","gmicloud/fp8","deepinfra/fp8"],"allow_fallbacks":false,"require_parameters":true,"quantizations":["fp8"],"data_collection":"deny"}}}}',
  modelsNitro: '{"deepseek/deepseek-v4.1-flash:nitro":{"options":{"provider":{"data_collection":"deny"}},"variants":{"low":{"reasoning":{"effort":"low"}}}}}',
  modelsUnrouted: '{"deepseek/deepseek-v4.1-flash:nitro":{"variants":{"low":{"reasoning":{"effort":"low"}}}}}',
  notOpencode: 'A routing tier applies only to an OpenCode helper on an OpenRouter API key.',
  glmRefusal: 'Helper "GLM-5.3 helper": Model routing does not know this helper\'s model.',
  staleBlocker: 'Balanced routing refused this helper attempt: the endpoint numbers for deepseek/deepseek-v4.1-flash are more than 60 minutes old. Refresh them in Settings → Model routing, or turn on background observation there to keep them fresh, then revise the task. This attempt was consumed.',
  unavailableBlocker: 'Model routing is not available right now. Launch this helper with OpenRouter default instead. This attempt was consumed.',
  providerError: 'opencode reported an unsuccessful run.',
  truncated: 'opencode ended with finish reason length. Generation was truncated; reduce the assignment or use a verified model budget before a counted retry.',
  noteReseeded: "This attempt used the Balanced tier, pinned to venice/fp8, gmicloud/fp8 and deepinfra/fp8 with no fallback. If those providers were unavailable, refresh the numbers in Settings → Model routing and revise the task: each attempt resolves its tier again. A helper on another tier can also take the revision. Chorus never changes a helper's tier on its own.",
  noteNitro: "This attempt used the Nitro tier, which leaves the provider to OpenRouter. Chorus never changes a helper's tier on its own."
}

// ── Small helpers ──
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }
async function until(label: string, condition: () => boolean, ms = 10000): Promise<void> {
  const deadline = Date.now() + ms
  while (!condition()) { if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`); await delay(10) }
}
const checks: { name: string; ok: boolean; detail: unknown }[] = []
const record = (name: string, ok: boolean, detail: unknown) => checks.push({ name, ok: Boolean(ok), detail })
const errorOf = async (work: () => Promise<unknown> | unknown): Promise<{ name: string; code: string | null; message: string; issues: unknown } | null> => {
  try { await work(); return null } catch (err) {
    const e = err as { name?: string; code?: string; message?: string; issues?: { code: string; path: unknown[]; message: string; keys?: string[] }[] }
    return { name: e.name ?? 'Error', code: e instanceof TeamDomainError ? e.code : null, message: String(e.message), issues: e.issues?.map((i) => ({ code: i.code, path: i.path, message: i.message, keys: i.keys })) ?? null }
  }
}

app.whenReady().then(async () => {
  // ── S0: throwaway storage, the credential, the seeded routing store, the real RoutingService, the fakes ──
  const dbPath = path.join(evidence, 'chorus.db')
  let storage = new StorageService(dbPath)
  const createdAt = new Date().toISOString()
  storage.createProviderConfig({ id: PROVIDER_ID, name: 'OpenRouter', adapterType: 'opencode', authMode: 'api_key', envVarName: 'OPENROUTER_API_KEY', baseUrl: GATEWAY, createdAt })
  storage.createCredentialProfile({ id: C, providerId: PROVIDER_ID, label: 'Harness key', encryptedBlob: Buffer.from('not-a-real-DPAPI-envelope'), fingerprintHash: 'harness-fixture', createdAt })
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/main/routing/__fixtures__/endpoints-deepseek-v4.1-flash-2026-10-02.json'), 'utf8'))
  const snapshot = { fetchedAt: fixture.fetchedAt as string, endpoints: parseEndpointsResponse(fixture).endpoints }
  const storeWarnings: string[] = [], logLines: string[] = []
  const routingStore = new RoutingStore(path.join(evidence, 'routing'), { warn: (m) => storeWarnings.push(m) })
  routingStore.writeSnapshot(SLUG, snapshot)
  routingStore.appendObservations(SLUG, extractObservations(snapshot), AT, DEFAULT_ROUTING_SETTINGS.observationMaxAgeDays)
  routingStore.mergeCache(SLUG, Object.fromEntries(Object.entries(fixture.cacheVerified as Record<string, boolean>).map(([tag, verified]) => [tag, { verified, checkedAt: CHECKED_AT }])))
  routingStore.writeAccount(SLUG, C, { guardrailRemoved: fixture.guardrailRemoved, dataPolicyRemoved: fixture.dataPolicyDenyRemoved, checkedAt: CHECKED_AT })
  const counters = { decrypts: 0, spawns: 0, routingVault: 0, fetches: 0, credentials: 0, models: 0, resolveLaunch: 0, getSettings: 0 }
  let routingClock = AT
  const routing = new RoutingService({
    storage,
    vault: { decryptForLaunch: async () => { counters.routingVault++; throw new Error('the harness never decrypts through routing') } } as unknown as RoutingServiceDeps['vault'],
    store: routingStore,
    now: () => routingClock,
    fetchImpl: async () => { counters.fetches++; throw new Error('the harness sends no request') },
    log: { info: (m) => logLines.push(m), warn: (m) => logLines.push(m), error: (m) => logLines.push(m) }
  })
  const resolveCalls: { request: unknown; outcome: string }[] = []
  /** The real service behind the four methods the port may call, counted. */
  const counted: TeamRoutingServiceLike = {
    credentials: () => { counters.credentials++; return routing.credentials() },
    models: () => { counters.models++; return routing.models() },
    resolveLaunch: (q) => {
      counters.resolveLaunch++
      try { const s = routing.resolveLaunch(q); resolveCalls.push({ request: q, outcome: 'ok' }); return s }
      catch (err) { resolveCalls.push({ request: q, outcome: (err as { code?: string }).code ?? 'error' }); throw err }
    },
    getSettings: () => { counters.getSettings++; return routing.getSettings() }
  }
  let routingAvailable = true
  let runId = ''
  let lease: TeamLease | undefined
  const decryptRecords: { memberId: string; routingAtDecrypt: (string | null)[] }[] = []
  type Finish = 'success' | 'provider-error' | 'truncated'
  const spawns: { attemptId: string; request: HelperLaunchRequest; settled: boolean; finish(kind: Finish): void }[] = []
  const teams = storage.createTeamStorage()
  const service = new TeamService({
    storage: teams,
    autoActivate: true,
    validateProject() {},
    validateMember: async () => {},
    leaseIssued: (value) => { lease = value },
    credentials: {
      inspect: (m) => m.authMode === 'api_key' ? { credentialId: m.credentialProfileId!, fingerprint: 'harness', providerId: m.providerId!, authMode: 'api_key', routeIdentity: 'harness-route' } : undefined,
      resolve: async (m) => {
        counters.decrypts++
        decryptRecords.push({ memberId: m.id, routingAtDecrypt: teams.attempts(runId).filter((a) => a.memberId === m.id && a.status === 'preparing').map((a) => (a.routing ? JSON.stringify(a.routing) : null)) })
        return { envVarName: 'OPENROUTER_API_KEY', value: FAKE_KEY, isSecret: true }
      },
      route: (m) => m.authMode === 'api_key' ? { providerKey: PROVIDER_ID, providerName: 'OpenRouter', baseUrl: GATEWAY, modelId: m.model } : undefined
    },
    workspace: {
      prepareRun: async () => ({ baseSha: SHA, head: SHA, worktreeId: randomUUID() }),
      prepareAttempt: async (_run, attempt) => ({ cwd: path.join(evidence, 'worktree'), baseSha: attempt.baseSha!, worktreeId: randomUUID() }),
      validateResult: async () => {},
      inspectRecovery: async () => ({ writersStopped: true, ordinaryDirty: false, ambiguousIntegration: false })
    },
    lead: { launch: async (_run, _lease, authorization) => { authorization.assertAuthorized(); return { sessionId: randomUUID() } }, stopped: async () => true, stop: async () => true },
    executor: {
      spawnHelper: (attemptId: string, options: HelperProcessOptions) => {
        options.authorizeSpawn() // production calls it immediately before the OS spawn; here nothing is spawned
        counters.spawns++
        const done = deferred<HelperProcessOutcome>()
        const identity = { pid: 40000 + counters.spawns, creationTime: String(counters.spawns), executable: options.request.executable }
        /** The REAL parser's result for one OpenCode record (C18 T13). */
        const parsed = (line: string) => [...options.parser.push(line), ...options.parser.finish()].find((e) => e.type === 'result') as NonNullable<HelperProcessOutcome['result']>
        const entry = {
          attemptId, request: options.request, settled: false,
          finish(kind: Finish) {
            if (entry.settled) return
            entry.settled = true
            const result = kind === 'success' ? { type: 'result' as const, summary: 'Harness helper finished.', isError: false } : parsed(kind === 'provider-error' ? '{"type":"error"}\n' : '{"type":"step_finish","part":{"reason":"length"}}\n')
            done.resolve({ exitCode: kind === 'success' ? 0 : 1, cessation: 'confirmed', result, permissionBlocked: false, protocolError: false, intent: null, process: identity, descendants: [], usage: [] })
          }
        }
        spawns.push(entry)
        return {
          identified: Promise.resolve(identity),
          done: done.promise,
          cancel: async (intent?: 'cancelled' | 'timed-out') => { options.onTerminationIntent?.(intent ?? 'cancelled'); if (!entry.settled) { entry.settled = true; done.resolve({ exitCode: null, cessation: 'confirmed', result: null, permissionBlocked: false, protocolError: false, intent: intent ?? 'cancelled', process: identity, descendants: [], usage: [] }) } },
          inspect: () => ({ process: identity, descendants: [], cessation: entry.settled ? 'confirmed' as const : 'live' as const, intent: null })
        }
      },
      cancelHelper: async () => {}
    },
    routing: createTeamRoutingPort(() => (routingAvailable ? counted : null))
  })

  // T1
  {
    const raw = new Database(dbPath, { readonly: true })
    const version = (raw.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number }).v
    const routingJson = (raw.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]).some((c) => c.name === 'routing_json')
    raw.close()
    const files = fs.readdirSync(path.join(evidence, 'routing'), { recursive: true }).map(String).filter((f) => fs.statSync(path.join(evidence, 'routing', f)).isFile()).map((f) => path.basename(f)).sort()
    const tiers = routing.tiers({ model: SLUG, profile: 'helper', effort: 'low', credentialProfileId: C })
    const listed = routing.credentials().credentials.map((c) => c.id)
    let builder: string | null = null
    try { builder = resolveCli('opencode').file } catch (err) { builder = `unresolved: ${(err as Error).message}` }
    record('T1 setup: v28 database, seeded store, pinned clock, the credential listed, nothing decrypted or sent',
      version === 28 && routingJson && isDeepStrictEqual(files, [`account-${C}.json`, 'cache.json', 'observations.json', 'snapshot.json']) && tiers.computedAt === AT && tiers.snapshotFetchedAt === '2026-10-02T09:05:00Z' && !tiers.stale && isDeepStrictEqual(listed, [C]) && builder !== null && !builder.startsWith('unresolved') && counters.decrypts === 0 && counters.routingVault === 0 && counters.fetches === 0 && routing.status().requestsSinceStart === 0,
      { version, routingJson, files, computedAt: tiers.computedAt, snapshotFetchedAt: tiers.snapshotFetchedAt, stale: tiers.stale, listed, builder, counters: { ...counters } })
  }

  // The roster (the DeepSeek capability options' member shape, teamRuntime.ts capabilities()).
  const LEAD: TeamMember = { id: randomUUID(), label: 'Lead', harness: 'claude', authMode: 'subscription', providerId: null, credentialProfileId: null, model: 'claude-sonnet-5', effort: null, installedVersion: '2.1.278 (Claude Code)' }
  const helper = (label: string, model: string, routingTier?: TeamMember['routingTier']): TeamMember => ({ id: randomUUID(), label, harness: 'opencode', authMode: 'api_key', providerId: PROVIDER_ID, credentialProfileId: C, model, effort: 'low', installedVersion: '1.18.34', customModel: true, ...(routingTier ? { routingTier } : {}) })
  const H1 = helper('Helper Balanced', NITRO, 'balanced'), H2 = helper('Helper Nitro', SLUG, 'nitro'), H3 = helper('Helper default', NITRO)
  const config = (helpers: unknown[]): unknown => ({ schemaVersion: 1, baseRevision: 'HEAD', leadContext: 'standard', lead: LEAD, helpers, concurrency: 4 })
  const USER = { role: 'user' as const, principal: 'routing-team-harness' }

  // T2, T3
  {
    const glm = await errorOf(() => service.createRun({ projectId: randomUUID(), clientRequestId: 'refused-glm', config: config([{ ...helper('GLM-5.3 helper', 'z-ai/glm-5.3', 'balanced'), customModel: false, effort: null }]) }, USER))
    const codex = await errorOf(() => service.createRun({ projectId: randomUUID(), clientRequestId: 'refused-codex', config: config([{ id: randomUUID(), label: 'Codex', harness: 'codex', authMode: 'subscription', providerId: null, credentialProfileId: null, model: 'gpt-6-astra', effort: null, installedVersion: 'codex-cli 0.155.1', routingTier: 'balanced' }]) }, USER))
    record('T2 launch refuses a tier on GLM-5.3 and on a Codex helper; no run row',
      glm?.code === 'ROUTING_REFUSED' && glm.message === EXPECTED.glmRefusal && isDeepStrictEqual(codex?.issues, [{ code: 'custom', path: ['config', 'helpers', 0], message: EXPECTED.notOpencode, keys: undefined }]) && teams.listRunIds().length === 0 && counters.resolveLaunch === 0 && counters.decrypts === 0,
      { glm, codex, runs: teams.listRunIds().length, counters: { ...counters } })
    const object = await errorOf(() => service.createRun({ projectId: randomUUID(), clientRequestId: 'refused-object', config: config([{ ...H1, routing: EXPECTED.balanced }]) }, USER))
    record('T3 launch rejects a member routing object; no run row',
      object?.name === 'ZodError' && isDeepStrictEqual(object.issues, [{ code: 'unrecognized_keys', path: ['config', 'helpers', 0], message: 'Unrecognized key: "routing"', keys: ['routing'] }]) && teams.listRunIds().length === 0,
      { object, runs: teams.listRunIds().length })
  }

  // T4
  const projectId = randomUUID()
  const ack = await service.createRun({ projectId, clientRequestId: 'routing-team', config: config([H1, H2, H3]) }, USER)
  runId = String(ack.runId)
  await until('the lead', () => teams.getRun(runId).leadSessionId !== null)
  const actor = () => ({ role: 'lead' as const, runId, generation: lease!.generation, epoch: lease!.epoch })
  service.markBridgeReady(actor())
  await until('an active run', () => teams.getRun(runId).status === 'active')
  {
    const run = teams.getRun(runId)
    const roster = await service.dispatch(actor(), 'team_roster', {}, new AbortController().signal) as { members: TeamMember[] }
    const stored = new Database(dbPath, { readonly: true })
    const configJson = (stored.prepare('SELECT config_json AS c FROM team_runs WHERE id = ?').get(runId) as { c: string }).c
    const memberJson = (stored.prepare('SELECT config_json AS c FROM team_members WHERE run_id = ? AND id = ?').get(runId, H3.id) as { c: string }).c
    stored.close()
    record('T4 launch stores tier names only; team_roster returns them',
      isDeepStrictEqual(run.config.helpers.map((h) => h.routingTier ?? null), ['balanced', 'nitro', null]) && isDeepStrictEqual(roster.members.map((h) => h.routingTier ?? null), ['balanced', 'nitro', null]) && !/"routing"\s*:/.test(configJson) && !memberJson.includes('routingTier') && counters.resolveLaunch === 0 && counters.decrypts === 0,
      { tiers: run.config.helpers.map((h) => h.routingTier ?? null), roster: roster.members.map((h) => h.routingTier ?? null), configHasRoutingObject: /"routing"\s*:/.test(configJson), unroutedMemberHasTier: memberJson.includes('routingTier'), counters: { ...counters } })
  }

  const task = (request: string, memberId: string) => service.submitTask(runId, { clientRequestId: request, memberId, kind: 'code', title: `Harness ${request}`, brief: `Harness task ${request}.`, acceptance: ['The harness records the request.'], paths: [`${request}.txt`] }, actor())
  const attemptsOf = (taskId: string): TeamAttempt[] => teams.attempts(runId).filter((a) => a.taskId === taskId).sort((a, b) => a.number - b.number)
  const spawnOf = (attemptId: string) => spawns.find((s) => s.attemptId === attemptId)
  /** TeamStorage.events pages 200 at a time (it reads one more to say whether more exist). */
  const allEvents = (): TeamEvent[] => { const out: TeamEvent[] = []; let after = 0; for (;;) { const page = teams.events(runId, after), take = page.slice(0, 200); out.push(...take); if (page.length <= 200) return out; after = take[take.length - 1].sequence } }
  const contentOf = (request: HelperLaunchRequest) => JSON.parse(request.envAdditions.OPENCODE_CONFIG_CONTENT) as { share: unknown; agent?: unknown; provider: { openrouter: { models: unknown } }; permission: unknown }
  const tail = (request: HelperLaunchRequest) => request.args.slice(request.args.indexOf('run'))

  // S3: A1 (H1, Balanced from :nitro), A2 (H2, Nitro from standard), A3 (H3, unrouted), each spawned then finished.
  const A1 = String(task('a1', H1.id).taskId); await until('A1 spawn', () => attemptsOf(A1).length === 1 && !!spawnOf(attemptsOf(A1)[0].id))
  const A2 = String(task('a2', H2.id).taskId); await until('A2 spawn', () => attemptsOf(A2).length === 1 && !!spawnOf(attemptsOf(A2)[0].id))
  const A3 = String(task('a3', H3.id).taskId); await until('A3 spawn', () => attemptsOf(A3).length === 1 && !!spawnOf(attemptsOf(A3)[0].id))
  const a1 = attemptsOf(A1)[0], a2 = attemptsOf(A2)[0], a3 = attemptsOf(A3)[0]
  const r1 = spawnOf(a1.id)!.request, r2 = spawnOf(a2.id)!.request, r3 = spawnOf(a3.id)!.request
  const a1RoutingJson = JSON.stringify(a1.routing)
  spawnOf(a1.id)!.finish('success'); spawnOf(a2.id)!.finish('truncated'); spawnOf(a3.id)!.finish('success')
  await until('A1-A3 settled', () => teams.tasks(runId).find((t) => t.id === A1)?.status === 'awaiting-review' && teams.tasks(runId).find((t) => t.id === A2)?.status === 'failed' && teams.tasks(runId).find((t) => t.id === A3)?.status === 'awaiting-review')

  {
    const mainTiers = routing.tiers({ model: SLUG, profile: 'helper', effort: 'low', credentialProfileId: C }).tiers.balanced
    const atDecrypt = decryptRecords.find((d) => d.memberId === H1.id)
    record('T5 Balanced from a :nitro member resolves on the helper profile before the decrypt',
      isDeepStrictEqual(a1.routing, EXPECTED.balanced) && isDeepStrictEqual(a1.routing?.provider, mainTiers?.provider) && isDeepStrictEqual(a1.routing?.endpoints, mainTiers?.endpoints) && isDeepStrictEqual(atDecrypt?.routingAtDecrypt, [JSON.stringify(EXPECTED.balanced)]) && isDeepStrictEqual(resolveCalls[0], { request: { model: SLUG, tier: 'balanced', effort: 'low', credentialProfileId: C, profile: 'helper' }, outcome: 'ok' }),
      { routing: a1.routing, mainTiers, atDecrypt, firstResolve: resolveCalls[0] })
    const c1 = contentOf(r1), c3 = contentOf(r3)
    record('T6 the routed request: base slug, the golden entry, every measured option kept',
      isDeepStrictEqual(tail(r1), EXPECTED.argsBase) && JSON.stringify(c1.provider.openrouter.models) === EXPECTED.modelsBalanced && r1.envAdditions.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX === '64000' && isDeepStrictEqual(Object.keys(c1), ['share', 'agent', 'provider', 'permission']) && isDeepStrictEqual(c1.share, c3.share) && isDeepStrictEqual(c1.agent, c3.agent) && isDeepStrictEqual(c1.permission, c3.permission),
      { args: tail(r1), models: c1.provider.openrouter.models, cap: r1.envAdditions.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX, keys: Object.keys(c1) })
    record('T7 Nitro from a standard member: :nitro, deny and variants.low',
      isDeepStrictEqual(a2.routing, EXPECTED.nitro) && isDeepStrictEqual(tail(r2), EXPECTED.argsNitro) && JSON.stringify(contentOf(r2).provider.openrouter.models) === EXPECTED.modelsNitro && r2.envAdditions.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX === '64000',
      { routing: a2.routing, args: tail(r2), models: contentOf(r2).provider.openrouter.models })
    const events = allEvents()
    const resolved = (id: string) => events.filter((e) => e.operation === 'helper-routing-resolved' && e.payload.attemptId === id)
    const seq = (op: string, id: string) => events.find((e) => e.operation === op && e.payload.attemptId === id)?.sequence ?? -1
    const ordered = (id: string) => resolved(id).length === 1 && seq('attempt-workspace-ready', id) < resolved(id)[0].sequence && resolved(id)[0].sequence < seq('helper-spawn-intent', id)
    record('T8 one helper-routing-resolved event per routed attempt, before helper-spawn-intent',
      ordered(a1.id) && ordered(a2.id) && resolved(a3.id).length === 0 && isDeepStrictEqual(resolved(a1.id)[0]?.payload, { attemptId: a1.id, tier: 'balanced', sentModelId: SLUG, endpoints: GOLDEN_ORDER }) && isDeepStrictEqual(resolved(a2.id)[0]?.payload, { attemptId: a2.id, tier: 'nitro', sentModelId: NITRO, endpoints: [] }) && resolved(a1.id)[0]?.actor === 'system',
      { a1: resolved(a1.id).map((e) => [e.sequence, e.payload]), a2: resolved(a2.id).map((e) => [e.sequence, e.payload]), a3: resolved(a3.id).length })
  }

  // S4: the routing clock moves 61 minutes on. B1 (H1, Balanced) is refused stale; B2 (H2, Nitro) resolves and stays live.
  routingClock = LATER
  let before = { ...counters }
  const B1 = String(task('b1', H1.id).taskId)
  await until('B1 refused', () => teams.tasks(runId).find((t) => t.id === B1)?.status === 'failed')
  {
    const b1 = attemptsOf(B1)[0], t = teams.tasks(runId).find((x) => x.id === B1)!
    const events = allEvents()
    record('T9 a stale ranked tier refuses the attempt before any decrypt or spawn',
      b1.status === 'failed' && b1.routing === undefined && b1.blocker === EXPECTED.staleBlocker && t.blocker === EXPECTED.staleBlocker && b1.process === null && counters.decrypts === before.decrypts && counters.spawns === before.spawns && counters.resolveLaunch === before.resolveLaunch + 1 && counters.getSettings === before.getSettings + 1 && resolveCalls.at(-1)?.outcome === 'SNAPSHOT_STALE' && events.some((e) => e.operation === 'preparation-failed' && e.payload.attemptId === b1.id) && !events.some((e) => e.operation === 'helper-routing-resolved' && e.payload.attemptId === b1.id),
      { status: b1.status, routing: b1.routing ?? null, blocker: b1.blocker, taskBlocker: t.blocker, delta: { decrypts: counters.decrypts - before.decrypts, spawns: counters.spawns - before.spawns, resolveLaunch: counters.resolveLaunch - before.resolveLaunch, getSettings: counters.getSettings - before.getSettings } })
  }
  before = { ...counters }
  const B2 = String(task('b2', H2.id).taskId)
  await until('B2 spawn', () => attemptsOf(B2).length === 1 && !!spawnOf(attemptsOf(B2)[0].id))
  const b2 = attemptsOf(B2)[0]
  record('T10 Nitro resolves on the same stale numbers',
    isDeepStrictEqual(b2.routing, EXPECTED.nitroLater) && counters.decrypts === before.decrypts + 1 && counters.spawns === before.spawns + 1 && JSON.stringify(contentOf(spawnOf(b2.id)!.request).provider.openrouter.models) === EXPECTED.modelsNitro,
    { routing: b2.routing, delta: { decrypts: counters.decrypts - before.decrypts, spawns: counters.spawns - before.spawns } })

  // S5: new numbers arrive (the fixture without streamlake/fp8, fetched one minute ago); the lead revises B1.
  const b1Before = JSON.stringify(attemptsOf(B1)[0])
  routingStore.writeSnapshot(SLUG, { fetchedAt: RESEED_AT, endpoints: snapshot.endpoints.filter((e) => e.tag !== 'streamlake/fp8') })
  await service.dispatch(actor(), 'team_revise', { clientRequestId: 'revise-b1', taskId: B1, memberId: H1.id, brief: 'Harness revision after new numbers.' }, new AbortController().signal)
  await until('B1 attempt 2 spawn', () => attemptsOf(B1).length === 2 && !!spawnOf(attemptsOf(B1)[1].id))
  const b1two = attemptsOf(B1)[1]
  record('T11 after a re-seed, the revised task resolves again on the new numbers',
    b1two.number === 2 && isDeepStrictEqual(b1two.routing, EXPECTED.reseeded) && Date.parse(b1two.routing!.computedAt) > Date.parse(a1.routing!.computedAt) && !isDeepStrictEqual(b1two.routing!.endpoints, a1.routing!.endpoints) && JSON.stringify(attemptsOf(B1)[0]) === b1Before && JSON.stringify(attemptsOf(A1)[0].routing) === a1RoutingJson && JSON.stringify(contentOf(spawnOf(b1two.id)!.request).provider.openrouter.models) === EXPECTED.modelsReseeded,
    { routing: b1two.routing, attempt1Unchanged: JSON.stringify(attemptsOf(B1)[0]) === b1Before, a1Unchanged: JSON.stringify(attemptsOf(A1)[0].routing) === a1RoutingJson })

  // S6: routing becomes unavailable (the thunk answers null): C1 (H1) is refused; C2 (H3, unrouted) launches as today.
  routingAvailable = false
  before = { ...counters }
  const C1 = String(task('c1', H1.id).taskId)
  await until('C1 refused', () => teams.tasks(runId).find((t) => t.id === C1)?.status === 'failed')
  const C2 = String(task('c2', H3.id).taskId)
  await until('C2 spawn', () => attemptsOf(C2).length === 1 && !!spawnOf(attemptsOf(C2)[0].id))
  routingAvailable = true
  {
    const c1 = attemptsOf(C1)[0], c2 = attemptsOf(C2)[0], r = spawnOf(c2.id)!.request
    record("T12 routing unavailable: a routed attempt is refused, an unrouted helper sends today's request",
      c1.blocker === EXPECTED.unavailableBlocker && c1.routing === undefined && c2.routing === undefined && counters.resolveLaunch === before.resolveLaunch && counters.decrypts === before.decrypts + 1 && counters.spawns === before.spawns + 1 && isDeepStrictEqual(tail(r), EXPECTED.argsNitro) && JSON.stringify(contentOf(r).provider.openrouter.models) === EXPECTED.modelsUnrouted && r.envAdditions.OPENCODE_CONFIG_CONTENT === r3.envAdditions.OPENCODE_CONFIG_CONTENT,
      { c1Blocker: c1.blocker, delta: { resolveLaunch: counters.resolveLaunch - before.resolveLaunch, decrypts: counters.decrypts - before.decrypts, spawns: counters.spawns - before.spawns }, args: tail(r) })
  }

  // S7: the live attempts end with OpenCode's generic provider error, through the real parser.
  const c2 = attemptsOf(C2)[0]
  for (const id of [b1two.id, b2.id, c2.id]) spawnOf(id)!.finish('provider-error')
  await until('S7 settled', () => [B1, B2, C2].every((id) => teams.tasks(runId).find((t) => t.id === id)?.status === 'failed'))
  {
    const blocker = (taskId: string, n: number) => ({ attempt: attemptsOf(taskId)[n].blocker, task: teams.tasks(runId).find((t) => t.id === taskId)!.blocker, summary: attemptsOf(taskId)[n].result?.summary, failure: attemptsOf(taskId)[n].result?.failure })
    const routed = blocker(B1, 1), nitro = blocker(B2, 0), unrouted = blocker(C2, 0), truncated = blocker(A2, 0)
    const providerError = { category: 'provider-error', finishReason: null }
    record('T13 a routed provider error names its tier; other failures do not',
      isDeepStrictEqual(routed, { attempt: `${EXPECTED.providerError} ${EXPECTED.noteReseeded}`, task: `${EXPECTED.providerError} ${EXPECTED.noteReseeded}`, summary: EXPECTED.providerError, failure: providerError }) &&
      isDeepStrictEqual(nitro, { attempt: `${EXPECTED.providerError} ${EXPECTED.noteNitro}`, task: `${EXPECTED.providerError} ${EXPECTED.noteNitro}`, summary: EXPECTED.providerError, failure: providerError }) &&
      isDeepStrictEqual(unrouted, { attempt: EXPECTED.providerError, task: EXPECTED.providerError, summary: EXPECTED.providerError, failure: providerError }) &&
      isDeepStrictEqual(truncated, { attempt: EXPECTED.truncated, task: EXPECTED.truncated, summary: EXPECTED.truncated, failure: { category: 'generation-truncated', finishReason: 'length' } }),
      { routed, nitro, unrouted, truncated })
  }

  // S8 (T14): quiesce, reopen from disk, then the storage rules on a fixture run in the same database.
  await service.shutdown()
  const attemptsBefore = JSON.stringify(teams.attempts(runId))
  storage.close()
  storage = new StorageService(dbPath)
  const reopened = storage.createTeamStorage()
  {
    const after = reopened.attempts(runId)
    const op = (rid: string, n: number) => ({ runId: rid, operation: `harness-${n}`, actor: 'system' as const, generation: 1, eventId: randomUUID(), now: new Date().toISOString() })
    const write = (rid: string, n: number, value: TeamAttempt, expected?: number) => errorOf(() => reopened.command(op(rid, n), (tx) => { tx.writeAttempt(value, expected); return { acknowledgment: {}, event: {} } }))
    // A fixture run whose helper is a copy of the OpenCode H1, with one reserved (preparing) attempt. These two writes must succeed.
    const fixtureRun = teamFixtureRunFor(H1)
    reopened.createRun(fixtureRun, 'storage-controls', { config: fixtureRun.config }, randomUUID())
    const fixtureTask = teamFixtureTaskFor(fixtureRun.id, fixtureRun.config.helpers[0].id)
    reopened.command(op(fixtureRun.id, 1), (tx) => { tx.writeTask(fixtureTask); return { acknowledgment: {}, event: {} } })
    const reservation = reserveNextAttempt(fixtureRun, [fixtureTask], [], randomUUID(), new Date().toISOString())!
    reopened.command(op(fixtureRun.id, 2), (tx) => { tx.writeAttempt(reservation.attempt); tx.writeTask(reservation.task, fixtureTask.version); return { acknowledgment: {}, event: {} } })
    const preparing = reopened.attempts(fixtureRun.id)[0]
    const keyTag = 'sk-or-v1-' + 'e'.repeat(40)
    const forged: RoutingLaunchSelection = { ...EXPECTED.balanced, provider: PROVIDER([keyTag]), endpoints: [keyTag] } as RoutingLaunchSelection
    const secret = await write(fixtureRun.id, 3, { ...preparing, routing: forged, version: preparing.version + 1 }, preparing.version)
    const unchangedAfterSecret = JSON.stringify(reopened.attempts(fixtureRun.id)[0]) === JSON.stringify(preparing)
    const first = await write(fixtureRun.id, 4, { ...preparing, routing: EXPECTED.balanced as RoutingLaunchSelection, version: preparing.version + 1 }, preparing.version)
    const recorded = reopened.attempts(fixtureRun.id)[0]
    const changed = await write(fixtureRun.id, 5, { ...recorded, routing: { ...recorded.routing!, computedAt: LATER }, version: recorded.version + 1 }, recorded.version)
    const { routing: _dropped, ...withoutRouting } = recorded
    const dropped = await write(fixtureRun.id, 6, { ...withoutRouting, version: recorded.version + 1 }, recorded.version)
    const lateA3 = after.find((a) => a.id === a3.id)!
    const late = await write(runId, 7, { ...lateA3, routing: EXPECTED.nitro as RoutingLaunchSelection, version: lateA3.version + 1 }, lateA3.version)
    const inserted = await write(fixtureRun.id, 8, { ...reservation.attempt, id: randomUUID(), number: 2, routing: EXPECTED.balanced as RoutingLaunchSelection })
    record('T14 attempts read back unchanged; recorded routing is immutable and secret-free',
      JSON.stringify(after) === attemptsBefore && after.filter((a) => a.routing).length === 4 && secret?.code === 'SECRET_IN_RECORD' && unchangedAfterSecret && first === null && isDeepStrictEqual(recorded.routing, EXPECTED.balanced) && [changed, dropped, late, inserted].every((e) => e?.code === 'IMMUTABLE_ATTEMPT' && e.message === ROUTING_IMMUTABLE),
      { sameJson: JSON.stringify(after) === attemptsBefore, routed: after.filter((a) => a.routing).length, secret: secret?.code, unchangedAfterSecret, first, changed: changed?.code, dropped: dropped?.code, late: late?.code, inserted: inserted?.code })
  }

  // T15: MR-G4 — the fake key appears nowhere it should not; every routing call is accounted for.
  {
    const patterns = (JSON.parse(fs.readFileSync(path.join(ROOT, 'src/main/services/secret-patterns.json'), 'utf8')).patterns as { name: string; source: string }[]).map((p) => ({ name: p.name, re: new RegExp(p.source) }))
    const scanInto = (into: string[], label: string, text: string) => { if (text.includes(FAKE_KEY)) into.push(`${label} contains the fake key`); const p = patterns.find(({ re }) => re.test(text)); if (p) into.push(`${label} matches the ${p.name} pattern`) }
    const hits: string[] = [], scratch: string[] = []
    scanInto(scratch, 'scratch', `planted ${FAKE_KEY} here`)
    const raw = new Database(dbPath, { readonly: true })
    for (const { name } of raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]) scanInto(hits, `table ${name}`, JSON.stringify(raw.prepare(`SELECT * FROM "${name}"`).all(), (_k, v) => (Buffer.isBuffer(v) ? v.toString('latin1') : v)))
    raw.close()
    for (const file of fs.readdirSync(path.join(evidence, 'routing'), { recursive: true }).map(String)) { const p = path.join(evidence, 'routing', file); if (fs.statSync(p).isFile()) scanInto(hits, `routing/${file}`, fs.readFileSync(p, 'utf8')) }
    scanInto(hits, 'routing log', logLines.join('\n')); scanInto(hits, 'store warnings', storeWarnings.join('\n'))
    for (const s of spawns) { const { secretEnv: _secret, ...visible } = s.request; scanInto(hits, `request ${s.attemptId}`, JSON.stringify(visible)) }
    scanInto(hits, 'checks', JSON.stringify(checks))
    const keyWhereExpected = spawns.length === 6 && spawns.every((s) => s.request.secretEnv.OPENROUTER_API_KEY === FAKE_KEY)
    const expected = { decrypts: 6, spawns: 6, routingVault: 0, fetches: 0, credentials: 8, models: 8, resolveLaunch: 5, getSettings: 1 }
    record('T15 no key material anywhere; every routing call accounted for',
      isDeepStrictEqual(scratch, ['scratch contains the fake key', 'scratch matches the openrouter pattern']) && patterns.some(({ re }) => re.test('sk-or-v1-' + '0123456789abcdef'.repeat(2))) && keyWhereExpected && hits.length === 0 && isDeepStrictEqual(counters, expected) && routing.status().requestsSinceStart === 0,
      { hits, scratch, keyWhereExpected, counters, expected, requestsSinceStart: routing.status().requestsSinceStart })
  }
  storage.close()
  fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify({ checks, electron: process.versions.electron, at: new Date().toISOString() }, null, 2))
  app.exit(0)
}).catch((error) => { fs.writeFileSync(path.join(evidence, 'failure.json'), JSON.stringify({ message: String(error?.message ?? error), stack: String(error?.stack ?? '') })); app.exit(1) })

/** A minimal active run (teamTestFixtures' shape) whose only helper is a copy of H1, so its attempt can carry routing. */
function teamFixtureRunFor(member: TeamMember) {
  const lead: TeamMember = { id: randomUUID(), label: 'Lead', harness: 'claude', authMode: 'subscription', providerId: null, credentialProfileId: null, model: 'claude-sonnet-5', effort: null, installedVersion: '2.1.278 (Claude Code)' }
  const config = { schemaVersion: 1, baseRevision: 'HEAD', lead, helpers: [{ ...member, id: randomUUID() }], concurrency: 2, executionMinutes: 30, integrationPolicy: 'lead-integrates' } as TeamRunConfig
  const now = new Date().toISOString()
  return { id: randomUUID(), projectId: randomUUID(), leadSessionId: null, config, status: 'active' as const, generation: 1, version: 1, policyVersion: 1, baseSha: SHA, integrationWorktreeId: randomUUID(), integrationHead: SHA, createdAt: now, updatedAt: now, blocker: null }
}
function teamFixtureTaskFor(runId: string, memberId: string) {
  return { id: randomUUID(), runId, command: { clientRequestId: 'storage-control', memberId, kind: 'code' as const, title: 'Storage control', brief: 'Storage control.', context: '', acceptance: ['The control runs.'], paths: ['control.txt'], dependsOn: [] }, status: 'queued' as const, version: 1, currentAttemptId: null, attemptCount: 0, readyAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), blocker: null }
}
```

## Test cases

**Table TR — `teamRouting.test.ts`** (a fake service exposing only the four methods behind a `Proxy` that throws on any other property, recording calls and requests; `MEMBER` is H1's shape with credential `C`; `UNAVAILABLE` is C1's text). Expected strings computed by running the proposed port in scratch; the table, written as vitest code, passed there (8 tests).

| # | Case | Expect |
|---|---|---|
| TR1 | A member with no `routingTier`, a `vi.fn` thunk | `check` `{ ok: true }`; `resolve` `{ ok: true, selection: null }`; the thunk never called. |
| TR2 | `check(MEMBER)` | `{ ok: true }`; calls exactly `['credentials', 'models']`. |
| TR3 | `resolve(MEMBER)`; `resolve({ ...MEMBER, model: 'openrouter/' + NITRO, effort: null, routingTier: 'nitro' })` | Both `{ ok: true, selection: <the fake's value> }`; requests exactly `{ model: SLUG, tier: 'balanced', effort: 'low', credentialProfileId: C, profile: 'helper' }` and `{ model: SLUG, tier: 'nitro', effort: null, credentialProfileId: C, profile: 'helper' }`; calls `credentials, models, resolveLaunch` twice. |
| TR4 | Thunk `null`; thunk throws; `credentials()` throws; `models()` throws | `check` and `resolve` both `{ ok: false, reason: UNAVAILABLE }` each time; `resolveLaunch` never called. |
| TR5 | A Codex subscription member, an unlisted credential `D`, `model: 'z-ai/glm-5.3'`, each with a tier | `check` and `resolve` refuse with exactly `notOpencode`, `credentialRefused`, `unknownModel`; `resolveLaunch` never called. |
| TR6 | `resolveLaunch` throws `RoutingError` `NO_SNAPSHOT`; `SNAPSHOT_STALE` with settings 45; `SNAPSHOT_STALE` with `getSettings` throwing; `TIER_EMPTY`; `OPERATION_FAILED` `Routing has stopped.` | `Balanced routing refused this helper attempt: no endpoint numbers are stored for deepseek/deepseek-v4.1-flash. Refresh them in Settings → Model routing, then revise the task.` (0 settings reads); the stale text with `45` (1 read); `Balanced routing could not be resolved for this helper attempt: The endpoint snapshot for this model is more than 60 minutes old. Refresh first.` (1 read); `Balanced routing refused this helper attempt: no endpoint for deepseek/deepseek-v4.1-flash meets the Balanced rules right now. Revise the task to a helper on another tier, or refresh later.` (0 reads); `Balanced routing could not be resolved for this helper attempt: Routing has stopped.` |
| TR7 | `resolveLaunch` throws a plain `Error('C:\\secret\\path exploded')` | `{ ok: false, reason: 'Balanced routing could not be resolved for this helper attempt: Routing operation failed.' }`. |
| TR8 | A thunk over a variable: null, then the fake, then null | `resolve` unavailable, then `{ ok: true, selection }`, then `check` unavailable (the thunk is read on every call). |

`TeamService`, `TeamStorage` and the wiring have no vitest test (they need Electron's `better-sqlite3`); every rule they apply is either pure (ImplementationSpec-4b-1's tables), the port (Table TR), or proven by the harness (T1–T15). Review must check the call order against this specification.

## Invariants

- No helper decrypts before its routing resolves; a refused routed attempt decrypts nothing, spawns nothing, records no selection and consumes one attempt (MR-D32, K8).
- A routed attempt records exactly the selection it sends, before the decrypt, once; nothing ever changes or drops it; no member or run carries a selection (K9).
- An unrouted member never touches the port, and its request is byte-identical to today's (C9).
- A tier main cannot serve refuses the launch before anything is stored, with a stated reason; a missing port means unavailable, never unrouted (C8).
- A routed provider error names its tier; Chorus never switches a tier, triggers a refresh or retries on its own (K12).
- The port never decrypts, never sends a request and calls only its four `RoutingService` methods; no secret reaches a row, an event, a blocker, a log or the harness output (MR-G4).
- No migration, no IPC channel, no preload change (K16, MR-G6).

## Verification

```powershell
npm run typecheck
npx vitest run src/main/services/teamRouting.test.ts src/main/routing/helperRoutingCore.test.ts src/shared/team.test.ts src/main/services/routingService.test.ts src/main/adapters/helpers/helpers.test.ts src/main/services/teamCore.test.ts src/main/services/teamIpc.test.ts
npm test
node scripts/verify-routing-ranker.mjs
node scripts/verify-routing-team.mjs
node scripts/verify-team-storage.mjs
$env:OPENCODE_DISABLE_AUTOUPDATE = 'true'; opencode --version
node scripts/verify-routing-body.mjs
npx electron-vite build
node scripts/verify-routing-ipc.mjs
npm run grep:secrets
git diff --check
git diff --stat -- src/main/services/teamService.ts src/main/services/teamStorage.ts src/main/services/teamRuntime.ts src/main/index.ts
git ls-files --eol -- src/main/services/teamService.ts src/main/services/teamStorage.ts src/main/services/teamRuntime.ts src/main/index.ts
git status --short
```

The harness ends `PASS (16 checks)`, exit 0, and leaves no `%TEMP%\chorus-routing-team-*` and no `_verify/routing-team-*.cjs`; paste its whole output. `verify-team-storage.mjs` prints a report with `"passed": true` and exits 0 (it exercises `TeamService` without routing, so it is the regression check for unrouted Team flows; it leaves `%TEMP%\chorus-team-storage-*` behind, pre-existing behaviour). The body script ends `PASS (18 checks)` (MR-G2, re-run because this task passes the selection into the builder). The IPC drive ends `PASS (20 checks)` (unchanged; it proves the built app boots with the `index.ts` thunk). `npm run grep:secrets` runs after the drives deleted their bundles. All four edited files still report `w/crlf` with the byte counts above. Never point a check at `%APPDATA%\chorus*` or port 9222, and never stop `electron.exe` or `Chorus.exe` by name: the installed Chorus is running. Record actual exit codes, the vitest summary and the harness output.
