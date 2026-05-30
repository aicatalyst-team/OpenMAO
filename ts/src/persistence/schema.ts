import type { Database as SqliteDatabase } from "better-sqlite3";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS tools (
  name TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (workspace_id, name),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS worker_identities (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_identities_workspace_id
ON worker_identities(workspace_id, id);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_items_workspace_id
ON work_items(workspace_id, id);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL,
  active_node TEXT,
  suspended_approval_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_workspace_id
ON runs(workspace_id, id);

CREATE TABLE IF NOT EXISTS task_envelopes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  work_item_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (workspace_id, run_id) REFERENCES runs(workspace_id, id),
  FOREIGN KEY (workspace_id, work_item_id) REFERENCES work_items(workspace_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_envelopes_workspace_id
ON task_envelopes(workspace_id, id);

CREATE TABLE IF NOT EXISTS bounded_work_envelopes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  work_item_id TEXT NOT NULL,
  run_id TEXT,
  worker_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (workspace_id, work_item_id) REFERENCES work_items(workspace_id, id),
  FOREIGN KEY (workspace_id, run_id) REFERENCES runs(workspace_id, id),
  FOREIGN KEY (workspace_id, worker_id) REFERENCES worker_identities(workspace_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bounded_work_envelopes_workspace_id
ON bounded_work_envelopes(workspace_id, id);

CREATE INDEX IF NOT EXISTS idx_bounded_work_envelopes_work_item
ON bounded_work_envelopes(workspace_id, work_item_id);

CREATE TABLE IF NOT EXISTS worker_outcomes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  work_item_id TEXT NOT NULL,
  envelope_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (workspace_id, work_item_id) REFERENCES work_items(workspace_id, id),
  FOREIGN KEY (workspace_id, envelope_id) REFERENCES bounded_work_envelopes(workspace_id, id),
  FOREIGN KEY (workspace_id, worker_id) REFERENCES worker_identities(workspace_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_outcomes_workspace_idempotency
ON worker_outcomes(workspace_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_worker_outcomes_work_item
ON worker_outcomes(workspace_id, work_item_id);

CREATE TABLE IF NOT EXISTS checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  node TEXT NOT NULL,
  run_status TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (workspace_id, run_id) REFERENCES runs(workspace_id, id)
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_run_latest
ON checkpoints(run_id, id DESC);

CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (workspace_id, run_id) REFERENCES runs(workspace_id, id)
);

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS capabilities (
  name TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (workspace_id, name),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS capability_calls (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  capability_name TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (workspace_id, run_id) REFERENCES runs(workspace_id, id),
  FOREIGN KEY (workspace_id, capability_name) REFERENCES capabilities(workspace_id, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_capability_calls_workspace_idempotency
ON capability_calls(workspace_id, idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_capability_calls_workspace_id
ON capability_calls(workspace_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_capability_calls_workspace_run_id
ON capability_calls(workspace_id, run_id, id);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT,
  seq INTEGER NOT NULL,
  run_seq INTEGER,
  kind TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  idempotency_key TEXT,
  UNIQUE (workspace_id, seq),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (workspace_id, run_id) REFERENCES runs(workspace_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_workspace_idempotency
ON events(workspace_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_run_seq
ON events(run_id, run_seq)
WHERE run_id IS NOT NULL AND run_seq IS NOT NULL;

CREATE TABLE IF NOT EXISTS ingestion_records (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  target_run_id TEXT,
  target_work_item_id TEXT,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (workspace_id, target_run_id) REFERENCES runs(workspace_id, id),
  FOREIGN KEY (workspace_id, target_work_item_id) REFERENCES work_items(workspace_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ingestion_records_workspace_idempotency
ON ingestion_records(workspace_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_ingestion_records_target_work
ON ingestion_records(workspace_id, target_work_item_id);

CREATE TABLE IF NOT EXISTS traces (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  node TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (workspace_id, run_id) REFERENCES runs(workspace_id, id)
);

CREATE INDEX IF NOT EXISTS idx_traces_run_timestamp
ON traces(run_id, timestamp, id);

CREATE TRIGGER IF NOT EXISTS events_no_update
BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS events_no_delete
BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;

CREATE TABLE IF NOT EXISTS node_effects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  node TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  effect_type TEXT NOT NULL,
  effect_ref TEXT NOT NULL,
  content_hash TEXT,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE (run_id, node, idempotency_key),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (workspace_id, run_id) REFERENCES runs(workspace_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_node_effects_workspace_id
ON node_effects(workspace_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_node_effects_workspace_run_id
ON node_effects(workspace_id, run_id, id);

CREATE TABLE IF NOT EXISTS capability_results (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  node_effect_id TEXT,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (workspace_id, run_id) REFERENCES runs(workspace_id, id),
  FOREIGN KEY (workspace_id, run_id, call_id)
    REFERENCES capability_calls(workspace_id, run_id, id),
  FOREIGN KEY (workspace_id, run_id, node_effect_id)
    REFERENCES node_effects(workspace_id, run_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_capability_results_workspace_call
ON capability_results(workspace_id, call_id);

CREATE TABLE IF NOT EXISTS model_requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT,
  idempotency_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (workspace_id, run_id) REFERENCES runs(workspace_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_model_requests_workspace_id
ON model_requests(workspace_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_model_requests_workspace_idempotency
ON model_requests(workspace_id, idempotency_key);

CREATE TABLE IF NOT EXISTS model_responses (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (workspace_id, request_id) REFERENCES model_requests(workspace_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_model_responses_workspace_request
ON model_responses(workspace_id, request_id);

CREATE TABLE IF NOT EXISTS individual_memory (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  owner_id TEXT,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS promotion_candidates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS promotion_corroborations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  source_memory_entry TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (candidate_id) REFERENCES promotion_candidates(id)
);

CREATE INDEX IF NOT EXISTS idx_promotion_corroborations_candidate
ON promotion_corroborations(candidate_id);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  content_ref TEXT NOT NULL,
  content_hash TEXT,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (workspace_id, task_id) REFERENCES task_envelopes(workspace_id, id)
);

CREATE TABLE IF NOT EXISTS world_model_snapshots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT,
  source_workspace_seq INTEGER NOT NULL,
  source_run_seq INTEGER,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (workspace_id, run_id) REFERENCES runs(workspace_id, id)
);

CREATE TABLE IF NOT EXISTS org_change_proposals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS active_run_locks (
  workspace_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (workspace_id, run_id) REFERENCES runs(workspace_id, id)
);

INSERT OR IGNORE INTO schema_version (version, applied_at)
VALUES (2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

PRAGMA user_version = 2;
`;

export function initializeSchema(connection: SqliteDatabase): void {
  connection.exec(SCHEMA_SQL);
}
