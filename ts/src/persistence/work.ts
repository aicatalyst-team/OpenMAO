import {
  type Goal,
  GoalSchema,
  type TaskEnvelope,
  TaskEnvelopeSchema,
  type WorkItem,
  WorkItemSchema,
} from "../contracts/index.js";
import type { Database } from "./database.js";
import { dumpJson, jsonEqual } from "./serialization.js";

type PayloadRow = { payload_json: string };

export class GoalConflictError extends Error {}
export class WorkItemConflictError extends Error {}
export class TaskEnvelopeConflictError extends Error {}

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
