import { sqliteTable, text, integer, blob, real } from 'drizzle-orm/sqlite-core'

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

/**
 * Phase 3 / D33 action 1 + resolution (e): one row per provider connection —
 * NON-SECRET metadata only (base_url / extra_headers_json are documented
 * non-secret; the credential envelope's own values override them). Secrets
 * never live here. Matches migration v5's DDL column for column.
 */
export const providerConfigs = sqliteTable('provider_configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  adapterType: text('adapter_type').notNull(),
  authMode: text('auth_mode').notNull(),
  // D34(e): overrides the adapter's AuthMethodDefinition.requiredEnvVar for
  // custom / OpenAI-compatible endpoints. NULL = use the adapter default.
  envVarName: text('env_var_name'),
  // Plaintext and DOCUMENTED NON-SECRET (D33 resolution e). The credential
  // envelope's own baseUrl/extraHeaders override these when present.
  baseUrl: text('base_url'),
  extraHeadersJson: text('extra_headers_json'),
  // D48 (migration v6): the route's DEFAULT model id (e.g. an OpenRouter
  // model slug). Nullable — a subscription route has no model to name. A
  // default, not an authority: Phase 3a's launch_profiles will override it.
  // Matches migration v6's DDL exactly.
  model: text('model'),
  createdAt: text('created_at').notNull()
})

/**
 * Phase 3 / D33: one row per stored credential. The envelope ({key, baseUrl?,
 * extraHeaders?}) lives ONLY inside encrypted_blob (safeStorage/DPAPI); every
 * other column is plaintext metadata that lets the UI list and disambiguate
 * profiles without decrypting. UNIQUE (provider_id, label) is enforced by the
 * hand-rolled DDL (D7: Drizzle is types + queries only) and throws
 * SQLITE_CONSTRAINT_UNIQUE on a duplicate — caught and converted by the vault.
 */
export const credentialProfiles = sqliteTable('credential_profiles', {
  id: text('id').primaryKey(),
  // ENFORCED FK (F16): deleting a provider that still has profiles throws
  // SQLITE_CONSTRAINT_FOREIGNKEY — provider:delete must count-and-refuse
  // BEFORE SQLite throws.
  providerId: text('provider_id')
    .notNull()
    .references(() => providerConfigs.id),
  label: text('label').notNull(),
  // The safeStorage/DPAPI envelope. mode:'buffer' keeps better-sqlite3's
  // native Buffer round-trip — a text column would corrupt binary output.
  encryptedBlob: blob('encrypted_blob', { mode: 'buffer' }).notNull(),
  // Salted SHA-256, MAIN-SIDE ONLY (D33 resolution b): duplicate detection at
  // creation and rotation detection. Never crosses IPC.
  fingerprintHash: text('fingerprint_hash').notNull(),
  createdAt: text('created_at').notNull(),
  lastVerifiedAt: text('last_verified_at'),
  // D33 clause 8: set when decryption fails; the row SURVIVES and launches
  // naming this profile are refused by label.
  unavailableSince: text('unavailable_since'),
  // D33 risk 7 throttle for the shouldReEncrypt path.
  reencryptedAt: text('reencrypted_at')
})

export type ProviderConfigRow = typeof providerConfigs.$inferSelect
export type NewProviderConfigRow = typeof providerConfigs.$inferInsert
export type CredentialProfileRow = typeof credentialProfiles.$inferSelect
export type NewCredentialProfileRow = typeof credentialProfiles.$inferInsert

/**
 * Phase 3a / Task 3a-1 (migration v7): one row per agent RUN. Mission Control
 * spec §5.2 + §9 Phase 0.
 *
 * A dispatch is NOT a session. One sessions row may own MANY dispatches over
 * its life (each restore relaunch is a fresh conversation, Phase 8 open
 * question 1), and a dispatch OUTLIVES its session row (pane close deletes it,
 * D16 resolution d). Hence NO .references() on any column here — the FK would
 * be enforced (F16) and RESTRICT would break session:delete. session_id and
 * project_id are opaque strings.
 *
 * The token/cost columns live on THIS row, not in a separate usage_records
 * table: they describe the same run (D48 — one home, not two). Written by
 * Task 3a-3; NULL until then.
 */
export const dispatches = sqliteTable('dispatches', {
  id: text('id').primaryKey(),
  sessionId: text('session_id'),
  projectId: text('project_id'),
  // Nullable and unwritten until a task seed exists (spec §9 Phase 0).
  taskId: text('task_id'),
  agent: text('agent').notNull(),
  model: text('model'),
  providerName: text('provider_name'),
  // D42: attribution strategy is keyed on auth mode. 'subscription' | 'api_key'.
  authMode: text('auth_mode').notNull(),
  cwd: text('cwd').notNull(),
  startedAt: text('started_at').notNull(),
  // NULL after close means the end was never OBSERVED (boot-healed orphan).
  endedAt: text('ended_at'),
  // NULL means OPEN. 'completed' | 'abandoned' | 'failed'.
  outcome: text('outcome'),
  // 'exit' | 'kill' | 'dispose' | 'boot-heal'.
  closedBy: text('closed_by'),
  exitCode: integer('exit_code'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  // Separate on purpose: cached input is ~an order of magnitude cheaper
  // (spec §5.1), and folding it in projects wrong in the expensive direction.
  tokensCached: integer('tokens_cached'),
  costUsd: real('cost_usd')
})

/**
 * Phase 3a / Task 3a-1 (migration v7): attention-minutes, spec §5.3. Created
 * here so this phase's schema churn stays in ONE migration; TASK 3a-2 IS ITS
 * ONLY WRITER and this task leaves it empty. Same no-FK rule as dispatches.
 * `class` and `tick_seconds` were added to v7 by coordinator amendment
 * (2026-07-24) on 3a-2's dependency finding: without the class there is no
 * denominator for "% of measured time that was pane-focused", and the tick
 * granularity must be recorded so a later cadence change cannot silently
 * corrupt rows written under the old one.
 */
export const attentionSpans = sqliteTable('attention_spans', {
  id: text('id').primaryKey(),
  dispatchId: text('dispatch_id'),
  sessionId: text('session_id'),
  // Set (with a null dispatch/session) for the per-project overhead bucket.
  projectId: text('project_id'),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at').notNull(),
  // Stored, not derived: a one-tap correction changes the number without
  // changing the interval.
  seconds: integer('seconds').notNull(),
  // The attention class the span was credited to (pane / overhead / idle /
  // blurred / locked, per 3a-2's focus-state table).
  class: text('class').notNull(),
  // The sampling granularity the span was accumulated at.
  tickSeconds: integer('tick_seconds').notNull(),
  // 'measured' | 'corrected'.
  source: text('source').notNull(),
  createdAt: text('created_at').notNull()
})

export type DispatchRow = typeof dispatches.$inferSelect
export type NewDispatchRow = typeof dispatches.$inferInsert
export type AttentionSpanRow = typeof attentionSpans.$inferSelect
export type NewAttentionSpanRow = typeof attentionSpans.$inferInsert
