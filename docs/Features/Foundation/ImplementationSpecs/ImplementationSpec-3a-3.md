# Implementation Spec 3a-3 — Per-Dispatch Token & Cost Attribution

_Companion to `Tasks/Task-3a-3.md`. The task doc governs **scope**; this doc governs **exact contents, module shape, insertion points, and rationale**. Code blocks are starting points to adapt to the surrounding file's conventions — not byte-for-byte mandates — **except** where marked **EXACT**._

**Anchored to `15a016e`** (code HEAD for `src/`, 2026-07-24). Baseline: typecheck 0 · **273/273 across 14 files** · `grep:secrets` clean (6 patterns). **Task 3a-1 lands between authoring and execution and moves the schema underneath §5 — re-anchor before writing any DDL.**

**⚠ This is the first task in the repo that mints, holds, and revokes credentials Chorus itself created.** A minted key is a **real key with real spend attached**. Everything D33 says about a user's key applies to it without dilution, and two things apply *only* to it: it can be orphaned, and it can be uncapped. §6 and §7 exist for exactly those two.

---

## 0. What this task is, in one paragraph

A dispatch is one agent session doing one unit of work. For an **`api_key`** session, Chorus mints a short-lived OpenRouter key with a hard credit cap, injects **that** key instead of the user's, and at session end reads what it spent and destroys it — so attribution holds **regardless of whether the CLI forwards any metadata**, which is precisely why the naive `metadata: {task_id}` approach in Mission Control spec §5.1 fails. For a **`subscription`** session, Chorus does **none of that**, because routing a flat-rate subscription through a gateway converts it to per-token billing and a cost-tracking feature that increases cost is worse than no cost tracking. The gap between the two is not hidden: it is published as **"% of spend attributed"**.

---

## 1. Module shape — the pure/impure split, and why each line is where it is

Four new modules. The split follows the house precedent exactly: `vaultCore.ts` ↔ `vault.ts`, `restore.ts` (`computeRestoreSet`) ↔ `sessionManager.ts`, `computeWorktreeReconcile` ↔ `GitWorktreeManager`.

| Module | May import | Owns |
|---|---|---|
| `attributionCore.ts` | nothing but types | **Every decision.** Strategy selection, mint-request construction, response interpretation, the failure vocabulary, orphan classification, "% attributed" arithmetic. **No `electron`, no `fetch`, no `node:fs`, no `Date.now()`** — time is a parameter. |
| `openrouterKeys.ts` | `attributionCore`, `logger` | **The ONLY `fetch` against `/api/v1/keys*` and `/api/v1/analytics/query`.** Transport, headers, timeouts, and the sanitize-on-the-way-out net. Zero policy. |
| `dispatchAttribution.ts` | everything | **Wiring.** Lifecycle hooks, the write-ahead ledger, the boot key-reconcile, the deferred backfill. Delegates every judgement to `attributionCore`. **It never opens or closes a `dispatches` row** — 3a-1's `DispatchRecorder` owns row lifecycle; this service only enriches an existing row, and its methods are named `mintForDispatch` / `settleDispatch` / `reconcileOrphanedKeys` so the two are never confused at a call site. |
| `subscriptionMeter.ts` | `node:fs`, `logger` | CLI-log metering for subscription sessions. **No network. No gateway. Ever.** |

**Why the core must be fetch-free as well as Electron-free:** the decisions worth testing here are *"is this key ours?"*, *"does this auth mode get a gateway?"*, *"what does a 401 turn into?"*. A test that has to stand up an HTTP stub to ask those questions will be written once and never extended. `vaultCore.ts` earned its shape for the same reason and its tests are the most valuable in the vault.

### 1.1 `attributionCore.ts` — the normative surface

```ts
/* ── Strategy: keyed on AUTH MODE, and on nothing else (D42) ──────────── */

/** The three honest answers. `'minted-key'` is full fidelity; `'cli-logs'` is
 *  deliberately lower fidelity and keeps the flat rate; `'none'` is what an
 *  api_key session gets when no management key is configured — it is NOT a
 *  silent fallback to minting, and it is NOT an error. */
export type AttributionStrategy =
  | { readonly kind: 'minted-key'; readonly limitUsd: number; readonly ttlMs: number }
  | { readonly kind: 'cli-logs' }
  | { readonly kind: 'none'; readonly reason: 'no-management-key' | 'no-route' }

/**
 * ⚠ THE MOST IMPORTANT FUNCTION IN THE TASK.
 *
 * The discriminator is `AuthMethodDefinition.type` (D42), which has existed
 * per-adapter since Task 3-3. It is NOT `provider.baseUrl`, NOT "does this
 * launch carry a credential", and NOT "is this the OpenRouter provider".
 *
 * Routing a subscription-authenticated agent through ANY gateway converts a
 * flat-rate subscription into per-token billing, so a cost-tracking feature
 * would INCREASE cost. That is why `subscription` returns `'cli-logs'`
 * unconditionally, BEFORE any other consideration, and why the subscription
 * branch reads nothing from the provider row at all — a branch that never
 * looks at a base URL cannot accidentally route on one.
 */
export function chooseAttributionStrategy(input: {
  readonly authType: 'subscription' | 'api_key'
  readonly hasManagementKey: boolean
  readonly hasRoute: boolean
  readonly policy: AttributionPolicy
}): AttributionStrategy
```

