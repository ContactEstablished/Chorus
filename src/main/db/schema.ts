import { sqliteTable, text, integer, blob, real, primaryKey } from 'drizzle-orm/sqlite-core'

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
  createdAt: text('created_at').notNull(),
  // v13 — both nullable. `color` NULL means "never chosen", which the rail
  // reads as its pre-v13 index cycle; see the migration's own note.
  color: text('color'),
  description: text('description'),
  // v15 (D120) — all three NOT NULL with a default, the deliberate inverse of
  // v13's ruling directly above: null means something for `color` and nothing
  // for these. `.notNull()` here is not decoration — Drizzle's inferred select
  // type is what stops a read site treating `status` as possibly-absent, and
  // D7 keeps this file and the hand-rolled DDL in step BY HAND ONLY, so a
  // column present in one and not the other typechecks clean and fails on the
  // first query.
  //
  // `status` is 'active' | 'hidden' | 'archived' (ProjectStatus, storage.ts) —
  // free-text here, validated by the Zod enum on the boundary, matching every
  // other status column in this schema.
  status: text('status').notNull(),
  // The rail's position. Not unique: a reorder passes through transient
  // duplicates inside one transaction. Indexed (`projects_sort`).
  sortOrder: integer('sort_order').notNull(),
  // What the pre-v13 colour cycle indexes on. Seeded from `sort_order` at
  // migration time and NEVER moved again — which is the whole point: the rail
  // may now filter and reorder, and a colour derived from the LIST INDEX would
  // repaint every legacy project the first time it did either.
  colorSeed: integer('color_seed').notNull()
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
  // v14: the AUTHORED identity — a person's name for this agent ("Bob") and a
  // one-line note about what it is doing ("Bug Fix - Missing Color"). Both
  // nullable: every pre-v14 row has neither, and an unnamed session stays
  // first-class. Deliberately NOT folded into `title` above, which is captured
  // from the agent's own OSC stream and overwrites itself. Matches migration
  // v14's DDL exactly.
  name: text('name'),
  description: text('description'),
  worktreeId: text('worktree_id'), // nullable; set when a session owns a worktree (D26 Q1/(a))
  createdAt: text('created_at').notNull(),
  // v10 (Phase 3a / D43): a SOFT pointer to the launch_profiles row this
  // session was launched under — deliberately NO .references(): a session row
  // is history and must survive its profile's deletion, exactly as 3a-1's
  // dispatches survive their session's, and sessions are themselves deleted on
  // pane close (D16 resolution d). An unresolvable value (a deleted profile, or
  // the LEGACY_CREDENTIALED_PROFILE_ID sentinel written by v10's data
  // migration) is read FAIL-SAFE as "credentialed" — see launchProfiles.ts.
  //
  // THIS COLUMN REPLACES Task 3-6's global `credentialed_sessions` settings
  // list (D49): the credentialed fact is now per-session, and therefore
  // per-project, which is what retires the Phase-3-only global-scoping
  // expedient the roadmap flagged.
  launchProfileId: text('launch_profile_id'),
  // v16: the accident guard. NULL = unlocked, an ISO timestamp = locked, and
  // the TIMESTAMP rather than a boolean is v13's `color` ruling in its own
  // shape — "when did I lock this" is a question the column answers for free,
  // and a `locked INTEGER` could not.
  //
  // ⚠ THE COLUMN IS HALF THE FEATURE; THE GUARDS ARE THE OTHER HALF, AND THEY
  // LIVE IN MAIN. A renderer that merely hides its own ✕ is not a lock — every
  // other route to the same destruction (the command palette, a project
  // archive, a project delete) walks straight past it. `requireUnlocked` in
  // ipc.ts is the enforcement point, on the one side a mistaken renderer cannot
  // skip, exactly as project:delete's typed-name check is (D123).
  lockedAt: text('locked_at')
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
  costUsd: real('cost_usd'),

  /* -- Task 3a-3 (migration v8): the mint ledger, on THIS row -------------
   * NOT a second table. A mint belongs to a dispatch one-to-one, and a
   * separate table would immediately need a join, an FK (F16: enforced), and
   * its own orphan story — D48's anti-goal, restated. Same no-REFERENCES rule
   * as the columns above.
   */
  // The minted key's hash — an IDENTIFIER, not a secret: it cannot
  // authenticate. It is also the value the analytics `api_key_id` filter
  // wants (D4 obligation 1, verified 2026-07-25). NULL for subscription,
  // mint-failed and never-attributed rows. The KEY ITSELF IS NEVER STORED.
  mintedKeyHash: text('minted_key_hash'),
  // The cap that was actually applied — evidence, not configuration. Read back
  // from the create response rather than echoed from the request, so the row
  // records what OpenRouter accepted.
  mintedKeyLimit: real('minted_key_limit'),
  // ISO-8601. Also the analytics query's window START.
  mintedAt: text('minted_at'),
  // ⚠ NULL means THE LEDGER ROW IS OPEN. This single field is what boot
  // reconciliation queries, which is why it is nullable rather than defaulted.
  revokedAt: text('revoked_at'),
  // NOT NULL with a default, because a row whose state is unknown is a row
  // nobody can reason about later. Vocabulary in attributionCore's
  // AttributionState. Pre-v8 rows read 'none', which is exactly true of them.
  attributionState: text('attribution_state').notNull().default('none'),
  // 'analytics' | 'analytics-derived' | 'cli-logs' | NULL = unknown.
  // Nullable because unknown is a real and frequent answer (§8).
  tokensSource: text('tokens_source')
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

