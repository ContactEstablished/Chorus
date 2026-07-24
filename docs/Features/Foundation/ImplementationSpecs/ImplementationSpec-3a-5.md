# Implementation Spec 3a-5 — `launch_profiles`, the Dialog Default, and One-Click Relaunch

_Companion to `Tasks/Task-3a-5.md`. The task doc governs **scope**; this doc governs **exact contents, insertion points, and rationale**. Code blocks are starting points to adapt to the surrounding file's conventions — not byte-for-byte mandates — **except** where marked **EXACT**._

**Anchored 2026-07-24 to `15a016e`** (code HEAD for `src/`), with the DB facts read live from `%APPDATA%\chorus\chorus.db`. Baseline: typecheck 0 · **273/273 across 14 files** · `grep:secrets` clean (6 patterns). **Tasks 3a-1 … 3a-4 land between this doc and its execution and move the schema underneath it. Re-verify every symbol and every version number before writing a line.**

**⚠ Read the three warnings in the task doc's Dependencies section first:** the migration-version conflict (v9 is a claim, not a fact), the 3a-4 unverifiability (its file did not exist at authoring), and the standing real-billable-credential condition.

---

## 0. Source Of Truth

Identical to `Tasks/Task-3a-5.md` §Source Of Truth. Three items bind this document specifically:

- **D43** for the id-vs-label rule and the distinct-rows-per-route rule.
- **D49 / F26** for restore decision (b) as shipped, and for the reason option (a) was declined: *unattended boot-time decryption*.
- **F16** for enforced FKs, and **3a-1's `dispatches` no-`REFERENCES` ruling**, which this table deliberately inverts (§2.1).

## 1. Initial Starting Point — the symbols this spec cuts into

Anchored to **named symbols, never line numbers** (standing house rule).

| File | Symbols consumed | Symbols retired |
|---|---|---|
| `src/main/services/storage.ts` | `MIGRATIONS` (6 entries at `15a016e`), the private `migrate()`, `getViewState`/`setViewState` (the `view_state:<projectId>` pair — the scoping precedent), `countCredentialProfilesForProvider`, `getProviderConfigById`, `getCredentialProfileById`, `createSession`, `updateSessionStatus`, `updateSessionTitle`, `deleteSession` | `getCredentialedSessionIds` (**re-implemented**, signature changes), `markSessionCredentialed`, `unmarkSessionCredentialed`, private `writeCredentialedSessionIds` (**all deleted**) |
| `src/main/db/schema.ts` | `sessions`, `providerConfigs`, `credentialProfiles`, `settings`, `$inferSelect`/`$inferInsert` conventions | — |
| `src/main/ipc.ts` | nested `resolveCredential(profileId, agent)`, `IpcChannel.SessionLaunch` handler (`LAUNCH_PANE_CAP = 16`, the cwd security boundary), `SessionRestart`, `SessionDelete`, `SessionLaunchContext`, `ProviderDelete`'s count-and-refuse, `CredentialDelete` | `storage.unmarkSessionCredentialed(sessionId)` call in `SessionDelete` |
| `src/main/services/sessionManager.ts` | `restore(projectId)`'s credentialed branch, `launch(agent, cwd, sessionId, opts)`, `LaunchOptions` (`secrets` / `credential` / `route`) | — (**only the set's source changes**) |
| `src/renderer/src/components/LaunchDialog.vue` | `AuthChoice`, `authChoice`, `eligibleProfiles`, the `watch([selected, authChoice])`, `onMounted`'s `Promise.all`, `submit()`'s fresh-literal payload, `modeClass`/`authClass`, the Tab trap | — |
| `src/renderer/src/components/TerminalPane.vue` | `onRestart()`, `waitForExit`, `paneMessage`, `store.setBusy`, the header button row | — |

**Live DB facts (real dev DB, read-only, 2026-07-24)** — these are the migration's actual inputs:

- `settings['credentialed_sessions'] = ["1099b5d4-9df9-4c02-ad7d-6d1b239c2f63","246c087b-897c-4b8e-84c1-72528a5c08b4"]`
- `1099b5d4…` → `status='exited'`, title `Credential not re-supplied — relaunch from the dialog to re-enter it`
- **`246c087b…` → `status='running'`** — will be healed at the next boot; also the `view_state:985d547b…` focused session
- Providers: `OpenRouter`/`codex`/`api_key`/`OPENROUTER_API_KEY`/`https://openrouter.ai/api/v1`/`moonshotai/kimi-k3`; `Anthropic direct`/`claude`/`api_key`
- Credential profiles: `OR milestone key` (on OpenRouter), `Claude fake key` (on Anthropic direct)
- `schema_migrations`: v1 … v6, v6 at `2026-07-24T15:52:22.591Z`

---

## 2. Migration v9 — EXACT

**⚠ Version: read `MIGRATIONS.length + 1` at execution.** Everywhere below, "v9" means "the next free version". Report any divergence rather than renumbering someone else's landed migration.

### 2.1 Why this table carries `REFERENCES` when `dispatches` does not

3a-1 ruled, correctly, that `dispatches` carries **no** `REFERENCES` clause of any kind: a dispatch is an immutable record of something that happened, sessions are deleted on pane close (D16 resolution d), and a FK would make `session:delete` throw. **`launch_profiles` is the opposite kind of object and takes the opposite ruling.**

| | `dispatches` (3a-1) | `launch_profiles` (this task) |
|---|---|---|
| What it is | a historical **fact** | a live **instruction** |
| Meaning after its subject is deleted | unchanged — it still happened | **a lie** — it cannot reproduce anything |
| Correct FK behaviour | none; tolerate dangling | RESTRICT; refuse the delete |
| Where the refusal is authored | nowhere needed | **main, counted before SQLite throws** |

**State this inversion in the commit message.** Two adjacent tables in the same phase with opposite FK rulings will look like an inconsistency to the next reader unless the reasoning is written down.

**`sessions.launch_profile_id` is the third case and takes the `dispatches` ruling**: a soft pointer with **no** `REFERENCES`, because a session row is history too and a FK there would make deleting a launch profile throw for every session that ever used it. Its dangling case is absorbed by the **fail-safe** predicate (§3.1), which is what makes the soft pointer safe rather than sloppy.

