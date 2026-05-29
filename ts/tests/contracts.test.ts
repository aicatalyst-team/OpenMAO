import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  AgentOutcomeSchema,
  AgentSchema,
  ApprovalRequestSchema,
  ArtifactSchema,
  BoundedWorkEnvelopeSchema,
  CapabilityCallSchema,
  CapabilityProviderRefSchema,
  CapabilityResultSchema,
  CapabilitySchema,
  canonicalSchemaBundle,
  EvaluationSchema,
  EventSchema,
  ExternalActorRefSchema,
  GoalSchema,
  IngestionRecordSchema,
  MemoryEntrySchema,
  ModelRequestSchema,
  ModelResponseSchema,
  NodeEffectSchema,
  newId,
  OrganizationSchema,
  OrgChangeProposalSchema,
  PolicyDecisionSchema,
  PolicyOutcomeSchema,
  PolicySchema,
  PromotionCandidateSchema,
  RoleSchema,
  RunSchema,
  TaskEnvelopeSchema,
  ToolSchema,
  TraceSchema,
  utcNow,
  validateId,
  validateUtcTimestamp,
  WorkerIdentitySchema,
  WorkerOutcomeSchema,
  WorkItemSchema,
  WorkspaceSchema,
  WorldModelSnapshotSchema,
} from "../src/contracts/index.js";

const fixturePath = new URL("../../tests/fixtures/canonical_v0.json", import.meta.url);
const schemaPath = new URL("../../schemas/canonical/v0.schema.json", import.meta.url);

function loadFixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
}

