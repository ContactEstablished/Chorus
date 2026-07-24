# Task 3-6: BYOK Env Injection + Test-Key — Execution Prompt

## Role

You are the Coordinator for Chorus — Foundation Phase 3, Task 3-6 (BYOK Env Injection + Test-Key).

Repo root: `C:\Projects\ContactEstablished\Chorus`

Expected branch: `main` — confirm with `git branch --show-current`; do NOT switch or create branches without instruction.

Expected HEAD at start: `f13e771`

Platform: Windows 11, PowerShell 7

Chorus is a local-first BYOK Electron + Vue 3 + TypeScript desktop app for running multiple AI coding agents in parallel terminal panes.

## Goal

Task 3-6 is the **SIXTH AND FINAL task of Phase 3** and closes the phase milestone.

Make an agent run on a key the user gave Chorus, and prove the key exists in exactly ONE place a process can see it — the child PTY's environment block — and nowhere else Chorus controls.

This task supersedes decision D5 ("child PTYs inherit env untouched; no credentials injected/logged anywhere"), which has stood since Phase 0.

**PRIME DIRECTIVE:** a key never reaches a command line, a log file, a transcript, the renderer, or disk in plaintext.

The feature is small; **THE PROOF IS THE TASK**. The phase milestone is written as an **INSPECTION**, not a behaviour.

### Two Commits in This Session

This session makes TWO commits (gate G3 amended for this session only by decision D46):

1. **COMMIT 1** = a flagged, BEHAVIOUR-NEUTRAL chore: make the ingest-scrub seam session-shaped instead of PTY-shaped.
2. **COMMIT 2** = the BYOK task itself.

## Ground Yourself First

Read these before editing anything. All paths are relative to repo root:

