import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { basename } from 'path'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lte, max, sum } from 'drizzle-orm'
import * as schema from '../db/schema'
import { agentTurns, attentionSpans, councilMembers, councilMessages, councilRuns, credentialProfiles, dispatches, launchProfiles, modelCatalog, modelShortlist, paneLayouts, projectMemory, projects, providerConfigs, sessions, settings, worktrees } from '../db/schema'
import { logger } from './logger'
import type { AgentTurnRow, AttentionSpanRow, CouncilMemberRow, CouncilMessageRow, CouncilRunRow, CredentialProfileRow, DispatchRow, LaunchProfileRow, ModelCatalogRow, ModelShortlistRow, NewAgentTurnRow, NewAttentionSpanRow, NewCouncilMemberRow, NewCouncilMessageRow, NewCouncilRunRow, NewCredentialProfileRow, NewDispatchRow, NewLaunchProfileRow, NewProjectMemoryRow, NewProviderConfigRow, NewSessionRow, NewWorktreeRow, ProjectMemoryRow, ProviderConfigRow, SessionRow, WorktreeRow } from '../db/schema'
import type { CatalogDiff } from './modelCatalogCore'
import { sessionIsCredentialed } from './launchProfiles'
import {
  attentionClassSchema,
  layoutJsonSchema,
  legacyFlatLayoutSchema,
  PROJECT_STATUSES,
  type AgentKind,
  type ProjectStatus,
  type SessionStatus,
  type TuckedProjectStatus,
  type ViewState
} from '../../shared/ipc'
import { convertLegacyFlatLayout, normalizeTree, type LayoutJson } from '../../shared/layout'
import { defaultProjectColor } from '../../shared/projectColors'

/**
 * The status vocabulary is the SHARED one (`shared/ipc.ts`), not a second copy
 * beside the table — the column has no CHECK constraint by design (D120), so
 * the Zod enum on the boundary is the only authority there is, and a duplicate
 * here would be a second one that drifts.
 *
 * What the three MEAN is a storage-layer fact, and it is about running work
 * rather than about what is shown:
 *  - `active`   — in the rail, launchable, restored at boot.
 *  - `hidden`   — COSMETIC. Out of the main rail list; sessions keep running
 *                 and still restore at boot; instantly reversible.
 *  - `archived` — RETIRED. Live sessions are stopped, the project is skipped at
 *                 boot restore and cannot be launched into or councilled — but
 *                 every session row, council run, transcript and attention span
 *                 is kept and readable.
 *
 * Deleting is not a status: it is the removal of the row (`deleteProject`).
 */
export type { ProjectStatus }

export interface ProjectRecord {
  id: string
  name: string
  rootPath: string
  /** The user's chosen spine colour as `#RRGGBB`, or null when they have never
   *  chosen one — the rail then falls back to its index cycle (migration v13). */
  color: string | null
  /** Free-text notes, ≤1000 chars (enforced on the IPC boundary). Null when
   *  never written; the rail never renders this, the settings screen does. */
  description: string | null
  /** v15. Never null — every row has one from the moment the column exists. */
  status: ProjectStatus
  /**
   * v15. The rail's position, and MAIN-SIDE ONLY: it is deliberately absent
   * from the wire shape (`toWireProject`). Main returns the list already
   * ordered and the renderer sends the order it wants; shipping the number
   * would create a second authority on position, and the two would disagree the
   * first time a reorder raced a list refresh.
   */
  sortOrder: number
  /** v15. What the pre-v13 colour cycle indexes on — fixed at migration time
   *  and never moved, so filtering or reordering the rail cannot repaint a
   *  legacy project. Crosses the wire; `sortOrder` does not. */
  colorSeed: number
}

/** The projects-table row -> the internal record. Explicit rather than a
 *  spread, the same discipline `toWireProject` follows: a future migration's
 *  new column must be admitted deliberately, not by accident. */
function toProjectRecord(row: typeof projects.$inferSelect): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.rootPath,
    color: row.color,
    description: row.description,
    // The column is NOT NULL, but its vocabulary is enforced on the IPC
    // boundary rather than by a CHECK (D120), so a hand-edited database can
    // hold anything. Reading an unknown value as `active` is the FAIL-SAFE
    // direction: the alternative is a project that is invisible in the rail
    // and cannot be un-hidden, because the only control that could un-hide it
    // is the one that never renders.
    status: isProjectStatus(row.status) ? row.status : 'active',
    sortOrder: row.sortOrder,
    colorSeed: row.colorSeed
  }
}

