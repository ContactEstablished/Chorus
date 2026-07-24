# Implementation Spec 3-6 — BYOK Env Injection + Test-Key

_Companion to `Tasks/Task-3-6.md`. The task doc governs **scope**; this doc governs **exact contents, insertion points, and rationale**. Code blocks are starting points to adapt to the surrounding file's conventions — not byte-for-byte mandates — **except** where marked **EXACT**._

**Originally anchored to `fb3201e` (2026-07-22); RE-ANCHORED 2026-07-24 to `ddb5454`** — Task 3-5 has landed (its code sits in `d3b6f30` per **D40**), so the scrubber seam this spec consumes is real and coordinator-verified. Baseline: typecheck 0 · **254/254 across 12 files** · `grep:secrets` clean. Re-verify at execution.

**Installed CLIs moved since authoring:** `claude.exe` **2.1.218**, `codex-cli` **0.145.0**. Every D4 claim below was read against 2.1.215 / 0.144.6 and re-checked on 2026-07-24 — see §3a.3 for what changed.

---

## 0. `src/main/services/sessionOutput.ts` — COMMIT 1, the session-shaped scrub seam

**Create.** D45 mitigation 1, placed in this task by **D46**. Behaviour-neutral; lands before any BYOK work.

Today the entire output pipeline is inlined in `SessionManager.spawn`, closed over `child` and `session`. That is what makes it PTY-bound: not a dependency on node-pty, but the fact that it only exists inside the function that spawns one. Extract it whole.

```ts
/**
 * The ONE place session output is scrubbed, buffered and broadcast — for ANY
 * session type. D45(1): scrubbing is a property of "a session emits text", not
 * "a PTY emits text", so a second session type cannot ship unredacted by
 * forgetting a second wiring point. That is the F26 failure shape, and F26 was
 * only found because a live A/B happened to expose it.
 *
 * Deliberately free of electron and node-pty: a PTY drives it from onData, and
 * an api-mode session would drive it from `for await (… of handle.receive())`.
 * The flush timer lives HERE, not in scrubber.ts — the pure scrubber stays
 * timer-free and RegExp-free, and its grep gate still holds.
 */
export interface SessionOutput {
  /** Feed raw text from any source. Scrubs, appends to the ring buffer, and
   *  broadcasts — ONCE, from a single computed string. */
  ingest(text: string): void
  /** Release any held carry. Timer-driven, and called at session end. */
  flush(): void
  /** The replay buffer, already scrubbed. `attach()` returns this. */
  readonly buffer: string
  /** Clear timers. The scrubber's match set dies with this object. */
  dispose(): void
}

export function createSessionOutput(opts: {
  readonly secrets: readonly string[]
  readonly maxChars: number
  readonly flushMs: number
  /** Broadcast callback. SessionManager passes its dataListeners fan-out. */
  readonly onText: (text: string) => void
}): SessionOutput
```

**Move, do not rewrite.** The existing `emit` helper, the clear-push-reschedule block and the exit flush are already correct and were runtime-proven on 2026-07-24. Relocate them verbatim into `ingest`/`flush` and change nothing about their order. The five invariants in Task 3-6 Step 0 are not style preferences — each is load-bearing:

- **One `push()` per chunk**, its result used for *both* the buffer append and the broadcast. Two calls advance the carry twice and corrupt the stream.
- **Clear timer → push → reschedule.** Node is single-threaded, so a timer callback cannot interleave inside the function body; that is what makes the ordering correct *by construction* rather than by luck.
- **Flush before notifying exit**, so the final bytes precede the exit event.
- **Timer cleared on exit and in `dispose()`.**
- **The closure is the storage** for the match set (D33 resolution (a)) — introduce no separate structure.

In `SessionManager.spawn`, the wiring collapses to:

```ts
const output = createSessionOutput({
  secrets,
  maxChars: BUFFER_MAX_CHARS,
  flushMs: SCRUB_FLUSH_MS,
  onText: (text) => { for (const l of this.dataListeners) l(id, text) }
})
child.onData((data) => output.ingest(data))
child.onExit(({ exitCode }) => {
  session.status = 'exited'; session.exitCode = exitCode
  output.flush()                 // BEFORE notifying — invariant 3
  for (const l of this.exitListeners) l(id, exitCode)
})
```

`PtySession.buffer`/`scrubber`/`scrubTimer` are replaced by a single `output: SessionOutput`, and `snapshot()` reads `session.output.buffer`. **Keep `status`/`exitCode` on the session** — they are lifecycle, not output, and an api session will want them too.

