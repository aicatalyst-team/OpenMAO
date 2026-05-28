import { z } from "zod";

import { ID_PATTERN, UTC_TIMESTAMP_PATTERN } from "./ids.js";

const recordSchema = z.record(z.string(), z.unknown());

export const CanonicalIdSchema = z.string().regex(new RegExp(ID_PATTERN));
export const UtcTimestampSchema = z.string().regex(new RegExp(UTC_TIMESTAMP_PATTERN));
export const PolicyOutcomeSchema = z.enum(["allow", "block", "require_approval", "log_only"]);
export const RunStatusSchema = z.enum([
  "queued",
  "running",
  "suspended_approval",
  "completed",
  "failed",
]);

export const ExternalSourceSchema = z
  .object({
    provider: z.string().default("openmao"),
    external_id: z.string().nullable().default(null),
    external_url: z.string().nullable().default(null),
  })
  .strict();

export const MemoryScopeSchema = z
  .object({
    read: z.array(z.string()).default([]),
    write: z.array(z.string()).default([]),
  })
  .strict();

export const ProvenanceSchema = z
  .object({
    agent_id: CanonicalIdSchema.nullable().default(null),
    role_id: CanonicalIdSchema.nullable().default(null),
    task_id: CanonicalIdSchema.nullable().default(null),
    run_id: CanonicalIdSchema.nullable().default(null),
    source_event_id: CanonicalIdSchema.nullable().default(null),
    note: z.string().nullable().default(null),
  })
  .strict();

export const CostSchema = z
  .object({
    tokens_in: z.number().int().default(0),
    tokens_out: z.number().int().default(0),
    usd: z.number().default(0),
    provider: z.string().nullable().default(null),
    model: z.string().nullable().default(null),
  })
  .strict();

export const ArtifactRefSchema = z
  .object({
    artifact_id: CanonicalIdSchema,
    content_ref: z.string().nullable().default(null),
  })
  .strict();

export const ApprovalPayloadSchema = z
  .object({
    target_type: z.string(),
    target_id: CanonicalIdSchema,
    reason: z.string(),
    data: recordSchema.default({}),
  })
  .strict();

export const EventPayloadSchema = z
  .object({
    data: recordSchema.default({}),
    refs: z.array(CanonicalIdSchema).default([]),
  })
  .strict();

export const WorkspaceSchema = z
  .object({
    id: CanonicalIdSchema,
    name: z.string(),
    created_at: UtcTimestampSchema,
    default_org_id: CanonicalIdSchema.nullable().default(null),
  })
  .strict();

export const OrganizationSchema = z
  .object({
    id: CanonicalIdSchema,
    workspace_id: CanonicalIdSchema,
    name: z.string(),
    type: z.string().default("custom"),
    mission: z.string(),
    vision: z.string().nullable().default(null),
    values: z.array(z.string()).default([]),
    goals: z.array(z.string()).default([]),
    policies: z.array(z.string()).default([]),
    autonomy_level: z.enum(["advisory", "supervised", "bounded"]).default("supervised"),
    config_version: z.string().default("0.1"),
  })
  .strict();

export const RoleSchema = z
  .object({
    id: CanonicalIdSchema,
    workspace_id: CanonicalIdSchema,
    name: z.string(),
    purpose: z.string(),
    responsibilities: z.array(z.string()).default([]),
    permissions: z.array(z.string()).default([]),
    capability_grants: z.array(z.string()).default([]),
    reports_to: CanonicalIdSchema.nullable().default(null),
    kpis: z.array(z.string()).default([]),
  })
  .strict();

export const AgentSchema = z
  .object({
    id: CanonicalIdSchema,
    workspace_id: CanonicalIdSchema,
    role_id: CanonicalIdSchema,
    identity: z.string(),
    memory_scope: MemoryScopeSchema.default({ read: [], write: [] }),
    model_binding: z.string().default("mock"),
    status: z.enum(["idle", "running", "blocked", "disabled"]).default("idle"),
  })
  .strict();

export const GoalSchema = z
  .object({
    id: CanonicalIdSchema,
    workspace_id: CanonicalIdSchema,
    objective: z.string(),
    owner_role: CanonicalIdSchema.nullable().default(null),
    success_metrics: z.array(z.string()).default([]),
    deadline: z.string().nullable().default(null),
    constraints: z.array(z.string()).default([]),
    status: z.enum(["proposed", "active", "blocked", "done", "cancelled"]).default("proposed"),
  })
  .strict();