/**
 * Phase 3a / Task 3a-4 (migration v9): the model catalog.
 *
 * ⚠ A LIST OF WHAT EXISTS — NOT AN AUTHORITY. Precedence for "which model
 * does this launch use" is, in order: launch_profiles.model (3a-5) >
 * provider_configs.model (v6, D48) > nothing (the CLI's own default). This
 * table is NOT in that order and never writes to either home. See the v9
 * migration comment in storage.ts for the full ruling.
 *
 * No REFERENCES to provider_configs: FKs are ENFORCED (F16) and RESTRICT
 * would make provider:delete throw. Purge is explicit, in the delete's own
 * transaction.
 */
export const modelCatalog = sqliteTable(
  'model_catalog',
  {
    providerId: text('provider_id').notNull(),
    modelId: text('model_id').notNull(),
    displayName: text('display_name').notNull(),
    contextLength: integer('context_length'),
    /** Provider-announced retirement (OpenRouter `expiration_date`). */
    expiresAt: text('expires_at'),
    firstSeenAt: text('first_seen_at').notNull(),
    refreshedAt: text('refreshed_at').notNull(),
    /** Set ONCE when a refresh stops seeing this id; cleared when it returns;
     *  never moved while it stays missing. The row is never deleted. */
    missingSince: text('missing_since')
  },
  (t) => ({ pk: primaryKey({ columns: [t.providerId, t.modelId] }) })
)

export type ModelCatalogRow = typeof modelCatalog.$inferSelect
export type NewModelCatalogRow = typeof modelCatalog.$inferInsert

/**
 * v12 (Phase 3d / Task 3d-2, D85): the user's SHORTLIST — which of a route's
 * models they actually intend to use. OpenRouter alone lists ~340; a launch
 * picker built on that number is not a picker.
 *
 * ⚠ A SEPARATE TABLE, NOT A COLUMN ON `model_catalog`, AND THE REASON IS THE
 * WHOLE DESIGN. `model_catalog` is a CACHE of what a provider says exists —
 * written only by a refresh diff, and explicitly never an authority (D56).
 * This is the opposite kind of fact: it is USER INTENT, written only by a
 * click, and no refresh may ever touch it. Putting a `favourite` flag on a
 * cache row would make one table mean two things, and the first `DELETE FROM
 * model_catalog` written by someone tidying a cache would silently destroy a
 * curation the user built by hand.
 *
 * ⚠ AND IT IS DELIBERATELY NOT A FOREIGN KEY ONTO `model_catalog`. A user must
 * be able to shortlist an id the catalog has never seen — the same freedom
 * D48/D56 protect by keeping the provider's default model a FREE-TEXT input
 * with a `<datalist>` rather than a closed `<select>`. A shortlist that could
 * only contain ids a refresh happened to return would make the catalog
 * authoritative by schema, which is exactly the ruling those decisions exist
 * to prevent. A shortlisted id therefore SURVIVES the model going missing,
 * survives the catalog being emptied, and survives never having been in it.
 *
 * No REFERENCES to provider_configs either, for `model_catalog`'s own reason:
 * FKs are ENFORCED (F16) and RESTRICT would make provider:delete throw. Purge
 * is explicit, in the delete's own transaction.
 */