**Construction stays in the same synchronous block as `pty.spawn` and the `onData` wiring.** One tick later and the first chunk — exactly when a shell might echo its environment — is lost or unscrubbed.

**Tests (`sessionOutput.test.ts`), with `flushMs` injectable so fake timers work:** one-push-per-chunk (assert buffer and broadcast receive the identical string instance or value, from a scrubber spy counting calls); ordering under a chunk arriving while a flush is pending; flush-before-exit; `dispose()` clearing a pending timer; ring-buffer trim applied to *scrubbed* text; and the identity fast path (no secrets → input passes through untouched).

**Proof obligation:** the 19 existing scrubber tests pass **unchanged**, and Task 3-5's runtime items 1–4 are re-driven against the refactored seam **before Commit 2 starts** (`_verify/3-5/probe.js` reports booleans and counts only). A redaction-path refactor that is not re-proven at runtime is believed-neutral, not proven-neutral.

---

## 1. The one-owner rule, made concrete

D34(d) put env policy in exactly one place. This is what that means in code:

| Who | Owns |
|---|---|
| **Adapter** | what *this agent* needs: `requiredEnvVars` (names to preserve), `envAdditions` (non-secret extras), `secretEnv` (the credential, keyed by its resolved name) |
| **`composeChildEnv` (main)** | the **policy**: inherit-wholesale vs allow-list, and what the baseline allow-list is |
| **`SessionManager`** | calling the policy once, per spawn |
| **Nobody else** | — |

The failure mode this prevents is the one the findings walked into: each adapter receiving the full environment *and* separately declaring `requiredEnvVars` so main could rebuild the same list. Two owners, one rule, guaranteed drift.

---

## 2. `src/main/adapters/env.ts`

**Create.** Pure — it takes the environment as a **parameter**. A function that reads `process.env` internally is untestable, and this is the function that most needs testing.

```ts
/**
 * The Windows baseline every child process needs regardless of agent (D33
 * clause 4 + council finding [MEDIUM] "Environment allow-list under-specified
 * for Windows/ConPTY"). Entries beyond the council's list are ADDED ONLY BY
 * EMPIRICAL NECESSITY — each one must have been observed to break an agent
 * when absent, and the reason recorded here. Do not add speculatively: an
 * over-broad allow-list silently reintroduces the ambient-credential leak this
 * whole mechanism exists to close.
 */
export const BASELINE_ENV_VARS: readonly string[] = [
  'PATH',
  'SystemRoot',
  'TEMP',
  'TMP',
  'HOMEDRIVE',
  'HOMEPATH',
  'USERPROFILE'
  // ↓ additions from the Task 3-6 empirical pass go here, each with a comment
  //   naming what broke without it.
]
```

**Start from exactly the council's seven.** Then launch both CLIs and expand. Strong candidates, listed so the implementer recognises them rather than rediscovering them — **but none is pre-approved**; each still has to earn its place by breaking something:

- `SystemDrive`, `windir`, `COMSPEC`, `PATHEXT` — Windows/ConPTY and shim resolution. `COMSPEC` in particular is worth watching: Codex is spawned through `cmd.exe /c`.
- `APPDATA`, `LOCALAPPDATA`, `ProgramData`, `ProgramFiles` — where CLIs keep config and caches.
- `NUMBER_OF_PROCESSORS`, `PROCESSOR_ARCHITECTURE`, `OS` — some Node builds and native modules read these.
- `USERNAME`, `USERDOMAIN`, `COMPUTERNAME` — occasionally used for telemetry identity.

**`APPDATA`/`USERPROFILE` deserve explicit thought rather than reflexive inclusion.** They are where Claude Code keeps its subscription credentials. Including them on a BYOK launch means the agent can still see its subscription auth and may prefer it over the injected key — quietly defeating billing separation. Excluding them may break the CLI entirely. **Determine which empirically and write down what you found**, because whichever way it goes it is a fact the next phase needs.