### 2.2 The `MIGRATIONS` entry — EXACT

Append **one** entry (the v4 precedent: several statements, one entry, one transaction):

```ts
  // v9 (Phase 3a / D43 + D49): launch_profiles — the (agent x route x model)
  // triple with an IMMUTABLE id and a RENAMEABLE label — plus the per-session
  // pointer that RETIRES Task 3-6's global `credentialed_sessions` settings
  // list. Four deliberate shapes, each argued in ImplementationSpec-3a-5 §2:
  //   1. REFERENCES on provider_id / credential_profile_id are ENFORCED (F16)
  //      and INTENDED: a launch profile is a live INSTRUCTION, meaningless
  //      once its target is gone, so RESTRICT is correct and the refusal is
  //      authored in main (count-and-refuse) rather than reverse-engineered
  //      from a caught SQLITE_CONSTRAINT_FOREIGNKEY. This is the deliberate
  //      INVERSE of 3a-1's dispatches ruling, which is correct for a table of
  //      historical facts.
  //   2. sessions.launch_profile_id carries NO REFERENCES — a session row is
  //      history like a dispatch, and a FK would make deleting a profile
  //      throw for every session that ever used it. Its dangling case is
  //      handled by the FAIL-SAFE predicate in launchProfiles.ts.
  //   3. UNIQUE(label): the label IS the picker, so duplicates are unusable.
  //      Checked in main before the insert; the constraint is the backstop.
  //   4. The data migration converts the retired settings list into per-row
  //      sentinels and DELETES the row, in the same transaction as the DDL —
  //      two versions would leave a window where both exist and disagree.
  `CREATE TABLE launch_profiles (
     id                    TEXT PRIMARY KEY,
     label                 TEXT NOT NULL UNIQUE,
     agent                 TEXT NOT NULL,
     provider_id           TEXT REFERENCES provider_configs(id),
     credential_profile_id TEXT REFERENCES credential_profiles(id),
     model                 TEXT,
     effort                TEXT,
     permission_mode       TEXT,
     workspace_mode        TEXT NOT NULL,
     env_json              TEXT,
     created_at            TEXT NOT NULL,
     updated_at            TEXT NOT NULL
   );
   ALTER TABLE sessions ADD COLUMN launch_profile_id TEXT;
   UPDATE sessions
      SET launch_profile_id = 'legacy-credentialed'
    WHERE COALESCE((SELECT value FROM settings WHERE key = 'credentialed_sessions'), '[]')
          LIKE '%"' || id || '"%';
   DELETE FROM settings WHERE key = 'credentialed_sessions';`
```

**Column-by-column, because every nullability here is semantic:**

| Column | Null? | Why |
|---|---|---|
| `id` | no | The immutable identity. **Everything that stores a reference stores this** (D43). |
| `label` | no, UNIQUE | User-authored, renameable, defaulted to `<provider name>/<model display name>` (D43). Unique because the label *is* the picker. |
| `agent` | no | **Required even though it duplicates `provider_configs.adapter_type` when a route is present** — see §2.3. |
| `provider_id` | **yes** | NULL = no route = today's first-class ambient/subscription launch (D33 clause 9). See §2.3. |
| `credential_profile_id` | **yes** | NULL = this profile holds no credential and its sessions are safely restorable. **This column IS the credentialed predicate.** |
| `model` | yes | NULL = fall through to the route default (precedence rank 2). **Never back-written.** |
| `effort` | yes | An **`EffortOption.id` from 3a-4's `effortLevelSchema`**, imported. At launch it is handed to 3a-4's existing `LaunchOptions.effort` seam and resolved by **its** `resolveEffortArgs` — this task maps nothing onto a flag and **touches no adapter**. 3a-4 left the level *"per-launch and unpersisted, deliberately"*; **this column is where it becomes persistable, and it is its one home.** |
| `permission_mode` | yes | **Stored, consumed by nothing.** Mapping it onto a CLI flag is D4 material *and* an adapter change — out of scope. Created now so schema churn stays in one migration (the `attention_spans` precedent). |
| `workspace_mode` | no | `'current-tree'` or `'new-worktree'` only; `'existing-worktree'` is refused at create/update (§4.3). |
| `env_json` | yes | A JSON object of **non-secret** string→string additions, refused if it matches a known key shape (§4.4). |
| `created_at` / `updated_at` | no | ISO text, the house convention. `updated_at` exists so a rename is visible without a second table. |

### 2.3 Why `agent` is its own column, and why that is not a second home

The tension is real and must be named rather than hand-waved. When `provider_id` is set, `provider_configs.adapter_type` already says which agent the route targets, and `resolveCredential` already refuses a mismatch. A second copy invites drift — exactly D48's anti-goal.

**But `provider_id` is nullable**, and a route-less profile (the plain "Claude Code on my subscription" profile most users will save first) has **nowhere else** to record its agent. Two rejected alternatives and why:

- **Make `provider_id` NOT NULL and force a subscription route row.** D43 says subscription routes are first-class `provider_configs` rows, so this is representable — but it makes the *most common* profile require the user to first create a route in Settings before they can save the thing they just launched. That trades the feature's whole point (one click) for a schema purity that a validator delivers just as well.
- **Derive the agent from the credential's provider.** A route-less profile has no credential either.

**Resolution: `agent` is authoritative, and drift is closed by a main-side equality check** — `validateProfileShape` refuses any create/update where `provider_id` is set and `agent !== provider.adapter_type`, with a named unit test. One authoritative field, one validator, no hope.

### 2.4 The data migration — JSON1-free, guarded, and rehearsed

The `LIKE '%"' || id || '"%'` predicate matches the id **including its surrounding JSON quotes**, so a partial-uuid collision is impossible. `COALESCE(…, '[]')` makes the whole statement a no-op on a machine that never had the settings row — including a fresh install, where a throw inside the runner's transaction would **fail the boot outright**.