- `CLAUDE.md` (locked architecture rules)
- `docs/Features/Foundation/roadmap.md` — sections 5 (Verified Ground Facts), 6 (Decisions D28–D46 and Gates G1–G5), 7 (Phases)
- `docs/Features/Foundation/Tasks/Phase-3-Overview.md` (phase contract, file-ownership matrix, cross-cutting rules, phase non-goals)
- `docs/Features/Foundation/Tasks/Task-3-6.md` (GOVERNS SCOPE)
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3-6.md` (GOVERNS EXACT CONTENTS — section 0 is the Commit 1 chore)
- `docs/Features/Foundation/CouncilBriefs/CouncilBrief-3.0-Vault-Findings.md` (action items 5, 6, 10, 11; risks 1, 2, 3; the Q6 fallback)

### Code to Inspect

Anchor to **NAMED SYMBOLS**, never line numbers. Line numbers below are orientation only, current as of `f13e771`:

- `src/main/services/sessionManager.ts` — `SessionManager.spawn` (~line 306) inlines the whole output pipeline: `createScrubber`, the `emit` helper (ring-buffer append + trim + broadcast), the `child.onData` clear-push-reschedule block, the `child.onExit` flush. Also `launch(agent, cwd, sessionId, secrets = [])` (~124), `restore(projectId)` (~159), `dispose()` (~283), constants `BUFFER_MAX_CHARS = 4_000_000` and `SCRUB_FLUSH_MS = 50`.
- `src/main/services/scrubber.ts` — `createScrubber(secrets)`, `CREDENTIAL_PLACEHOLDER = '[REDACTED-CREDENTIAL]'`, `push`/`flush`/`pendingLength`. Pure: no RegExp, no timers, no electron, no node-pty. **DO NOT CHANGE ITS ALGORITHM.**
- `src/main/adapters/types.ts` — `PtyAgentAdapter`, `PtyLaunchSpec`, `PtyLaunchRequest`, `ResolvedCredential`, `AuthMethodDefinition`, `AgentCapabilities`.
- `src/main/adapters/claude.ts`, `src/main/adapters/codex.ts`, `src/main/adapters/registry.ts` (frozen two-entry registry: `claude`, `codex`).
- `src/main/ipc.ts` — the four `sessions.launch(` call sites (~302, ~340, ~359, ~443), all currently passing THREE arguments.
- `src/main/services/vault.ts` — `decryptForLaunch(id)` (async, ZERO callers today), `markCredentialVerified` (zero callers today).
- `src/shared/ipc.ts` — `agentKindSchema` (two-value enum), `launchRequestSchema`, `sessionInfoSchema`.

### Git Checks to Run First

```
git branch --show-current
git status --porcelain
git log --oneline -3
```

### Decisions You Must Honour — all RESOLVED, quoted with dates

Do not relitigate these. Where a council findings document and a ratified decision disagree, **the decision wins** — several resolutions exist precisely because the filed findings contradicted themselves.

- **D4** (locked in `CLAUDE.md`) — verify CLI flags and env-var names against the tool's own `--help`/docs **at execution time**, never from training-data memory. This binds harder in this task than anywhere else in the phase.
- **D5** (2026-07-18) — *"child PTYs inherit env untouched; no credentials injected/logged anywhere."* **THIS TASK SUPERSEDES IT.** The comment stating it has sat in `sessionManager.ts` since Phase 0; replace it with the new contract and say so in the commit message.
- **D33** (2026-07-22) — the vault security contract. **Clause 5:** the child's environment block is the injection surface, and same-user process inspection is the documented, unavoidable limit. **Resolution (a):** exact-match scrubbing REQUIRES retaining the injected plaintext for the session's lifetime — a NAMED LIMIT, main memory only, never persisted, cleared on session end. **Resolution (c):** the constructed allow-list applies **ONLY** to credential-bearing launches; a no-credential launch inherits `process.env` wholesale, exactly as today. **Resolution (d):** the honest guarantee gains a Test-key carve-out — *"at your request"* is load-bearing.
- **D34** (2026-07-22) — the `AgentAdapter` contract. **Resolution (d):** env policy has **ONE owner — main**; the adapter only declares what it needs added. **Resolution (e):** a provider's `env_var_name` **overrides** the adapter's `AuthMethodDefinition.requiredEnvVar` default.
- **D40** (2026-07-24) — Task 3-5's code landed inside docs commit `d3b6f30`, narrated by the fileless anchor `ddb5454`; content is byte-identical to the verified state. **Standing rule it created: never `git add -A` while a session's verification is still open — stage scope files explicitly, and never push a task's code before its runtime pass concludes.**
- **D42** (2026-07-24) — OpenRouter is Chorus's single gateway; LiteLLM is dropped. Token attribution keys on `AuthMethodDefinition.type`, not on the gateway.
- **D43** (2026-07-24) — the launchable unit is **(agent × route × model)**. Subscription routes are first-class `provider_configs` rows with **ZERO** credential profiles. Originated Step 1c, which **D47 later upgraded from a verification exercise into build-and-prove work**.
- **D47** (2026-07-24) — Task 3-6 builds and proves the **OpenRouter route** as its BYOK vehicle, so the phase milestone closes on a real end-to-end proof rather than dormant machinery. **No new adapter is required**: codex supports `[model_providers.<name>]` with `base_url`, `wire_api` and — critically — **`env_key`, the NAME of the environment variable Codex reads at runtime for the bearer token**, which is exactly Chorus's injection mechanism. Because no new agent kind is involved, Phase 3's "no new agent kinds" non-goal and D34 Q5's frozen registry both still hold **unamended**. Consistent with D44: this is codex *the binary* driving a non-GPT model, not GPT on per-token billing.
- **D44** (2026-07-24) — **Claude Code, Codex and Kimi CLI are SUBSCRIPTION-ONLY by product policy**; per-token BYOK targets everything else, reached via OpenRouter. **⚠ CAPABILITY IS NOT POLICY:** do **NOT** set `apiKey: false` on the claude/codex adapters. Keep their `getAuthMethods()`/`getCapabilities()` declarations honest about what the binary *can* accept; the policy lives at the route level, where a `provider_config` for Anthropic-direct simply never gets created. Collapsing the two would both lie about the binary and block the BYOK vehicle.
- **D45** (2026-07-24) — both pane types eventually, agent-CLI first. Mitigation (1) is the single ingest-scrub seam (Commit 1). Mitigation (4) is a **HARD SEQUENCING RULE: no api-mode work before this task lands.**
- **D46** (2026-07-24) — the seam refactor is Commit 1 of this task; gate G3 is amended for this session only.
- **F26** (2026-07-24) — the restore gap, reproduced on the real dev DB. Step 7 settles it.

## Pre-Existing Changes — Do Not Touch

The working tree contains exactly one untracked file: `TASK-3-5-REVIEW-FABLE.md` (a review artifact at repo root).

**Do NOT** revert, stage, or commit it.

Also **never** stage or revert anything under `_verify/` (untracked harness artifacts, gitignored) or anything under `docs/` unless a step explicitly says so.

## Implementation Scope

### Commit 1 (Chore, Decision D46) — The Session-Shaped Ingest-Scrub Seam

**Behaviour-neutral.** Extract the inlined output pipeline into a `SessionOutput` owning scrubber, carry-flush timer, ring buffer and broadcast.

**Files:**
- CREATE `src/main/services/sessionOutput.ts`
- CREATE `src/main/services/sessionOutput.test.ts`
- EDIT `src/main/services/sessionManager.ts`

**What:**

Extract the inlined output pipeline into a `SessionOutput` owning scrubber, carry-flush timer, ring buffer and broadcast, exposing `ingest(text)` / `flush()` / `buffer` / `dispose()`.

It must import **NEITHER** `node-pty` **NOR** `electron`.

Factory signature: `createSessionOutput({ secrets, maxChars, flushMs, onText })`.

`SessionManager.spawn` then wires `child.onData -> output.ingest(data)` and `child.onExit -> output.flush()` **THEN** notify listeners.

`PtySession.buffer`/`scrubber`/`scrubTimer` collapse into one `output: SessionOutput`; `snapshot()` reads `session.output.buffer`.

**KEEP** `status`/`exitCode` on the session (lifecycle, not output).

**MOVE, DO NOT REWRITE** — the existing code is already correct and was runtime-proven on 2026-07-24.

#### Five Invariants That Must Survive

Each is load-bearing, not stylistic:

1. **ONE** `scrubber.push()` per chunk, its single result used for **BOTH** the buffer append and the broadcast. Two calls advance the carry twice and corrupt the stream.
2. Clear timer → push → reschedule, in that order, so a pending flush can never overtake an already-arrived chunk.
3. Flush **BEFORE** notifying exit, so the renderer receives final bytes ahead of the exit event.
4. Timer cleared on exit **AND** in `dispose()` (a leaked timer holds a closure over the secret match set).
5. The closure **IS** the match-set storage (decision D33 resolution (a)) — introduce no separate structure.

#### Construction Timing

Construction of the `SessionOutput` must stay in the **SAME synchronous block** as `pty.spawn` and the `onData` wiring — one tick later and the first chunk is lost or unscrubbed.

#### Tests

- `flushMs` injectable so fake timers work.
- Cover: one-push-per-chunk; ordering when a chunk arrives with a flush pending; flush-before-exit; `dispose()` clearing a pending timer; ring-buffer trim applied to SCRUBBED text; identity fast path (no secrets → input passes through untouched).

#### Proof Obligation for Commit 1

The 19 existing scrubber unit tests pass **UNCHANGED**, and Task 3-5's runtime items 1–4 are re-driven against the refactored seam **BEFORE** Commit 2 begins.

---

### Commit 2 (The Task) — Files and Changes

- **CREATE** `src/main/adapters/env.ts`: `BASELINE_ENV_VARS` (start from EXACTLY these seven: `PATH`, `SystemRoot`, `TEMP`, `TMP`, `HOMEDRIVE`, `HOMEPATH`, `USERPROFILE`) and the pure `composeChildEnv(input)` taking `parentEnv` as a PARAMETER. Policy: if `secretEnv` is **EMPTY** → return `{...parentEnv}` unchanged (inherit wholesale); otherwise build a constructed allow-list from BASELINE + adapter `requiredEnvVars`, skipping absent vars (never emit `undefined`), then `envAdditions`, then `secretEnv` **LAST** so an injected credential always wins. Also the pure `resolveEnvVarName(providerOverride, adapterDefault)` returning `providerOverride ?? adapterDefault`.
- **CREATE** `src/main/adapters/env.test.ts`.
- **EDIT** `src/main/adapters/claude.ts` and `codex.ts`: `requiredEnvVars` from D4-verified facts; `buildLaunch` fills `secretEnv` from `spec.credential`.
- **EDIT** `src/main/services/sessionManager.ts`: env composition; replace the D5 comment with the new contract.
- **EDIT** `src/main/ipc.ts`: launch resolves + decrypts the credential; the `credential:test` handler.
- **EDIT** `src/shared/ipc.ts`: `launchRequestSchema.credential_profile_id`; `credential:test` channel + schemas.
- **EDIT** `src/preload/index.ts`: one forwarder for `credential:test`.
- **EDIT** `src/main/services/storage.ts`: `markCredentialVerified` gets its one caller.
- **EDIT** `src/renderer/src/components/LaunchDialog.vue`: auth-method + credential-profile selection, DEFAULTING TO SUBSCRIPTION.
- **EDIT** `src/renderer/src/views/SettingsCredentials.vue`: the "Test key" button and result state.
- **EDIT** `src/renderer/src/stores/settings.ts`: the test action + verified-state refresh.
- **EDIT** `src/shared/ipc.test.ts`.

**Nothing else.** If a change seems to require another file, **RAISE IT** rather than doing it.

### Ordered Work Steps for Commit 2

> **⚠ READ THIS BEFORE OPENING `Task-3-6.md`: Steps 1a and 1b in that document are MOOT and must NOT be executed.**
>
> `Task-3-6.md` and `ImplementationSpec-3-6.md` section 3a describe two large, effortful investigations: **Step 1a** ("does an injected `ANTHROPIC_API_KEY` beat an existing OAuth/keychain login?") and **Step 1b** ("does Codex read `OPENAI_API_KEY` from its process environment at all?"). Both were written before **D44** (2026-07-24).
>
> **D44 makes them moot, not merely deferred.** Claude Code, Codex and Kimi CLI are subscription-only by product policy, so Chorus never injects a key into those CLIs *for those models*, and the precedence question therefore never arises. **Do not spend session time settling them.** The reasoning is retained in those documents as history, not as work.
>
> **What replaces them:** the BYOK vehicle is **codex pointed at OpenRouter** to drive a non-GPT model — the CLI and the model are separate axes (D43). **Step 1c is no longer a verification exercise; it is BUILD-AND-PROVE work (D47), and it is what closes the phase milestone.**

**Step 1 — D4 Verification, First and Reported**

Confirm every env-var name against the installed CLI's own `--help`/docs **IN THIS SESSION** and quote what you ran and what it said.

If a name cannot be confirmed, **DO NOT GUESS**: declare it `null`, refuse `api_key` auth for that adapter, raise it as a finding.

Also re-verify `codexAdapter`'s capability declarations against codex 0.145.0 and correct `skills: false` if a `/skills` surface is real.

**Step 1c — BUILD AND PROVE THE OPENROUTER ROUTE (Decision D47) — this closes the milestone**

This is the task's BYOK vehicle. Without it Phase 3 ships its whole BYOK stack unexercised, because D44 makes Claude and GPT subscription-only and there is nothing else to inject a key into.

**The mechanism — D4-verify against the installed codex 0.145.0 before relying on any of it.** Codex reads custom providers from `[model_providers.<name>]`:

- `base_url` = `https://openrouter.ai/api/v1` — **no trailing slash** (a trailing slash is a known failure mode)
- **`env_key`** = the **NAME** of the environment variable Codex reads **at runtime** for the bearer token. **This is why the route satisfies D33**: Codex wants to be told *which env var to read*, which is exactly what `composeChildEnv` produces and what `provider_configs.env_var_name` (D34(e)) stores.
- `wire_api` = `"chat"` — OpenRouter implements `/chat/completions`, not the newer `responses` endpoint
- possibly `requires_openai_auth = false` — OpenRouter keys use an `sk-or-` prefix Codex may otherwise validate

**Supply the provider block PER-LAUNCH via `-c` dotted-path overrides. Do NOT write the user's `~/.codex/config.toml`** — per-launch leaves nothing behind, and you must assert that file's mtime is unchanged across the whole session.

**⚠ THE `-c` ASYMMETRY IS THE TRAP:** `-c` is **argv**. A base URL, an env-var *name*, and a wire-api string there are all fine. **A key there is Non-Goal #1** and will look perfectly reasonable in a diff.

**The model id is ONE optional free-text input** on the launch dialog, shown only when an api-key provider is selected. Not a catalog, not a picker (Phase 3a owns those). Codex's default model is an OpenAI id OpenRouter will not resolve, so some value is required for the route to answer at all.

**REJECTED — do not attempt: Claude Code pointed at OpenRouter.** OpenRouter exposes only the OpenAI wire shape; Claude Code speaks the Anthropic Messages shape. No environment variable bridges a wire-format difference. This is architecturally impossible, not merely unverified.

**If the mechanism does not work as documented, that is a FINDING, not a licence to improvise.** Report it. Do NOT reach for `codex login --with-api-key`, a written config file, or a key on the command line — all three are the bright line in the Non-Goals below.

**Step 2 — `env.ts`, Pure and Unit-Tested**

**Step 3 — Adapters: `requiredEnvVars` and `secretEnv` from Step 1's Verified Facts**

**Step 4 — `SessionManager`: Compose the Child Env; Replace the D5 Comment**

**Step 5 — The Launch Path in `src/main/ipc.ts`**

Resolve the profile, resolve the env var name (provider override beats adapter default), decrypt, build, launch, drop.

**THE REFUSAL PATH MATTERS AS MUCH AS THE SUCCESS PATH**, and the refusal must happen **BEFORE** the session row is created (no orphan rows).

**Step 6 — The Allow-List Empirical Pass**

Launch **BOTH** agents with a credential and confirm they still work.

This is a **HARD step** — an allow-list that breaks an agent is a shipped bug.

Every entry added beyond the seven baseline vars must be documented with what broke without it.

If no enumerable list works, invoke the council's Q6 fallback (inherit `process.env` with known provider-key variables explicitly stripped) and flag it loudly as a contract deviation.

**Step 7 — Settle the Restore-Path Question (Roadmap Finding F26)**

`restore()` re-spawns from a `sessions` row that records `agent` and `cwd` but **NOT** which credential profile launched it, so a restored BYOK session gets no key and an empty scrubber match set.

This was reproduced on the REAL dev DB on 2026-07-24: a restored session emitting a planted value showed `valuePresent: TRUE` / `placeholderCount: 0` while a freshly-launched registered session in the same boot redacted it fully.

Two honest answers:

- **(a)** Persist the profile id and re-resolve at restore (needs a migration v6 this task's scope table does not contain, and means unattended decryption at boot).
- **(b)** Do **NOT** auto-restore credentialed sessions — leave honest exited chrome ("Relaunch to re-supply the credential").

**THE SPEC RECOMMENDS (b) FOR PHASE 3** on scope-honesty grounds.

**PICK ONE, IMPLEMENT IT, STATE THE REASONING.** Silence, or a keyless restore, is the one unacceptable outcome.

**Step 8 — Test-Key: ONE Live Call, User-Initiated Only, Sanitized Failures, `last_verified_at` Updated on Success**

**Step 9 — Launch Dialog: Auth Method and Credential Selection, Defaulting to Subscription**

A user with no profiles sees **NO change**.

**Step 10 — Tests, Then Typecheck / Vitest / Grep:Secrets**

**Step 11 — The Milestone Proof (Gate G2)**

## Strict Non-Goals

- **No key in argv, EVER**, under any circumstance — not for a quick test, not behind a flag. Process command lines are world-readable to the same user (`Get-CimInstance Win32_Process`).

- **Do NOT** pass a key through `codex -c key=value`. `-c` is a legitimate channel for **NON-SECRET** config (base URL, model) but it lands on the command line. This is the most dangerous trap because it reads as configuration.

- **Do NOT** invoke `codex login --with-api-key` on the user's behalf, and **DO NOT** write a decrypted key into `~/.codex/config.toml`, a `--settings` file, or an `apiKeyHelper` script. All of these persist a decrypted credential into another tool's on-disk store — a threat model decision D33 never reviewed. If you conclude one is necessary, that is a **COUNCIL REVIEW TRIGGER**: flag, brief, and PAUSE. Do not implement it and do not let it ride as a deviation.

- **Do NOT** reach for Claude Code's `--bare` flag as an auth switch: it also disables hooks, LSP, plugin sync, auto-memory and CLAUDE.md discovery.

- **No model catalog, no cached model list** (Phase 3a). The test-key probe is **ONE** live call returning ok/fail; if the natural probe endpoint lists models, **DISCARD** the list.

- **No new npm dependency.** Use Node's built-in `fetch`.

- **No effort normalization, no launch profiles, no `usage_records`** (all Phase 3a).

- **No retry, no backoff, no queue** on the probe. One request, short timeout, a result.

- **No automatic verification**: the probe runs **ONLY** when the user presses the button — never at launch, boot, on a timer, or on profile creation.

- **No api-mode execution**; `startApiSession` stays unimplemented; no `ApiSessionHandle` implementation; no `SessionManager` PTY/API session split. (Commit 1's refactor is **NOT** this split — it reshapes the existing PTY path only.)

- **No change to the scrubber's algorithm** — Task 3-5 owns it; this task only registers values with it.

- **No widening of what crosses IPC**: the launch payload gains a PROFILE ID, never a key. The test response is a boolean plus a sanitized message.

- **No new agent kinds**; the wire vocabulary stays `'claude' | 'codex'`.

- **Do not revert, stage, or commit** unrelated or untracked files, including `_verify/` and anything under `docs/`.

- **Do not remove** the standing `wt-24b5c1fe` worktree row, its directory, or branch `chorus/Chorus/24b5c1fe` — it is a regression fixture.

## Required Workflow

Work as coordinator.

For each commit:
1. Implement
2. Review the diff against the Implementation Spec
3. A code-quality pass
4. Resolve findings
5. Run the verification gates
6. Narrate the commit

**Two intentional narrated commits this session** (D46), **Commit 1 fully verified BEFORE Commit 2 begins**.

**Stage scope files EXPLICITLY by path** — never `git add -A` (decision D40's standing rule).

**Do NOT push and do NOT open a pull request** unless explicitly asked.

## Verification Commands

Runnable as written from repo root, PowerShell:

```powershell
npm run typecheck
```

```powershell
npx vitest run
```

```powershell
npm run grep:secrets
```

**Baseline to beat, coordinator-verified 2026-07-24 at `ddb5454`:**
- typecheck: 0 errors
- vitest: 254/254 across 12 files
- grep:secrets: reports "clean (6 patterns over src/, scripts/, _verify/, package.json, root configs)"

### Runtime Harness

Already in the repo, reuse it — do not reinvent:

```powershell
.\_verify\3-5\start-app.ps1 _verify\3-6\boot1.log
```

```powershell
.\_verify\3-5\kill-app.ps1
```

```powershell
node _verify\3-5\cdp35.js shot out.png
```

```powershell
node _verify\3-5\probe.js
```

`cdp35.js` supports `eval <file>`, `shot <png>`, `typefile <txt>`, `enter`, `watch <seconds> <json>`. `probe.js` reports **BOOLEANS AND COUNTS ONLY** and never the planted value itself. CDP runs on `--remote-debugging-port=9222`.

### Installed CLIs — re-verify at execution (D4)

`claude.exe` **2.1.218** and `codex-cli` **0.145.0** (an npm `.cmd` shim spawned through `cmd.exe /c`). **Both moved on 2026-07-24**, so every capability claim in `codexAdapter` — D4-verified against 0.144.6 — is now unverified. Notably 0.145.0 advertises a `/skills` surface while the adapter still declares `skills: false`.

Two facts already established against 0.145.0, to save you the rediscovery — **confirm, do not assume**: `codex -m, --model <MODEL>` accepts an arbitrary model id, and `codex -c key=value` overrides any `~/.codex/config.toml` value without writing the file (**but `-c` is argv, so it must never carry a key** — see Non-Goals). No base-URL variable appears in `claude --help` at all, so `ANTHROPIC_BASE_URL` **cannot** be D4-verified from `--help`; source it from official documentation or declare it `null` and defer the mapping.

### ⚠ Environment Provenance — finding F20, STANDING

**Execution sessions run with a REDIRECTED `AppData` but a real `C:\Projects`.** Filesystem and git evidence is trustworthy; **DATABASE evidence describes a DIFFERENT database.**

- The **real** dev DB has projects `985d547b-d152-4a07-9094-ddb8da56ef8f` (Chorus) and `f47ac10b-58cc-4372-a567-0e02b2c3d479` (Chorus-Second).
- A **redirected** session typically sees `a43b395d-51e2-47d3-8043-cb7b56094fca` and `b684e96e-2a50-409e-b6ce-0c3570142c31` instead.

**QUOTE THE `projects` TABLE IN EVERY DATABASE DUMP** so the coordinator can tell which database was observed. This is not a formality: Task 3-5's entire runtime pass ran against the redirected DB and had to be re-driven on the real one before it could be accepted.

### Harness Caveats

- **electron-vite does NOT hot-restart the main process.** Every main-process change needs a real tree-kill cold boot.
- Kill process **TREES**: `taskkill /PID <root> /T /F`. The graceful-quit test is `taskkill` **WITHOUT** `/F`.
- **`sqlite3` is NOT installed.** Use the `ELECTRON_RUN_AS_NODE` dump-script pattern in `_verify/2-1-dump.js`, write results to a file, and note the known flake: **no file on the first invocation — retry once.**
- CDP-driven Vue forms need a microtask tick between an `input` event and a submit click, or the click lands on a stale `:disabled` state.
- **Never type into a CLI whose input mode you have not read first.** On 2026-07-24 an automated `Input.insertText` landed on codex's raw-mode update menu, took its default action, and silently upgraded the CLI mid-verification. Screenshot and read the pane before sending keystrokes.

### The Milestone Inspection (Gate G2)

Create a credential profile through the real Settings UI with a **PLANTED FAKE KEY** of realistic shape, launch an agent against it, and with the session live inspect all five surfaces:

1. **COMMAND LINE** — walk the electron main's **DESCENDANT TREE** via `ParentProcessId` using `Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CommandLine`. **NEVER** name-match: there are roughly 16 unrelated `claude.exe` processes on this machine. **No command line contains the key or any >= 8-character substring of it.**

2. **ENVIRONMENT BLOCK** — read the agent process's environment **FROM OUTSIDE THE APP** and confirm the key **IS present** under the expected variable name. **THIS POSITIVE CHECK IS NOT OPTIONAL:** absence everywhere is also what a completely broken injection looks like. Confirm in the same dump that the allow-list held.

3. **LOGS** — the full main-process log contains **no key, no >= 8-character substring, no 64-hex fingerprint.**

4. **RING BUFFER AND RENDERER** — have the agent print the key, then confirm `[REDACTED-CREDENTIAL]` on screen, in the ring buffer, and in `attach()`'s replay after a remount.

5. **IPC SURFACE** — dump every response the renderer can obtain; none carries key material.

### The Negative Control

**The milestone is meaningless without it** — launch the **SAME agent with NO credential profile selected** and confirm it still works exactly as before, with `process.env` inherited wholesale and no allow-list applied.

### The Refusal Proof

Corrupt a profile's blob, attempt a launch naming it; expect an **inline refusal naming the profile BY LABEL ONLY**, no spawn, no orphan session row, and no ambient-credential fallback.

### The Test-Key Proof

Press the button with a deliberately invalid key and confirm a clean sanitized failure.

Exercise all three leakage paths:
- a provider 401 body
- a fetch exception
- a DNS failure

**Only confirm the success path if a real credential is available AND Matthew consents to a live call from his machine**; if no real credential is used, **SAY SO PLAINLY.**

## Failure Honesty Clause

If any verification command fails for an unrelated environment reason, **capture the EXACT output**, explain it, and **DO NOT claim success**.

An indeterminate result is reported as indeterminate and the affected acceptance criterion is marked **FAILED** — never reasoned into a pass.

An unproven claim is worse than an honest unknown because it will be cited later as evidence.

**Temporary instrumentation must be reverted** and the review checks the **COMMIT DIFF**, not the worktree.

## Final Reporting Requirements

Report a status of exactly one of: **DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED**

Plus:

- Both commit SHAs and what each contains
- Every file changed
- Typecheck / vitest / grep:secrets results with **actual numbers**
- The Commit 1 behaviour-neutrality evidence (19 scrubber tests unchanged + Task 3-5 runtime items 1–4 re-driven)
- The D4 verification transcript (what you ran, what it said) for **every env-var name** written into an adapter
- **The OpenRouter route proven end to end (D47)**: the exact `-c` args emitted, the model id used, evidence that a live agent **answered a prompt** through that route while authenticated by the injected key, and confirmation that `~/.codex/config.toml` was never written (mtime unchanged) and `codex login` never invoked
- The **five-surface milestone inspection with results quoted INCLUDING the positive environment-block check**
- The negative control result
- The refusal proof
- The test-key proof including which leakage paths were exercised
- The Step 7 restore-path decision and its reasoning
- Confirmation each non-goal held
- Residual risks and known gaps
- The final `git status --porcelain`