```ts
/* ── Minting ──────────────────────────────────────────────────────────── */

/** The ownership marker. It is the ONLY thing that distinguishes a key Chorus
 *  may revoke from a key the user made by hand, so it is a constant, it is
 *  exact-matched at the START of the name, and it is never user-configurable.
 *  EXACT. */
export const MINT_NAME_PREFIX = 'chorus-dispatch-'

/** D4-verified 2026-07-24 against openrouter.ai/docs/api/api-reference/
 *  api-keys/create-a-new-api-key: `name` is required (minLength 1); `limit`,
 *  `expires_at`, `limit_reset` and `include_byok_in_limit` are optional.
 *
 *  `limit` is NOT optional HERE. A key without a cap is a key that can spend
 *  the account, and the whole reason a failed revocation is survivable is that
 *  the cap bounds it. buildMintRequest REFUSES a non-positive limit — there is
 *  deliberately no code path to an uncapped key.
 *
 *  The name is sent to a third party, so it carries the prefix and the dispatch
 *  id and NOTHING else: no label, no project name, no cwd, no branch. */
export function buildMintRequest(input: {
  readonly dispatchId: string
  readonly limitUsd: number
  readonly now: Date
  readonly ttlMs: number
}): { ok: true; body: MintBody } | { ok: false; reason: string }

export interface MintBody {
  readonly name: string          // `${MINT_NAME_PREFIX}${dispatchId}`
  readonly limit: number         // USD, > 0, ALWAYS present
  readonly expires_at: string    // ISO-8601 UTC — the third orphan defence
}
```

```ts
/* ── Response interpretation: the probeCredential discipline, reused ───── */

/** The fixed vocabulary. Mirrors ipc.ts's `probeFailure` exactly, for the
 *  identical reason: a 401 body from a KEY-MANAGEMENT endpoint is the body
 *  most likely of all to echo a key back. Nothing from a response body or an
 *  exception ever reaches a caller — status codes map to fixed strings and
 *  every outbound string passes through scrubSecrets as a final net. */
export function managementFailure(kind: ManagementFailureKind, status?: number): string

export type ManagementFailureKind =
  | 'unauthorized'   // 401/403 — "The OpenRouter management key was rejected."
  | 'not-found'      // 404     — "That OpenRouter key no longer exists."
  | 'rate-limited'   // 429     — "Rate limited by OpenRouter."
  | 'provider-error' // 5xx     — "OpenRouter returned an error."
  | 'unexpected'     //  *      — `Unexpected response (${status}).`
  | 'unreachable'    // throw   — "Could not reach OpenRouter."
```

```ts
/* ── Orphan reconciliation: the pure classifier ───────────────────────── */

/** Modelled on computeWorktreeReconcile: a PURE function over (live truth ×
 *  our records) returning ACTIONS, with a thin executor elsewhere. The value
 *  of the split is that the dangerous case — "revoke something" — is decided
 *  in a function with no network access, so every branch is unit-testable and
 *  the destructive one can be asserted ABSENT. */
export type ReconcileAction =
  /** Ours, live, its dispatch is not running: read usage, then revoke. */
  | { readonly kind: 'read-and-revoke'; readonly hash: string; readonly dispatchId: string }
  /** Ours by NAME PREFIX but absent from the ledger — minted, then the record
   *  was lost (a crash between mint and the write-ahead persist). Revoke, and
   *  record the spend as UNATTRIBUTED: we know what it cost, not what it was
   *  for. It counts against "% attributed" rather than vanishing. */
  | { readonly kind: 'revoke-unattributed'; readonly hash: string }
  /** Ledger row open, key gone (hand-deleted, or expired). Close the row and
   *  mark spend unknown. NEVER write 0 — see §8. */
  | { readonly kind: 'close-unknown'; readonly dispatchId: string }

/**
 * ⚠ THE ABSOLUTE PROHIBITION: a live key whose name does NOT start with
 * MINT_NAME_PREFIX produces NO ACTION. Not a warning that becomes an action,
 * not a "probably ours". The user's own keys, their other tools' keys, and
 * anything created in the dashboard are invisible to this function.
 *
 * The prefix test is: `name.startsWith(MINT_NAME_PREFIX)` — case-SENSITIVE,
 * anchored at index 0. A case-insensitive test, an `includes`, or a rule that
 * treats a missing name as ours will eventually delete something the user
 * made by hand, and they will have no way to know Chorus did it.
 */
export function computeKeyReconcile(input: {
  readonly liveKeys: readonly LiveKeySummary[]
  readonly openLedger: readonly OpenLedgerRow[]
  readonly runningDispatchIds: ReadonlySet<string>
  readonly now: Date
}): readonly ReconcileAction[]
```

```ts
/* ── "% of spend attributed" (D42) ────────────────────────────────────── */

/** TWO numbers, both labelled, because neither alone is honest:
 *  - `spendPct` answers "of the dollars I spent through the gateway, what
 *    fraction landed on a dispatch?" It cannot see subscription work at all.
 *  - `dispatchPct` answers "of the sessions I ran, what fraction got full
 *    fidelity?" It counts subscription sessions, but has no dollars.
 *
 *  ⚠ Subscription spend is NEVER imputed a dollar value. Inventing a $/token
 *  rate for a flat-rate subscription would fabricate exactly the number D42
 *  wants made VISIBLE. A null is the honest answer and nulls propagate. */
export function computeAttributionSummary(input: {
  readonly rows: readonly TelemetryRowSummary[]
  readonly gatewayTotalUsd: number | null
  readonly windowStart: Date
  readonly windowEnd: Date
}): AttributionSummary

export interface AttributionSummary {
  readonly spendPct: number | null      // null when gatewayTotalUsd is unknown OR zero
  readonly dispatchPct: number | null   // null on a zero-dispatch window — NEVER 0
  readonly attributedUsd: number
  readonly unattributedUsd: number
  readonly subscriptionDispatches: number  // counted, never priced
}
```

### 1.2 `openrouterKeys.ts` — the transport, and nothing else

