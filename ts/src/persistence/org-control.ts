import { type OrgControlState, OrgControlStateSchema, utcNow } from "../contracts/index.js";
import type { Database } from "./database.js";
import { dumpJson } from "./serialization.js";

type PayloadRow = { payload_json: string };

/**
 * Persists the per-workspace operator kill-switch. When `apply_paused` is set, the apply engine
 * refuses to mutate org state — the operator's pause-the-loop control. Sensing/reporting are
 * unaffected. Absence of a row means "not paused" (safe default).
 */
export class OrgControlStore {
  constructor(private readonly database: Database) {}

  get(workspaceId: string): OrgControlState {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM org_control WHERE workspace_id = ?")
      .get(workspaceId) as PayloadRow | undefined;
    if (row) {
      return OrgControlStateSchema.parse(JSON.parse(row.payload_json));
    }
    return OrgControlStateSchema.parse({ workspace_id: workspaceId, updated_at: utcNow() });
  }

  isApplyPaused(workspaceId: string): boolean {
    return this.get(workspaceId).apply_paused;
  }

  setApplyPaused(
    workspaceId: string,
    input: {
      paused: boolean;
      reason?: string | null;
      updated_by?: string | null;
      updated_at?: string | null;
    },
  ): OrgControlState {
    return this.database.transaction(() => {
      const next = OrgControlStateSchema.parse({
        workspace_id: workspaceId,
        apply_paused: input.paused,
        reason: input.reason ?? null,
        updated_by: input.updated_by ?? null,
        updated_at: input.updated_at ?? utcNow(),
      });
      this.database.connection
        .prepare(
          `INSERT INTO org_control (workspace_id, payload_json) VALUES (?, ?)
           ON CONFLICT(workspace_id) DO UPDATE SET payload_json = excluded.payload_json`,
        )
        .run(next.workspace_id, dumpJson(next));
      return next;
    });
  }
}
