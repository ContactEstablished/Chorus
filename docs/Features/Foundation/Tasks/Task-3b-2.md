# Task 3b-2 — `council_members`, the Run Tables, and the Configuration UI

_Phase 3b, Task 2 of 4. **The phase's only migration.** No orchestration lands here._

## Source Of Truth

- `docs/Features/Foundation/Tasks/Phase-3b-Overview.md` — phase contract, gates, standing conditions.
- `docs/Features/Foundation/ImplementationSpecs/ImplementationSpec-3b-2.md` — **governs exact contents.**
- Roadmap §6: **D7** (hand-rolled MIGRATIONS, never drizzle-kit), **D14**, **D33** (clause 9), **D43** (id-not-label), **D48/D56** (the one-home rule and the model-precedence order), **D62** (the FK ruling and count-and-refuse), **D64** (the run-scoped mint).
- **F16** — FKs are ENFORCED. That is *why* the guards must count before SQLite throws.

## Initial Starting Point

Verified **2026-07-26 at `341ea5c`**, plus whatever Task 3b-1 landed.

- `MIGRATIONS.length` is **10**. Your migration is **v11** — confirm `MIGRATIONS.length + 1 === 11` before appending and **stop and report** any divergence.
- Twelve tables exist (eleven at v9 plus v10's `launch_profiles`). Confirm against the real DB rather than this sentence.
- `launch_profiles` (v10) is the shape precedent: `id` PK, `label` NOT NULL UNIQUE, real `REFERENCES` on `provider_id` and `credential_profile_id`, nullable `model`, `created_at` / `updated_at`.
- `provider_configs` carries `name`, `adapter_type`, `auth_mode`, `base_url`, `env_var_name`, `extra_headers_json`, `model`. **The route already exists — do not re-home any of it.**
- `credential_profiles` carries `provider_id`, so **a credential already knows its route.**
- `deleteProviderConfig` purges `model_catalog` rows in its own transaction (a cache must never break a user flow); `credential:delete` and `provider:delete` each already count-and-refuse against `launch_profiles` (D62). **You add counts to the existing guards; you do not add new guards.**
- Standing fixtures on the real DB: providers `OpenRouter` (api_key, `moonshotai/kimi-k3`), `Anthropic direct`, `OpenRouter admin` (**management**); credentials `OR milestone key`, `Claude fake key` (**carries `unavailable_since` — a free live fixture for the disabled-not-hidden case**), `OR Management Key`.

## Goal

Give a council somewhere to live: **who its members are, what a run was, and what was said.** Three tables in one migration, and a Settings surface to manage the first of them. **Nothing orchestrates anything in this task** — 3b-3 is the first writer of the other two.

## ⚠ Four rulings this task must make, and three of them are inherited rather than invented

**1. A member names a ROUTE by naming a CREDENTIAL — it does not store a base URL.** The roadmap's Phase 3b line says a member is *"credential profile + base URL + model id + role + params"*. **That phrasing predates D48 and D56.** `provider_configs.base_url` is the route's home; `credential_profiles.provider_id` already points at it. A `base_url` column on `council_members` would be a **second home for the route**, which is precisely what D48 exists to prevent and what D56 made normative.

**Therefore: `council_members` stores `credential_profile_id` and derives the route through it.** It stores **no `provider_id` either** — unlike `launch_profiles`, which needs both because D33 clause 9 makes a profile with a route and no credential first-class. **A council member always authenticates**, so the credential is never absent, and storing both columns would create a class of row where they disagree.

**2. `model` is NULLABLE and resolves through D56's order.** Rank 1 `council_members.model` > rank 2 the route's `provider_configs.model` > nothing emitted. **Never back-written.** A member with a NULL model inherits its route's default at run time, exactly as a launch profile does — copying rank 2 into rank 1 is how the second home gets created by accident.

**3. The FK ruling splits three ways, per D62.** A **member** is a live instruction — real `REFERENCES` on `credential_profile_id`, RESTRICT, **count-and-refuse authored in main before the statement runs**. A **run** and a **message** are historical facts — **soft pointers, no `REFERENCES`** — because a transcript stays true once its member is deleted, and a FK there would make deleting a member throw for every run it ever joined. Run deletion purges its own messages explicitly, the `deleteProviderConfig` → `model_catalog` precedent.

**4. The label is not the identity (D43).** `council_members.label` is UNIQUE and freely renameable; every pointer stores the **id**. A rename must have zero downstream consequences, and the drive proves it rather than asserting it.

## Exact Scope

- **EDIT** `src/main/services/storage.ts` — **migration v11** (spec §2's DDL, ONE atomic entry) and the accessors: member CRUD, `countCouncilMembersForCredential`, run/message accessors written but unused until 3b-3.
- **EDIT** `src/main/db/schema.ts` — three Drizzle tables + inferred types, matching v11 column for column.
- **EDIT** `src/main/ipc.ts` — `council-member:*` handlers (list / create / update / delete); **one added count** inside the existing `CredentialDelete` guard.
- **EDIT** `src/shared/ipc.ts` — the channels and schemas; `councilRoleSchema = z.enum(['member','arbiter'])`.
- **EDIT** `src/preload/index.ts` — Zod-free typed forwarders.
- **EDIT** `src/renderer/src/views/SettingsProviders.vue` (or a sibling settings surface) + `src/renderer/src/stores/settings.ts` — list / create / rename / delete.
- **EDIT** `src/shared/ipc.test.ts`.
- **CREATE (untracked)** `_verify/3b-2/dump-v11.js`, `_verify/3b-2/rehearse-v11.js`, drive scripts.

## Non-Goals

- **NO orchestration, no protocol, no `CouncilService`.** 3b-3.
- **NO api calls of any kind.** This task never spends a cent; its envelope is **$0.00** and any spend is a scope breach to report.
- **NO second migration**, no drizzle-kit (**D7**), no new dependency.
- **NO `base_url` column, and no `provider_id` column, on `council_members`** — see ruling 1.
- **NO back-writing a route default into a member row** (D56).
- **NO run/message writes.** Both tables are created empty for 3b-3, the `attention_spans` precedent.
- **NO "test this member" button.** It would be a live billable call, and D57 is the standing warning about tests that cannot fail. If wanted, it belongs where the transport lives.
- **NO enable/disable flag, no ordering column, no retention policy.** Membership of a run is a run-assembly decision (3b-3), not persisted state.
- **NO changes to `provider_configs` or `credential_profiles`** — no schema change, no `UPDATE`.
- **Do not touch** `TASK-3-5-REVIEW-FABLE.md` / `TASK-3-6-REVIEW-FABLE.md` or the `wt-24b5c1fe` worktree fixture.

## Dependencies

**Task 3b-1** committed.

## Step-by-step Work

1. **Read the shipped `MIGRATIONS` array and settle the number.** Expected `MIGRATIONS.length + 1 === 11`; quote `SELECT version FROM schema_migrations` as evidence.
2. **Migration v11 + Drizzle mirror**, one atomic entry. **Grep the entry: exactly ONE `REFERENCES`, on `council_members.credential_profile_id`; ZERO on any run or message column.** Getting this inverted produces two distinct bugs that both surface as `SQLITE_CONSTRAINT_FOREIGNKEY` in flows working since Task 3-2.
3. **⚠ REHEARSE ON A COPY before the first real boot** — `_verify/3b-2/rehearse-v11.js` against a copy of the real DB, **with `Local State` copied beside it (F31)**. Assert all three tables created empty, every pre-existing table untouched, and `length(encrypted_blob)` unchanged for all three credential rows.
4. **Storage accessors**, rows-in-rows-out.
5. **IPC + preload + store + the Settings surface.** All Zod in main (D1); plain objects across the bridge (D14); every handler outbound-`.parse`s.
6. **The added count in `CredentialDelete`** — beside 3a-5's `launch_profiles` count, not replacing it.
7. **Tests, then the gates, then the three-dump protocol and the drives.**

## Test Expectations

Unit coverage on the pure parts: role validation, the D56 model-resolution helper (member model > route default > null), the shape validator's refusals (empty label, duplicate label, unknown credential, **a credential on a `management` route**), and `countCouncilMembersForCredential`.

**The management-route refusal is the important one.** 3a-5 shipped the same defect and D62 records it: a profile could be saved against a route that cannot do inference, was rendered as launchable, and would have launched credential-less. **A council member on a management route must be refused at create AND at resolve**, mirroring `resolveCredential`'s own pre-decrypt refusal.

## Verification Commands

```powershell
npm run typecheck
```
```powershell
npx vitest run
```
```powershell
npm run grep:secrets
```

### Grep gates — quote the counts

- **exactly 1** `REFERENCES` in the v11 entry, on `council_members.credential_profile_id`; **zero** on run/message columns;
- **zero** `base_url` and **zero** `provider_id` in the `council_members` DDL;
- **zero** `UPDATE provider_configs` and **zero** `UPDATE credential_profiles` anywhere;
- `agentKindSchema` unchanged; `staticRegistry` unchanged; `src/main/adapters/` diff **empty**;
- `src/main/services/sessionManager.ts` and `apiSession.ts` **byte-identical**;
- `MIGRATIONS.length` **10 → 11**.

### The migration proof — the full three-dump protocol on the REAL DB

Rehearse on a copy first. Then pre / post / boot-2 dumps, asserting with quoted evidence: v10 → v11 applied **in place**, every prior `applied_at` **byte-identical**; every pre-existing table **row-identical** (with `dispatches` and `attention_spans` exempted as append-only live telemetry — assert **no existing row moved**, the exemption 3a-5 declared in advance); all three new tables **created empty**; `council_members`' `sqlite_master` DDL carrying **one** `REFERENCES` and `UNIQUE(label)`; v11 **not re-applied** on boot 2; the `wt-24b5c1fe` row intact; and the **`projects` pair quoted** (F20).

### The runtime drives (G2) — all free, none needs a completion

1. **Create three members and an arbiter** through the real Settings UI, on the standing OR route. Confirm rows land with the right role and a NULL model where none was given.
2. **The D56 inheritance proof** — a member with NULL `model` resolves to `moonshotai/kimi-k3` at read time while its **`model` column stays NULL in the database**. Shown, not asserted.
3. **The rename proof (D43)** — rename a member; confirm its id is unchanged and nothing referencing it moved.
4. **The referential-fragility proof (D62)** — with a member saved, attempt `credential:delete` on `OR milestone key` → **inline refusal naming the count**, no throw, **no `SQLITE_CONSTRAINT_FOREIGNKEY` in the log**. Delete the member, confirm the delete proceeds, **then re-create both** — the OR route and its key are standing fixtures.
5. **The disabled-not-hidden proof** — a member whose credential is unavailable (`Claude fake key` is a live fixture) renders **shown, disabled and explained**, naming the credential **by label only** — no URL, no env var, no fragment.
6. **The management refusal** — attempt to save a member against `OpenRouter admin`; confirm refusal by label with no row written.

## Acceptance Criteria

1. Migration v11 lands as one atomic entry, `MIGRATIONS.length` 10 → 11, evidenced by `SELECT version FROM schema_migrations`.
2. `council_members` carries **no `base_url` and no `provider_id`**, and the commit message explains why (rulings 1 and the D48/D56 lineage).
3. Exactly one `REFERENCES`, on the member's credential; runs and messages carry none.
4. The rehearsal output is quoted, from a copy-DB run **with `Local State`**, before any real boot.
5. The three-dump protocol passes with all exceptions **enumerated in advance**.
6. All six runtime drives pass, each quoted — especially 2 (NULL model column, resolved value), 4 (no `SQLITE_CONSTRAINT_FOREIGNKEY`) and 6 (management refusal).
7. Typecheck 0; vitest green above 3b-1's total; grep:secrets clean over `src/` and `_verify/3b-2/`.
8. **Cost $0.00**, confirmed — this task makes no API call.
9. Fixtures restored and the restoration dumped; `wt-24b5c1fe` intact.

## Review Checklist

1. **Is the route stored once?** Any `base_url` or `provider_id` on `council_members` is a D48/D56 violation, and it is the failure this task is most likely to make while looking reasonable.
2. **Are the FK rulings the right way round** — member RESTRICT, run and message soft? Inverted, both directions throw in flows that have worked for months.
3. **Was the credential-delete guard driven live**, and was it **isolated** so 3a-5's existing `launch_profiles` count could not mask the new one? An earlier run in 3a-5 proved nothing precisely because the older guard fired first.
4. **Does a NULL model stay NULL in the database** after a resolve? The proof is a column, not an assertion.
5. **Is the management refusal present at create AND at resolve?** One without the other is the 3a-5 defect (D62) repeated.