```ts
/**
 * The ONLY module that talks to OpenRouter's management surface.
 *
 * D4-verified 2026-07-24 (see Task-3a-3.md's fact table for sources):
 *   GET    /api/v1/keys
 *   POST   /api/v1/keys                      → { key, data: { hash, limit, … } }
 *   GET    /api/v1/keys/{hash}               → { data: { usage, limit_remaining, … } }
 *   PATCH  /api/v1/keys/{hash}
 *   DELETE /api/v1/keys/{hash}               → { deleted: true }
 *   POST   /api/v1/analytics/query           → { data: [ … ], metadata: { truncated } }
 * All authenticated with `Authorization: Bearer <MANAGEMENT KEY>`.
 * "Management keys cannot be used to make API calls to OpenRouter's completion
 * endpoints" — so this client is structurally incapable of inference, which is
 * a property worth relying on and worth re-verifying at execution.
 */
export interface OpenRouterKeyClient {
  mint(req: MintBody): Promise<Result<{ key: string; hash: string; limit: number }>>
  readUsage(hash: string): Promise<Result<{ usageUsd: number; limitRemaining: number | null }>>
  disable(hash: string): Promise<Result<void>>
  revoke(hash: string): Promise<Result<void>>
  list(): Promise<Result<readonly LiveKeySummary[]>>
  queryTokens(hash: string, from: Date, to: Date): Promise<Result<TokenBreakdown | null>>
}

export function createOpenRouterKeyClient(deps: {
  /** Decrypt-per-use. NOT a string, NOT a cached value — a THUNK, so the
   *  management key's plaintext exists only inside one await and dies with it.
   *  Holding a higher-privilege credential resident for the app's lifetime is
   *  strictly worse than what D33 sanctioned for a launch credential. */
  readonly getManagementKey: () => Promise<string | null>
  /** Injected so the whole module is testable without a network. */
  readonly fetchImpl?: typeof fetch
  readonly timeoutMs?: number   // default 10_000, matching probeCredential
}): OpenRouterKeyClient
```

**Three rules this module obeys, all inherited from `probeCredential`:**

1. **The response body is never read on a failure path.** `void res.body?.cancel().catch(() => undefined)`, then map the status. On the *success* paths the body **is** parsed — but only through explicit field extraction (`data.hash`, `data.limit`, `data.usage`), never spread into anything, and never logged.
2. **Every exception collapses to one fixed string.** A `TypeError: fetch failed` carries a `cause` chain that can include the request **and its headers** — which here means the management key. Catch, discard, emit `managementFailure('unreachable')`.
3. **Every outbound message goes through `scrubSecrets`.** One call, costs nothing, and is the difference between "we thought about it" and "it cannot happen".

**A fourth rule specific to this module:** the management key appears in **exactly one place** — the `Authorization` header — and never in a URL, a query string, a `name`, or a log field. The unit test asserts over the recorded request's full key set, not by spot-check.

### 1.3 `dispatchAttribution.ts` — the orchestrator

```ts
export class DispatchAttribution {
  constructor(deps: {
    storage: StorageService
    keys: OpenRouterKeyClient
    meter: SubscriptionMeter
  })

  /** Called from the SessionLaunch handler, BEFORE sessions.launch(). Returns
   *  the credential to actually inject — which is the MINTED one when the
   *  strategy is 'minted-key', and the user's own otherwise.
   *
   *  Named `mintForDispatch`, NOT `openDispatch`: 3a-1's DispatchRecorder
   *  already owns `openDispatch`/`closeDispatch` on the `dispatches` row, and
   *  two same-named lifecycle methods on two services is how a call site ends
   *  up enriching a row it never opened. This service ENRICHES; it never
   *  creates or closes a row. */
  async mintForDispatch(input: MintForDispatchInput): Promise<MintForDispatchResult>

  /** Called from a third sessions.onExit listener. Read, then revoke, then
   *  UPDATE the existing dispatches row's token/cost/ledger columns. */
  async settleDispatch(sessionId: string, exitCode: number | null): Promise<void>

  /** Called from index.ts at boot — AFTER worktrees.reconcileAll() AND AFTER
   *  3a-1's dispatches.healOrphansAtBoot(), BEFORE sessions.restore(). See
   *  §6.2 for why that order is load-bearing. Never throws: a reconcile
   *  failure must not brick boot, exactly as the worktree reconcile
   *  already establishes. */
  async reconcileOrphanedKeys(): Promise<ReconcileReport>

  /** Deferred token backfill for rows whose analytics window was not yet
   *  fresh at close (§8). Runs after reconcile, best-effort. */
  async backfillPendingTokens(): Promise<void>
}
```

### 1.4 `subscriptionMeter.ts`

Reads the CLI's own local session logs — Claude Code writes per-session JSONL with token counts under its projects directory (spec §5.1 names this as the degraded path). Three properties, all deliberate:

- **No network call, no gateway, no key of any kind.** This module cannot route anything anywhere; that is its most important property and it should be visible from its import list.
- **Failure is normal.** A missing directory, a changed format, a locked file: all yield "unknown" and a debug log. Never a user-facing error, never a throw.
- **Its output is labelled `tokens_source='cli-logs'`** so no consumer can mistake it for gateway-grade data. The spec calls it *"brittle and format-dependent … a degraded path, not the design"*, and the schema must say the same thing.

**The exact log location and JSONL field names are a D4 obligation at execution** — read them off this machine's actual Claude Code install; do not write a path from memory.

---

## 2. Exact insertion points, by symbol

**House rule: named symbols, never line numbers.**

