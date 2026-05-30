import { createHash } from "node:crypto";

import {
  type Event,
  EventPayloadSchema,
  type OrgChangeEvidence,
  type OrgChangeProposal,
  type OrgChangeSourceSignal,
} from "../contracts/index.js";
import { OrgChangeService } from "../org/index.js";
import {
  ApprovalStore,
  CapabilityStore,
  type Database,
  EventStore,
  MemoryEntryStore,
  WorkItemStore,
} from "../persistence/index.js";

type LearningSignal = {
  change_type: OrgChangeProposal["change_type"];
  confidence: number;
  evidence: OrgChangeEvidence[];
  impact: OrgChangeProposal["impact"];
  patch_json: Record<string, unknown>;
  rationale: string;
  source_signal: OrgChangeSourceSignal;
};

export type LearningScanResult = {
  workspace_id: string;
  proposals: Array<{ approval_id: string; proposal: OrgChangeProposal }>;
  signal_count: number;
};

const OPEN_PROPOSAL_STATUSES = new Set<OrgChangeProposal["status"]>([
  "draft",
  "pending",
  "proposed",
  "approved",
]);

export class LearningService {
  private readonly approvals: ApprovalStore;
  private readonly capabilities: CapabilityStore;
  private readonly events: EventStore;
  private readonly memory: MemoryEntryStore;
  private readonly workItems: WorkItemStore;

  constructor(private readonly database: Database) {
    this.approvals = new ApprovalStore(database);
    this.capabilities = new CapabilityStore(database);
    this.events = new EventStore(database);
    this.memory = new MemoryEntryStore(database);
    this.workItems = new WorkItemStore(database);
  }

  scan(workspaceId: string, at?: string): LearningScanResult {
    return this.database.transaction(() => {
      const signals = this.detectSignals(workspaceId);
      const service = new OrgChangeService(this.database);
      const proposals = signals.map((signal) =>
        service.propose({
          id: stableProposalId(workspaceId, signal),
          workspace_id: workspaceId,
          proposed_by: "learning_service",
          change_type: signal.change_type,
          source_signal: signal.source_signal,
          rationale: signal.rationale,
          evidence: signal.evidence,
          patch_json: signal.patch_json,
          confidence: signal.confidence,
          impact: signal.impact,
          // When invoked from the Chief of Staff loop, `at` stamps proposals with
          // the recorded tick time; the CLI/standalone path (null) defaults to now.
          created_at: at ?? null,
        }),
      );
      this.events.append({
        workspace_id: workspaceId,
        kind: "learning.scan.completed",
        actor: "learning_service",
        payload: EventPayloadSchema.parse({
          data: {
            signal_count: signals.length,
            proposal_count: proposals.length,
            source_signals: signals.map((signal) => signal.source_signal).sort(),
          },
          refs: proposals.map((item) => item.proposal.id),
        }),
        idempotency_key: stableScanKey(workspaceId, signals),
      });
      return { workspace_id: workspaceId, proposals, signal_count: signals.length };
    });
  }

  private detectSignals(workspaceId: string): LearningSignal[] {
    return [
      this.repeatedBlockers(workspaceId),
      this.failedHandoffs(workspaceId),
      this.approvalBottleneck(workspaceId),
      this.missingCapabilities(workspaceId),
      this.staleMemory(workspaceId),
    ].filter((signal): signal is LearningSignal => signal !== null);
  }

  private repeatedBlockers(workspaceId: string): LearningSignal | null {
    const blockedWork = this.workItems
      .listForWorkspace(workspaceId)
      .filter((workItem) => workItem.status === "blocked");
    const blockedEvents = this.events
      .listForWorkspace(workspaceId)
      .filter((event) => event.kind === "work.blocked");
    // Count distinct incidents so one blocked item plus its audit event is not "repeated."
    const blockedWorkIds = new Set([
      ...blockedWork.map((workItem) => workItem.id),
      ...blockedEvents
        .map((event) => eventData(event).work_item_id)
        .filter((workItemId): workItemId is string => typeof workItemId === "string"),
    ]);
    if (blockedWorkIds.size < 2) {
      return null;
    }
    const evidence = [
      ...blockedWork.map((workItem) => evidenceRef("work_item", workItem.id, "Blocked work item")),
      ...blockedEvents.map((event) => evidenceRef("event", event.id, `Blocker event ${event.seq}`)),
    ];
    return {
      source_signal: "repeated_blocker",
      change_type: "workflow",
      rationale:
        "Repeated blockers indicate the workflow or ownership model needs an explicit review.",
      evidence,
      patch_json: {
        recommendation: "Review blocker causes and update the escalation path or SOP.",
        blocked_work_items: blockedWork.map((workItem) => workItem.id),
      },
      confidence: 0.72,
      impact: "medium",
    };
  }

