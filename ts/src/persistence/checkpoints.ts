import { z } from "zod";

import {
  CanonicalIdSchema,
  type Run,
  RunSchema,
  RunStatusSchema,
  UtcTimestampSchema,
  utcNow,
} from "../contracts/index.js";
import type { Database } from "./database.js";
import { dumpJson, jsonEqual } from "./serialization.js";

const CheckpointStateSchema = z.record(z.string(), z.unknown());

export const CheckpointSchema = z
  .object({
    id: z.number().int().positive(),
    workspace_id: CanonicalIdSchema,
    run_id: CanonicalIdSchema,
    node: z.string(),
    run_status: RunStatusSchema,
    state: CheckpointStateSchema,
    created_at: UtcTimestampSchema,
  })
  .strict();

export type Checkpoint = z.infer<typeof CheckpointSchema>;

type CheckpointRow = {
  id: number;
  workspace_id: string;
  run_id: string;
  node: string;
  run_status: string;
  state_json: string;
  created_at: string;
};

export class CheckpointStore {
  constructor(private readonly database: Database) {}

  save(input: {
    run: Run;
    node: string;
    state?: Record<string, unknown> | null;
    created_at?: string | null;
  }): Checkpoint {
    const run = RunSchema.parse(input.run);
    const state = CheckpointStateSchema.parse(input.state ?? {});
    return this.database.transaction(() => {
      const latest = this.latest(run.workspace_id, run.id);
      if (
        latest &&
        latest.node === input.node &&
        latest.run_status === run.status &&
        jsonEqual(latest.state, state)
      ) {
        return latest;
      }

      const createdAt = input.created_at ?? utcNow();
      const result = this.database.connection
        .prepare(
          `INSERT INTO checkpoints (workspace_id, run_id, node, run_status, state_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(run.workspace_id, run.id, input.node, run.status, dumpJson(state), createdAt);

      return CheckpointSchema.parse({
        id: Number(result.lastInsertRowid),
        workspace_id: run.workspace_id,
        run_id: run.id,
        node: input.node,
        run_status: run.status,
        state,
        created_at: createdAt,
      });
    });
  }

  latest(workspaceId: string, runId: string): Checkpoint | null {
    const row = this.database.connection
      .prepare(
        `SELECT id, workspace_id, run_id, node, run_status, state_json, created_at
         FROM checkpoints
         WHERE workspace_id = ? AND run_id = ?
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get(workspaceId, runId) as CheckpointRow | undefined;

    return row ? this.parse(row) : null;
  }

  listForRun(workspaceId: string, runId: string): Checkpoint[] {
    const rows = this.database.connection
      .prepare(
        `SELECT id, workspace_id, run_id, node, run_status, state_json, created_at
         FROM checkpoints
         WHERE workspace_id = ? AND run_id = ?
         ORDER BY id`,
      )
      .all(workspaceId, runId) as CheckpointRow[];

    return rows.map((row) => this.parse(row));
  }

  private parse(row: CheckpointRow): Checkpoint {
    return CheckpointSchema.parse({
      id: row.id,
      workspace_id: row.workspace_id,
      run_id: row.run_id,
      node: row.node,
      run_status: row.run_status,
      state: JSON.parse(row.state_json) as Record<string, unknown>,
      created_at: row.created_at,
    });
  }
}