export const WorkItemSchema = z
  .object({
    id: CanonicalIdSchema,
    workspace_id: CanonicalIdSchema,
    title: z.string(),
    objective: z.string(),
    owner: z.string(),
    reviewer: z.string().nullable().default(null),
    status: z
      .enum(["queued", "in_progress", "blocked", "review", "done", "failed"])
      .default("queued"),
    priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
    success_criteria: z.array(z.string()).default([]),
    risk_level: z.enum(["low", "medium", "high"]).default("low"),
    approval_gates: z.array(z.string()).default([]),
    source: ExternalSourceSchema.default({
      provider: "openmao",
      external_id: null,
      external_url: null,
    }),
    memory_scope: MemoryScopeSchema.default({ read: [], write: [] }),
    evaluation: z.array(CanonicalIdSchema).default([]),
  })
  .strict();

export const RunSchema = z
  .object({
    id: CanonicalIdSchema,
    workspace_id: CanonicalIdSchema,
    status: RunStatusSchema.default("queued"),
    active_node: z.string().nullable().default(null),
    suspended_approval_id: CanonicalIdSchema.nullable().default(null),
    created_at: UtcTimestampSchema,
    updated_at: UtcTimestampSchema,
  })
  .strict();

export const TaskEnvelopeSchema = z
  .object({
    id: CanonicalIdSchema,
    workspace_id: CanonicalIdSchema,
    run_id: CanonicalIdSchema,
    work_item_id: CanonicalIdSchema,
    from_agent: CanonicalIdSchema.nullable().default(null),
    to_agent: CanonicalIdSchema,
    objective: z.string(),
    context_refs: z.array(z.string()).default([]),
    allowed_capabilities: z.array(z.string()).default([]),
    approval_gates: z.array(z.string()).default([]),
  })
  .strict();

export const AgentOutcomeSchema = z
  .object({
    task_id: CanonicalIdSchema,
    status: z.enum(["completed", "blocked", "failed"]),
    summary: z.string(),
    artifacts: z.array(ArtifactRefSchema).default([]),
    memory_writes: z.array(CanonicalIdSchema).default([]),
    promotion_candidates: z.array(CanonicalIdSchema).default([]),
    cost: CostSchema.default({
      tokens_in: 0,
      tokens_out: 0,
      usd: 0,
      provider: null,
      model: null,
    }),
    trace_ref: CanonicalIdSchema,
  })
  .strict();

export const CapabilitySchema = z
  .object({
    name: z.string(),
    workspace_id: CanonicalIdSchema,
    description: z.string(),
    canonical_input_schema: recordSchema,
    canonical_output_schema: recordSchema,
    providers: z.array(z.string()).default([]),
    default_permission: z
      .enum(["enabled", "approval_required", "disabled"])
      .default("approval_required"),
  })
  .strict();

export const CapabilityCallSchema = z
  .object({
    id: CanonicalIdSchema,
    workspace_id: CanonicalIdSchema,
    run_id: CanonicalIdSchema,
    capability_name: z.string(),
    provider: z.string(),
    input: recordSchema,
    requested_by: z.string(),
    task_id: CanonicalIdSchema,
    risk_level: z.enum(["low", "medium", "high"]).default("low"),
    idempotency_key: z.string(),
  })
  .strict();

export const CapabilityResultSchema = z
  .object({
    id: CanonicalIdSchema,
    workspace_id: CanonicalIdSchema,
    run_id: CanonicalIdSchema,
    call_id: CanonicalIdSchema,
    node_effect_id: CanonicalIdSchema.nullable().default(null),
    status: z.enum(["ok", "blocked", "failed"]),
    output: recordSchema.default({}),
    artifacts: z.array(ArtifactRefSchema).default([]),
    error: z.string().nullable().default(null),
  })
  .strict();

export const MemoryEntrySchema = z
  .object({
    id: CanonicalIdSchema,
    workspace_id: CanonicalIdSchema,
    scope: z.enum(["individual", "collective"]),
    owner_id: CanonicalIdSchema.nullable().default(null),
    kind: z.enum(["episodic", "procedural", "semantic", "decision"]),
    content: z.string(),
    provenance: ProvenanceSchema,
    confidence: z.number().default(0.5),
    status: z.enum(["provisional", "confirmed", "rejected", "stale"]).default("provisional"),
    created_at: UtcTimestampSchema,
  })
  .strict();

export const PromotionCandidateSchema = z
  .object({
    id: CanonicalIdSchema,
    workspace_id: CanonicalIdSchema,
    source_memory_entry: CanonicalIdSchema,
    proposed_by: z.string(),
    proposed_content: z.string(),
    rationale: z.string(),
    corroboration_count: z.number().int().default(0),
    status: z.enum(["pending", "ratified", "rejected"]).default("pending"),
    created_at: UtcTimestampSchema,
    resolved_at: UtcTimestampSchema.nullable().default(null),
  })
  .strict();

