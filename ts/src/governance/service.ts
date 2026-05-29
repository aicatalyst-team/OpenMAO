import { createHash } from "node:crypto";

import {
  type Capability,
  type CapabilityCall,
  CapabilityCallSchema,
  CapabilitySchema,
  EventPayloadSchema,
  newId,
  type PolicyDecision,
  PolicyDecisionSchema,
  type PolicyOutcome,
} from "../contracts/index.js";
import type { OrgRegistry } from "../org/index.js";
import type { Database } from "../persistence/index.js";
import { EventStore } from "../persistence/index.js";

export class GovernanceService {
  private readonly events: EventStore;

  constructor(
    private readonly database: Database,
    private readonly orgRegistry: OrgRegistry,
  ) {
    this.events = new EventStore(database);
  }

  decideHandoff(input: {
    workspace_id: string;
    from_agent_id: string;
    to_agent_id: string;
    run_id?: string | null;
  }): PolicyDecision {
    const allowed = this.orgRegistry.canHandoff(input.from_agent_id, input.to_agent_id);
    return PolicyDecisionSchema.parse({
      id: newId("decision"),
      workspace_id: input.workspace_id,
      run_id: input.run_id ?? null,
      action: "handoff",
      target_type: "agent",
      target_id: input.to_agent_id,
      outcome: allowed ? "allow" : "block",
      reason: allowed
        ? "Org communication graph allows this handoff."
        : "Org communication graph does not allow this handoff.",
    });
  }

  decideCapability(callInput: CapabilityCall, capabilityInput: Capability): PolicyDecision {
    const call = CapabilityCallSchema.parse(callInput);
    const capability = CapabilitySchema.parse(capabilityInput);
    const grants = this.orgRegistry.allowedCapabilitiesForAgent(call.requested_by);
    let outcome: PolicyOutcome;
    let reason: string;

    if (capability.default_permission === "disabled") {
      outcome = "block";
      reason = `Capability is disabled: ${call.capability_name}.`;
    } else if (!grants.has(call.capability_name)) {
      outcome = "block";
      reason = `Agent role lacks capability grant: ${call.capability_name}.`;
    } else if (capability.default_permission === "approval_required") {
      outcome = "require_approval";
      reason = `Capability requires approval before execution: ${call.capability_name}.`;
    } else if (call.risk_level === "high") {
      outcome = "require_approval";
      reason = `High-risk capability call requires approval before execution: ${call.capability_name}.`;
    } else {
      outcome = "allow";
      reason = `Capability is enabled and granted: ${call.capability_name}.`;
    }

    return PolicyDecisionSchema.parse({
      id: newId("decision"),
      workspace_id: call.workspace_id,
      run_id: call.run_id,
      action: "capability.call",
      target_type: "capability_call",
      target_id: call.id,
      outcome,
      reason,
    });
  }

  recordDecision(decision: PolicyDecision, idempotencyKey?: string | null): PolicyDecision {
    const parsed = PolicyDecisionSchema.parse(decision);
    this.events.append({
      workspace_id: parsed.workspace_id,
      run_id: parsed.run_id,
      kind: "policy.decision",
      actor: "governance",
      payload: EventPayloadSchema.parse({ data: { policy_decision: parsed } }),
      idempotency_key: idempotencyKey ?? null,
    });
    return parsed;
  }

  getRecordedDecision(input: {
    workspace_id: string;
    idempotency_key: string;
  }): PolicyDecision | null {
    const event = this.events.getByIdempotencyKey(input.workspace_id, input.idempotency_key);
    if (!event) {
      return null;
    }
    if (event.kind !== "policy.decision") {
      throw new Error(
        `idempotency key does not reference a policy decision: ${input.idempotency_key}`,
      );
    }
    const payload = event.payload.data.policy_decision;
    return PolicyDecisionSchema.parse(payload);
  }

  checkHandoff(input: {
    workspace_id: string;
    from_agent_id: string;
    to_agent_id: string;
    run_id?: string | null;
  }): PolicyDecision {
    const idempotencyKey = this.handoffDecisionKey(input);
    const recorded = this.getRecordedDecision({
      workspace_id: input.workspace_id,
      idempotency_key: idempotencyKey,
    });
    if (recorded) {
      return recorded;
    }

    const decision = PolicyDecisionSchema.parse({
      ...this.decideHandoff(input),
      id: this.decisionIdForKey(idempotencyKey),
    });
    return this.recordDecision(decision, idempotencyKey);
  }

  private handoffDecisionKey(input: {
    run_id?: string | null;
    from_agent_id: string;
    to_agent_id: string;
  }): string {
    return `handoff:${input.run_id ?? "workspace"}:${input.from_agent_id}:${input.to_agent_id}`;
  }

  decisionIdForKey(key: string): string {
    return `decision_${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
  }

  get databaseForTesting(): Database {
    return this.database;
  }
}