**Rejected alternative: `json_each`.** `UPDATE sessions … WHERE id IN (SELECT value FROM json_each(…))` is more obviously correct and is rejected anyway: it depends on the JSON1 extension being compiled into the shipped better-sqlite3 build, and `json_each` on a malformed value **throws** rather than returning empty. The `LIKE` form degrades to a no-op on any input it cannot understand, which is the correct failure mode for a migration that runs before the app is usable. Record this choice in the commit message; it will otherwise read as a hack.

**The sentinel is `'legacy-credentialed'`** — deliberately not a uuid, so it can never collide with a real profile id and can never be mistaken for one. Export it, do not inline it:

```ts
/** The v9 data-migration sentinel written into sessions.launch_profile_id for
 *  every row named by the retired `credentialed_sessions` settings list. It is
 *  deliberately NOT a uuid and deliberately DOES NOT RESOLVE: the retired list
 *  recorded session ids and NOTHING ELSE — no profile, no provider, no
 *  credential — so there is no data from which to synthesize a launch profile,
 *  and synthesizing one would put a fake row in the user's picker. An
 *  unresolvable pointer means "Chorus cannot prove this session was keyless",
 *  which the fail-safe predicate reads as credentialed. Nothing special-cases
 *  this value; it flows through the ordinary unresolvable-pointer path. */
export const LEGACY_CREDENTIALED_PROFILE_ID = 'legacy-credentialed'
```

**`_verify/3a-5/rehearse-v9.js` runs the entry against a COPY of the real DB before any real boot** and asserts: both known ids marked, every other session row NULL, the settings row gone, and `length(encrypted_blob)` unchanged for both credential rows. **A data migration that mutates the live `sessions` table does not get to be tested in production.**

### 2.5 The Drizzle mirror — `src/main/db/schema.ts`

```ts
/**
 * Phase 3a / D43: the launchable unit — (agent x route x model) — as one
 * user-named row. The id is IMMUTABLE and is what every reference stores; the
 * label is freely renameable and is what the picker shows. Two routes to the
 * same model are two rows, deliberately (`OR/DeepSeek v4 Pro` vs
 * `Direct/DeepSeek`), and nothing may dedupe them.
 *
 * Matches migration v9's DDL column for column. NOTE the FK asymmetry, which
 * is intentional and argued in ImplementationSpec-3a-5 §2.1: this table
 * REFERENCES its targets (a live instruction must not outlive them), while
 * sessions.launch_profile_id does NOT reference this table (a session row is
 * history and must outlive the profile).
 */
export const launchProfiles = sqliteTable('launch_profiles', {
  id: text('id').primaryKey(),
  label: text('label').notNull().unique(),
  // Authoritative even when a route is present: provider_id is nullable, so a
  // route-less profile has nowhere else to record its agent. Drift against
  // provider_configs.adapter_type is closed by validateProfileShape, not by a
  // CHECK constraint (spec 2.3).
  agent: text('agent').notNull(),
  // NULL = no route: today's first-class ambient/subscription launch (D33
  // clause 9). ENFORCED FK (F16) when set.
  providerId: text('provider_id').references(() => providerConfigs.id),
  // NULL = this profile holds no credential. THIS COLUMN IS THE CREDENTIALED
  // PREDICATE: sessionIsCredentialed reads it through the profile pointer.
  credentialProfileId: text('credential_profile_id').references(() => credentialProfiles.id),
  // Precedence rank 1 (3a-4's table). NULL falls through to the route's
  // provider_configs.model (rank 2, D48). NEVER back-written.
  model: text('model'),
  // An EffortOption.id from 3a-4's effortLevelSchema — IMPORTED, never
  // re-declared. 3a-5 persists it and hands it to 3a-4's LaunchOptions.effort
  // seam; 3a-4's resolveEffortArgs owns every mapping decision, and no adapter
  // file changes here. Rank 2 of 3a-4's effort order (raw extra_args still
  // wins); a profile does not create a rank 0.
  effort: text('effort'),
  // Stored; consumed by nothing in 3a-5. Mapping it onto a CLI flag is D4
  // material and an adapter change.
  permissionMode: text('permission_mode'),
  // 'current-tree' | 'new-worktree' only — 'existing-worktree' names a
  // specific transient worktree row and is refused at create/update.
  workspaceMode: text('workspace_mode').notNull(),
  // JSON object of NON-SECRET string->string env additions, refused at write
  // if it carries a known key shape (the extra_headers_json precedent).
  envJson: text('env_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

export type LaunchProfileRow = typeof launchProfiles.$inferSelect
export type NewLaunchProfileRow = typeof launchProfiles.$inferInsert
```

and on `sessions`:

```ts
  // v9 (Phase 3a): a SOFT pointer to the launch_profiles row this session was
  // launched under — deliberately NO .references(): a session row is history
  // and must survive its profile's deletion, exactly as 3a-1's dispatches
  // survive their session's. An unresolvable value (a deleted profile, or the
  // LEGACY_CREDENTIALED_PROFILE_ID sentinel) is read FAIL-SAFE as
  // "credentialed" — see launchProfiles.ts.
  launchProfileId: text('launch_profile_id'),
```

---

## 3. `src/main/services/launchProfiles.ts` — the pure core

**Create.** Electron-free, storage-free, `fetch`-free, clock-injected. Precedent: `vaultCore.ts`, `restore.ts`'s `computeRestoreSet`, `env.ts`'s `composeChildEnv`. Everything in this module is a **decision**; everything in `storage.ts` is rows-in-rows-out; everything in `ipc.ts` is wiring.

### 3.1 The fail-safe predicate — the most load-bearing function in the task

```ts
/**
 * Does this session hold a credential, i.e. must it NEVER be auto-restored
 * keyless? Replaces Task 3-6's global `credentialed_sessions` settings list
 * (D49): the fact is now DERIVED from the profile the session launched under,
 * per-session and therefore per-project — which retires the Phase-3-only
 * global-scoping expedient the roadmap flagged.
 *
 * FAIL SAFE, and this is the whole design: an unresolvable pointer means
 * Chorus CANNOT PROVE the session was keyless, and the only safe reading of
 * "cannot prove" is "do not restore it keyless" (F26's failure shape, which
 * the phase has already paid for once). That single branch is also what makes
 * the legacy migration honest — the retired list carried session ids and
 * nothing else, so the sentinel is a pointer that deliberately does not
 * resolve rather than a fake profile in the user's picker.
 */
export function sessionIsCredentialed(
  launchProfileId: string | null,
  lookup: (id: string) => { credentialProfileId: string | null } | undefined
): boolean {
  if (launchProfileId === null) return false
  const profile = lookup(launchProfileId)
  if (profile === undefined) return true // <-- FAIL SAFE. Do not "simplify".
  return profile.credentialProfileId !== null
}
```

