import {
  type BoundedWorkEnvelope,
  BoundedWorkEnvelopeSchema,
  type Goal,
  GoalSchema,
  type IngestionRecord,
  IngestionRecordSchema,
  type TaskEnvelope,
  TaskEnvelopeSchema,
  type WorkerIdentity,
  WorkerIdentitySchema,
  type WorkerOutcome,
  WorkerOutcomeSchema,
  type WorkItem,
  WorkItemSchema,
} from "../contracts/index.js";
import type { Database } from "./database.js";
import { dumpJson, jsonEqual } from "./serialization.js";

type PayloadRow = { payload_json: string };

export class GoalConflictError extends Error {}
export class WorkItemConflictError extends Error {}
export class TaskEnvelopeConflictError extends Error {}
export class WorkerIdentityConflictError extends Error {}
export class BoundedWorkEnvelopeConflictError extends Error {}
export class WorkerOutcomeConflictError extends Error {}
export class IngestionRecordConflictError extends Error {}

export class GoalStore {
  constructor(private readonly database: Database) {}

  save(goal: Goal): Goal {
    const parsed = GoalSchema.parse(goal);
    return this.database.transaction(() => {
      const existing = this.get(parsed.id);
      if (existing) {
        if (jsonEqual(existing, parsed)) {
          return existing;
        }
        throw new GoalConflictError(`goal already exists: ${parsed.id}`);
      }
      this.database.connection
        .prepare("INSERT INTO goals (id, workspace_id, payload_json) VALUES (?, ?, ?)")
        .run(parsed.id, parsed.workspace_id, dumpJson(parsed));
      return parsed;
    });
  }

  get(goalId: string): Goal | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM goals WHERE id = ?")
      .get(goalId) as PayloadRow | undefined;
    return row ? GoalSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listForWorkspace(workspaceId: string): Goal[] {
    const rows = this.database.connection
      .prepare("SELECT payload_json FROM goals WHERE workspace_id = ? ORDER BY id")
      .all(workspaceId) as PayloadRow[];
    return rows.map((row) => GoalSchema.parse(JSON.parse(row.payload_json)));
  }
}

export class WorkItemStore {
  constructor(private readonly database: Database) {}

  save(workItem: WorkItem): WorkItem {
    const parsed = WorkItemSchema.parse(workItem);
    return this.database.transaction(() => {
      const existing = this.get(parsed.id);
      if (existing) {
        if (jsonEqual(existing, parsed)) {
          return existing;
        }
        throw new WorkItemConflictError(`work item already exists: ${parsed.id}`);
      }
      this.database.connection
        .prepare("INSERT INTO work_items (id, workspace_id, payload_json) VALUES (?, ?, ?)")
        .run(parsed.id, parsed.workspace_id, dumpJson(parsed));
      return parsed;
    });
  }

  get(workItemId: string): WorkItem | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM work_items WHERE id = ?")
      .get(workItemId) as PayloadRow | undefined;
    return row ? WorkItemSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listForWorkspace(workspaceId: string): WorkItem[] {
    const rows = this.database.connection
      .prepare("SELECT payload_json FROM work_items WHERE workspace_id = ? ORDER BY id")
      .all(workspaceId) as PayloadRow[];
    return rows.map((row) => WorkItemSchema.parse(JSON.parse(row.payload_json)));
  }

  setStatus(workItemId: string, status: WorkItem["status"]): WorkItem {
    return this.database.transaction(() => {
      const current = this.get(workItemId);
      if (!current) {
        throw new Error(`work item not found: ${workItemId}`);
      }
      if (current.status === status) {
        return current;
      }
      if (current.status === "done" || current.status === "failed") {
        throw new WorkItemConflictError(`terminal work item cannot be mutated: ${workItemId}`);
      }
      const updated = WorkItemSchema.parse({ ...current, status });
      this.database.connection
        .prepare("UPDATE work_items SET payload_json = ? WHERE id = ?")
        .run(dumpJson(updated), updated.id);
      return updated;
    });
  }

  update(workItem: WorkItem): WorkItem {
    const parsed = WorkItemSchema.parse(workItem);
    return this.database.transaction(() => {
      const current = this.get(parsed.id);
      if (!current) {
        throw new Error(`work item not found: ${parsed.id}`);
      }
      if (jsonEqual(current, parsed)) {
        return current;
      }
      if (current.status === "done" || current.status === "failed") {
        throw new WorkItemConflictError(`terminal work item cannot be mutated: ${parsed.id}`);
      }
      this.database.connection
        .prepare("UPDATE work_items SET payload_json = ? WHERE id = ?")
        .run(dumpJson(parsed), parsed.id);
      return parsed;
    });
  }
}

