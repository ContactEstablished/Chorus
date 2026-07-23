# Task 3-3 — `AgentAdapter` Interface + Capabilities + Launch-Path Refactor

_Third task of Phase 3 (Foundation). Windows-only. **Two commits this session (D36, ratified 2026-07-23)**: a flagged chore commit closing three small 3-2-review hardenings first, then the task commit. This task governs scope; `ImplementationSpec-3-3.md` governs exact contents — and per **D34**, that spec is the **normative interface text**. The CR-3.1 findings' verbatim TypeScript is a strong draft that **does not compile as written**; where they differ, the spec wins._

## Source Of Truth

- `docs/Features/Foundation/Tasks/Phase-3-Overview.md` — the phase contract, cross-cutting rules, gates, file-ownership matrix.
- Roadmap §6 **D34** (the adapter interface contract: council unanimous on Q1–Q5, plus coordinator resolutions (a)–(f)) and `CouncilBriefs/CouncilBrief-3.1-AdapterInterface-Findings.md`. **Read both; obey D34.** Four of the six resolutions exist because the findings contradicted themselves or violated a process boundary.
- Roadmap §6 **D33** for the seam facts folded into the CR-3.1 brief before it ran: allow-list env, adapter-declared env vars, the `env_var_name` placement question, secret-distinguishable launch payloads, optional credential in `buildLaunch`.
- `docs/PLAN.md` §4 (Adapter Abstraction — `AgentAdapter`, `AgentCapabilities`).
- `CLAUDE.md` — D1 Zod-in-main; D4 verify CLI flags against `--help` at execution.
- Precedent for a behavior-neutral refactor: **Task 1-2** (Drizzle migration, "zero visual change") and the D10 rekey landed as "a verified standalone refactor" inside Task 1-4.

## Initial Starting Point

**Verified 2026-07-22 against commit `fb3201e`.**

- **Baseline:** typecheck 0 · `npx vitest run` **160/160 across 8 files** · `npm run grep:secrets` clean. Task 3-2's vault has landed by the time this runs; its channels are not consumed here.
- **`src/main/services/cliDetect.ts`** exports:
  - `interface ResolvedCli { file: string; args: string[]; path: string }`
  - `resolveCli(name: string): ResolvedCli` — **synchronous** (`execFileSync('where.exe', [name])`), throws with a user-facing message when nothing spawnable is found. `pickSpawnable` prefers a real `.exe`; otherwise `.cmd`/`.bat` become `{file: 'cmd.exe', args: ['/c', shim]}`.
  - `DETECTED_TOOLS = ['claude', 'codex', 'git', 'docker', 'node'] as const`
  - `detectOne(name)` (module-private) — `where.exe`, then `<tool> --version` with a 10 s timeout and `windowsHide`, first line only, `'unknown'` when the probe fails.
  - `detectClis(): Promise<DetectedCli[]>` — memoized in a module-level `detection` promise; runs once per app launch.
- **`SessionManager.spawn(agent, cwd, sessionId)`** (private) currently does exactly this and nothing else of substance:
  ```ts
  const cli = resolveCli(agent)
  const child = pty.spawn(cli.file, cli.args, {
    name: 'xterm-256color', cols: 80, rows: 24, cwd,
    env: process.env as Record<string, string>, useConpty: true
  })
  ```
  then wires `onData` (ring-buffer append **then** listener broadcast) and `onExit`. **`launch()` is synchronous** and returns a snapshot synchronously — so anything `spawn` calls must stay synchronous too.
- **Neither agent currently receives any argv beyond the shim mechanics.** `claude` resolves to a real `.exe` (args `[]`); `codex` is an npm `.cmd` shim (args `['/c', <shim path>]`). A behavior-neutral refactor must reproduce **exactly** this, including the `cmd.exe` indirection.
- **`agentKindSchema = z.enum(['claude','codex'])`** in `src/shared/ipc.ts`, threaded through `attachRequestSchema`, `launchRequestSchema`, `sessions.agent`, and the renderer.
- **`src/main/ipc.ts`'s `session:restart` handler** calls `agentKindSchema.parse(row.agent)` — a **throw** on an unknown persisted agent. D34(c) replaces this.
- **`detectedCliSchema`** is `{name, found, path: nullable, version: nullable}`; `cli:detect` returns `cliDetectResponseSchema` = an array of it. The handler is a one-liner delegating to `detectClis()`.
- **`LaunchDialog.vue`** hardcodes `const labels: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex' }` and `const AGENT_KINDS: AgentKind[] = ['claude', 'codex']`, and builds its cards by mapping `AGENT_KINDS` against the `cli:detect` results. These are D34(f)'s target.
- **Installed CLIs (D4 baseline, re-verify at execution):** `claude.exe` 2.1.215 (currently **unauthenticated** — token expired), `codex-cli` 0.144.6 via npm `.cmd` shim.