```ts
export interface ComposeInput {
  /** The parent environment, passed in so this function stays pure. */
  readonly parentEnv: NodeJS.ProcessEnv
  /** Adapter-declared names to preserve beyond the baseline. */
  readonly requiredEnvVars: readonly string[]
  /** Adapter-declared non-secret additions. */
  readonly envAdditions: Readonly<Record<string, string>>
  /** The injected credential(s). EMPTY means this is a no-credential launch,
   *  and that distinction — not a boolean flag — is what selects the policy. */
  readonly secretEnv: Readonly<Record<string, string>>
}

export function composeChildEnv(input: ComposeInput): Record<string, string> {
  const { parentEnv, requiredEnvVars, envAdditions, secretEnv } = input

  // ── D33 resolution (c): NO CREDENTIAL → INHERIT WHOLESALE ──────────────
  // Exactly today's behavior (D5), preserved deliberately and permanently.
  // Ambient keys riding along on a no-profile launch is today's behavior and
  // stays: this feature adds a way to be explicit, it does not take away the
  // developer's own environment. Applying the allow-list here would be a
  // silent behavior change to every existing session in the app.
  if (Object.keys(secretEnv).length === 0) {
    return { ...parentEnv } as Record<string, string>
  }

  // ── Credential-bearing → CONSTRUCTED ALLOW-LIST ────────────────────────
  const out: Record<string, string> = {}
  for (const name of [...BASELINE_ENV_VARS, ...requiredEnvVars]) {
    const v = parentEnv[name]
    // Skip absent vars rather than emitting `undefined`, which node-pty would
    // stringify into the literal text "undefined".
    if (typeof v === 'string') out[name] = v
  }
  Object.assign(out, envAdditions)
  // Secrets last: an injected credential always wins over anything inherited
  // or added under the same name.
  Object.assign(out, secretEnv)
  return out
}
```

**The `if` is the entire policy**, and it is why `secretEnv` being empty-vs-non-empty is the discriminator rather than a separate `hasCredential` boolean: there is no way to have a credential and forget to apply the allow-list, or vice versa, because they are the same fact.

---

## 3. Resolving the env var name (D34(e))

Pure, colocated with `env.ts`, and unit-tested on its own:

```ts
/** D34(e) precedence: a provider's env_var_name override beats the adapter's
 *  AuthMethodDefinition.requiredEnvVar default. Null from both means this auth
 *  method injects nothing — a subscription method, or an adapter whose API-key
 *  variable could not be D4-verified (in which case api_key auth must be
 *  refused rather than guessed at). */
export function resolveEnvVarName(
  providerOverride: string | null,
  adapterDefault: string | null
): string | null {
  return providerOverride ?? adapterDefault
}
```

The `null` case is not a formality. Task 3-6's step 1 requires that an unverifiable variable name be declared `null` rather than guessed — and this function is where that `null` has to be handled by **refusing the launch with a clear reason**, not by injecting under a made-up name.

---

## 3a. The precedence problem — the one that can make this whole task a silent no-op

_Added 2026-07-23 after the coordinator read both CLIs' `--help` on this machine. It is the most likely way this task ships something that looks finished and is not._

### 3a.1 The failure it describes

Injecting a key proves nothing about which credential the agent **uses**.

Claude Code reads OAuth and keychain credentials in normal operation — established by `--bare`, which documents itself as the mode where *"Anthropic auth is strictly `ANTHROPIC_API_KEY` or `apiKeyHelper` via `--settings` (OAuth and keychain are never read)"*. The existence of a flag that must explicitly stop reading them proves normal mode reads them. What the help text does **not** say is what happens when a subscription login and `ANTHROPIC_API_KEY` are both present.

If OAuth wins, then Chorus injects a key, the key sits in the child's environment, the key appears in no log and no command line and no ring buffer — **and every single check in §9's milestone inspection passes** while the agent bills the user's subscription. The inspection is built entirely from absence checks plus one presence check on the environment block, and this failure is invisible to all of them. That is why §9.1 already insists on a positive check, and why it is not sufficient on its own.

This is the same family as §2's `APPDATA`/`USERPROFILE` question, and sharper: there, excluding a variable might break the agent; here, *including* the subscription's credential path might silently defeat the feature. **Resolve them together** — the empirical pass that determines the allow-list is the natural place to determine precedence too.

### 3a.2 How to settle it

Ask the CLI, do not infer. Candidates, in order of directness: `claude auth`, an in-session `/status`, and `-d/--debug` with the `api` category filter. Run with a valid subscription login present **and** an injected key, and record the command and its verbatim output.

Three outcomes:

| Outcome | What it means | What to do |
|---|---|---|
| **Injected key wins** | The design holds as specified. | Record the evidence and proceed. |
| **OAuth/keychain wins** | **BYOK is not deliverable for Claude Code by env injection alone.** | Evaluate `apiKeyHelper` via `--settings` as a documented alternative — but see §3a.4 before writing a key anywhere. If nothing non-destructive works, **declare `api_key` unsupported on this adapter for Phase 3** and raise it for a scope decision. |
| **Indeterminate** | You do not know. | Report indeterminate and mark the criterion **FAILED**. An unproven precedence claim is worse than an honest unknown, because it will be cited later as evidence. |

