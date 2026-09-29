// v25 allocated 2026-09-20: working AST 24, seven refs max 24, copied DB max/count 24/24.
// External IDs retain history. Internal team relationships use restrictive FKs.
export const TEAM_STORAGE_MIGRATION = `
CREATE TABLE team_presets (
 id TEXT PRIMARY KEY, label TEXT NOT NULL, schema_version INTEGER NOT NULL,
 config_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE team_runs (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, lead_session_id TEXT,
 status TEXT NOT NULL, generation INTEGER NOT NULL CHECK(generation > 0), version INTEGER NOT NULL CHECK(version > 0),
 policy_version INTEGER NOT NULL, config_json TEXT NOT NULL, base_sha TEXT, integration_worktree_id TEXT, integration_head TEXT,
 launch_request_id TEXT NOT NULL, launch_payload_hash TEXT NOT NULL, launch_ack_json TEXT NOT NULL,
 record_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(project_id, launch_request_id)
);
CREATE INDEX idx_team_runs_project ON team_runs(project_id, created_at);
CREATE INDEX idx_team_runs_lead ON team_runs(lead_session_id);
CREATE TABLE team_members (
 id TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES team_runs(id) ON DELETE RESTRICT,
 credential_profile_id TEXT, config_json TEXT NOT NULL, PRIMARY KEY(run_id, id)
);
CREATE TABLE team_tasks (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES team_runs(id) ON DELETE RESTRICT,
 kind TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0),
 current_attempt_id TEXT,
 attempt_count INTEGER NOT NULL CHECK(attempt_count BETWEEN 0 AND 3), command_json TEXT NOT NULL,
 record_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(id, run_id),
 FOREIGN KEY(current_attempt_id, id, run_id) REFERENCES team_attempts(id, task_id, run_id) ON DELETE RESTRICT
);
CREATE INDEX idx_team_tasks_run ON team_tasks(run_id, created_at);
CREATE TABLE team_attempts (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES team_runs(id) ON DELETE RESTRICT,
 task_id TEXT NOT NULL, number INTEGER NOT NULL CHECK(number BETWEEN 1 AND 3), member_id TEXT NOT NULL,
 generation INTEGER NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0),
 worktree_id TEXT, base_sha TEXT, process_json TEXT, result_json TEXT, artifact_json TEXT,
 record_json TEXT NOT NULL, UNIQUE(task_id, number), UNIQUE(id, task_id, run_id),
 FOREIGN KEY(task_id, run_id) REFERENCES team_tasks(id, run_id) ON DELETE RESTRICT,
 FOREIGN KEY(run_id, member_id) REFERENCES team_members(run_id, id) ON DELETE RESTRICT
);
CREATE INDEX idx_team_attempts_run ON team_attempts(run_id, status);
CREATE TABLE team_events (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES team_runs(id) ON DELETE RESTRICT,
 sequence INTEGER NOT NULL CHECK(sequence > 0), generation INTEGER NOT NULL,
 operation TEXT NOT NULL, client_request_id TEXT, payload_hash TEXT, acknowledgment_json TEXT,
 actor TEXT NOT NULL, entity_id TEXT, payload_json TEXT NOT NULL, at TEXT NOT NULL,
 UNIQUE(run_id, sequence), UNIQUE(run_id, operation, client_request_id),
 CHECK((client_request_id IS NULL AND payload_hash IS NULL AND acknowledgment_json IS NULL) OR
       (client_request_id IS NOT NULL AND payload_hash IS NOT NULL AND acknowledgment_json IS NOT NULL))
);
CREATE TABLE team_integrations (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES team_runs(id) ON DELETE RESTRICT,
 task_id TEXT NOT NULL, attempt_id TEXT NOT NULL, preparation_id TEXT NOT NULL UNIQUE,
 artifact_sha TEXT NOT NULL, expected_head TEXT NOT NULL, result_sha TEXT, staging_worktree_id TEXT,
 status TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0), policy_version INTEGER NOT NULL,
 record_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(attempt_id, task_id, run_id) REFERENCES team_attempts(id, task_id, run_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX idx_team_one_applying ON team_integrations(run_id) WHERE status = 'applying';
CREATE INDEX idx_team_integrations_run ON team_integrations(run_id, created_at);
`
