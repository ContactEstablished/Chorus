# Task 3-6 — BYOK Env Injection + Test-Key

_Sixth and final task of Phase 3 (Foundation). Windows-only. **One commit** (G3). This task governs scope; `ImplementationSpec-3-6.md` governs exact contents. **Supersedes D5** and closes the phase milestone. **G4 is mandatory and non-negotiable.**_

## Source Of Truth

- `docs/Features/Foundation/Tasks/Phase-3-Overview.md` — the phase contract, cross-cutting rules, gates, file-ownership matrix.
- Roadmap §6 **D33** — the vault contract, in full. This task implements clauses **4, 5, 8, and 9** and coordinator resolutions **(a)**, **(c)**, and **(d)**.
- Roadmap §6 **D34** resolutions **(d)** (env policy has one owner: main) and **(e)** (`env_var_name` precedence).
- Roadmap §6 **D5** — "child PTYs inherit env untouched; no credentials injected/logged anywhere." **This task supersedes it**, and the commit message must say so explicitly, because that comment has stood in `sessionManager.ts` since Phase 0.
- `CouncilBriefs/CouncilBrief-3.0-Vault-Findings.md` — action items 5, 6, 10, 11; risks 1, 2, 3; the **Q6 fallback** for an allow-list that breaks an agent.
- `CLAUDE.md` — **D4**: verify env-var names and flags against the tool's own docs/`--help` at execution time. This binds harder here than anywhere else in the phase.
- Tasks 3-2 (vault), 3-3 (adapters), 3-4 (settings), 3-5 (scrubber) — all four are consumed.

## Initial Starting Point

**Verified 2026-07-22 against commit `fb3201e`**; re-verify against 3-5's commit before starting.

- **Baseline at the time of writing:** typecheck 0 · 160/160 across 8 files · `grep:secrets` clean. Tasks 3-2 … 3-5 add to this.
- **`SessionManager.spawn` currently passes `env: process.env as Record<string, string>`** with the D5 comment above it. After Task 3-3 it obtains a `PtyLaunchRequest` from the adapter, whose `envAdditions` and `secretEnv` are both `{}` and **deliberately not merged in** — 3-3's spec forbids merging them, precisely so env composition arrives here with its own review.
- **`launch(agent, cwd, sessionId, secrets = [])`** — Task 3-5 added the `secrets` parameter with zero callers. This task is its one legal caller.
- **`session:launch` is already `async`** (since Task 2-2), so an `await` for decryption costs nothing structurally. `SessionManager.launch()` is **synchronous**, so the decrypt must complete **before** it is called.
- **`vault.decryptForLaunch(id)` is async** (D33 resolution (e): `shouldReEncrypt` is reported only by `decryptStringAsync`) and has **zero callers** as of 3-2.
- **`provider_configs.env_var_name`** is a nullable override; the adapter's `AuthMethodDefinition.requiredEnvVar` is the default (D34(e)). Main composes the final `ResolvedCredential.envVarName`.
- **Installed CLIs (re-verify at execution, D4):** `claude.exe` 2.1.215, `codex-cli` 0.144.6 via an npm `.cmd` shim spawned through `cmd.exe /c`.

### ⚠ Auth-surface findings — coordinator-verified 2026-07-23 against the installed binaries' own `--help`

These were read off `claude --help` and `codex --help` on this machine. **They change what this task can promise, and the second one may change its scope.** Re-verify both at execution; the CLIs move fast.