| Where | Symbol | Insertion |
|---|---|---|
| `src/main/ipc.ts` | `resolveCredential` (nested in `registerIpc`) | **Between step 3 and step 4** — after the provider row is loaded and the `adapterType` check passes, before `vault.decryptForLaunch`. Add the management-key refusal (§3.2). It must land **before** the decrypt so a management profile is never decrypted on a launch path at all. |
| `src/main/ipc.ts` | the `IpcChannel.SessionLaunch` handler | Immediately after the existing `if (req.credential_profile_id) { … launchOpts = { … } }` block and **before** `markCredentialed` / the `workspace_mode` branches. Call `attribution.mintForDispatch(...)`; on `'minted-key'`, **replace** `launchOpts.credential` and `launchOpts.secrets[0]` with the minted value. `launchOpts.route` is unchanged — the route is non-secret argv metadata and does not depend on which key is used. |
| `src/main/ipc.ts` | `registerIpc`'s `sessions.onExit(...)` registration | Add a **third, independent** listener calling `attribution.settleDispatch`. `exitListeners` is a `Set` and two listeners already coexist (`ipc.ts` forwards the event, `index.ts` persists status); 3a-1 adds its recorder's close as another. **Do not fold this into any existing listener** — a throw in attribution must not stop the exit event reaching the renderer, the DB, or 3a-1's row close. |
| `src/main/index.ts` | after `const vault = new CredentialVault(storage)` | Construct the client and the service. Log the *availability* of a management key once, as `[attribution] management key configured: <bool>` — the subsystem's single most useful diagnostic and nothing sensitive, mirroring `[vault] safeStorage encryption available: …`. |
| `src/main/index.ts` | the `try { await worktrees.reconcileAll() } catch` block | Add `attribution.reconcileOrphanedKeys()` **after** the worktree reconcile, **after** 3a-1's `dispatches.healOrphansAtBoot()`, and **before** `void sessions.restore(project.id)` — see §6.2. Wrapped in its own `try/catch`: **a reconcile failure must never brick boot.** |
| `src/main/services/logger.ts` | `REDACT_PATHS` | Append `managementKey`, `mintedKey`, `key`. The Phase 3 rule stands: new credential-bearing field names are added as they are introduced. |
| `src/main/services/storage.ts` | `MIGRATIONS` | **Only if 3a-1's v7 lacks the ledger columns** — see §5. |
| `src/main/db/schema.ts` | 3a-1's `dispatches` table definition | The same columns, mirrored, so Drizzle's inferred types and the DDL cannot drift (the v6 precedent). |

**Nothing is inserted into `SessionManager`.** `composeChildEnv`, `createSessionOutput`, and the scrubber registration all already do the right thing with whatever `secretEnv` contains — the minted key is *a credential*, and the launch path is credential-shaped already. **If this task finds itself editing `sessionManager.ts`, something has been designed wrong; stop and re-read.**

---

## 3. Credential rulings — the two that had to be made explicitly

### 3.1 Where a minted key lives for its lifetime

**Ruling: exactly where a user's key lives during a launch, and nowhere a user's key does not.**

```
POST /api/v1/keys  →  response.key  (one local `const` in mintForDispatch)
                   →  ResolvedCredential { envVarName, value, isSecret: true }
                   →  LaunchOptions.secrets + LaunchOptions.credential
                   →  codexAdapter.buildLaunch → PtyLaunchRequest.secretEnv
                   →  composeChildEnv          → the child's environment block
                   →  createSessionOutput({ secrets })  ← the scrubber match set
                   →  dies with the SessionOutput (D33 resolution (a))
```

**It is NOT written to the vault, and that is a security decision, not laziness.** Encrypting a key with a twelve-hour life into a DPAPI blob would give an ephemeral credential the **persistence lifetime of a permanent one**, add a second place it can be recovered from, and pollute the user's Settings list with machine-generated rows. The vault exists to survive a restart; a minted key must **not** survive a restart — a restart is precisely when it should be revoked.

**But "not in the vault" must not become "outside the vault's protections."** The minted key goes through the same guarantees by construction:

- **Scrubber:** registered via `createSessionOutput({ secrets })` on the same synchronous path as a user key — so an agent echoing it renders `[REDACTED-CREDENTIAL]` in the pane, the ring buffer, and `attach()`'s replay.
- **Logger:** `scrubSecrets` already matches it. `secret-patterns.json` pattern #2 is `sk-or-v1-[A-Za-z0-9_-]{20,}` — **a minted OpenRouter key is covered with no list change**, by both `logger.ts` and `scripts/secret-grep.mjs`, which is why G4 is load-bearing rather than ceremonial here.
- **argv:** never. `-c` carries the base URL, the env-var **name**, `wire_api`, and the provider name. **`-c` is argv and argv is world-readable to the same user** — the asymmetry Task 3-6 internalised applies unchanged.
- **IPC:** never, in either direction. The renderer sends a profile id and receives booleans and sanitized strings.

**What IS persisted:** the key's **`hash`**, its `limit`, and the mint/revoke timestamps. The hash is an identifier that cannot authenticate — but it still does not cross the bridge in this task, because nothing in this task needs it there.

### 3.2 The management key is a new credential class — its ruling

D42's operational note: *"OpenRouter's Management API key is a distinct, higher-privilege credential class — it mints keys but cannot do inference — so it needs D33-grade vault protection at least equal to a provider key, and neither `provider_configs` nor `credential_profiles` has a slot for it today."*

**Ruling: it goes in the existing vault, on a provider row whose `auth_mode` is `'management'`.**

**Why reuse rather than invent.** `auth_mode` is an **unconstrained string** on both sides — `text('auth_mode').notNull()` in `schema.ts`, `z.string().min(1).max(60)` in `shared/ipc.ts`. There is no enum and no CHECK constraint, so a new value costs **no migration and no wire-schema change**. Reusing the vault inherits DPAPI encryption, the salted fingerprint and its duplicate detection, `unavailable_since`, the refuse-never-degrade failure modes, write-only inbound IPC, and the six-way leak sweep that Task 3-4 already ran against it. **Building a second store for the higher-privilege key would mean the more dangerous credential gets the less reviewed mechanism** — the exact inversion to avoid.