**Do not reach for `--bare`.** It would force API-key-only auth and settle the question, but it also disables hooks, LSP, plugin sync, attribution, auto-memory, background prefetches, keychain reads, and CLAUDE.md auto-discovery, and sets `CLAUDE_CODE_SIMPLE=1`. Using it as an auth switch would degrade every BYOK session into a crippled agent — a far larger behaviour change than this task is scoped for, and one no decision authorises.

### 3a.3 Codex is a different shape entirely

Codex's documented API-key path is **not an environment variable**:

> `codex login --with-api-key` — *"Read the API key from stdin (e.g. `printenv OPENAI_API_KEY | codex login --with-api-key`)"*

The env var in that example is a **source the user pipes from**, not something Codex reads at runtime. Codex maintains its own credential store (`codex logout` removes "stored authentication credentials"; config lives at `~/.codex/config.toml`; `codex login status` reports state). **Whether Codex honours `OPENAI_API_KEY` from its process environment is unverified and may simply be false.**

If it does not, **env injection cannot deliver BYOK for Codex**, and the sanctioned outcome is to say so: declare `apiKey: false` and omit the `api_key` auth method from the Codex adapter for Phase 3, ship BYOK for Claude Code only, and record it as a scope finding for Phase 3a. **A phase that delivers BYOK for one of two agents, honestly labelled, is a better outcome than one that appears to deliver both.**

