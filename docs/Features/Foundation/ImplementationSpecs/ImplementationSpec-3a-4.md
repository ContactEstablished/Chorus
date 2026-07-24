# Implementation Spec 3a-4 — `model_catalog` + Refresh, and Effort Normalization

_Companion to `Tasks/Task-3a-4.md`. The task doc governs **scope**; this doc governs **exact contents, insertion points, and rationale**. Code blocks are starting points to adapt to the surrounding file's conventions — not byte-for-byte mandates — **except** where marked **EXACT**._

**Anchored to commit `15a016e`, verified by the coordinator 2026-07-24.** Insertion points are named by **symbol, never by line number** (standing house rule). **Re-anchor against Task 3a-3's commit before starting:** Tasks 3a-1, 3a-2 and 3a-3 all land in between, 3a-1 moves the schema, and 3a-3 may move it again.

---

## 0. What this task is, in one paragraph

Two deliverables that share one philosophy. The first is a **cache of what a route offers** — a `model_catalog` table, a user-initiated live refresh built to `probeCredential`'s discipline, and a freshness contract that makes staleness a rendered fact rather than a silent lie. The second is **effort normalization** — the app-level Fast/Balanced/Deep/Max slider PLAN §4 has promised since day one, mapped per adapter against flags verified against the installed binaries, with a written precedence order between the slider and a raw override. The shared philosophy is **one home per fact, and one written order when several artefacts describe the same fact**. That is D48's lesson, and this task is the first one large enough to break it twice.

---

## 1. The migration — EXACT

### 1.1 ⚠ The version number is decided at execution, not here

At `15a016e` the array has **six** entries. **Task 3a-1 takes v7** (and forbids itself a second). **Task 3a-2 takes none.** **Task 3a-3 takes v8 CONDITIONALLY** — only if 3a-1's v7 did not already carry the mint-ledger columns.

**So this task's migration is `v8` if 3a-3 added none, and `v9` if it did.** Read the shipped array and `SELECT version FROM schema_migrations` **first**, write the number down, and state it in the commit message with that evidence. **The DDL text below does not change; only the index and the comment's version label do.** This doc says "v8" throughout for readability.

**If the array's length matches none of the three predicted shapes, STOP and raise it.** A mis-numbered migration on the real dev DB is not recoverable by editing a string.

### 1.2 The `MIGRATIONS` entry — EXACT

**Append** as the next element of `const MIGRATIONS: string[]` in `src/main/services/storage.ts`, after whatever the prior task left as the last entry. One entry, one statement, applied atomically inside the runner's existing per-version transaction.

```ts
  // v8 (Phase 3a / Task 3a-4): the model catalog — a CACHE of what a route
  // offers, and nothing more.
  //
  // ⚠ PRECEDENCE, NORMATIVE. Three artefacts talk about models, and exactly
  // ONE order resolves them for a launch:
  //     1. launch_profiles.model  — the choice for THIS launch    (Task 3a-5)
  //     2. provider_configs.model — this route's DEFAULT          (v6, D48)
  //     3. nothing                — the CLI's own default; no -m emitted
  //   model_catalog IS NOT IN THAT ORDER. It is a list of what exists. It is
  //   never authoritative over either other home, and it NEVER writes to
  //   them: no code path issues an UPDATE against provider_configs, and none
  //   may issue one against launch_profiles when that table exists. A catalog
  //   miss WARNS. It never blocks, clears, defaults, or substitutes — the
  //   provider is the authority on whether a model id resolves (F-36-4), and
  //   a stale cache used as a gate turns a warning into an outage.
  //   D48 exists because "which model" briefly had two homes. This table is
  //   how it gains a third ROLE without gaining a third AUTHORITY.
  //
  // ⚠ NO `REFERENCES` CLAUSE, DELIBERATELY. FKs are ENFORCED (F16), so
  // `REFERENCES provider_configs(id)` would default to RESTRICT and make the
  // first provider:delete after a refresh THROW — a cache breaking a user
  // flow that has worked since Task 3-4. `provider_id` is an OPAQUE STRING
  // here; StorageService.deleteProviderConfig purges a provider's catalog
  // rows explicitly, in the same transaction. Same reasoning as v7's
  // `dispatches` table (3a-1), reached independently.
  //
  // ⚠ NO `tier` COLUMN, though PLAN §13 names one. No provider response field
  // maps to it, so it could only hold a hardcoded classification of
  // third-party model names that would rot within weeks. Deliberate
  // deviation from PLAN §13; narrated in the commit message.
  //
  // ⚠ NO PRICING. A cached price is a number that is one day wrong in a way
  // that costs money. Task 3a-3 reads real spend from the provider instead.
  //
  // The composite PRIMARY KEY gives SQLite an implicit index that already
  // covers every read this task performs (`WHERE provider_id = ?`), so there
  // is NO separate index. Adding one for a query no consumer makes is the
  // same speculation the `tier` decision rejects.
  `CREATE TABLE model_catalog (
     provider_id    TEXT NOT NULL,
     model_id       TEXT NOT NULL,
     display_name   TEXT NOT NULL,
     context_length INTEGER,
     expires_at     TEXT,
     first_seen_at  TEXT NOT NULL,
     refreshed_at   TEXT NOT NULL,
     missing_since  TEXT,
     PRIMARY KEY (provider_id, model_id)
   );`
```

### 1.3 Every column, and why it is there

