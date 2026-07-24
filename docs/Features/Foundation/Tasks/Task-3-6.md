# Task 3-6 — BYOK Env Injection + Test-Key

_Sixth and final task of Phase 3 (Foundation). Windows-only. **TWO commits — G3 amended for this session by D46** (precedent: D24, D32, D36, D37): first a **flagged, behaviour-neutral chore commit** making the ingest-scrub seam session-shaped rather than PTY-shaped (Step 0), then the BYOK task commit. This task governs scope; `ImplementationSpec-3-6.md` governs exact contents. **Supersedes D5** and closes the phase milestone. **G4 is mandatory and non-negotiable.**_

## Source Of Truth

- `docs/Features/Foundation/Tasks/Phase-3-Overview.md` — the phase contract, cross-cutting rules, gates, file-ownership matrix.
- Roadmap §6 **D33** — the vault contract, in full. This task implements clauses **4, 5, 8, and 9** and coordinator resolutions **(a)**, **(c)**, and **(d)**.
- Roadmap §6 **D34** resolutions **(d)** (env policy has one owner: main) and **(e)** (`env_var_name` precedence).
- Roadmap §6 **D42** (2026-07-24) — OpenRouter is Chorus's single gateway, LiteLLM dropped, and **token attribution is keyed on `AuthMethodDefinition.type`**. This task is where that discriminator first becomes user-visible: the launch dialog's auth-method choice (Step 9) is what later selects a session's attribution strategy in Phase 3a. Nothing in D42 is implemented here.
- Roadmap §6 **D43** (2026-07-24) — the launchable unit is **(agent × route × model)**; subscription routes are first-class `provider_configs` rows with **zero** credential profiles, matching D33 clause 9. This task must not assume an `api_key` auth method exists for every adapter, and must leave the subscription path first-class. Adds the two verification-only questions in Step 1c.
- Roadmap §5 **F26** — the restore gap, empirically proven on the real dev DB 2026-07-24. Step 7 settles it.
- Roadmap §6 **D5** — "child PTYs inherit env untouched; no credentials injected/logged anywhere." **This task supersedes it**, and the commit message must say so explicitly, because that comment has stood in `sessionManager.ts` since Phase 0.
- `CouncilBriefs/CouncilBrief-3.0-Vault-Findings.md` — action items 5, 6, 10, 11; risks 1, 2, 3; the **Q6 fallback** for an allow-list that breaks an agent.
- `CLAUDE.md` — **D4**: verify env-var names and flags against the tool's own docs/`--help` at execution time. This binds harder here than anywhere else in the phase.
- Tasks 3-2 (vault), 3-3 (adapters), 3-4 (settings), 3-5 (scrubber) — all four are consumed.

## Initial Starting Point

**Originally verified 2026-07-22 against `fb3201e`; RE-ANCHORED 2026-07-24 against `ddb5454`** (Task 3-5 landed — code in `d3b6f30` per **D40**). Re-verify again at execution; the facts below moved once already.