export const ArtifactSchema = z
  .object({
    id: CanonicalIdSchema,
    workspace_id: CanonicalIdSchema,
    type: z.string(),
    content_ref: z.string(),
    produced_by: z.string(),
    task_id: CanonicalIdSchema,
    created_at: UtcTimestampSchema,
    content_hash: z.string().nullable().default(null),
  })
  .strict();

export const PolicySchema = z
  .object({
    id: CanonicalIdSchema,
    workspace_id: CanonicalIdSchema,
    rule: z.string(),
    applies_to: z.array(z.string()).default([]),
    risk_class: z.enum(["low", "medium", "high"]),
    enforcement: PolicyOutcomeSchema,
  })
  .strict();

export const PolicyDecisionSchema = z
  .object({
    id: CanonicalIdSchema,
    workspace_id: CanonicalIdSchema,
    run_id: CanonicalIdSchema.nullable().default(null),
    action: z.string(),
    target_type: z.string().nullable().default(null),
    target_id: CanonicalIdSchema.nullable().default(null),
    outcome: PolicyOutcomeSchema,
    reason: z.string(),
    approval_id: CanonicalIdSchema.nullable().default(null),
    source: z.enum(["structural", "manual", "future_rule_engine"]).default("structural"),
  })
  .strict();

export const ApprovalRequestSchema = z
  .object({
    id: CanonicalIdSchema,
    workspace_id: CanonicalIdSchema,
    run_id: CanonicalIdSchema.nullable().default(null),
    action: z.string(),
    requested_by: z.string(),
    payload: ApprovalPayloadSchema,
    status: z.enum(["pending", "approved", "rejected"]).default("pending"),
    on_approve: z.enum(["resume_run", "apply_without_run"]).default("resume_run"),
    on_reject: z.enum(["fail_run", "skip_action", "no_op"]).default("fail_run"),
    created_at: UtcTimestampSchema,
    resolved_at: UtcTimestampSchema.nullable().default(null),
  })
  .strict();

export const EvaluationSchema = z
  .object({
    id: CanonicalIdSchema,
    workspace_id: CanonicalIdSchema,
    task_id: CanonicalIdSchema,
    rubric: z.string(),
    score: z.number(),
    passed: z.boolean(),
    notes: z.string(),
  })
  .strict();

export const EventSchema = z
  .object({
    id: CanonicalIdSchema,
    workspace_id: CanonicalIdSchema,
    run_id: CanonicalIdSchema.nullable().default(null),
    seq: z.number().int(),
    run_seq: z.number().int().nullable().default(null),
    kind: z.string(),
    actor: z.string(),
    payload: EventPayloadSchema.default({ data: {}, refs: [] }),
    timestamp: UtcTimestampSchema,
    idempotency_key: z.string().nullable().default(null),
  })
  .strict();

export const TraceSchema = z
  .object({
    id: CanonicalIdSchema,
    workspace_id: CanonicalIdSchema,
    run_id: CanonicalIdSchema,
    node: z.string(),
    inputs_ref: z.string().nullable().default(null),
    outputs_ref: z.string().nullable().default(null),
    cost: CostSchema.default({
      tokens_in: 0,
      tokens_out: 0,
      usd: 0,
      provider: null,
      model: null,
    }),
    timestamp: UtcTimestampSchema,
    event_ids: z.array(CanonicalIdSchema).default([]),
  })
  .strict();

export const NodeEffectSchema = z
  .object({
    id: CanonicalIdSchema,
    workspace_id: CanonicalIdSchema,
    run_id: CanonicalIdSchema,
    node: z.string(),
    idempotency_key: z.string(),
    effect_type: z.string(),
    effect_ref: z.string(),
    content_hash: z.string().nullable().default(null),
    created_at: UtcTimestampSchema,
  })
  .strict();

export const ModelRequestSchema = z
  .object({
    id: CanonicalIdSchema,
    workspace_id: CanonicalIdSchema,
    run_id: CanonicalIdSchema.nullable().default(null),
    requested_by: z.string(),
    purpose: z.string(),
    model_binding: z.string().default("mock"),
    input_ref: z.string().nullable().default(null),
    idempotency_key: z.string(),
  })
  .strict();

export const ModelResponseSchema = z
  .object({
    id: CanonicalIdSchema,
    workspace_id: CanonicalIdSchema,
    request_id: CanonicalIdSchema,
    status: z.enum(["ok", "failed"]),
    output_ref: z.string().nullable().default(null),
    cost: CostSchema.default({
      tokens_in: 0,
      tokens_out: 0,
      usd: 0,
      provider: null,
      model: null,
    }),
    error: z.string().nullable().default(null),
  })
  .strict();