| Column | Why |
|---|---|
| `provider_id` | Opaque string, **no FK** (above). Half the composite key: the same model id reached through two routes is two rows, which is the same distinction D43 draws for `launch_profiles` (`OR/DeepSeek v4 Pro` vs `Direct/DeepSeek`). |
| `model_id` | The provider's own slug, verbatim — `moonshotai/kimi-k3`. **This is the string that reaches argv as `-m`**, so it is charset- and length-validated on ingest (§4.2). Other half of the composite key: **the PK is what makes a second refresh update rather than duplicate**, which is the bug that only appears on the second button press. |
| `display_name` | The provider's human label. Third-party text that renders in the DOM → sanitized and length-capped on ingest, never on read. |
| `context_length` | Nullable integer. Captured because it is free and it is the one field a user genuinely reads when choosing a model. **Nothing in the app reasons over it** — it is displayed, not consumed. |
| `expires_at` | Nullable ISO string, from OpenRouter's `expiration_date` (D4-verified 2026-07-24 as a real response field). **This is what lets the disappearance warning fire BEFORE the model vanishes** rather than after — the friendlier-faced F-36-4 caught one refresh early. If the field proves universally null at execution, the column stays (it is free) and the pre-emptive warning is simply never triggered. |
| `first_seen_at` | ISO string, written once and never rewritten. The audit fact that separates "new to this catalog" from "seen again". |
| `refreshed_at` | ISO string, rewritten by every refresh that **sees** the model. **Provider-level freshness is `MAX(refreshed_at)` over the provider's rows** — no separate per-provider freshness table, because that would be a second home for one fact. |
| `missing_since` | Nullable ISO string. Set **once**, on the first refresh that does not see a previously-catalogued id; **cleared** when it reappears; **never moved** by a subsequent still-missing refresh. If it moved, "missing since" would read as "today" forever and the user could never tell whether a model vanished this morning or last month. **The row is never deleted** — deleting destroys the only evidence the id was ever real, which is exactly the fact a user staring at a failing saved route needs. |