function isProjectStatus(v: string): v is ProjectStatus {
  return (PROJECT_STATUSES as readonly string[]).includes(v)
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * `council_runs.status` (v11) is unconstrained TEXT — no CHECK constraint,
 * matching `auth_mode`, `role` and every other status column in this schema —
 * so the vocabulary lives beside the table that persists it rather than in a
 * second home.
 *
 * ⚠ ONLY THE TWO THE BOOT HEAL NEEDS ARE DEFINED HERE (D66(d)). The rest of the
 * vocabulary arrives with the run lifecycle's only writer, `councilService.ts`,
 * beside these two. Defining terminal states before anything can reach them
 * would be a vocabulary nobody could check against a behaviour.
 */
export const COUNCIL_RUN_RUNNING = 'running'
/** What a crash leaves behind, once the boot heal has named it. Mirrors the
 *  dispatch heal's `abandoned` outcome deliberately: same fact, same word. */
export const COUNCIL_RUN_ABANDONED = 'abandoned'
/** The three terminal states `councilService.ts` writes, added with the run
 *  lifecycle's only writer (Task 3b-3) beside the two the boot heal needed. */
export const COUNCIL_RUN_COMPLETE = 'complete'
export const COUNCIL_RUN_FAILED = 'failed'
export const COUNCIL_RUN_CANCELLED = 'cancelled'

/** The closed vocabulary, so a reader has something to check a value against —
 *  the column itself is unconstrained TEXT and cannot. */
export const COUNCIL_RUN_STATUSES: readonly string[] = [
  COUNCIL_RUN_RUNNING,
  COUNCIL_RUN_ABANDONED,
  COUNCIL_RUN_COMPLETE,
  COUNCIL_RUN_FAILED,
  COUNCIL_RUN_CANCELLED
]

/**
 * What `council_messages` actually holds for one run — the Docket's only honest
 * source of size (Task: the Docket).
 *
 * ⚠ `council_runs.tokens_in` / `tokens_out` ARE DEAD COLUMNS. F42 measured them
 * NULL on every row ever written; the writer never sets them. Reading them would
 * return "no tokens" for a run that burned two hundred thousand, so the totals
 * are summed from the messages instead.
 */
export interface CouncilRunStats {
  /** Rows stored for the run. The denominator for everything else here (D55). */
  turns: number
  /**
   * ⚠ NULL MEANS "NOT ONE TURN REPORTED TOKENS", WHICH IS NOT ZERO. `persistTurn`
   * writes null rather than 0 when a provider returns no usage, so SUM() over an
   * all-null column is null and must survive as null all the way to the view —
   * D76's omit-rather-than-stub, enforced at the source instead of apologised for
   * three layers up.
   */
  tokensIn: number | null
  tokensOut: number | null
  /** How many of `turns` carried a usage figure at all, so a partial total can be
   *  rendered with its denominator rather than as a whole one (D55). */
  turnsWithTokens: number
}

/**
 * Numbered migrations, applied in order inside a transaction. Table names
 * follow the master data model (docs/PLAN.md §13); columns arrive as the
 * features that need them do.
 *
 * The migration ENGINE stays hand-rolled (D7 scope cut): Drizzle provides
 * schema types + typed queries only. Version 2's DDL matches
 * src/main/db/schema.ts column names/types exactly.
 */
const MIGRATIONS: string[] = [
  `CREATE TABLE projects (
     id         TEXT PRIMARY KEY,
     name       TEXT NOT NULL,
     root_path  TEXT NOT NULL UNIQUE,
     created_at TEXT NOT NULL
   );
   CREATE TABLE pane_layouts (
     project_id  TEXT PRIMARY KEY REFERENCES projects(id),
     layout_json TEXT NOT NULL
   );
   CREATE TABLE settings (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS sessions (
     id          TEXT PRIMARY KEY,
     project_id  TEXT NOT NULL REFERENCES projects(id),
     agent       TEXT NOT NULL,
     cwd         TEXT NOT NULL,
     status      TEXT NOT NULL,
     exit_code   INTEGER,
     created_at  TEXT NOT NULL
   );`,
  // v3 (D19): nullable title, applied in place — existing rows back-fill to
  // NULL. Matches schema.ts's `title: text('title')` exactly (TEXT, nullable).
  `ALTER TABLE sessions ADD COLUMN title TEXT;`,
  // v4 (Phase 2 / D26 action 1): worktrees table + sessions.worktree_id.
  // Both statements apply atomically in the runner's transaction. DDL matches
  // schema.ts's worktrees table + worktreeId column exactly. REFERENCES here
  // is ENFORCED (better-sqlite3 v12 defaults PRAGMA foreign_keys=ON): inserts
  // must reference existing project/session rows; deletes of referenced
  // sessions throw until 2-3's detach-first flow runs.
  `CREATE TABLE worktrees (
     id          TEXT PRIMARY KEY,
     project_id  TEXT NOT NULL REFERENCES projects(id),
     session_id  TEXT REFERENCES sessions(id),
     path        TEXT NOT NULL UNIQUE,
     branch      TEXT NOT NULL,
     base_branch TEXT NOT NULL,
     repo_root   TEXT NOT NULL,
     status      TEXT NOT NULL,
     created_at  TEXT NOT NULL
   );
   ALTER TABLE sessions ADD COLUMN worktree_id TEXT;`,
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
   );`,
  // v6 (Phase 3 / D48): the ROUTE carries its own default model. Nullable —
  // a subscription route has no model to name; existing rows read NULL. Same
  // shape as v3's `ALTER TABLE sessions ADD COLUMN title TEXT;`. Matches
  // schema.ts's `model: text('model')` exactly.
  `ALTER TABLE provider_configs ADD COLUMN model TEXT;`,
  // v7 (Phase 3a / Task 3a-1): the dispatch telemetry spine — Mission Control
  // spec §5.2 + §9 Phase 0. Historical actuals CANNOT be backfilled, which is
  // why this lands before any UI in this phase (D50).
  //
  // ⚠ NO `REFERENCES` CLAUSE ANYWHERE, AND THAT IS DELIBERATE. FKs are ENFORCED
  // on this database (F16). A dispatch outlives its session by design: pane
  // close DELETES the sessions row (D16 resolution d), and a restored session
  // is a genuinely FRESH conversation under the same id (Phase 8 open question
  // 1). A REFERENCES sessions(id) would default to RESTRICT and make the very
  // next pane close throw inside session:delete — a telemetry table that can
  // break a shipped user flow. session_id/project_id are OPAQUE STRINGS here.
  //
  // ⚠ tokens_*/cost_usd are declared now and written NULL by this task. Their
  // producer is Task 3a-3 (per-dispatch OpenRouter keys, D42). They live on
  // THIS row rather than in a separate `usage_records` table because they
  // describe the same run the wall-clock columns describe — one home, not two
  // (D48). The roadmap's `usage_records` name is superseded by this table.
  //
  // ⚠ attention_spans is created here and left EMPTY. Task 3a-2 is its only
  // writer. It exists in v7 so this phase's schema churn stays in ONE
  // migration rather than two.
  `CREATE TABLE dispatches (
     id            TEXT PRIMARY KEY,
     session_id    TEXT,
     project_id    TEXT,
     task_id       TEXT,
     agent         TEXT NOT NULL,
     model         TEXT,
     provider_name TEXT,
     auth_mode     TEXT NOT NULL,
     cwd           TEXT NOT NULL,
     started_at    TEXT NOT NULL,
     ended_at      TEXT,
     outcome       TEXT,
     closed_by     TEXT,
     exit_code     INTEGER,
     tokens_in     INTEGER,
     tokens_out    INTEGER,
     tokens_cached INTEGER,
     cost_usd      REAL
   );
   CREATE INDEX dispatches_open ON dispatches (outcome, session_id);
   CREATE TABLE attention_spans (
     id          TEXT PRIMARY KEY,
     dispatch_id TEXT,
     session_id  TEXT,
     project_id  TEXT,
     started_at  TEXT NOT NULL,
     ended_at    TEXT NOT NULL,
     seconds     INTEGER NOT NULL,
     class       TEXT NOT NULL,
     tick_seconds INTEGER NOT NULL,
     source      TEXT NOT NULL,
     created_at  TEXT NOT NULL
   );`,
  // v8 (Phase 3a / Task 3a-3, D42): the MINT LEDGER, added to 3a-1's
  // `dispatches` table rather than to a table of its own. A mint belongs to a
  // dispatch one-to-one; a second table would need a join, an enforced FK
  // (F16), and a duplicate orphan story — D48's anti-goal, and the easiest
  // moment in the phase to violate it. Same ALTER-in-place shape as v3
  // (sessions.title) and v6 (provider_configs.model): existing rows keep every
  // byte they had.
  //
  // ⚠ FIVE COLUMNS ARE NULLABLE AND ONE IS NOT, and the difference is
  // load-bearing rather than stylistic:
  //  - `revoked_at IS NULL` IS the definition of "this ledger row is OPEN" —
  //    the single predicate boot reconciliation queries. A default would make
  //    every pre-existing row look like an open, unrevoked mint.
  //  - `attribution_state` is NOT NULL DEFAULT 'none' because a row whose
  //    attribution state is unknown is a row nobody can reason about later,
  //    and 'none' is EXACTLY TRUE of every pre-v8 row: no attribution was
  //    attempted for any of them.
  //
  // The minted key itself is NEVER stored — not here, not in the vault, not
  // anywhere on disk. `minted_key_hash` is an identifier that cannot
  // authenticate (and is what the analytics api_key_id filter wants).
  `ALTER TABLE dispatches ADD COLUMN minted_key_hash TEXT;
   ALTER TABLE dispatches ADD COLUMN minted_key_limit REAL;
   ALTER TABLE dispatches ADD COLUMN minted_at TEXT;
   ALTER TABLE dispatches ADD COLUMN revoked_at TEXT;
   ALTER TABLE dispatches ADD COLUMN attribution_state TEXT NOT NULL DEFAULT 'none';
   ALTER TABLE dispatches ADD COLUMN tokens_source TEXT;
   CREATE INDEX dispatches_open_ledger ON dispatches (revoked_at, minted_key_hash);`,
  // v9 (Phase 3a / Task 3a-4): the model catalog — a CACHE of what a route
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
   );`,
  // v10 (Phase 3a / D43 + D49 + D53): launch_profiles — the (agent x route x
  // model) triple with an IMMUTABLE id and a RENAMEABLE label — plus the
  // per-session pointer that RETIRES Task 3-6's global `credentialed_sessions`
  // settings list. Four deliberate shapes:
  //
  //   1. ⚠ REFERENCES ON provider_id / credential_profile_id ARE ENFORCED
  //      (F16) AND INTENDED — the deliberate INVERSE of v7's `dispatches` and
  //      v9's `model_catalog`, both of which carry none. The difference is what
  //      the row IS:
  //
  //        dispatches / model_catalog | launch_profiles
  //        a historical FACT / cache  | a live INSTRUCTION
  //        still true if its subject   | A LIE once its subject is gone —
  //        is deleted                  | it cannot reproduce anything
  //        tolerate dangling           | RESTRICT, and refuse the delete
  //
  //      RESTRICT is correct here PRECISELY BECAUSE it forces the refusal to be
  //      authored in main: countLaunchProfilesForProvider /
  //      countLaunchProfilesForCredential run BEFORE the delete statement, so a
  //      user sees a sentence somebody wrote rather than a reverse-engineered
  //      SQLITE_CONSTRAINT_FOREIGNKEY (the failure Task 2-3 already paid for).
  //
  //   2. sessions.launch_profile_id carries NO REFERENCES — a SOFT pointer. A
  //      session row is history like a dispatch, and sessions are deleted on
  //      pane close (D16 resolution d); a FK here would make deleting a profile
  //      throw for every session that ever used it. Its dangling case is
  //      absorbed by the FAIL-SAFE predicate in launchProfiles.ts, which reads
  //      an unresolvable pointer as "credentialed" — because Chorus cannot
  //      PROVE such a session was keyless, and the only safe reading of "cannot
  //      prove" is "do not restore it keyless" (F26's failure shape).
  //
  //   3. UNIQUE(label): the label IS the picker, so duplicates are unusable.
  //      Checked in main before the insert; the constraint is the backstop.
  //
  //   4. ⚠ THE DATA MIGRATION SHIPS IN THE SAME ENTRY AS THE DDL, deliberately.
  //      Two versions would leave a window in which the settings row and the
  //      new column both exist and disagree. The runner applies each entry in
  //      ONE transaction (the v4 precedent: several statements, one entry).
  //
  // ⚠ THE DATA MIGRATION IS JSON1-FREE, AND THAT IS A CHOICE.
  // `WHERE id IN (SELECT value FROM json_each(...))` is more obviously correct
  // and is rejected anyway: it depends on the JSON1 extension being compiled
  // into the shipped better-sqlite3 build, and json_each on a MALFORMED value
  // THROWS — inside the runner's transaction, at boot, which fails the boot
  // outright. The LIKE form degrades to a no-op on any input it cannot
  // understand, which is the correct failure mode for a migration that runs
  // before the app is usable. COALESCE(..., '[]') makes it a no-op on a machine
  // that never had the row (a fresh install). The pattern matches the id WITH
  // its surrounding JSON quotes, so a partial-uuid collision is impossible, and
  // a uuid contains no LIKE wildcard (`%` or `_`) so no id can match another.
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
   DELETE FROM settings WHERE key = 'credentialed_sessions';`,
  // v11 (Phase 3b / Task 3b-2, D62): the council's three tables — WHO its
  // members are, WHAT a run was, and WHAT WAS SAID. ONE atomic entry: the
  // runner applies each entry inside a transaction, so splitting these into
  // three versions would let a partial failure leave the schema half-built with
  // schema_migrations disagreeing about what exists.
  //
  // ⚠ 1. THE MEMBER STORES NO `base_url` AND NO `provider_id`, AND THAT IS THE
  //      WHOLE RULING. The roadmap's own Phase 3b line still describes a member
  //      as "credential profile + base URL + model id + role + params"; that
  //      phrasing PREDATES D48 and D56 and is superseded. `provider_configs`
  //      is the route's ONE home (D48) and `credential_profiles.provider_id`
  //      already points a credential at its route — so a `base_url` column here
  //      would rebuild, in a new table, precisely the second home D48 exists to
  //      prevent. There is no `provider_id` either: unlike `launch_profiles`,
  //      which needs both because D33 clause 9 makes a route-WITHOUT-credential
  //      first class, A COUNCIL MEMBER ALWAYS AUTHENTICATES. Storing both
  //      columns would create a class of row where they can disagree, and
  //      nothing would ever notice.
  //
  // ⚠ 2. THE FK RULING SPLITS THREE WAYS IN ONE MIGRATION, deliberately (D62).
  //      FKs are ENFORCED here (F16), so each choice has teeth:
  //
  //        council_members            | council_runs / council_messages
  //        a live INSTRUCTION         | a historical FACT
  //        real REFERENCES, RESTRICT  | NO REFERENCES AT ALL — soft pointers
  //        a member naming a deleted  | a transcript stays TRUE after its
  //        credential is a lie        | member is deleted
  //
  //      This is v10's `launch_profiles` ruling and v7/v9's `dispatches` /
  //      `model_catalog` ruling, reached in the same entry for different rows.
  //      Inverting either direction produces a distinct bug that surfaces
  //      identically as SQLITE_CONSTRAINT_FOREIGNKEY: put a FK on the message
  //      and deleting a member throws for every run it ever joined; drop the FK
  //      on the member and a member can outlive the credential it names.
  //
  //      RESTRICT is correct on the member PRECISELY BECAUSE it forces the
  //      refusal to be AUTHORED — countCouncilMembersForCredential runs BEFORE
  //      the delete statement, so the user reads a sentence somebody wrote
  //      rather than a reverse-engineered constraint error (the failure Task
  //      2-3 already paid for). The FK's job is to make the refusal MANDATORY,
  //      not to be the refusal.
  //
  //      Because SQLite will not cascade a soft pointer, deleteCouncilRun
  //      purges its own council_messages explicitly, in one transaction — the
  //      deleteProviderConfig -> model_catalog precedent.
  //
  // ⚠ 3. `model` IS NULLABLE AND RESOLVES BY D56, NEVER BACK-WRITTEN. Rank 1
  //      council_members.model (the choice for THIS member) > rank 2 the
  //      route's provider_configs.model (v6/D48) > rank 3 nothing emitted.
  //      Copying rank 2 into rank 1 is exactly how a second home gets created
  //      by accident, so nothing in this task issues an UPDATE that does it.
  //
  // ⚠ 4. NO `CHECK` ON `role`, and none on `params_json` either. The role
  //      vocabulary is validated by councilRoleSchema in MAIN, matching how
  //      `auth_mode` and `status` are handled everywhere else — a CHECK would
  //      put the vocabulary in two places and make widening it a MIGRATION.
  //
  // ⚠ 5. council_runs' four mint columns MIRROR v8's ledger exactly, including
  //      that `revoked_at IS NULL` IS the definition of an open ledger row —
  //      the predicate boot reconciliation queries, which is why it is nullable
  //      rather than defaulted. THE MINTED KEY ITSELF IS NEVER STORED;
  //      minted_key_hash is an identifier that cannot authenticate. D64(2)
  //      bounds a run to ONE minted key; Task 3b-3 is what mints it.
  //
  // ⚠ 6. council_messages.member_id IS NULLABLE — the synthesis and any
  //      orchestrator-authored framing have no member. `round` and `phase` are
  //      NOT NULL because a transcript row whose position in the deliberation
  //      is unknown cannot be rendered or reasoned about later, and there is no
  //      honest default for either.
  //
  // ⚠ THERE IS NO DATA MIGRATION. All three tables are created EMPTY, and
  // council_runs / council_messages get their FIRST WRITER in Task 3b-3 — the
  // `attention_spans` precedent (v7), where a table shipped one task before its
  // consumer so the phase's schema churn stays in ONE migration rather than
  // two. Nothing existing is read or rewritten here.
  `CREATE TABLE council_members (
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
   CREATE INDEX council_messages_run ON council_messages (run_id, round);`,
  // v12 (Phase 3d / Task 3d-2, D85): the user's model SHORTLIST. OpenRouter
  // alone returns ~340 models (measured on this machine, 2026-07-27); a launch
  // picker built on that number is not a picker. This records which handful the
  // user actually intends to use, per route.
  //
  // ⚠ A NEW TABLE RATHER THAN A COLUMN ON `model_catalog`, AND THE DISTINCTION
  // IS THE POINT. v9's catalog is a CACHE — written ONLY by `applyCatalogDiff`,
  // and D56 makes it explicitly never an authority over which model a launch
  // uses. This table holds the opposite kind of fact: USER INTENT, written only
  // by a click, which no refresh may ever touch. A `favourite` column on a cache
  // row would make one table mean two things, and the first person to tidy the
  // cache with a DELETE would destroy a curation built by hand.
  //
  // ⚠ AND NO FOREIGN KEY ONTO `model_catalog`, DELIBERATELY. A user must be able
  // to shortlist an id the catalog has never returned — the same freedom D48 and
  // D56 protect by keeping the route's default model a FREE-TEXT input with a
  // <datalist> attached rather than a closed <select>. A shortlist constrained
  // to ids a refresh happened to see would make the catalog authoritative BY
  // SCHEMA, which is precisely what those decisions exist to prevent. So a
  // shortlisted id survives the model going missing, survives the catalog being
  // emptied, and survives never having been in it at all.
  //
  // No REFERENCES to provider_configs either — v9's own reason: FKs are ENFORCED
  // (F16) and RESTRICT would make provider:delete throw. deleteProviderConfig
  // purges this table explicitly, in the same transaction it already purges
  // model_catalog in.
  `CREATE TABLE model_shortlist (
     provider_id TEXT NOT NULL,
     model_id    TEXT NOT NULL,
     added_at    TEXT NOT NULL,
     PRIMARY KEY (provider_id, model_id)
   );`,
  // v13: project IDENTITY — the name a project already had, plus the two facts
  // the rail and its settings screen need it to carry.
  //
  // ⚠ BOTH NULLABLE, AND `color` NULLABLE IS THE LOAD-BEARING PART. Until now
  // the rail derived a project's spine colour from its LIST INDEX, which meant
  // the colour was never stored anywhere and every existing row would have to
  // be back-filled to keep looking the way it looks today. NULL is read by the
  // rail as "no choice has been made — keep cycling the index", so pre-v13
  // projects render EXACTLY as they did before this migration, and a row gets a
  // stored colour the moment someone picks one (or the moment it is created,
  // which from here on assigns one).
  //
  // `description` is renderer-facing prose, capped at 1000 chars ON THE IPC
  // BOUNDARY rather than by a CHECK constraint: a length the user can hit by
  // typing belongs where it can be reported back to them as a counter, not
  // where it surfaces as a failed write.
  `ALTER TABLE projects ADD COLUMN color TEXT;
   ALTER TABLE projects ADD COLUMN description TEXT;`,
  // v14: session IDENTITY — the name a person gives an agent, and a one-line
  // note about what it is working on. Both arrive from the launch dialog.
  //
  // ⚠ TWO NEW COLUMNS RATHER THAN A SECOND MEANING FOR `title`, and that is the
  // load-bearing decision. `sessions.title` (v3/D19) is CAPTURED: the agent's
  // own OSC 0/2 stream writes it, live, and keeps writing it — session:set-title
  // is explicitly "the ONE title write path". A name typed by a human into that
  // same column would survive exactly until the TUI printed its next title, and
  // the loss would look like a bug in the naming feature rather than what it is.
  // Authored facts and captured facts do not share a column.
  //
  // ⚠ BOTH NULLABLE, and null is a first-class answer, not a back-fill waiting
  // to happen. Every session that exists today has neither, and nothing here
  // invents one for them: an unnamed row renders exactly as it did before this
  // migration (the v13 `color` ruling, in its own shape). Naming stays optional
  // afterwards too — the dialog SUGGESTS a name and the user may clear it.
  //
  // The 40/50-character caps live on the IPC boundary (AGENT_NAME_MAX /
  // AGENT_DESCRIPTION_MAX), not in a CHECK constraint: v13 settled that a limit
  // the user can reach by typing belongs where it can be shown as a counter.
  `ALTER TABLE sessions ADD COLUMN name TEXT;
   ALTER TABLE sessions ADD COLUMN description TEXT;`,
  // v15 (Phase 3h / D120): project LIFECYCLE and project ORDER — the three
  // facts the rail has never carried. `status` is how retired a project is,
  // `sort_order` is where it sits, `color_seed` is what colour it draws.
  //
  // ⚠ ALL THREE `NOT NULL DEFAULT`, WHICH DELIBERATELY INVERTS v13's NULLABLE
  // RULING, and the inversion is the decision rather than an inconsistency.
  // v13's `color` is nullable because NULL *means something there*: "no choice
  // has been made — keep cycling the index" (see :553–560 above). NONE OF THESE
  // THREE HAS SUCH A MEANING. Every project has a status, a position and a seed
  // from the instant the column exists; there is no "unspecified position" a
  // renderer could act on, and a nullable one would only invite three read sites
  // to invent three different defaults for it.
  //
  // ⚠ NO `CHECK` ON `status`. The Zod enum on the IPC boundary is the authority
  // — the `sessions.status` / `worktrees.status` / `auth_mode` convention, and
  // v13's own reason: a limit belongs where it can be reported, not where it
  // surfaces as a failed write.
  //
  // ⚠ NO `UNIQUE` ON `sort_order`, and that is a correctness requirement rather
  // than laxity. A reorder rewrites N rows and passes through TRANSIENT
  // DUPLICATES inside its own transaction; SQLite unique indexes are not
  // deferrable, so a UNIQUE here would make the natural implementation throw
  // halfway and the workaround (renumber to a scratch range first) would double
  // the writes to buy nothing.
  //
  // The back-fill reproduces TODAY'S order exactly — `listProjects` has ordered
  // by `created_at ASC` since Task 1-5 — so position 0 is the project that has
  // always been drawn first, and `color_seed = sort_order` hands every pre-v13
  // row the very index the rail was cycling on its behalf. That is what makes
  // this migration invisible.
  //
  // ⚠ THE HONEST CAVEAT, AND IT IS NOT HYPOTHETICAL ENOUGH TO OMIT.
  // `created_at` is an ISO string written by `new Date().toISOString()` (:638),
  // so it has millisecond resolution and ORDERING IS UNSPECIFIED FOR TWO ROWS
  // WRITTEN IN THE SAME MILLISECOND — SQLite is free to return such a pair in
  // either order, and has never been asked to be consistent about it. The
  // back-fill breaks that tie on `id ASC` so the answer is stable from here on,
  // but on a database that holds such a pair the tie may be broken the OTHER way
  // from however the rail happened to render it last. On such a database ONE
  // PROJECT'S CHIP CAN CHANGE COLOUR ONCE, at migration time, and never again.
  // Do not read this migration as "nothing changes visually" unconditionally; it
  // is "nothing changes visually except a same-millisecond tie, once".
  `ALTER TABLE projects ADD COLUMN status     TEXT    NOT NULL DEFAULT 'active';
   ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE projects ADD COLUMN color_seed INTEGER NOT NULL DEFAULT 0;
   UPDATE projects SET sort_order = (SELECT COUNT(*) FROM projects p2
     WHERE p2.created_at < projects.created_at
        OR (p2.created_at = projects.created_at AND p2.id < projects.id));
   UPDATE projects SET color_seed = sort_order;
   CREATE INDEX projects_sort ON projects (sort_order);`,
  // v16 (Phase 6 / Task 6-3): per-project memory configuration — where a
  // project's Neo4j is, and nothing else. The DDL below is Phase-6-MemoryPlan
  // §6's, taken verbatim on content.
  //
  // ⚠ A SEPARATE TABLE RATHER THAN FOUR COLUMNS ON `projects` (which Plan.md
  // §13 prescribed) — the D85 precedent, where `model_shortlist` was split off
  // `model_catalog` because "a `favourite` column on a cache row would make one
  // table mean two things". Here the argument is stronger: `mode` and
  // `bolt_uri` are DURABLE USER INTENT, while `container_id` and the ports are
  // OBSERVED RUNTIME FACTS about a resource that vanishes behind the app's back
  // — and D92 makes that the EXPECTED case, not an error. Different writers,
  // different lifetimes. `projects` is also the app's hottest table, and "turn
  // memory off" should be one DELETE rather than four coordinated NULLs.
  //
  // ⚠ FIVE COLUMNS ARE CREATED FOR A STAGE THAT HAS NOT BEEN WRITTEN, AND THAT
  // IS DELIBERATE RATHER THAN SPECULATIVE. `container_id`, `container_name`,
  // `volume_name`, `bolt_port` and `http_port` belong to STAGE 5 (the Docker
  // provisioner) and STAY NULL for the whole of Task 6-3 — no code path in this
  // task writes one. They are here only because `MIGRATIONS.length` moves
  // EXACTLY ONCE in this phase; a second migration whose entire content was
  // five nullable columns would be churn bought with a version number.
  // `schema_version` stays 0 — Task 6-4 owns it, and the GRAPH is authority on
  // its own version (plan §8); this column is a cache of that answer.
  //
  // ⚠ THERE IS NO PASSWORD COLUMN HERE, IN ANY FORM, AND THERE MUST NEVER BE
  // ONE. A credentialed mode NAMES a credential_profiles row; the secret stays
  // in the DPAPI envelope and is resolved per launch by vault.decryptForLaunch
  // (D93). Note that `bolt_uri` is the one free-text field in this design and a
  // bolt URI can carry inline credentials (`bolt://user:pass@host`) — which is
  // why `memoryConfigCore.validateBoltUri` REFUSES that form on the way in.
  // The column has no password; the validator is what keeps it that way.
  //
  // ⚠ THE `credential_profile_id` FK IS ENFORCED AND, IN THIS PHASE, UNGUARDED.
  // D128(a) took credentialed mode out of Phase 6 entirely, so this column is
  // ALWAYS NULL here: the FK cannot be violated, and a count-and-refuse guard
  // would be a refusal message nobody could ever read. It was therefore CUT
  // rather than shipped — but the debt is real and this comment is where it
  // lives, because a column with an enforced FK and no counterpart guard is a
  // loaded trap:
  //
  //   ⚠ WHOEVER SHIPS CREDENTIALED MEMORY **MUST** ADD
  //   `countProjectMemoryForCredential` TO `credential:delete`'s EXISTING GUARD
  //   AT `src/main/ipc.ts:1779` — BESIDE its two siblings
  //   (`countLaunchProfilesForCredential`, `countCouncilMembersForCredential`),
  //   NOT as a second guard — and extend that refusal's `parts[]` so it reads
  //   "used by 1 launch profile and 2 memory configurations", BEFORE the first
  //   credentialed row can be written. Without it the first delete of a memory
  //   credential surfaces a raw SQLITE_CONSTRAINT_FOREIGNKEY through a flow
  //   that has worked since Task 3-2 — the defect D62 records and 3a-5 already
  //   paid for once. The FK's job is to make the refusal MANDATORY; the count
  //   is what lets somebody AUTHOR it, and the DISTINCT naming is the point:
  //   "used by 2 things" does not tell a user what to go and delete.
  //
  // ⚠ THE `project_id` FK IS ENFORCED AND ITS GUARD IS NOT DEFERRED — IT SHIPS
  // IN THIS MIGRATION'S OWN TASK. Unlike `credential_profile_id`, this column
  // is NEVER null: every row has a project, so the trap above is LIVE from the
  // first configured project rather than hypothetical. `deleteProject` (D121,
  // Phase 3h) purges nine tables in one transaction and would throw
  // SQLITE_CONSTRAINT_FOREIGNKEY on any project that had memory configured, so
  // `project_memory` is added to that purge in the same commit as this table.
  // Deleting a project's memory CONFIG destroys no graph DATA — the same
  // distinction `memory:disable` draws.
  `CREATE TABLE project_memory (
     project_id            TEXT PRIMARY KEY REFERENCES projects(id),
     mode                  TEXT NOT NULL,           -- 'local-docker' | 'existing' | 'aura'
     bolt_uri              TEXT NOT NULL,
     database_name         TEXT NOT NULL,           -- 'neo4j' — Community has exactly one
     auth_mode             TEXT NOT NULL,           -- 'none' | 'credential'
     credential_profile_id TEXT REFERENCES credential_profiles(id),
     container_id          TEXT,                    -- OBSERVED; reconciled at boot (Stage 5)
     container_name        TEXT,                    -- chorus-neo4j-<slug>, human-readable (D92)
     volume_name           TEXT,                    -- Stage 5
     bolt_port             INTEGER,                 -- Stage 5
     http_port             INTEGER,                 -- Stage 5
     schema_version        INTEGER NOT NULL DEFAULT 0,  -- a CACHE; the graph is authority
     last_seeded_at        TEXT,
     created_at            TEXT NOT NULL,
     updated_at            TEXT NOT NULL
   );`,
  // v17: the AGENT LOCK — one nullable timestamp, and the PIN that guards
  // clearing it (the PIN itself is a `settings` row, so it needs no DDL).
  //
  // ⚠ THIS WAS AUTHORED AS v16 AND RENUMBERED IN THE MERGE THAT BROUGHT
  // `project_memory` IN, AND THE INCIDENT IS WORTH THE FOUR LINES. Both
  // migrations were written as v16 on branches that could not see each other.
  // Every dev worktree is unpackaged, and `setPath('userData', …)` only
  // redirects when `app.isPackaged` — so THEY ALL SHARE ONE DATABASE. The
  // runner keys off `MAX(version)`, so once `project_memory` had run as v16
  // there, this file's v16 was skipped in SILENCE: `schema_migrations` said 16,
  // `locked_at` did not exist, and the first read threw `no such column` out of
  // `getSessionsForProject` during boot restore — a failure that points at a
  // query rather than at a migration.
  //
  // ⚠ SO CHECK `main`'S HIGHEST VERSION BEFORE ADDING ONE, not just this file's
  // `MIGRATIONS.length`. A sibling branch can claim a number you cannot see, and
  // nothing in this repo will tell you until a column goes missing at runtime.
  //
  // ⚠ NULLABLE WITH NO DEFAULT, WHICH IS v14's RULING AND NOT v15's. `locked_at`
  // is the `name`/`description` case exactly: every session that exists today is
  // unlocked, NULL says so truthfully, and there is nothing to back-fill. v15's
  // three columns took `NOT NULL DEFAULT` because a project's status, position
  // and colour-seed each exist from the instant the column does; "the time this
  // was locked" does not exist for a session nobody has locked, and a sentinel
  // date standing in for it would be a lie a read site could not detect.
  //
  // ⚠ AND NULL IS THE UNLOCKED STATE, NOT THE OTHER WAY AROUND, WHICH IS A
  // SAFETY PROPERTY RATHER THAN A COIN FLIP. Every pre-v17 row, every row a
  // future INSERT forgets to mention, and every row a corrupt write blanks all
  // read as UNLOCKED — so the failure mode of this column is "the guard is not
  // there", never "an agent cannot be closed and the user cannot find out why".
  // A lock that jams shut on a database glitch would be a worse bug than the
  // accident it exists to prevent, and it would arrive with no way out of it.
  //
  // NO INDEX. The only queries are by primary key and one per-project scan over
  // rows already being read for other reasons; an index here would cost writes
  // to serve nothing.
  `ALTER TABLE sessions ADD COLUMN locked_at TEXT;`,
  // v18 (Task 8-0): TURN BOUNDARIES — the unit of work `dispatches` could not
  // be. Mission Control spec §9 Phase 0, pulled forward on D50's asymmetric
  // decay argument for the same reason 3a-1 was: this data CANNOT be
  // backfilled, so every day it is not captured is calibration permanently
  // lost.
  //
  // ⚠ THIS NUMBER WAS COMPUTED, NOT COPIED. `MIGRATIONS.length` was 17 at
  // `5e1bd60` and `main`'s highest version comment was v17, so this is v18 —
  // the check the v17 block above demands in its own words, run again here
  // because the v16 collision it describes cost a `no such column` thrown out
  // of `getSessionsForProject` during boot restore.
  //
  // ⚠ WHY A SECOND TABLE RATHER THAN COLUMNS ON `dispatches`. Roadmap F52,
  // measured over 172 real dispatches: only 5 ever reached `completed`, closed
  // ones averaged 74–134 minutes and the longest ran 557, because a dispatch is
  // ONE PTY LIFETIME and an interactive agent pane has no natural completion
  // event — `ended_at - started_at` was measuring how long a terminal was open.
  // `classifyOutcome` is correct; the UNIT was wrong. A dispatch owns MANY
  // turns, so they cannot share a row, and this table ADDS a granularity rather
  // than repairing one. Nothing here writes `dispatches` or `attention_spans`.
  //
  // ⚠ NO `REFERENCES` CLAUSE, THE SAME RULE AND THE SAME REASON AS v7's. FKs
  // are ENFORCED on this database (F16) and pane close DELETES the sessions row
  // (D16 resolution d), so a REFERENCES sessions(id) would default to RESTRICT
  // and make the very next pane close throw inside `session:delete` — a
  // telemetry table breaking a shipped user flow. session_id/project_id are
  // OPAQUE STRINGS.
  //
  // ⚠ NO `dispatch_id`, NO `task_id`, AND THE D55 DENOMINATOR SURVIVES ANYWAY.
  // Resolving session -> dispatch -> task is a READ-TIME JOIN (`attention.ts`,
  // "derived, never stored"): a stored pointer orphans a turn whose dispatch
  // closed first. "Turns exist for N of M dispatches" is still answerable from
  // `session_id` + `started_at` alone, which is what discharges D55's
  // obligation at the SCHEMA level for every future reader:
  //
  //   SELECT COUNT(*) AS m,
  //          SUM(EXISTS (SELECT 1 FROM agent_turns t
  //                       WHERE t.session_id = d.session_id
  //                         AND t.started_at >= d.started_at
  //                         AND (d.ended_at IS NULL OR t.started_at <= d.ended_at))) AS n
  //   FROM dispatches d;
  //
  // ⚠ NO CONTENT COLUMN OF ANY KIND, WHICH IS D130 AND NOT AN OVERSIGHT. The
  // producer consumes `agentEvents.onActivity`'s ALREADY-CLASSIFIED activity
  // and stamps its own timestamp; it parses no hook body, adds no field to
  // `readHookEventName`, and stores no prompt text, transcript path or tool
  // input. There are also no TOOL COUNTS: `record()` is edge-triggered
  // (`agentEvents.ts:169`), so consecutive PreToolUse/PostToolUse events
  // collapse to one 'working' callback and a count is UNOBSERVABLE from this
  // side. Getting one means widening the hook read surface, which is the thing
  // D130 forbids — recorded as a finding, not smuggled in.
  //
  // ⚠ AND NO ROWS AT ALL FOR AGENTS WITHOUT A HOOK BUS (D129). `bindHooks` is
  // Claude-only, so codex/kimi/opencode produce zero turns. They must never be
  // given interpolated or PTY-derived ones — that is a fabricated number
  // wearing a real column.
  //
  // Two indexes, each with a caller: `agent_turns_open` serves the
  // outcome-IS-NULL open lookup that runs on EVERY activity transition (it must
  // be an index hit, because open-turn state is read from the DB rather than
  // held in a Map that could drift from it), and `agent_turns_session` serves
  // the per-session history read.
  `CREATE TABLE agent_turns (
     id          TEXT PRIMARY KEY,
     session_id  TEXT NOT NULL,
     project_id  TEXT,
     agent       TEXT NOT NULL,
     started_at  TEXT NOT NULL,
     ended_at    TEXT,
     outcome     TEXT,
     closed_by   TEXT,
     source      TEXT NOT NULL,
     created_at  TEXT NOT NULL
   );
   CREATE INDEX agent_turns_open    ON agent_turns (outcome, session_id);
   CREATE INDEX agent_turns_session ON agent_turns (session_id, started_at);`,
  // v19 (Phase 4a / D140): the resume pointer. Applied in place; every
  // existing row back-fills to NULL and MEANS it — "this session predates the
  // pointer and starts fresh, once". No backfill from ~/.claude/projects or
  // ~/.codex/sessions: guessing which transcript belonged to which pane would
  // resume the wrong conversation, which is worse than resuming none.
  //
  // ⚠ THIS NUMBER WAS COMPUTED, NOT COPIED (G6, and v17's incident above is
  // why). At `82e16d7` the array parsed to 18 elements on BOTH `main` and
  // `origin/main`, and no sibling ref claims more — the other live branches
  // parse to 18, 17, 15, 15, 12 and 4, and the sibling worktree
  // (`worktree-agent-ac607b24c8ebfc41d`) to 12. So this is v19, and it was
  // proven against a COPY of the dev DB in a throwaway --user-data-dir rather
  // than assumed, because a version claimed elsewhere fails SILENTLY here.
  //
  // ⚠ NULLABLE, NO DEFAULT, NO FK, NO INDEX. Same ruling as v17's `locked_at`
  // and v14's `name`/`description`: every session that exists today has no
  // agent conversation to go back to, NULL says exactly that, and there is
  // nothing to back-fill. No `REFERENCES` because the agent's transcript store
  // is not a table Chorus owns — it is a file under `~/.claude` or `~/.codex`
  // that can vanish without Chorus being told. No index because the only read
  // is by primary key on a row already being fetched for other reasons.
  `ALTER TABLE sessions ADD COLUMN agent_session_id TEXT;`
]

/**
 * SQLite-backed persistence, main process only. Nothing here crosses an IPC
 * boundary unvalidated: layout rows are re-parsed with the shared Zod schema
 * on read, so a hand-edited database cannot feed the renderer bad shapes.
 *
 * Query layer is Drizzle (D7) over the same better-sqlite3 connection that
 * the migration runner uses; Zod .parse() here is allowed (main process, D1).
 */
export class StorageService {
  private db: Database.Database
  private d: BetterSQLite3Database<typeof schema>

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.d = drizzle(this.db, { schema })
    this.migrate()
  }

  /**
   * Find the project for this root path, creating it on first run.
   *
   * ⚠ THIS IS THE RESURRECTION PATH, AND FROM v15 ON IT REACTIVATES LOUDLY.
   * `root_path` is UNIQUE, so re-adding the folder of a project you archived
   * returns the ARCHIVED row rather than making a second one — and returning it
   * untouched would put the user back in front of a project that still refuses
   * to launch, with no visible reason and no control that explains it.
   *
   * Picking a folder in the directory picker is an unambiguous statement of
   * intent, so a hidden or archived row is set back to `active` here and the
   * caller is TOLD which state it came from (`reactivatedFrom`), so the app can
   * say "Unarchived Chorus — it was in your archive" instead of silently
   * changing a lifecycle state behind an "Add project" click.
   *
   * ⚠ REACTIVATING RELAUNCHES NOTHING. Archive stopped this project's PTYs and
   * healed its rows to 'exited'; coming back does not start them again. The
   * user asked for the project, not for four agents.
   *
   * ⚠ AND THE BOOT SEED MUST NOT COME THROUGH HERE — see `getProjectByRootPath`.
   */
  getOrCreateProject(rootPath: string): {
    project: ProjectRecord
    /** The state it came BACK from — never `'active'`, which reports null. */
    reactivatedFrom: TuckedProjectStatus | null
  } {
    const existing = this.d.select().from(projects).where(eq(projects.rootPath, rootPath)).get()
    if (existing) {
      const record = toProjectRecord(existing)
      if (record.status === 'active') return { project: record, reactivatedFrom: null }
      this.d.update(projects).set({ status: 'active' }).where(eq(projects.id, record.id)).run()
      return {
        project: { ...record, status: 'active' },
        reactivatedFrom: record.status
      }
    }

    // v13: a project created from here on gets a stored colour immediately,
    // cycling the palette by how many already exist — which is exactly the
    // rule the rail's old index cycle followed, now written down instead of
    // re-derived on every render. Pre-v13 rows keep `color` NULL and keep
    // rendering from the cycle, so nothing changes for them.
    //
    // ⚠ `sortOrder` COMES FROM `MAX + 1`, NOT FROM THE COUNT, AND THE ASYMMETRY
    // WITH THE TWO LINES BELOW IT IS THE POINT (F46). A count answers "how many
    // are there", which is only the same as "what is the last position" while
    // the positions are dense — and a DELETE makes them sparse. Four projects
    // at 0,1,2,3 minus one leaves 0,1,3; the count is 3; and a new project
    // taking 3 would land ON TOP of an existing one rather than after it. The
    // rail still renders deterministically (`listProjects` tie-breaks on
    // `created_at, id`, and `sort_order` carries no UNIQUE index on purpose),
    // so this was never corruption — it was a new project appearing in the
    // middle of the list instead of at the end, which reads as a bug in the
    // reorder that has not happened yet.
    //
    // ⚠ `colorSeed` AND `defaultProjectColor` DELIBERATELY KEEP THE COUNT.
    // Neither is a position: the seed indexes a THREE-token cycle and the
    // colour a TWELVE-swatch one, so duplicates are ordinary in both and
    // unobservable in the seed's case — a project created from v13 on always
    // carries a stored `color`, and `chipColorValue` only consults the seed
    // when `color` is NULL. Moving them to `MAX + 1` would buy nothing and
    // would change v13's colour-assignment rule as a side effect.
    const n = this.countProjects()
    const project: ProjectRecord = {
      id: randomUUID(),
      name: basename(rootPath),
      rootPath,
      color: defaultProjectColor(n),
      description: null,
      status: 'active',
      sortOrder: this.nextSortOrder(),
      colorSeed: n
    }
    // Task 1-4: NO first-run seed. A new project has no pane_layouts row and
    // no session rows — sessions are created explicitly via the launch flow,
    // and the absent layout row is what shows the empty state. (Existing DBs
    // keep their seeded layout; this only affects DBs created from here on.)
    this.d
      .insert(projects)
      .values({
        id: project.id,
        name: project.name,
        rootPath,
        createdAt: new Date().toISOString(),
        color: project.color,
        description: null,
        status: project.status,
        sortOrder: project.sortOrder,
        colorSeed: project.colorSeed
      })
      .run()
    return { project, reactivatedFrom: null }
  }

  /**
   * Read the project at this root path, or null. NO WRITE, NO REACTIVATION.
   *
   * ⚠ THIS EXISTS FOR THE BOOT SEED, AND IT IS NOT A STYLISTIC ALTERNATIVE TO
   * `getOrCreateProject`. `src/main/index.ts` seeds DEV_WORKING_DIR when no
   * active project resolves; routing that through the reactivating path above
   * would mean archiving your dev project and restarting SILENTLY UN-ARCHIVES
   * IT — the feature failing at the one moment nobody is watching, on the one
   * project its author uses every day.
   */
  getProjectByRootPath(rootPath: string): ProjectRecord | null {
    const row = this.d.select().from(projects).where(eq(projects.rootPath, rootPath)).get()
    return row ? toProjectRecord(row) : null
  }

  /**
   * All projects, in RAIL ORDER.
   *
   * ⚠ `sort_order` REPLACES `created_at ASC` AS THE ORDER, and v15's back-fill
   * is what makes that a no-op on every database that exists today: it numbered
   * the rows in exactly the `created_at` order this used to return. From here
   * on the number is the authority, because creation time cannot express a
   * user's reordering.
   *
   * The two tie-breaks are the back-fill's own rule, restated so a duplicate
   * `sort_order` (which the schema permits, deliberately) can never render in a
   * different order on two consecutive reads. An unstable rail is a rail whose
   * projects swap places when you blink.
   */
  listProjects(): ProjectRecord[] {
    return this.d
      .select()
      .from(projects)
      .orderBy(asc(projects.sortOrder), asc(projects.createdAt), asc(projects.id))
      .all()
      .map(toProjectRecord)
  }

  /** How many projects exist — only ever asked so a new one can be handed the
   *  next colour in the palette cycle. NOT a position: see `nextSortOrder`. */
  private countProjects(): number {
    return this.d.select({ n: count() }).from(projects).get()?.n ?? 0
  }

  /**
   * The position a new project takes: strictly after every project that exists
   * (F46).
   *
   * ⚠ `MAX + 1` RATHER THAN A COUNT, BECAUSE POSITIONS GO SPARSE AND COUNTS DO
   * NOT. `reorderProjects` renumbers densely to 0..n-1, so the two agree right
   * up until someone deletes a project — after which the count is one short of
   * the last position and a new project lands beside an existing one instead of
   * at the end.
   *
   * ⚠ `MAX` OVER AN EMPTY TABLE IS NULL, NOT 0, and that is why the coalesce is
   * to **-1**: the first project on a fresh database must take position 0, and
   * `(null ?? 0) + 1` would silently start the rail at 1. Harmless today and
   * exactly the kind of off-by-one that outlives the person who wrote it.
   */
  private nextSortOrder(): number {
    const row = this.d.select({ m: max(projects.sortOrder) }).from(projects).get()
    return (row?.m ?? -1) + 1
  }

  /**
   * Task: project identity edits from the settings screen — name, colour and
   * description in ONE write, because that screen saves them together and a
   * partial save would leave the rail disagreeing with the form.
   *
   * Every field is required by the caller's schema (the renderer always sends
   * the full current state of the form), so this is a total overwrite rather
   * than a patch — there is no "leave this one alone" case to represent, and
   * inventing one would mean guessing which blank fields were cleared on
   * purpose.
   *
   * Returns the row as it now stands, so the caller reports what was actually
   * written rather than echoing what it asked for.
   */
  updateProject(
    id: string,
    fields: { name: string; color: string; description: string | null }
  ): ProjectRecord | null {
    this.d
      .update(projects)
      .set({ name: fields.name, color: fields.color, description: fields.description })
      .where(eq(projects.id, id))
      .run()
    return this.getProjectById(id)
  }

  /**
   * Move a project between `active`, `hidden` and `archived` (v15 / D120).
   *
   * ⚠ THE ROW WRITE ONLY. Killing PTYs, healing session rows, clearing the
   * restore-pending set and reassigning the active project are the CALLER's,
   * in `project:set-status` — they need the session manager, which storage has
   * no business knowing about. Everything this does is one column.
   */
  setProjectStatus(id: string, status: ProjectStatus): ProjectRecord | null {
    this.d.update(projects).set({ status }).where(eq(projects.id, id)).run()
    return this.getProjectById(id)
  }

  /**
   * Flip every `'running'` row of this project to `'exited'`, and report how
   * many moved.
   *
   * ⚠ NOT REDUNDANT WITH KILLING THE PTYs, AND THE ORDER IS KILL-THEN-HEAL.
   * `SessionManager.kill()` is asynchronous — it requests the kill and lets the
   * existing exit handler write the row. If that exit event never lands (the
   * app quits first, the process is already a zombie), the row stays 'running'
   * and D16's restore contract relaunches it the moment the project is
   * un-archived. An archive that comes back with four agents running is the
   * feature having done nothing.
   */
  healRunningSessionsForProject(projectId: string): number {
    return this.d
      .update(sessions)
      .set({ status: 'exited' })
      .where(and(eq(sessions.projectId, projectId), eq(sessions.status, 'running')))
      .run().changes
  }

  /**
   * The size of what deleting this project would take (D123/D109), read in one
   * place so the confirmation and the delete agree about it.
   *
   * ⚠ `transcriptTurns` IS WHY THIS IS NOT PART OF `project:list`. It scans
   * `council_messages` through this project's `council_runs`; `project:list`
   * runs at boot and on every `store.load()`, and putting that scan on the
   * app's most-travelled read to serve a dialog that opens rarely is the wrong
   * trade in the obvious direction.
   *
   * `liveSessions` is NOT counted here — liveness is the session manager's
   * fact, not the database's, and a row that says 'running' after a crash is
   * exactly the lie this would inherit.
   */
  getProjectImpact(projectId: string): {
    sessions: number
    worktrees: number
    councilRuns: number
    transcriptTurns: number
  } {
    const runIds = this.d
      .select({ id: councilRuns.id })
      .from(councilRuns)
      .where(eq(councilRuns.projectId, projectId))
      .all()
      .map((r) => r.id)
    return {
      sessions:
        this.d
          .select({ n: count() })
          .from(sessions)
          .where(eq(sessions.projectId, projectId))
          .get()?.n ?? 0,
      worktrees:
        this.d
          .select({ n: count() })
          .from(worktrees)
          .where(eq(worktrees.projectId, projectId))
          .get()?.n ?? 0,
      councilRuns: runIds.length,
      transcriptTurns:
        runIds.length === 0
          ? 0
          : (this.d
              .select({ n: count() })
              .from(councilMessages)
              .where(inArray(councilMessages.runId, runIds))
              .get()?.n ?? 0)
    }
  }

  /**
   * Purge one project and everything Chorus wrote about it — ONE transaction,
   * the `deleteProviderConfig` shape scaled up.
   *
   * ⚠ THE ORDER IS LOAD-BEARING AT ONE POINT AND DELIBERATE AT EVERY OTHER.
   *
   *  5 BEFORE 6 IS NOT NEGOTIABLE: `worktrees.session_id` REFERENCES
   *  `sessions.id` (schema.ts:96–100) and foreign keys are ENFORCED on this
   *  database (F16 — better-sqlite3 v12 defaults `PRAGMA foreign_keys=ON`).
   *  Deleting sessions first throws `SQLITE_CONSTRAINT_FOREIGNKEY` on any
   *  project that ever ran an agent in a worktree, and the whole transaction
   *  rolls back.
   *
   *  STEPS 1–4 AND 8 ARE SOFT POINTERS WITH NO CASCADE. `council_runs`,
   *  `council_messages`, `dispatches` and `attention_spans` carry no
   *  `REFERENCES` clause — deliberately, so history survives the session it
   *  describes (v7's own note) — which means SQLite will not clean up a single
   *  one of them. If they are not deleted here they are not deleted anywhere.
   *
   *  ⚠ STEPS 3 AND 4 ARE THE FIRST DELETES `attention_spans` AND `dispatches`
   *  HAVE EVER HAD, and step 8 IS THE FIRST `delete(settings)` IN THE CODEBASE.
   *  That last one matters more than it looks: NOTHING ENUMERATES SETTINGS
   *  KEYS. A per-project key missed here is unreachable forever by any surface
   *  the app has — no screen lists them, no query scans them — so it would sit
   *  in the table naming a project that no longer exists until someone opened
   *  the database by hand. The two keys are `view_state:<id>` and
   *  `last_launch_profile:<id>`; `active_project_id` is step 9 and is deleted
   *  only when it names THIS project.
   *
   * ⚠ NOTHING OUTSIDE THE DATABASE IS TOUCHED (D121). No `fs` call, no git
   * command. The worktree ROWS go (D124: a worktree row cannot outlive its
   * project — `worktrees.project_id` is NOT NULL REFERENCES projects(id) — and
   * the panel is keyed on `project_id`, so a detached row could never be
   * surfaced); the DIRECTORIES AND BRANCHES stay exactly where they are.
   *
   * ⚠ THE CALLER MUST HAVE REFUSED A LIVE PROJECT FIRST. No foreign key catches
   * a running PTY: the rows delete cleanly and the process is orphaned, still
   * holding a pty handle, with nothing left in the database that names it. That
   * is a count-and-refuse in main (`project:delete`), the posture
   * `countCredentialProfilesForProvider` established — never reverse-engineered
   * from a constraint throw.
   *
   * Returns THE ACCUMULATED `changes` — what was actually deleted, not a
   * re-read prediction of what should have been. A soft pointer that silently
   * matched nothing shows up here as a zero.
   */
  deleteProject(
    id: string,
    successorActiveId: string | null
  ): {
    councilMessages: number
    councilRuns: number
    attentionSpans: number
    dispatches: number
    worktrees: number
    sessions: number
    paneLayouts: number
    projectMemory: number
    settings: number
    projects: number
  } {
    return this.d.transaction((tx) => {
      // 1–2. The council history. `council_messages.run_id` is a soft pointer
      // to runs that are themselves soft-pointed at the project, so the run ids
      // are read INSIDE the transaction and the messages go by that list — the
      // `deleteCouncilRun` shape, widened from one run to all of a project's.
      const runIds = tx
        .select({ id: councilRuns.id })
        .from(councilRuns)
        .where(eq(councilRuns.projectId, id))
        .all()
        .map((r) => r.id)
      const councilMessagesDeleted =
        runIds.length === 0
          ? 0
          : tx.delete(councilMessages).where(inArray(councilMessages.runId, runIds)).run().changes
      const councilRunsDeleted = tx
        .delete(councilRuns)
        .where(eq(councilRuns.projectId, id))
        .run().changes

      // 3–4. Telemetry. Soft pointers, never deleted before today.
      const attentionSpansDeleted = tx
        .delete(attentionSpans)
        .where(eq(attentionSpans.projectId, id))
        .run().changes
      const dispatchesDeleted = tx
        .delete(dispatches)
        .where(eq(dispatches.projectId, id))
        .run().changes

      // 5. ⚠ BEFORE SESSIONS. worktrees.session_id REFERENCES sessions.id.
      const worktreesDeleted = tx
        .delete(worktrees)
        .where(eq(worktrees.projectId, id))
        .run().changes
      // 6–7. The enforced children of projects(id).
      const sessionsDeleted = tx.delete(sessions).where(eq(sessions.projectId, id)).run().changes
      const paneLayoutsDeleted = tx
        .delete(paneLayouts)
        .where(eq(paneLayouts.projectId, id))
        .run().changes
      // 7b. ⚠ ADDED BY TASK 6-3 IN THE SAME COMMIT AS THE TABLE, AND IT IS A
      // CORRECTNESS FIX RATHER THAN AN EXTENSION. `project_memory.project_id`
      // is `PRIMARY KEY REFERENCES projects(id)` — enforced, and never null —
      // so without this delete step 10 below throws
      // SQLITE_CONSTRAINT_FOREIGNKEY on any project that ever had memory
      // configured, rolling back the whole purge. That is precisely the D62
      // trap the v16 comment describes for `credential_profile_id`, except
      // that this one is LIVE from the first configured project rather than
      // unreachable, which is why it is guarded here and now instead of being
      // written down for later.
      //
      // ⚠ THE CONFIG GOES; THE GRAPH DOES NOT. Nothing in this transaction
      // speaks bolt, so a deleted project's Neo4j data survives it — the same
      // distinction `memory:disable` draws, and the same posture D121 takes for
      // worktree directories.
      const projectMemoryDeleted = tx
        .delete(projectMemory)
        .where(eq(projectMemory.projectId, id))
        .run().changes

      // 8. The two per-project settings keys. Nothing enumerates this table, so
      // a key missed here is unreachable forever.
      let settingsDeleted = tx
        .delete(settings)
        .where(inArray(settings.key, [`view_state:${id}`, `last_launch_profile:${id}`]))
        .run().changes

      // 9. The active pointer, ONLY when it names this project — and rewritten
      // rather than dropped when a successor exists, so the app never boots
      // through the no-active-project branch just because a background project
      // was deleted.
      const active = tx.select().from(settings).where(eq(settings.key, 'active_project_id')).get()
      if (active?.value === id) {
        if (successorActiveId) {
          tx.update(settings)
            .set({ value: successorActiveId })
            .where(eq(settings.key, 'active_project_id'))
            .run()
        } else {
          settingsDeleted += tx
            .delete(settings)
            .where(eq(settings.key, 'active_project_id'))
            .run().changes
        }
      }

      // 10. The row itself. Every enforced reference to it is gone by here.
      const projectsDeleted = tx.delete(projects).where(eq(projects.id, id)).run().changes

      return {
        councilMessages: councilMessagesDeleted,
        councilRuns: councilRunsDeleted,
        attentionSpans: attentionSpansDeleted,
        dispatches: dispatchesDeleted,
        worktrees: worktreesDeleted,
        sessions: sessionsDeleted,
        paneLayouts: paneLayoutsDeleted,
        projectMemory: projectMemoryDeleted,
        settings: settingsDeleted,
        projects: projectsDeleted
      }
    })
  }

  /**
   * Write the rail's order — every project, in one transaction.
   *
   * ⚠ THE CALLER VALIDATES THE PERMUTATION, NOT THIS. `project:reorder` checks
   * `ordered_ids` against `listProjects()`'s ACTUAL ids before calling; by here
   * the list is known to be exactly the projects that exist. Re-deriving that
   * check in two places is how the two come to disagree.
   *
   * ⚠ AND `color_seed` IS NOT TOUCHED. It was seeded from `sort_order` at
   * migration time and the two diverge permanently from that moment: position
   * is what the user drags, colour is what they expect to stay put. Writing
   * both here would repaint the rail on every reorder — the exact defect the
   * whole colour decoupling exists to prevent.
   *
   * The transaction is what makes the transient duplicate states safe, and is
   * the reason `sort_order` carries no UNIQUE index.
   */
  reorderProjects(orderedIds: string[]): void {
    this.d.transaction((tx) => {
      orderedIds.forEach((id, i) => {
        tx.update(projects).set({ sortOrder: i }).where(eq(projects.id, id)).run()
      })
    })
  }

  /**
   * Session counts for EVERY project, in one `GROUP BY` (Task 3c-3 / D80).
   *
   * The project rail draws a session count on each item, and no per-project
   * round-trip is acceptable for that: N projects would mean N `layout:get`
   * calls at boot. This is one read, folded into the response `project:list`
   * already returns.
   *
   * Projects with no sessions are ABSENT from the map, not zero — the caller
   * defaults them, which keeps this a faithful report of what the table holds.
   */
  countSessionsByProject(): Map<string, number> {
    const rows = this.d
      .select({ projectId: sessions.projectId, n: count() })
      .from(sessions)
      .groupBy(sessions.projectId)
      .all()
    return new Map(rows.map((r) => [r.projectId, r.n]))
  }

  getProjectById(id: string): ProjectRecord | null {
    const row = this.d.select().from(projects).where(eq(projects.id, id)).get()
    return row ? toProjectRecord(row) : null
  }

  /** Active-project persistence (Task 1-5): inline-Drizzle settings pattern,
   *  same shape as getWindowBounds/saveWindowBounds. Null = never set — the
   *  boot sequence then seeds DEV_WORKING_DIR as the first-run default. */
  getActiveProjectId(): string | null {
    const row = this.d.select().from(settings).where(eq(settings.key, 'active_project_id')).get()
    return row?.value ?? null
  }

  setActiveProjectId(id: string): void {
    this.d
      .insert(settings)
      .values({ key: 'active_project_id', value: id })
      .onConflictDoUpdate({ target: settings.key, set: { value: id } })
      .run()
  }

  /**
   * Forget which project is active (v15).
   *
   * ⚠ THE ROW IS DELETED RATHER THAN SET TO '', because `getActiveProjectId`
   * reads the ABSENCE of the row as "never set" and that is the same fact. An
   * empty string would be a third state that every reader would then have to
   * know about — and the boot resolution's `active ? getProjectById(active)`
   * would look it up, find nothing, and reach the right answer by accident
   * rather than by design.
   *
   * Reached when archiving or deleting the last active project: no successor
   * qualifies, and no active project is the honest state. `deleteProject` does
   * its own equivalent inside its transaction, so the pointer never survives
   * the row it names.
   */
  clearActiveProjectId(): void {
    this.d.delete(settings).where(eq(settings.key, 'active_project_id')).run()
  }

  /**
   * Read the persisted layout as a versioned tree, or null when there is none.
   * Shapes handled:
   *  1. no row            -> null (fresh project, or the last pane was closed):
   *     the empty state. The ABSENCE of the row is the empty signal.
   *  2. valid tree v1     -> normalize (clamp ratios, dedupe keep-first), return
   *  3. legacy flat array (pre-1-2 content) -> lazy conversion: resolve or
   *     create the stable sessions rows, convert, WRITE THE TREE BACK, return
   *  4. anything else     -> log + treat as empty (never crash)
   */
  getPaneLayout(projectId: string): LayoutJson | null {
    const row = this.d.select().from(paneLayouts).where(eq(paneLayouts.projectId, projectId)).get()
    if (!row) return null

    let raw: unknown
    try {
      raw = JSON.parse(row.layoutJson)
    } catch {
      raw = undefined
    }
    if (raw !== undefined) {
      const asTree = layoutJsonSchema.safeParse(raw)
      if (asTree.success) {
        return { version: 1, root: normalizeTree(asTree.data.root) }
      }
      const asFlat = legacyFlatLayoutSchema.safeParse(raw)
      if (asFlat.success && asFlat.data.length > 0) {
        const layout = convertLegacyFlatLayout(
          asFlat.data,
          (agent) => this.findOrCreateSession(projectId, agent as AgentKind).id
        )
        this.savePaneLayout(projectId, layout)
        logger.info('[storage] converted legacy flat pane layout to layout tree v1')
        return layout
      }
    }

    logger.warn('[storage] pane_layouts.layout_json invalid; treating as empty layout')
    return null
  }

  /** Persist a layout tree (Task 1-3's layout:set path). Ratios are clamped
   *  on write as well as read. */
  savePaneLayout(projectId: string, layout: LayoutJson): void {
    const normalized: LayoutJson = { version: 1, root: normalizeTree(layout.root) }
    const layoutJson = JSON.stringify(normalized)
    this.d
      .insert(paneLayouts)
      .values({ projectId, layoutJson })
      .onConflictDoUpdate({ target: paneLayouts.projectId, set: { layoutJson } })
      .run()
  }

  /** Delete the pane_layouts row (Task 1-4 last-pane close): the empty-layout
   *  signal is the row's ABSENCE, never a null-root wrapper. */
  clearPaneLayout(projectId: string): void {
    this.d.delete(paneLayouts).where(eq(paneLayouts.projectId, projectId)).run()
  }

  /** Recent launch cwds, newest first. Non-string entries are filtered out on
   *  read so a hand-edited settings row cannot feed the renderer non-strings. */
  getRecentCwds(): string[] {
    const row = this.d.select().from(settings).where(eq(settings.key, 'recent_cwds')).get()
    if (!row) return []
    try {
      const arr: unknown = JSON.parse(row.value)
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  }

  /** Unshift + dedupe + cap at 10, mirroring the saveWindowBounds upsert pattern. */
  pushRecentCwd(cwd: string): void {
    const next = [cwd, ...this.getRecentCwds().filter((x) => x !== cwd)].slice(0, 10)
    const value = JSON.stringify(next)
    this.d
      .insert(settings)
      .values({ key: 'recent_cwds', value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run()
  }

  /* -------------------------------------------------------------------- */
  /* Task 3a-5 / D49: which session rows launched on a stored credential.   */
  /*                                                                        */
  /* ⚠ THIS REPLACES Task 3-6's global `credentialed_sessions` settings      */
  /* list, which was an explicitly-labelled PHASE-3-ONLY EXPEDIENT. The     */
  /* fact is now DERIVED from the launch profile a session ran under —      */
  /* per-session, and therefore per-project, which is the whole debt        */
  /* retirement. `markSessionCredentialed` / `unmarkSessionCredentialed` /  */
  /* `writeCredentialedSessionIds` are GONE: the fact is written on the     */
  /* session's own INSERT and dies with the row, structurally, so there is  */
  /* no window in which a crash leaves a credentialed session unmarked.     */
  /*                                                                        */
  /* Every policy decision lives in launchProfiles.ts. This is lookup only. */
  /* -------------------------------------------------------------------- */

  /**
   * Restore's input. ⚠ NOTE THE PARAMETER: the 3-6 form was global over all
   * projects; it is now scoped, which is the retirement made visible in the
   * signature. Fail-safe semantics live in `sessionIsCredentialed`.
   */
  getCredentialedSessionIds(projectId: string): Set<string> {
    const rows = this.d
      .select({ id: sessions.id, launchProfileId: sessions.launchProfileId })
      .from(sessions)
      .where(and(eq(sessions.projectId, projectId), isNotNull(sessions.launchProfileId)))
      .all()
    const out = new Set<string>()
    for (const row of rows) {
      if (sessionIsCredentialed(row.launchProfileId, (id) => this.getLaunchProfileById(id) ?? undefined)) {
        out.add(row.id)
      }
    }
    return out
  }

  /** session:restart's input — the same predicate for one row. */
  isSessionCredentialed(sessionId: string): boolean {
    const row = this.d
      .select({ launchProfileId: sessions.launchProfileId })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get()
    if (!row) return false
    return sessionIsCredentialed(row.launchProfileId, (id) => this.getLaunchProfileById(id) ?? undefined)
  }

  createSession(row: NewSessionRow): SessionRow {
    this.d.insert(sessions).values(row).run()
    return {
      ...row,
      exitCode: row.exitCode ?? null,
      title: row.title ?? null,
      // v14: normalized here for the same reason as `title` — an omitted
      // property and a NULL column must read identically to every caller.
      name: row.name ?? null,
      description: row.description ?? null,
      worktreeId: row.worktreeId ?? null,
      // v10: written on the SAME insert as the row, never in a follow-up
      // update — a crash between the two would leave a credentialed session
      // unmarked, which is the silent-keyless-restore failure through the back
      // door. The caller passes it in `row`; this only normalizes the default.
      launchProfileId: row.launchProfileId ?? null,
      // v16: same normalization, and the default is what the column's own note
      // argues for — a NEW session is UNLOCKED. Nothing in the launch path
      // passes this; the field exists here so the returned row matches what a
      // re-read would give, rather than carrying `undefined` where every other
      // reader expects null.
      lockedAt: row.lockedAt ?? null,
      // v19: same normalization, one more time, and the default is the whole
      // meaning of the column — a NEW session has NO agent conversation behind
      // it yet. Nothing in the launch path passes this in Task 4a-1 (the column
      // is dormant); the field exists here so the returned row matches what a
      // re-read would give, rather than carrying `undefined` where every other
      // reader expects null.
      agentSessionId: row.agentSessionId ?? null
    }
  }

  getSessionsForProject(projectId: string): SessionRow[] {
    return this.d
      .select()
      .from(sessions)
      .where(eq(sessions.projectId, projectId))
      .orderBy(asc(sessions.createdAt))
      .all()
  }

  /**
   * Every project's sessions, reduced to the four columns the rail's attention
   * roll-up reads. One query for the whole app.
   *
   * ⚠ FOUR COLUMNS, NOT `select()`, and the projection is the point rather than
   * micro-optimisation. A full row carries `cwd`, the OSC `title`, the authored
   * `name`/`description` and `launch_profile_id` — none of which the roll-up
   * reads, and the last of which is the credentialed-session pointer. Selecting
   * the whole table on a timer, app-wide, to derive two booleans would put that
   * in main's working set on every light change for no reason.
   *
   * The sibling above stays row-complete because its callers rebuild panes from
   * it; this one exists precisely because that shape is wrong for a summary.
   */
  getAllSessionStates(): { id: string; projectId: string; status: string; exitCode: number | null }[] {
    return this.d
      .select({
        id: sessions.id,
        projectId: sessions.projectId,
        status: sessions.status,
        exitCode: sessions.exitCode
      })
      .from(sessions)
      .all()
  }

  /** Single session row by id (session:restart reads it without a project
   *  context; the row itself carries project_id). */
  getSessionById(id: string): SessionRow | null {
    return this.d.select().from(sessions).where(eq(sessions.id, id)).get() ?? null
  }

  /** Delete a session row (Task 1-5 close flow). The IPC layer refuses to call
   *  this for a session that is live in the manager. */
  deleteSession(id: string): void {
    this.d.delete(sessions).where(eq(sessions.id, id)).run()
  }

  updateSessionStatus(id: string, status: SessionStatus, exitCode?: number | null): void {
    this.d
      .update(sessions)
      .set(exitCode === undefined ? { status } : { status, exitCode })
      .where(eq(sessions.id, id))
      .run()
  }

  /** Persist a captured title (session:set-title). Sanitization happens in the
   *  IPC handler; a missing id is a zero-row no-op, matching updateSessionStatus. */
  updateSessionTitle(id: string, title: string): void {
    this.d.update(sessions).set({ title }).where(eq(sessions.id, id)).run()
  }

  /* -------------------------------------------------------------------- */
  /* v19: the resume pointer. Two writes and one read. WHICH agent id this  */
  /* holds is the adapter's business (D140: claude assigns it, codex has    */
  /* it discovered); storage only knows it is a string that came back from  */
  /* the CLI and goes back to the CLI unchanged.                            */
  /*                                                                        */
  /* ⚠ NOTHING CALLS THESE THREE YET, AND THAT IS TASK 4a-1's WHOLE POINT.  */
  /* The schema move lands separately from the behaviour that depends on    */
  /* it, so reverting this commit provably breaks nothing. Task 4a-3 is the  */
  /* first caller.                                                          */
  /* -------------------------------------------------------------------- */

  /** Record the agent's own conversation id for this session. A missing row
   *  id is a zero-row no-op, matching updateSessionStatus/updateSessionTitle. */
  setAgentSessionId(id: string, agentSessionId: string): void {
    this.d.update(sessions).set({ agentSessionId }).where(eq(sessions.id, id)).run()
  }

  /** Forget the conversation — the RESTART path (D142), and the only way this
   *  column returns to NULL.
   *
   *  ⚠ A SEPARATE METHOD RATHER THAN `setAgentSessionId(id, null)`, AND THAT IS
   *  DELIBERATE. Forgetting is an intentional act with a name; a nullable
   *  setter lets a caller that merely had nothing to pass erase a live
   *  conversation pointer by accident, and the failure would be silent and
   *  unrecoverable — the id is gone and the transcript is unfindable. */
  clearAgentSessionId(id: string): void {
    this.d.update(sessions).set({ agentSessionId: null }).where(eq(sessions.id, id)).run()
  }

  /** The pointer, or null when there is nothing to resume.
   *
   *  ⚠ `?? null` IS LOAD-BEARING: a missing row and a row with a NULL column
   *  must be INDISTINGUISHABLE to the caller. Both mean "nothing to resume",
   *  and 4a-3 must not have to tell them apart — the same safe-direction
   *  reasoning as `isSessionLocked`'s unknown-id-is-unlocked answer. */
  getAgentSessionId(id: string): string | null {
    const row = this.d
      .select({ agentSessionId: sessions.agentSessionId })
      .from(sessions)
      .where(eq(sessions.id, id))
      .get()
    return row?.agentSessionId ?? null
  }

  /* -------------------------------------------------------------------- */
  /* v16: the agent lock. Three reads and one write; every REFUSAL that     */
  /* uses them is authored in ipc.ts, which is the only place that knows    */
  /* what the user was trying to do and can therefore say so.               */
  /* -------------------------------------------------------------------- */

  /** Lock or unlock. The timestamp is written HERE rather than passed in, so
   *  there is one clock for this fact and a caller cannot back-date a lock. */
  setSessionLocked(id: string, locked: boolean): void {
    this.d
      .update(sessions)
      .set({ lockedAt: locked ? new Date().toISOString() : null })
      .where(eq(sessions.id, id))
      .run()
  }

  /**
   * ⚠ AN UNKNOWN ID IS UNLOCKED, AND THAT IS THE SAFE DIRECTION. A session row
   * that does not exist cannot be destroyed by the guards this feeds, so
   * answering `true` would only refuse operations on rows that are already gone
   * — a lock nobody could ever clear, because the UI that clears one needs a row
   * to draw. Same reasoning as the column's NULL default.
   */
  isSessionLocked(id: string): boolean {
    const row = this.d
      .select({ lockedAt: sessions.lockedAt })
      .from(sessions)
      .where(eq(sessions.id, id))
      .get()
    return row?.lockedAt != null
  }

  /**
   * Every locked agent in a project, as `{id, label}` — the project-level
   * refusals (archive, delete) NAME the agents holding them.
   *
   * ⚠ IT RETURNS THE ROWS, NOT A COUNT, AND THE DIFFERENCE IS THE WHOLE POINT.
   * "3 agents are locked" tells a user they are blocked without telling them
   * what to do next; "Bob and Refactor auth are locked" tells them where to
   * click. The label falls back the way every other surface's does — the
   * authored name first, then the captured title, then the agent kind — so a
   * refusal never reads "`` is locked".
   */
  getLockedSessionsForProject(projectId: string): { id: string; label: string }[] {
    return this.d
      .select({
        id: sessions.id,
        name: sessions.name,
        title: sessions.title,
        agent: sessions.agent
      })
      .from(sessions)
      .where(and(eq(sessions.projectId, projectId), isNotNull(sessions.lockedAt)))
      .orderBy(asc(sessions.createdAt))
      .all()
      .map((r) => ({ id: r.id, label: r.name ?? r.title ?? r.agent }))
  }

  /* -------------------------------------------------------------------- */
  /* Worktrees (Phase 2 / D26). The two pointer-writing ops are            */
  /* transactional per resolution (a): worktrees.session_id AND            */
  /* sessions.worktree_id move in ONE synchronous transaction.             */
  /* -------------------------------------------------------------------- */

  createWorktreeRow(row: NewWorktreeRow): WorktreeRow {
    this.d.insert(worktrees).values(row).run()
    return { ...row, sessionId: row.sessionId ?? null } as WorktreeRow
  }

  /** The 2-3 retained-worktree panel's data source, in creation order. */
  getWorktreesForProject(projectId: string): WorktreeRow[] {
    return this.d
      .select()
      .from(worktrees)
      .where(eq(worktrees.projectId, projectId))
      .orderBy(asc(worktrees.createdAt))
      .all()
  }

  /** Every worktree row — the boot reconcile's input (Task 2-1). */
  getAllWorktrees(): WorktreeRow[] {
    return this.d.select().from(worktrees).all()
  }

  getWorktreeById(id: string): WorktreeRow | null {
    return this.d.select().from(worktrees).where(eq(worktrees.id, id)).get() ?? null
  }

  updateWorktreeStatus(id: string, status: string): void {
    this.d.update(worktrees).set({ status }).where(eq(worktrees.id, id)).run()
  }

  /** Resolution (a): both pointers + status='active' + session cwd → worktree
   *  path, in ONE synchronous transaction. Called by 2-2's new-worktree launch. */
  activateWorktreeForSession(worktreeId: string, sessionId: string, worktreePath: string): void {
    this.d.transaction((tx) => {
      tx.update(worktrees).set({ sessionId, status: 'active' }).where(eq(worktrees.id, worktreeId)).run()
      tx.update(sessions).set({ worktreeId, cwd: worktreePath }).where(eq(sessions.id, sessionId)).run()
    })
  }

  /** Resolution (a): clear both pointers + status='detached', one transaction.
   *  Called by 2-3's close flow / session:delete. */
  detachWorktree(worktreeId: string): void {
    this.d.transaction((tx) => {
      const wt = tx.select().from(worktrees).where(eq(worktrees.id, worktreeId)).get()
      tx.update(worktrees).set({ sessionId: null, status: 'detached' }).where(eq(worktrees.id, worktreeId)).run()
      if (wt?.sessionId) tx.update(sessions).set({ worktreeId: null }).where(eq(sessions.id, wt.sessionId)).run()
    })
  }

  /** Row removal is only ever reconcile's provably-nothing-durable case
   *  (P3c/P3e) or the successful end of removeWorktree — never a dirty tree. */
  deleteWorktreeRow(id: string): void {
    this.d.delete(worktrees).where(eq(worktrees.id, id)).run()
  }

  /* -------------------------------------------------------------------- */
  /* Providers + credential profiles (Phase 3 / D33). Rows in, rows out — */
  /* every policy decision (encrypt, refuse, classify) lives in the vault */
  /* and the IPC handlers; nothing here touches a plaintext key.          */
  /* -------------------------------------------------------------------- */

  createProviderConfig(row: NewProviderConfigRow): ProviderConfigRow {
    this.d.insert(providerConfigs).values(row).run()
    return {
      ...row,
      envVarName: row.envVarName ?? null,
      baseUrl: row.baseUrl ?? null,
      extraHeadersJson: row.extraHeadersJson ?? null,
      model: row.model ?? null
    }
  }

  listProviderConfigs(): ProviderConfigRow[] {
    return this.d.select().from(providerConfigs).orderBy(asc(providerConfigs.createdAt)).all()
  }

  getProviderConfigById(id: string): ProviderConfigRow | null {
    return this.d.select().from(providerConfigs).where(eq(providerConfigs.id, id)).get() ?? null
  }

  /** Patch semantics are the handler's: only the fields it includes are set. */
  updateProviderConfig(id: string, patch: Partial<Omit<NewProviderConfigRow, 'id' | 'createdAt'>>): void {
    this.d.update(providerConfigs).set(patch).where(eq(providerConfigs.id, id)).run()
  }

  /** F16: this THROWS SQLITE_CONSTRAINT_FOREIGNKEY while any credential
   *  profile references the provider — callers must count-and-refuse first
   *  (countCredentialProfilesForProvider), never reverse-engineer the throw.
   *
   *  Task 3a-4: the provider's model_catalog rows are purged in the SAME
   *  transaction, BEFORE the provider row. model_catalog carries no
   *  REFERENCES clause deliberately (FKs are ENFORCED — F16 — and RESTRICT
   *  would make this delete throw for a table that is a cache), so the purge
   *  is explicit rather than a cascade. An orphaned cache row is harmless but
   *  untrue, and the purge costs one statement.
   *
   *  ⚠ The count-and-refuse on credential profiles is UNCHANGED and stays
   *  with the caller: profiles still block a delete; a catalog never does. A
   *  cache is not a reason to keep a route the user asked to remove. */
  deleteProviderConfig(id: string): void {
    this.d.transaction((tx) => {
      tx.delete(modelCatalog).where(eq(modelCatalog.providerId, id)).run()
      // v12/D85: the shortlist is soft-pointed at the provider for the same
      // reason the catalog is (FKs are ENFORCED, F16, and RESTRICT would make
      // this delete throw), so it is purged HERE, in the same transaction. A
      // provider that is gone cannot leave a curation behind that nothing can
      // ever reach or delete.
      tx.delete(modelShortlist).where(eq(modelShortlist.providerId, id)).run()
      tx.delete(providerConfigs).where(eq(providerConfigs.id, id)).run()
    })
  }

  createCredentialProfile(row: NewCredentialProfileRow): CredentialProfileRow {
    this.d.insert(credentialProfiles).values(row).run()
    return {
      ...row,
      lastVerifiedAt: row.lastVerifiedAt ?? null,
      unavailableSince: row.unavailableSince ?? null,
      reencryptedAt: row.reencryptedAt ?? null
    }
  }

  listCredentialProfiles(): CredentialProfileRow[] {
    return this.d.select().from(credentialProfiles).orderBy(asc(credentialProfiles.createdAt)).all()
  }

  getCredentialProfileById(id: string): CredentialProfileRow | null {
    return this.d.select().from(credentialProfiles).where(eq(credentialProfiles.id, id)).get() ?? null
  }

  /** D33 resolution (b): main-side duplicate detection, scoped to one
   *  provider — the same key on two different providers is legitimate. */
  getCredentialProfileByFingerprint(
    providerId: string,
    fingerprintHash: string
  ): CredentialProfileRow | null {
    return (
      this.d
        .select()
        .from(credentialProfiles)
        .where(
          and(
            eq(credentialProfiles.providerId, providerId),
            eq(credentialProfiles.fingerprintHash, fingerprintHash)
          )
        )
        .get() ?? null
    )
  }

  /** The provider:delete pre-check (F16): refuse while this is non-zero. */
  countCredentialProfilesForProvider(providerId: string): number {
    return (
      this.d
        .select({ n: count() })
        .from(credentialProfiles)
        .where(eq(credentialProfiles.providerId, providerId))
        .get()?.n ?? 0
    )
  }

  /** The successful-replace / re-encrypt write: new blob + fingerprint, and
   *  clears unavailable_since — D33 clause 8: the mark survives until a
   *  successful replace clears it. */
  updateCredentialBlob(id: string, blob: Buffer, fingerprintHash: string): void {
    this.d
      .update(credentialProfiles)
      .set({ encryptedBlob: blob, fingerprintHash, unavailableSince: null })
      .where(eq(credentialProfiles.id, id))
      .run()
  }

  /** D33 clause 8: set on decrypt failure. The row is KEPT. */
  markCredentialUnavailable(id: string, at: string): void {
    this.d.update(credentialProfiles).set({ unavailableSince: at }).where(eq(credentialProfiles.id, id)).run()
  }

  /** D33 risk 7 throttle marker for the shouldReEncrypt path. */
  markCredentialReencrypted(id: string, at: string): void {
    this.d.update(credentialProfiles).set({ reencryptedAt: at }).where(eq(credentialProfiles.id, id)).run()
  }

  /** Written by Task 3-6's test-key probe only — no writer exists yet.
   *
   *  ⚠ Task 3a-4 deliberately does NOT call this. A successful model refresh
   *  is not evidence of authentication: OpenRouter's /models answers 200 with
   *  no credential at all (D4-re-verified 2026-07-25). A refresh is not a Test
   *  key and must not pretend to be. */
  markCredentialVerified(id: string, at: string): void {
    this.d.update(credentialProfiles).set({ lastVerifiedAt: at }).where(eq(credentialProfiles.id, id)).run()
  }

  deleteCredentialProfile(id: string): void {
    this.d.delete(credentialProfiles).where(eq(credentialProfiles.id, id)).run()
  }

  /* -------------------------------------------------------------------- */
  /* Model catalog (Phase 3a / Task 3a-4, migration v9). Rows in, rows out. */
  /* EVERY POLICY DECISION LIVES IN modelCatalogCore.ts — these are dumb.  */
  /*                                                                       */
  /* ⚠ Nothing in this section writes provider_configs. The catalog is a   */
  /* list of what exists, never an authority over the route's default      */
  /* model; a catalog miss warns and never clears, defaults or substitutes. */
  /* -------------------------------------------------------------------- */

  /** All catalog rows for one provider, MISSING ONES INCLUDED — they still
   *  render, struck through, because deleting them would destroy the only
   *  evidence the id was ever real. Ordered by display_name for stable UI. */
  getModelCatalogForProvider(providerId: string): ModelCatalogRow[] {
    return this.d
      .select()
      .from(modelCatalog)
      .where(eq(modelCatalog.providerId, providerId))
      .orderBy(asc(modelCatalog.displayName))
      .all()
  }

  /** The newest refreshed_at across a provider's rows, or null when the
   *  provider has never been refreshed. THE freshness fact — there is no
   *  per-provider freshness column, because that would be a second home for
   *  one fact (D48's lesson, applied to a cache). */
  getCatalogRefreshedAt(providerId: string): string | null {
    return (
      this.d
        .select({ v: max(modelCatalog.refreshedAt) })
        .from(modelCatalog)
        .where(eq(modelCatalog.providerId, providerId))
        .get()?.v ?? null
    )
  }

  /**
   * Apply one refresh's computed diff ATOMICALLY. Takes the core's output and
   * makes no decisions of its own.
   *
   * ⚠ The upsert's UPDATE branch deliberately omits `first_seen_at` and
   * `missing_since`. Omitting the first is what preserves the audit fact;
   * omitting the second is what keeps "missing since" from being rewritten by
   * a refresh that merely saw the model again — that clearing is an explicit,
   * counted instruction (`clearMissing`), not a side effect.
   *
   * The composite PK is what makes a second refresh UPDATE rather than
   * duplicate — the bug that only appears on the second button press.
   */
  applyCatalogDiff(providerId: string, diff: CatalogDiff): void {
    this.d.transaction((tx) => {
      for (const m of diff.upserts) {
        tx.insert(modelCatalog)
          .values({
            providerId,
            modelId: m.modelId,
            displayName: m.displayName,
            contextLength: m.contextLength,
            expiresAt: m.expiresAt,
            firstSeenAt: m.firstSeenAt,
            refreshedAt: m.refreshedAt,
            missingSince: null
          })
          .onConflictDoUpdate({
            target: [modelCatalog.providerId, modelCatalog.modelId],
            set: {
              displayName: m.displayName,
              contextLength: m.contextLength,
              expiresAt: m.expiresAt,
              refreshedAt: m.refreshedAt
            }
          })
          .run()
      }
      for (const id of diff.markMissing) {
        tx.update(modelCatalog)
          .set({ missingSince: diff.nowIso })
          .where(and(eq(modelCatalog.providerId, providerId), eq(modelCatalog.modelId, id)))
          .run()
      }
      for (const id of diff.clearMissing) {
        tx.update(modelCatalog)
          .set({ missingSince: null })
          .where(and(eq(modelCatalog.providerId, providerId), eq(modelCatalog.modelId, id)))
          .run()
      }
    })
  }

  /** Used ONLY by deleteProviderConfig's purge and by the verification
   *  harness. Not exposed over IPC. */
  deleteModelCatalogForProvider(providerId: string): void {
    this.d.delete(modelCatalog).where(eq(modelCatalog.providerId, providerId)).run()
  }

  /* -------------------------------------------------------------------- */
  /* v12 / D85: the model SHORTLIST — user intent, not cache.             */
  /*                                                                      */
  /* ⚠ NOTHING IN THIS SECTION IS CALLED BY A REFRESH, and nothing in the  */
  /* catalog section above touches `model_shortlist`. That separation is   */
  /* the decision, not an accident of layout: the moment a refresh can     */
  /* write here, a provider's response can silently edit a list the user   */
  /* built by hand. Grep `applyCatalogDiff` for `modelShortlist`: zero.    */
  /* -------------------------------------------------------------------- */

  /** One provider's shortlisted model ids, IN THE ORDER THE USER BUILT THEM.
   *  Deliberately not alphabetical: a personal shortlist carries information
   *  in its order that the alphabet destroys. */
  getModelShortlistForProvider(providerId: string): ModelShortlistRow[] {
    return this.d
      .select()
      .from(modelShortlist)
      .where(eq(modelShortlist.providerId, providerId))
      .orderBy(asc(modelShortlist.addedAt))
      .all()
  }

  /**
   * Add or remove one id. IDEMPOTENT in both directions — adding twice is not
   * an error and does not move `added_at` (the composite PK makes the second
   * insert a no-op rather than a duplicate, and `DO NOTHING` is what keeps the
   * original ordering fact intact). Removing something absent is a no-op too.
   *
   * ⚠ THE ID IS NOT CHECKED AGAINST `model_catalog`, DELIBERATELY. See the v12
   * migration comment: a shortlist that could only hold ids a refresh returned
   * would make the catalog authoritative by construction.
   */
  setModelShortlisted(providerId: string, modelId: string, shortlisted: boolean, nowIso: string): void {
    if (shortlisted) {
      this.d
        .insert(modelShortlist)
        .values({ providerId, modelId, addedAt: nowIso })
        .onConflictDoNothing({ target: [modelShortlist.providerId, modelShortlist.modelId] })
        .run()
      return
    }
    this.d
      .delete(modelShortlist)
      .where(and(eq(modelShortlist.providerId, providerId), eq(modelShortlist.modelId, modelId)))
      .run()
  }

  /* -------------------------------------------------------------------- */
  /* Dispatch telemetry (Phase 3a / Task 3a-1, migration v7). Rows in,     */
  /* rows out. "OPEN" means outcome IS NULL — never ended_at IS NULL, which */
  /* a boot-healed orphan deliberately leaves set to NULL forever.         */
  /* -------------------------------------------------------------------- */

  createDispatch(row: NewDispatchRow): DispatchRow {
    this.d.insert(dispatches).values(row).run()
    return {
      ...row,
      sessionId: row.sessionId ?? null,
      projectId: row.projectId ?? null,
      taskId: row.taskId ?? null,
      model: row.model ?? null,
      providerName: row.providerName ?? null,
      endedAt: row.endedAt ?? null,
      outcome: row.outcome ?? null,
      closedBy: row.closedBy ?? null,
      exitCode: row.exitCode ?? null,
      tokensIn: row.tokensIn ?? null,
      tokensOut: row.tokensOut ?? null,
      tokensCached: row.tokensCached ?? null,
      costUsd: row.costUsd ?? null,
      // v8 (3a-3): a freshly opened dispatch has no mint yet. 'none' is the
      // DDL default and is exactly true at this moment — attachMintedKey
      // promotes it to 'minted' only once a key really exists.
      mintedKeyHash: row.mintedKeyHash ?? null,
      mintedKeyLimit: row.mintedKeyLimit ?? null,
      mintedAt: row.mintedAt ?? null,
      revokedAt: row.revokedAt ?? null,
      attributionState: row.attributionState ?? 'none',
      tokensSource: row.tokensSource ?? null
    }
  }

  /** The open dispatch for a session, newest first. Used by the exit close.
   *  Returns null when there is none — a normal case, not an error (a session
   *  spawned before this feature existed, or a dispatch already closed). */
  getOpenDispatchForSession(sessionId: string): DispatchRow | null {
    return (
      this.d
        .select()
        .from(dispatches)
        .where(and(eq(dispatches.sessionId, sessionId), isNull(dispatches.outcome)))
        .orderBy(desc(dispatches.startedAt))
        .get() ?? null
    )
  }

  /** The most recent dispatch for a session REGARDLESS of outcome (Task 3a-3).
   *  Distinct from getOpenDispatchForSession on purpose: attribution settles on
   *  the same `onExit` event 3a-1's recorder closes the row on, and listener
   *  order within the Set is explicitly not contractual — so by the time this
   *  runs the row may already carry an outcome and be invisible to the "open"
   *  query. Enriching a just-closed row is correct; missing it is not. */
  getLatestDispatchForSession(sessionId: string): DispatchRow | null {
    return (
      this.d
        .select()
        .from(dispatches)
        .where(eq(dispatches.sessionId, sessionId))
        .orderBy(desc(dispatches.startedAt))
        .get() ?? null
    )
  }

  /** Every dispatch still open — the boot heal's input. */
  listOpenDispatches(): DispatchRow[] {
    return this.d.select().from(dispatches).where(isNull(dispatches.outcome)).all()
  }

  /** The ONE close path. `endedAt` is nullable so the boot heal can record
   *  "it ended, we never saw when". Writes nothing if the row already carries
   *  an outcome (idempotence is enforced HERE, in the WHERE clause, so a
   *  caller that loops cannot rewrite history). */
  closeDispatch(
    id: string,
    patch: {
      outcome: 'completed' | 'abandoned' | 'failed'
      closedBy: 'exit' | 'kill' | 'dispose' | 'boot-heal'
      endedAt: string | null
      exitCode: number | null
    }
  ): void {
    this.d
      .update(dispatches)
      .set(patch)
      .where(and(eq(dispatches.id, id), isNull(dispatches.outcome)))
      .run()
  }

  /* -------------------------------------------------------------------- */
  /* Turn boundaries (Task 8-0, migration v18). The SAME open-row predicate */
  /* as dispatches above — "OPEN" means outcome IS NULL, never ended_at IS  */
  /* NULL, which a boot-healed row deliberately leaves NULL forever — so    */
  /* one query shape finds open rows in both tables.                        */
  /*                                                                        */
  /* ⚠ EVERY WRITE HERE IS ONE SYNCHRONOUS STATEMENT, ON PURPOSE. The open  */
  /* and close paths run inside the hook request's `req.on('end')` handler. */
  /* The HTTP response is already sent by then (agentEvents answers before  */
  /* any derivation), so a write cannot stall the agent — but only while it */
  /* stays a single statement. No batching, no queue, nothing async.        */
  /* -------------------------------------------------------------------- */

  /** Open a turn. Called on the `needs-you`/none -> `working` edge. */
  openAgentTurn(row: NewAgentTurnRow): void {
    this.d.insert(agentTurns).values(row).run()
  }

  /** The ONE close path. `endedAt` is nullable so the boot heal can record
   *  "it ended, we never saw when". Writes nothing if the row already carries
   *  an outcome — idempotence lives HERE, in the WHERE clause, exactly as it
   *  does in `closeDispatch`, so a caller that loops cannot rewrite history. */
  closeAgentTurn(
    id: string,
    patch: {
      outcome: 'completed' | 'abandoned'
      closedBy: 'stop' | 'session-exit' | 'boot-heal' | 'quit'
      endedAt: string | null
    }
  ): void {
    this.d
      .update(agentTurns)
      .set(patch)
      .where(and(eq(agentTurns.id, id), isNull(agentTurns.outcome)))
      .run()
  }

  /** Every turn still open — the boot heal's and the quit close's input. */
  listOpenAgentTurns(): AgentTurnRow[] {
    return this.d.select().from(agentTurns).where(isNull(agentTurns.outcome)).all()
  }

  /**
   * Has this session EVER done a turn's worth of work — open or closed?
   *
   * ⚠ F65's ONE FACT: "was there a conversation here to lose?" A claude launch
   * is handed its conversation id before a single byte exists, and claude writes
   * no transcript until the first turn — so a pane opened and never spoken to
   * holds a pointer to a conversation that never existed. Its next resume fails
   * honestly, and telling the user their context was not restored is then an
   * APOLOGY FOR LOSING SOMETHING THAT WAS NEVER THERE. This is what lets the
   * recovery stay silent in exactly that case, and stay loud in every other.
   *
   * ⚠ IT COUNTS TURNS, NOT OUTPUT, and the difference is the point: a TUI paints
   * a banner and a prompt whether or not anything happened, so bytes on screen
   * are not evidence of a conversation. A turn is.
   *
   * Existence only — no row is read into memory, and `limit(1)` stops at the
   * first hit.
   */
  hasRecordedTurn(sessionId: string): boolean {
    return (
      this.d
        .select({ id: agentTurns.id })
        .from(agentTurns)
        .where(eq(agentTurns.sessionId, sessionId))
        .limit(1)
        .get() !== undefined
    )
  }

  /** The open turn for a session, newest first. Read on EVERY activity
   *  transition, which is why `agent_turns_open` exists. Returns null when
   *  there is none — the normal case for a `working` edge, not an error. */
  getOpenTurnForSession(sessionId: string): AgentTurnRow | null {
    return (
      this.d
        .select()
        .from(agentTurns)
        .where(and(eq(agentTurns.sessionId, sessionId), isNull(agentTurns.outcome)))
        .orderBy(desc(agentTurns.startedAt))
        .get() ?? null
    )
  }

  /** Turns STARTED within [fromIso, toIso] for a project — this task ships no
   *  reader, and the accessor exists so the first one needs no schema change.
   *  Bounded by `started_at` alone rather than by overlap, because a turn's end
   *  may never have been observed (`ended_at` NULL is a VALUE here) and an
   *  overlap predicate would silently drop exactly those rows. */
  readAgentTurns(projectId: string, fromIso: string, toIso: string): AgentTurnRow[] {
    return this.d
      .select()
      .from(agentTurns)
      .where(
        and(
          eq(agentTurns.projectId, projectId),
          gte(agentTurns.startedAt, fromIso),
          lte(agentTurns.startedAt, toIso)
        )
      )
      .orderBy(asc(agentTurns.startedAt))
      .all()
  }

  /* -------------------------------------------------------------------- */
  /* Mint ledger + token/cost fill (Phase 3a / Task 3a-3, migration v8).    */
  /*                                                                        */
  /* ⚠ EVERY ACCESSOR HERE IS AN `UPDATE`, NEVER AN `INSERT`. 3a-1's        */
  /* DispatchRecorder owns row lifecycle; this task only ENRICHES a row     */
  /* that already exists, and no accessor below touches `outcome`,          */
  /* `ended_at`, `agent`, `model` or `auth_mode` — two writers on one row   */
  /* is how a close gets silently undone.                                   */
  /*                                                                        */
  /* Idempotence lives in the WHERE clause, as it does in closeDispatch,    */
  /* so a caller that loops cannot rewrite history.                         */
  /* -------------------------------------------------------------------- */

  /** The write-ahead ledger write: record that a key was minted for this
   *  dispatch, BEFORE anything spends under it. `revoked_at` stays NULL, which
   *  is what makes this row visible to boot reconciliation. */
  attachMintedKey(
    dispatchId: string,
    ledger: { hash: string; limit: number | null; mintedAt: string }
  ): void {
    this.d
      .update(dispatches)
      .set({
        mintedKeyHash: ledger.hash,
        mintedKeyLimit: ledger.limit,
        mintedAt: ledger.mintedAt,
        attributionState: 'minted'
      })
      .where(and(eq(dispatches.id, dispatchId), isNull(dispatches.mintedKeyHash)))
      .run()
  }

  /** Record an attribution outcome that never involved a minted key —
   *  'mint-failed', 'cli-logs' or 'none'. Deliberately separate from
   *  attachMintedKey so a mint failure cannot half-write a ledger. */
  setAttributionState(dispatchId: string, state: string): void {
    this.d.update(dispatches).set({ attributionState: state }).where(eq(dispatches.id, dispatchId)).run()
  }

  /**
   * ⚠ THE BOOT RECONCILE'S INPUT: every OPEN ledger row, ACROSS BOTH TABLES.
   * "Open" is `revoked_at IS NULL` AND a hash present — never `outcome IS NULL`,
   * which is 3a-1's separate notion of an open DISPATCH. The two are different
   * questions and conflating them is how a live dispatch's key gets revoked.
   *
   * ⚠ D66: `council_runs` (v11) carries the same four mint columns and the same
   * open-row predicate as `dispatches` (v8), deliberately — and until this
   * commit NONE of them was read, so a council key had no backstop whatsoever.
   * The two selects are unioned HERE rather than reconciled separately, because
   * D66(a) rules that exactly one place may decide whether a key is ours.
   *
   * The rows are TAGGED. `attributionCore.OpenLedgerRow` is discriminated by
   * kind, and the tag is what stops a run id reaching a `dispatches` UPDATE.
   */
  listOpenMintLedger(): (
    | { kind: 'dispatch'; dispatchId: string; hash: string }
    | { kind: 'council'; runId: string; hash: string }
  )[] {
    const dispatchRows = this.d
      .select({ dispatchId: dispatches.id, hash: dispatches.mintedKeyHash })
      .from(dispatches)
      .where(and(isNull(dispatches.revokedAt), isNotNull(dispatches.mintedKeyHash)))
      .all()
      .filter((r): r is { dispatchId: string; hash: string } => typeof r.hash === 'string')
      .map((r) => ({ kind: 'dispatch' as const, dispatchId: r.dispatchId, hash: r.hash }))
    const councilRows = this.d
      .select({ runId: councilRuns.id, hash: councilRuns.mintedKeyHash })
      .from(councilRuns)
      .where(and(isNull(councilRuns.revokedAt), isNotNull(councilRuns.mintedKeyHash)))
      .all()
      .filter((r): r is { runId: string; hash: string } => typeof r.hash === 'string')
      .map((r) => ({ kind: 'council' as const, runId: r.runId, hash: r.hash }))
    return [...dispatchRows, ...councilRows]
  }

  /** Dispatch ids still RUNNING — the classifier's "does a live dispatch own
   *  this key?" input. Read AFTER 3a-1's healOrphansAtBoot has closed the rows
   *  a crash left open, or every orphan reads as running (§6.2). */
  getRunningDispatchIds(): Set<string> {
    return new Set(
      this.d
        .select({ id: dispatches.id })
        .from(dispatches)
        .where(isNull(dispatches.outcome))
        .all()
        .map((r) => r.id)
    )
  }

  /** The council half of the same question (D66). Read AFTER
   *  `healOpenCouncilRunsAtBoot()`, for the identical reason — the two together
   *  are one ordering constraint, inherited whole. */
  getRunningCouncilRunIds(): Set<string> {
    return new Set(
      this.d
        .select({ id: councilRuns.id })
        .from(councilRuns)
        .where(eq(councilRuns.status, COUNCIL_RUN_RUNNING))
        .all()
        .map((r) => r.id)
    )
  }

  /**
   * ⚠ THE COUNCIL HALF OF THE BOOT HEAL (D66(d)), and its position is
   * LOAD-BEARING: it runs BEFORE `reconcileOrphanedKeys`, beside
   * `dispatches.healOrphansAtBoot()`. Run the reconcile first and a crashed run
   * still reads as RUNNING, so matrix row 2 fires, row 1 never does, and the
   * reconcile appears to work while doing nothing on exactly the rows it exists
   * for.
   *
   * It is trivially correct because of D63 Q2: a council member never enters
   * `SessionManager` and writes no `sessions` row, so the restore engine
   * structurally CANNOT resurrect a run — every `council_runs` row still open at
   * boot belongs to a run that is already over. Same reasoning as
   * `healOrphansAtBoot` one layer up, and as F6's "persisted 'running' means WAS
   * running when last observed".
   *
   * `ended_at` stays NULL on purpose, exactly as the dispatch heal leaves it:
   * this run ended and nobody observed when. Inventing a plausible end time at
   * boot is the confident-looking number D55 exists to forbid.
   *
   * Returns the ids it healed so the caller can log them individually — a heal
   * that did nothing and a heal that is broken look identical otherwise.
   */
  healOpenCouncilRunsAtBoot(): string[] {
    const open = this.d
      .select({ id: councilRuns.id })
      .from(councilRuns)
      .where(eq(councilRuns.status, COUNCIL_RUN_RUNNING))
      .all()
      .map((r) => r.id)
    if (open.length > 0) {
      this.d
        .update(councilRuns)
        .set({ status: COUNCIL_RUN_ABANDONED })
        .where(eq(councilRuns.status, COUNCIL_RUN_RUNNING))
        .run()
    }
    return open
  }

  /**
   * Settle one council run's mint ledger: cost and the revocation timestamp, in
   * one write. Guarded on `revoked_at IS NULL` so a re-settle (a reconcile
   * racing a close) is a NO-WRITE rather than a second, contradictory record —
   * the `settleDispatchAttribution` discipline, verbatim.
   *
   * ⚠ IT NEVER TOUCHES `status`. Whether a run completed, failed or was
   * abandoned is the run's own history; revocation is the ledger's. Two writers
   * on one column is how a close gets silently undone.
   */
  settleCouncilRunMint(patch: {
    runId: string
    costUsd: number | null
    revokedAt: string | null
  }): void {
    this.d
      .update(councilRuns)
      .set({ costUsd: patch.costUsd, revokedAt: patch.revokedAt })
      .where(and(eq(councilRuns.id, patch.runId), isNull(councilRuns.revokedAt)))
      .run()
  }

  /** Settle one dispatch's attribution: cost, tokens, revocation timestamp and
   *  state, in one write. Guarded on `revoked_at IS NULL` so a re-settle (a
   *  double exit event, a reconcile racing a close) is a NO-WRITE rather than a
   *  second, contradictory record. */
  settleDispatchAttribution(patch: {
    dispatchId: string
    costUsd: number | null
    tokensIn: number | null
    tokensOut: number | null
    tokensCached: number | null
    tokensSource: string | null
    revokedAt: string | null
    attributionState: string
  }): void {
    this.d
      .update(dispatches)
      .set({
        costUsd: patch.costUsd,
        tokensIn: patch.tokensIn,
        tokensOut: patch.tokensOut,
        tokensCached: patch.tokensCached,
        tokensSource: patch.tokensSource,
        revokedAt: patch.revokedAt,
        attributionState: patch.attributionState
      })
      .where(and(eq(dispatches.id, patch.dispatchId), isNull(dispatches.revokedAt)))
      .run()
  }

  /** Rows whose analytics window was not fresh enough at close (§8, and D4
   *  obligation 3 — freshness is UNDOCUMENTED, so this path is mandatory).
   *  A row qualifies only if it was really metered (a hash) and really has no
   *  tokens yet (`tokens_source IS NULL`), so a genuine zero-token dispatch is
   *  never re-queried forever. */
  listPendingTokenBackfill(limit = 50): { dispatchId: string; hash: string; mintedAt: string }[] {
    return this.d
      .select({ dispatchId: dispatches.id, hash: dispatches.mintedKeyHash, mintedAt: dispatches.mintedAt })
      .from(dispatches)
      .where(
        and(
          isNotNull(dispatches.mintedKeyHash),
          isNotNull(dispatches.revokedAt),
          isNull(dispatches.tokensSource)
        )
      )
      .orderBy(desc(dispatches.mintedAt))
      .limit(limit)
      .all()
      .filter((r): r is { dispatchId: string; hash: string; mintedAt: string } =>
        typeof r.hash === 'string' && typeof r.mintedAt === 'string'
      )
  }

  /** The backfill write. Guarded on `tokens_source IS NULL` so it can NEVER
   *  overwrite a populated value — a later pass may only fill a gap. */
  backfillDispatchTokens(patch: {
    dispatchId: string
    tokensIn: number | null
    tokensOut: number | null
    tokensCached: number | null
    tokensSource: string
  }): void {
    this.d
      .update(dispatches)
      .set({
        tokensIn: patch.tokensIn,
        tokensOut: patch.tokensOut,
        tokensCached: patch.tokensCached,
        tokensSource: patch.tokensSource
      })
      .where(and(eq(dispatches.id, patch.dispatchId), isNull(dispatches.tokensSource)))
      .run()
  }

  /** The "% attributed" input: dispatches STARTED within the window. Started,
   *  not ended, so a run still open at the window edge is counted in the
   *  denominator it belongs to rather than vanishing from both. */
  listDispatchesForAttribution(
    fromIso: string,
    toIso: string
  ): {
    attributionState: string
    authMode: string
    costUsd: number | null
    tokensSource: string | null
  }[] {
    return this.d
      .select({
        attributionState: dispatches.attributionState,
        authMode: dispatches.authMode,
        costUsd: dispatches.costUsd,
        tokensSource: dispatches.tokensSource
      })
      .from(dispatches)
      .where(and(gte(dispatches.startedAt, fromIso), lte(dispatches.startedAt, toIso)))
      .all()
  }

  /* -------------------------------------------------------------------- */
  /* Attention capture (Phase 3a / Task 3a-2) over v7's attention_spans.    */
  /* THIS TASK AUTHORS NO MIGRATION — 3a-1 owns the table. Rows in, rows    */
  /* out; every classification decision lives in attentionCore.ts.          */
  /*                                                                        */
  /* ⚠ `seconds` is written as an ABSOLUTE value (samples x tick_seconds),  */
  /* never `seconds = seconds + 15`. The in-memory run is the authority, so */
  /* a retried write cannot double-credit, and "credited time is samples x  */
  /* tick_seconds and nothing else" is literal in the SQL rather than an    */
  /* invariant a reader has to reconstruct.                                 */
  /* -------------------------------------------------------------------- */

  /** Open a new span. Called on the FIRST tick of a run, so a tree-kill one
   *  millisecond later still leaves the run on disk. */
  openAttentionSpan(row: NewAttentionSpanRow): void {
    this.d.insert(attentionSpans).values(row).run()
  }

  /** Advance the open span. Called on EVERY subsequent tick — that is what
   *  bounds worst-case loss at one tick instead of at the length of the run. */
  extendAttentionSpan(id: string, endedAt: string, seconds: number): void {
    this.d
      .update(attentionSpans)
      .set({ endedAt, seconds })
      .where(eq(attentionSpans.id, id))
      .run()
  }

  /** Spans OVERLAPPING [fromIso, toIso] for a project — a run that began before
   *  the window and continues into it belongs to it. Defensive read, matching
   *  every other reader in this file: a hand-edited or corrupt row (unknown
   *  class, non-finite seconds) is DROPPED rather than thrown on, because a
   *  telemetry read must never be able to break the caller. */
  readAttentionSpans(projectId: string, fromIso: string, toIso: string): AttentionSpanRow[] {
    const rows = this.d
      .select()
      .from(attentionSpans)
      .where(
        and(
          eq(attentionSpans.projectId, projectId),
          lte(attentionSpans.startedAt, toIso),
          gte(attentionSpans.endedAt, fromIso)
        )
      )
      .orderBy(asc(attentionSpans.startedAt))
      .all()
    const classes = new Set<string>(attentionClassSchema.options)
    return rows.filter(
      (r) =>
        classes.has(r.class) &&
        Number.isFinite(r.seconds) &&
        r.seconds > 0 &&
        Number.isFinite(r.tickSeconds) &&
        r.tickSeconds > 0
    )
  }

  /** The kill switch (Task 3a-2): `attention_capture_enabled` in `settings`,
   *  DEFAULT ON, read live on every tick so flipping it takes effect without a
   *  restart. Same defensive-read discipline as getWindowBounds — an absent or
   *  corrupt row means the default, never a throw. There is deliberately no
   *  setter and no UI in this task (no dead UI, Task 3-4's bar); the row is
   *  written by hand or by a later settings task:
   *    INSERT INTO settings (key, value) VALUES ('attention_capture_enabled','false')
   *      ON CONFLICT(key) DO UPDATE SET value = excluded.value; */
  getAttentionCaptureEnabled(): boolean {
    const row = this.d
      .select()
      .from(settings)
      .where(eq(settings.key, 'attention_capture_enabled'))
      .get()
    if (!row) return true
    return row.value !== 'false'
  }

  /* -------------------------------------------------------------------- */
  /* v16: the agent-lock PIN. A `settings` row, not a column and not a new  */
  /* table — it is ONE global value, exactly the shape `window_bounds` and  */
  /* `active_project_id` already have.                                      */
  /*                                                                        */
  /* ⚠ THE STORED VALUE IS A scrypt DIGEST AND THERE IS NO READ PATH TO THE  */
  /* PIN ITSELF — the D33 clause 3 posture the vault takes with keys, in its */
  /* own small shape. `getAgentLockPinHash` is MAIN-SIDE ONLY and its return */
  /* value must never be put on an IPC response; the renderer is told        */
  /* WHETHER a pin exists (`hasAgentLockPin`) and nothing more.              */
  /* -------------------------------------------------------------------- */

  /** ⚠ NEVER PUT THIS ON THE WIRE. Verification happens in main, next to the
   *  guard it protects; the digest has no business in a renderer. */
  getAgentLockPinHash(): string | null {
    const row = this.d.select().from(settings).where(eq(settings.key, 'agent_lock_pin')).get()
    // An empty string is treated as absent rather than as a PIN nobody can
    // type — a hand-edited or half-written row must degrade to "no PIN set",
    // which is the state the whole feature still works in.
    return row && row.value.length > 0 ? row.value : null
  }

  hasAgentLockPin(): boolean {
    return this.getAgentLockPinHash() !== null
  }

  setAgentLockPinHash(hash: string): void {
    this.d
      .insert(settings)
      .values({ key: 'agent_lock_pin', value: hash })
      .onConflictDoUpdate({ target: settings.key, set: { value: hash } })
      .run()
  }

  /**
   * ⚠ CLEARING THE PIN DOES NOT UNLOCK ANYTHING, AND THE SEPARATION IS
   * DELIBERATE. `locked_at` is per-session state the user set on purpose; the
   * PIN is only what is asked for when clearing it. Cascading here would mean a
   * user who wanted to stop typing a PIN silently lost every guard they had
   * placed — destroying state to satisfy a preference. After this call the locks
   * stand and unlocking falls back to the plain confirm.
   */
  clearAgentLockPin(): void {
    this.d.delete(settings).where(eq(settings.key, 'agent_lock_pin')).run()
  }

  getWindowBounds(): WindowBounds | null {
    const row = this.d.select().from(settings).where(eq(settings.key, 'window_bounds')).get()
    if (!row) return null
    try {
      const b = JSON.parse(row.value) as WindowBounds
      if ([b.x, b.y, b.width, b.height].every((n) => Number.isFinite(n)) && b.width > 0 && b.height > 0) {
        return b
      }
    } catch {
      // fall through to null; a corrupt row just means default bounds
    }
    return null
  }

  saveWindowBounds(bounds: WindowBounds): void {
    const value = JSON.stringify(bounds)
    this.d
      .insert(settings)
      .values({ key: 'window_bounds', value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run()
  }

  /** Per-project view state (Task 1b-2 / D20): inline-Drizzle settings pair,
   *  key `view_state:<projectId>`, same shape as getWindowBounds. Defensive
   *  read: a corrupt or hand-edited row returns null so the caller's filmstrip
   *  default applies. Plain-TS shape guard here (matching getWindowBounds);
   *  main's view:get handler does the authoritative Zod parse on the way out. */
  getViewState(projectId: string): ViewState | null {
    const row = this.d
      .select()
      .from(settings)
      .where(eq(settings.key, `view_state:${projectId}`))
      .get()
    if (!row) return null
    try {
      const v = JSON.parse(row.value) as ViewState
      if (
        (v.mode === 'filmstrip' || v.mode === 'grid') &&
        (v.focusedSessionId === null || typeof v.focusedSessionId === 'string')
      ) {
        return { mode: v.mode, focusedSessionId: v.focusedSessionId }
      }
    } catch {
      // fall through to null; a corrupt row just means the default applies
    }
    return null
  }

  setViewState(projectId: string, state: ViewState): void {
    const key = `view_state:${projectId}`
    const value = JSON.stringify(state)
    this.d
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run()
  }

  /* -------------------------------------------------------------------- */
  /* Phase 3a / D43: launch profiles. Rows in, rows out — NO POLICY here.   */
  /* Resolution, precedence and validation all live in launchProfiles.ts.   */
  /* -------------------------------------------------------------------- */

  listLaunchProfiles(): LaunchProfileRow[] {
    return this.d.select().from(launchProfiles).orderBy(asc(launchProfiles.label)).all()
  }

  getLaunchProfileById(id: string): LaunchProfileRow | null {
    return this.d.select().from(launchProfiles).where(eq(launchProfiles.id, id)).get() ?? null
  }

  getLaunchProfileByLabel(label: string): LaunchProfileRow | null {
    return this.d.select().from(launchProfiles).where(eq(launchProfiles.label, label)).get() ?? null
  }

  createLaunchProfile(row: NewLaunchProfileRow): LaunchProfileRow {
    this.d.insert(launchProfiles).values(row).run()
    const created = this.getLaunchProfileById(row.id)
    if (!created) throw new Error(`launch profile ${row.id} vanished after insert`)
    return created
  }

  /** Patch semantics: absent = unchanged, null = clear, a value = set. The
   *  caller (main) has already validated the merged shape. */
  updateLaunchProfile(id: string, patch: Partial<NewLaunchProfileRow>): LaunchProfileRow | null {
    if (Object.keys(patch).length > 0) {
      this.d.update(launchProfiles).set(patch).where(eq(launchProfiles.id, id)).run()
    }
    return this.getLaunchProfileById(id)
  }

  deleteLaunchProfile(id: string): void {
    this.d.delete(launchProfiles).where(eq(launchProfiles.id, id)).run()
  }

  /**
   * F16 count-and-refuse inputs. Both are REQUIRED before their delete handler
   * runs — never let SQLite throw a SQLITE_CONSTRAINT_FOREIGNKEY and then
   * translate the error into a user message (the failure Task 2-3 already paid
   * for once). The FK exists to make the refusal MANDATORY, not to author it.
   */
  countLaunchProfilesForProvider(providerId: string): number {
    return (
      this.d
        .select({ n: count() })
        .from(launchProfiles)
        .where(eq(launchProfiles.providerId, providerId))
        .get()?.n ?? 0
    )
  }

  countLaunchProfilesForCredential(credentialProfileId: string): number {
    return (
      this.d
        .select({ n: count() })
        .from(launchProfiles)
        .where(eq(launchProfiles.credentialProfileId, credentialProfileId))
        .get()?.n ?? 0
    )
  }

  /**
   * The per-project last-used pointer, keyed `last_launch_profile:<projectId>` —
   * the `view_state:<projectId>` pattern above, verbatim.
   *
   * ⚠ PER-PROJECT, NOT GLOBAL. The profile you last used in *Chorus* tells you
   * nothing about what you want in *Chorus-Second*; defaulting the second
   * project's dialog to the first project's choice is the same category error
   * `recent_cwds` already commits (observed, cited, deliberately not fixed
   * here). Retiring one global-by-default fact and creating another in the same
   * commit would be indefensible.
   *
   * ⚠ IT STORES THE ID, AND ONLY THE ID (D43). A pointer holding a label would
   * silently lose its default the first time a user renamed the profile — and a
   * rename must have zero downstream consequences. A DANGLING id resolves to
   * "no default", never to a fuzzy label match; the resolution happens in main.
   */
  getLastLaunchProfileId(projectId: string): string | null {
    const row = this.d
      .select()
      .from(settings)
      .where(eq(settings.key, `last_launch_profile:${projectId}`))
      .get()
    return row?.value ?? null
  }

  setLastLaunchProfileId(projectId: string, profileId: string): void {
    const key = `last_launch_profile:${projectId}`
    this.d
      .insert(settings)
      .values({ key, value: profileId })
      .onConflictDoUpdate({ target: settings.key, set: { value: profileId } })
      .run()
  }

  /* -------------------------------------------------------------------- */
  /* Phase 3b / Task 3b-2 (D62): the council. Rows in, rows out — NO POLICY */
  /* here. Resolution, the D56 precedence order and every validator live in */
  /* councilMembers.ts; every refusal is authored in main.                  */
  /* -------------------------------------------------------------------- */

  /** Ordered by label so main never has to sort, and the renderer never does. */
  listCouncilMembers(): CouncilMemberRow[] {
    return this.d.select().from(councilMembers).orderBy(asc(councilMembers.label)).all()
  }

  getCouncilMemberById(id: string): CouncilMemberRow | null {
    return this.d.select().from(councilMembers).where(eq(councilMembers.id, id)).get() ?? null
  }

  getCouncilMemberByLabel(label: string): CouncilMemberRow | null {
    return this.d.select().from(councilMembers).where(eq(councilMembers.label, label)).get() ?? null
  }

  createCouncilMember(row: NewCouncilMemberRow): CouncilMemberRow {
    this.d.insert(councilMembers).values(row).run()
    const created = this.getCouncilMemberById(row.id)
    if (!created) throw new Error(`council member ${row.id} vanished after insert`)
    return created
  }

  /** Patch semantics: absent = unchanged, null = clear, a value = set. The
   *  caller (main) has already validated the MERGED shape. */
  updateCouncilMember(id: string, patch: Partial<NewCouncilMemberRow>): CouncilMemberRow | null {
    if (Object.keys(patch).length > 0) {
      this.d.update(councilMembers).set(patch).where(eq(councilMembers.id, id)).run()
    }
    return this.getCouncilMemberById(id)
  }

  deleteCouncilMember(id: string): void {
    this.d.delete(councilMembers).where(eq(councilMembers.id, id)).run()
  }

  /**
   * ⚠ THE DELETE GUARD'S EVIDENCE, and it must run BEFORE the delete statement
   * (F16/D62). `council_members.credential_profile_id` carries a REAL, ENFORCED
   * `REFERENCES`, so without this count SQLite throws
   * SQLITE_CONSTRAINT_FOREIGNKEY straight through `credential:delete` — a flow
   * that has worked since Task 3-2. The FK exists to make the refusal
   * MANDATORY; this function is what lets somebody AUTHOR it.
   *
   * It sits BESIDE `countLaunchProfilesForCredential` above, not instead of it:
   * a credential can be referenced by both kinds of row, and the refusal names
   * both counts distinctly so the message tells the user what to remove.
   */
  countCouncilMembersForCredential(credentialProfileId: string): number {
    return (
      this.d
        .select({ n: count() })
        .from(councilMembers)
        .where(eq(councilMembers.credentialProfileId, credentialProfileId))
        .get()?.n ?? 0
    )
  }

  /* ---- runs + messages: WRITTEN NOW, FIRST CALLED IN TASK 3b-3 ----------
   *
   * ⚠ Deliberately unused by this task — the `attention_spans` precedent (v7),
   * where a table and its accessors shipped one task before their only writer
   * so the phase's schema churn stays in ONE migration. Both tables are created
   * EMPTY by v11 and nothing here inserts a row during 3b-2.
   */

  createCouncilRun(row: NewCouncilRunRow): CouncilRunRow {
    this.d.insert(councilRuns).values(row).run()
    const created = this.getCouncilRunById(row.id)
    if (!created) throw new Error(`council run ${row.id} vanished after insert`)
    return created
  }

  getCouncilRunById(id: string): CouncilRunRow | null {
    return this.d.select().from(councilRuns).where(eq(councilRuns.id, id)).get() ?? null
  }

  /** Newest first — a run list is read as history. */
  listCouncilRuns(): CouncilRunRow[] {
    return this.d.select().from(councilRuns).orderBy(desc(councilRuns.startedAt)).all()
  }

  /**
   * The Docket's read (D113): one project's runs, newest first.
   *
   * ⚠ `project_id` CARRIES NO `REFERENCES` and this query does not pretend it
   * does. D62 made a run a historical fact that outlives its project, so a row
   * whose project has been deleted simply stops matching here — it is not
   * orphaned, not cascaded, and not repaired. The same reason `listCouncilRuns`
   * above exists unfiltered.
   *
   * ⚠ AND IT DELIBERATELY DOES NOT FILTER ON `case_id`, because there is no such
   * column yet (D112 ships the Docket ahead of D105's cases). Runs made before
   * this feature therefore appear, which is the intent: they are the only
   * history there is.
   */
  listCouncilRunsForProject(projectId: string): CouncilRunRow[] {
    return this.d
      .select()
      .from(councilRuns)
      .where(eq(councilRuns.projectId, projectId))
      .orderBy(desc(councilRuns.startedAt))
      .all()
  }

  updateCouncilRun(id: string, patch: Partial<NewCouncilRunRow>): CouncilRunRow | null {
    if (Object.keys(patch).length > 0) {
      this.d.update(councilRuns).set(patch).where(eq(councilRuns.id, id)).run()
    }
    return this.getCouncilRunById(id)
  }

  /**
   * ⚠ PURGES ITS OWN MESSAGES, IN ONE TRANSACTION, BECAUSE SQLITE WILL NOT.
   * `council_messages.run_id` is a SOFT pointer with no `REFERENCES` (D62: a
   * transcript is a historical fact and must survive its member's deletion), so
   * there is no cascade to inherit. The explicit purge is the
   * `deleteProviderConfig` -> `model_catalog` precedent: the table that carries
   * no FK is the one whose owner has to clean up after it.
   *
   * Nothing calls this yet. It exists so 3b-3 inherits the transaction rather
   * than inventing a second, half-atomic one.
   */
  deleteCouncilRun(id: string): void {
    this.d.transaction((tx) => {
      tx.delete(councilMessages).where(eq(councilMessages.runId, id)).run()
      tx.delete(councilRuns).where(eq(councilRuns.id, id)).run()
    })
  }

  appendCouncilMessage(row: NewCouncilMessageRow): CouncilMessageRow {
    this.d.insert(councilMessages).values(row).run()
    const created =
      this.d.select().from(councilMessages).where(eq(councilMessages.id, row.id)).get() ?? null
    if (!created) throw new Error(`council message ${row.id} vanished after insert`)
    return created
  }

  /**
   * Turn and token totals for many runs in ONE `GROUP BY` — `countSessionsByProject`'s
   * precedent (D80), and for the same reason it was written that way.
   *
   * ⚠ N ROUND-TRIPS HERE WOULD BE N TRANSCRIPT SCANS. The Docket asks for every
   * run in a project at once, and `council_messages.content` holds whole model
   * turns — a per-run call that selected rows to count them in JS would drag
   * megabytes of prose across the boundary to produce four integers. This never
   * touches `content`.
   *
   * Runs with no messages are ABSENT from the map rather than zero, exactly as
   * `countSessionsByProject` leaves session-less projects absent: the caller
   * decides what "no rows" reads as, and this stays a faithful report of what the
   * table holds.
   */
  getCouncilRunStats(runIds: readonly string[]): Map<string, CouncilRunStats> {
    // ⚠ `inArray` on an empty list compiles to a SQL `false` in some drivers and
    // to a syntax error in others. Neither is worth finding out about at runtime.
    if (runIds.length === 0) return new Map()
    const rows = this.d
      .select({
        runId: councilMessages.runId,
        turns: count(),
        tokensIn: sum(councilMessages.tokensIn),
        tokensOut: sum(councilMessages.tokensOut),
        turnsWithTokens: count(councilMessages.tokensIn)
      })
      .from(councilMessages)
      .where(inArray(councilMessages.runId, [...runIds]))
      .groupBy(councilMessages.runId)
      .all()
    return new Map(
      rows.map((r) => [
        r.runId,
        {
          turns: r.turns,
          // ⚠ SQLite's SUM() comes back as a string through drizzle, and `null`
          // when every summed row was null. `Number(null)` is 0 — the exact
          // coercion that would turn "nobody reported usage" into "zero tokens",
          // so the null is checked before the cast rather than after.
          tokensIn: r.tokensIn === null ? null : Number(r.tokensIn),
          tokensOut: r.tokensOut === null ? null : Number(r.tokensOut),
          turnsWithTokens: r.turnsWithTokens
        }
      ])
    )
  }

  /**
   * The turns the Verdict strip is derived from (D106), for many runs at once.
   *
   * ⚠ TWO PHASES, NOT ALL OF THEM, AND THAT IS THE WHOLE REASON THIS EXISTS
   * SEPARATELY FROM `getCouncilMessagesForRun`. The strip needs the members'
   * verdict tokens (positions) and the arbiter's ruling block (arbitration).
   * Critique and synthesis turns are the LONGEST in a run and contribute nothing
   * to it — dragging them across to be discarded would roughly double the read
   * for every row in the Docket.
   *
   * Ordered by run then round so the caller can group without re-sorting.
   */
  getCouncilVerdictSource(
    runIds: readonly string[]
  ): { runId: string; memberId: string | null; phase: string; content: string }[] {
    if (runIds.length === 0) return []
    return this.d
      .select({
        runId: councilMessages.runId,
        memberId: councilMessages.memberId,
        phase: councilMessages.phase,
        content: councilMessages.content
      })
      .from(councilMessages)
      .where(
        and(
          inArray(councilMessages.runId, [...runIds]),
          inArray(councilMessages.phase, ['positions', 'arbitration'])
        )
      )
      .orderBy(asc(councilMessages.runId), asc(councilMessages.round), asc(councilMessages.createdAt))
      .all()
  }

  /** Round then insertion order — the shape the `council_messages_run` index
   *  (run_id, round) was created for. */
  getCouncilMessagesForRun(runId: string): CouncilMessageRow[] {
    return this.d
      .select()
      .from(councilMessages)
      .where(eq(councilMessages.runId, runId))
      .orderBy(asc(councilMessages.round), asc(councilMessages.createdAt))
      .all()
  }

  /* ---- Phase 6 / Task 6-3: per-project memory configuration -------------
   *
   * Three accessors and no fourth. In particular there is NO
   * `countProjectMemoryForCredential` — D128(a) took credentialed mode out of
   * Phase 6, so `credential_profile_id` is always NULL and a count with no
   * caller would be a refusal message nobody can read. ⚠ THAT IS A DEFERRAL,
   * NOT A DISCHARGE, and the instruction for whoever ships credentialed memory
   * lives in the v16 migration SQL above rather than here, so that a reader of
   * the schema meets it at the column it concerns.
   *
   * ⚠ AND IT IS DELIBERATELY NOT THE `attention_spans` PRECEDENT (:2457–2463),
   * which shipped accessors ONE TASK BEFORE their only writer to keep a phase's
   * schema churn in one migration. That reasoning does not reach this case: there
   * the writer was one task away inside the same phase; here it left the phase
   * entirely with eight council preconditions attached.
   */

  getProjectMemory(projectId: string): ProjectMemoryRow | null {
    return (
      this.d.select().from(projectMemory).where(eq(projectMemory.projectId, projectId)).get() ?? null
    )
  }

  /**
   * Configure or re-configure a project's memory. One row per project, so a
   * re-configure REPLACES rather than accumulating — `created_at` is preserved
   * across it, because the config's identity is the project and re-pointing it
   * at a different Neo4j does not make it a new thing.
   */
  upsertProjectMemory(row: NewProjectMemoryRow): ProjectMemoryRow {
    const existing = this.getProjectMemory(row.projectId)
    if (existing) {
      this.d
        .update(projectMemory)
        .set({ ...row, createdAt: existing.createdAt })
        .where(eq(projectMemory.projectId, row.projectId))
        .run()
    } else {
      this.d.insert(projectMemory).values(row).run()
    }
    const saved = this.getProjectMemory(row.projectId)
    if (!saved) throw new Error(`project memory for ${row.projectId} vanished after write`)
    return saved
  }

  /** ⚠ DELETES THE CONFIG, NEVER THE GRAPH. Nothing here speaks bolt; the data
   *  in Neo4j is untouched and the UI must say so. Returns whether a row went,
   *  so `memory:disable` on an unconfigured project is a no-op rather than a
   *  lie. */
  deleteProjectMemory(projectId: string): boolean {
    return (
      this.d.delete(projectMemory).where(eq(projectMemory.projectId, projectId)).run().changes > 0
    )
  }

  close(): void {
    this.db.close()
  }

  /** Resolve the legacy one-row-per-(project, agent) session for the lazy
   *  flat-layout conversion, creating it when absent so converted leaves bind
   *  stable row ids. Existing rows are reused so ids stay stable. */
  private findOrCreateSession(projectId: string, agent: AgentKind): SessionRow {
    const existing = this.d
      .select()
      .from(sessions)
      .where(and(eq(sessions.projectId, projectId), eq(sessions.agent, agent)))
      .get()
    if (existing) return existing
    const project = this.d.select().from(projects).where(eq(projects.id, projectId)).get()
    if (!project) throw new Error(`findOrCreateSession: unknown project ${projectId}`)
    return this.createSession({
      id: randomUUID(),
      projectId,
      agent,
      cwd: project.rootPath,
      status: 'running',
      exitCode: null,
      createdAt: new Date().toISOString()
    })
  }

  /**
   * Rows that name a project which does not exist (F47).
   *
   * ⚠ THIS EXISTS BECAUSE "FOREIGN KEYS ARE ENFORCED" TURNED OUT TO BE TRUE OF
   * WRITES AND NOT OF THE TABLE. F16 established that better-sqlite3 v12 turns
   * `PRAGMA foreign_keys` ON by default, and several decisions rest on it — but
   * the pragma is PER CONNECTION and applies at WRITE TIME. It says nothing
   * about rows that were already there, and this database held 22 session rows
   * failing SQLite's own `PRAGMA foreign_key_check`, written in the project's
   * first week by a hand edit or a harness that removed a projects row without
   * its children. Nothing surfaced them for six weeks because every read is
   * scoped by `project_id` and no project had those ids.
   *
   * ⚠ IT COVERS THE SOFT POINTERS TOO, AND THOSE ARE THE HALF THAT MATTERS
   * MOST. `dispatches`, `attention_spans` and `council_runs` carry NO
   * `REFERENCES` clause on purpose (v7: telemetry must outlive the session it
   * describes), so `foreign_key_check` will never mention them however broken
   * they get — this is the only thing that can. Proof that it is not
   * theoretical: the orphan attention span found alongside those sessions names
   * a THIRD project id, one the FK-checked tables never mentioned.
   *
   * Read once at boot and reported only when non-zero (see `src/main/index.ts`),
   * so a clean database stays silent and a damaged one says so instead of
   * being discovered a year later.
   */
  countOrphanedProjectRows(): { table: string; n: number }[] {
    // One round trip. Every table that carries a `project_id`, FK-enforced or
    // not, counted against the projects that actually exist.
    const rows = this.db
      .prepare(
        `SELECT 'sessions' AS "table", COUNT(*) AS n FROM sessions
           WHERE project_id NOT IN (SELECT id FROM projects)
         UNION ALL SELECT 'worktrees', COUNT(*) FROM worktrees
           WHERE project_id NOT IN (SELECT id FROM projects)
         UNION ALL SELECT 'pane_layouts', COUNT(*) FROM pane_layouts
           WHERE project_id NOT IN (SELECT id FROM projects)
         UNION ALL SELECT 'dispatches', COUNT(*) FROM dispatches
           WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM projects)
         UNION ALL SELECT 'attention_spans', COUNT(*) FROM attention_spans
           WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM projects)
         UNION ALL SELECT 'council_runs', COUNT(*) FROM council_runs
           WHERE project_id NOT IN (SELECT id FROM projects)`
      )
      .all() as { table: string; n: number }[]
    return rows.filter((r) => r.n > 0)
  }

  private migrate(): void {
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)'
    )
    const applied = (
      this.db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as {
        v: number
      }
    ).v
    for (let version = applied + 1; version <= MIGRATIONS.length; version++) {
      const apply = this.db.transaction(() => {
        this.db.exec(MIGRATIONS[version - 1])
        this.db
          .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
          .run(version, new Date().toISOString())
      })
      apply()
    }
  }
}
