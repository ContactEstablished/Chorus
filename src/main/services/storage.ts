import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { basename } from 'path'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { and, asc, count, desc, eq, gte, isNotNull, isNull, lte, max } from 'drizzle-orm'
import * as schema from '../db/schema'
import { attentionSpans, credentialProfiles, dispatches, modelCatalog, paneLayouts, projects, providerConfigs, sessions, settings, worktrees } from '../db/schema'
import { logger } from './logger'
import type { AttentionSpanRow, CredentialProfileRow, DispatchRow, ModelCatalogRow, NewAttentionSpanRow, NewCredentialProfileRow, NewDispatchRow, NewProviderConfigRow, NewSessionRow, NewWorktreeRow, ProviderConfigRow, SessionRow, WorktreeRow } from '../db/schema'
import type { CatalogDiff } from './modelCatalogCore'
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
   );`
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
  /* Task 3-6 Step 7 (decision b, F26): which session rows launched on a    */
  /* stored credential. A JSON array of session ids in the settings table — */
  /* data, not schema, so decision (b) needs no second migration. The mark  */
  /* is what lets the restore engine heal those rows to honest exited       */
  /* chrome instead of relaunching them KEYLESS, and lets session:restart   */
  /* refuse them. It stores IDS ONLY — never a profile id, never key        */
  /* material. Cleared per-row by session:delete.                           */
  /* -------------------------------------------------------------------- */

  getCredentialedSessionIds(): Set<string> {
    const row = this.d.select().from(settings).where(eq(settings.key, 'credentialed_sessions')).get()
    if (!row) return new Set()
    try {
      const arr: unknown = JSON.parse(row.value)
      return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [])
    } catch {
      return new Set()
    }
  }

  private writeCredentialedSessionIds(ids: Set<string>): void {
    const value = JSON.stringify([...ids])
    this.d
      .insert(settings)
      .values({ key: 'credentialed_sessions', value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run()
  }

  markSessionCredentialed(sessionId: string): void {
    const ids = this.getCredentialedSessionIds()
    if (ids.has(sessionId)) return
    ids.add(sessionId)
    this.writeCredentialedSessionIds(ids)
  }

  unmarkSessionCredentialed(sessionId: string): void {
    const ids = this.getCredentialedSessionIds()
    if (!ids.delete(sessionId)) return
    this.writeCredentialedSessionIds(ids)
  }

  createSession(row: NewSessionRow): SessionRow {
    this.d.insert(sessions).values(row).run()
    return { ...row, exitCode: row.exitCode ?? null, title: row.title ?? null, worktreeId: row.worktreeId ?? null }
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

  /** ⚠ THE BOOT RECONCILE'S INPUT: every OPEN ledger row. "Open" is
   *  `revoked_at IS NULL` AND a hash present — never `outcome IS NULL`, which
   *  is 3a-1's separate notion of an open DISPATCH. The two are different
   *  questions and conflating them is how a live dispatch's key gets revoked. */
  listOpenMintLedger(): { dispatchId: string; hash: string }[] {
    return this.d
      .select({ dispatchId: dispatches.id, hash: dispatches.mintedKeyHash })
      .from(dispatches)
      .where(and(isNull(dispatches.revokedAt), isNotNull(dispatches.mintedKeyHash)))
      .all()
      .filter((r): r is { dispatchId: string; hash: string } => typeof r.hash === 'string')
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