- **Baseline (coordinator-verified 2026-07-24):** typecheck 0 · **254/254 across 12 files** · `grep:secrets` clean · working tree clean. _(The 2026-07-22 figure of 160/160 across 8 files is superseded.)_
- **`SessionManager.spawn` currently passes `env: process.env as Record<string, string>`** with the D5 comment above it. After Task 3-3 it obtains a `PtyLaunchRequest` from the adapter, whose `envAdditions` and `secretEnv` are both `{}` and **deliberately not merged in** — 3-3's spec forbids merging them, precisely so env composition arrives here with its own review.
- **`launch(agent, cwd, sessionId, secrets = [])`** — Task 3-5 added the `secrets` parameter with zero callers. This task is its one legal caller.
- **`session:launch` is already `async`** (since Task 2-2), so an `await` for decryption costs nothing structurally. `SessionManager.launch()` is **synchronous**, so the decrypt must complete **before** it is called.
- **`vault.decryptForLaunch(id)` is async** (D33 resolution (e): `shouldReEncrypt` is reported only by `decryptStringAsync`) and has **zero callers** as of 3-2.
- **`provider_configs.env_var_name`** is a nullable override; the adapter's `AuthMethodDefinition.requiredEnvVar` is the default (D34(e)). Main composes the final `ResolvedCredential.envVarName`.
- **Installed CLIs — BOTH MOVED since this doc was authored (re-verify again at execution, D4):** `claude.exe` **2.1.218** (was 2.1.215), `codex-cli` **0.145.0** (was 0.144.6) via an npm `.cmd` shim spawned through `cmd.exe /c`. The codex bump happened *during* the Task 3-5 coordinator re-drive on 2026-07-24, when automated input landed on its raw-mode update menu; accepted rather than pinned back. **Consequence:** every auth/capability claim in `codexAdapter` was D4-verified against **0.144.6** and is now unverified. In particular **0.145.0 advertises a `/skills` surface while the adapter still declares `skills: false`** — correct it in this task while you are in the file, with the `--help` output quoted.

### ⚠ Auth-surface findings — coordinator-verified 2026-07-23 against the installed binaries' own `--help`

These were read off `claude --help` and `codex --help` on this machine. **They change what this task can promise, and the second one may change its scope.** Re-verify both at execution; the CLIs move fast.

**RE-CHECKED 2026-07-24 against the NEW versions (claude 2.1.218 / codex 0.145.0). Both findings below survived the version bump, and three facts were added:**

- **Claude 2.1.218 — unchanged and still unresolved.** The only `ANTHROPIC_API_KEY` mention in `--help` remains inside the `--bare` description, so the inference below still holds *and the precedence question is still open*. Step 1a is unavoidable.
- **No base-URL variable appears in `claude --help` at all.** `ANTHROPIC_BASE_URL` therefore **cannot be declared from `--help` alone** — if the spec's §4 envelope→`envAdditions` base-URL mapping is implemented, its variable name needs a source other than `--help` (official docs), or it is declared `null` and the mapping is deferred. Do not hardcode it from memory (D4).
- **Codex 0.145.0 — `--with-api-key` still reads from stdin, and `OPENAI_API_KEY` appears nowhere in `--help` as a runtime variable.** This corroborates the finding below and makes "env injection is structurally insufficient for Codex" the *likely* outcome rather than a hypothetical branch. Confirm empirically, then declare it.
- **NEW — `codex -m, --model <MODEL>` exists**, and `-c model="o3"` is a documented config override. So Codex *can* be pointed at an arbitrary model id. This answers half of **D43**'s question (ii).
- **NEW — `codex -c key=value` overrides any `~/.codex/config.toml` value without writing the file.** That is a legitimate channel for **non-secret** settings (a base URL, a model). **🔴 It is also a trap: `-c` lands on the COMMAND LINE, which is world-readable to the same user.** A base URL via `-c` is fine; **a key via `-c` violates Non-Goal #1 absolutely.** Do not let the convenience of `-c` become the way a credential reaches Codex.
- **NEW — `codex --remote-auth-token-env <ENV_VAR>` exists** ("Name of the environment variable containing the bearer token to send to a remote app"). It concerns a *remote app*, not the model provider, so do **not** assume it is a BYOK path — but it is worth one probe before declaring `api_key` unsupported, since it is the only env-var-shaped auth surface Codex exposes.