export const modelShortlist = sqliteTable(
  'model_shortlist',
  {
    providerId: text('provider_id').notNull(),
    modelId: text('model_id').notNull(),
    /** When the user chose it. Ordering is by this, NOT by display name: a
     *  shortlist is a personal list and the order you built it in is
     *  information the alphabet does not carry. */
    addedAt: text('added_at').notNull()
  },
  (t) => ({ pk: primaryKey({ columns: [t.providerId, t.modelId] }) })
)

export type ModelShortlistRow = typeof modelShortlist.$inferSelect
export type NewModelShortlistRow = typeof modelShortlist.$inferInsert

/**
 * Phase 3a / D43 (Task 3a-5): the launchable unit — (agent x route x model) —
 * as one user-named row. The id is IMMUTABLE and is what every reference
 * stores; the label is freely renameable and is what the picker shows. Two
 * routes to the same model are TWO ROWS, deliberately (`OR/DeepSeek v4 Pro` vs
 * `Direct/DeepSeek`), and nothing may dedupe or collapse them.
 *
 * Matches migration v10's DDL column for column. NOTE the FK asymmetry, which
 * is intentional and argued at the migration: this table REFERENCES its targets
 * (a live instruction must not outlive them), while sessions.launch_profile_id
 * does NOT reference this table (a session row is history and must outlive the
 * profile).
 */
export const launchProfiles = sqliteTable('launch_profiles', {
  id: text('id').primaryKey(),
  label: text('label').notNull().unique(),
  // Authoritative EVEN WHEN a route is present. provider_id is nullable, so a
  // route-less profile (the plain "Claude Code on my subscription" profile most
  // users save first) has nowhere else to record its agent. Drift against
  // provider_configs.adapter_type is closed by validateProfileShape's equality
  // check, not by a CHECK constraint — one authoritative field, one validator.
  agent: text('agent').notNull(),
  // NULL = no route: today's first-class ambient/subscription launch (D33
  // clause 9). ENFORCED FK (F16) when set.
  providerId: text('provider_id').references(() => providerConfigs.id),
  // NULL = this profile holds no credential. THIS COLUMN IS THE CREDENTIALED
  // PREDICATE: sessionIsCredentialed reads it through the profile pointer.
  credentialProfileId: text('credential_profile_id').references(() => credentialProfiles.id),
  // Precedence rank 1 (3a-4's normative table). NULL falls through to the
  // route's provider_configs.model (rank 2, D48). ⚠ NEVER BACK-WRITTEN —
  // copying the route default in here would create the second home for "which
  // model" that D48 exists to prevent, by another name.
  model: text('model'),
  // An EffortOption.id from 3a-4's effortLevelSchema — IMPORTED, never
  // re-declared. 3a-5 persists it and hands it to 3a-4's LaunchOptions.effort
  // seam; 3a-4's resolveEffortArgs owns every mapping decision, and no adapter
  // file changes here. Rank 2 of 3a-4's effort order (raw extra_args still
  // wins); a profile does not create a rank 0.
  effort: text('effort'),
  // Stored; consumed by NOTHING in 3a-5. Mapping it onto a CLI flag is D4
  // material AND an adapter change, and neither is in scope. The column exists
  // now so schema churn stays in one migration (the attention_spans precedent).
  permissionMode: text('permission_mode'),
  // 'current-tree' | 'new-worktree' only — 'existing-worktree' names a specific
  // transient worktree row and is refused at create/update.
  workspaceMode: text('workspace_mode').notNull(),
  // JSON object of NON-SECRET string->string env additions, refused at write if
  // it carries a known key shape (the extra_headers_json precedent).
  envJson: text('env_json'),
  createdAt: text('created_at').notNull(),
  // Exists so a rename is visible without a second table.
  updatedAt: text('updated_at').notNull()
})

export type LaunchProfileRow = typeof launchProfiles.$inferSelect
export type NewLaunchProfileRow = typeof launchProfiles.$inferInsert

