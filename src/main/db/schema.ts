import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * Drizzle table definitions mirroring the existing hand-rolled DDL, plus the
 * `sessions` table (migration version 2) and the `worktrees` table
 * (migration version 4, Phase 2).
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
  // Nullable (D19): NULL until a title event (OSC 0/2 or first-line fallback)
  // lands via session:set-title. Matches migration v3's DDL exactly.
  title: text('title'),
  worktreeId: text('worktree_id'), // nullable; set when a session owns a worktree (D26 Q1/(a))
  createdAt: text('created_at').notNull()
})

/**
 * Phase 2 / D26 action 1: one row per managed git worktree. DB-first journaled
 * (status 'creating' before any fs/git op; 'active' only after success);
 * states creating → provisioning → active → detached → removing. A worktree
 * outlives its owning session by design (D26 Q1). Matches migration v4's DDL.
 */
export const worktrees = sqliteTable('worktrees', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  // Nullable, NO cascade: a detached worktree has session_id = NULL and so
  // does not block the owning session's deletion (D26 Q1). NOTE: enforced,
  // not documentation-only — better-sqlite3 v12 turns PRAGMA foreign_keys=ON
  // by default, so 2-3's delete flow must detach BEFORE deleting a session.
  sessionId: text('session_id').references(() => sessions.id),
  path: text('path').notNull().unique(),
  branch: text('branch').notNull(),
  baseBranch: text('base_branch').notNull(),
  repoRoot: text('repo_root').notNull(),
  // 'creating' | 'provisioning' | 'active' | 'detached' | 'removing'
  status: text('status').notNull(),
  createdAt: text('created_at').notNull()
})

export type ProjectRow = typeof projects.$inferSelect
export type PaneLayoutRow = typeof paneLayouts.$inferSelect
export type SessionRow = typeof sessions.$inferSelect
export type NewSessionRow = typeof sessions.$inferInsert
export type WorktreeRow = typeof worktrees.$inferSelect
export type NewWorktreeRow = typeof worktrees.$inferInsert