**Two guards make it not an ordinary credential. Both are named tests.**

1. **Never launchable.** In `resolveCredential`, between the `adapterType` check and the decrypt:

   ```ts
   // A management key mints and revokes keys; it can never do inference
   // (OpenRouter enforces this server-side) and must never reach a child PTY.
   // Placed BEFORE decryptForLaunch so a management profile is not even
   // decrypted on a launch path.
   if (provider.authMode === 'management') {
     return {
       ok: false,
       reason: `Credential profile '${profile.label}' is an OpenRouter management key and cannot be used to launch an agent.`
     }
   }
   ```
   Label-only, per D33 clause 8.

2. **Never used for inference.** Structurally: the only consumer of `getManagementKey` is `openrouterKeys.ts`, which has no completion endpoint. Grep-verifiable, and asserted by a test that the management provider's profiles are excluded from the launch dialog's list.

**Decrypt per use, never cached.** `getManagementKey` is a **thunk** returning a `Promise<string | null>` that calls `vault.decryptForLaunch` each time. No module-level variable, no memo, no "hold it for the session". A resident higher-privilege credential is strictly worse than what D33 sanctioned for a launch credential, and the cost of decrypting per call is a DPAPI round-trip on a path that is already making a network request.

---

## 4. The dispatch lifecycle, in exact order

### 4.1 Open — write-ahead, or the orphan is invisible

```
1. resolveCredential(profileId, agent)         → user's credential + route (or refuse)
2. chooseAttributionStrategy({ authType, hasManagementKey, hasRoute, policy })
3. strategy.kind !== 'minted-key' → return the user's credential unchanged. STOP.
4. buildMintRequest({ dispatchId, limitUsd, now, ttlMs })   ← refuses a non-positive limit
5. keys.mint(body)                              → { key, hash, limit }
6. ⚠ storage.recordMintedKey({ dispatchId, hash, limit, mintedAt })   ← WRITE-AHEAD
7. return the MINTED credential
8. sessions.launch(...) — the caller
```

**Step 6 is between the mint and the launch, and that is the only safe place for it.**

- Crash between 5 and 6 → a live funded key with no record. Recoverable **only** by the name-prefix rule in §6, which is why the prefix is a constant and not a nicety.
- Crash between 6 and 8 → a ledger row for a key that was never used. Reconciliation revokes it harmlessly at next boot. **A harmless failure is what a correct ordering buys.**
- Persisting *after* the launch would invert this: the dangerous case becomes the common one.

**Mint failure degrades, it does not refuse.** The launch proceeds on the user's own key, the row records `attribution_state='mint-failed'`, and it counts against "% attributed". **This is a deliberate departure from D33's refuse-never-degrade, and the boundary is exact:** D33 governs *credentials* — a decrypt failure still refuses the launch, unchanged. This task governs a *meter*, and a broken meter must not stop the work. Say so in the commit message so nobody reads it as an erosion of D33.

### 4.2 Close — read, then revoke

```
1. Look up the open ledger row for this sessionId. None → nothing to do. STOP.
2. (IF `PATCH {disabled:true}` is verified immediate — D4 obligation 4)
   keys.disable(hash)        ← stops spend while the read happens
3. keys.readUsage(hash)      → usageUsd     ⚠ BEFORE the delete
4. keys.queryTokens(hash, mintedAt, now)  → tokens | null (may be null: freshness, §8)
5. keys.revoke(hash)         → DELETE, expects { deleted: true }
6. storage.updateDispatchAttribution({ dispatchId, costUsd, tokens, revokedAt, attributionState, tokensSource })
```

**Step 6 is an `UPDATE`, and it does not touch `outcome`, `ended_at`, `agent`, `model` or `auth_mode`** — 3a-1's `DispatchRecorder.closeDispatch` owns those, and two writers on one row is how a close gets silently undone. The accessor name is deliberately not `closeDispatch`.

**Why read before revoke:** `DELETE /api/v1/keys/{hash}` returns **only** `{"deleted": true}` — it does not return usage — and whether `usage` remains readable after deletion is **undocumented** (D4 obligation 6). Reading first makes the question irrelevant. If a later verification shows usage survives deletion, the ordering may be relaxed; until then it is fixed.

**If `PATCH` is not verified immediate, drop step 2 entirely.** An unverified disable that is believed to stop spend is worse than no disable, because it licenses a slower read.

---

## 5. Schema — one table, 3a-1's

**Anti-goal, inherited from D48 and restated because this is exactly the moment it gets violated: do NOT create a second table for tokens.** 3a-1's v7 **`dispatches`** table already carries wall-clock, outcome, `agent`, `model`, **`auth_mode`** (D42's discriminator, promoted to a column there so "% attributed" is computable at all), and `tokens_in` / `tokens_out` / `tokens_cached` / `cost_usd` **declared and always written NULL**. This task fills those four and adds the ledger columns **to that same table** — because a mint belongs to a dispatch one-to-one, and a second table would immediately need a join, an FK (**F16: FKs are ENFORCED**), and its own orphan story. 3a-1's own naming section already rules that *"the dispatch row is the usage record"*; this task does not reopen it.

**Write through `UPDATE`, never `INSERT`.** The row exists before this task's code runs. Mirror 3a-1's idempotence discipline: the guard belongs in the SQL `WHERE`, not in a caller's `if`.

**First action at execution: read 3a-1's shipped `MIGRATIONS` entry and its `schema.ts` block, and answer in writing — do these columns already exist?**