**The `lookup` callback keeps this pure** and makes the four-row truth table testable without a database. `StorageService` supplies `(id) => this.getLaunchProfileById(id)`.

### 3.2 Resolution, refusals, and the disabled-with-reason state

```ts
export type ProfileResolution =
  | { ok: true; plan: ResolvedLaunchPlan }
  /** Not a throw and not a hidden row: the picker SHOWS this profile, disables
   *  it, and renders `reason` verbatim. A launch profile is a thing the USER
   *  NAMED — a named entry that silently vanishes is worse than one that says
   *  why it cannot launch. (This deliberately differs from 3-6's
   *  `eligibleProfiles`, which HIDES unavailable CREDENTIAL profiles; those
   *  are plumbing, not user-named rows.) */
  | { ok: false; reason: string }

export interface ResolvedLaunchPlan {
  readonly profileId: string
  readonly agent: string
  /** Precedence rank 1 -> 2 -> none, resolved HERE and never written back to
   *  the profile row (writing it back is how a second home for "which model"
   *  gets created by accident). */
  readonly model: string | null
  readonly credentialProfileId: string | null
  readonly workspaceMode: 'current-tree' | 'new-worktree'
  readonly envAdditions: Readonly<Record<string, string>>
  /** An EffortOption.id (3a-4). Flows into LaunchOptions.effort untouched —
   *  this module maps nothing onto a CLI flag. */
  readonly effort: string | null
  readonly permissionMode: string | null
}
```

`resolveLaunchProfile(profile, provider, credential)` — pure, takes the three **rows**, returns the above. Refusal vocabulary, **label-only**, mirroring `resolveCredential`'s discipline (no URL, no env var value, no key fragment ever reaches a message):

| Condition | `reason` |
|---|---|
| provider id set, provider row missing | `The route for this profile no longer exists.` |
| credential id set, credential row missing | `The credential for this profile no longer exists.` |
| `credential.unavailableSince` set | `Credential '<label>' is unavailable — re-enter it in Settings.` |
| `provider.adapterType !== profile.agent` | `This profile targets <agent> but its route '<provider name>' does not.` |
| credential's `providerId !== profile.providerId` | `Credential '<label>' does not belong to this profile's route.` |

**The FK guarantees the first two conditions cannot arise through the app's own delete paths** — they are guards against a hand-edited database and against a future path that forgets to count-and-refuse. Keep them; they cost nothing and they are the reason the fail-safe predicate never has to guess.

### 3.3 Validators

```ts
/** Create/update shape validation. Called BEFORE any insert so every refusal
 *  is an authored message, never a reverse-engineered SQLite error. */
export function validateProfileShape(input: ProfileWriteInput, provider: ProviderRowLite | null):
  { ok: true } | { ok: false; reason: string }
```

Rules, each its own named test:

1. `label` trimmed, 1…120 chars, and **not already taken** (checked in main against `getLaunchProfileByLabel`; the `UNIQUE` constraint stays as a backstop emitting a fixed string).
2. `workspace_mode` ∈ `{current-tree, new-worktree}`; `existing-worktree` → `A saved profile cannot pin an existing worktree — pick it at launch instead.`
3. `provider_id` set ⇒ `agent === provider.adapterType`.
4. `credential_profile_id` set ⇒ `provider_id` set (a credential without a route is meaningless).
5. `env_json` parses to a **flat object of string values**, ≤ 32 keys, and **no value matches a `secret-patterns.json` shape** — reuse `scrubSecrets` and refuse if the scrubbed form differs from the input, exactly the `extra_headers_json` precedent (`provider:create` already refuses a headers blob carrying a known key shape). Key names are validated as `^[A-Za-z_][A-Za-z0-9_]*$`.

### 3.4 `defaultProfileLabel`

```ts
/** D43: "the label — defaulted to `<provider name>/<model display name>` —
 *  stays freely renameable". A route-less profile has no provider name, so it
 *  falls back to the agent's display name; the label is a DEFAULT the user
 *  immediately owns, never a key. */
export function defaultProfileLabel(providerName: string | null, model: string | null, agent: string): string
```

`OpenRouter/moonshotai/kimi-k3` is an ugly default and is still correct: it is the user's to rename, and generating something prettier by parsing model slugs would bake a vendor-specific assumption into a label the user controls.

---

## 4. `src/main/services/storage.ts` — accessors

Rows in, rows out. **No policy here** — the same split 3a-1 drew between its accessors and its recorder.

```ts
  /* ------------------------------------------------------------------ */
  /* Phase 3a / D43: launch profiles. RETIRES the Task 3-6 global        */
  /* `credentialed_sessions` settings list (D49) — the credentialed fact  */
  /* is now DERIVED per-session from the profile a session launched      */
  /* under, which is also what makes it project-scoped instead of global. */
  /* ------------------------------------------------------------------ */

  listLaunchProfiles(): LaunchProfileRow[]
  getLaunchProfileById(id: string): LaunchProfileRow | undefined
  getLaunchProfileByLabel(label: string): LaunchProfileRow | undefined
  createLaunchProfile(row: NewLaunchProfileRow): LaunchProfileRow
  updateLaunchProfile(id: string, patch: Partial<NewLaunchProfileRow>): LaunchProfileRow | undefined
  deleteLaunchProfile(id: string): void

  /** F16 count-and-refuse inputs. Both are REQUIRED before their delete
   *  handler runs — never let SQLite throw and then translate the error. */
  countLaunchProfilesForProvider(providerId: string): number
  countLaunchProfilesForCredential(credentialProfileId: string): number

  /** Restore's input. NOTE THE PARAMETER: the 3-6 form was global over all
   *  projects — an accepted Phase-3-only expedient the roadmap flagged. It is
   *  now scoped, which is the debt retirement made visible in the signature. */
  getCredentialedSessionIds(projectId: string): Set<string>

  /** session:restart's input. */
  isSessionCredentialed(sessionId: string): boolean

  /** Per-project last-used pointer, keyed `last_launch_profile:<projectId>` —
   *  the `view_state:<projectId>` pattern, verbatim. Stores the ID, never the
   *  label (D43): a rename must have zero downstream consequences. A dangling
   *  id resolves to null — never to a fuzzy label match. */
  getLastLaunchProfileId(projectId: string): string | null
  setLastLaunchProfileId(projectId: string, profileId: string): void
