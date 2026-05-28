import { type WorldModelSnapshot, WorldModelSnapshotSchema } from "../contracts/index.js";
import type { Database } from "./database.js";
import { dumpJson } from "./serialization.js";

type PayloadRow = { payload_json: string };

export class WorldModelSnapshotStore {
  constructor(private readonly database: Database) {}

  save(snapshot: WorldModelSnapshot): WorldModelSnapshot {
    const parsed = WorldModelSnapshotSchema.parse(snapshot);
    return this.database.transaction(() => {
      const existing = this.get(parsed.id);
      if (existing) {
        return existing;
      }
      this.database.connection
        .prepare(
          `INSERT INTO world_model_snapshots (
            id, workspace_id, run_id, source_workspace_seq, source_run_seq, payload_json
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          parsed.id,
          parsed.workspace_id,
          parsed.run_id,
          parsed.source_workspace_seq,
          parsed.source_run_seq,
          dumpJson(parsed),
        );
      return parsed;
    });
  }

  get(snapshotId: string): WorldModelSnapshot | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM world_model_snapshots WHERE id = ?")
      .get(snapshotId) as PayloadRow | undefined;
    return row ? WorldModelSnapshotSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listForWorkspace(workspaceId: string): WorldModelSnapshot[] {
    const rows = this.database.connection
      .prepare("SELECT payload_json FROM world_model_snapshots WHERE workspace_id = ? ORDER BY id")
      .all(workspaceId) as PayloadRow[];
    return rows.map((row) => WorldModelSnapshotSchema.parse(JSON.parse(row.payload_json)));
  }

  delete(snapshotId: string): boolean {
    const result = this.database.connection
      .prepare("DELETE FROM world_model_snapshots WHERE id = ?")
      .run(snapshotId);
    return result.changes > 0;
  }
}