- **Claude Code accepts `ANTHROPIC_API_KEY` — confirmed.** The `--bare` flag documents itself as a mode where *"Anthropic auth is strictly `ANTHROPIC_API_KEY` or `apiKeyHelper` via `--settings` (OAuth and keychain are never read)"*. That `--bare` must explicitly **stop** reading OAuth and keychain is the proof that normal mode **does** read them. `--betas` is further marked "API key users only". A `claude auth` subcommand and `claude setup-token` (subscription) exist.
- **🔴 UNKNOWN, AND LOAD-BEARING: which wins when BOTH are present.** If a valid OAuth/keychain subscription login exists **and** Chorus injects `ANTHROPIC_API_KEY`, the help text does not say which the CLI uses. **If OAuth silently takes precedence, BYOK appears to work while billing the subscription** — the exact billing-separation failure this feature exists to prevent, and it would **pass every absence-check in the milestone inspection**, because the key really would be in the environment and really would be absent everywhere else. This must be determined **empirically** (Step 1a), not assumed. Note `--bare` forces API-key-only but also disables hooks, LSP, plugin sync, auto-memory and CLAUDE.md discovery — **far too destructive to use as an auth switch**; do not reach for it.
- **🔴 Codex's API-key path is NOT an environment variable — it is a login step.** `codex login --with-api-key` *"Read the API key from stdin (e.g. `printenv OPENAI_API_KEY | codex login --with-api-key`)"*. The env var in that example is a **source you pipe from**, not something Codex reads at runtime. Codex stores credentials of its own (`codex logout` = "Remove stored authentication credentials"; config at `~/.codex/config.toml`; `codex login status` reports state). **Whether Codex reads `OPENAI_API_KEY` from its process environment at all is UNVERIFIED and may be false** — in which case **env injection is structurally insufficient for Codex** and this task's premise holds for Claude Code only. See Step 1b for the decision this forces.
- **Codex controls its own children's environment.** `-c shell_environment_policy.inherit=all` appears in its config surface, so what Codex passes to the shells *it* spawns is Codex's policy, not Chorus's. Relevant to Task 3-5's scrubber (whether an agent can echo the key at all) and worth an observational note, not action.
- **A known gap inherited from Task 3-5 — now roadmap finding F26, and EMPIRICALLY PROVEN rather than merely reasoned:** the **restore path re-spawns without re-resolving a credential**, so a restored BYOK session launches with no key and an empty scrubber match set. The Task 3-5 coordinator re-drive reproduced this on the **real dev DB** on 2026-07-24: a restored session emitting the planted value showed `valuePresent: TRUE` / `placeholderCount: 0`, while a freshly-launched registered session in the same boot redacted it completely. This task must decide and implement one of the two honest answers (see Step 7). Silence is the one unacceptable outcome.

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
| `src/main/services/sessionOutput.ts` | **Create — COMMIT 1 (chore, D46).** The session-shaped ingest pipeline: scrub → ring buffer → broadcast, plus the carry-flush timer. Electron-free and node-pty-free so both session types can use it and it is unit-testable with fake timers. |
| `src/main/services/sessionOutput.test.ts` | **Create — COMMIT 1.** Unit tests for the five invariants listed in Step 0. |
| `src/main/services/sessionManager.ts` | **Edit — BOTH commits.** *Commit 1:* `spawn`'s inline scrub/buffer/broadcast block is replaced by a `SessionOutput`; `onData` → `ingest`, `onExit` → `flush`-then-notify, `dispose` → `dispose`. **Zero behaviour change.** *Commit 2:* env composition (the D33/D34(d) rule); thread `secrets` into the scrubber; replace the D5 comment. |
| `src/main/adapters/claude.ts`, `codex.ts` | **Edit.** `requiredEnvVars` populated from D4-verified facts; `buildLaunch` fills `secretEnv` from `spec.credential`. **`codex.ts` additionally emits the D47 route args** when the launch carries an api-key provider with a `base_url`: `-c model_provider=<name>`, `-c model_providers.<name>.base_url=…`, `-c model_providers.<name>.env_key=<VAR NAME>`, `-c model_providers.<name>.wire_api=chat`, and `-m <model>`. **All non-secret — the key itself never appears in `args`.** |
| `src/main/adapters/env.ts` | **Create.** The Windows baseline allow-list and the pure `composeChildEnv(...)` used by `SessionManager`. |
| `src/main/adapters/env.test.ts` | **Create.** Unit tests for `composeChildEnv` (see Test Expectations). |
| `src/main/ipc.ts` | **Edit.** Launch resolves + decrypts the credential; the `credential:test` handler. |
| `src/shared/ipc.ts` | **Edit.** `launchRequestSchema.credential_profile_id`; the `credential:test` channel + schemas. |
| `src/preload/index.ts` | **Edit.** One forwarder for `credential:test`. |
| `src/main/services/storage.ts` | **Edit.** `markCredentialVerified` gets its one caller. |
| `src/renderer/src/components/LaunchDialog.vue` | **Edit.** Auth-method + credential-profile selection, defaulting to subscription. **Plus ONE optional free-text model-id input (D47)**, shown only when an api-key provider is selected — a deliberate stopgap, **not** a catalog or a picker; Phase 3a owns `model_catalog`/`launch_profiles`. |
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