describe("canonical TypeScript contracts", () => {
  it("validates the canonical v0 fixture", () => {
    const fixture = loadFixture();

    WorkspaceSchema.parse(fixture.workspace);
    OrganizationSchema.parse(fixture.organization);
    for (const role of fixture.roles as unknown[]) {
      RoleSchema.parse(role);
    }
    for (const agent of fixture.agents as unknown[]) {
      AgentSchema.parse(agent);
    }
    ToolSchema.parse(fixture.tool);
    WorkerIdentitySchema.parse(fixture.worker_identity);
    GoalSchema.parse(fixture.goal);
    WorkItemSchema.parse(fixture.work_item);
    RunSchema.parse(fixture.run);
    TaskEnvelopeSchema.parse(fixture.task_envelope);
    BoundedWorkEnvelopeSchema.parse(fixture.bounded_work_envelope);
    AgentOutcomeSchema.parse(fixture.agent_outcome);
    WorkerOutcomeSchema.parse(fixture.worker_outcome);
    CapabilitySchema.parse(fixture.capability);
    CapabilityCallSchema.parse(fixture.capability_call);
    CapabilityResultSchema.parse(fixture.capability_result);
    MemoryEntrySchema.parse(fixture.memory_entry);
    PromotionCandidateSchema.parse(fixture.promotion_candidate);
    ArtifactSchema.parse(fixture.artifact);
    PolicySchema.parse(fixture.policy);
    PolicyDecisionSchema.parse(fixture.policy_decision);
    ApprovalRequestSchema.parse(fixture.approval_request);
    EvaluationSchema.parse(fixture.evaluation);
    EventSchema.parse(fixture.event);
    IngestionRecordSchema.parse(fixture.ingestion_record);
    TraceSchema.parse(fixture.trace);
    NodeEffectSchema.parse(fixture.node_effect);
    ModelRequestSchema.parse(fixture.model_request);
    ModelResponseSchema.parse(fixture.model_response);
    OrgChangeProposalSchema.parse(fixture.org_change_proposal);
    WorldModelSnapshotSchema.parse(fixture.world_model_snapshot);
  });

  it("validates canonical IDs and UTC timestamps", () => {
    const generatedId = newId("run");
    const generatedTimestamp = utcNow();

    expect(generatedId.startsWith("run_")).toBe(true);
    expect(validateId(generatedId)).toBe(generatedId);
    expect(generatedTimestamp.endsWith("Z")).toBe(true);
    expect(validateUtcTimestamp(generatedTimestamp)).toBe(generatedTimestamp);

    expect(() => newId("Run")).toThrow();
    expect(() => validateId("run_not-a-uuid")).toThrow();
    expect(() => validateUtcTimestamp("2026-05-27T15:20:00")).toThrow();
    expect(() => validateUtcTimestamp("2026-05-27 15:20:00+00:00")).toThrow();
  });

  it("rejects invalid fixture mutations", () => {
    const fixture = loadFixture();

    expect(() =>
      WorkspaceSchema.parse({
        ...(fixture.workspace as Record<string, unknown>),
        id: "workspace-not-canonical",
      }),
    ).toThrow();

    expect(() =>
      CapabilitySchema.parse({
        ...(fixture.capability as Record<string, unknown>),
        input_schema: {},
      }),
    ).toThrow();

    expect(() =>
      PolicyDecisionSchema.parse({
        ...(fixture.policy_decision as Record<string, unknown>),
        outcome: "approve",
      }),
    ).toThrow();
  });

  it("keeps policy outcomes and capability schema names canonical", () => {
    expect(PolicyOutcomeSchema.options).toEqual(["allow", "block", "require_approval", "log_only"]);

    const defs = canonicalSchemaBundle().$defs as Record<
      string,
      { properties: Record<string, unknown> }
    >;
    const capabilityProperties = defs.Capability?.properties ?? {};

    expect(capabilityProperties).toHaveProperty("canonical_input_schema");
    expect(capabilityProperties).toHaveProperty("canonical_output_schema");
    expect(capabilityProperties).toHaveProperty("credential_handle_required");
    expect(capabilityProperties).toHaveProperty("side_effecting");
    expect(capabilityProperties).not.toHaveProperty("input_schema");
    expect(capabilityProperties).not.toHaveProperty("output_schema");
  });

  it("requires v1 external-worker records to carry identity and idempotency", () => {
    const fixture = loadFixture();

    const worker = WorkerIdentitySchema.parse(fixture.worker_identity);
    const envelope = BoundedWorkEnvelopeSchema.parse(fixture.bounded_work_envelope);
    const ingestion = IngestionRecordSchema.parse(fixture.ingestion_record);

    expect(envelope.worker_id).toBe(worker.id);
    expect(envelope.issued_by.actor_type).toBe("agent");
    expect(ingestion.actor.actor_type).toBe("worker");
    expect(ingestion.idempotency_key).toContain(worker.id);

    expect(() =>
      IngestionRecordSchema.parse({
        ...(fixture.ingestion_record as Record<string, unknown>),
        idempotency_key: undefined,
      }),
    ).toThrow();

    expect(() =>
      BoundedWorkEnvelopeSchema.parse({
        ...(fixture.bounded_work_envelope as Record<string, unknown>),
        issued_by: { actor_id: worker.id },
      }),
    ).toThrow();
  });

  it("models enforced capability metadata without raw credential values", () => {
    const fixture = loadFixture();
    const providerRef = CapabilityProviderRefSchema.parse({
      provider: "mock.remote",
      tool_name: "mock.research",
      capability_name: "mock.research_lookup",
      credential_handle: "cred_mock_research_readonly",
      side_effecting: true,
      risk_level: "high",
      audit_payload_schema: { type: "object" },
    });
    const actor = ExternalActorRefSchema.parse({
      actor_type: "worker",
      actor_id: (fixture.worker_identity as { id: string }).id,
    });
    const call = CapabilityCallSchema.parse({
      ...(fixture.capability_call as Record<string, unknown>),
      external_actor: actor,
      credential_handle: providerRef.credential_handle,
      side_effecting: providerRef.side_effecting,
      risk_level: providerRef.risk_level,
    });

    expect(call.credential_handle).toBe("cred_mock_research_readonly");
    expect(JSON.stringify(call)).not.toMatch(/secret|token|password/i);

    const defs = canonicalSchemaBundle().$defs as Record<
      string,
      { properties: Record<string, unknown> }
    >;
    expect(defs.CapabilityProviderRef?.properties).not.toHaveProperty("credential_value");
    expect(defs.CapabilityCall?.properties).not.toHaveProperty("credential_value");
  });

  it("writes the canonical schema artifact from TypeScript", () => {
    const artifact = JSON.parse(readFileSync(schemaPath, "utf8"));

    expect(artifact).toEqual(canonicalSchemaBundle());
  });
});