/**
 * Phase 3b / Task 3b-2 (migration v11), D62: WHO the council's members are.
 *
 * ⚠ NO `provider_id` AND NO `base_url` COLUMN, and that is the headline ruling
 * rather than an omission. The route has ONE home — `provider_configs` (D48) —
 * and a credential already knows its route through
 * `credential_profiles.provider_id`, so a member NAMES A ROUTE BY NAMING A
 * CREDENTIAL. `launch_profiles` above carries both columns only because D33
 * clause 9 makes a route-with-no-credential first class; a council member that
 * cannot authenticate cannot deliberate, so that case does not exist here and
 * two columns that can disagree would be a bug class, not a convenience.
 *
 * ⚠ The roadmap's own Phase 3b line still says a member is "credential profile
 * + base URL + model id + role + params". That phrasing predates D48/D56 and
 * is superseded by this table.
 *
 * The FK is REAL and ENFORCED (F16) — a member is a live INSTRUCTION and is a
 * lie once its credential is gone. RESTRICT is what makes the refusal
 * mandatory; `countCouncilMembersForCredential` is what AUTHORS it, before the
 * delete statement runs. Matches migration v11's DDL column for column.
 */
export const councilMembers = sqliteTable('council_members', {
  id: text('id').primaryKey(),
  // UNIQUE, and freely renameable (D43): the label is not the identity. Every
  // pointer stores the immutable id, so a rename has zero downstream effect.
  label: text('label').notNull().unique(),
  // NOT NULL — the only REFERENCES in this whole migration.
  credentialProfileId: text('credential_profile_id')
    .notNull()
    .references(() => credentialProfiles.id),
  // D56 rank 1. NULL falls through to the ROUTE's provider_configs.model
  // (rank 2), then to nothing. ⚠ NEVER BACK-WRITTEN — copying the route default
  // in here is how the second home D48 forbids gets created by accident.
  model: text('model'),
  // 'member' | 'arbiter'. Free-text column, validated by councilRoleSchema in
  // MAIN — no CHECK constraint, matching auth_mode and status everywhere else.
  role: text('role').notNull(),
  // Temperature, top_p, and whatever else a member needs. Defensively parsed on
  // read (degrades to {} on corruption, the extra_headers_json /
  // getWindowBounds precedent) and REFUSED AT WRITE if it carries a known key
  // shape — a member's parameters are never a place for a credential.
  paramsJson: text('params_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

/**
 * Phase 3b / Task 3b-2 (migration v11): WHAT a run was.
 *
 * ⚠ NO `REFERENCES` ON ANY COLUMN, the deliberate inverse of councilMembers
 * above and the same ruling v7's `dispatches` and v9's `model_catalog` took: a
 * run is a historical FACT. It stays true after its project or a member is
 * deleted, and an enforced FK (F16) would make deleting a member THROW for
 * every run it ever joined. project_id is an opaque string here.
 *
 * The four mint columns mirror v8's ledger exactly, `revoked_at IS NULL`
 * included — that predicate IS the definition of an open ledger row. THE
 * MINTED KEY ITSELF IS NEVER STORED; `minted_key_hash` cannot authenticate.
 *
 * ⚠ CREATED EMPTY. Task 3b-3 is its only writer (the `attention_spans`
 * precedent); nothing in Task 3b-2 inserts a row.
 */
export const councilRuns = sqliteTable('council_runs', {
  id: text('id').primaryKey(),
  projectId: text('project_id'),
  briefPath: text('brief_path').notNull(),
  // NULL until the findings .md is written beside the brief (3b-4).
  findingsPath: text('findings_path'),
  status: text('status').notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  // D64(2): ONE minted key per RUN, with a hard cap that must clear the
  // members' max OUTPUT allocation rather than their expected spend (3a-3's
  // measured lesson — OpenRouter pre-authorizes against the remaining limit).
  mintedKeyHash: text('minted_key_hash'),
  mintedKeyLimit: real('minted_key_limit'),
  mintedAt: text('minted_at'),
  // ⚠ NULL means THE LEDGER ROW IS OPEN. Nullable rather than defaulted, for
  // exactly the reason v8's dispatches.revoked_at is.
  revokedAt: text('revoked_at'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  tokensCached: integer('tokens_cached'),
  costUsd: real('cost_usd')
})

/**
 * Phase 3b / Task 3b-2 (migration v11): WHAT WAS SAID.
 *
 * ⚠ NO `REFERENCES`, for the same reason as councilRuns: a transcript is a
 * historical fact and stays true once its member is deleted. run_id and
 * member_id are opaque strings. Because SQLite will not cascade a soft
 * pointer, `deleteCouncilRun` purges this table explicitly in one transaction
 * (the deleteProviderConfig -> model_catalog precedent).
 *
 * ⚠ CREATED EMPTY. Task 3b-3 is its only writer.
 */
export const councilMessages = sqliteTable('council_messages', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  // NULLABLE: the synthesis and any orchestrator-authored framing have no
  // member to attribute.
  memberId: text('member_id'),
  // Both NOT NULL: a transcript row whose position in the deliberation is
  // unknown cannot be rendered or reasoned about later, and neither has an
  // honest default.
  round: integer('round').notNull(),
  phase: text('phase').notNull(),
  content: text('content').notNull(),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  createdAt: text('created_at').notNull()
})

export type CouncilMemberRow = typeof councilMembers.$inferSelect
export type NewCouncilMemberRow = typeof councilMembers.$inferInsert
export type CouncilRunRow = typeof councilRuns.$inferSelect
export type NewCouncilRunRow = typeof councilRuns.$inferInsert
export type CouncilMessageRow = typeof councilMessages.$inferSelect
export type NewCouncilMessageRow = typeof councilMessages.$inferInsert

/**
 * Phase 6 / Task 6-3 (migration v16): where a project's memory graph lives —
 * one row per project, or none. "Turn memory off" is a DELETE, which is the
 * D85 split-table argument this table rests on (see the v16 comment in
 * storage.ts for the full reasoning).
 *
 * ⚠ THERE IS NO PASSWORD COLUMN HERE, IN ANY FORM, AND THERE MUST NEVER BE
 * ONE. A credentialed mode NAMES a `credential_profiles` row; the secret stays
 * in the DPAPI envelope and is resolved per launch by `vault.decryptForLaunch`
 * (D93). `bolt_uri` is the one free-text field in this design, and because a
 * bolt URI can carry inline credentials (`bolt://user:pass@host`) the config
 * core REFUSES that form before it can ever reach this column.
 */
export const projectMemory = sqliteTable('project_memory', {
  // PK and FK at once: a project has at most one memory config, and a config
  // naming a deleted project is a lie rather than a historical fact (D62).
  // ⚠ ENFORCED (F16), and unlike `credential_profile_id` below this column is
  // NEVER null — so `deleteProject` must purge this table, and does.
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id),
  /** 'local-docker' | 'existing' | 'aura' — the vocabulary lives in
   *  memoryConfigCore, and only 'existing' is admitted in Phase 6. No CHECK
   *  constraint: the v13/v15 convention puts a limit where it can be reported,
   *  not where it surfaces as a failed write. */
  mode: text('mode').notNull(),
  boltUri: text('bolt_uri').notNull(),
  /** 'neo4j' — Community Edition has exactly one database, measured: the D4
   *  pass found `CREATE DATABASE` refused outright (ITEM 4). */
  databaseName: text('database_name').notNull(),
  /** 'none' | 'credential'. Only 'none' is reachable in Phase 6 — D128(a) took
   *  credentialed mode out of the phase with eight preconditions attached. */
  authMode: text('auth_mode').notNull(),
  // ⚠ ENFORCED FK, AND IN THIS PHASE AN UNGUARDED ONE — always NULL, so it
  // cannot fire. The debt note naming what the next person must build lives in
  // the v16 migration SQL, where a schema reader will meet it.
  credentialProfileId: text('credential_profile_id').references(() => credentialProfiles.id),
  /* ---- Stage 5's columns. Created here because MIGRATIONS.length moves
   * EXACTLY ONCE in this phase; nothing in Task 6-3 writes one, and they stay
   * NULL. `container_id` deliberately carries no constraint — it is an
   * OBSERVED fact about a resource that vanishes behind the app's back and is
   * reconciled at boot, like `worktrees`. */
  containerId: text('container_id'),
  containerName: text('container_name'),
  volumeName: text('volume_name'),
  boltPort: integer('bolt_port'),
  httpPort: integer('http_port'),
  /** A CACHE of the graph's own answer, not the authority (plan §8). Stays 0
   *  until Task 6-4's seeder writes it, and the seeder always re-reads the
   *  graph first. */
  schemaVersion: integer('schema_version').notNull().default(0),
  lastSeededAt: text('last_seeded_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

export type ProjectMemoryRow = typeof projectMemory.$inferSelect
export type NewProjectMemoryRow = typeof projectMemory.$inferInsert