**No `created_at`/`updated_at` pair.** `first_seen_at` and `refreshed_at` are those facts with honest names, and a duplicate pair is a chance to disagree (3a-1's reasoning on `started_at`).

### 1.4 The Drizzle mirror — `src/main/db/schema.ts`, EXACT

Append after `credentialProfiles` and its exported types (or after whatever 3a-1/3a-3 left last). **These definitions and the DDL above must not drift**; a mismatch produces typed queries that silently read the wrong shape.

**⚠ `primaryKey` is NOT currently imported.** The file's import line at `15a016e` is `import { sqliteTable, text, integer, blob } from 'drizzle-orm/sqlite-core'` — add `primaryKey` to it. `integer` is already there.

```ts
/**
 * Phase 3a / Task 3a-4 (migration v8): the model catalog.
 *
 * ⚠ A LIST OF WHAT EXISTS — NOT AN AUTHORITY. Precedence for "which model
 * does this launch use" is, in order: launch_profiles.model (3a-5) >
 * provider_configs.model (v6, D48) > nothing (the CLI's own default). This
 * table is NOT in that order and never writes to either home. See the v8
 * migration comment in storage.ts for the full ruling.
 *
 * No REFERENCES to provider_configs: FKs are ENFORCED (F16) and RESTRICT
 * would make provider:delete throw. Purge is explicit, in the delete's own
 * transaction.
 */
export const modelCatalog = sqliteTable(
  'model_catalog',
  {
    providerId: text('provider_id').notNull(),
    modelId: text('model_id').notNull(),
    displayName: text('display_name').notNull(),
    contextLength: integer('context_length'),
    /** Provider-announced retirement (OpenRouter `expiration_date`). */
    expiresAt: text('expires_at'),
    firstSeenAt: text('first_seen_at').notNull(),
    refreshedAt: text('refreshed_at').notNull(),
    /** Set ONCE when a refresh stops seeing this id; cleared when it returns;
     *  never moved while it stays missing. The row is never deleted. */
    missingSince: text('missing_since')
  },
  (t) => ({ pk: primaryKey({ columns: [t.providerId, t.modelId] }) })
)

export type ModelCatalogRow = typeof modelCatalog.$inferSelect
export type NewModelCatalogRow = typeof modelCatalog.$inferInsert
```

---

## 2. `StorageService` accessors — exact signatures

Add to the class in `src/main/services/storage.ts`, in the rows-in-rows-out style of the worktree and credential accessors. **Every policy decision lives in `modelCatalogCore.ts`, not here** — these are dumb.

```ts
/** All catalog rows for one provider, missing ones included (they still
 *  render, struck through). Ordered by display_name for stable UI. */
getModelCatalogForProvider(providerId: string): ModelCatalogRow[]

/** The newest refreshed_at across a provider's rows, or null when the
 *  provider has never been refreshed. THE freshness fact — there is no
 *  per-provider freshness column, because that would be a second home. */
getCatalogRefreshedAt(providerId: string): string | null

/** Apply one refresh's computed diff ATOMICALLY. Takes the core's output;
 *  makes no decisions of its own. Upserts on the composite PK, so a second
 *  refresh updates rather than duplicates. */
applyCatalogDiff(providerId: string, diff: CatalogDiff): void

/** Used ONLY by deleteProviderConfig's purge and by the verification
 *  harness. Not exposed over IPC. */
deleteModelCatalogForProvider(providerId: string): void
```

### 2.1 The provider-delete purge — insertion point by symbol

`deleteProviderConfig(id: string): void` already exists and carries the comment directing callers to count profiles first (`countCredentialProfilesForProvider`) rather than reverse-engineering the FK throw. **Wrap its body in a `this.d.transaction((tx) => { … })`** (the existing transaction idiom appears twice in this file already) and delete the provider's `model_catalog` rows **before** the provider row.

**Two things must not change:**

- **The count-and-refuse on credential profiles stays exactly as it is.** Profiles still block a delete; a catalog never does. A cache is not a reason to keep a route the user asked to remove.
- **No `REFERENCES`-driven cascade is introduced.** The purge is an explicit statement, in an explicit transaction, for an explicit reason — that is the whole point of omitting the FK.

An orphaned catalog row is harmless (a cache keyed on a dead provider id), so the purge is about honesty rather than safety. It costs one statement.

---

## 3. ⚠ The precedence order, worked — every combination, including the nulls

This is the section a later reader will come back to. `L` = `launch_profiles.model` (Task 3a-5; treat as always NULL until then), `P` = `provider_configs.model` (v6), `C` = the catalog's state.

| # | `C` | `P` | `L` | **Effective model** | What renders |
|:--:|---|---|---|---|---|
| 1 | has `kimi-k3` | `kimi-k3` | `kimi-k2.7-code` | **`kimi-k2.7-code`** — the launch choice wins | dialog shows the choice; the card still shows `kimi-k3` as the route default, unhighlighted |
| 2 | has `kimi-k3` | `kimi-k3` | NULL | **`kimi-k3`** — the route default | card shows the default, selected in the picker |
| 3 | has `kimi-k3` | NULL | `kimi-k3` | **`kimi-k3`** — the launch choice | normal for a subscription route, which names no default |
| 4 | has rows | NULL | NULL | **none — no `-m` is emitted at all** | picker offered, nothing pre-selected; the CLI picks |
| 5 | **empty** (never refreshed) | `kimi-k3` | NULL | **`kimi-k3` — UNCHANGED** | _"No model list yet · Refresh"_; the launch is **not** blocked and nothing is cleared |
| 6 | **empty** | NULL | NULL | **none** | _"No model list yet · Refresh"_; free-text input still accepts anything |
| 7 | **stale** (≥ 24 h) | `kimi-k3` | NULL | **`kimi-k3` — UNCHANGED** | list still shown + _"⚠ last updated 3 days ago · Refresh"_. **Staleness changes nothing about launching.** |
| 8 | **`missing_since` set on `kimi-k2.7`** | `kimi-k2.7` | NULL | **`kimi-k2.7` — STILL LAUNCHED** | ⚠ warning on the card **and** in the dialog, naming the model and the date. **`P` is NOT cleared, NOT substituted, NOT defaulted.** |
| 9 | `missing_since` set | `kimi-k2.7` | `kimi-k2.7` | **`kimi-k2.7` — still launched** | the same warning on both surfaces |
| 10 | `missing_since` set on X | `kimi-k3` | `X` | **`X` — still launched** | warning in the dialog only; the card's default is healthy |
| 11 | has `kimi-k3` | `not-in-catalog/typo` | NULL | **`not-in-catalog/typo`** — still launched | **no warning** — an id that was never catalogued is not the same fact as one that disappeared. Do not invent a "not in the list" warning; it would fire on every legitimate id the catalog has not seen and train the user to ignore warnings. |
| 12 | `expires_at` in the future on the named model | `kimi-k3` | NULL | **`kimi-k3`** | a softer, dated pre-emptive notice — _"the provider lists this model as retiring on …"_ |

**The two sentences that carry rows 5–12:**

1. **The catalog never changes what launches.** Every row's *Effective model* column is identical to what it would be with no `model_catalog` table in the database at all. **That is the acceptance test for the whole ruling** and it is exactly what the missing-model runtime drive proves with a before/after row dump.
2. **Row 11 is the discipline row.** The temptation is to warn on any model not in the catalog. Resist it: the catalog is one provider's answer at one instant, users legitimately name ids it does not list, and a warning that fires on the normal case is a warning nobody reads. **Only a model that was catalogued and then disappeared earns a warning**, because that is a change the app actually observed.

---

## 4. `src/main/services/modelCatalogCore.ts` — the normative surface

Pure. **No `electron`, no `fetch`, no `node:fs`, no clock** — `now` is a parameter. Precedent: `vaultCore.ts`, `computeRestoreSet` in `restore.ts`, `computeWorktreeReconcile` in `worktrees.ts`, `attributionCore.ts` (3a-3).

### 4.1 Types

```ts
/** One validated model, as it will be stored. Provider text is already
 *  sanitized and capped by the time a value of this type exists. */
export interface CatalogModel {
  readonly modelId: string
  readonly displayName: string
  readonly contextLength: number | null
  readonly expiresAt: string | null
}

/** The whole outcome of one refresh, as INSTRUCTIONS TO STORAGE.
 *
 *  ⚠ There is deliberately NO field here that names provider_configs or
 *  launch_profiles. The diff cannot express "clear the route's model" or
 *  "default the route to X" because those instructions must not exist. The
 *  unit test asserts over this object's KEY SET so a future field cannot
 *  smuggle one in. */
export interface CatalogDiff {
  readonly upserts: readonly StoredModel[]   // seen this refresh
  readonly markMissing: readonly string[]    // catalogued, not seen, not already marked
  readonly clearMissing: readonly string[]   // marked, seen again
  readonly droppedCount: number              // rows the provider sent that failed validation
}

export type CatalogFreshness = 'never' | 'fresh' | 'stale'
```

### 4.2 Response parsing and per-row validation

```ts
export function parseModelsResponse(body: unknown): ParsedModels | RefreshRefusal
```

- The expected shape is `{ data: [...] }` (D4-verified 2026-07-24 against the live OpenRouter endpoint). Anything else → the fixed `'The provider returned an unrecognized model list.'` refusal. **Never include the received shape in the message** — that is a body echo wearing a diagnostic hat.
- Per row, all of which must hold or the row is **dropped with a count, never thrown on**:
  - `id` is a non-empty string matching **`/^[A-Za-z0-9._:\/@-]{1,200}$/`**. **This string reaches argv as `-m <id>`.** A space, a quote, a newline, or an ANSI escape in a model id is a third party writing into a command line, and the fact that `-m` takes its own argv token is not a reason to accept it.
  - `name` (or `id` as fallback) → `displayName`, control characters stripped, capped at 200 chars. **This renders in the DOM.**
  - `context_length` → a finite non-negative integer or `null`. **A non-numeric value yields `null`, never `NaN` and never `0`** — `0` and `unknown` must stay distinguishable (3a-3's rule, same reasoning).
  - `expiration_date` → an ISO-parseable string or `null`.
- **`droppedCount` is reported and logged, never silently swallowed.** A provider that suddenly fails validation on half its list is a finding.

### 4.3 The diff

```ts
export function computeCatalogDiff(
  existing: readonly ModelCatalogRow[],
  seen: readonly CatalogModel[],
  nowIso: string
): CatalogDiff
```

Four populations, four rules, each its own named test:

| Population | Rule |
|---|---|
| in `seen`, not in `existing` | upsert with `first_seen_at = refreshed_at = now`, `missing_since = null` |
| in `seen`, in `existing` | upsert with `refreshed_at = now`, **`first_seen_at` PRESERVED**, `missing_since` cleared if set |
| in `existing`, not in `seen`, `missing_since` **null** | `markMissing` — set it to `now`, **once** |
| in `existing`, not in `seen`, `missing_since` **already set** | **NO ACTION.** Assert the id appears in neither list. This is the "missing since" honesty rule and it is the easiest one to get wrong, because setting it unconditionally reads as simpler code. |

**And the fifth population that does not exist:** there is no rule that touches a provider's default model, under any input — including the input where the route's default is the id that just went missing. **Assert the diff's key set.**

### 4.4 Freshness

```ts
export const CATALOG_STALE_AFTER_MS = 24 * 60 * 60 * 1000

export function catalogFreshness(refreshedAt: string | null, nowIso: string): CatalogFreshness
```

`null` → `'never'`. **`'never'` is a third state, not a flavour of `'stale'`** — an implementation that folds them looks right on a populated database and wrong on every fresh install. **The threshold lives here and nowhere else**; the renderer receives a computed boolean and does no date arithmetic.

### 4.5 The failure vocabulary

One exported helper, mirroring `probeFailure` in `src/main/ipc.ts`:

```ts
export function refreshFailure(message: string): { ok: false; reason: string }
```

Every outbound string goes through `scrubSecrets` at the transport boundary (§5.3). **The message vocabulary is FIXED** — see the matrix in §5.4.

---

## 5. `src/main/services/modelCatalog.ts` — the transport, and nothing else

The **only** module in the repo that fetches `${baseUrl}/models`. Thin: an injectable `fetchImpl` for tests, a timeout, a size cap, and delegation to the core for every decision.

### 5.1 The call

```ts
const res = await fetchImpl(`${baseUrl}/models`, {
  method: 'GET',
  headers: {
    accept: 'application/json',
    // The credential is OPTIONAL (Task doc, Goal §3.4). With no profile
    // selected, NO Authorization header is sent at all — one code path, one
    // conditional entry. Verified 2026-07-24: OpenRouter's /models answers
    // 200 unauthenticated, so a catalog is reachable before any key exists.
    ...(key ? { authorization: `Bearer ${key}` } : {}),
    ...providerHeaders,
    ...(envelopeHeaders ?? {})
  },
  signal: AbortSignal.timeout(10_000)
})
```

`baseUrl` is trailing-slash-stripped (`replace(/\/+$/, '')`) — a trailing slash is a **known** failure mode on this route, recorded in `codexAdapter.buildLaunch`. Provider-level extra headers are documented **non-secret** (D33 resolution e) and the envelope's own override them, exactly as `probeCredential` does it.

### 5.2 ⚠ The one deliberate departure from `probeCredential`

`probeCredential` cancels the response body **always** — _"a 401 body can echo the submitted key (leakage path 1)"_. A refresh **must read the body on success**, so the rule is split and it must be split explicitly in the code, not implied:

```ts
if (res.status < 200 || res.status >= 300) {
  // Every non-2xx path: the body is CANCELLED UNREAD, exactly as
  // probeCredential does. This is the path most likely to echo a key.
  void res.body?.cancel().catch(() => undefined)
  return mapStatus(res.status)
}
// 2xx ONLY: read, size-capped.
```

- **Size cap.** Refuse a response above a fixed byte ceiling rather than buffering it. Set the ceiling from the measurement taken under D4 obligation 6, not from a guess, and leave generous headroom — OpenRouter's list is hundreds of models.
- **The parsed value is never interpolated into an error message.** A parse failure yields the fixed unrecognized-shape string. This is the same class of mistake `ImplementationSpec-3-4.md` §4.3 caught in the renderer, one process over.

### 5.3 Credential handling

The plaintext key exists in this function's scope and nowhere else. Decrypt through the vault **at the moment of the call** (`vault.decryptForLaunch`, the `resolveCredential` discipline) and drop it. **No module-level variable, no memo, no "hold it while the settings view is open".** Every outbound string passes through `scrubSecrets`.

**Three refusals happen BEFORE any decryption is attempted:**

1. `provider.baseUrl` is absent → refuse by provider name.
2. The named profile carries `unavailable_since` → refuse by **label only** (D33 clause 8: known-bad rows are refused **without re-attempting decryption**; a retry only widens the window).
3. The provider's `auth_mode === 'management'` → refuse. Task 3a-3 introduces that higher-privilege class; **write this check even if 3a-3 has not landed** — `auth_mode` is an unconstrained string, so the value can exist in the database before any code produces it, and adding the check later leaves a window in which a management key is sent to a model-list endpoint.

### 5.4 ⚠ The sanitized-failure matrix — EXACT

Every cell returns a **fixed string**. No provider body, no header, no exception message, no URL, no key, ever.

| Condition | Body handling | Returned `reason` |
|---|---|---|
| provider has no `base_url` | — (no call made) | `` `Provider '<name>' has no base URL to refresh models from.` `` |
| named profile has `unavailable_since` | — (no call made) | `failureMessage('undecryptable', profile.label)` — the vault's existing label-only text |
| provider `auth_mode === 'management'` | — (no call made) | `Model refresh is not available for a management credential.` |
| decryption fails | — (no call made) | `failureMessage(...)` per the vault's existing vocabulary; the row is marked unavailable by the existing path, not by this one |
| **2xx, parseable `{data:[…]}`** | **read**, size-capped | — (`{ok: true, …}`) |
| 2xx, unparseable or wrong shape | read, then discarded | `The provider returned an unrecognized model list.` |
| 2xx, over the size cap | cancelled at the cap | `The provider returned an unrecognized model list.` |
| **401 / 403** | **cancelled unread** | `Authentication failed — the credential was rejected.` _(verbatim from `probeCredential` — one vocabulary)_ |
| **429** | cancelled unread | `Rate limited by the provider.` |
| **≥ 500** | cancelled unread | `The provider returned an error.` |
| any other non-2xx | cancelled unread | `` `Unexpected response (${res.status}).` `` |
| `fetch` throws | — | `Could not reach the provider.` |
| timeout (`AbortSignal.timeout`) | — | `Could not reach the provider.` |

**⚠ Note what is NOT in this table: nothing writes `last_verified_at`.** A 200 from this endpoint is not evidence of authentication — verified 2026-07-24, OpenRouter answers it with no key at all. See Task doc, Goal §3.

---

## 6. IPC — channels, schemas, and exact insertion points by symbol

### 6.1 `src/shared/ipc.ts`

Add to the `IpcChannel` map, beside `CredentialTest`, with a comment carrying the same constraint its neighbour does:

```ts
  /** invoke: read the cached model list for one provider + its freshness.
   *  Pure read — makes NO network call. */
  ModelList: 'model:list',
  /** invoke: ONE live GET <base_url>/models, user-initiated only. The SECOND
   *  key-bearing call in the app (D33 resolution (d)'s carve-out, widened by
   *  exactly this call — see Task 3a-4). Never at boot, launch, on a timer,
   *  on settings-open, or on profile creation. A success is NOT proof of
   *  authentication and does NOT write last_verified_at. */
  ModelRefresh: 'model:refresh'
```

Schemas, following the `provider*`/`credential*` naming already in the file (`modelListRequestSchema`, `modelListResponseSchema`, `modelRefreshRequestSchema`, `modelRefreshResponseSchema`, and the exported `z.infer` types):

- **`model:list` request** — `{ provider_id: string }`. **Response** — `{ models: ModelCatalogEntry[], refreshedAt: string | null, freshness: 'never'|'fresh'|'stale' }`, where an entry carries `modelId · displayName · contextLength · expiresAt · missingSince`. **Freshness is computed in main** (§4.4).
- **`model:refresh` request** — `{ provider_id: string, credential_id: string | null }`. **Response** — `{ ok: true, added: number, updated: number, missing: number, dropped: number, refreshedAt: string } | { ok: false, reason: string }`. **Counts, never lists of ids in the failure path**, and no field capable of carrying key material.
- **`effortLevelSchema`** — `z.enum(['fast','balanced','deep','max'])`, exported with its `EffortLevel` type. **One vocabulary, shared by the wire, the adapters, and 3a-5's `launch_profiles.effort`.**
- **`effortOptionSchema`** — replace `cliFlag: z.string()` with **`args: z.array(z.string()).min(1)`**, and tighten `id` to `effortLevelSchema`. See §7.1 for the ruling.
- **`session:launch`'s request schema** gains `effort: effortLevelSchema.optional()`.

**All Zod stays in main (D1/CSP); the preload is a Zod-free typed forwarder; payloads are plain objects (D14).**

### 6.2 `src/main/ipc.ts` — insertion points

- Register both handlers **immediately after the `IpcChannel.CredentialTest` handler**, so the two live-call channels sit together and a reviewer reads them as a pair. Both parse their request with the shared schema and **`.parse` the outbound response** — the 3-2 discipline that makes "no key material in a response" structural rather than aspirational.
- The `model:refresh` handler's body is a call into `modelCatalog.ts` plus `storage.applyCatalogDiff`. **It contains no policy** and, in particular, **no write to `provider_configs`.**
- **`IpcChannel.SessionLaunch`'s handler**: thread the parsed `effort` into the `LaunchOptions` it already builds alongside `secrets`, `credential` and `route`. **Do not touch `resolveCredential`.**
- **`probeCredential` and `probeFailure` are untouched.** Not refactored, not made to share a helper with the new transport. Two call shapes, two vocabularies that happen to agree, and a shared helper would make the next change to one silently change the other.

### 6.3 `src/preload/index.ts`

Two forwarders beside the existing `testCredential`:

```ts
listModels: (providerId: string): Promise<ModelListResponse> => …
refreshModels: (providerId: string, credentialId: string | null): Promise<ModelRefreshResponse> => …
```

`src/preload/index.d.ts` is never hand-edited — `ChorusApi` is inferred.

### 6.4 `src/main/services/sessionManager.ts`

`LaunchOptions` gains `effort?: EffortLevel` and `extraArgs?: readonly string[]`; `spawn` passes both into the `PtyLaunchSpec` it hands to `adapter.buildLaunch`. `PtyLaunchSpec.effortOptionId` **already exists and is unread** — populate it from `effort`; add `extraArgs` beside it. **No other behaviour change**, and **`buildLaunch` stays synchronous** (`SessionManager.launch()` is sync and returns a snapshot synchronously — that constraint is recorded on the type and is easy to break in a diff that reads fine).

---

## 7. Effort normalization

### 7.1 `EffortOption.cliFlag` → `args: readonly string[]` — the ruling, with its evidence

A single string cannot express what either installed CLI needs:

- claude 2.1.218 → **`['--effort', 'high']`**
- codex 0.145.0 → **`['-c', 'model_reasoning_effort="high"']`**

A whitespace split breaks the moment a value needs quoting, and codex's values **are** TOML-quoted. The alternative — a per-adapter `switch` in `buildLaunch` — puts the mapping in **two homes**, in the task whose headline output is a one-home ruling.

**So the field is replaced, not supplemented.** Grep-verified 2026-07-24: `cliFlag` appears **only** in `src/main/adapters/types.ts`, `effortOptionSchema` in `src/shared/ipc.ts`, and two test fixtures (`src/shared/ipc.test.ts`, `src/main/adapters/adapters.test.ts`). **Zero producers, zero real consumers** — free today, expensive after 3a-5 populates it. **If that grep returns a real producer at execution, stop and raise it** rather than doing a mechanical rename over live code.

`EffortOption.id` is tightened to the four-level vocabulary, so the descriptor **is** the mapping table:

```ts
export interface EffortOption {
  readonly id: EffortLevel          // 'fast' | 'balanced' | 'deep' | 'max'
  readonly label: string
  /** The EXACT argv tokens this level contributes. Two tokens for both
   *  shipped adapters; a flag+value pair and a `-c key=value` override are
   *  the same thing at this level of abstraction, which is why this is a
   *  token ARRAY and not a string. */
  readonly args: readonly string[]
}
```

### 7.2 ⚠ The mapping — D4-verified 2026-07-24, and RE-VERIFY AT EXECUTION

| App level | `claude` 2.1.218 → `--effort` | `codex` 0.145.0 → `-c model_reasoning_effort=` |
|---|---|---|
| **Fast** | `low` | `low` |
| **Balanced** | `medium` | `medium` |
| **Deep** | `high` | `high` |
| **Max** | `max` | `max` |

**What was verified, how, and on what date — so the execution-time diff has a baseline:**

- `claude --version` → **2.1.218**. `claude --help` → verbatim: `--effort <level>  Effort level for the current session (low, medium, high, xhigh, max)`. **Direct, authoritative, from the tool's own help.**
- `codex --version` → **codex-cli 0.145.0**. `codex --help` → **no `--effort` flag exists**; only `-c/--config` and `-m/--model`. So the knob must be a config key.
- **`model_reasoning_effort` is a real config key in the installed 0.145.0 binary** — 22 occurrences, alongside `plan_mode_reasoning_effort`, `model_reasoning_summary` and `model_verbosity`. Established by **binary string inspection**, which is **weaker evidence than a help text** and is why D4 obligation 2 exists.
- The effort enum's serialized variants appear as the contiguous run **`none minimal low medium high xhigh max ultra`**.
- **⚠ codex's effort vocabulary is PER-MODEL.** The binary carries `supportedReasoningEfforts` and `defaultReasoningEffort` **per model**, plus a `ReasoningEffortOption` type. A level valid for one model may be rejected for another. **D4 obligation 3 exists to establish what the binary DOES with an unsupported level** — silent clamp, config-load rejection, or runtime error — and that answer decides whether this mapping needs a per-model guard.

**Notes on the mapping itself:**

- **`xhigh` (claude) and `none`/`minimal`/`ultra` (codex) are deliberately unreachable from the slider.** Four normalized levels cannot cover every vendor's ladder, and stretching them to try would make "Deep" mean different distances on different adapters. **The raw `extra_args` override is what reaches the rest** — that is the override's purpose, stated in PLAN §4, and it is why rank 1 of the effort precedence is the raw one.
- **A collapsed mapping is legal and must be VISIBLE.** If a future adapter has three levels for four slider positions, two positions map to the same value; the descriptor is the one home for that fact and the dialog shows the resolved adapter value beside the level's label, so the user is not misled that Max ≠ Deep.
- **`EffortDescriptor.mode` is `'static'` for both adapters.** The existing `'dynamic'` variant is the declared seam for a later phase to refine per model (OpenRouter publishes `supported_parameters` per model, so the data exists). **Do not populate it dynamically here** — that is model-capability probing, an explicit non-goal.

### 7.3 `src/main/adapters/effort.ts` — the pure resolver

Beside `env.ts`, the same shape of module.

```ts
/** Rank 1 wins: a raw override in extra_args suppresses Chorus's own effort
 *  argument ENTIRELY. Chorus does NOT emit both and rely on the CLI's
 *  last-wins parsing — last-wins is per-CLI, unverified, and differs between
 *  an argv flag (claude --effort) and a config override (codex -c …). One
 *  authority per launch, decided here. Same philosophy as composeChildEnv's
 *  ordering under D54: inherited < pins < envAdditions < secretEnv. */
export function resolveEffortArgs(
  descriptor: EffortDescriptor | null,
  level: EffortLevel | undefined,
  extraArgs: readonly string[]
): readonly string[]
```

- `descriptor === null` → **`[]`**, for every level, never a throw.
- `level` absent or outside the vocabulary → **`[]`**, never a throw. A database, a stale renderer, or a hand-edited profile can hand over anything.
- `overridesEffort(descriptor, extraArgs)` → **`[]`**.
- otherwise → the matching option's `args`.

**⚠ `overridesEffort` must be SPECIFIC.** The predicate matches the adapter's knob **as a whole token or as a `key=` prefix at the start of a `-c` value** — not as a substring anywhere. A loose predicate silently disables the whole feature the first time a user passes an unrelated argument, and it will look like it works. The named unit test asserts that `--effortless`, `model_reasoning_effort_summary`, and a token merely *containing* the knob's name do **not** suppress.

Derive the knob from the descriptor's own `args` rather than hardcoding a second copy — **one home again**: the first token of any level's `args` (`--effort`, or `-c` plus the `model_reasoning_effort=` prefix of the second) is the knob.

### 7.4 The adapter edits

**`claude.ts`** — replace `reasoningEffort: null` with the populated descriptor, and **rewrite the comment above it**, because the existing one explicitly defers to this task: _"reasoningEffort: NULL even though --help shows `--effort (low|medium|high|xhigh|max)` — effort normalization is Phase 3a's job."_ The replacement records the date and the exact help text it was verified against, in the style of the surrounding `getAuthMethods` comments.

**`codex.ts`** — same, plus the `-c` mechanics note. In `buildLaunch`, append the resolved tokens **after** the existing `-c` route overrides and the `-m` model, using the file's existing local `tomlString` quoter for the value. **Do not write a second quoter.**

**Both `buildLaunch`s** call `resolveEffortArgs(this.getCapabilities().reasoningEffort, spec.effortOptionId, spec.extraArgs ?? [])` and spread the result into `args`. **No `switch` on the level in either file** — if one appears, the mapping has two homes.

**Behaviour neutrality:** a launch with no effort chosen must produce a **byte-identical** command line to today's. That is an acceptance criterion and it is proven by diffing two captured command lines, not by reading the code.

---

## 8. Renderer

### 8.1 `stores/settings.ts`

Add `modelsByProvider: Record<string, ModelListResponse>` to `SettingsState`, plus `loadModels(providerId)` and `refreshModels(providerId, credentialId)` actions on the existing idiom: `refuse(reason)` for failures, one reload after a successful mutation, and the **store-level `loadSeq` supersede guard** — or a per-provider equivalent, since two providers can be refreshed independently and a single global token would let one provider's response cancel another's. **Decide which and say why in a comment**; the global token is the wrong shape here and choosing it silently is the bug.

**The store still holds no key.** `refreshModels` passes a **credential id**, never key material. The existing deep-scan unit test on `$state` keeps that honest and must still pass.

### 8.2 `views/SettingsProviders.vue`

The provider card gains a **models section**, below the credential rows:

- **Freshness line** — the three states, rendered as three different things (§4.4). `'never'` is _"No model list yet"_, not an empty list styled as stale.
- **A Refresh button** with a credential selector defaulting to the provider's single profile when it has exactly one, and to **none** when it has zero — the unauthenticated path is a first-class path, not a fallback.
- **The model picker is ADDITIVE.** `fModel` stays a free-text input; the picker (a `<datalist>` or an adjacent list that writes into the field) offers catalog ids. **It does not become a closed `<select>`** — a closed select would make the catalog authoritative by UI construction, without anyone deciding to. This is the UI expression of the entire precedence ruling and it is the single most likely thing to be "cleaned up" by a later contributor.
- **Missing models render struck through with their `missing_since` date** and are **not offered** in the picker.
- **The route-default warning** (worked example 8) renders when `provider_configs.model` names a row carrying `missing_since`, naming the model and the date. **Row 11's non-warning is equally load-bearing**: a model the catalog has never seen produces **no** warning.
- **Refusals render verbatim** from main and are **never enriched with form values** (`ImplementationSpec-3-4.md` §4.3 — the likeliest way a secret reaches the DOM, and it looks like helpful diagnostics while you write it).

### 8.3 `components/LaunchDialog.vue`

- The **Fast / Balanced / Deep / Max** control renders **only** when the selected adapter's `capabilities.reasoningEffort` is non-null. **Absent, not disabled** — PLAN §4 (_"LaunchDialog renders only what the selected adapter's capabilities allow"_) and Task 3-4's standing bar on dead UI. **No explanatory text in its place either**; absence is the message.
- Levels and their labels come from the **descriptor**, via `adapter:list`. **No hardcoded `'Fast'`/`'Deep'` strings driving choices** — the same grep-verifiable rule Task 3-4 applied to auth methods.
- The chosen level travels on `session:launch` and is **not persisted anywhere** (3a-5's `launch_profiles` is its home).
- The missing-model warning renders beside the resolved model, so the user meets it **before** spending a launch.

---

## 9. Verification — RUNTIME, because none of this can be unit-tested into existence

CDP on `--remote-debugging-port=9222`; `_verify/3-6/cdp35.js` is the proven driver. Wrap every `Runtime.evaluate` body in an IIFE (top-level `const` collides across evaluates). electron-vite HMR covers the **renderer only** — every main-process check needs a real cold boot. Kill process **trees** (`taskkill /PID <root> /T /F`).

### 9.1 The dump script — `_verify/3a-4/dump-v8.js`

Adapt `_verify/3-6/dump-v6.js`. **⚠ It `SELECT *`s from `credential_profiles`; yours must not.** Select the non-secret columns explicitly and prove blob stability with `length(encrypted_blob)`. A byte count is not key material and is sufficient evidence that a migration did not touch the blob. Add `model_catalog` (full select — it holds no secrets) and its `PRAGMA table_info`, and keep the `projects` select (F20).

### 9.2 The three dumps

Exactly the Task doc's protocol: pre / post / boot-2, with prior `applied_at` values **byte-identical**, every pre-existing table **row-identical**, `model_catalog` created **empty**, the version **not re-applied** on boot 2, and the `projects` table quoted in every dump. **Known flake: the script intermittently writes no file on its first invocation — retry once.**

### 9.3 The catalog drive, through the real Settings UI

The full sequence is in the Task doc's Verification Commands. **Three of its steps carry the acceptance and must not be reasoned about instead of run:**

- **The idempotence step** (refresh twice; no duplicate rows). The composite PK is what makes this work and it is invisible in a single-press test.
- **The missing-model step**, with `provider_configs.model` dumped **before and after** and shown byte-identical. **This is the runtime statement of the precedence ruling.** Restore the fabricated state afterwards and prove the restoration with a dump.
- **The log sweep after an authenticated refresh** — no key, no fragment, no `Authorization` value, and **`last_verified_at` unchanged**.

### 9.4 The effort drive

The proof is the **argv of the live child process**, read externally with `Get-CimInstance Win32_Process`, walking the descendant tree from the electron main PID — **never name-matching** (there are ~16 unrelated `claude.exe` on this machine). Quote all four codex command lines and at least two claude ones.

**⚠ Do not submit a prompt.** The argv read is the whole proof and a completion over the OpenRouter route costs real money on Matthew's account. Task 3a-3 already owns the paid conversational proof.

**The behaviour-neutrality diff** — one command line captured before the change and one after, for the same inputs, byte-identical — is the check that this task did not quietly alter every launch in the app.

### 9.5 Grep gates

Before the commit:

```
npm run grep:secrets
```

and, over the diff:

- **zero** `UPDATE provider_configs` and zero writes to any model column outside `model_catalog`;
- **zero** `REFERENCES` in the new migration string;
- **zero** `cliFlag` remaining anywhere in `src/`;
- **zero** hardcoded effort level labels in `.vue` files;
- **zero** calls to the refresh service from `index.ts`, a `whenReady`, an `onMounted`, or any watcher — **the refresh is user-initiated only**, and a convenience call at settings-open would send the user's key without them asking.

### 9.6 Cost

**$0.00, and it is a verified figure**, not an estimate: `GET https://openrouter.ai/api/v1/models` answered 200 unauthenticated on 2026-07-24, and no verification step in this task submits a completion. **Do not press Test key on "OR milestone key".**

---

## 10. What this task deliberately leaves undone

Named here so a later reader can tell a gap from an omission.

- **`launch_profiles` and rank 1 of the model precedence order.** Task 3a-5. Until it exists, rank 1 is always NULL and the table's worked examples 1, 3, 9 and 10 are unreachable — **which is exactly why they are written down now**, while the ruling is being made rather than after a second home has grown.
- **The `extra_args` input surface.** Rank 1 of the *effort* order is implemented and tested; its text field and storage arrive with 3a-5, which must carry the warning this task records: **`extra_args` becomes argv, and argv is world-readable.**
- **Per-model effort validity.** codex's ladder is per-model (§7.2) and this task ships a static per-adapter descriptor. `EffortDescriptor.mode: 'dynamic'` is the declared seam; D4 obligation 3 measures how badly it is needed.
- **Model-capability data** (`supported_parameters`, modalities, tool support). Available in the response, deliberately not stored.
- **Pricing and any cost reasoning.** 3a-3 reads real spend; a cached price would be a number that is one day wrong in an expensive direction.
- **A `tier` column.** PLAN §13 names one; nothing can fill it honestly.
- **Any merge of refresh and Test key.** Argued in the Task doc's Goal §3 and rejected on measured evidence. If a later phase revisits it, the fact to re-measure is whether the provider's `/models` endpoint rejects an invalid key — and even a "yes" does not license the merge, because it would then hold for one provider and silently not for another.
