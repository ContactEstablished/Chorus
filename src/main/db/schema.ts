import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * Drizzle table definitions mirroring the existing hand-rolled DDL, plus the
 * new `sessions` table (migration version 2).
 *
 * Deliberate scope cut (D7): Drizzle provides schema TYPES + TYPED QUERIES
 * only. Migrations stay in the hand-rolled MIGRATIONS array + the
 * schema_migrations runner in storage.ts — swapping the migration engine and
 * the query layer at the same time doubles risk. drizzle-kit migrations can
 * be revisited when schema churn grows.
 */

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  rootPath: text('root_path').notNull().unique(),
  createdAt: text('created_at').notNull()
})

export const paneLayouts = sqliteTable('pane_layouts', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id),
  layoutJson: text('layout_json').notNull()
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

export const schemaMigrations = sqliteTable('schema_migrations', {
  version: integer('version').primaryKey(),
  appliedAt: text('applied_at').notNull()
})

/**
 * Stable session identity: one row per session, with an id that survives PTY
 * re-creation and app restarts. From Task 1-2 on, session identity is this row
 * id — the PTY instance is ephemeral and re-created under the same id.
 */
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  agent: text('agent').notNull(), // 'claude' | 'codex'
  cwd: text('cwd').notNull(),
  status: text('status').notNull(), // 'running' | 'exited'
  exitCode: integer('exit_code'),
  createdAt: text('created_at').notNull()
})

export type ProjectRow = typeof projects.$inferSelect
export type PaneLayoutRow = typeof paneLayouts.$inferSelect
export type SessionRow = typeof sessions.$inferSelect
export type NewSessionRow = typeof sessions.$inferInsert
