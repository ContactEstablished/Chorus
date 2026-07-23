# Task 3-2 — Vault + Credential/Provider Data Layer

_Second task of Phase 3 (Foundation). Windows-only. **One commit** (G3). This task governs scope; `ImplementationSpec-3-2.md` governs exact contents. Implements the **D33** vault contract — where this doc and D33 disagree, D33 wins and the disagreement is a bug in this doc worth raising._

## Source Of Truth

- `docs/Features/Foundation/Tasks/Phase-3-Overview.md` — the phase contract, cross-cutting rules, gates, and the file-ownership matrix.
- Roadmap §6 **D33** (the vault security contract, council + coordinator resolutions (a)–(e)) and `CouncilBriefs/CouncilBrief-3.0-Vault-Findings.md` (the filed findings — clauses 1–9, action items 1–11, risks 1–7). **D33's resolutions patch the findings; read both, obey D33.**
- Roadmap §5: **F16** (FKs are ENFORCED), **F20** (verification-provenance), **F22** (`Chorus-Second`'s real root path).
- `docs/PLAN.md` §6 (Credentials, Providers, BYOK), §13 (target data model).
- `CLAUDE.md` — D1 Zod-in-main; D14 plain payloads; secrets via safeStorage, never in args/logs/transcripts.
- Precedent: **Task 2-1** is the shape of this task — a data layer plus a service plus IPC, with **no UI at all**. Its migration v4 is the bar for "applies in place with zero data loss".

## Initial Starting Point

**Verified 2026-07-22 against commit `fb3201e`** (Task 3-1 landed, working tree clean).

- **Baseline:** `npm run typecheck` exits 0. `npx vitest run` = **160/160 across 8 files**. `npm run grep:secrets` clean.
- **Migrations: exactly 4 applied**, coordinator-verified against the real `%APPDATA%\chorus\chorus.db` this session — v1 `2026-07-19T01:23:38.589Z`, v2 `2026-07-19T15:03:43.749Z`, v3 `2026-07-19T23:47:12.930Z`, v4 `2026-07-20T16:57:49.534Z`. Tables: `pane_layouts`, `projects`, `schema_migrations`, `sessions`, `settings`, `worktrees`. **v5 is next.**
- `MIGRATIONS: string[]` lives in `src/main/services/storage.ts` above the `StorageService` class; `migrate()` (a private method at the bottom of the class) reads `MAX(version)` from `schema_migrations` and applies each remaining entry inside `this.db.transaction(...)`. A migration entry may contain **multiple statements** — v4 does exactly that (`CREATE TABLE worktrees …; ALTER TABLE sessions …`), and they apply atomically.
- **`PRAGMA foreign_keys` reads `1`** on this machine — re-verified this session. New `REFERENCES` clauses are real constraints with default RESTRICT.
- **Drizzle table definitions** live in `src/main/db/schema.ts` and must mirror the hand-rolled DDL exactly (column names, types, nullability). The file currently defines `projects`, `paneLayouts`, `settings`, `schemaMigrations`, `sessions`, `worktrees`, and exports `$inferSelect`/`$inferInsert` type aliases per table.
- **safeStorage on Electron 43.1.1 — D4-verified against `node_modules/electron/electron.d.ts` this session:** `isEncryptionAvailable(): boolean`, `isAsyncEncryptionAvailable(): Promise<boolean>`, `encryptString(plainText: string): Buffer`, `decryptString(encrypted: Buffer): string`, `encryptStringAsync`, `decryptStringAsync(encrypted: Buffer): Promise<{ shouldReEncrypt: boolean; result: string }>`. **The plaintext field is `result`, not `decrypted`** — the D33 findings' prose implies otherwise; the typings are authoritative.
- **The logger is already safe.** `src/main/services/logger.ts` exports `logger`, `scrubSecrets`, `SCRUB_PLACEHOLDER`, and `REDACT_PATHS`. This task **adds** the new credential field names to `REDACT_PATHS`.
- **No main-process test may import `electron`.** The house pattern (`restore.ts` ↔ `sessionManager.ts`, `computeWorktreeReconcile` ↔ `GitWorktreeManager`) is to factor the pure core into an Electron-free module and unit-test that. This task follows it: `vaultCore.ts` is pure and tested; `vault.ts` touches `safeStorage` and is proven at runtime instead.
- **Boot sequence** (`src/main/index.ts`, inside `app.whenReady()`): `new StorageService(...)` → `sessions.bindStorage(storage)` → `new GitWorktreeManager(storage)` → resolve active project → `registerIpc(sessions, storage, worktrees)` → `watchSessionExits` → exit listener → `await worktrees.reconcileAll()` → `void sessions.restore(...)` → `createWindow()` → `detectClis()`. The vault is constructed alongside the worktree manager and threaded into `registerIpc`.

## Goal

Build the credential vault and its data layer — the first place a real secret will ever live in Chorus — with **no UI and no injection**. The task is complete when a plaintext key can be handed to main once, encrypted with DPAPI, stored as an opaque blob, and decrypted back inside main only; and when there is **no path at all** by which the renderer can read one back.

The security properties are the deliverable, not the CRUD. Three of them are structural rather than behavioural, and each has to be provable by reading the code, not by trusting a test:

1. **Write-only inbound IPC.** No `credential:*` response type contains key material or a fingerprint. This is enforced by the *outbound schemas*, so a future handler that forgets cannot silently leak — it fails the outbound parse.
2. **Fingerprints never leave main** (D33 resolution b). Their job is duplicate detection at creation and rotation detection — not UI disambiguation, which the mandatory label handles.
3. **Refuse, never degrade** (D33 clause 8). Encryption unavailable, blob corrupt, blob undecryptable — each is an explicit refusal that keeps the row, names the profile by **label only**, and never carries blob bytes, partial key material, or a derived secret in its message.

## Exact Scope

| File | Change |
|---|---|
| `src/main/services/vaultCore.ts` | **Create.** The Electron-free pure core: envelope encode/decode, `fingerprint(key)`, the `VaultFailure` classification, and the metadata projection that strips secrets. |
| `src/main/services/vaultCore.test.ts` | **Create.** Unit tests over every pure function (see Test Expectations). |
| `src/main/services/vault.ts` | **Create.** `CredentialVault` — the `safeStorage` + storage-accessor service. The only module in the repo that calls `encryptString`/`decryptString*`. |
| `src/main/db/schema.ts` | **Edit.** Add `providerConfigs` and `credentialProfiles` Drizzle tables + their `$infer` type aliases. Mirror v5's DDL exactly. |
| `src/main/services/storage.ts` | **Edit.** Append migration **v5** to `MIGRATIONS`; add the provider/credential accessors. |
| `src/shared/ipc.ts` | **Edit.** Eight new `IpcChannel` entries (4 `provider:*` + 4 `credential:*`) + their request/response schemas. All outbound shapes secret-free by construction. _(Corrected from "six" at the 3-2 completion review — the spec's §6.1 always enumerated eight; the count here was the error. Implementer finding F-1.)_ |
| `src/main/ipc.ts` | **Edit.** The eight handlers. `registerIpc` grows a `vault` parameter. |
| `src/preload/index.ts` | **Edit.** Eight typed forwarders. No Zod. |
| `src/main/index.ts` | **Edit.** Construct the vault after storage; thread it into `registerIpc`. |
| `src/main/services/logger.ts` | **Edit.** Add the new credential-bearing field names to `REDACT_PATHS`. |
| `src/shared/ipc.test.ts` | **Edit.** Schema cases for the new channels, including the negative cases that prove secret-freedom. |

Nothing else. **No renderer file is touched in this task** — if a change seems to require one, raise it.

## Non-Goals

- **No UI whatsoever.** No settings view, no dialog, no palette command, no renderer store. That is Task 3-4. This task ships channels a renderer will consume later, exactly as Task 2-1 did.
- **No injection, no launch-path change, no `SessionManager` change.** `decryptForLaunch` is written and unit-reachable but **has zero callers** this task — the same dormant-with-one-documented-legal-caller state `--force` sat in after Task 2-1. Do not wire it into `session:launch`.
- **No PTY scrubber.** Task 3-5 owns it. Do not touch `sessionManager.ts`.
- **No adapter work.** Task 3-3 owns `src/main/adapters/`. `provider_configs.adapter_type` is a plain TEXT column this task; nothing validates it against a registry yet.
- **No test-key / no network call of any kind.** Task 3-6 owns the probe. `last_verified_at` ships as a column that nothing writes yet.
- **No `model_catalog`, no `launch_profiles`, no `usage_records`** — Phase 3a.
- **No key ever crosses to the renderer, in any shape** — not plaintext, not a fingerprint, not a hint, not a length, not a masked preview. A masked preview (`sk-ant-…AB12`) is **explicitly forbidden**: it is key material, and D33 clause 3 admits no exception.
- **No plaintext fallback when encryption is unavailable.** Not behind a flag, not in dev, not "temporarily".
- **Do not revert, stage, or commit unrelated or untracked files, including `_verify/` and anything under `docs/`.**
- **Do not remove the standing `wt-24b5c1fe` worktree row, directory, or branch.**

## Dependencies

- **Task 3-1** (`0e0640a`) — the logger this task logs through, and the `grep:secrets` gate this task must pass.
- No new npm dependency. `crypto` (`node:crypto`) is a Node built-in; `safeStorage` ships with Electron.

## Step-by-step Work

1. **Migration v5 + Drizzle tables.** Append the v5 entry to `MIGRATIONS` and add the two matching Drizzle tables. Column-for-column agreement between the DDL string and `schema.ts` is checked by the review — v4 is the precedent for getting this exactly right.
2. **`vaultCore.ts`** — the pure core first, so it can be unit-tested before anything touches Electron. Envelope codec, salted fingerprint, failure classification, metadata projection.
3. **`vault.ts`** — `CredentialVault` over `safeStorage` + `StorageService`. Every method that can fail returns a discriminated result or throws a typed error; none of them ever put key material into a message.
4. **Storage accessors** for both tables, mirroring the existing worktree-accessor style (thin, typed, Drizzle, no business logic).
5. **IPC schemas** in `src/shared/ipc.ts`, then the **handlers** in `src/main/ipc.ts`, then the **preload forwarders**. Parse inbound in main; parse outbound in main too (the house discipline since 1-2) — the outbound parse is what makes secret-freedom structural.
6. **Boot wiring** in `src/main/index.ts`, and the `REDACT_PATHS` additions in `logger.ts`.
7. **Unit tests**, then `npm run typecheck`, `npx vitest run`, `npm run grep:secrets`.
8. **Runtime-verify (G2)** per Verification Commands — the migration on the real DB, the round-trip, the blob opacity, the refusal paths, and a dump of every `credential:*` response proving no key material crosses.

## Test Expectations

**Unit (Vitest), `src/main/services/vaultCore.test.ts`** — the module must not import `electron`, so these run in plain Node:

- **Envelope round-trip:** `decodeEnvelope(encodeEnvelope(e))` deep-equals `e` for a minimal envelope (`{key}`), a full one (`{key, baseUrl, extraHeaders}`), and one whose `extraHeaders` values contain characters needing JSON escaping.
- **Envelope rejection:** a decode of malformed JSON, of valid JSON that is not an object, and of an object with a missing or non-string `key` each yields the **corrupt** classification — never a throw with the raw input in the message, and never a partially-populated envelope.
- **Fingerprint:** deterministic for the same input; different for inputs differing by one character; **salted** — the digest of a key must not equal the unsalted `sha256(key)` (compute the unsalted digest in the test and assert inequality, which is what actually proves the salt is applied); and the output is 64 lowercase hex characters.
- **Fingerprint is not reversible-looking:** the digest of a realistic fake key contains no substring of that key of length ≥ 8. Guards against a "fingerprint" implementation that accidentally embeds a prefix.
- **Metadata projection:** `toProfileMeta(row)` over a row carrying `encryptedBlob` and `fingerprintHash` returns an object where `Object.keys(...)` contains **neither** — asserted by key enumeration, not by reading two properties, so a future added secret column fails the test.
- **Failure classification:** each of unavailable-encryption, undecryptable, and corrupt-envelope maps to its own `VaultFailure` variant, and every variant's user-facing message contains the profile **label** and contains **no** blob bytes and no key substring.

**Unit (Vitest), `src/shared/ipc.test.ts`:**

- Every new request schema accepts a valid payload and rejects the obvious invalid ones (bad uuid, empty label, empty key).
- **The secret-freedom cases, named as such:** `credentialProfileMetaSchema.parse(objectCarryingEncryptedBlobAndFingerprint)` produces an object whose keys include neither field. Assert on the parse **output**, because that output is what main sends — this is the test that makes clause 3 structural rather than aspirational.
- `providerConfigSchema` round-trips `base_url`/`extra_headers_json` (documented **non-secret** plaintext, D33 resolution e) while `credentialProfileMetaSchema` carries neither key nor fingerprint.

**No unit test may contain a real credential.** Fixtures use obviously-fake values of realistic **shape** (e.g. `sk-ant-api03-` followed by filler) so the shape logic is genuinely exercised — and `npm run grep:secrets` must still pass afterwards. If the gate trips on a fixture, the fixture is wrong, not the gate: shorten it below the pattern's length floor or use a shape the patterns do not claim.

**Runtime (G2)** covers the migration, the encryption round-trip, blob opacity, and the refusal paths — none of which a unit test can establish, because `safeStorage` requires a real Electron app with DPAPI.

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

**Migration proof (the Task 2-1 bar).** Dump the DB **before** the first boot with v5, then after, then after a second cold boot. The three dumps must show: v1–v4 `applied_at` values **byte-identical** across all three (proof of in-place migration, not recreation); v5 present after boot 1 with a fresh timestamp; boot 2 **not** re-applying it; and the pre/post row diff containing **only** the two new empty tables — every project, session, setting, layout, and the `9ba9b0da…` worktree row unchanged.

**⚠ The `sqlite3` CLI is NOT installed.** Inspect the DB with the `ELECTRON_RUN_AS_NODE` dump-script pattern — `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe <scratch>/dump.js <scratch>/out.json` — requiring better-sqlite3 by **absolute repo path**. Such scripts print nothing to a console, so **write results to a file**; **known flake: no file on first invocation, retry once**. See `_verify/2-1-dump.js`. **Quote the `projects` table in every dump** — F20 provenance: this session's `AppData` is redirected, so DB evidence describes a different database and will be re-verified by the coordinator.

**Blob-opacity proof.** After creating a profile with a planted fake key, dump `credential_profiles` with the blob rendered as **hex and as latin1**, and assert the plaintext key does not appear as a substring of either rendering. Checking only the hex rendering is not sufficient — DPAPI output is binary, and a naive "does the utf8 string contain the key" check on binary data can pass for the wrong reason.

**Refusal proofs.** Three, each driven over the real IPC surface via CDP:
1. **Corrupt blob** — hand-write garbage bytes into an existing profile's `encrypted_blob`, then attempt a decrypt-path operation; the row must survive, `unavailable_since` must be set, and the error must name the label and nothing else.
2. **Truncated blob** — same, with the first N bytes of a genuine blob; must classify identically.
3. **Unavailable encryption** — since `isEncryptionAvailable()` returns true on Windows once the app is ready, drive this by **temporarily** forcing the availability check false in `vault.ts`, proving the refusal, then reverting. Declare it as temporary instrumentation; the review checks the **commit diff**, not the worktree (the Task 2-4 precedent).

**No-leak proof.** With CDP attached, call every `credential:*` and `provider:*` channel and dump the **full** JSON of each response. No response may contain the planted key, any substring of it of length ≥ 8, or any 64-hex-character string. Do the same for the boot log.

**Harness reminders:** electron-vite does **not** hot-restart the main process — every vault/IPC/migration check needs a real tree-kill cold boot. Kill process **trees** (`taskkill /PID <root> /T /F`); a graceful-quit test is `taskkill /PID <electron-main-pid>` **without** `/F`. Orphan checks walk the electron main PID's descendant tree, never `tasklist` name-matching.

## Acceptance Criteria

- [ ] `npm run typecheck` — zero errors (G1).
- [ ] `npx vitest run` — green, with the **160**-test baseline intact and the new cases added.
- [ ] `npm run grep:secrets` — clean, including over the new test fixtures (G4, now mandatory).
- [ ] **Migration v5 applies in place, 4 → 5**, on the real dev DB: v1–v4 timestamps untouched, both tables created with the exact DDL, **zero data loss** (the pre/post diff contains only the two new tables), and a second cold boot does not re-apply it.
- [ ] `src/main/db/schema.ts` and the v5 DDL agree **column for column** — names, types, nullability, and `REFERENCES` clauses.
- [ ] **Round-trip:** a planted fake key encrypted through `safeStorage` persists as a blob and decrypts back **identical** in main.
- [ ] **Blob opacity:** the stored blob contains no plaintext substring of the input, proven against **both** a hex and a latin1 rendering.
- [ ] **Write-only IPC, proven twice** — structurally (no outbound schema admits a key or fingerprint field) and at runtime (a dump of every `credential:*`/`provider:*` response contains no key substring and no 64-hex digest).
- [ ] **Fingerprints never leave main** — grep-verifiable: `fingerprint` appears in `vault.ts`/`vaultCore.ts` and nowhere in `src/shared`, `src/preload`, or `src/renderer`.
- [ ] **Refuse-never-degrade:** unavailable encryption refuses creation; a corrupt blob and a truncated blob each mark `unavailable_since`, keep the row, and refuse with a **label-only** message. No path silently produces a keyless success.
- [ ] **Provider deletion is handled, not thrown:** deleting a provider that still has credential profiles returns a structured `{ok:false, reason}` rather than surfacing the raw SQLite FK error (F16).
- [ ] `decryptForLaunch` exists, is documented as having exactly one future legal caller (Task 3-6), and has **zero callers** in this commit — grep-verified.
- [ ] `REDACT_PATHS` covers every new credential-bearing field name introduced by this task.
- [ ] **No renderer file is touched.** No UI exists yet.
- [ ] **One** narrated commit (G3), touching only the Exact Scope files.
- [ ] The standing `wt-24b5c1fe` worktree row, directory, and branch are **untouched**.

## Review Checklist

- [ ] The v5 DDL and `schema.ts` were diffed against each other line by line, not skimmed — v4's precision is the bar.
- [ ] `credential_profiles.provider_id` has a real `REFERENCES provider_configs(id)` clause, and the provider-delete path proves the implementer understood F16 rather than discovering it in production.
- [ ] The **outbound** schemas are what enforce secret-freedom; a handler returning a raw DB row would fail the parse. Verify by reading the handler, not the schema alone — a handler that skips the outbound parse defeats the whole design.
- [ ] The fingerprint is genuinely salted, and the test proves it by comparing against the **unsalted** digest rather than merely asserting a hex shape.
- [ ] The salt is a fixed in-code constant, documented as extractable from the binary (D33 risk 4) — the fingerprint is for disambiguation, never authentication.
- [ ] `vaultCore.ts` does not import `electron`, and `vaultCore.test.ts` therefore runs without mocks. If a mock was needed, the split is in the wrong place.
- [ ] Every failure message was read for leakage: no blob bytes, no key substring, no byte length of the key, no exception text from `decryptString` passed through verbatim.
- [ ] `shouldReEncrypt` is only reachable via `decryptStringAsync` (D33 resolution e) and the re-encrypt path is throttled by `reencrypted_at` — no launch-time re-encrypt loop.
- [ ] Nothing in this task touches `sessionManager.ts`, `src/main/adapters/`, or any renderer file.
- [ ] The blob-opacity check was done against a **binary-safe** rendering, and the reviewer confirmed the check would actually fail if the blob were plaintext (test the test).
- [ ] No untracked / `_verify/` / `docs/` files staged or reverted.
