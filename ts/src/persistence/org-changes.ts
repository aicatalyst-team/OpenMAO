import {
  type OrgChangeApplication,
  OrgChangeApplicationSchema,
  type OrgChangeProposal,
  OrgChangeProposalSchema,
  utcNow,
} from "../contracts/index.js";
import type { Database } from "./database.js";
import { dumpJson, jsonEqual } from "./serialization.js";

export type OrgChangeStatus =
  | "draft"
  | "pending"
  | "proposed"
  | "approved"
  | "rejected"
  | "applied";
type PayloadRow = { payload_json: string };

export class OrgChangeProposalError extends Error {}

export class OrgChangeProposalStore {
  constructor(private readonly database: Database) {}

  save(proposal: OrgChangeProposal): OrgChangeProposal {
    const parsed = OrgChangeProposalSchema.parse(proposal);
    if (parsed.status === "applied") {
      throw new OrgChangeProposalError("new org change proposals must not be saved as applied");
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

  listForWorkspace(workspaceId: string): OrgChangeProposal[] {
    const rows = this.database.connection
      .prepare(
        `SELECT payload_json
         FROM org_change_proposals
         WHERE workspace_id = ?
         ORDER BY id`,
      )
      .all(workspaceId) as PayloadRow[];
    return rows.map((row) => OrgChangeProposalSchema.parse(JSON.parse(row.payload_json)));
  }

  setStatus(
    proposalId: string,
    status: Exclude<OrgChangeStatus, "draft" | "pending" | "proposed">,
    options: { resolved_at?: string | null } = {},
  ): OrgChangeProposal {
    return this.database.transaction(() => {
      const current = this.get(proposalId);
      if (!current) {
        throw new Error(`org change proposal not found: ${proposalId}`);
      }
      if (status === "applied" && current.status !== "approved" && current.status !== "applied") {
        throw new OrgChangeProposalError(
          `org change proposal must be approved before applied: ${proposalId}`,
        );
      }
      if (
        current.status === "approved" ||
        current.status === "rejected" ||
        current.status === "applied"
      ) {
        if (current.status === status) {
          return current;
        }
        if (current.status === "approved" && status === "applied") {
          const applied = OrgChangeProposalSchema.parse({
            ...current,
            status,
            applied_at: options.resolved_at ?? utcNow(),
          });
          this.database.connection
            .prepare("UPDATE org_change_proposals SET status = ?, payload_json = ? WHERE id = ?")
            .run(applied.status, dumpJson(applied), applied.id);
          return applied;
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
        applied_at: status === "applied" ? (options.resolved_at ?? utcNow()) : current.applied_at,
      });
      this.database.connection
        .prepare("UPDATE org_change_proposals SET status = ?, payload_json = ? WHERE id = ?")
        .run(updated.status, dumpJson(updated), updated.id);
      return updated;
    });
  }
}

export class OrgChangeApplicationError extends Error {}

/**
 * Persists `OrgChangeApplication` records — the first-class, idempotent log of an org change
 * being actually applied. One application per proposal (id derived from the proposal), so
 * `create` is get-or-create: a replayed apply returns the existing record instead of mutating
 * twice. `setStatus` drives the applied → verified → reverted lifecycle.
 */
export class OrgChangeApplicationStore {
  constructor(private readonly database: Database) {}

  create(application: OrgChangeApplication): OrgChangeApplication {
    const parsed = OrgChangeApplicationSchema.parse(application);
    // An application is born `applied`; it reaches `verified` only through `setStatus` after the
    // apply engine's post-apply check. This keeps the verified track record (which M4 earns autonomy
    // against) from being injected as a fully-`verified` row at construction.
    if (parsed.status !== "applied") {
      throw new OrgChangeApplicationError(
        `new org change applications must be created as 'applied', not '${parsed.status}'`,
      );
    }
    return this.database.transaction(() => {
      const existing = this.get(parsed.id);
      if (existing) {
        if (jsonEqual(existing, parsed)) {
          return existing;
        }
        throw new OrgChangeApplicationError(`org change application already exists: ${parsed.id}`);
      }
      this.database.connection
        .prepare(
          `INSERT INTO org_change_applications (id, workspace_id, proposal_id, status, payload_json)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(parsed.id, parsed.workspace_id, parsed.proposal_id, parsed.status, dumpJson(parsed));
      return parsed;
    });
  }

  get(applicationId: string): OrgChangeApplication | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM org_change_applications WHERE id = ?")
      .get(applicationId) as PayloadRow | undefined;
    return row ? OrgChangeApplicationSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  getForProposal(workspaceId: string, proposalId: string): OrgChangeApplication | null {
    const row = this.database.connection
      .prepare(
        `SELECT payload_json
         FROM org_change_applications
         WHERE workspace_id = ? AND proposal_id = ?`,
      )
      .get(workspaceId, proposalId) as PayloadRow | undefined;
    return row ? OrgChangeApplicationSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listForWorkspace(workspaceId: string): OrgChangeApplication[] {
    const rows = this.database.connection
      .prepare(
        "SELECT payload_json FROM org_change_applications WHERE workspace_id = ? ORDER BY id",
      )
      .all(workspaceId) as PayloadRow[];
    return rows.map((row) => OrgChangeApplicationSchema.parse(JSON.parse(row.payload_json)));
  }

  setStatus(
    applicationId: string,
    status: OrgChangeApplication["status"],
    options: {
      verified_at?: string | null;
      reverted_at?: string | null;
      failure_reason?: string | null;
    } = {},
  ): OrgChangeApplication {
    return this.database.transaction(() => {
      const current = this.get(applicationId);
      if (!current) {
        throw new OrgChangeApplicationError(`org change application not found: ${applicationId}`);
      }
      const updated = OrgChangeApplicationSchema.parse({
        ...current,
        status,
        verified_at: options.verified_at === undefined ? current.verified_at : options.verified_at,
        reverted_at: options.reverted_at === undefined ? current.reverted_at : options.reverted_at,
        failure_reason:
          options.failure_reason === undefined ? current.failure_reason : options.failure_reason,
      });
      this.database.connection
        .prepare("UPDATE org_change_applications SET status = ?, payload_json = ? WHERE id = ?")
        .run(updated.status, dumpJson(updated), updated.id);
      return updated;
    });
  }
}
