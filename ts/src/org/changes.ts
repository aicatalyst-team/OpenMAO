import {
  ApprovalPayloadSchema,
  type ApprovalRequest,
  EventPayloadSchema,
  type OrgChangeApplication,
  type OrgChangeEvidence,
  type OrgChangeProposal,
  OrgChangeProposalSchema,
  type OrgChangeSourceSignal,
  utcNow,
} from "../contracts/index.js";
import { ApprovalService } from "../governance/index.js";
import {
  ApprovalStore,
  type Database,
  EventStore,
  OrgChangeProposalStore,
} from "../persistence/index.js";
import {
  assertNoSensitiveMaterial,
  assertNoSensitiveString,
} from "../security/sensitive-material.js";
import { OrgChangeApplyService } from "./apply.js";

type ProposeOrgChangeInput = {
  id: string;
  workspace_id: string;
  proposed_by: string;
  change_type: OrgChangeProposal["change_type"];
  source_signal?: OrgChangeSourceSignal;
  rationale: string;
  evidence?: OrgChangeEvidence[];
  patch_json?: Record<string, unknown>;
  confidence?: number;
  impact?: OrgChangeProposal["impact"];
  review_approval_id?: string | null;
  created_at?: string | null;
};

export class OrgChangeServiceError extends Error {}

export class OrgChangeService {
  private readonly approvals: ApprovalStore;
  private readonly events: EventStore;
  private readonly proposals: OrgChangeProposalStore;
  private readonly applyService: OrgChangeApplyService;

  constructor(
    private readonly database: Database,
    options: { applyService?: OrgChangeApplyService } = {},
  ) {
    this.approvals = new ApprovalStore(database);
    this.events = new EventStore(database);
    this.proposals = new OrgChangeProposalStore(database);
    this.applyService = options.applyService ?? new OrgChangeApplyService(database);
  }

  propose(input: ProposeOrgChangeInput): { approval_id: string; proposal: OrgChangeProposal } {
    return this.database.transaction(() => {
      const approvalId = input.review_approval_id ?? stableApprovalId(input.id);
      assertNoSensitiveString(input.rationale, "org_change.rationale");
      assertNoSensitiveMaterial(input.evidence ?? [], "org_change.evidence");
      assertNoSensitiveMaterial(input.patch_json ?? {}, "org_change.patch_json");
      const proposal = OrgChangeProposalSchema.parse({
        id: input.id,
        workspace_id: input.workspace_id,
        proposed_by: input.proposed_by,
        change_type: input.change_type,
        source_signal: input.source_signal ?? "manual",
        rationale: input.rationale,
        evidence: input.evidence ?? [],
        patch_json: input.patch_json ?? {},
        confidence: input.confidence ?? 0.5,
        impact: input.impact ?? "medium",
        review_approval_id: approvalId,
        status: "proposed",
        created_at: input.created_at ?? utcNow(),
      });
      const existing = this.proposals.get(proposal.id);
      const stored = existing ?? this.proposals.save(proposal);
      if (!existing) {
        this.events.append({
          workspace_id: stored.workspace_id,
          kind: "org_change.proposed",
          actor: "org_change_service",
          payload: EventPayloadSchema.parse({
            data: { org_change_proposal: stored },
            refs: [stored.id, ...stored.evidence.map((item) => item.ref_id).filter(isCanonicalId)],
          }),
          idempotency_key: `${stored.id}:proposed`,
          timestamp: stored.created_at,
        });
      }
      const approval = new ApprovalService(this.database).request({
        approval_id: stored.review_approval_id ?? approvalId,
        workspace_id: stored.workspace_id,
        action: "org_change.review",
        requested_by: stored.proposed_by,
        payload: ApprovalPayloadSchema.parse({
          target_type: "org_change_proposal",
          target_id: stored.id,
          reason: stored.rationale,
          data: { org_change_proposal_id: stored.id },
        }),
        on_approve: "apply_without_run",
        on_reject: "no_op",
      });
      return { proposal: stored, approval_id: approval.id };
    });
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

  markApplied(
    proposalId: string,
    input: { workspace_id: string; actor: string; resolved_at?: string | null },
  ): OrgChangeProposal {
    return this.database.transaction(() => {
      const proposal = this.proposals.get(proposalId);
      if (!proposal) {
        throw new OrgChangeServiceError(`org change proposal not found: ${proposalId}`);
      }
      if (proposal.workspace_id !== input.workspace_id) {
        throw new OrgChangeServiceError("org change proposal does not belong to workspace");
      }
      if (proposal.status === "applied") {
        return proposal;
      }
      if (proposal.status !== "approved") {
        throw new OrgChangeServiceError("org change proposal must be approved before applied");
      }

      // M1: when a real applier exists for this change type, apply for real — a reversible,
      // verified mutation recorded as an OrgChangeApplication, with guardrails — instead of the
      // marker-only no-op. Change types without an applier keep the honest marker behaviour.
      if (this.applyService.hasApplier(proposal.change_type)) {
        this.applyService.apply(proposalId, {
          workspace_id: input.workspace_id,
          actor: input.actor,
          at: input.resolved_at ?? null,
        });
        const realApplied = this.proposals.get(proposalId);
        if (!realApplied) {
          throw new OrgChangeServiceError(
            `org change proposal not found after apply: ${proposalId}`,
          );
        }
        return realApplied;
      }

      // Marker path (change types without a real applier yet): still gate it with the shared apply
      // guardrails, so a paused / unevidenced / self-applied proposal cannot advance to `applied`
      // by any route — the kill-switch covers everything.
      this.applyService.assertApplyAllowed(proposal, {
        workspace_id: input.workspace_id,
        actor: input.actor,
      });
      const applied = this.proposals.setStatus(
        proposal.id,
        "applied",
        input.resolved_at === undefined ? {} : { resolved_at: input.resolved_at },
      );
      this.events.append({
        workspace_id: applied.workspace_id,
        kind: "org_change.applied",
        actor: input.actor,
        payload: EventPayloadSchema.parse({
          data: {
            org_change_proposal: applied,
            applied_as_marker_only: true,
          },
          refs: [applied.id],
        }),
        idempotency_key: `${applied.id}:applied`,
      });
      return applied;
    });
  }

  /**
   * Reverse a previously-applied org change (M1 reversible apply). Delegates to the apply engine,
   * which refuses if any target has drifted since it was applied (revert-conflict).
   */
  revertApplication(
    applicationId: string,
    input: { workspace_id: string; actor: string; resolved_at?: string | null },
  ): OrgChangeApplication {
    return this.applyService.revert(applicationId, {
      workspace_id: input.workspace_id,
      actor: input.actor,
      at: input.resolved_at ?? null,
    });
  }
}

function stableApprovalId(proposalId: string): string {
  const suffix = proposalId.split("_", 2)[1];
  if (suffix?.match(/^[0-9a-f]{32}$/)) {
    return `approval_${suffix}`;
  }
  throw new OrgChangeServiceError(`invalid org change proposal id: ${proposalId}`);
}

function isCanonicalId(value: string): boolean {
  return /^[a-z][a-z0-9]*_[0-9a-f]{32}$/.test(value);
}