export const OrgChangeProposalSchema = z
  .object({
    id: CanonicalIdSchema,
    workspace_id: CanonicalIdSchema,
    proposed_by: z.string(),
    change_type: z.enum([
      "role",
      "workflow",
      "policy",
      "capability",
      "memory",
      "org_graph",
      "other",
    ]),
    rationale: z.string(),
    patch_json: recordSchema.default({}),
    status: z.enum(["draft", "pending", "approved", "rejected", "applied"]).default("draft"),
    created_at: UtcTimestampSchema,
    resolved_at: UtcTimestampSchema.nullable().default(null),
  })
  .strict();

export const WorldModelSnapshotSchema = z
  .object({
    id: CanonicalIdSchema,
    workspace_id: CanonicalIdSchema,
    run_id: CanonicalIdSchema.nullable().default(null),
    active_goals: z.array(CanonicalIdSchema).default([]),
    active_work: z.array(CanonicalIdSchema).default([]),
    blockers: z.array(z.string()).default([]),
    pending_approvals: z.array(CanonicalIdSchema).default([]),
    capability_gaps: z.array(z.string()).default([]),
    recent_events: z.array(CanonicalIdSchema).default([]),
    latest_run_status: RunStatusSchema.nullable().default(null),
    source_workspace_seq: z.number().int().default(0),
    source_run_seq: z.number().int().nullable().default(null),
    generated_at: UtcTimestampSchema,
    cache_only: z.boolean().default(true),
  })
  .strict();

export const canonicalModelSchemas = {
  Workspace: WorkspaceSchema,
  Organization: OrganizationSchema,
  Role: RoleSchema,
  Agent: AgentSchema,
  Goal: GoalSchema,
  WorkItem: WorkItemSchema,
  Run: RunSchema,
  TaskEnvelope: TaskEnvelopeSchema,
  AgentOutcome: AgentOutcomeSchema,
  Capability: CapabilitySchema,
  CapabilityCall: CapabilityCallSchema,
  CapabilityResult: CapabilityResultSchema,
  MemoryEntry: MemoryEntrySchema,
  PromotionCandidate: PromotionCandidateSchema,
  Artifact: ArtifactSchema,
  Policy: PolicySchema,
  PolicyDecision: PolicyDecisionSchema,
  ApprovalRequest: ApprovalRequestSchema,
  Evaluation: EvaluationSchema,
  Event: EventSchema,
  Trace: TraceSchema,
  NodeEffect: NodeEffectSchema,
  ModelRequest: ModelRequestSchema,
  ModelResponse: ModelResponseSchema,
  OrgChangeProposal: OrgChangeProposalSchema,
  WorldModelSnapshot: WorldModelSnapshotSchema,
} as const;

export const schemaDefinitions = {
  ExternalSource: ExternalSourceSchema,
  MemoryScope: MemoryScopeSchema,
  Provenance: ProvenanceSchema,
  Cost: CostSchema,
  ArtifactRef: ArtifactRefSchema,
  ApprovalPayload: ApprovalPayloadSchema,
  EventPayload: EventPayloadSchema,
  ...canonicalModelSchemas,
} as const;

export type PolicyOutcome = z.infer<typeof PolicyOutcomeSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type CanonicalModelName = keyof typeof canonicalModelSchemas;
export type ExternalSource = z.infer<typeof ExternalSourceSchema>;
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type Cost = z.infer<typeof CostSchema>;
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
export type ApprovalPayload = z.infer<typeof ApprovalPayloadSchema>;
export type EventPayload = z.infer<typeof EventPayloadSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type Organization = z.infer<typeof OrganizationSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type Agent = z.infer<typeof AgentSchema>;
export type Goal = z.infer<typeof GoalSchema>;
export type WorkItem = z.infer<typeof WorkItemSchema>;
export type Run = z.infer<typeof RunSchema>;
export type TaskEnvelope = z.infer<typeof TaskEnvelopeSchema>;
export type AgentOutcome = z.infer<typeof AgentOutcomeSchema>;
export type Capability = z.infer<typeof CapabilitySchema>;
export type CapabilityCall = z.infer<typeof CapabilityCallSchema>;
export type CapabilityResult = z.infer<typeof CapabilityResultSchema>;
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;
export type PromotionCandidate = z.infer<typeof PromotionCandidateSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type Policy = z.infer<typeof PolicySchema>;
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
export type Evaluation = z.infer<typeof EvaluationSchema>;
export type Event = z.infer<typeof EventSchema>;
export type Trace = z.infer<typeof TraceSchema>;
export type NodeEffect = z.infer<typeof NodeEffectSchema>;
export type ModelRequest = z.infer<typeof ModelRequestSchema>;
export type ModelResponse = z.infer<typeof ModelResponseSchema>;
export type OrgChangeProposal = z.infer<typeof OrgChangeProposalSchema>;
export type WorldModelSnapshot = z.infer<typeof WorldModelSnapshotSchema>;
