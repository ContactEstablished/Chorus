# Implementation Spec 3-2 — Vault + Credential/Provider Data Layer

_Companion to `Tasks/Task-3-2.md`. The task doc governs **scope**; this doc governs **exact contents, insertion points, and rationale**. Code blocks are starting points to adapt to the surrounding file's conventions — not byte-for-byte mandates — **except** where marked **EXACT**._

**Anchored to commit `fb3201e`, verified 2026-07-22.** All insertion points are named symbols, never line numbers (house rule).

---

## 1. The shape of the thing

Three modules, layered so that the testable part is testable and the Electron part is thin enough to audit by reading:

```
vaultCore.ts   pure, Electron-free, unit-tested     — envelope codec, fingerprint, failure classification, metadata projection
vault.ts       safeStorage + storage                — CredentialVault; the ONLY caller of encryptString/decryptString* in the repo
storage.ts     v5 + accessors                       — rows in, rows out, no policy
```

The split is not stylistic. `vaultCore.test.ts` must run under plain Vitest, and any module that imports `electron` cannot. The house precedent is exact: `restore.ts` (pure, 6 unit tests) sits beside `sessionManager.ts` (spawns PTYs, untested); `computeWorktreeReconcile` (pure, 30 unit tests) sits beside `GitWorktreeManager` (shells out to git). **Put every decision that can be made without DPAPI into `vaultCore.ts`,** and the review will ask why anything left in `vault.ts` had to be there.

---

## 2. Migration v5

### 2.1 The DDL — `src/main/services/storage.ts`

Append **one** new entry to `MIGRATIONS`, after the v4 string. Both statements apply atomically inside the runner's transaction, exactly as v4's pair does.

```ts
  // v5 (Phase 3 / D33 action 1 + resolution (e)): the BYOK data layer.
  // provider_configs holds NON-SECRET connection metadata in plaintext —
  // base_url and extra_headers_json are documented non-secret (resolution e);
  // a credential's own envelope may override them, and the envelope wins.
  // credential_profiles holds the encrypted envelope plus plaintext metadata
  // that lets the UI list and disambiguate profiles WITHOUT decrypting.
  // REFERENCES here is ENFORCED (F16, re-verified 2026-07-22): deleting a
  // provider with profiles throws SQLITE_CONSTRAINT_FOREIGNKEY, so the
  // provider:delete handler must check first and refuse structurally.
  `CREATE TABLE provider_configs (
     id                 TEXT PRIMARY KEY,
     name               TEXT NOT NULL,
     adapter_type       TEXT NOT NULL,
     auth_mode          TEXT NOT NULL,
     env_var_name       TEXT,
     base_url           TEXT,
     extra_headers_json TEXT,
     created_at         TEXT NOT NULL
   );
   CREATE TABLE credential_profiles (
     id                TEXT PRIMARY KEY,
     provider_id       TEXT NOT NULL REFERENCES provider_configs(id),
     label             TEXT NOT NULL,
     encrypted_blob    BLOB NOT NULL,
     fingerprint_hash  TEXT NOT NULL,
     created_at        TEXT NOT NULL,
     last_verified_at  TEXT,
     unavailable_since TEXT,
     reencrypted_at    TEXT,
     UNIQUE (provider_id, label)
   );`
```

**Column notes, each earning its place:**

- `env_var_name` (nullable) — **D34 resolution (e)**. The adapter's `AuthMethodDefinition.requiredEnvVar` is the default; this column overrides it for custom or OpenAI-compatible endpoints. Nullable means "use the adapter's default", which is the common case.
- `base_url`, `extra_headers_json` (nullable, **plaintext**) — provider-level defaults. D33 resolution (e) requires an explicit precedence rule and this spec sets it: **the credential envelope's `baseUrl`/`extraHeaders` override the provider's.** Both provider-level values are documented non-secret; a user who puts a key in a custom header is defeating the design, and §6.4 addresses that.
- `fingerprint_hash` NOT NULL — always computed, **never** sent over IPC (D33 resolution b).
- `unavailable_since` (nullable) — D33 clause 8. Set on decrypt failure, kept forever until a successful replace clears it. Its presence is what makes "keep the row, refuse the launch" expressible.
- `reencrypted_at` (nullable) — D33 risk 7 throttle. Prevents a corrupted `shouldReEncrypt` cycle from re-encrypting on every read.
- `UNIQUE (provider_id, label)` — **a coordinator addition beyond D33 action 1.** Rationale: resolution (b) removed fingerprints from the UI, making the label the *only* thing distinguishing two profiles on the same provider. A duplicate label would be genuinely ambiguous to a user choosing a credential at launch. Cheap to add now, a migration to add later.