export class WorkerIdentityStore {
  constructor(private readonly database: Database) {}

  save(worker: WorkerIdentity): WorkerIdentity {
    const parsed = WorkerIdentitySchema.parse(worker);
    return this.database.transaction(() => {
      const existing = this.get(parsed.id);
      if (existing) {
        if (jsonEqual(existing, parsed)) {
          return existing;
        }
        throw new WorkerIdentityConflictError(`worker identity already exists: ${parsed.id}`);
      }

      this.database.connection
        .prepare("INSERT INTO worker_identities (id, workspace_id, payload_json) VALUES (?, ?, ?)")
        .run(parsed.id, parsed.workspace_id, dumpJson(parsed));
      return parsed;
    });
  }

  get(workerId: string): WorkerIdentity | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM worker_identities WHERE id = ?")
      .get(workerId) as PayloadRow | undefined;

    return row ? WorkerIdentitySchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listForWorkspace(workspaceId: string): WorkerIdentity[] {
    const rows = this.database.connection
      .prepare("SELECT payload_json FROM worker_identities WHERE workspace_id = ? ORDER BY id")
      .all(workspaceId) as PayloadRow[];

    return rows.map((row) => WorkerIdentitySchema.parse(JSON.parse(row.payload_json)));
  }
}

export class TaskEnvelopeStore {
  constructor(private readonly database: Database) {}

  save(task: TaskEnvelope): TaskEnvelope {
    const parsed = TaskEnvelopeSchema.parse(task);
    return this.database.transaction(() => {
      const existing = this.get(parsed.id);
      if (existing) {
        if (jsonEqual(existing, parsed)) {
          return existing;
        }
        throw new TaskEnvelopeConflictError(`task envelope already exists: ${parsed.id}`);
      }
      this.database.connection
        .prepare(
          `INSERT INTO task_envelopes (id, workspace_id, run_id, work_item_id, payload_json)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(parsed.id, parsed.workspace_id, parsed.run_id, parsed.work_item_id, dumpJson(parsed));
      return parsed;
    });
  }

  get(taskId: string): TaskEnvelope | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM task_envelopes WHERE id = ?")
      .get(taskId) as PayloadRow | undefined;
    return row ? TaskEnvelopeSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listForRun(runId: string): TaskEnvelope[] {
    const rows = this.database.connection
      .prepare("SELECT payload_json FROM task_envelopes WHERE run_id = ? ORDER BY id")
      .all(runId) as PayloadRow[];
    return rows.map((row) => TaskEnvelopeSchema.parse(JSON.parse(row.payload_json)));
  }
}

export class BoundedWorkEnvelopeStore {
  constructor(private readonly database: Database) {}

  save(envelope: BoundedWorkEnvelope): BoundedWorkEnvelope {
    const parsed = BoundedWorkEnvelopeSchema.parse(envelope);
    return this.database.transaction(() => {
      const existing = this.get(parsed.id);
      if (existing) {
        if (jsonEqual(existing, parsed)) {
          return existing;
        }
        throw new BoundedWorkEnvelopeConflictError(
          `bounded work envelope already exists: ${parsed.id}`,
        );
      }

      this.database.connection
        .prepare(
          `INSERT INTO bounded_work_envelopes (
            id, workspace_id, work_item_id, run_id, worker_id, payload_json
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          parsed.id,
          parsed.workspace_id,
          parsed.work_item_id,
          parsed.run_id,
          parsed.worker_id,
          dumpJson(parsed),
        );
      return parsed;
    });
  }

  get(envelopeId: string): BoundedWorkEnvelope | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM bounded_work_envelopes WHERE id = ?")
      .get(envelopeId) as PayloadRow | undefined;

    return row ? BoundedWorkEnvelopeSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listForWorkItem(workspaceId: string, workItemId: string): BoundedWorkEnvelope[] {
    const rows = this.database.connection
      .prepare(
        `SELECT payload_json
         FROM bounded_work_envelopes
         WHERE workspace_id = ? AND work_item_id = ?
         ORDER BY id`,
      )
      .all(workspaceId, workItemId) as PayloadRow[];

    return rows.map((row) => BoundedWorkEnvelopeSchema.parse(JSON.parse(row.payload_json)));
  }
}

export class WorkerOutcomeStore {
  constructor(private readonly database: Database) {}

