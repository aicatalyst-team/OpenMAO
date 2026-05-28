import { type ApprovalRequest, ApprovalRequestSchema, utcNow } from "../contracts/index.js";
import type { Database } from "./database.js";
import { dumpJson, jsonEqual } from "./serialization.js";

export type ApprovalStatus = "pending" | "approved" | "rejected";
export type ApprovalResolutionStatus = "approved" | "rejected";

type PayloadRow = { payload_json: string };

export class ApprovalConflictError extends Error {}
export class ApprovalResolutionError extends Error {}

export class ApprovalStore {
  constructor(private readonly database: Database) {}

  create(approval: ApprovalRequest): ApprovalRequest {
    const parsed = ApprovalRequestSchema.parse(approval);

    return this.database.transaction(() => {
      const existing = this.get(parsed.id);
      if (existing) {
        if (jsonEqual(existing, parsed)) {
          return existing;
        }

        throw new ApprovalConflictError(`approval request already exists: ${parsed.id}`);
      }

      this.database.connection
        .prepare(
          `INSERT INTO approval_requests (id, workspace_id, run_id, status, payload_json)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(parsed.id, parsed.workspace_id, parsed.run_id, parsed.status, dumpJson(parsed));
      return parsed;
    });
  }

  get(approvalId: string): ApprovalRequest | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM approval_requests WHERE id = ?")
      .get(approvalId) as PayloadRow | undefined;

    return row ? ApprovalRequestSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listPending(workspaceId: string): ApprovalRequest[] {
    const rows = this.database.connection
      .prepare(
        `SELECT payload_json
         FROM approval_requests
         WHERE workspace_id = ? AND status = 'pending'
         ORDER BY id`,
      )
      .all(workspaceId) as PayloadRow[];

    return rows.map((row) => ApprovalRequestSchema.parse(JSON.parse(row.payload_json)));
  }

  findForTarget(input: {
    workspace_id: string;
    target_type: string;
    target_id: string;
    statuses?: Set<ApprovalStatus>;
  }): ApprovalRequest | null {
    const allowedStatuses = input.statuses ?? new Set<ApprovalStatus>(["pending"]);
    const rows = this.database.connection
      .prepare(
        `SELECT payload_json
         FROM approval_requests
         WHERE workspace_id = ?
         ORDER BY id`,
      )
      .all(input.workspace_id) as PayloadRow[];

    for (const row of rows) {
      const approval = ApprovalRequestSchema.parse(JSON.parse(row.payload_json));
      if (
        allowedStatuses.has(approval.status) &&
        approval.payload.target_type === input.target_type &&
        approval.payload.target_id === input.target_id
      ) {
        return approval;
      }
    }

    return null;
  }

  resolve(
    approvalId: string,
    status: ApprovalResolutionStatus,
    options: { resolved_at?: string | null } = {},
  ): ApprovalRequest {
    return this.database.transaction(() => {
      const current = this.get(approvalId);
      if (!current) {
        throw new Error(`approval request not found: ${approvalId}`);
      }
      if (current.status !== "pending") {
        if (current.status === status) {
          return current;
        }
        throw new ApprovalResolutionError(
          `approval request already resolved as ${current.status}: ${approvalId}`,
        );
      }

      const updated = ApprovalRequestSchema.parse({
        ...current,
        status,
        resolved_at: options.resolved_at ?? utcNow(),
      });
      this.database.connection
        .prepare(
          `UPDATE approval_requests
           SET status = ?, payload_json = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(updated.status, dumpJson(updated), updated.id);
      return updated;
    });
  }
}