```

**Deleted in the same commit:** `markSessionCredentialed`, `unmarkSessionCredentialed`, the private `writeCredentialedSessionIds`, and the `'credentialed_sessions'` string literal. `createSession` gains `launchProfileId` through `NewSessionRow` — **written on the same insert as the row**, never in a follow-up update (a crash between the two leaves a credentialed session unmarked, which is the silent-keyless-restore failure through the back door).

---

## 5. IPC — five channels, main-side Zod, inbound AND outbound parsed

The Phase 3 house pattern, unchanged: **all Zod in main (D1)**; the preload is a **Zod-free typed forwarder** (a preload Zod import throws `EvalError` under CSP and silently drops events); **every handler parses its inbound payload and parses its outbound response** before returning; **payloads are plain objects (D14)**.

### 5.1 `src/shared/ipc.ts` — channels

```ts
  LaunchProfileList: 'launch-profile:list',
  LaunchProfileCreate: 'launch-profile:create',
  LaunchProfileUpdate: 'launch-profile:update',
  LaunchProfileDelete: 'launch-profile:delete',
  SessionRelaunch: 'session:relaunch'
```

`ipcMain.handle(` count goes **31 → 36**. State the new number in the commit message; 3a-1 made that count a checkable invariant.

### 5.2 The wire shape

```ts
/** One launch profile on the wire. Carries a credential PROFILE ID and its
 *  LABEL and nothing else — there is no field here capable of holding key
 *  material, and `src/shared/ipc.test.ts` asserts that over the parse
 *  output's KEY SET (the 3-2 discipline), not by spot-checking.
 *
 *  `disabledReason` is computed in MAIN by resolveLaunchProfile: an
 *  unlaunchable profile is SHOWN and DISABLED with its reason, never filtered
 *  out. A launch profile is a row the user named; hiding it is a worse
 *  experience than explaining it. */
export const launchProfileWireSchema = z.object({
  id: z.uuid(),
  label: z.string().min(1).max(120),
  agent: agentKindSchema,
  provider_id: z.uuid().nullable(),
  provider_name: z.string().max(120).nullable(),
  credential_profile_id: z.uuid().nullable(),
  credential_label: z.string().max(120).nullable(),
  /** The RESOLVED model (profile -> route -> null), so the renderer never
   *  re-implements 3a-4's precedence table. */
  model: z.string().max(200).nullable(),
  /** 3a-4's `effortLevelSchema`, IMPORTED — not `z.string()`, and not a
   *  second enum. If the import is unavailable at execution, stop and report. */
  effort: effortLevelSchema.nullable(),
  permission_mode: z.string().max(40).nullable(),
  workspace_mode: savedWorkspaceModeSchema,
  env_json: z.string().max(4096).nullable(),
  disabled_reason: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
})

/** A SAVED profile may not pin a transient worktree row. */
export const savedWorkspaceModeSchema = z.enum(['current-tree', 'new-worktree'])
```

Create / update / delete requests mirror `providerCreate/Update/Delete`'s conventions exactly — snake_case on the wire, **required-nullable** fields (the house discipline since 1b-1), patch semantics on update (*absent = unchanged; null = clear; a value = set*), and `{ok:true, profile} | {ok:false, reason}` responses.

### 5.3 The widened launch payload and launch context

```ts
export const launchRequestSchema = z.object({
  …existing…,
  /** Phase 3a / D43: launch from a saved profile. MUTUALLY EXCLUSIVE with
   *  credential_profile_id — both present is refused in MAIN with an authored
   *  reason, deliberately NOT by schema branching, so the refusal has a place
   *  to say why. The profile supplies the credential, route, model, effort and
   *  env; the payload still supplies agent, cwd and workspace_mode, because
   *  the user may change all three after picking a profile and because cwd is
   *  the SECURITY BOUNDARY main validates itself. */
  launch_profile_id: z.uuid().optional()
})
```

**⚠ 3a-4 already added `effort` to this same schema** (*"`session:launch`'s request gains an optional `effort`"*). Do **not** add a second field. The dialog prefills that existing field from the chosen profile, and the user may change it before launching — the profile is the default, the payload is what launches. If the payload carries no `effort` and the profile does, main fills it from `resolution.plan.effort`; if the payload carries one, **the payload wins**, because it is what the user is looking at.

```ts

export const launchContextResponseSchema = z.object({
  …existing…,
  /** Phase 3a: the picker's rows, resolved and ordered by label in MAIN. */
  launchProfiles: z.array(launchProfileWireSchema),
  /** Phase 3a: the per-project last-used pointer, or null when there is none
   *  or when it dangles. Computed in MAIN — the renderer never derives a
   *  default and never persists one. */
  lastLaunchProfileId: z.uuid().nullable()
})
```

### 5.4 `session:relaunch`

```ts
export const relaunchRequestSchema = z.object({ sessionId: z.string().min(1) })

/** Same union shape as restartResponseSchema — a snapshot or an authored
 *  refusal. Deliberately its OWN schema rather than an alias: the two verbs
 *  differ in meaning (restart = same configuration, NO credential; relaunch =
 *  same configuration, credential RE-RESOLVED because the user asked) and
 *  they will diverge before they converge. */
export const relaunchResponseSchema = z.union([
  attachResponseSchema.extend({ title: z.string().nullable(), branch: …, worktreeId: … }),
  z.object({ ok: z.literal(false), reason: z.string() })
])
```

### 5.5 `src/preload/index.ts`

Five one-line forwarders in the existing style — no Zod, no logic:

```ts
  listLaunchProfiles: (): Promise<LaunchProfileListResponse> =>
    ipcRenderer.invoke(IpcChannel.LaunchProfileList, {}),
  createLaunchProfile: (request: LaunchProfileCreateRequest): Promise<LaunchProfileCreateResponse> =>
    ipcRenderer.invoke(IpcChannel.LaunchProfileCreate, request),
  updateLaunchProfile: (request: LaunchProfileUpdateRequest): Promise<LaunchProfileUpdateResponse> =>
    ipcRenderer.invoke(IpcChannel.LaunchProfileUpdate, request),
  deleteLaunchProfile: (id: string): Promise<LaunchProfileDeleteResponse> =>
    ipcRenderer.invoke(IpcChannel.LaunchProfileDelete, { id }),
  relaunchSession: (sessionId: string): Promise<RelaunchResponse> =>
    ipcRenderer.invoke(IpcChannel.SessionRelaunch, { sessionId }),
```

---

## 6. `src/main/ipc.ts` — insertion points, by symbol

### 6.1 Inside the `IpcChannel.SessionLaunch` handler

**After** the `LAUNCH_PANE_CAP` check and the cwd security boundary, **before** the workspace-mode branches — i.e. exactly where the existing `if (req.credential_profile_id)` block sits, which it extends rather than replaces:

```ts
    // Phase 3a / D43. The division of authority, stated once:
    //   profile  -> credential, route, model, effort, permission mode, env
    //   payload  -> agent, cwd, workspace_mode  (the user may change all
    //               three after picking a profile, and cwd is the security
    //               boundary main validates ITSELF — a stored row is
    //               untrusted input like any other).
    // Mutually exclusive with credential_profile_id: ONE resolver, ONE source
    // of truth for the credential.
    if (req.launch_profile_id && req.credential_profile_id) {
      return { ok: false, reason: 'Pick a launch profile or a credential, not both.' }
    }
    let launchProfileId: string | null = null
    let launchOpts: LaunchOptions = {}
    if (req.launch_profile_id) {
      const profile = storage.getLaunchProfileById(req.launch_profile_id)
      if (!profile) return { ok: false, reason: 'That launch profile no longer exists.' }
      if (profile.agent !== req.agent) {
        return { ok: false, reason: `That launch profile is for ${profile.agent}, not ${req.agent}.` }
      }
      const resolution = resolveLaunchProfile(profile, provider, credentialRow)
      if (!resolution.ok) return { ok: false, reason: resolution.reason }
      launchProfileId = profile.id
      if (resolution.plan.credentialProfileId) {
        // REUSE, do not fork: exactly one function in main calls
        // vault.decryptForLaunch for a launch, so D33 clause 8's refusals
        // have exactly one place to live.
        const resolved = await resolveCredential(resolution.plan.credentialProfileId, req.agent)
        if (!resolved.ok) return { ok: false, reason: resolved.reason }
        launchOpts = { secrets: [resolved.credential.value], credential: resolved.credential,
                       ...(resolved.route ? { route: resolved.route } : {}) }
      }
    } else if (req.credential_profile_id) {
      …existing 3-6 block, unchanged…
    }
```

`launchProfileId` flows into **every** `storage.createSession({…})` call in the handler (there are three, one per workspace mode — **check all three**, a missed branch is a session that silently loses its credentialed mark). The **last-used write** happens after a successful launch only:

```ts
    // Written by MAIN, after success, per-project (spec 6.4). A failed launch
    // leaves the previous default intact; the renderer never computes or
    // persists a default.
    if (launchProfileId) storage.setLastLaunchProfileId(p.id, launchProfileId)
```

### 6.2 `IpcChannel.SessionRestart`

Replace `storage.getCredentialedSessionIds().has(sessionId)` with `storage.isSessionCredentialed(sessionId)`. **The refusal message stays byte-identical** — it is what makes the two verbs legible, and changing it would be an unnecessary user-visible diff in a task whose whole claim is that behaviour did not regress.

### 6.3 `IpcChannel.SessionDelete`

Delete the `storage.unmarkSessionCredentialed(sessionId)` line. **Nothing replaces it** — the fact now dies with the row, structurally. Leave the worktree-detach block exactly as it is; it is the F16 guard and unrelated.

### 6.4 `IpcChannel.SessionLaunchContext`

Add the two fields, both computed in main:

```ts
      launchProfiles: storage.listLaunchProfiles()
        .map((row) => toWire(row, storage))         // resolves provider/credential + disabled_reason
        .sort((a, b) => a.label.localeCompare(b.label)),
      // A DANGLING pointer resolves to null, never to a label match: the
      // profile was deleted, so there is no default, and the dialog behaves
      // exactly as it does today.
      lastLaunchProfileId: (() => {
        const id = storage.getLastLaunchProfileId(p.id)
        return id && storage.getLaunchProfileById(id) ? id : null
      })()
```

### 6.5 The two delete guards

```ts
  // ProviderDelete — ADD to the existing count-and-refuse (F16). Both counts
  // are checked; the message names whichever blocks.
  const profilesUsing = storage.countLaunchProfilesForProvider(id)
  if (profilesUsing > 0) {
    return providerDeleteResponseSchema.parse({
      ok: false,
      reason: `Provider '${existing.name}' is used by ${profilesUsing} launch profile${profilesUsing === 1 ? '' : 's'} — delete ${profilesUsing === 1 ? 'it' : 'them'} first`
    })
  }

  // CredentialDelete — NEW. Today this handler has NO guard at all and would
  // let SQLite throw SQLITE_CONSTRAINT_FOREIGNKEY straight through once
  // launch_profiles references credential_profiles.
  const usedBy = storage.countLaunchProfilesForCredential(id)
  if (usedBy > 0) { … }
```

**Never reverse-engineer a caught constraint error into a user message** — the failure Task 2-3 already paid for once.

### 6.6 The `session:relaunch` handler — the whole restore ruling, in one place

```ts
  /**
   * Task 3a-5 / D49: one-click relaunch of a session that was healed to
   * `exited` because it held a credential.
   *
   * ⚠ THE INVARIANT THIS HANDLER EXISTS TO PRESERVE: restore stays decision
   * (b), and there is NO unattended boot-time decryption. Option (a) —
   * re-resolving credentials inside restore() — was DECLINED because D33 never
   * sanctioned decrypting with no user present, and this task does not
   * reintroduce it by the side door. The ONLY thing added is this handler,
   * which decrypts because a human clicked something. That distance is the
   * entire security argument, and it is one careless `await` wide: if any part
   * of this logic is ever factored into a helper that restore() also calls,
   * the invariant is gone and nothing will fail to compile.
   *
   * `vault.decryptForLaunch` has THREE call sites in src/ after this task, all
   * inside registerIpc, all inside an ipcMain.handle body. SessionManager
   * still contains ZERO references to the vault.
   */
  ipcMain.handle(IpcChannel.SessionRelaunch, async (_event, payload): Promise<RelaunchResponse> => {
    const { sessionId } = relaunchRequestSchema.parse(payload)
    const row = storage.getSessionById(sessionId)
    if (!row) return relaunchResponseSchema.parse({ ok: false, reason: `Unknown sessionId: ${sessionId}` })
    if (sessions.isRunning(sessionId)) {
      return relaunchResponseSchema.parse({ ok: false, reason: 'Session is still running — kill it first' })
    }
    if (!fs.existsSync(row.cwd)) {
      return relaunchResponseSchema.parse({ ok: false, reason: `Working directory not found: ${row.cwd}` })
    }
    const adapter = getAdapter(row.agent)
    if (!adapter) {
      return relaunchResponseSchema.parse({ ok: false, reason: `Unknown agent '${row.agent}' — this session cannot be relaunched.` })
    }
    // The legacy population lands HERE, and correctly: the retired settings
    // list recorded ids only, so there is nothing to resolve and the honest
    // answer is the one the healed title already gives.
    const profile = row.launchProfileId ? storage.getLaunchProfileById(row.launchProfileId) : undefined
    if (!profile) {
      return relaunchResponseSchema.parse({
        ok: false,
        reason: 'This session has no saved launch profile — start a new one from the launch dialog.'
      })
    }
    const resolution = resolveLaunchProfile(profile, …)
    if (!resolution.ok) return relaunchResponseSchema.parse({ ok: false, reason: resolution.reason })
    let opts: LaunchOptions = {}
    if (resolution.plan.credentialProfileId) {
      const resolved = await resolveCredential(resolution.plan.credentialProfileId, row.agent as AgentKind)
      if (!resolved.ok) return relaunchResponseSchema.parse({ ok: false, reason: resolved.reason })
      opts = { secrets: [resolved.credential.value], credential: resolved.credential,
               ...(resolved.route ? { route: resolved.route } : {}) }
    }
    try {
      // Same row id, the session:restart shape: no row creation, and
      // 'running' written ONLY AFTER the spawn succeeds.
      const snap = sessions.launch(row.agent as AgentKind, row.cwd, row.id, opts)
      storage.updateSessionStatus(sessionId, 'running', null)
      return relaunchResponseSchema.parse({ …snap, title: row.title, branch: …, worktreeId: … })
    } catch (err) {
      return relaunchResponseSchema.parse({ ok: false, reason: err instanceof Error ? err.message : String(err) })
    }
  })
```

**The healed title is NOT cleared on a successful relaunch** unless the agent's own OSC title event replaces it — that is D18's mechanism and it already runs. Clearing it manually would be main inventing a title, which nothing else in the app does.

---

## 7. `src/main/services/sessionManager.ts` — the body swap

**One line changes.** The credentialed branch of `restore(projectId)` keeps its heal, its title, its log line and its `conclude(row.id)`; only the set's source moves:

```ts
-    const credentialed = storage.getCredentialedSessionIds()
+    // Phase 3a / D49: DERIVED per-session from the launch profile the session
+    // ran under, replacing 3-6's global `credentialed_sessions` settings list
+    // (an accepted Phase-3-only expedient the roadmap flagged for retirement).
+    // Restore's BEHAVIOUR is unchanged and deliberately so — this is a body
+    // swap, not a call-site rewrite.
+    const credentialed = storage.getCredentialedSessionIds(projectId)
```

**Update the block comment above it** to say the fact is derived, and **leave the healed-title string and the log line byte-identical**. If retiring the list requires touching anything else in this file, the design is wrong — stop and raise it.

---

## 8. Renderer

### 8.1 `LaunchDialog.vue`

- `onMounted`'s `Promise.all` already fetches the launch context; the profiles and the last-used id **ride in on it** — no fifth call.
- `selectedProfileId` initialises from `ctx.lastLaunchProfileId`. Selecting a profile prefills `selected` (agent), `mode` (workspace mode), the auth choice, and **3a-4's effort control**; **the user may override anything.** Selecting nothing is first-class: **a dialog with no saved profiles must behave exactly as it does today** (the 3-6 discipline).
- **3a-4's missing-model warning still fires.** Its ruling — *"the same warning appears in the launch dialog next to the resolved model, so the user meets it before spending a launch"* — now applies to the model **resolved through the profile** (rank 1 → rank 2). Point it at the resolved value; do not build a second warning, and **do not block the launch**: a catalog miss never gates, clears, or substitutes.
- **3a-4's absent-not-disabled rule for the effort control is unchanged.** If the selected adapter declares `reasoningEffort === null`, the control does not render — even when the chosen profile carries an `effort` value. The stored value is simply not offered, never greyed out.
- **Render disabled profiles, do not filter them.** Copying 3-6's `eligibleProfiles.filter(...)` is the likely implementation and it is wrong here: bind `:disabled="p.disabled_reason !== null"` and render the reason.
- **`submit()` keeps its fresh-literal-of-primitives payload (D14).** Add `launch_profile_id: selectedProfileId.value` as a **string primitive** — never spread a profile object, and never pass anything store-sourced. A Pinia object is a Vue reactive **Proxy** and structured clone rejects it with **no compile-time signal**; if a nested value ever becomes necessary, snapshot with `JSON.parse(JSON.stringify(x))` and runtime-verify.
- **"Save as launch profile"** after a successful launch: prefilled with `defaultProfileLabel(...)`, editable, one `launch-profile:create` call. Duplicate label → the authored inline refusal.

### 8.2 `TerminalPane.vue`

A **Relaunch** button beside **Restart**, rendered only when `pane.status !== 'running'` and the session is credentialed. `onRelaunch()` mirrors `onRestart()`'s shape (`store.setBusy` → invoke → `paneMessage` on `{ok:false}` → `terminal?.reset()` + `store.attached(...)` + buffer write on success) and **does not** kill first — a relaunch target is already exited by construction.

**Both buttons stay.** Restart's refusal on a credentialed session is not a wart to be hidden; it is what makes the two verbs legible.

---

## 9. Verification — the runtime section

Unit tests are in the task doc. **Everything below can only be established by running the app**, and none of it may be inferred.

### 9.1 The migration, on the real DB

The full three-dump protocol in `Tasks/Task-3a-5.md` §Verification Commands, **rehearsed on a copy first**. `_verify/3a-5/dump-v9.js` is `_verify/3-6/dump-v6.js` with **one mandatory change**: it must **not** `SELECT *` from `credential_profiles`. Select `id, provider_id, label, last_verified_at, unavailable_since` plus `length(encrypted_blob) AS blob_len` — a byte count is not key material and is sufficient evidence a migration did not touch the blob. **Quote the `projects` table in every dump (F20).**

The migration-specific assertions (beyond the standard five): the two known ids carry the sentinel, **every other session row is NULL**, and **`SELECT * FROM settings WHERE key='credentialed_sessions'` returns nothing**.

### 9.2 THE HARD INVARIANT — no unattended boot-time decryption

Both halves, both quoted in the summary.

**Structural (offline):**

```
Select-String -Path src -Include *.ts -Recurse -Pattern "decryptForLaunch|safeStorage"
Select-String -Path src\main\services\sessionManager.ts -Pattern "vault"
Select-String -Path src\main\index.ts -Pattern "vault|decrypt"
```

Expected: decrypt call sites **only** inside `registerIpc` in `src/main/ipc.ts` (three after this task) plus `vault.ts`'s own implementation; **zero** hits in `sessionManager.ts`; `index.ts` showing the vault constructed and handed to `registerIpc` and nothing else.

**Runtime (instrumented cold boot, then reverted):** add one log line at the top of `vault.decryptForLaunch`. Cold-boot with a credentialed `running` row present — **the real DB has one today (`246c087b…`)**. Assert the boot log shows `[restore] credentialed session healed -> exited (no keyless restore): 246c087b-…` and **ZERO** decrypt lines. Click **Relaunch**; assert **exactly one**. **Then revert the instrumentation and prove the revert against the COMMIT DIFF, not the worktree** (Task 2-4 precedent).

**Neither half alone is sufficient.** A grep is defeated by an indirection; a boot log is defeated by a boot that had nothing to decrypt. That is why the runtime half specifies a boot that *did* have something to decrypt and chose not to.

### 9.3 The real launch-and-relaunch drive

Through the **real** dialog, driven over CDP on `--remote-debugging-port=9222` (`_verify/3-6/eval-*.js` are the shapes to copy).

**⚠ The Task 3-4 harness lesson, still binding and still the most common way these drives fail:** *"CDP-driven Vue forms need a microtask tick between `input` and submit-click, or the click lands on a stale `:disabled`."* Dispatch the `input` event, `await new Promise(r => setTimeout(r, 0))`, **then** click. A click that lands on a stale `:disabled` produces a silent no-op that reads exactly like a broken feature.

1. Save `OR/Kimi K3` over the live route with `OR milestone key`, model NULL (so precedence rank 2 supplies `moonshotai/kimi-k3`).
2. Launch from it; the agent answers a short prompt. **⚠ Real money on Matthew's account — one short prompt, expected well under $0.05.**
3. Five-surface check, abbreviated but not skipped: walk the process tree from the electron main PID via `ParentProcessId` (**never name-matching** — ~16 unrelated `claude.exe` live on this machine); **no command line holds the key or any ≥ 8-character substring**; the child's **environment block does** hold it under `OPENROUTER_API_KEY` (`_verify/3-6/read-env.ps1`). **The positive half is not optional** — absence everywhere is also what a completely broken injection looks like.
4. Cold-boot; the session heals; click **Relaunch**; the agent returns on the same row id and answers again.
5. **Rename the profile mid-flight**; confirm the last-used default, `sessions.launch_profile_id` and the live session are all unaffected.
6. Two-project default scoping; both delete guards; the dangling-profile drive; the legacy-sentinel refusal. All specified in the task doc's Verification Commands.

### 9.4 Harness reminders

electron-vite does **not** hot-restart main — every main-process change needs a real cold boot. Kill process **trees** (`taskkill /PID <root> /T /F`); the graceful-quit test is `taskkill` **without** `/F`. **The `sqlite3` CLI is NOT installed** — use the `ELECTRON_RUN_AS_NODE` script pattern; **known flake: no file on the first invocation, retry once.**

---

## 10. Grep gates for the commit boundary

| Gate | Expected |
|---|---|
| `credentialed_sessions` over `src/` | **empty** |
| `markSessionCredentialed` / `unmarkSessionCredentialed` / `writeCredentialedSessionIds` over `src/` | **empty** |
| `vault` over `src/main/services/sessionManager.ts` | **empty** |
| `decryptForLaunch` over `src/` | 3 call sites, all in `registerIpc`, + `vault.ts`'s implementation |
| `ipcMain.handle(` over `src/main/ipc.ts` | **36** |
| `REFERENCES` in the v9 migration entry | exactly **2**, both on `launch_profiles` |
| `agentKindSchema` | still `'claude' \| 'codex'` |
| `startApiSession` | still unimplemented |
| a second effort enum / union / literal set over `src/` | **none** — 3a-4's `effortLevelSchema` is imported |
| `src/main/adapters/` diff for this commit | **empty** — no adapter file changes |
| `UPDATE launch_profiles` outside the `launch-profile:update` handler | **none** — the route default is resolved, never back-written (3a-4 §1) |
| `.vue` files touched | exactly the three in Exact Scope |
| `TASK-3-5-REVIEW-FABLE.md`, `TASK-3-6-REVIEW-FABLE.md` | present, unmodified, **unstaged** |