  record(outcome: WorkerOutcome): WorkerOutcome {
    const parsed = WorkerOutcomeSchema.parse(outcome);
    return this.database.transaction(() => {
      const existing = this.getByIdempotencyKey(parsed.workspace_id, parsed.idempotency_key);
      if (existing) {
        // submitted_at is server-generated and excluded from conflict detection so that
        // a replay arriving in a different millisecond is not treated as a conflicting record.
        const { submitted_at: _e, ...existingStable } = existing;
        const { submitted_at: _p, ...parsedStable } = parsed;
        if (jsonEqual(existingStable, parsedStable)) {
          return existing;
        }
        throw new WorkerOutcomeConflictError(
          "worker outcome idempotency key was reused for a different outcome",
        );
      }

      this.database.connection
        .prepare(
          `INSERT INTO worker_outcomes (
            id, workspace_id, work_item_id, envelope_id, worker_id, idempotency_key, status,
            payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          parsed.id,
          parsed.workspace_id,
          parsed.work_item_id,
          parsed.envelope_id,
          parsed.worker_id,
          parsed.idempotency_key,
          parsed.status,
          dumpJson(parsed),
        );
      return parsed;
    });
  }

  get(outcomeId: string): WorkerOutcome | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM worker_outcomes WHERE id = ?")
      .get(outcomeId) as PayloadRow | undefined;

    return row ? WorkerOutcomeSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  getByIdempotencyKey(workspaceId: string, idempotencyKey: string): WorkerOutcome | null {
    const row = this.database.connection
      .prepare(
        `SELECT payload_json
         FROM worker_outcomes
         WHERE workspace_id = ? AND idempotency_key = ?`,
      )
      .get(workspaceId, idempotencyKey) as PayloadRow | undefined;

    return row ? WorkerOutcomeSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listForWorkItem(workspaceId: string, workItemId: string): WorkerOutcome[] {
    const rows = this.database.connection
      .prepare(
        `SELECT payload_json
         FROM worker_outcomes
         WHERE workspace_id = ? AND work_item_id = ?
         ORDER BY id`,
      )
      .all(workspaceId, workItemId) as PayloadRow[];

    return rows.map((row) => WorkerOutcomeSchema.parse(JSON.parse(row.payload_json)));
  }
}

export class IngestionRecordStore {
  constructor(private readonly database: Database) {}

  record(record: IngestionRecord): IngestionRecord {
    const parsed = IngestionRecordSchema.parse(record);
    return this.database.transaction(() => {
      const existing = this.getByIdempotencyKey(parsed.workspace_id, parsed.idempotency_key);
      if (existing) {
        if (jsonEqual(existing, parsed)) {
          return existing;
        }
        throw new IngestionRecordConflictError(
          "ingestion idempotency key was reused for a different record",
        );
      }

      this.database.connection
        .prepare(
          `INSERT INTO ingestion_records (
            id, workspace_id, idempotency_key, kind, target_run_id, target_work_item_id,
            payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          parsed.id,
          parsed.workspace_id,
          parsed.idempotency_key,
          parsed.kind,
          parsed.target_run_id,
          parsed.target_work_item_id,
          dumpJson(parsed),
        );
      return parsed;
    });
  }

  get(recordId: string): IngestionRecord | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM ingestion_records WHERE id = ?")
      .get(recordId) as PayloadRow | undefined;

    return row ? IngestionRecordSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  getByIdempotencyKey(workspaceId: string, idempotencyKey: string): IngestionRecord | null {
    const row = this.database.connection
      .prepare(
        `SELECT payload_json
         FROM ingestion_records
         WHERE workspace_id = ? AND idempotency_key = ?`,
      )
      .get(workspaceId, idempotencyKey) as PayloadRow | undefined;

    return row ? IngestionRecordSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listForWorkItem(workspaceId: string, workItemId: string): IngestionRecord[] {
    const rows = this.database.connection
      .prepare(
        `SELECT payload_json
         FROM ingestion_records
         WHERE workspace_id = ? AND target_work_item_id = ?
         ORDER BY id`,
      )
      .all(workspaceId, workItemId) as PayloadRow[];

    return rows.map((row) => IngestionRecordSchema.parse(JSON.parse(row.payload_json)));
  }

  listForWorkspace(workspaceId: string): IngestionRecord[] {
    const rows = this.database.connection
      .prepare("SELECT payload_json FROM ingestion_records WHERE workspace_id = ? ORDER BY id")
      .all(workspaceId) as PayloadRow[];

    return rows.map((row) => IngestionRecordSchema.parse(JSON.parse(row.payload_json)));
  }
}