- **Claude Code accepts `ANTHROPIC_API_KEY` — confirmed.** The `--bare` flag documents itself as a mode where *"Anthropic auth is strictly `ANTHROPIC_API_KEY` or `apiKeyHelper` via `--settings` (OAuth and keychain are never read)"*. That `--bare` must explicitly **stop** reading OAuth and keychain is the proof that normal mode **does** read them. `--betas` is further marked "API key users only". A `claude auth` subcommand and `claude setup-token` (subscription) exist.
- **🔴 UNKNOWN, AND LOAD-BEARING: which wins when BOTH are present.** If a valid OAuth/keychain subscription login exists **and** Chorus injects `ANTHROPIC_API_KEY`, the help text does not say which the CLI uses. **If OAuth silently takes precedence, BYOK appears to work while billing the subscription** — the exact billing-separation failure this feature exists to prevent, and it would **pass every absence-check in the milestone inspection**, because the key really would be in the environment and really would be absent everywhere else. This must be determined **empirically** (Step 1a), not assumed. Note `--bare` forces API-key-only but also disables hooks, LSP, plugin sync, auto-memory and CLAUDE.md discovery — **far too destructive to use as an auth switch**; do not reach for it.
- **🔴 Codex's API-key path is NOT an environment variable — it is a login step.** `codex login --with-api-key` *"Read the API key from stdin (e.g. `printenv OPENAI_API_KEY | codex login --with-api-key`)"*. The env var in that example is a **source you pipe from**, not something Codex reads at runtime. Codex stores credentials of its own (`codex logout` = "Remove stored authentication credentials"; config at `~/.codex/config.toml`; `codex login status` reports state). **Whether Codex reads `OPENAI_API_KEY` from its process environment at all is UNVERIFIED and may be false** — in which case **env injection is structurally insufficient for Codex** and this task's premise holds for Claude Code only. See Step 1b for the decision this forces.
- **Codex controls its own children's environment.** `-c shell_environment_policy.inherit=all` appears in its config surface, so what Codex passes to the shells *it* spawns is Codex's policy, not Chorus's. Relevant to Task 3-5's scrubber (whether an agent can echo the key at all) and worth an observational note, not action.
- **A known gap inherited from Task 3-5, stated there so it would not be discovered here:** the **restore path re-spawns without re-resolving a credential**, so a restored BYOK session would launch with no key and an empty scrubber match set. This task must decide and implement one of the two honest answers (see Step 7).

## Goal

Make an agent run on a key the user gave Chorus, and prove that the key exists in exactly one place a process can see it — the child's environment block — and nowhere else Chorus controls.

The feature is small. The proof is the task. Phase 3's milestone is written as an *inspection*, not a behaviour: the key appears in no command line, no log line, no ring buffer, no transcript, and no renderer-reachable surface, **verified by looking**, using a planted fake key. Everything in this task is arranged to make that inspection possible and honest.

Three specific traps this task exists to avoid:

1. **Injecting via argv.** Process command lines are world-readable to the same user on Windows; `Get-CimInstance Win32_Process` shows them. A key in `args` is a key published to every process on the machine. Env vars are not *secret* — the same user can read those too (D33 clause 5 names this as an unavoidable, documented limit) — but they are not broadcast in a process listing.
2. **Silently degrading.** A decrypt failure must **refuse the launch** with a message naming the profile by label. A launch that quietly proceeds without the key produces an agent that either fails confusingly or falls back to the developer's ambient credentials — which is precisely the billing-separation failure BYOK exists to prevent.
3. **Applying the allow-list where it does not belong.** D33 resolution (c): the constructed allow-list applies **only** to credential-bearing launches. A no-profile launch inherits `process.env` wholesale — today's exact behaviour, preserved deliberately. Ambient keys riding along on a no-profile launch is today's behaviour and stays.

## Exact Scope

| File | Change |
|---|---|
| `src/main/services/sessionManager.ts` | **Edit.** Env composition (the D33/D34(d) rule); thread `secrets` into the scrubber; replace the D5 comment. |
| `src/main/adapters/claude.ts`, `codex.ts` | **Edit.** `requiredEnvVars` populated from D4-verified facts; `buildLaunch` fills `secretEnv` from `spec.credential`. |
| `src/main/adapters/env.ts` | **Create.** The Windows baseline allow-list and the pure `composeChildEnv(...)` used by `SessionManager`. |
| `src/main/adapters/env.test.ts` | **Create.** Unit tests for `composeChildEnv` (see Test Expectations). |
| `src/main/ipc.ts` | **Edit.** Launch resolves + decrypts the credential; the `credential:test` handler. |
| `src/shared/ipc.ts` | **Edit.** `launchRequestSchema.credential_profile_id`; the `credential:test` channel + schemas. |
| `src/preload/index.ts` | **Edit.** One forwarder for `credential:test`. |
| `src/main/services/storage.ts` | **Edit.** `markCredentialVerified` gets its one caller. |
| `src/renderer/src/components/LaunchDialog.vue` | **Edit.** Auth-method + credential-profile selection. |
| `src/renderer/src/views/SettingsCredentials.vue` | **Edit.** The "Test key" button and its result state. |
| `src/renderer/src/stores/settings.ts` | **Edit.** The test action + verified-state refresh. |
| `src/shared/ipc.test.ts` | **Edit.** Cases for the widened launch payload and the test channel. |