**Do not add an index.** Both tables are single-digit-row in every realistic use; an index is speculative.

### 2.2 The Drizzle mirror — `src/main/db/schema.ts`

Add after the `worktrees` table, with the same comment discipline as its neighbours. The blob column is the one shape that is easy to get wrong:

```ts
export const providerConfigs = sqliteTable('provider_configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  adapterType: text('adapter_type').notNull(),
  authMode: text('auth_mode').notNull(),
  // D34(e): overrides the adapter's AuthMethodDefinition.requiredEnvVar for
  // custom / OpenAI-compatible endpoints. NULL = use the adapter default.
  envVarName: text('env_var_name'),
  // Plaintext and DOCUMENTED NON-SECRET (D33 resolution e). The credential
  // envelope's own baseUrl/extraHeaders override these when present.
  baseUrl: text('base_url'),
  extraHeadersJson: text('extra_headers_json'),
  createdAt: text('created_at').notNull()
})

export const credentialProfiles = sqliteTable('credential_profiles', {
  id: text('id').primaryKey(),
  providerId: text('provider_id')
    .notNull()
    .references(() => providerConfigs.id),
  label: text('label').notNull(),
  // The safeStorage/DPAPI envelope. mode:'buffer' keeps better-sqlite3's
  // native Buffer round-trip — a text column would corrupt binary output.
  encryptedBlob: blob('encrypted_blob', { mode: 'buffer' }).notNull(),
  // Salted SHA-256, MAIN-SIDE ONLY (D33 resolution b): duplicate detection at
  // creation and rotation detection. Never crosses IPC.
  fingerprintHash: text('fingerprint_hash').notNull(),
  createdAt: text('created_at').notNull(),
  lastVerifiedAt: text('last_verified_at'),
  // D33 clause 8: set when decryption fails; the row SURVIVES and launches
  // naming this profile are refused by label.
  unavailableSince: text('unavailable_since'),
  reencryptedAt: text('reencrypted_at')
})

export type ProviderConfigRow = typeof providerConfigs.$inferSelect
export type NewProviderConfigRow = typeof providerConfigs.$inferInsert
export type CredentialProfileRow = typeof credentialProfiles.$inferSelect
export type NewCredentialProfileRow = typeof credentialProfiles.$inferInsert
```

`blob` must be added to the existing `drizzle-orm/sqlite-core` import at the top of the file.

**The `UNIQUE (provider_id, label)` constraint has no Drizzle expression here** because the hand-rolled DDL is authoritative (D7) — Drizzle supplies types and queries only. A duplicate insert therefore throws `SQLITE_CONSTRAINT_UNIQUE` at runtime, which §5.2 catches and converts.

---

## 3. `vaultCore.ts` — the pure core

**Create `src/main/services/vaultCore.ts`.** No imports from `electron`. `node:crypto` is fine.

### 3.1 The envelope

D33 clause 1 fixes the shape: `{key, baseUrl?, extraHeaders?}`. It is JSON, because it must survive `encryptString(plainText: string)` — safeStorage encrypts strings, not objects.

```ts
export interface CredentialEnvelope {
  readonly key: string
  readonly baseUrl?: string
  readonly extraHeaders?: Record<string, string>
}

export function encodeEnvelope(env: CredentialEnvelope): string {
  return JSON.stringify(env)
}
```

`decodeEnvelope` is the interesting half, because **a decode failure is a security event, not a parse error** — it is how a corrupt or foreign blob presents. It must never throw with the input in the message (that input is decrypted plaintext).

