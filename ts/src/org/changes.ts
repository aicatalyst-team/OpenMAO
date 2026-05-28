import {
  type ApprovalRequest,
  EventPayloadSchema,
  type OrgChangeProposal,
} from "../contracts/index.js";
import {
  ApprovalStore,
  type Database,
  EventStore,
  OrgChangeProposalStore,
} from "../persistence/index.js";

export class OrgChangeServiceError extends Error {}

export class OrgChangeService {
  private readonly approvals: ApprovalStore;
  private readonly events: EventStore;
  private readonly proposals: OrgChangeProposalStore;

  constructor(private readonly database: Database) {
    this.approvals = new ApprovalStore(database);
    this.events = new EventStore(database);
    this.proposals = new OrgChangeProposalStore(database);
  }

  approveFromApproval(approval: ApprovalRequest): OrgChangeProposal {
    return this.database.transaction(() => {
      const authoritativeApproval = this.approvals.get(approval.id);
      if (!authoritativeApproval) {
        throw new OrgChangeServiceError(`approval request not found: ${approval.id}`);
      }
      if (authoritativeApproval.status !== "approved") {
        throw new OrgChangeServiceError(
          `approval must be approved before application: ${approval.id}`,
        );
      }
      if (authoritativeApproval.on_approve !== "apply_without_run") {
        throw new OrgChangeServiceError(
          `org change approval must use apply_without_run: ${approval.id}`,
        );
      }
      if (authoritativeApproval.payload.target_type !== "org_change_proposal") {
        throw new OrgChangeServiceError(
          `approval does not target an org change proposal: ${approval.id}`,
        );
      }
      const proposal = this.proposals.get(authoritativeApproval.payload.target_id);
      if (!proposal) {
        throw new OrgChangeServiceError(
          `org change proposal not found: ${authoritativeApproval.payload.target_id}`,
        );
      }
      if (proposal.workspace_id !== authoritativeApproval.workspace_id) {
        throw new OrgChangeServiceError(
          "approval workspace does not match org change proposal workspace",
        );
      }
      const approved = this.proposals.setStatus(proposal.id, "approved", {
        resolved_at: authoritativeApproval.resolved_at,
      });
      this.events.append({
        workspace_id: authoritativeApproval.workspace_id,
        kind: "org_change.approved",
        actor: "org_change_service",
        payload: EventPayloadSchema.parse({
          data: { approval_request: authoritativeApproval, org_change_proposal: approved },
          refs: [authoritativeApproval.id, approved.id],
        }),
        idempotency_key: `${authoritativeApproval.id}:org_change.approved`,
      });
      return approved;
    });
  }
}
