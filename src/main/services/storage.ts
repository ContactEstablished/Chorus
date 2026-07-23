import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { basename } from 'path'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { and, asc, count, eq } from 'drizzle-orm'
import * as schema from '../db/schema'
import { credentialProfiles, paneLayouts, projects, providerConfigs, sessions, settings, worktrees } from '../db/schema'
import { logger } from './logger'
import type { CredentialProfileRow, NewCredentialProfileRow, NewProviderConfigRow, NewSessionRow, NewWorktreeRow, ProviderConfigRow, SessionRow, WorktreeRow } from '../db/schema'
import {
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
      extraHeadersJson: row.extraHeadersJson ?? null
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
   *  (countCredentialProfilesForProvider), never reverse-engineer the throw. */
  deleteProviderConfig(id: string): void {
    this.d.delete(providerConfigs).where(eq(providerConfigs.id, id)).run()
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

  /** Written by Task 3-6's test-key probe only — no writer exists yet. */
  markCredentialVerified(id: string, at: string): void {
    this.d.update(credentialProfiles).set({ lastVerifiedAt: at }).where(eq(credentialProfiles.id, id)).run()
  }

  deleteCredentialProfile(id: string): void {
    this.d.delete(credentialProfiles).where(eq(credentialProfiles.id, id)).run()
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