```ts
/** Decode a decrypted envelope. Returns a discriminated result rather than
 *  throwing, because the failure path is a CONTRACT path (D33 clause 8) — and
 *  because a thrown Error would tend to carry the decrypted plaintext into a
 *  stack trace. Never include `raw` in any returned message. */
export function decodeEnvelope(raw: string): DecodeResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, kind: 'corrupt' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, kind: 'corrupt' }
  }
  const o = parsed as Record<string, unknown>
  if (typeof o.key !== 'string' || o.key.length === 0) return { ok: false, kind: 'corrupt' }
  // Optional fields are accepted only in their declared shapes; anything else
  // is dropped rather than propagated, so a hand-edited blob cannot inject a
  // non-string into the env block that Task 3-6 will build from this.
  const baseUrl = typeof o.baseUrl === 'string' ? o.baseUrl : undefined
  const extraHeaders = isStringRecord(o.extraHeaders) ? o.extraHeaders : undefined
  return { ok: true, envelope: { key: o.key, baseUrl, extraHeaders } }
}
```

The "drop rather than propagate" rule in that last comment is load-bearing for Task 3-6: whatever survives `decodeEnvelope` goes into a child process's environment block. A non-string sneaking through becomes a runtime type error at the worst possible moment.

### 3.2 The fingerprint

```ts
/** Fixed application salt for credential fingerprints. NOT A SECRET — an
 *  attacker holding the binary can extract it (D33 risk 4), and the contract
 *  says so explicitly. Its only job is to defeat precomputed rainbow tables
 *  against a stolen database, since key formats are public and short-prefixed.
 *  The fingerprint disambiguates and detects rotation; it never authenticates. */
const FINGERPRINT_SALT = '<32 bytes, hex-encoded, generated once at implementation time>'

/** Salted SHA-256 over a plaintext key. MAIN-SIDE ONLY (D33 resolution b):
 *  never returned over IPC, never logged, never rendered. */
export function fingerprint(plaintextKey: string): string {
  return createHash('sha256').update(FINGERPRINT_SALT).update(plaintextKey).digest('hex')
}
```

Generate the salt once with `crypto.randomBytes(32).toString('hex')` and paste the literal. **Do not derive it from anything machine-specific** — a fingerprint must stay stable across reinstalls, or rotation detection breaks. **Do not read it from the database** — the contract says it lives in code, precisely so a stolen DB alone is not enough to build the table.

`update(salt).update(key)` is preferred over `update(salt + key)`: it avoids materialising a concatenated string containing the plaintext, which is a small but free reduction in how many places the key exists.

### 3.3 Failure classification

```ts
export type VaultFailureKind =
  | 'encryption-unavailable'   // safeStorage says no — refuse creation (D33 Q3)
  | 'undecryptable'            // DPAPI refused: profile migration, machine change, key rotation
  | 'corrupt'                  // decrypted, but not a valid envelope

/** The user-facing message for a failure. The ONLY variable admitted is the
 *  profile LABEL (D33 clause 8) — never the blob, never a byte length, never
 *  the underlying exception text, which for decryptString can be
 *  implementation-defined and is not worth trusting. */
export function failureMessage(kind: VaultFailureKind, label: string): string { … }
```

The message for `undecryptable` should follow the council's own wording closely: `Credential profile '<label>' is unavailable: decryption failed. Re-enter the credential in Settings.`

### 3.4 The metadata projection

This is the function that makes clause 3 structural.

```ts
/** Project a stored row down to what may leave the main process. Written as an
 *  EXPLICIT CONSTRUCTION, never a spread-and-delete: `{...row}` minus two keys
 *  silently re-admits every column a future migration adds, which is exactly
 *  how a fingerprint or a blob ends up on the wire by accident. */
export function toProfileMeta(row: CredentialProfileRow): CredentialProfileMeta {
  return {
    id: row.id,
    providerId: row.providerId,
    label: row.label,
    createdAt: row.createdAt,
    lastVerifiedAt: row.lastVerifiedAt,
    unavailableSince: row.unavailableSince
  }
}
```

**EXACT (the rule, not the formatting):** explicit construction only. The unit test asserts on `Object.keys`, so a spread-based implementation fails it — deliberately.

---

## 4. `vault.ts` — the Electron half

**Create `src/main/services/vault.ts`.** Imports `safeStorage` from `electron`, `StorageService`, `vaultCore`, and `logger`.