Nothing else. If a change seems to require another file, raise it.

## Non-Goals

- **No key in argv, ever, under any circumstance.** Not for a "quick test", not behind a flag.
- **No model catalog, no cached model list.** The test-key probe is **one live call** returning ok/fail (D28). If the provider's natural probe endpoint happens to be "list models", discard the list — persisting it is Phase 3a.
- **No new HTTP dependency.** Node's built-in `fetch`.
- **No effort normalization, no launch profiles, no `usage_records`** — Phase 3a.
- **No retry, no backoff, no queue** on the test probe. One request, a short timeout, a result.
- **No automatic verification.** The probe runs when the user presses the button. It does not run at launch, at boot, on a timer, or on profile creation — each of those would send a user's credential to a third party without an explicit request, which D33 resolution (d)'s carve-out does not license.
- **No api-mode execution.** `startApiSession` stays unimplemented.
- **No change to the scrubber's algorithm.** 3-5 owns it; this task only registers values with it.
- **No widening of what crosses IPC.** The launch payload gains a **profile id**, never a key. The test response is a boolean and a sanitized message.
- **Do not revert, stage, or commit unrelated or untracked files, including `_verify/` and anything under `docs/`.**
- **Do not remove the standing `wt-24b5c1fe` worktree row, directory, or branch.**

## Dependencies

- **Tasks 3-2, 3-3, 3-4, 3-5** — all four, all consumed. This is the task that joins them.
- No new npm dependency.

## Step-by-step Work

1. **D4 verification, first and reported.** Before writing any env-var name into an adapter, confirm it against the installed CLI's own `--help`/docs **in this session**, and record what you ran and what it said. Names to establish: Claude Code's API-key variable and base-URL variable; Codex's API-key variable and its config-file conventions. **If a name cannot be confirmed, do not guess** — declare it `null`, refuse `api_key` auth for that adapter, and raise it as a finding. A wrong env-var name produces a silent no-op that looks like a working feature.

1a. **Determine Claude Code's auth precedence empirically.** With a valid subscription login present, launch with an injected `ANTHROPIC_API_KEY` and establish **which credential the CLI actually used**. Use the CLI's own reporting (`claude auth`, an in-session `/status`, or `-d/--debug` category filtering on `api`) rather than inference. Three outcomes, three responses:
   - **The injected key wins** → the design holds as written. Record the evidence.
   - **OAuth/keychain wins** → **BYOK is not honestly deliverable for Claude Code by env injection alone.** Do **not** paper over it. Either find a non-destructive mechanism the CLI documents (`apiKeyHelper` via `--settings` is the candidate — evaluate it), or declare `api_key` unsupported for this adapter in Phase 3 and raise it for a scope decision. **Do not reach for `--bare`.**
   - **Indeterminate** → report it as indeterminate. An unproven precedence claim is worse than an honest unknown, because the milestone inspection cannot distinguish the two.