## Goal

Put a real interface between Chorus and the two agent CLIs, and change **nothing** a user can observe.

Today the coupling is a string: `resolveCli(agent)` takes `'claude' | 'codex'` and the knowledge of what those mean is spread across `cliDetect.ts`, `SessionManager.spawn`, and two hardcoded constants in a Vue component. Phases 3a, 3b, 4, and 6 all build on this seam — effort normalization, api-mode council members, hook injection, MCP config writing — so its shape is the most expensive thing in the phase to get wrong, which is why it went to council.

The refactor is judged on two things that pull in opposite directions:

1. **Behavior neutrality.** Both agents launch, attach, restart, and restore exactly as before. The 160-test baseline stays green. The `cli:detect` response reports the same installation facts. Nothing about how a session runs changes — this task moves knowledge, it does not use it.
2. **Type honesty** (D34's whole reason for existing). "Supported" and "implemented" must become the same fact. An adapter that declares `mcp: null` must not have a `writeMcpConfig` a caller could reach; an API adapter must not be forced to carry `buildLaunch`. Capability *booleans* that a caller has to trust separately from method presence are exactly what the council rejected.

## Exact Scope

### Commit 1 — chore (D36: F24 + F-4 + F-5b)

| File | Change |
|---|---|
| `src/main/services/logger.ts` | **F24:** add a `serializers: { err }` entry to the pino options — wrap `pino.stdSerializers.err`, then apply `scrubSecrets` to the serialized `message` and `stack` (D4-verify the serializer signature against the installed pino 10.3.1 typings). Export the wrapped serializer function so it is unit-testable directly. |
| `src/main/services/logger.test.ts` | Cases: an `Error` whose message and stack carry a key-shaped string serializes with both **scrubbed**; an ordinary Error passes through byte-identical. |
| `src/main/services/vault.ts` | **F-4:** in `replaceProfile`, after loading the row, run the same provider-scoped `getCredentialProfileByFingerprint` check `createProfile` uses — refuse `duplicate` when a **different** profile (`existing.id !== id`) on the same provider already holds the new key. **A same-key replace of the profile's own row must still succeed** (legitimate rotation/re-encrypt path). |
| `src/shared/ipc.ts` | **F-5b:** `credentialProfileMetaSchema` gains `.strict()` — a handler leaking an unprojected row now **throws** the outbound parse instead of silently stripping. |
| `src/shared/ipc.test.ts` | Flip the shipped clause-3 test: parsing an object carrying the two digest fields now **throws** (that is the point); the happy-path parse of a clean meta object still passes. |

Chore verification: `npm run typecheck` + `npx vitest run` + `npm run grep:secrets` green, plus a CDP runtime proof of F-4 (create two profiles on one provider, replace B with A's key → refused with the `duplicate` label message; replace B with B's own key → succeeds).

### Commit 2 — task (the adapter refactor)

| File | Change |
|---|---|
| `src/main/adapters/types.ts` | **Create.** The normative interface — core, PTY/API union, capability descriptors, launch seam, credential seam, extension interfaces, errors. **Types only, no runtime behavior** beyond type guards. |
| `src/main/adapters/capabilities.ts` | **Create.** `mergeCapabilities(base, detected)` and the shared descriptor defaults. |
| `src/main/adapters/claude.ts` | **Create.** The `claude` `PtyAgentAdapter`. |
| `src/main/adapters/codex.ts` | **Create.** The `codex` `PtyAgentAdapter`. |
| `src/main/adapters/registry.ts` | **Create.** `staticRegistry: Record<AgentKind, AgentAdapter>`, `getAdapter`, `getAdapterOrThrow`, `UnknownAgentError`. |
| `src/main/adapters/adapters.test.ts` | **Create.** Unit tests over `buildLaunch`, `mergeCapabilities`, the registry, and the guards. |
| `src/main/services/cliDetect.ts` | **Edit.** Agent entries route through `adapter.detectInstallation()`; git/docker/node stay on the existing probe. `resolveCli` stays exported (the adapters call it). |
| `src/main/services/sessionManager.ts` | **Edit.** `spawn` consumes a `PtyLaunchRequest` from the adapter instead of calling `resolveCli` itself. **No env policy change** — `process.env` still passes through untouched. |
| `src/shared/ipc.ts` | **Edit.** `detectedCliSchema` grows `displayName` and `agentKind` (D34f); new `adapter:list` channel + schemas. |
| `src/main/ipc.ts` | **Edit.** `cli:detect` supplies the new fields; `adapter:list` handler; `session:restart`'s `agentKindSchema.parse(row.agent)` becomes a registry lookup returning an inline refusal (D34c). |
| `src/preload/index.ts` | **Edit.** One forwarder for `adapter:list`. |
| `src/renderer/src/components/LaunchDialog.vue` | **Edit.** Delete `labels` and `AGENT_KINDS`; build cards from the wire data. |
| `src/shared/ipc.test.ts` | **Edit.** Cases for the widened detect schema and `adapter:list`. |
| `docs/Features/Foundation/AdapterAuthoring.md` | **Create.** CR-3.1 action item 12 — the narrowing idiom, the guards, one worked example. |

Nothing else. If a change seems to require another file, raise it.

## Non-Goals

- **No behavior change of any kind.** Not a "small improvement", not a better error message, not a tidier argv. If the refactor tempts you to fix something, write it down and raise it instead — a behavior change hidden inside a behavior-neutral refactor is unreviewable.
- **No env policy change.** `SessionManager` still passes `process.env` through wholesale. The allow-list, `secretEnv`, and `requiredEnvVars` are **declared** by the interface and **unused** this task. D5 stands until Task 3-6.
- **No credential involvement.** `PtyLaunchSpec.credential` is declared and always `undefined` this task. Do not import the vault.
- **No `SessionManager` PTY/API session split.** D34 Q2 puts that boundary at the session level eventually; **Phase 3 restructures only the adapter side.**
- **No `ApiAgentAdapter` instances.** The type is declared; nothing implements it; no runtime code references it.
- **No `detectState`, no `OutputInterpreter`, no `SupportsStateDetection`** — **struck by D34(a)**. The findings' verbatim TS declares them in contradiction of its own Q4 majority ruling. Do not resurrect them "since they're only types".
- **No `resumeSession`, no MCP writing, no hooks writing.** Extension interfaces may be **declared**; none is implemented.
- **No new agent kinds.** The wire vocabulary stays `'claude' | 'codex'`.
- **No `AgentKind` derived from the registry.** D34(b): `agentKindSchema` in `src/shared/ipc.ts` stays the single wire authority. A main-process module is not importable from shared or renderer code.
- **No `AbortSignal` plumbing beyond the signature.** `detectInstallation(signal?)` accepts one; wiring cancellation through `detectClis`'s memoized promise is not this task's problem.
- **No `InstallationStatus.authenticated`.** An auth probe would run a real CLI command and break the behavior-neutral gate. Leave it unset.
- **Do not revert, stage, or commit unrelated or untracked files, including `_verify/` and anything under `docs/`.** (`AdapterAuthoring.md` is the one `docs/` file this task creates and commits.)
- **Do not remove the standing `wt-24b5c1fe` worktree row, directory, or branch.**

## Dependencies

- **Task 3-2** — landed, but **not consumed**. The dependency is ordering, not code: 3-3 must not be authored against a vault surface that 3-2 might have changed, and `ResolvedCredential` in the launch seam has to match what 3-6 will pass.
- No new npm dependency.

## Step-by-step Work

1. **`types.ts` first, and read it aloud before writing anything else.** Everything downstream is shaped by it. The spec's §2 is the normative text; transcribe it and resolve any place it disagrees with the findings **in the spec's favour**, noting the disagreement in the commit message.
2. **`capabilities.ts`** — `mergeCapabilities` with the null-vs-undefined rule (D34 risk 7: `null` from a probe is a real "determined absent" and overwrites the static default; `undefined` means "not probed" and preserves it).
3. **The two adapters.** Each declares its static capabilities honestly — **do not declare a capability neither CLI has been verified to have.** `buildLaunch` must reproduce today's spawn arguments exactly.
4. **`registry.ts`** — typed `Record<AgentKind, AgentAdapter>` via a **type-only** import of `AgentKind` from `src/shared/ipc` (D34b). This forces exhaustive coverage at compile time without a boundary violation.
5. **`cliDetect.ts`** — split the probe: agent names delegate to their adapter's `detectInstallation()`; git/docker/node keep `detectOne`. Preserve the memoization and the response shape for non-agents.
6. **`sessionManager.ts`** — `spawn` obtains a `PtyLaunchRequest` and spawns from it. Keep it synchronous. Keep `cols: 80, rows: 24` in `SessionManager` (D34d: geometry is session state, not adapter knowledge).
7. **The wire** — widen `detectedCliSchema`, add `adapter:list`, update the handlers, add the preload forwarder.
8. **`LaunchDialog.vue`** — delete the two constants; render from `agentKind`/`displayName`. The component gets **smaller**; if it grows, something has gone wrong.
9. **`AdapterAuthoring.md`**, then tests, then `npm run typecheck` / `npx vitest run` / `npm run grep:secrets`.
10. **Runtime-verify (G2)** the neutrality claim per Verification Commands — this is the whole gate for this task.

## Test Expectations

**Unit (Vitest), `src/main/adapters/adapters.test.ts`.** The adapters import `cliDetect`, which imports `child_process` — fine under Vitest. They must **not** import `electron`; if one does, the layering is wrong.

- **`buildLaunch` neutrality, per adapter:** given a spec with a fixed cwd and no credential, the returned `executable` and `args` **equal** what `resolveCli(<id>)` yields today. Write this as a comparison against `resolveCli` itself, not against a hardcoded string — a hardcoded expectation would pass on a machine where the CLI resolves differently and would silently encode this machine's install layout into the test suite.
- **`buildLaunch` contributes no environment this task:** `envAdditions` is empty and `secretEnv` is empty for a credential-free spec. This is the test that proves the non-goal.
- **`buildLaunch` with a credential** populates `secretEnv` under the resolved env var name and leaves `envAdditions` free of it — declared behavior, exercised now so 3-6 inherits a tested seam. The credential value in this test is an obvious fake short enough not to trip `grep:secrets`.
- **`mergeCapabilities`:** `undefined` detected → base unchanged (identity); a partial with one defined field → only that field overridden; **an explicit `null` overrides a non-null base** (D34 risk 7 — the null-vs-undefined distinction is meaningful and this is its test); an empty object → identity.
- **Registry:** every `agentKindSchema` option resolves to an adapter (iterate the enum's options, do not hardcode two names — this is what makes the test survive Phase 3a); `getAdapter('nope')` is `undefined`; `getAdapterOrThrow('nope')` throws `UnknownAgentError` whose message names the id.
- **Guards:** `isPtyAdapter` is true for both shipped adapters; `supportsMcp`/`supportsHooks`/`supportsResume` are **false** for both (nothing implements them in Phase 3), and that falseness is asserted explicitly so a future adapter that declares a descriptor without implementing the method fails here.
- **Capability honesty:** for each adapter, every non-null descriptor has a corresponding implemented method, checked generically rather than per-adapter.

**Unit (Vitest), `src/shared/ipc.test.ts`:**

- `detectedCliSchema` accepts a non-agent row (`agentKind: null`, `displayName: null`) and an agent row; **rejects** a row missing `agentKind` (required-nullable, not optional — the 1b-1 discipline).
- `adapterListResponseSchema` round-trips a realistic adapter descriptor payload.

**Runtime (G2)** carries the neutrality proof. Unit tests can show `buildLaunch` returns the right strings; only running the app shows that both TUIs still work.

## Verification Commands

Run from repo root (PowerShell):

```
npm run typecheck
```

```
npx vitest run
```

```
npm run grep:secrets
```

```
npm run dev
```

**The neutrality proof is this task's acceptance, and it must be a comparison, not an assertion.** Before touching any code, capture a baseline; after the refactor, capture the same things and diff them:

1. **`cli:detect` response** — dump the full JSON before and after. After the change it gains `displayName` and `agentKind`; **every pre-existing field must be byte-identical** for all five tools, including the `version` strings and the resolved `path` values.
2. **Both agents launch** — Claude Code and Codex, side by side, in the real window. Both TUIs paint. (Claude is unauthenticated on this machine; its expired-token screen is a perfectly good "the process started and rendered" signal — say so explicitly rather than reporting it as a failure.)
3. **Attach, restart, restore, and close** each still work: restart a killed pane; tree-kill the app and cold-boot to prove the D16 restore path relaunches into the same layout; close a pane and confirm the row is deleted.
4. **The spawned process tree is identical in shape.** Capture `Get-CimInstance Win32_Process` for the electron main's descendants before and after, and compare the **command lines** of the agent processes. This is the check that catches an adapter that "works" but has quietly changed how `cmd.exe /c` wraps the Codex shim.
5. **Unknown-agent path (D34c)** — hand-edit a session row's `agent` to a bogus value, then cold-boot **and** attempt a restart on it. Expected: the restore engine's spawn-failure path heals it to `exited` with a pino-logged reason, `session:restart` returns an inline `{ok:false}`, and **the app does not crash and no other session is affected**. Restore the row afterwards.

**⚠ The `sqlite3` CLI is NOT installed.** Use the `ELECTRON_RUN_AS_NODE` dump-script pattern (`_verify/2-1-dump.js`); write results to a file; **known flake: no file on first invocation, retry once**; **quote the `projects` table** in every dump (F20).

**Harness reminders:** electron-vite does **not** hot-restart the main process — every adapter/spawn check needs a real tree-kill cold boot. Kill process **trees** (`taskkill /PID <root> /T /F`); graceful-quit test is `taskkill` **without** `/F`. Orphan checks walk the electron main PID's descendant tree, never `tasklist` name-matching (~16 unrelated `claude.exe` on this machine).

**D4 obligation:** before hardcoding anything into an adapter — an argv flag, an env var name, a config path — verify it against the installed CLI's own `--help`/docs in this session and report what you ran. This task should need almost none of that (neither agent gets flags today); the obligation is stated so that "almost none" is a finding rather than an assumption.

## Acceptance Criteria

- [ ] `npm run typecheck` — zero errors (G1).
- [ ] `npx vitest run` — green, the **160**-test baseline intact and grown by the adapter cases.
- [ ] `npm run grep:secrets` — clean (G4).
- [ ] **Behavior-neutral, proven by diff:** the `cli:detect` response is byte-identical on every pre-existing field; the agent processes' command lines are identical before and after; both TUIs launch, attach, restart, restore, and close as before.
- [ ] **The interface matches `ImplementationSpec-3-3.md` §2 exactly** in shape. Any deviation is flagged in the commit message with its reason — this text is normative under D34, so a silent deviation is a contract breach, not a style choice.
- [ ] **`SupportsStateDetection` and `OutputInterpreter` do not appear anywhere** in the codebase (grep-verified) — D34(a).
- [ ] **`AgentKind` still derives from `agentKindSchema`** in `src/shared/ipc.ts`; the registry is typed `Record<AgentKind, AgentAdapter>` via a type-only import; **no shared or renderer file imports anything under `src/main/`** (grep-verified).
- [ ] **`buildLaunch` is synchronous** and `SessionManager.launch()` remains synchronous.
- [ ] **`cols`/`rows` are still owned by `SessionManager`** and appear nowhere in the adapter types (D34d).
- [ ] **Main still owns env policy:** `PtyLaunchRequest` carries no full environment; `SessionManager` still passes `process.env` through unchanged; `requiredEnvVars`/`secretEnv` exist and have zero effect this task.
- [ ] **Unknown-agent rows degrade, never crash** (D34c): the D16 heal path handles them at restore, `session:restart` returns an inline refusal, and a bogus row does not affect any other session — runtime-proven.
- [ ] **`LaunchDialog.vue` no longer contains `labels` or `AGENT_KINDS`** (grep-verified) and renders agents from adapter-supplied display data.
- [ ] `docs/Features/Foundation/AdapterAuthoring.md` exists, shows the narrowing idiom, and its worked example compiles against the shipped types.
- [ ] **One** narrated commit (G3), touching only the Exact Scope files.
- [ ] The standing `wt-24b5c1fe` worktree row, directory, and branch are **untouched**.

## Review Checklist

- [ ] **Read the interface against D34 clause by clause**, not against the findings' code block. Four resolutions patch that code block; a faithful transcription of the findings is a *defect* here.
- [ ] The type guards **compile and are used** — the findings' versions reference `a.capabilities` as a property while the core declares `getCapabilities()` as a method. The spec picks one shape; confirm the guards follow it rather than being copied verbatim and cast into silence.
- [ ] No `as any`, no `@ts-expect-error`, and no `as unknown as` anywhere in `src/main/adapters/`. The entire point of D34 Q1 was to make the compiler the enforcement mechanism; a cast is a hole in it.
- [ ] `buildLaunch`'s output was compared against `resolveCli` **by running both**, not by reading them.
- [ ] The Codex `cmd.exe /c <shim>` indirection survives intact — this is the single most likely place for a silent behavior change.
- [ ] `mergeCapabilities` distinguishes `null` from `undefined`, and the test proves it rather than asserting a shape.
- [ ] Nothing in this task reads or writes a credential, touches `vault.ts`, or changes what environment a child process receives.
- [ ] The `adapter:list` response carries **no** installation state (that is `cli:detect`'s job) and no secret-adjacent field.
- [ ] `AdapterAuthoring.md` is honest about what is declared-but-unimplemented, so the next author does not implement against a fiction.
- [ ] No untracked / `_verify/` / `docs/` files staged or reverted beyond `AdapterAuthoring.md`.