```ts
export class CredentialVault {
  constructor(private storage: StorageService) {}

  isAvailable(): boolean { return safeStorage.isEncryptionAvailable() }

  createProfile(input: { providerId: string; label: string; key: string; baseUrl?: string; extraHeaders?: Record<string, string> }): VaultResult<{ id: string }>
  replaceProfile(id: string, input: { key: string; baseUrl?: string; extraHeaders?: Record<string, string> }): VaultResult<void>
  deleteProfile(id: string): void
  listProfiles(): CredentialProfileMeta[]
  findByFingerprint(key: string): CredentialProfileRow | null   // main-side duplicate detection
  decryptForLaunch(id: string): VaultResult<ResolvedEnvelope>   // ZERO CALLERS this task
}
```

### 4.1 Encryption path

```ts
if (!safeStorage.isEncryptionAvailable()) {
  // D33 Q3, unanimous: refuse. No plaintext fallback exists anywhere in this
  // file, behind any flag, in any build.
  return { ok: false, kind: 'encryption-unavailable', message: … }
}
const blob = safeStorage.encryptString(encodeEnvelope({ key, baseUrl, extraHeaders }))
```

Store `blob` directly — better-sqlite3 binds a `Buffer` to a BLOB column natively.

**Never log the input.** The logger is already two-layer safe, but "the logger would have caught it" is not a reason to hand it a key. `logger.info({ profileId, providerId }, '[vault] credential profile created')` — id and provider only, no label either (a user may put an identifying string in a label; it is not secret, but it is not needed in the log).

### 4.2 Decryption path — and why it is async

D33 resolution (e): **`shouldReEncrypt` is reported only by `decryptStringAsync`.** Rotation detection therefore requires the async API, D4-verified against the installed typings:

```ts
const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(row.encryptedBlob)
```

**The plaintext field is `result`.** The findings' prose says "decrypted"; the Electron 43.1.1 typings say `result`. The typings win — this is exactly the D4 rule.

This makes `decryptForLaunch` **async**, which matters for Task 3-6: `SessionManager.launch()` is synchronous, so 3-6's launch handler must decrypt **before** calling it. The handler is already `async` (`session:launch` has been async since Task 2-2), so this costs nothing — but it must be stated here rather than discovered there.

Failure handling, in order:

1. `decryptStringAsync` throws → `markUnavailable(id)`, return `{ok:false, kind:'undecryptable'}`. **Catch the throw; do not let its message propagate** — wrap it, log the wrapped form, and return `failureMessage('undecryptable', label)`.
2. `decodeEnvelope` returns `{ok:false}` → `markUnavailable(id)`, return `{ok:false, kind:'corrupt'}`.
3. Success **and** `shouldReEncrypt` **and** the throttle allows → re-encrypt, write the new blob and `reencrypted_at`, and continue. **Never block or fail the operation on a re-encrypt error** (D33 Q3: "do not block launch") — log it and proceed with the plaintext already in hand.

Throttle rule: skip re-encryption if `reencrypted_at` is already set within this app run. Track "this app run" with a module-level `Set<string>` of profile ids, not a timestamp comparison — process start time is not persisted and a clock-based rule reintroduces the F10 class of bug (a fixed window that dev cold starts outlive).

### 4.3 The retention carve-out is NOT this task's business

D33 resolution (a) — the scrubber retains injected plaintext for the session's lifetime — is **Task 3-6's** wiring, not this file's. `decryptForLaunch` returns the envelope to its caller and retains nothing itself. Do not add a cache, a memo, or a "last decrypted" field. The one sanctioned retention lives in the scrubber's match set, and it is 3-5/3-6 that put it there.

---

## 5. Storage accessors

Thin, typed, no policy — matching the worktree-accessor block's style and placed in a clearly-commented section after it.

```ts
/* -------------------------------------------------------------------- */
/* Providers + credential profiles (Phase 3 / D33). Rows in, rows out —  */
/* every policy decision (encrypt, refuse, classify) lives in the vault. */
/* -------------------------------------------------------------------- */

createProviderConfig(row: NewProviderConfigRow): ProviderConfigRow
listProviderConfigs(): ProviderConfigRow[]
getProviderConfigById(id: string): ProviderConfigRow | null
updateProviderConfig(id: string, patch: Partial<…>): void
deleteProviderConfig(id: string): void
createCredentialProfile(row: NewCredentialProfileRow): CredentialProfileRow
listCredentialProfiles(): CredentialProfileRow[]
getCredentialProfileById(id: string): CredentialProfileRow | null
countCredentialProfilesForProvider(providerId: string): number
updateCredentialBlob(id: string, blob: Buffer, fingerprintHash: string): void
markCredentialUnavailable(id: string, at: string): void
markCredentialReencrypted(id: string, at: string): void
markCredentialVerified(id: string, at: string): void   // written by 3-6 only
deleteCredentialProfile(id: string): void
```