Also noted, observational only: `-c shell_environment_policy.inherit=all` shows Codex owns what the shells *it* spawns inherit. That is Codex's policy, not Chorus's, and it bears on whether an agent can echo an injected key at all (Task 3-5's scrubber). Record it; do not act on it.

**Re-checked against codex 0.145.0 on 2026-07-24 — the finding above SURVIVED the version bump, and three facts were added:**

- `--with-api-key` **still reads from stdin**, and **`OPENAI_API_KEY` appears nowhere in `--help` as a runtime variable**. Treat "env injection cannot deliver BYOK for Codex" as the *expected* result and design the reporting for it: the honest declaration in §3a.3 is now the likely path, not the fallback.
- **`-m, --model <MODEL>` exists**, and `-c model="o3"` is documented. Codex can be told an arbitrary model id — half of **D43**'s question (ii).
- **`-c key=value` overrides any `~/.codex/config.toml` value without writing the file.** This is genuinely useful for **non-secret** settings (base URL, model) and is the natural way to point Codex at an OpenAI-compatible endpoint. **🔴 But `-c` is argv, and argv is world-readable to the same user** (`Get-CimInstance Win32_Process`). A base URL through `-c` is fine; **a credential through `-c` is Non-Goal #1 and §3a.4's bright line in a more tempting costume.** It looks like config, it behaves like a command-line argument.
- **`--remote-auth-token-env <ENV_VAR>`** exists — "Name of the environment variable containing the bearer token to send to a remote app". It concerns a *remote app*, not the model provider, so it is **not** to be assumed a BYOK path. It is, however, the only env-var-shaped auth surface Codex exposes, so probe it once before declaring `api_key` unsupported, and record what you find either way.

### 3a.4 The bright line

Three mechanisms would "solve" this and **must not be implemented**:

- Chorus invoking `codex login --with-api-key` on the user's behalf.
- Chorus writing a decrypted key into `~/.codex/config.toml`, a `--settings` file, or an `apiKeyHelper` script on disk.
- **Passing a key through `codex -c <key=value>`** (added 2026-07-24). This one is the most dangerous of the three because it does not *look* like a violation — it reads as configuration, and the surrounding `-c` usage for base URL and model is entirely legitimate. But `-c` is **argv**, so the key would be published to every process the user can enumerate. It is Non-Goal #1 verbatim, arrived at by a side door.

Both make Chorus **persist a decrypted credential into another tool's on-disk store**, outside DPAPI and outside the vault. That is a materially different threat model from "inject into a child process's environment block for the lifetime of that process" — different persistence, different blast radius, different cleanup story — and **D33 reviewed none of it**. The council's contract is explicit that the child's environment is the injection surface (clause 5) and that the documented, unavoidable limit is same-user process inspection. Writing to disk adds a limit nobody agreed to.

If you conclude one of these is genuinely necessary, that is a **Council Review trigger** under roadmap §4 — security-sensitive surface, credential handling. **Flag, brief, pause.** Do not implement it and do not let it ride as a deviation.

## 3b. The OpenRouter route — the BYOK vehicle (D47)

_Added 2026-07-24. Without this the phase ships its whole BYOK stack unexercised: **D44** makes Claude and GPT subscription-only, so there is nothing else to inject a key into._

### 3b.1 Why codex, and why not Claude Code

**OpenRouter exposes only an OpenAI-compatible endpoint** (`https://openrouter.ai/api/v1/chat/completions`). Codex is an OpenAI-shaped client, so it is protocol-compatible. **Claude Code is not** — it speaks the Anthropic Messages shape, and no environment variable bridges a wire-format difference. Pointing `ANTHROPIC_BASE_URL` at OpenRouter is *architecturally impossible*, not merely unverified; the translating proxy that would fix it is exactly what D42 declined. **Do not spend session time attempting it.**

### 3b.2 The mechanism — D4-verify before relying on it

Codex reads custom providers from `[model_providers.<name>]`:

| Field | Value for OpenRouter | Secret? |
|---|---|---|
| `base_url` | `https://openrouter.ai/api/v1` (**no trailing slash** — a trailing slash is a known failure) | no |
| `env_key` | the **NAME** of the env var Codex reads **at runtime** for the bearer token | no — it is a *name* |
| `wire_api` | `"chat"` (OpenRouter implements `/chat/completions`, not the newer `responses` endpoint) | no |
| `requires_openai_auth` | possibly `false` — OpenRouter keys use an `sk-or-` prefix Codex may otherwise validate | no |

**`env_key` is the entire reason this route satisfies D33.** Codex does not want the key in a file, in argv, or through `codex login` — it wants to be *told which environment variable to read*. That is precisely what `composeChildEnv` already produces, and what `provider_configs.env_var_name` (D34(e)) already stores.

### 3b.3 Supply it per-launch, never by writing the user's config

```ts
// codex.ts buildLaunch — NON-SECRET args only. The key is NOT here; it reaches
// the child through secretEnv -> composeChildEnv -> the process environment.
args.push(
  '-c', `model_provider=${providerKey}`,
  '-c', `model_providers.${providerKey}.base_url=${baseUrl}`,
  '-c', `model_providers.${providerKey}.env_key=${envVarName}`,
  '-c', `model_providers.${providerKey}.wire_api=chat`
)
if (modelId) args.push('-m', modelId)
```

**Do NOT write `~/.codex/config.toml`.** It is not forbidden by §3a.4 (a base URL is not a credential), but it mutates a file Chorus does not own, persists beyond the session, and would have to be cleaned up. Per-launch `-c` leaves nothing behind. **Assert the file's mtime is unchanged across the whole session** as part of the proof.

**The `-c` asymmetry is the trap to internalise:** `-c` is **argv**. A base URL, an env-var *name*, and a wire-api string there are all fine. **A key there is Non-Goal #1**, and it will look perfectly reasonable in a diff. §3a.4 names it as the third bright line for exactly this reason.

### 3b.4 The model id — `provider_configs.model`, migration v6 (D48)

**The route carries its own default model.** D48 supersedes D47(3)'s launch-dialog field: D43 defines the launchable unit as (agent × route × model), and a route that cannot name its model is two-thirds of one. `provider_configs` already holds the route's other non-secret connection metadata, so the model belongs beside it.

**Migration v6 — append to the `MIGRATIONS` array in `storage.ts`:**

```sql
ALTER TABLE provider_configs ADD COLUMN model TEXT;
```

One statement, **nullable**, exactly the shape of v3's `ALTER TABLE sessions ADD COLUMN title TEXT;`. Mirror it in `schema.ts`'s `providerConfigs` definition so Drizzle's inferred types match the DDL — the two must not drift.

**Nullable is semantic, not laziness:** a subscription route has no model to name. `buildLaunch` emits `-m <model>` **only** when the provider carries one; a `NULL` model must never become the literal string `"null"` or `"undefined"` on the command line.

**It is a DEFAULT, not an authority.** Phase 3a's `launch_profiles` will override it once profiles exist. Writing it down this way keeps 3a's design open instead of creating two competing homes for "which model".

**It is NOT a `model_catalog`.** One nullable scalar per route, hand-entered on the provider form in `SettingsProviders.vue` — **no list, no fetch, no refresh**. The Phase 3 non-goal barring catalogs stands unamended, and a "helpful" model dropdown fetched from OpenRouter would violate it.

**⚠ Run the full Task 3-2 migration protocol.** A schema change in this task was deliberately avoided until D48 accepted its cost, so it does not get a lighter proof for being one short line: three dumps (pre / post / second boot) on the **real** dev DB, v1–v5 `applied_at` byte-identical, every pre-existing table row-identical, v6 not re-applied on boot 2. **The risk lives in the runner and the real database, not in the DDL.**

### 3b.5 What this route proves that nothing else can

It closes the milestone on a **real** end-to-end BYOK proof — a live agent answering a prompt while authenticated by an injected key — rather than on machinery that compiles and is never exercised. It is also the first thing to exercise `provider_configs.base_url` and D34(e)'s `env_var_name`, both dormant since Task 3-2.

**And it removes the precedence hazard §3a was built around.** Pointed at OpenRouter, a wrong-credential choice fails **visibly** — a ChatGPT subscription token is not valid there — so the silent-billing failure mode that made the old Step 1a dangerous cannot occur on this path. The positive check in §9.1 remains mandatory, but it is no longer the only thing standing between you and a false pass.

---

## 4. The launch path — `src/main/ipc.ts`

The credential resolution is a **narrowly-scoped async helper** (D33 action 6) that returns a `ResolvedCredential` and retains nothing:

```ts
/**
 * Resolve + decrypt a credential profile for one launch. D33 clause 4: the
 * plaintext exists in this function's scope and in the returned object, and
 * nowhere else in main — it is not cached, not memoized, not attached to any
 * long-lived object, and never passed to anything that logs its arguments.
 *
 * Returns a discriminated result rather than throwing, because every failure
 * here is a CONTRACT path (clause 8) that must surface as an inline refusal.
 */
async function resolveCredential(
  profileId: string,
  adapter: PtyAgentAdapter,
  authType: 'subscription' | 'api_key'
): Promise<{ ok: true; credential: ResolvedCredential } | { ok: false; reason: string }>
```

Order of operations inside, and each step's reason:

1. **Load the profile row.** Missing → refuse (`"That credential profile no longer exists."`).
2. **`unavailable_since` already set** → refuse immediately with the label-only message. **Do not attempt to decrypt again**; the row is already known bad and a retry only widens the window.
3. **Load the provider row**, resolve the env var name via `resolveEnvVarName`. `null` → refuse: `"Provider '<name>' has no API-key environment variable configured."`
4. **`await vault.decryptForLaunch(id)`.** Failure → the vault has already marked `unavailable_since`; refuse with its message.
5. **Build `{envVarName, value, isSecret: true}`** and return it.

**The envelope → credential join (3-2 implementer finding F-3, coordinator-ratified 2026-07-23).** `vault.decryptForLaunch` returns a `ResolvedEnvelope = {key, baseUrl?, extraHeaders?}` (D33 clause 1); the adapter seam takes the flat `ResolvedCredential = {envVarName, value, isSecret: true}`. The mapping is **this helper's job**, stated here so it is not re-invented at the call site:

- `value = envelope.key` · `envVarName` = provider override ?? adapter default (D34e, §3 above) · `isSecret: true`.
- `envelope.baseUrl` (with the provider's plaintext `base_url` as fallback — **envelope overrides provider**, D33(e)) maps to the provider's base-URL **env var** for the PTY launch — e.g. `ANTHROPIC_BASE_URL`, **D4-verify the exact name** before hardcoding. It is non-secret: it goes in `envAdditions`, not `secretEnv`, so it is neither scrubbed nor redacted. **⚠ Established 2026-07-24: no base-URL variable appears in `claude --help` at all**, so `--help` cannot be the D4 source here. Either verify the name against Anthropic's own published documentation, or **declare it `null` and defer the base-URL mapping entirely** — an unverified variable name produces a silent no-op, which is worse than an absent feature. Deferring costs little: the base URL only matters for custom/OpenAI-compatible endpoints, which is Phase 3a's launch-profile territory (**D43**), not this task's milestone.
- `envelope.extraHeaders` has **no PTY env mapping** — custom headers are an api-mode concern (Phase 3b's council members). For Phase 3, a credential whose envelope carries `extraHeaders` launches fine and the headers are simply unused by the PTY path; do not invent an env encoding for them. The test-key probe (§7), which speaks HTTP directly, **does** apply them.

In the handler:

```ts
// Decrypt BEFORE SessionManager.launch(), which is synchronous. The handler
// has been async since Task 2-2, so this costs nothing structurally.
const cred = req.credential_profile_id
  ? await resolveCredential(req.credential_profile_id, adapter, authType)
  : null
if (cred && !cred.ok) return { ok: false, reason: cred.reason }
```

**The refusal must happen before the session row is created.** Task 2-2's new-worktree branch established the discipline — it deletes its own row on every failure branch precisely because a half-created session is debris that later trips the F16 FK. Refusing first is simpler than cleaning up after.

Then:

```ts
const snap = sessions.launch(
  req.agent,
  cwd,
  row.id,
  cred?.ok ? [cred.credential.value] : []   // ← Task 3-5's registration seam, now used
)
```

and the credential travels into `buildLaunch` via the `PtyLaunchSpec`.

---

## 5. `SessionManager` — composition and registration

```ts
  private spawn(agent: AgentKind, cwd: string, sessionId: string, secrets: readonly string[]): PtySession {
    const adapter = getAdapterOrThrow(agent)
    if (!isPtyAdapter(adapter)) throw new Error(`Agent '${agent}' is not a PTY agent`)
    const request = adapter.buildLaunch({ sessionId, cwd, credential })

    // SUPERSEDES D5 (Phase 0 → Task 3-6). Env policy has ONE owner and this is
    // the call site (D34(d)): a launch with no credential inherits process.env
    // wholesale, exactly as it always has; a credential-bearing launch gets a
    // constructed allow-list so the developer's ambient provider keys do not
    // ride along (D33 clause 4 + resolution (c)).
    const env = composeChildEnv({
      parentEnv: process.env,
      requiredEnvVars: adapter.requiredEnvVars,
      envAdditions: request.envAdditions,
      secretEnv: request.secretEnv
    })

    const child = pty.spawn(request.executable, [...request.args], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: request.cwd,
      env,
      useConpty: true
    })
```

**The scrubber must be constructed before `pty.spawn` returns and before any `onData` handler can fire.** After Commit 1 (§0) this means building the **`SessionOutput`** — which owns `createScrubber(secrets)` internally — and registering `onData` in the same synchronous block, exactly as the pre-refactor code did. A construction that happens one tick later would leave the very first chunk unscrubbed, and the first chunk is exactly when a shell might echo its environment. _(Written against the pre-refactor shape; §0 is the current one. The requirement is unchanged — only the object being constructed differs.)_

`secrets` should come from `request.secretEnv`'s **values** rather than being threaded separately, so there is structurally no way to inject a value without registering it:

```ts
// Derive from what is ACTUALLY being injected, so "injected" and "scrubbed"
// cannot diverge. A separately-passed list is a second source of truth and
// therefore a way to inject something the scrubber never hears about.
const injected = Object.values(request.secretEnv)
```

That is a small but real improvement over the `launch(..., secrets)` parameter 3-5 declared. **Keep the parameter** (the restore path in §6 needs a way to supply values) but let the spawn-time set be the union of both, deduplicated by `createScrubber` — which after §0 means passing that union as `createSessionOutput({ secrets })`. `createScrubber` already dedupes, empty-filters and sorts longest-first, so the union needs no pre-processing at this call site.

---

## 6. The restore-path decision

Task 3-5 flagged it; this task must settle it. The restore engine re-spawns from a `sessions` row, which records `agent` and `cwd` but **not** which credential profile launched it. So a restored BYOK session currently gets no key and an empty match set.

**No longer a reasoned inference — it is roadmap finding F26, reproduced on the real dev DB during the Task 3-5 coordinator re-drive (2026-07-24).** A restored session emitting the planted probe value showed `valuePresent: TRUE` / `placeholderCount: 0`, while a freshly-launched registered session in the same boot redacted it to `[REDACTED-CREDENTIAL]` with no surviving fragment. Same boot, same command, same machine — the only difference was registration. Two things follow: the gap is **real and demonstrable**, so option (b) below must render honest chrome rather than hoping the case is rare; and there is now a **known-good runtime harness** for whichever option is chosen (`_verify/3-5-coord/`, plus `_verify/3-5/probe.js`, which reports booleans and counts only and never the value itself).

Two honest answers:

**(a) Persist the profile id and re-resolve at restore.** Add `sessions.credential_profile_id` (migration v6) and have `restore()` resolve and decrypt exactly as the launch path does. Faithful to the user's intent; costs a migration this task did not plan; and it means the restore engine — which runs unattended at boot — performs decryption, which is a slightly wider surface than "decrypt when the user asks to launch".

**(b) Do not auto-restore credentialed sessions.** Leave them as exited chrome with an honest reason ("Relaunch to re-supply the credential"), reusing the existing cwd-missing chrome pattern. No migration, no unattended decryption, and the user re-launches explicitly. Costs restart-safety for exactly the sessions BYOK users care most about.

**Recommendation: (b) for Phase 3**, and it is the recommendation because of scope honesty rather than security: (a) needs a migration, a schema change, and a restore-path decrypt — three things this task's scope table does not contain, arriving in the phase's last and most security-critical session. (b) is implementable inside the existing chrome vocabulary, and Phase 3a's `launch_profiles` work is the natural home for (a), since a launch profile is exactly "the configuration that reproduces this launch".

**Whichever is chosen, state the reasoning in the commit message and add it to the roadmap's open items.** The unacceptable outcome is silence — a restored session that runs on ambient credentials while the user believes it is running on their profile.

---

## 7. Test-key

### 7.1 The probe

```ts
/** ONE live call. No retry, no backoff, no cache, no catalog (D28). The result
 *  is a boolean and a sanitized message — nothing from the provider's response
 *  body reaches the renderer unfiltered. */
async function probeCredential(
  envelope: ResolvedEnvelope,
  provider: ProviderConfigRow
): Promise<{ ok: true } | { ok: false; reason: string }>
```

Use Node's built-in `fetch` with an `AbortSignal.timeout(…)` of roughly 10 s — matching the CLI-probe timeout already in `cliDetect`. The endpoint and header shape are **D4 material**: verify against the provider's own documentation in the session, and record what you used.

### 7.2 The three leakage paths, all of which must be closed

1. **The response body.** A 401 body can echo the submitted key back (some gateways do). **Never** put a response body into the message. Map status codes to fixed strings: 401/403 → `"Authentication failed — the credential was rejected."`, 429 → `"Rate limited by the provider."`, 5xx → `"The provider returned an error."`, other → `"Unexpected response (<status>)."`
2. **The fetch exception.** A `TypeError: fetch failed` carries a `cause` chain that can include the request — including headers. Catch, discard, and emit a fixed `"Could not reach the provider."`
3. **Anything that does escape.** Pass every outbound message through `scrubSecrets` from `logger.ts` as a final net. It is one call, it costs nothing, and it is the difference between "we thought about it" and "it cannot happen".

The task requires all three to be **exercised** (invalid key, unreachable host, DNS failure), not merely coded.

### 7.3 It runs only when asked

D33 resolution (d) added a Test-key carve-out to the honest guarantee: *"…except the explicit Test-key action, which sends an authentication probe to the provider's own API at your request."* **"At your request" is load-bearing.** Grep the handler's callers and confirm nothing reaches it from boot, a timer, the launch path, or profile creation. The guarantee text the user reads must remain true.

On success, `markCredentialVerified(id, new Date().toISOString())` — the one caller `last_verified_at` has ever had.

---

## 8. Launch dialog

The dialog gains an auth-method choice and, when `api_key` is selected, a credential-profile select. Two rules:

- **Default to subscription.** A user with no credential profiles must see a dialog that behaves exactly as it does today. The BYOK path is opt-in, and "no visible change unless you use the feature" is what makes this shippable.
- **The dialog sends a profile id, never a key.** It has no way to obtain a key — 3-2's write-only IPC guarantees it — so this is structural rather than disciplinary. Say so in a comment, because a future contributor may try to "pre-validate" a key in the renderer.

Filter the profile list to those whose provider's `adapter_type` matches the selected agent, and exclude `unavailableSince` profiles from selection (they would refuse at launch anyway; offering them is a worse experience than hiding them, and the Settings view is where their state is explained).

---

## 9. The milestone inspection — getting the evidence right

### 9.1 The positive check is not optional

Four of the five surfaces are absence checks. **Absence everywhere is also what a completely broken injection looks like.** The environment-block read in check 2 is the only positive evidence that the mechanism does anything at all, and it is the first thing a reviewer should look for in the summary.

**It is necessary and still not sufficient** — see **§3a**. The environment-block check proves the key was *delivered*; it does not prove it was *used*. An agent that reads its subscription credential in preference to the injected key passes check 2 and every absence check simultaneously. The precedence evidence from §3a.2 is the other half of this proof, and neither half stands alone.

Read the child's environment from outside the app — a WMI/CIM query or a small native call against the agent PID — rather than by having the agent print it, so the evidence is independent of the scrubber that is simultaneously being tested. (Having the agent `echo` it is check 4's job, and it proves the *scrubber*, not the injection.)

### 9.2 Walk the process tree, never name-match

There are roughly 16 unrelated `claude.exe` processes on this machine (F-series harness caveat). Enumerate descendants of the electron main PID via `ParentProcessId`. A name match would sample other people's processes and produce a meaningless result — in either direction.

### 9.3 The negative control carries as much weight as the milestone

A subscription launch must be unchanged. Capture its environment block too and confirm it is the full inherited set — that is what proves resolution (c) is implemented rather than described. Claude Code's expired-token screen is the expected outcome for that agent and should be reported as a **pass**, with a sentence saying why.

### 9.4 The planted key

Realistic shape, obviously fake, generated in the session, never committed, never real. Long enough to match the `anthropic` pattern in `secret-patterns.json` so the ≥ 8-character substring checks are meaningful. When the session ends, it dies with it.