  private failedHandoffs(workspaceId: string): LearningSignal | null {
    const failures = this.events.listForWorkspace(workspaceId).filter((event) => {
      if (event.kind !== "work.outcome_submitted") {
        return false;
      }
      const outcome = eventData(event).worker_outcome;
      return isRecord(outcome) && (outcome.status === "blocked" || outcome.status === "failed");
    });
    if (failures.length === 0) {
      return null;
    }
    return {
      source_signal: "failed_handoff",
      change_type: "workflow",
      rationale:
        "A worker handoff returned blocked or failed, so the handoff contract should be reviewed.",
      evidence: failures.map((event) =>
        evidenceRef("event", event.id, `Worker outcome did not complete at event ${event.seq}`),
      ),
      patch_json: {
        recommendation: "Clarify handoff criteria, required context, and reviewer expectations.",
      },
      confidence: 0.68,
      impact: "medium",
    };
  }

  private approvalBottleneck(workspaceId: string): LearningSignal | null {
    const pending = this.approvals
      .listPending(workspaceId)
      .filter((approval) => approval.payload.target_type !== "org_change_proposal");
    if (pending.length < 2) {
      return null;
    }
    return {
      source_signal: "approval_bottleneck",
      change_type: "policy",
      rationale:
        "Multiple pending approvals indicate the approval policy or staffing model may be constraining flow.",
      evidence: pending.map((approval) =>
        evidenceRef("approval", approval.id, "Pending approval request"),
      ),
      patch_json: {
        recommendation:
          "Review approval thresholds, reviewer ownership, and whether lower-risk paths can be batched.",
      },
      confidence: 0.66,
      impact: "high",
    };
  }

  private missingCapabilities(workspaceId: string): LearningSignal | null {
    const gaps = this.capabilities
      .listForWorkspace(workspaceId)
      .filter(
        (capability) =>
          capability.providers.length === 0 || capability.default_permission === "disabled",
      );
    if (gaps.length === 0) {
      return null;
    }
    return {
      source_signal: "missing_capability",
      change_type: "capability_change",
      rationale:
        "One or more declared capabilities cannot currently execute because providers are missing or disabled.",
      evidence: gaps.map((capability) =>
        evidenceRef("capability", capability.name, "Capability gap"),
      ),
      patch_json: {
        recommendation: "Add or enable an appropriate provider after credential and policy review.",
        capabilities: gaps.map((capability) => capability.name),
      },
      confidence: 0.78,
      impact: "high",
    };
  }

  private staleMemory(workspaceId: string): LearningSignal | null {
    const stale = this.memory
      .listForWorkspace(workspaceId)
      .filter((entry) => entry.status === "stale");
    if (stale.length === 0) {
      return null;
    }
    return {
      source_signal: "stale_memory",
      change_type: "memory_cleanup",
      rationale:
        "Stale memory should be reviewed so the organization does not keep routing decisions through obsolete knowledge.",
      evidence: stale.map((entry) => evidenceRef("memory_entry", entry.id, "Stale memory entry")),
      patch_json: {
        recommendation: "Review, refresh, or retire stale memory entries.",
        memory_entries: stale.map((entry) => entry.id),
      },
      confidence: 0.7,
      impact: "medium",
    };
  }
}

function evidenceRef(
  kind: OrgChangeEvidence["kind"],
  ref_id: string,
  summary: string,
): OrgChangeEvidence {
  return { kind, ref_id, summary, weight: 1 };
}

function stableProposalId(workspaceId: string, signal: LearningSignal): string {
  const evidenceIds = signal.evidence.map((item) => `${item.kind}:${item.ref_id}`).sort();
  return `orgchg_${hash([workspaceId, signal.source_signal, ...evidenceIds].join("|"))}`;
}

function stableScanKey(workspaceId: string, signals: LearningSignal[]): string {
  return `learning:${workspaceId}:scan:${hash(
    signals
      .flatMap((signal) => [
        signal.source_signal,
        ...signal.evidence.map((item) => `${item.kind}:${item.ref_id}`),
      ])
      .sort()
      .join("|"),
  )}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function eventData(event: Event): Record<string, unknown> {
  return event.payload.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function openProposalIds(proposals: OrgChangeProposal[]): string[] {
  return proposals
    .filter((proposal) => OPEN_PROPOSAL_STATUSES.has(proposal.status))
    .map((proposal) => proposal.id)
    .sort();
}
