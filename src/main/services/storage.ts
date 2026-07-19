import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { basename } from 'path'
import { layoutGetResponseSchema, type Pane } from '../../shared/ipc'

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

/** Default layout for a new project: Claude Code left, Codex right. */
const DEFAULT_LAYOUT: Pane[] = [
  { slot: 0, agent: 'claude' },
  { slot: 1, agent: 'codex' }
]

/**
 * Numbered migrations, applied in order inside a transaction. Table names
 * follow the master data model (docs/PLAN.md §13); columns arrive as the
 * features that need them do.
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
   );`
]

/**
 * SQLite-backed persistence, main process only. Nothing here crosses an IPC
 * boundary unvalidated: layout rows are re-parsed with the shared Zod schema
 * on read, so a hand-edited database cannot feed the renderer bad shapes.
 */
export class StorageService {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.migrate()
  }

  /** Find the project for this root path, creating and seeding it on first run. */
  getOrCreateProject(rootPath: string): ProjectRecord {
    const existing = this.db
      .prepare('SELECT id, name, root_path FROM projects WHERE root_path = ?')
      .get(rootPath) as { id: string; name: string; root_path: string } | undefined
    if (existing) {
      return { id: existing.id, name: existing.name, rootPath: existing.root_path }
    }

    const project: ProjectRecord = { id: randomUUID(), name: basename(rootPath), rootPath }
    const insert = this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO projects (id, name, root_path, created_at) VALUES (?, ?, ?, ?)')
        .run(project.id, project.name, project.rootPath, new Date().toISOString())
      this.db
        .prepare('INSERT INTO pane_layouts (project_id, layout_json) VALUES (?, ?)')
        .run(project.id, JSON.stringify(DEFAULT_LAYOUT))
    })
    insert()
    return project
  }

  getPaneLayout(projectId: string): Pane[] {
    const row = this.db
      .prepare('SELECT layout_json FROM pane_layouts WHERE project_id = ?')
      .get(projectId) as { layout_json: string } | undefined
    if (!row) return DEFAULT_LAYOUT
    const parsed = layoutGetResponseSchema.safeParse(JSON.parse(row.layout_json))
    return parsed.success ? parsed.data : DEFAULT_LAYOUT
  }

  getWindowBounds(): WindowBounds | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'window_bounds'").get() as
      | { value: string }
      | undefined
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
    this.db
      .prepare(
        "INSERT INTO settings (key, value) VALUES ('window_bounds', ?) " +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run(JSON.stringify(bounds))
  }

  close(): void {
    this.db.close()
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
