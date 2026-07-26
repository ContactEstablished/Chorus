# Implementation Spec 3b-2 — `council_members`, the Run Tables, and the Configuration UI

_Governs exact contents for `Task-3b-2.md`. Task doc wins on **what**; this spec wins on **how**._

## 1. Migration v11 — ONE atomic entry

Append **one** string to `MIGRATIONS`. The runner applies each entry inside a transaction; splitting into three entries would make a partial failure leave the schema half-built with `schema_migrations` disagreeing.

```sql
CREATE TABLE council_members (
  id                    TEXT PRIMARY KEY,
  label                 TEXT NOT NULL UNIQUE,
  credential_profile_id TEXT NOT NULL REFERENCES credential_profiles(id),
  model                 TEXT,
  role                  TEXT NOT NULL,
  params_json           TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE TABLE council_runs (
  id               TEXT PRIMARY KEY,
  project_id       TEXT,
  brief_path       TEXT NOT NULL,
  findings_path    TEXT,
  status           TEXT NOT NULL,
  started_at       TEXT NOT NULL,
  ended_at         TEXT,
  minted_key_hash  TEXT,
  minted_key_limit REAL,
  minted_at        TEXT,
  revoked_at       TEXT,
  tokens_in        INTEGER,
  tokens_out       INTEGER,
  tokens_cached    INTEGER,
  cost_usd         REAL
);
CREATE TABLE council_messages (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL,
  member_id  TEXT,
  round      INTEGER NOT NULL,
  phase      TEXT NOT NULL,
  content    TEXT NOT NULL,
  tokens_in  INTEGER,
  tokens_out INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX council_messages_run ON council_messages (run_id, round);
```

### 1.1 The column-by-column argument, because every nullability here is load-bearing

