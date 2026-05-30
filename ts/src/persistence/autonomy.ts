import { type AutonomyCase, AutonomyCaseSchema, utcNow } from "../contracts/index.js";
import type { Database } from "./database.js";
import { dumpJson, jsonEqual } from "./serialization.js";

type PayloadRow = { payload_json: string };

export class AutonomyCaseError extends Error {}

/**
 * Persists `AutonomyCase` records — human-ratified, evidence-backed requests to widen an org's
 * autonomy. A new case is always `proposed`; `setStatus` drives the one-way proposed → ratified |
 * rejected resolution (a resolved case can never be re-opened).
 */
export class AutonomyCaseStore {
  constructor(private readonly database: Database) {}

  save(autonomyCase: AutonomyCase): AutonomyCase {
    const parsed = AutonomyCaseSchema.parse(autonomyCase);
    if (parsed.status !== "proposed") {
      throw new AutonomyCaseError("new autonomy cases must be saved as proposed");
    }
    return this.database.transaction(() => {
      const existing = this.get(parsed.id);
      if (existing) {
        if (jsonEqual(existing, parsed)) {
          return existing;
        }
        throw new AutonomyCaseError(`autonomy case already exists: ${parsed.id}`);
      }
      this.database.connection
        .prepare(
          `INSERT INTO autonomy_cases (id, workspace_id, org_id, status, payload_json)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(parsed.id, parsed.workspace_id, parsed.org_id, parsed.status, dumpJson(parsed));
      return parsed;
    });
  }

  get(caseId: string): AutonomyCase | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM autonomy_cases WHERE id = ?")
      .get(caseId) as PayloadRow | undefined;
    return row ? AutonomyCaseSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listForWorkspace(workspaceId: string): AutonomyCase[] {
    const rows = this.database.connection
      .prepare("SELECT payload_json FROM autonomy_cases WHERE workspace_id = ? ORDER BY id")
      .all(workspaceId) as PayloadRow[];
    return rows.map((row) => AutonomyCaseSchema.parse(JSON.parse(row.payload_json)));
  }

  setStatus(
    caseId: string,
    status: "ratified" | "rejected",
    options: { ratified_by?: string | null; resolved_at?: string | null } = {},
  ): AutonomyCase {
    return this.database.transaction(() => {
      const current = this.get(caseId);
      if (!current) {
        throw new AutonomyCaseError(`autonomy case not found: ${caseId}`);
      }
      if (current.status !== "proposed") {
        if (current.status === status) {
          return current;
        }
        throw new AutonomyCaseError(
          `autonomy case already resolved as ${current.status}: ${caseId}`,
        );
      }
      const updated = AutonomyCaseSchema.parse({
        ...current,
        status,
        ratified_by: options.ratified_by === undefined ? current.ratified_by : options.ratified_by,
        resolved_at: options.resolved_at ?? utcNow(),
      });
      this.database.connection
        .prepare("UPDATE autonomy_cases SET status = ?, payload_json = ? WHERE id = ?")
        .run(updated.status, dumpJson(updated), updated.id);
      return updated;
    });
  }
}
