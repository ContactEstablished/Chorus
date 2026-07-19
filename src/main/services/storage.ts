import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { basename } from 'path'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { and, asc, eq } from 'drizzle-orm'
import * as schema from '../db/schema'
import { paneLayouts, projects, sessions, settings } from '../db/schema'
import type { NewSessionRow, SessionRow } from '../db/schema'
import {
  layoutJsonSchema,
  legacyFlatLayoutSchema,
  type AgentKind,
  type SessionStatus
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

/** Default pane set for a new project: Claude Code left, Codex right. */
const DEFAULT_AGENTS: AgentKind[] = ['claude', 'codex']

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

  /** Find the project for this root path, creating and seeding it on first run. */
  getOrCreateProject(rootPath: string): ProjectRecord {
    const existing = this.d.select().from(projects).where(eq(projects.rootPath, rootPath)).get()
    if (existing) {
      return { id: existing.id, name: existing.name, rootPath: existing.rootPath }
    }

    const project: ProjectRecord = { id: randomUUID(), name: basename(rootPath), rootPath }
    const now = new Date().toISOString()
    // A brand-new project must start with a VALID TREE, so its two session
    // rows are created first (stable ids) and the seeded tree's leaves
    // reference them — all in one transaction.
    const flat = DEFAULT_AGENTS.map((agent, slot) => ({ slot, agent }))
    const idsByAgent = new Map<AgentKind, string>(DEFAULT_AGENTS.map((agent) => [agent, randomUUID()]))
    const layout = convertLegacyFlatLayout(flat, (agent) => idsByAgent.get(agent as AgentKind)!)
    this.d.transaction((tx) => {
      tx.insert(projects)
        .values({ id: project.id, name: project.name, rootPath, createdAt: now })
        .run()
      for (const agent of DEFAULT_AGENTS) {
        tx.insert(sessions)
          .values({
            id: idsByAgent.get(agent)!,
            projectId: project.id,
            agent,
            cwd: rootPath,
            status: 'running',
            exitCode: null,
            createdAt: now
          })
          .run()
      }
      tx.insert(paneLayouts)
        .values({ projectId: project.id, layoutJson: JSON.stringify(layout) })
        .run()
    })
    return project
  }

  /**
   * Read the persisted layout as a versioned tree. Three shapes handled:
   *  1. valid tree v1  -> normalize (clamp ratios, dedupe keep-first), return
   *  2. legacy flat array (pre-1-2 content) -> lazy conversion: resolve or
   *     create the stable sessions rows, convert, WRITE THE TREE BACK, return
   *  3. anything else -> log + regenerate the default layout (never crash)
   */
  getPaneLayout(projectId: string): LayoutJson {
    const row = this.d.select().from(paneLayouts).where(eq(paneLayouts.projectId, projectId)).get()
    if (!row) {
      const layout = this.buildDefaultLayout(projectId)
      this.savePaneLayout(projectId, layout)
      return layout
    }

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
        console.log('[storage] converted legacy flat pane layout to layout tree v1')
        return layout
      }
    }

    console.warn('[storage] pane_layouts.layout_json invalid; regenerated default layout')
    const layout = this.buildDefaultLayout(projectId)
    this.savePaneLayout(projectId, layout)
    return layout
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

  createSession(row: NewSessionRow): SessionRow {
    this.d.insert(sessions).values(row).run()
    return { ...row, exitCode: row.exitCode ?? null }
  }

  getSessionsForProject(projectId: string): SessionRow[] {
    return this.d
      .select()
      .from(sessions)
      .where(eq(sessions.projectId, projectId))
      .orderBy(asc(sessions.createdAt))
      .all()
  }

  updateSessionStatus(id: string, status: SessionStatus, exitCode?: number | null): void {
    this.d
      .update(sessions)
      .set(exitCode === undefined ? { status } : { status, exitCode })
      .where(eq(sessions.id, id))
      .run()
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

  close(): void {
    this.db.close()
  }

  /** Default two-pane layout: one stable session row per default agent
   *  (reused when already present), leaves reference the row ids. */
  private buildDefaultLayout(projectId: string): LayoutJson {
    const flat = DEFAULT_AGENTS.map((agent, slot) => ({ slot, agent }))
    return convertLegacyFlatLayout(
      flat,
      (agent) => this.findOrCreateSession(projectId, agent as AgentKind).id
    )
  }

  /** One session row per (project, agent) in Phase 1; multi-session-per-kind
   *  arrives in Task 1-4. Existing rows are reused so ids stay stable. */
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