`countCredentialProfilesForProvider` exists specifically so `provider:delete` can refuse **before** SQLite throws. Discovering F16 by catching `SQLITE_CONSTRAINT_FOREIGNKEY` and reverse-engineering it into a user message is the failure mode Task 2-3 already paid for once.

---

## 6. IPC

### 6.1 Channels — `src/shared/ipc.ts`

Add to `IpcChannel`, keeping the existing comment style:

```ts
  /** invoke: list provider configs (plaintext, non-secret metadata only) */
  ProviderList: 'provider:list',
  /** invoke: create a provider config */
  ProviderCreate: 'provider:create',
  /** invoke: update a provider config's non-secret fields */
  ProviderUpdate: 'provider:update',
  /** invoke: delete a provider config; refuses while profiles reference it */
  ProviderDelete: 'provider:delete',
  /** invoke: list credential profile METADATA — never key material (D33 c3) */
  CredentialList: 'credential:list',
  /** invoke: store a plaintext key; WRITE-ONLY INBOUND — returns only an id */
  CredentialCreate: 'credential:create',
  /** invoke: replace a profile's key by id; write-only inbound */
  CredentialReplace: 'credential:replace',
  /** invoke: delete a credential profile by id */
  CredentialDelete: 'credential:delete'
```

### 6.2 The schemas that matter

```ts
/** D33 clause 3 — the shape that leaves main. There is NO encrypted_blob and
 *  NO fingerprint_hash here, and that absence is the enforcement mechanism:
 *  every credential handler outbound-parses through this schema, so a handler
 *  that returns a raw row fails loudly instead of leaking quietly. Adding a
 *  secret-bearing field to this schema is the one change reviewers must refuse. */
export const credentialProfileMetaSchema = z.object({
  id: z.uuid(),
  providerId: z.uuid(),
  label: z.string().min(1).max(120),
  createdAt: z.string(),
  lastVerifiedAt: z.string().nullable(),
  unavailableSince: z.string().nullable()
})
```

`lastVerifiedAt` / `unavailableSince` are **required-nullable**, not `.optional()` — the house discipline since 1b-1 (`title`), so a producer that forgets one fails the outbound parse rather than silently omitting it.

The inbound create schema is where the key crosses, exactly once:

```ts
export const credentialCreateRequestSchema = z.object({
  providerId: z.uuid(),
  label: z.string().min(1).max(120),
  /** The plaintext key. This is the ONLY field in the entire IPC surface that
   *  ever carries key material, and it travels in ONE direction. There is no
   *  corresponding response field, by design. Bounded to keep a pathological
   *  payload from becoming a memory event; 8 KiB is far above any real key and
   *  far below anything worth worrying about. */
  key: z.string().min(1).max(8192),
  baseUrl: z.string().optional(),
  extraHeaders: z.record(z.string(), z.string()).optional()
})
```

The response is `z.union([z.object({ok: z.literal(true), id: z.uuid()}), z.object({ok: z.literal(false), reason: z.string()})])` — the inline-failure idiom Task 2-2 established, so the future dialog renders refusals without an exception path.

### 6.3 Handlers — `src/main/ipc.ts`

`registerIpc` grows a fourth parameter: `vault: CredentialVault`. Update the JSDoc block above it in the same style as 2-2's `GitWorktreeManager` note.

Every handler follows the established pattern — inbound `.parse`, act, **outbound `.parse`**:

```ts
ipcMain.handle(IpcChannel.CredentialList, (): CredentialProfileMeta[] =>
  z.array(credentialProfileMetaSchema).parse(vault.listProfiles())
)
```