| Column | Type | Purpose |
|---|---|---|
| `minted_key_hash` | TEXT NULL | The ledger. NULL for subscription and unattributed rows. |
| `minted_key_limit` | REAL NULL | The cap that was actually applied — evidence, not configuration. |
| `minted_at` | TEXT NULL | ISO-8601. Also the analytics query's window start. |
| `revoked_at` | TEXT NULL | NULL = **the ledger row is OPEN**. This single field is what boot reconciliation queries. |
| `attribution_state` | TEXT NOT NULL | `'minted'` · `'closed'` · `'mint-failed'` · `'revoke-failed'` · `'orphan-reconciled'` · `'unattributed'` · `'cli-logs'` · `'none'` |
| `tokens_source` | TEXT NULL | `'analytics'` · `'analytics-derived'` (cached tokens computed from `cache_hit_rate`) · `'cli-logs'` · NULL = unknown |

**If 3a-1's v7 already carries them** → no migration in this task; say so explicitly in the commit message.

**If it does not** → append **migration v8** as nullable `ALTER TABLE` statements (the v3 `sessions.title` / v6 `provider_configs.model` pattern), and **carry the full Task 3-2 three-dump protocol**: pre / post / second boot on the **real** dev DB; v1–v7 `applied_at` byte-identical; every pre-existing table row-identical; new columns reading `NULL` on existing rows; v8 not re-applied on boot 2. **A short DDL does not earn a lighter proof** — the risk lives in the runner and the real database, which is exactly how v5 and v6 each had to be re-driven.

`attribution_state` is `NOT NULL` with a default, because a row whose state is unknown is a row nobody can reason about later; the token columns are nullable, because **unknown is a real and frequent answer** and §8 depends on being able to say it.

---

## 6. Orphan reconciliation — the failure mode that matters

**The scenario, stated plainly:** Chorus mints a key with $0.50 of budget, the machine loses power, and nothing ever revokes it. The key is live, funded, and — if the crash landed between mint and the ledger write — invisible to Chorus. Multiply by every crash.

**Three independent layers, because one is not enough for money:**

