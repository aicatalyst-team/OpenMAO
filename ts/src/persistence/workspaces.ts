import { type Workspace, WorkspaceSchema } from "../contracts/index.js";
import type { Database } from "./database.js";
import { dumpJson, jsonEqual } from "./serialization.js";

type PayloadRow = { payload_json: string };

export class WorkspaceConflictError extends Error {}

export class WorkspaceStore {
  constructor(private readonly database: Database) {}

  save(workspace: Workspace): Workspace {
    const parsed = WorkspaceSchema.parse(workspace);

    return this.database.transaction(() => {
      const existing = this.get(parsed.id);
      if (existing) {
        if (jsonEqual(existing, parsed)) {
          return existing;
        }

        throw new WorkspaceConflictError(`workspace already exists: ${parsed.id}`);
      }

      this.database.connection
        .prepare("INSERT INTO workspaces (id, payload_json) VALUES (?, ?)")
        .run(parsed.id, dumpJson(parsed));
      return parsed;
    });
  }

  get(workspaceId: string): Workspace | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM workspaces WHERE id = ?")
      .get(workspaceId) as PayloadRow | undefined;

    return row ? WorkspaceSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listAll(): Workspace[] {
    const rows = this.database.connection
      .prepare("SELECT payload_json FROM workspaces ORDER BY id")
      .all() as PayloadRow[];

    return rows.map((row) => WorkspaceSchema.parse(JSON.parse(row.payload_json)));
  }
}
