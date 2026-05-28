import { type OrgChangeProposal, OrgChangeProposalSchema, utcNow } from "../contracts/index.js";
import type { Database } from "./database.js";
import { dumpJson, jsonEqual } from "./serialization.js";

export type OrgChangeStatus = "draft" | "pending" | "approved" | "rejected" | "applied";
type PayloadRow = { payload_json: string };

export class OrgChangeProposalError extends Error {}

export class OrgChangeProposalStore {
  constructor(private readonly database: Database) {}

  save(proposal: OrgChangeProposal): OrgChangeProposal {
    const parsed = OrgChangeProposalSchema.parse(proposal);
    if (parsed.status === "applied") {
      throw new OrgChangeProposalError("v0 must not persist applied org mutations");
    }

    return this.database.transaction(() => {
      const existing = this.get(parsed.id);
      if (existing) {
        if (jsonEqual(existing, parsed)) {
          return existing;
        }
        throw new OrgChangeProposalError(`org change proposal already exists: ${parsed.id}`);
      }
      this.database.connection
        .prepare(
          `INSERT INTO org_change_proposals (id, workspace_id, status, payload_json)
           VALUES (?, ?, ?, ?)`,
        )
        .run(parsed.id, parsed.workspace_id, parsed.status, dumpJson(parsed));
      return parsed;
    });
  }

  get(proposalId: string): OrgChangeProposal | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM org_change_proposals WHERE id = ?")
      .get(proposalId) as PayloadRow | undefined;
    return row ? OrgChangeProposalSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  setStatus(
    proposalId: string,
    status: Exclude<OrgChangeStatus, "draft" | "applied">,
    options: { resolved_at?: string | null } = {},
  ): OrgChangeProposal {
    return this.database.transaction(() => {
      const current = this.get(proposalId);
      if (!current) {
        throw new Error(`org change proposal not found: ${proposalId}`);
      }
      if (current.status === "approved" || current.status === "rejected") {
        if (current.status === status) {
          return current;
        }
        throw new OrgChangeProposalError(
          `org change proposal already resolved as ${current.status}: ${proposalId}`,
        );
      }
      const updated = OrgChangeProposalSchema.parse({
        ...current,
        status,
        resolved_at:
          status === "approved" || status === "rejected"
            ? (options.resolved_at ?? utcNow())
            : current.resolved_at,
      });
      this.database.connection
        .prepare("UPDATE org_change_proposals SET status = ?, payload_json = ? WHERE id = ?")
        .run(updated.status, dumpJson(updated), updated.id);
      return updated;
    });
  }
}