1b. **Determine whether Codex reads an API key from its environment at all.** Its documented path is `codex login --with-api-key` reading from **stdin**, which persists credentials in Codex's own store. If Codex does **not** honour `OPENAI_API_KEY` at runtime, **env injection cannot deliver BYOK for Codex**, and the sanctioned answer is: **declare `apiKey: false` / no `api_key` auth method on the Codex adapter for Phase 3, ship BYOK for Claude Code only, and record it as a scope finding.**
   **Explicitly NOT sanctioned:** having Chorus run `codex login --with-api-key` on the user's behalf, or writing a decrypted key into `~/.codex/config.toml`. Both would make Chorus **persist a decrypted credential into another tool's on-disk credential store** — a materially different threat model from "inject into a child process's environment", and one **D33 never reviewed**. If you believe one of them is necessary, that is a **CR trigger** under roadmap §4: flag, brief, pause. Do not implement it.
2. **`env.ts`** — the baseline allow-list and `composeChildEnv`, pure and unit-tested.
3. **Adapters** — `requiredEnvVars` and `secretEnv`, from step 1's verified facts.
4. **`SessionManager`** — compose the child env; register secrets with the scrubber; replace the D5 comment with the new contract.
5. **The launch path in `main/ipc.ts`** — resolve the profile, resolve the env var name (override → adapter default), decrypt, build, launch, drop. The refusal path is as important as the success path.
6. **The allow-list empirical pass** — launch **both** agents with a credential and confirm they still work. This is council action 5 and D33 resolution (c), and it is a **hard step**: an allow-list that breaks an agent is a shipped bug. Expand the list empirically, documenting why each addition earned its place. If an agent cannot be made to work with any enumerable list, invoke the findings' **Q6 fallback** (inherit `process.env` with known provider-key variables explicitly stripped) and flag it loudly as a contract deviation.
7. **Decide the restore-path question** (inherited from 3-5): either re-resolve the credential at restore time, or refuse to auto-restore credentialed sessions with honest exited chrome. **Pick one, implement it, and state the reasoning.** Silently restoring a BYOK session without its key is the one answer that is not acceptable — it produces an agent running on ambient credentials that the user believes is running on their profile.
8. **Test-key** — the probe, the handler, the button, `last_verified_at`.
9. **Launch dialog** — auth method and credential selection, defaulting to subscription so the existing flow is unchanged for a user with no profiles.
10. **Tests**, then `npm run typecheck` / `npx vitest run` / `npm run grep:secrets`.
11. **The milestone proof (G2)** — the full inspection in Verification Commands. This is the phase's acceptance, not just the task's.

## Test Expectations

**Unit (Vitest), `src/main/adapters/env.test.ts`** — `composeChildEnv` must be pure and take the "process environment" as a parameter rather than reading `process.env`, so it is testable at all:

- **No credential → identity.** The returned env is the passed-in environment, unmodified and complete. **This is the most important test in the task**: it is what proves resolution (c), and a regression here silently changes how every existing session launches.
- **With a credential → allow-list applied.** The result contains every baseline variable present in the input, every `requiredEnvVars` entry present in the input, the `envAdditions`, and the secret under its resolved name — **and nothing else**. Assert by key-set equality, not by spot-checking a few keys, so an accidentally-inherited variable fails.
- **Ambient provider keys are excluded.** Given an input environment containing an `ANTHROPIC_API_KEY` the user did not choose, a credential-bearing launch's env does **not** carry it (unless it is the injected one). This is the billing-separation property the whole feature exists for, and it deserves its own named test.
- **Missing baseline variables are skipped, not emitted as `undefined`.** An env with no `TMP` produces a result with no `TMP` key — not `TMP: undefined`, which node-pty would stringify.
- **Secret precedence:** when `secretEnv` and the inherited environment both define the same name, the injected value wins.
- **Env-var name resolution:** a provider `env_var_name` override beats the adapter's `requiredEnvVar` default; absent override falls back to the default (D34(e)). Test the pure resolver directly.

**Unit (Vitest), `src/shared/ipc.test.ts`:**

- `launchRequestSchema` accepts a payload with `credential_profile_id` and one without (backward compatible — the no-credential path is first-class).
- `credentialTestResponseSchema` admits `{ok: true}` / `{ok: false, reason}` and **has no field capable of carrying key material** — asserted on the parse output's key set, the same discipline as 3-2's meta schema.