The outbound parse on a list of already-projected objects looks redundant. It is not: it is the second of two independent barriers (`toProfileMeta`'s explicit construction is the first), and it is the one that catches a future refactor that swaps `listProfiles()` for a raw accessor.

**`credential:create` must never log its payload.** Not at debug, not behind `LOG_LEVEL`. Rule 4 of D33's redaction coverage says IPC payloads must not be logged at all in production; the simplest compliant thing is to not write the log line.

### 6.4 The `extraHeaders` question, answered

`extraHeaders` is user-supplied and *could* contain an `Authorization: Bearer sk-…` value. Two consequences the implementer must handle rather than assume away:

1. In the **envelope** (per-credential), it is encrypted along with the key — correct by construction, nothing to do.
2. In **`provider_configs.extra_headers_json`**, it is plaintext. D33 resolution (e) documents these as non-secret, which is a statement about intent, not a guarantee about behaviour.

**Therefore:** on `provider:create`/`provider:update`, run the incoming `extra_headers_json` through `scrubSecrets` before storing, and if it changed, refuse with a reason telling the user to put the credential on a credential profile instead. This is a five-line check that turns a documented assumption into an enforced one, and it uses machinery Task 3-1 already shipped.

---

## 7. Boot wiring — `src/main/index.ts`

Construct alongside the worktree manager, before `registerIpc`:

```ts
const worktrees = new GitWorktreeManager(storage)
const vault = new CredentialVault(storage)
```

and thread it: `registerIpc(sessions, storage, worktrees, vault)`.

**Log the availability state once at boot** — it is the single most useful diagnostic this subsystem has, and it contains nothing sensitive:

```ts
logger.info(`[vault] safeStorage encryption available: ${vault.isAvailable()}`)
```

Do **not** refuse to boot when it is false. A user with no credentials configured has a perfectly working app; the refusal belongs at credential creation (D33 Q3), not at startup.

---

## 8. `REDACT_PATHS` additions — `src/main/services/logger.ts`

Append to the existing array, keeping its wildcard-prefix convention:

```ts
  'plaintextKey',
  '*.plaintextKey',
  'fingerprintHash',
  '*.fingerprintHash',
  'fingerprint_hash',
  '*.fingerprint_hash',
  'encrypted_blob',
  '*.encrypted_blob',
  'extraHeaders',
  '*.extraHeaders'
```

`encryptedBlob` is already present from Task 3-1; the snake_case twin is added because a raw DB row uses column names, and a logged row is the likeliest accidental path. `extraHeaders` is redacted wholesale rather than per-header — header **names** are not worth preserving in a log if the cost is reasoning about which values are secret.

---

## 9. Verification — the parts that are easy to fake and must not be

### 9.1 Migration

The three-dump protocol from Task 2-1 is the standard, and its point is subtle: **v1–v4's `applied_at` values being byte-identical across pre-migration and post-migration dumps is what proves the DB was migrated rather than recreated.** A recreated DB would carry fresh timestamps and would still "have all the tables". Quote all five timestamps in the summary.

### 9.2 Blob opacity — test the test

The check is "the stored blob does not contain the plaintext key". The trap: DPAPI output is binary, so a naive `buffer.toString('utf8').includes(key)` can return false for reasons unrelated to encryption — lossy replacement characters alone can break a substring match. Do it properly:

- render the blob as **hex** and assert the hex encoding of the key is not a substring;
- render it as **latin1** (byte-preserving) and assert the key is not a substring;
- and **prove the check works** by running the same assertions against a deliberately unencrypted control buffer (`Buffer.from(key)`) and confirming both assertions **fail** on it.

A verification that cannot fail is not evidence. Report the control result alongside the real one.

### 9.3 The no-leak sweep

Drive every new channel over CDP and dump full responses. Then, mechanically:

- assert no response contains the planted key or any ≥ 8-character substring of it;
- assert no response contains a 64-character hex run (that is what a leaked fingerprint looks like);
- run the same two assertions over the **boot log** and over `_verify/` artifacts;
- finish with `npm run grep:secrets`.

### 9.4 What the planted key should look like

Use a value with realistic **shape** so the pattern machinery is genuinely exercised, and obviously fake so nobody mistakes it for real — for example an `sk-ant-api03-` prefix followed by a long run of a repeated recognisable filler. Two constraints: it must be long enough to match the `anthropic` pattern in `secret-patterns.json`, and it must **not** be committed anywhere. Generate it in the verification session, use it, and let it die with the session.

---

## 10. What "done" feels like

Reading `vault.ts` top to bottom, a reviewer can answer three questions without running anything: *where does plaintext enter?* (one parameter, on two methods) *where does it leave?* (one return, to one future caller) *what happens when DPAPI says no?* (a refusal with a label and nothing else). If any of those answers requires following a value through more than one hop, the module is too clever — simplify it before committing.