0. **COMMIT 1 — the ingest-scrub seam becomes session-shaped (D45 mitigation 1, placed here by D46). Behaviour-neutral, and it lands BEFORE any BYOK work.**

   **Why here and not in Phase 3b:** the scrubber is currently **dormant** (zero registered secrets) and has exactly **one** call site, so a mistake today cannot leak a real secret and the blast radius is minimal. The moment Commit 2 wires a live credential through this path, the same refactor means operating on a proven security path with a real secret flowing through it. This is the cheapest this change will ever be, and Commit 2 then exercises it immediately with a planted key — the refactor gets a real consumer in the same session.

   **What it is:** `SessionManager.spawn` currently inlines the whole output pipeline — `createScrubber`, the `emit` helper (ring-buffer append + trim + broadcast), the `onData` clear-push-reschedule block, and the `onExit` flush — inside the function that spawns a PTY. It is therefore *structurally* PTY-bound. Extract it into a `SessionOutput` that owns scrubber, carry-flush timer, ring buffer and broadcast, and exposes `ingest(text)` / `flush()` / `buffer` / `dispose()`. `spawn` then wires `child.onData → ingest` and `child.onExit → flush, then notify`. A future api-mode session wires `for await (const chunk of handle.receive()) sink.ingest(chunk)` — **same object, same guarantees, no second scrub point to forget** (the F26 failure shape).

   **The five invariants from Task 3-5 that MUST survive — each was reasoned for, not accidental:**
   1. **ONE emit path.** The ring buffer and the listeners must consume the *same* scrubbed string, computed once. Two `push()` calls on one chunk advance the carry twice and corrupt the stream.
   2. **Clear timer → push → reschedule, in that order**, so a pending flush can never overtake an already-arrived chunk. Correct by construction, not by timing.
   3. **Flush BEFORE notifying exit**, so the renderer receives the final bytes ahead of the exit event.
   4. **Timer cleared on exit AND on dispose.** A leaked timer holds a closure over the secret match set past teardown.
   5. **The match set dies with the object** — the closure *is* the storage (D33 resolution (a)); do not introduce a separate structure someone can forget to clear.

   **Proof obligation — this is a Task 3-3-style behaviour-neutral refactor and carries the same burden:** the 19 existing scrubber unit tests pass **unchanged**, and **Task 3-5's runtime items 1–4 are re-driven against the refactored seam before Commit 2 begins**, using the existing harness (`_verify/3-5/probe.js`, which reports booleans and counts only, plus `_verify/3-5-coord/`). A refactor of the redaction path that is not re-proven at runtime is not behaviour-neutral, it is merely believed to be.

   **Not in this commit:** no api-mode code, no `ApiSessionHandle` implementation, no `SessionManager` session-type split. **D45(4) still binds** — this is a *refactor of the existing PTY path into a shape a second type could later reuse*, nothing more.

