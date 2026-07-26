import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { basename } from 'path'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { and, asc, count, desc, eq, gte, isNotNull, isNull, lte, max } from 'drizzle-orm'
import * as schema from '../db/schema'
import { attentionSpans, councilMembers, councilMessages, councilRuns, credentialProfiles, dispatches, launchProfiles, modelCatalog, paneLayouts, projects, providerConfigs, sessions, settings, worktrees } from '../db/schema'
import { logger } from './logger'
import type { AttentionSpanRow, CouncilMemberRow, CouncilMessageRow, CouncilRunRow, CredentialProfileRow, DispatchRow, LaunchProfileRow, ModelCatalogRow, NewAttentionSpanRow, NewCouncilMemberRow, NewCouncilMessageRow, NewCouncilRunRow, NewCredentialProfileRow, NewDispatchRow, NewLaunchProfileRow, NewProviderConfigRow, NewSessionRow, NewWorktreeRow, ProviderConfigRow, SessionRow, WorktreeRow } from '../db/schema'
import type { CatalogDiff } from './modelCatalogCore'
import { sessionIsCredentialed } from './launchProfiles'
import {
  attentionClassSchema,
  layoutJsonSchema,
  legacyFlatLayoutSchema,
  type AgentKind,
  type SessionStatus,
  type ViewState
} from '../../shared/ipc'
import { convertLegacyFlatLayout, normalizeTree, type LayoutJson } from '../../shared/layout'

export interface ProjectRecord {
  id: string
  name: string
  rootPath: string
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
   CREATE INDEX council_messages_run ON council_messages (run_id, round);`
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

  /** Find the project for this root path, creating it on first run. */
  getOrCreateProject(rootPath: string): ProjectRecord {
    const existing = this.d.select().from(projects).where(eq(projects.rootPath, rootPath)).get()
    if (existing) {
      return { id: existing.id, name: existing.name, rootPath: existing.rootPath }
    }

    const project: ProjectRecord = { id: randomUUID(), name: basename(rootPath), rootPath }
    // Task 1-4: NO first-run seed. A new project has no pane_layouts row and
    // no session rows — sessions are created explicitly via the launch flow,
    // and the absent layout row is what shows the empty state. (Existing DBs
    // keep their seeded layout; this only affects DBs created from here on.)
    this.d
      .insert(projects)
      .values({ id: project.id, name: project.name, rootPath, createdAt: new Date().toISOString() })
      .run()
    return project
  }

  /** All projects, in creation order (tab order). */
  listProjects(): ProjectRecord[] {
    return this.d
      .select()
      .from(projects)
      .orderBy(asc(projects.createdAt))
      .all()
      .map((p) => ({ id: p.id, name: p.name, rootPath: p.rootPath }))
  }

  getProjectById(id: string): ProjectRecord | null {
    const row = this.d.select().from(projects).where(eq(projects.id, id)).get()
    return row ? { id: row.id, name: row.name, rootPath: row.rootPath } : null
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
      worktreeId: row.worktreeId ?? null,
      // v10: written on the SAME insert as the row, never in a follow-up
      // update — a crash between the two would leave a credentialed session
      // unmarked, which is the silent-keyless-restore failure through the back
      // door. The caller passes it in `row`; this only normalizes the default.
      launchProfileId: row.launchProfileId ?? null
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