| Layer | Bounds | Fails when |
|---|---|---|
| **The hard `limit`** | Total damage per orphan | Never — it is enforced by OpenRouter. This is why an uncapped mint is prohibited rather than discouraged. |
| **`expires_at`** | Damage *duration* per orphan | If OpenRouter does not enforce it as revocation (**D4 obligation 5 — measure it, don't assume it**). |
| **Boot reconciliation** | Everything, eventually | If the app is never launched again. |

### 6.1 The classification matrix — EXACT

Inputs: `GET /api/v1/keys` (live truth), the open ledger (`revoked_at IS NULL`), and the set of dispatch ids currently running.

| # | Live? | In ledger? | Name has `chorus-dispatch-`? | Dispatch running? | Action |
|:-:|:-:|:-:|:-:|:-:|---|
| 1 | yes | yes | yes | **no** | **`read-and-revoke`** — read usage, revoke, close the row `attribution_state='orphan-reconciled'`. |
| 2 | yes | yes | yes | **yes** | **No action.** A live dispatch owns its key. (Only reachable if a prior boot's sessions restored — leave it alone.) |
| 3 | yes | **no** | **yes** | — | **`revoke-unattributed`** — ours, record lost. Read usage, revoke, write a row with **no dispatch id**: the spend is known, its purpose is not. **It counts against "% attributed"** rather than disappearing. |
| 4 | yes | no | **NO** | — | **⚠ NO ACTION. NOT OURS.** |
| 5 | **no** | yes | — | — | **`close-unknown`** — hand-deleted or expired. Close the row, spend **unknown**. **Never write 0.** |

**Row 4 is the one that matters most and is the easiest to get wrong.** The name prefix is the *only* ownership marker, so:

- The test is `name.startsWith(MINT_NAME_PREFIX)`, **case-sensitive, anchored at index 0**.
- A `.includes()` would match a user key named `"backup of chorus-dispatch- experiment"`.
- A case-insensitive test would match `"Chorus-Dispatch-…"` created by hand.
- A missing/empty name is **not ours**.
- **There is no "probably ours" and no heuristic escalation.** A false positive here silently deletes a credential the user created and depends on, with no notification and no undo.

The unit test asserts an **empty action list** for row 4, and must be written so it fails against each of those three over-eager implementations — not merely pass against the correct one.

### 6.2 Ordering at boot — three constraints, one legal position

```
await worktrees.reconcileAll()          // existing (D26 Q3)
dispatches.healOrphansAtBoot()          // 3a-1 — closes rows for dispatches that died with the app
await attribution.reconcileOrphanedKeys()   // ← HERE
void sessions.restore(project.id)       // existing (D16)
```

- **After 3a-1's heal**, because the classifier's `runningDispatchIds` input is read from the `dispatches` table. Run before the heal, and every crashed dispatch still reads as *running*, so **row 1 never fires and every orphan survives the boot that was supposed to catch it** — the reconcile would appear to work and do nothing, on exactly the rows it exists for.
- **Before `sessions.restore(...)`**, because restore relaunches sessions and reconciliation revokes keys. Reconciling first means a restored session can never be handed a key the reconcile is about to destroy.
- **In its own `try/catch` with a logged failure: a reconcile failure must never brick boot**, exactly as the worktree reconcile already establishes.

---

## 7. Failure-mode matrix

Every row's user-facing text is a **fixed string** from `managementFailure`, passed through `scrubSecrets` — the `probeCredential` discipline, unchanged.

| Failure | Detection | Behaviour | State written | User sees |
|---|---|---|---|---|
| **Mint returns 401/403** | status | **Launch proceeds on the user's key.** | `mint-failed` | "The OpenRouter management key was rejected." |
| **Mint returns 429** | status | Launch proceeds. **No retry** (Non-Goal). | `mint-failed` | "Rate limited by OpenRouter." |
| **Mint returns 5xx / unexpected** | status | Launch proceeds. | `mint-failed` | fixed string / `Unexpected response (<status>).` |
| **Mint throws / times out** | catch | Launch proceeds. | `mint-failed` | "Could not reach OpenRouter." |
| **Mint succeeds, ledger write throws** | catch | **Revoke the key immediately**, then proceed on the user's key. A key we cannot record is a key we must not keep. If the revoke also fails, log loudly — the name prefix will catch it at next boot (row 3). | `mint-failed` | fixed string |
| **No management key configured** | thunk → null | Strategy is `'none'`. **Not an error** — the app works, attribution does not. | `none` | nothing |
| **`readUsage` fails at close** | any | **Revoke anyway.** Revocation matters more than the number. | `closed`, cost NULL | nothing (logged) |
| **`queryTokens` returns nothing / stale** | null / empty | Revoke, write cost, leave tokens NULL, mark pending. §8 backfills. | `closed`, `tokens_source` NULL | nothing |
| **Revoke fails** | any | **No inline retry.** Ledger row stays open (`revoked_at` NULL); next boot's reconcile is the backstop, bounded by the `limit` and `expires_at`. | `revoke-failed` | nothing (logged) |
| **Crash between mint and ledger write** | — | Invisible now; caught at next boot by **row 3** (name prefix). | `unattributed` | nothing |
| **Crash mid-dispatch** | — | Caught at next boot by **row 1**. | `orphan-reconciled` | nothing |
| **Key deleted by hand** | absent from `list()` | Close the row, spend **unknown** (never 0). | `close-unknown` | nothing |
| **A non-Chorus key exists** | prefix miss | **No action, ever.** | — | nothing |
| **Management profile named on a launch** | `authMode === 'management'` | **Refuse before decrypt.** No spawn, no session row. | — | label-only refusal |
| **Analytics returns strings for counts** | typeof | Parse defensively; non-numeric → **NULL, never NaN, never 0**. | — | nothing |
| **`metadata.truncated === true`** | field | Totals are partial — **do not write them as complete.** Mark pending and backfill. | `tokens_source` NULL | nothing |

**The single unifying rule:** a broken meter never breaks a session, and a broken meter never invents a number.

---

## 8. Tokens — the honest data path

**`cost_usd` and the token columns come from different endpoints and have different reliability. Do not conflate them.**

- **Cost — authoritative and always available.** `GET /api/v1/keys/{hash}` → `data.usage` (USD) → `dispatches.cost_usd` (`REAL`, per 3a-1). Verified. Cost attribution never depends on analytics.
- **Tokens — from the Analytics API.** `POST /api/v1/analytics/query` with a management key, `metrics` including `tokens_prompt`, `tokens_completion`, `reasoning_tokens`, `cache_hit_rate`, `total_usage`, `usage_cache`, filtered to this dispatch's **key hash**. **⚠ The exact `filters` field name for a per-key-hash filter is D4 obligation 1 and MUST be verified before this path is designed** — without it there is no per-dispatch token attribution at all, and that changes the task's acceptance rather than being worked around.
- **Not usable here: the per-generation endpoint.** It gives exact native token counts, but it is keyed on a **generation id** that a PTY-hosted CLI never surfaces to Chorus. Recorded so nobody spends a session rediscovering it.

**`tokens_cached` gets its own column and its own write.** Cached input is priced roughly an order of magnitude below fresh input, and a PTY agent against a large `CLAUDE.md` hits cache constantly — folding it into `tokens_in` projects **badly wrong in the expensive direction**, and no later migration recovers data never captured. If a direct cached-**token** metric exists, use it and set `tokens_source='analytics'`. If only `cache_hit_rate` (a 0–1 ratio) exists, derive `tokens_cached ≈ tokens_prompt × cache_hit_rate`, set `tokens_source='analytics-derived'`, and **say so in the summary**. A derived number labelled as derived is fine; a derived number labelled as measured is not.

**Freshness and the backfill.** The analytics API is **beta**, and the current UTC day may be excluded (**D4 obligation 3**). A dispatch that ended seconds ago may therefore return **zero tokens with a non-zero cost** — which is indistinguishable from a real zero unless the schema can say "not yet". Hence:

- At close: write cost, write tokens **only if** the query returned a non-truncated result; otherwise leave them NULL with `tokens_source` NULL and `attribution_state='closed'`.
- `backfillPendingTokens()` re-queries those rows at the next boot (and on demand). It never overwrites a populated value.
- **`0` and `unknown` must be distinguishable at every layer** — schema, accessor, and summary. A fabricated zero calibrates the estimator on data that never existed, and every projection downstream is quietly wrong. This is the single most consequential data-quality rule in the task.

---

## 9. Verification — RUNTIME, because none of this can be unit-tested into existence

### 9.0 The multi-turn gate runs FIRST, and is allowed to fail

Full protocol in `Task-3a-3.md` Step 0. **Do not begin §1's module work until its result is reported.** A pass unlocks the full scope; a fail re-scopes to single-turn attribution with the limit recorded as a roadmap finding, carrying the **verbatim** error text. The failure mode *is* the finding.

### 9.1 The end-to-end attribution proof — Mission Control spec §9 Phase 0's own acceptance

> *"dispatches appear in the store with non-zero token counts attributed to the right agent and model."*

One real dispatch, evidence quoted for each:

1. `GET /api/v1/keys` **before** the launch — record count and hashes.
2. Launch `codex` from the real dialog against the live OpenRouter route (`moonshotai/kimi-k3`, "OR milestone key").
3. `GET /api/v1/keys` **after** — count **+1**; the new key's `name` is `chorus-dispatch-<id>`; **`data.limit` is present and positive.**
4. Drive real work in the pane so tokens are actually spent.
5. **The positive check:** read the agent process's **environment block** from outside the app — WMI/CIM against the descendant PID, walked from the electron main PID via `ParentProcessId`. **Never name-match** (~16 unrelated `claude.exe` on this machine). Confirm the injected value is the **minted** key, not the user's.
6. **The absence checks:** `Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CommandLine` over the whole descendant tree — no command line contains the minted key, the user's key, the management key, or any **≥ 8-character substring** of any of them.
7. Close the pane. Confirm: usage read **before** delete, `DELETE` → `{"deleted": true}`, `GET /api/v1/keys` back to the baseline count and hash set.
8. **Dump the telemetry row.** Non-zero `tokens_in` and `tokens_out`; `tokens_cached` populated **separately** (or an explicit "no cache on this run" with the evidence); non-zero `cost`; agent `codex`; model `moonshotai/kimi-k3`; `attribution_state='closed'`.

**⚠ §9.1 without the positive check in step 5 proves nothing.** Steps 6–7 are absence checks, and **absence everywhere is also what a completely broken injection looks like.** The environment-block read is the only positive evidence the mechanism does anything at all, and it is the first thing a reviewer should look for.

### 9.2 The subscription-safety proof — the reviewer's check

**Required, separate, and non-negotiable.** The task must not gateway-route a subscription session even accidentally.

1. `GET /api/v1/keys` — snapshot count **and hash set**.
2. Launch `claude` with **no credential profile** through the real dialog.
3. `GET /api/v1/keys` again — **count and hash set byte-identical. No key was minted.** This is the check.
4. Environment block: no `OPENROUTER_*`, no injected key of any kind, and the **full inherited `process.env`** — 3-6's resolution-(c) negative control, still holding.
5. Command line: **no `-c model_provider…`, no `base_url`, no `env_key`.**
6. Telemetry row: `attribution_state='cli-logs'`, `minted_key_hash` **NULL**.

**Plus the structural half:** grep every call site of `keys.mint` — there must be exactly one, inside the `'minted-key'` branch — and read the branch condition to confirm it tests `AuthMethodDefinition.type` and **not** `base_url`, **not** "has a credential", **not** "is the OpenRouter provider". A condition on the wrong field passes every happy-path test and converts a subscription to per-token billing the first time someone adds a `base_url` to a subscription route.

### 9.3 The crash-reconciliation proof

1. Launch an attributed dispatch; let it run.
2. `taskkill /PID <electron main PID> /T /F` — the key is now live, funded and orphaned, exactly as a real crash leaves it.
3. `GET /api/v1/keys` — confirm it is still there, un-revoked. **The orphan must be real before the fix can be proven.**
4. **Before the next boot**, create a key by hand in the OpenRouter dashboard whose name does **not** carry the prefix. This is the negative control and the proof is meaningless without it.
5. Cold-boot the app (electron-vite does not hot-restart main).
6. Confirm: the orphan's usage was read, it was revoked, an `orphan-reconciled` row exists — **and the hand-made key is still there, untouched.** Quote the log line and both key lists.
7. Delete the hand-made key by hand.

### 9.4 The degradation proofs

- **Revoke failure:** force one (unreachable host for a single call, or a bad hash). Ledger row stays open, message sanitized, no crash, user's session unaffected, **next boot's reconcile cleans it**.
- **Mint failure:** point at an invalid management key. **The launch still succeeds** on the user's own key; `attribution_state='mint-failed'`; sanitized message; counted against "% attributed" rather than hidden.
- **Management key not launchable:** create a `management` provider + profile through the real Settings UI, attempt a launch naming it. Inline refusal **by label**, no spawn, no session row, **no management key in any environment block**.
- **Scrubber coverage:** have the agent `echo $env:<NAME>` with the minted key injected. Confirm `[REDACTED-CREDENTIAL]` on screen, in the ring buffer, and in `attach()`'s replay after a remount. This is 3-5's machinery, now exercised against a key **Chorus itself created**.

### 9.5 The migration proof — only if v8 is created

The full Task 3-2 three-dump protocol on the **real** dev DB (§5). **⚠ `sqlite3` is NOT installed** — use the `ELECTRON_RUN_AS_NODE` dump-script pattern (`_verify/2-1-dump.js`), write to a file, **retry once on the known first-invocation no-file flake**, and **quote the `projects` table** (F20). The coordinator re-verifies on the real path.

### 9.6 Cost envelope

| Run | Expected |
|---|---|
| Multi-turn gate (3 turns, kimi-k3) | < $0.05 |
| Attributed dispatches (3–5) | < $0.20 |
| Management calls | $0.00 (administrative) |
| **Total** | **< $0.30** |
| **Hard per-key ceiling, enforced by the mechanism** | **$0.50** |

**Every minted key in every run carries a hard `limit` — including exploratory ones.** If a run needs more than the ceiling, **stop and ask**; do not raise it. Report actual spend in the summary.

### 9.7 Standing harness reminders

CDP on `--remote-debugging-port=9222`; kill process **trees** (`taskkill /PID <root> /T /F`); every main-process change needs a real cold boot; `ELECTRON_RUN_AS_NODE` scripts print nothing to a console — write to a file.

---

## 10. Three things a reader should be able to answer without running anything

The `vault.ts` §10 discipline, applied here:

1. **Where does a minted key enter?** One place: `openrouterKeys.mint`'s return value, read into one `const` in `DispatchAttribution.mintForDispatch`.
2. **Where does it leave?** One place: `LaunchOptions.credential` / `.secrets`, into the existing 3-6 launch path. It is never written to disk, never logged, never returned over IPC, and never placed in an error message.
3. **What happens if it is never revoked?** Three bounds, in order of reliability: the hard `limit` (enforced by OpenRouter, always), `expires_at` (verified at execution), and boot reconciliation (§6). **If a reader cannot trace all three from the code, the orphan story is not implemented — it is described.**