1. **D4 verification, first and reported.** Before writing any env-var name into an adapter, confirm it against the installed CLI's own `--help`/docs **in this session**, and record what you ran and what it said. Names to establish: Claude Code's API-key variable and base-URL variable; Codex's API-key variable and its config-file conventions. **If a name cannot be confirmed, do not guess** — declare it `null`, refuse `api_key` auth for that adapter, and raise it as a finding. A wrong env-var name produces a silent no-op that looks like a working feature. **Also re-verify `codexAdapter`'s capability declarations against 0.145.0** and correct `skills: false` if `/skills` is real.

1c. **BUILD AND PROVE THE OPENROUTER ROUTE — this is now the task's BYOK vehicle, not a verification exercise (D47, 2026-07-24).** Upgraded from the earlier "answer and report, implement nothing": without it, Phase 3 would ship the whole BYOK stack unexercised, because **D44** makes Claude and GPT subscription-only and there is nothing else to inject a key into.

   **The mechanism — D4-verify it against the installed codex 0.145.0 before relying on any of it.** Codex supports custom providers through `[model_providers.<name>]` with:
   - `base_url` — `https://openrouter.ai/api/v1` (**no trailing slash**)
   - **`env_key`** — the NAME of the environment variable Codex reads **at runtime** for the bearer token. *This is the whole reason the route works*: the key travels in the child's environment, never in argv, never through `codex login`, never onto disk.
   - `wire_api` — **`"chat"`**, because OpenRouter exposes only an OpenAI-compatible `/api/v1/chat/completions` endpoint
   - possibly `requires_openai_auth = false`, since OpenRouter keys use an `sk-or-` prefix Codex may otherwise reject

   **Supply the provider block per-launch via `-c` dotted-path overrides — do NOT write the user's `~/.codex/config.toml`.** `-c` carries only non-secret values (base URL, the env-var *name*, `wire_api`); the key itself is injected into the environment by `composeChildEnv`. Nothing is persisted, and the §3a.4 bright line is not approached. **Note the asymmetry and respect it: `-c` is argv, so a base URL there is fine and a key there is forbidden.**

   **The model id is ONE optional free-text field on the launch dialog** — a deliberate stopgap, **not** a catalog. Phase 3a owns `model_catalog` and `launch_profiles`, and D43 places the model in the profile. Do not build selection UI beyond a single input.

   **Rejected, and do not re-attempt: Claude Code pointed at OpenRouter.** It is architecturally impossible, not merely unverified — OpenRouter speaks the OpenAI wire shape and Claude Code speaks the Anthropic Messages shape; no environment variable bridges that, and the translating proxy that would is exactly what D42 declined.

   **If the mechanism does not work as documented, that is a finding, not a licence to improvise.** Report it, and do NOT reach for `codex login --with-api-key`, a written config file, or a key on the command line — all three are the §3a.4 bright line.

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
- [ ] **THE OPENROUTER ROUTE IS BUILT AND PROVEN END TO END (D47)** — codex launched with `-c model_providers.*` overrides against `https://openrouter.ai/api/v1`, the key injected under the name `env_key` designates, driving a **non-GPT** model, and the agent **demonstrably answers a prompt** through that route. This is what closes the phase milestone on a real proof instead of dormant machinery. **Both dormant columns are exercised:** `provider_configs.base_url` and D34(e)'s `env_var_name`.
- [ ] **No key reached argv on the OpenRouter path either** — `-c` carries only base URL, env-var NAME and `wire_api`; verified in the same `Get-CimInstance Win32_Process` command-line dump as the main inspection.
- [ ] **Chorus never wrote `~/.codex/config.toml` and never invoked `codex login`** — grep-verified, and the file's mtime is unchanged across the whole session.
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
- [ ] **COMMIT 1 is behaviour-neutral and PROVEN so** — the 19 scrubber unit tests pass unchanged, new `sessionOutput.test.ts` covers all five Step-0 invariants, and **Task 3-5's runtime items 1–4 were re-driven against the refactored seam before Commit 2 began**, with results quoted. Belief is not proof on a redaction path.
- [ ] **The ingest-scrub seam is session-shaped, not PTY-shaped** — `sessionOutput.ts` imports neither `node-pty` nor `electron`, and `SessionManager.spawn` contains no inline scrub/buffer/broadcast logic. Grep both.
- [ ] **No api-mode code landed** — no `ApiSessionHandle` implementation, no session-type split in `SessionManager`, D45(4) intact.
- [ ] **TWO** narrated commits (G3 amended by **D46**): the behaviour-neutral seam chore, then the BYOK task commit. Each touches only its own Exact Scope rows.
- [ ] The standing `wt-24b5c1fe` worktree row, directory, and branch are **untouched**.

