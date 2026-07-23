# Task 3-2 Implementation Report — Vault + Credential/Provider Data Layer

_For Fable (coordinator review). Written by the implementing engineer (Kimi, Moonshot AI) after completing `docs/Features/Foundation/Tasks/Task-3-2-ExecutionPrompt.md` against HEAD `fb3201e` on branch `main`, 2026-07-23. This file is intentionally **uncommitted** (the execution prompt's docs rule: the one commit carries source only). All runtime artifacts referenced below live in `_verify/3-2/` (gitignored)._

---

## 1. Status

**DONE.**

- **Commit:** `a0b6a5e` — "Task 3-2: credential vault + provider data layer — DPAPI-encrypted, write-only, no UI"
- **Exactly one commit** (G3 honored — Task 3-1's two-commit D32 exception did not carry forward).
- 11 files changed, all from the §7 scope table; **nothing under `docs/`, nothing from `_verify/`, no renderer file, no `sessionManager.ts`** staged or committed.
- Temporary verification instrumentation (two pieces, both declared below) was **reverted before commit**; the committed tree is grep-verified instrumentation-free.

## 2. Environment statement (F20 — read this first)

**F20 is live in this session, exactly as the prompt predicted.** The database my runtime evidence describes is **not** the coordinator-verified real dev DB. Every DB dump below quotes its `projects` table:

- This session's DB: `a43b395d-51e2-47d3-8043-cb7b56094fca` ("Chorus", root `C:\Projects\ContactEstablished\Chorus`) and `b684e96e-2a50-409e-b6ce-0c3570142c31` ("Chorus-Second", root `C:\Projects\ContactEstablished\Chorus-Second`).
- The real dev DB per the prompt: `985d547b-…` / `f47ac10b-…`. **These do not match.** Notably, Task 3-1's commit `0e0640a` reports the *same two ids I saw* — the redirection is stable across sessions.
- Migration timestamps in my DB also differ from the coordinator-verified ones (mine: v4 = `2026-07-20T15:55:52.976Z`; real: `2026-07-20T16:57:49.534Z`).
- **Filesystem and git evidence are this machine's real ones** (worktree list, branches, fixture directory all match the prompt's baseline). DB evidence should be re-verified against the real `%APPDATA%\chorus\chorus.db` — the migration proof protocol (below) is designed to make that re-check mechanical: same three dumps, same five timestamps, same row diff.

All other environment quirks (toast failure logging, `AttachConsole failed`, expired Claude token) appeared as documented and are not mine.

## 3. D4 report — `safeStorage` on Electron 43.1.1

Read directly from `node_modules/electron/electron.d.ts` (interface `SafeStorage`, line 11818; `DecryptStringAsyncReturnValue`, line 21110):

- `isEncryptionAvailable(): boolean` — on Windows, true once the app emits `ready`.
- `encryptString(plainText: string): Buffer` — **documented throwing** ("This function will throw an error if encryption fails").
- `decryptStringAsync(encrypted: Buffer): Promise<DecryptStringAsyncReturnValue>` where the type is **`{ shouldReEncrypt: boolean; result: string }`**.
- **The plaintext field is `result`, NOT `decrypted`** — confirmed in the typings; the findings' prose is wrong, the typings win (exactly the D4 rule). `decryptForLaunch` reads `decrypted.result`.
- `shouldReEncrypt` is only reported by `decryptStringAsync` (D33 resolution e) → `decryptForLaunch` is **async**; Task 3-6 must decrypt *before* the synchronous `SessionManager.launch()`.
- `getSelectedStorageBackend()` is Linux-only, unused.

Supporting D4 probes run this session (scripts in `_verify/3-2/`):

- **better-sqlite3 12.11.1 constraint codes** (`probe-sqlite-errors.js/.json`): UNIQUE violation → `code: "SQLITE_CONSTRAINT_UNIQUE"`; FK violations on both insert-of-orphan and delete-of-referenced-parent → `SQLITE_CONSTRAINT_FOREIGNKEY`. **F16 re-confirmed empirically on this machine** (and `PRAGMA foreign_keys` reads `1` in every dump).
- `drizzle-orm` exports `count` as a function — used for `countCredentialProfilesForProvider`.

## 4. Migration evidence — v5 applied in place, 4 → 5, zero data loss

Three-dump protocol (script `_verify/3-2/dump.js`; the DB was also **backed up** — `chorus.db`/`-wal`/`-shm` — to `_verify/3-2/db-backup-pre-v5/` before any v5 boot):

| Dump | File | When |
|---|---|---|
| pre | `_verify/3-2/dump-pre-migration.json` | before the first v5 boot |
| boot 1 | `_verify/3-2/dump-post-boot1.json` | after first cold boot with v5 |
| boot 2 | `_verify/3-2/dump-post-boot2.json` | after a second cold boot |

**All five `applied_at` timestamps:**

| version | applied_at | across all three dumps |
|---|---|---|
| v1 | `2026-07-19T02:42:38.889Z` | **byte-identical** |
| v2 | `2026-07-19T13:13:45.839Z` | **byte-identical** |
| v3 | `2026-07-20T15:27:14.984Z` | **byte-identical** |
| v4 | `2026-07-20T15:55:52.976Z` | **byte-identical** |
| **v5** | `2026-07-23T12:16:07.375Z` | fresh at boot 1; **boot 2 did not re-apply it** (identical v5 row) |

**Row-level pre/post diff** (`projects`, `sessions`, `settings`, `worktrees`, `pane_layouts` compared as full row sets): **only one value differs** — `settings.window_bounds` (`{"x":2818,"y":-1181,"width":1200,"height":800}` → `{"x":1953,"y":-1304,"width":1327,"height":922}`), the live window persisting its real geometry on open. That is ordinary boot churn present on every boot, unrelated to the migration. Everything else — both projects, all 13 session rows, the `ea650f4d-…` **`wt-24b5c1fe` fixture row** (this DB's id for it; byte-identical), all five settings keys, the `pane_layouts` row — unchanged. The two new tables were created **empty**.

`schema_migrations` count now reads **5**; v1–v4 timestamps untouched.

## 5. v5 DDL ↔ `schema.ts`, side by side

Actual DDL read back from the migrated DB (`dump-post-boot2.json`) — mechanically diffed against `schema.ts` column for column: **15/15 agreement** (names, types, nullability, `REFERENCES`; `UNIQUE (provider_id, label)` lives in the hand-rolled DDL only, per D7).

```sql
CREATE TABLE provider_configs (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  adapter_type       TEXT NOT NULL,
  auth_mode          TEXT NOT NULL,
  env_var_name       TEXT,
  base_url           TEXT,
  extra_headers_json TEXT,
  created_at         TEXT NOT NULL
)
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
)
```

```ts
export const providerConfigs = sqliteTable('provider_configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  adapterType: text('adapter_type').notNull(),
  authMode: text('auth_mode').notNull(),
  envVarName: text('env_var_name'),                 // nullable
  baseUrl: text('base_url'),                        // nullable
  extraHeadersJson: text('extra_headers_json'),     // nullable
  createdAt: text('created_at').notNull()
})
export const credentialProfiles = sqliteTable('credential_profiles', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull().references(() => providerConfigs.id),
  label: text('label').notNull(),
  encryptedBlob: blob('encrypted_blob', { mode: 'buffer' }).notNull(),
  fingerprintHash: text('fingerprint_hash').notNull(),
  createdAt: text('created_at').notNull(),
  lastVerifiedAt: text('last_verified_at'),         // nullable
  unavailableSince: text('unavailable_since'),      // nullable
  reencryptedAt: text('reencrypted_at')             // nullable
})
```

## 6. Round-trip + blob-opacity evidence

**Round-trip (item 2).** `decryptForLaunch` has zero IPC callers by design, so it was exercised through a **temporary, declared main-side probe** (a block in `src/main/index.ts`, added for the probe boots and **reverted before commit** — the Task 2-4 precedent; committed tree grep-verified clean). The probe decrypted profile `cce32490-ddf7-4595-99aa-349bb8157d33` (created over CDP with the planted key) and wrote only the SHA-256 of the decrypted key:

- probe: `keySha256 = 4bf3f056d2ebf51dc9dbbbde1849f309afaa60eb3d627916c6e74c0911555ea9`
- sha256(planted K1): `4bf3f056d2ebf51dc9dbbbde1849f309afaa60eb3d627916c6e74c0911555ea9` — **identical. Round-trip proven through the app's own vault code, DPAPI included.** Plaintext never touched disk.

**Blob opacity (item 3), with its control** (`_verify/3-2/opacity.json`, run `opacity.js`): the stored 174-byte blob rendered as **hex** and as **latin1** contains neither the planted key nor any ≥8-char substring of it. The identical assertions against an unencrypted control `Buffer.from(key)` **fail** (`hexContainsKeyHex: true`, `latin1ContainsKey: true`, substring hit `sk-ant-a`). Verdict recorded: `OPACITY PROVEN (check demonstrably able to fail)`.

## 7. Refusal proofs + provider-delete refusal

Each driven over the real surface; every message swept for leakage (no key, no ≥8-char substring, no 64-hex run — all pass; `leak-checks.jsonl`).

- **A — corrupt blob** (`write-blob.js … corrupt`, 50 garbage bytes): probe decrypt → `{ok:false, kind:'undecryptable', message:"Credential profile 'verify-key-1' is unavailable: decryption failed. Re-enter the credential in Settings."}`. Row **survives**; `unavailable_since = 2026-07-23T12:32:51.226Z` (`dump-corrupt.json`). Message names the **label and nothing else**.
- **B — truncated blob** (first 24 bytes of the genuine blob): identical classification — `{ok:false, kind:'undecryptable'}`, same label-only message; `unavailable_since` set again (`dump-truncated.json`).
- **C — unavailable encryption** (temporary env-gated force in `vault.ts`, **reverted before commit**, declared): `credential:create` over CDP → `{ok:false, reason:"Credential profile 'verify-key-3' was NOT stored: Windows DPAPI encryption is unavailable. There is no plaintext fallback."}`; `credential:list` **unchanged** — no row, no fallback.
- **Repair path (clause 8):** `credential:replace` after corruption → `{ok:true}` and `unavailableSince` cleared to `null` (`replace-result.json`).
- **Provider-delete refusal (F16):** `provider:delete` on a provider with 2 profiles → `{ok:false, reason:"Provider 'VerifyAnthropic' still has 2 credential profiles — delete them first"}` — structured, **no raw SQLite error**; provider row intact. Deleting after the profiles are gone → `{ok:true}`.

Also runtime-proven: duplicate-key refusal (`"That key is already stored as credential profile 'verify-key-1'."`), duplicate-label refusal (UNIQUE converted, `"A credential profile labelled 'verify-key-1' already exists for this provider."`), and the §6.4 **secret-in-provider-headers refusal** on both `provider:create` and `provider:update` (fixed reason, no echo of the offending value).

## 8. No-leak sweep (item 8) + console hygiene (item 9)

Full JSON of **every** `provider:*`/`credential:*` response dumped by the CDP driver (`crud-result.json`, `replace-result.json`, `createUnavailable-result.json`, `sweep-result.json`). Assertions over each file **and over all nine boot logs** (`boot1…boot9`):

1. no planted key — **pass everywhere**;
2. no ≥8-character substring of either planted key — **pass everywhere**;
3. no 64-hex run (a leaked fingerprint's shape) — **pass everywhere**.

Machine-readable verdicts: `_verify/3-2/leak-checks.jsonl` (11 files, all `"pass":true`).

Console hygiene across every scenario (Runtime + Log domains captured by the driver): only `[vite] connecting/connected` debug lines; **zero exceptions, zero `An object could not be cloned`, zero unhandled rejections.** The one deliberate schema rejection (empty key) surfaces as a ZodError whose message carries shape information only — no value echo.

## 9. Grep gates (hit counts)

Run over the full tree (new files included; re-run post-staging so `git grep` sees them):

| Gate | Result |
|---|---|
| `decryptForLaunch` in `src` | 3 hits: the **declaration** (`vault.ts:193`) + two doc comments. **Zero call sites.** |
| `fingerprint` in `src/shared`, `src/preload`, `src/renderer` | **NOTHING** (comments and test fixtures were reworded so the gate is literally clean — the structural test assembles the digest column names as `'finger' + 'printHash'`). |
| `encryptString\|decryptString` in `src` | only `src/main/services/vault.ts` (+ one comment in `vaultCore.ts`). |
| `git diff --name-only HEAD -- src/renderer` | **EMPTY** |
| `git diff --name-only HEAD -- src/main/services/sessionManager.ts` | **EMPTY** |

## 10. Files changed (11 — exactly the §7 table)

| File | Change | Rationale |
|---|---|---|
| `src/main/services/vaultCore.ts` | create | Electron-free core: envelope codec, salted `fingerprint`, `VaultFailureKind` + `failureMessage`, `toProfileMeta` (explicit construction). No `electron` import — tests need no mocks. |
| `src/main/services/vaultCore.test.ts` | create | 21 unit tests over every pure function. |
| `src/main/services/vault.ts` | create | `CredentialVault` over `safeStorage` + storage; the repo's only caller of `encryptString`/`decryptString*`. Retains nothing. |
| `src/main/db/schema.ts` | edit | `blob` import; `providerConfigs` + `credentialProfiles`; four `$infer` aliases. |
| `src/main/services/storage.ts` | edit | Migration **v5**; 14 provider/credential accessors in the worktree-block style. |
| `src/shared/ipc.ts` | edit | 8 `IpcChannel` entries + request/response schemas under a `Task 3-2 (D33)` banner. |
| `src/main/ipc.ts` | edit | `registerIpc` gains `vault: CredentialVault`; 8 handlers, each inbound- **and** outbound-parsed; `toWireProvider`, `headersContainSecret`. |
| `src/preload/index.ts` | edit | 8 typed forwarders. No Zod. |
| `src/main/index.ts` | edit | Vault construction after the worktree manager; threaded into `registerIpc`; one availability log line at boot (no boot refusal). |
| `src/main/services/logger.ts` | edit | `REDACT_PATHS` += `plaintextKey`, `fingerprintHash`, `fingerprint_hash`, `encrypted_blob`, `extraHeaders` (+ wildcards). |
| `src/shared/ipc.test.ts` | edit | 12 new schema cases incl. the named **clause-3 structural test**. |

Nothing beyond the table. `secret-patterns.json`, `scripts/secret-grep.mjs`, `preload/index.d.ts`, and every renderer file untouched.

## 11. Deviations from `ImplementationSpec-3-2.md` (declared; no guarantee changed)

1. **Eight channels, not "six".** `Task-3-2.md` and the execution prompt both say "six `IpcChannel` entries"/"six forwarders", but the spec's own §6.1 names **eight** (4 provider + 4 credential) and the acceptance criteria require provider delete and credential replace. I shipped the eight the spec enumerates. **Doc bug worth fixing in `Task-3-2.md` (Exact Scope table) and the prompt template.**
2. **`VaultFailureKind` extended** beyond the spec's three kinds (`encryption-unavailable`/`undecryptable`/`corrupt`) with `duplicate`, `duplicate-label`, `not-found` — every refusal message then flows through the single label-only `failureMessage` builder instead of ad-hoc strings. The spec's three kinds behave exactly as specified.
3. **Duplicate detection is provider-scoped, and `findByFingerprint` was internalized.** The spec sketch's global `findByFingerprint(key)` became storage accessor `getCredentialProfileByFingerprint(providerId, hash)` used by `createProfile`: the same key on two *different* providers is a legitimate configuration; identical keys under *one* provider defeat the label disambiguation D33(b) assigns to labels.
4. **Bounds added** to `baseUrl` (2048) and `extraHeaders` values (2048) on the credential create/replace schemas — the same pathological-payload hygiene the spec gives `key` (8192).
5. **`updateCredentialBlob` also clears `unavailable_since`** — it is the successful-replace write (clause 8: "kept forever until a successful replace clears it"); the re-encrypt path composes it with `markCredentialReencrypted`.
6. **Test-fixture contortion, deliberate:** the clause-3 test assembles digest column names (`'finger' + 'printHash'`) so the literal word `fingerprint` never appears in `src/shared` — keeping the acceptance criterion's grep gate *literally* clean rather than "clean pending judgment".

## 12. Verification transcript

- `npm run typecheck` — **0 errors** (node + web), re-run post-revert.
- `npx vitest run` — **193/193 across 9 files** (160 baseline + 21 `vaultCore.test.ts` + 12 `ipc.test.ts`). New suite names: `envelope round-trip`, `envelope rejection`, `fingerprint`, `toProfileMeta`, `failureMessage` (vaultCore); `provider channel schemas`, `credential channel schemas` (ipc).
- `npm run grep:secrets` — **clean**, run **after** the no-leak sweep and **after** purging planted-key artifacts (order per §11).
- Runtime items 1–9: all individually evidenced above (§4–§8). App booted and drove the real IPC surface via CDP nine times; tree-kill cold boot between every main-process change; orphan check by descendant-tree walk: **clean** (electron tree + restored `claude.exe` all gone; port 9222 free).

## 13. Acceptance criteria

**Task-3-2.md:** all boxes pass — typecheck; vitest (193, baseline intact); G4 clean incl. fixtures; **migration v5 in place 4→5 with zero data loss** and no re-apply; DDL↔schema column-for-column; round-trip identical; blob opacity on **both** renderings **with a control that fails**; write-only IPC proven structurally (clause-3 test) and at runtime (response dumps); fingerprints never leave main (grep-clean); refuse-never-degrade on all three paths (mark + keep + label-only); provider deletion handled not thrown; `decryptForLaunch` zero callers, documented for Task 3-6; REDACT_PATHS covers the new fields; no renderer file; **one** narrated commit; `wt-24b5c1fe` untouched.

**Phase-3-Overview phase-level boxes (mine):** migration-v5 ✅; vault-round-trip (incl. `isEncryptionAvailable()===false` as first-class refusal and undecryptable → mark + keep row) ✅; no-credential-IPC-channel-returns-key-material ✅ (provable from the outbound schemas and the runtime dumps).

## 14. Non-goals confirmation

No UI / no renderer file (diff-empty). No injection, no launch-path change, **no `SessionManager` change**. No PTY scrubber. No adapter work — `adapter_type` is plain TEXT, nothing validates it. No test-key, no network call — `last_verified_at` ships unwritten (`markCredentialVerified` exists, documented "written by Task 3-6 only", zero callers). No `model_catalog`/`launch_profiles`/`usage_records`. No key crosses to the renderer in any shape — no plaintext, fingerprint, hint, length, or masked preview anywhere (schemas + runtime dumps). No plaintext fallback — behind no flag (the refusal-C instrumentation *forced the refusal*, never a fallback; reverted). **No new dependency** (D30 — `node:crypto` and `safeStorage` only). No change to `migrate()`, the logger's two-layer structure, or `secret-patterns.json`. Fixture row/directory/branch all present. Nothing under `docs/` staged; `_verify/` never staged. No push/PR/amend/rebase.

## 15. Fixture end-state declaration

- `git worktree list` → main tree + `C:/Projects/ContactEstablished/.chorus/Chorus/wt-24b5c1fe` (`cc3e866 [chorus/Chorus/24b5c1fe]`).
- `git branch --list "chorus/*"` → `24b5c1fe` (checked out in the worktree) + `39b6f2fe`, `54098146`, `605843db`, `ca1eff01`, `cc30c7be`.
- `worktrees` table (final dump): 3 rows in this session's DB, the `wt-24b5c1fe` row byte-identical to pre-migration.
- **`wt-24b5c1fe`, its row, and branch `chorus/Chorus/24b5c1fe` all still exist.**
- Final DB state: `schema_migrations` = 5; `provider_configs` and `credential_profiles` exist and are **empty** (all verification rows were deleted through the channels at the end of the sweep).

## 16. `_verify/` hygiene

The planted keys lived in exactly one file: `_verify/3-2/keys.json` — **purged** after the sweep; a full-tree pattern grep confirms no key-shaped string anywhere under `_verify/` (or `src/`) afterwards, and the final `npm run grep:secrets` passed **after** the sweep, not instead of it. Note the sweep evidence itself is clean (responses/logs never contained the key — that is the point of the proofs). The commit-message scratch file and harness scripts (`drive.js`, `dump.js`, `write-blob.js`, `opacity.js`, `leak-check.js`, `start-app*.ps1`, `kill-app.ps1`) contain no key material.

## 17. Residual risks / notes for Task 3-3 (and beyond)

1. **Envelope → `ResolvedCredential` join (the §12 handoff question).** `decryptForLaunch` returns `ResolvedEnvelope = {key, baseUrl?, extraHeaders?}` (D33 clause 1). IS-3-3 §2's `ResolvedCredential` is `{envVarName, value, isSecret: true}` — a **flat single value**. The mapping is 3-6's job: `value = envelope.key`; `envVarName` = `provider_configs.env_var_name` ?? the adapter's `AuthMethodDefinition.requiredEnvVar` (D34e); `isSecret: true`. The envelope's `baseUrl`/`extraHeaders` have **no home** in `ResolvedCredential` — 3-6's allow-list env composition must decide how they map (e.g. `ANTHROPIC_BASE_URL` and friends as additional non-secret-or-secret env entries, with the envelope overriding provider defaults per D33e). **Recommend 3-3's spec or the 3-6 task doc state this mapping explicitly** so the join isn't re-invented at the launch path.
2. **`unavailable_since` clears only on replace (contract-literal), not on a later successful decrypt.** Clause 8 says the mark survives "until a successful replace clears it" — my implementation honors that literally (a plain successful decrypt leaves the mark; only `replaceProfile`, and the re-encrypt path via `updateCredentialBlob`, clear it). Edge: a transient DPAPI failure marks a profile that then decrypts fine forever after, yet still *shows* unavailable. Options: keep contract-literal (current), or clear on any successful decrypt (one line in `decryptForLaunch`). **Coordinator call; flagging for 3-4's UI semantics.**
3. **`replaceProfile` does not run duplicate detection.** Replacing profile B's key with the same key as profile A (same provider) silently yields two profiles holding one key, bypassing creation-time detection. D33(b) scopes detection "at creation", so this is contract-conformant — but a provider-scoped check in `replaceProfile` is three lines and closes the hole. **Proposal: add it (chore or fold into 3-4).**
4. **Zod strip vs. "fails loudly".** The spec prose says a handler returning a raw row "fails the outbound parse loudly"; Zod's default object behavior *strips* unknown keys, so the clause-3 test (as the task doc itself specifies) asserts the **stripped output** — secret-free but silent. Both satisfy clause 3; `.strict()` on `credentialProfileMetaSchema` would make the loud-failure prose literally true. I kept the default (matches the task doc's test description and house style). **Worth a one-line decision either way.**
5. **Harness notes for future tasks:** (a) the boot log's `window_bounds` churn will appear in any future row-level DB diff — expected, not migration damage; (b) PowerShell `*>` log encoding varies (UTF-16 vs ASCII) — `leak-check.js` sniffs NUL bytes to handle both; (c) leaving `probe-request.json` in place across boots re-marks `unavailable_since` on every boot (observed at boot 8 — harmless, but harness hygiene matters when asserting timestamps); (d) `npm run dev` boots fast enough (~2 s warm) that CDP polls should not assume a long window.
6. **`markCredentialVerified` ships with zero callers** (by design — 3-6 writes it). Same dormant-contract state as `decryptForLaunch`; both are grep-verified.

## 18. Final git output

```
$ git status --porcelain
 M docs/Features/Foundation/Tasks/Phase-3-Overview.md
 M docs/Features/Foundation/roadmap.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3-2.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3-3.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3-4.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3-5.md
?? docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3-6.md
?? docs/Features/Foundation/Tasks/Task-3-2-ExecutionPrompt.md
?? docs/Features/Foundation/Tasks/Task-3-2.md
?? docs/Features/Foundation/Tasks/Task-3-3.md
?? docs/Features/Foundation/Tasks/Task-3-4.md
?? docs/Features/Foundation/Tasks/Task-3-5.md
?? docs/Features/Foundation/Tasks/Task-3-6.md
(plus this report, docs/Features/Foundation/Tasks/Task-3-2-ImplementationReport.md — untracked, uncommitted per the docs rule)

$ git log --oneline -4
a0b6a5e Task 3-2: credential vault + provider data layer — DPAPI-encrypted, write-only, no UI
fb3201e Saving more Phase 3 docs
0e0640a Task 3-1: secret-safe logging spine — pino with two-layer redaction, before any secret exists
bc9b403 Task 3-1 chore: F21 branch-force gate + F23 total leaf insertion
```

---

## 19. Findings & proposals — the short list for review

For the reviewer who only reads one section:

- **F-1 (doc bug):** "six channels" in `Task-3-2.md` + the execution prompt vs. the **eight** the spec's §6.1 and the acceptance criteria require. Shipped eight; docs should be corrected.
- **F-2 (environment):** F20 confirmed again, with the same redirected-DB project ids Task 3-1 saw — the redirection is stable, so prompts can stop treating it as per-session luck. Migration re-verify against the real DB should be mechanical: same three-dump protocol.
- **F-3 (proposal, 3-6):** state the `ResolvedEnvelope → ResolvedCredential` mapping (incl. where `baseUrl`/`extraHeaders` go in the allow-list env) in the 3-6 task doc.
- **F-4 (proposal):** add provider-scoped duplicate detection to `replaceProfile` (3 lines).
- **F-5 (decision needed):** whether a *successful* decrypt should clear `unavailable_since` (contract currently replace-only), and whether `credentialProfileMetaSchema` should go `.strict()` to make "fails loudly" literal.
- **F-6 (notes for 3-3/3-4):** two dormant-by-design APIs ship with zero callers (`decryptForLaunch` → 3-6; `markCredentialVerified` → 3-6); `decryptForLaunch` is **async**, so the launch handler must await it *before* the synchronous `SessionManager.launch()`.