**No test may contain a real credential**, and `npm run grep:secrets` must pass afterwards.

**Runtime (G2)** carries the milestone. No unit test can establish any of it.

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

**The milestone inspection.** Create a credential profile through the real Settings UI with a **planted fake key of realistic shape**, launch an agent against it, and then — with the session live — inspect all five surfaces:

1. **Command line.** For every process in the electron main's descendant tree:
   ```
   Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CommandLine
   ```
   Walk the tree from the electron main PID (never `tasklist` name-matching — there are ~16 unrelated `claude.exe` on this machine). **No command line contains the key or any ≥ 8-character substring of it.**
2. **Environment block.** Read the agent process's environment and confirm the key **is** present under the expected variable name — the positive half of the proof, which is what shows injection actually happened rather than silently no-op'ing. Confirm in the same dump that the allow-list held: variables outside baseline + `requiredEnvVars` + additions are absent.
3. **Logs.** The full main-process log for the session contains no key, no ≥ 8-character substring, and no 64-hex fingerprint.
4. **Ring buffer and renderer.** Have the agent print the key (`echo $env:<NAME>`), then confirm `[REDACTED-CREDENTIAL]` on screen, in the ring buffer, and in `attach()`'s replay after a remount — 3-5's machinery, now exercised end to end with a real injected value.
5. **IPC surface.** Dump every response the renderer can obtain and confirm none carries key material.

**⚠ The precedence proof — without it, checks 1–5 are consistent with the feature not working.** Checks 1–5 establish that the key is in the child's environment and nowhere else. They do **not** establish that the agent *used* it. With a valid subscription login also present, an agent that ignores the injected key passes all five while billing your subscription.

So, separately, with a **valid subscription login present** and a credential profile selected, establish **which credential the agent actually authenticated with** — from the CLI's own reporting (`claude auth`, in-session `/status`, or `--debug` on the `api` category), not from inference. Report the command, its output, and your conclusion. If it is indeterminate, **say so** and mark the affected acceptance criterion FAILED rather than reasoning your way to a pass. Do the equivalent for Codex, or record why the question does not arise there (Step 1b).

**The negative control, which the milestone is meaningless without:** launch the **same agent** with **no credential profile selected** and confirm it still works exactly as before, with `process.env` inherited wholesale and no allow-list applied. Claude Code's expired-token screen is a perfectly good subscription-path signal — report it as the expected outcome, not as a failure.

**The refusal proof.** Corrupt a profile's blob (as in 3-2's verification), then attempt a launch naming it. Expected: an inline refusal naming the profile **by label**, no spawn, no session row left behind in a half-created state, and no ambient-credential fallback.

**The test-key proof.** Press the button with a deliberately invalid key and confirm a clean failure with a sanitized message; then, **only if a real credential is available and Matthew consents to a live call being made from his machine**, confirm the success path and that `last_verified_at` updates. If no real credential is used, say so plainly — an unverified success path is a known gap, not a silent assumption.

**⚠ The `sqlite3` CLI is NOT installed.** Use the `ELECTRON_RUN_AS_NODE` dump-script pattern (`_verify/2-1-dump.js`); write results to a file; **known flake: no file on first invocation, retry once**; **quote the `projects` table** (F20).

**Harness reminders:** electron-vite does **not** hot-restart the main process — every injection check needs a real tree-kill cold boot. Kill process **trees** (`taskkill /PID <root> /T /F`); graceful-quit test is `taskkill` **without** `/F`. CDP on `--remote-debugging-port=9222`.

## Acceptance Criteria