- **`council_members.credential_profile_id` is `NOT NULL` and the table's ONLY `REFERENCES`.** A member that cannot authenticate cannot deliberate, so unlike `launch_profiles` there is no first-class no-credential case (D33 clause 9 does not reach here). RESTRICT is correct per **D62** — a member is a live **instruction**, and the FK's job is to make the refusal *mandatory*, not to author it.
- **No `provider_id`, no `base_url`.** The route is reached through `credential_profiles.provider_id`. Two columns that can disagree are a bug class, not a convenience — and a `base_url` here would be D48's second home rebuilt in a new table.
- **`model` is NULLABLE** and resolves by **D56**: member's model > the route's `provider_configs.model` > nothing emitted. **Never back-written.**
- **`role` is `TEXT NOT NULL`** with no CHECK constraint — validated by `councilRoleSchema` in main, matching how `auth_mode` and `status` are handled everywhere else. A CHECK would put the vocabulary in two places and make widening it a migration.
- **`params_json` is nullable TEXT** — temperature, top_p, and whatever a member needs. **Defensively parsed on read**, degrading to `{}` on corruption, the `extra_headers_json` / `getWindowBounds` precedent (D15(5)). **It must never carry a key**; the shape validator rejects any value matching `secret-patterns.json`.
- **`council_runs` and `council_messages` carry NO `REFERENCES` at all** — both are historical **facts** (D62's `dispatches` ruling). A transcript stays true after its member is deleted, and a FK would make deleting a member throw for every run it ever joined.
- **`council_runs`' four mint columns mirror v8's ledger exactly**, including that **`revoked_at IS NULL` IS the definition of an open ledger row** — the predicate boot reconciliation queries. **The minted key itself is NEVER stored**; `minted_key_hash` is an identifier that cannot authenticate.
- **`council_messages.member_id` is nullable** — the synthesis and any orchestrator-authored framing have no member.
- **`round` and `phase` are both `NOT NULL`** because a transcript row whose position in the deliberation is unknown cannot be rendered or reasoned about later, and there is no honest default.

**⚠ There is no data migration.** All three tables are created empty. Nothing existing is read or rewritten, which is what makes this the cheapest migration in the phase to rehearse — and the rehearsal is still mandatory, because the risk lives in the runner and the real database, not in the statements.

## 2. Drizzle mirror — `src/main/db/schema.ts`

Three tables mirroring v11 **column for column**, with inferred `CouncilMemberRow` / `CouncilRunRow` / `CouncilMessageRow` types. **D7: types and queries only — never drizzle-kit, never a generated migration.** The hand-rolled array stays the authority; the mirror exists so queries are typed.

## 3. Storage accessors — `src/main/services/storage.ts`

Rows in, rows out. **Every policy decision lives in the caller or in a pure core, never here.**

- `listCouncilMembers()`, `getCouncilMemberById(id)`, `createCouncilMember(row)`, `updateCouncilMember(id, patch)`, `deleteCouncilMember(id)`
- **`countCouncilMembersForCredential(credentialProfileId): number`** — the delete guard's evidence
- `createCouncilRun` / `updateCouncilRun` / `getCouncilRunById` / `listCouncilRuns`, `appendCouncilMessage` / `getCouncilMessagesForRun` — **written now, first called in 3b-3**, the `attention_spans` precedent
- `deleteCouncilRun(id)` — **purges its own `council_messages` inside one transaction**, since the soft pointer means SQLite will not

## 4. The pure core — `src/main/services/councilMembers.ts` (+ test)

Electron-free, storage-free, `fetch`-free, clock-injected. Mirrors `launchProfiles.ts`.

- `defaultMemberLabel(providerName, modelDisplayName)` — D43's default, freely renameable afterwards
- `resolveMemberModel(member, providerRow): string | null` — **D56's order, and the only place it is expressed**
- `validateMemberShape(input, existingLabels, credential, provider): Refusal | Ok` — refuses: empty/duplicate label; unknown credential; **a credential whose provider `auth_mode` is `'management'`**; an unknown role; a `params_json` value matching a known secret shape

### ⚠ 4.1 The management refusal, at both ends

`validateMemberShape` refuses at **create**, and the run-assembly path in 3b-3 refuses again at **resolve**. Both, not either.

The reason is recorded as **D62**: Task 3a-5 shipped exactly this defect for `launch_profiles` — a profile against a management route was accepted, rendered as launchable, and would have launched credential-less on a route that cannot do inference. **`auth_mode` is an unconstrained TEXT column**, so the value can exist in the database before any UI produces it, and main never trusts the renderer. A create-time-only check is defeated by a hand-edited row; a resolve-time-only check renders a member as usable and fails at the worst moment.

## 5. IPC — by symbol

Four channels: `council-member:list` / `:create` / `:update` / `:delete`. All Zod in main (**D1**); plain objects across the bridge (**D14**); every handler **outbound-`.parse`es** its response.

`councilMemberWireSchema` carries **ids and labels only** — `id`, `label`, `credentialProfileId`, `credentialLabel`, `providerName`, `model` (nullable), `resolvedModel` (nullable, computed), `role`, `available` (boolean), `unavailableReason` (nullable, **label-only vocabulary**, `vaultCore.failureMessage`'s wording). **No key, no fingerprint, no base URL, no env var name.**

### 5.1 The delete guard — one added count, not a new guard

Inside the **existing** `CredentialDelete` handler, beside 3a-5's `launch_profiles` count:

```
count = countLaunchProfilesForCredential(id) + countCouncilMembersForCredential(id)
```

Refuse inline, naming **both** counts distinctly so the message tells the user what to remove. **Count BEFORE the statement runs (F16/D62)** — the FK exists to make the refusal mandatory, not to be the refusal.

**⚠ Drive it isolated.** 3a-5's own review records that an earlier run proved nothing because the pre-existing guard fired first. Use a credential that has a **council member and zero launch profiles**, so only the new count can produce the refusal.

## 6. Renderer

`SettingsProviders.vue` (or a sibling settings surface) gains a council-members section: list, create, rename, delete. `stores/settings.ts` gains the actions, following the existing `loadSeq` supersede token and `refuse(reason)` helper.

**Two things the surface must get right:**

1. **Disabled, not hidden.** A member whose credential carries `unavailable_since` is **rendered, disabled, and explained**, with the reason naming the credential **by label only**. Hiding it makes a broken configuration invisible; naming the URL or the env var leaks route detail into the UI for no benefit.
2. **The model input stays free text with an additive suggestion list, never a closed `<select>`** — **D56's third enforcement site**. A dropdown sourced from `model_catalog` would make the catalog authoritative by UI construction, with nobody deciding to.

**The existing deep-scan unit test over the settings store's `$state`, proving it holds no key material, must still pass.**

## 7. Verification specifics

- **Rehearse on a copy with `Local State` beside it (F31)** before the first real boot. A migration that creates tables in a live database does not get its first run in production.
- The three-dump protocol, with `dispatches` and `attention_spans` **exempted in advance** as append-only telemetry (assert no existing row moved), every other table row-identical, and the `projects` pair quoted (F20).
- **`sqlite3` is NOT installed** — use the `ELECTRON_RUN_AS_NODE` pattern. Known flake: the dump script writes no file on its first invocation; retry once.
- **electron-vite does NOT hot-restart main.** Every main-process change needs a real cold boot.
- **CDP-driven Vue forms need a microtask tick between `input` and the submit click**, or the click lands on a stale `:disabled` — a silent no-op that reads exactly like a broken feature. This has caused a failed drive in three separate tasks.

## 8. What this spec deliberately does not decide

- **How a run selects its members** — 3b-3's run-assembly rule (how many members, exactly one arbiter, what happens with zero).
- **Whether runs are retained or pruned.** No retention policy; `deleteCouncilRun` exists, nothing calls it yet.
- **What `params_json` may contain.** Validated as "not a secret" and otherwise passed through; 3b-3 decides which parameters it actually sends.