## Review Checklist

- [ ] **Read the composed env construction for an accidental spread.** `{...process.env, ...secretEnv}` on the credential path defeats the entire allow-list while looking correct. Key-set equality in the unit test is the defence; confirm the test would actually fail against that implementation.
- [ ] The decrypted value's lifetime was read end to end: decrypt → compose → register with the scrubber → spawn → out of scope. No log line, no error message, no retained object property, no `JSON.stringify` of anything containing it.
- [ ] The scrubber registration happens **before** the PTY can produce output, not after. A race here means the first chunk — which is exactly when a shell might echo its environment — goes unscrubbed. **The Commit-1 refactor makes this easier to get wrong**: constructing the `SessionOutput` must stay in the same synchronous block as `pty.spawn` and the `onData` wiring. If construction moves even one tick later, the first chunk is lost or unscrubbed.
- [ ] **Read Commit 1's diff for a silently re-ordered pipeline.** The dangerous rewrite is not an obviously broken one — it is `ingest()` appending to the buffer and broadcasting from two separate `scrubber.push()` calls, or rescheduling the flush timer before pushing. Both look reasonable and both corrupt the stream. Invariants 1 and 2 in Step 0 are the specific defences; confirm the unit tests would actually fail against each mistake, rather than merely passing against the correct code.
- [ ] **Confirm the ring buffer's trim still happens on the scrubbed text**, not the raw text, and that `attach()`'s replay reads the same buffer the broadcast wrote. A refactor that reintroduces a raw-text buffer would pass every unit test that only checks the live stream.
- [ ] Every env-var name written into an adapter was **verified this session against the CLI's own output**, and the verification is quoted in the summary. A remembered name is a D4 violation regardless of whether it happens to be right.
- [ ] **The precedence question was answered with evidence, not assumed away.** A summary that reports the five-surface inspection as a pass without addressing which credential the agent actually authenticated with has not proven the milestone — it has proven the key was present. Send it back.
- [ ] **Nothing persists a decrypted key outside the child's environment.** Specifically: no `codex login` invocation, no write to `~/.codex/config.toml`, no `--settings` file containing key material, no `apiKeyHelper` script written to disk carrying a key. Any of these is a threat-model change D33 never reviewed and is a CR trigger, not an implementation choice.
- [ ] The test probe cannot be triggered by anything except the button — grep for its handler's callers, and confirm no boot path, timer, launch path, or profile-creation path reaches it.
- [ ] The test probe's error path was checked for leakage: a provider's 401 body, a fetch exception, and a DNS failure all produce sanitized messages. Run all three.
- [ ] The refusal path leaves **no orphan session row** — the same discipline Task 2-2's `createWorktree` failure branch established.
- [ ] The launch dialog defaults to the subscription path, so a user with no profiles sees no change.
- [ ] The milestone inspection includes the **positive** environment check. A proof that only shows absence everywhere is consistent with the key never having been injected at all.
- [ ] No untracked / `_verify/` / `docs/` files staged or reverted.