- [ ] `npm run typecheck` — zero errors (G1).
- [ ] `npx vitest run` — green, the then-current baseline intact and grown.
- [ ] `npm run grep:secrets` — clean (G4, mandatory).
- [ ] **A BYOK launch works:** an agent starts with a credential profile selected and receives the key as an environment variable.
- [ ] **The key is in the child's environment and nowhere else Chorus controls** — the five-surface inspection above, with results quoted, including the **positive** environment-block check.
- [ ] **The agent demonstrably AUTHENTICATED with the injected credential**, proven from the CLI's own reporting with a valid subscription login simultaneously present — not inferred from the key's presence in the environment. An indeterminate result is a **FAIL**, not a pass with a caveat.
- [ ] **Codex's BYOK support is stated as a determined fact, not left ambiguous** — either env injection was proven to work for it, or `api_key` is declared unsupported on the Codex adapter for Phase 3 with the reason recorded. **No key was written into `~/.codex/config.toml` and `codex login` was never invoked by Chorus** (grep-verified).
- [ ] **The no-credential path is byte-for-byte unchanged:** `process.env` inherited wholesale, no allow-list, no vault call — proven by the negative control and by the identity unit test.
- [ ] **Ambient provider keys do not reach a credential-bearing launch** — the billing-separation property, unit-tested and confirmed in the environment-block dump.
- [ ] **The allow-list was tested empirically against BOTH installed CLIs** (council action 5), and every entry beyond the council baseline is documented with the reason it was needed. Any use of the Q6 fallback is flagged as a contract deviation.
- [ ] **Decrypt failure refuses the launch**, names the profile by label only, spawns nothing, and never falls back to ambient credentials.
- [ ] **The restore-path decision is implemented and stated** — either credentials are re-resolved at restore, or credentialed sessions are not auto-restored. Neither silence nor a keyless restore is acceptable.
- [ ] **Test-key is one live call**, user-initiated only, never automatic; failure messages are sanitized; `last_verified_at` updates on success.
- [ ] **`D5` is explicitly superseded** — the `sessionManager.ts` comment is replaced with the new contract, and the commit message says which decision it supersedes.
- [ ] **No key crosses IPC in either direction except the one inbound `credential:create`/`replace` field** — grep the whole IPC surface.
- [ ] **One** narrated commit (G3), touching only the Exact Scope files.
- [ ] The standing `wt-24b5c1fe` worktree row, directory, and branch are **untouched**.

## Review Checklist

- [ ] **Read the composed env construction for an accidental spread.** `{...process.env, ...secretEnv}` on the credential path defeats the entire allow-list while looking correct. Key-set equality in the unit test is the defence; confirm the test would actually fail against that implementation.
- [ ] The decrypted value's lifetime was read end to end: decrypt → compose → register with the scrubber → spawn → out of scope. No log line, no error message, no retained object property, no `JSON.stringify` of anything containing it.
- [ ] The scrubber registration happens **before** the PTY can produce output, not after. A race here means the first chunk — which is exactly when a shell might echo its environment — goes unscrubbed.
- [ ] Every env-var name written into an adapter was **verified this session against the CLI's own output**, and the verification is quoted in the summary. A remembered name is a D4 violation regardless of whether it happens to be right.
- [ ] **The precedence question was answered with evidence, not assumed away.** A summary that reports the five-surface inspection as a pass without addressing which credential the agent actually authenticated with has not proven the milestone — it has proven the key was present. Send it back.
- [ ] **Nothing persists a decrypted key outside the child's environment.** Specifically: no `codex login` invocation, no write to `~/.codex/config.toml`, no `--settings` file containing key material, no `apiKeyHelper` script written to disk carrying a key. Any of these is a threat-model change D33 never reviewed and is a CR trigger, not an implementation choice.
- [ ] The test probe cannot be triggered by anything except the button — grep for its handler's callers, and confirm no boot path, timer, launch path, or profile-creation path reaches it.
- [ ] The test probe's error path was checked for leakage: a provider's 401 body, a fetch exception, and a DNS failure all produce sanitized messages. Run all three.
- [ ] The refusal path leaves **no orphan session row** — the same discipline Task 2-2's `createWorktree` failure branch established.
- [ ] The launch dialog defaults to the subscription path, so a user with no profiles sees no change.
- [ ] The milestone inspection includes the **positive** environment check. A proof that only shows absence everywhere is consistent with the key never having been injected at all.
- [ ] No untracked / `_verify/` / `docs/` files staged or reverted.
