import type { CapabilityInvocation } from "../capabilities/index.js";
import {
  CapabilityCallSchema,
  CapabilitySchema,
  EventPayloadSchema,
  RunSchema,
  TaskEnvelopeSchema,
  utcNow,
} from "../contracts/index.js";
import { ApprovalService } from "../governance/index.js";
import { type Database, EventStore, RunStore, TaskEnvelopeStore } from "../persistence/index.js";
import { createLocalCapabilityRegistry } from "../runtime/capabilities.js";
import { OpenMaoLocalClient } from "../sdk/index.js";
import { SpineService, WORKSPACE_ID } from "../spine/index.js";
import { WorldModelService } from "../world/index.js";

export const REFERENCE_WORKER_ID = "worker_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const REFERENCE_WORK_ID = "work_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const REFERENCE_RUN_ID = "run_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const REFERENCE_TASK_ID = "task_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const REFERENCE_ENVELOPE_ID = "envelope_cccccccccccccccccccccccccccccccc";
export const REFERENCE_OUTCOME_ID = "outcome_dddddddddddddddddddddddddddddddd";
export const REFERENCE_INGESTION_ID = "ingest_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
export const REFERENCE_CAPABILITY_CALL_ID = "capcall_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const REFERENCE_CAPABILITY_APPROVAL_ID = "approval_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const REFERENCE_CAPABILITY_NAME = "mock.side_effect.record";
export const REFERENCE_CREDENTIAL_HANDLE = "cred_mock_side_effect";

export type ReferenceWorkerDemoResult = {
  workspace_id: string;
  run_id: string;
  status: string;
  worker_id: string;
  work_item_id: string;
  envelope_id: string;
  capability_call_id: string;
  capability_approval_id: string | null;
  capability_result_id: string | null;
  outcome_id: string | null;
  ingestion_id: string | null;
  work_status: string;
  world_model_id: string;
};

type ReferenceWorkerContext = {
  client: OpenMaoLocalClient;
  worker_id: string;
  worker_name: string;
  work_item_id: string;
  work_status: string;
  envelope_id: string;
  registry: ReturnType<typeof createLocalCapabilityRegistry>;
};

export function runReferenceWorkerDemo(database: Database): ReferenceWorkerDemoResult {
  const context = prepareReferenceWorkerDemo(database);
  const invocation = invokeReferenceCapability(context);
  if (invocation.result?.status === "ok") {
    return finalizeReferenceWorkerDemo(database, context, invocation);
  }
  return referenceResult(database, context, invocation);
}

export function approveReferenceWorkerDemo(database: Database): ReferenceWorkerDemoResult {
  const started = runReferenceWorkerDemo(database);
  if (started.capability_result_id) {
    return started;
  }

  const approvalId = started.capability_approval_id ?? REFERENCE_CAPABILITY_APPROVAL_ID;
  new ApprovalService(database).approve(approvalId, {
    workspace_id: WORKSPACE_ID,
    actor: "reference_worker_demo",
  });
  const context = prepareReferenceWorkerDemo(database);
  const invocation = context.registry.resumeApprovedCall(approvalId, {
    workspace_id: WORKSPACE_ID,
  });
  if (invocation.result?.status !== "ok") {
    return referenceResult(database, context, invocation);
  }
  return finalizeReferenceWorkerDemo(database, context, invocation);
}

function prepareReferenceWorkerDemo(database: Database): ReferenceWorkerContext {
  new SpineService(database).initDemoWorkspace();
  const client = new OpenMaoLocalClient(database, {
    workspace_id: WORKSPACE_ID,
    actor: "reference_worker_demo",
  });
  const registry = createLocalCapabilityRegistry(database);

  registry.register(
    CapabilitySchema.parse({
      name: REFERENCE_CAPABILITY_NAME,
      workspace_id: WORKSPACE_ID,
      description: "Record a deterministic side effect through an OpenMAO-managed provider.",
      tool_name: "mock.side_effect",
      canonical_input_schema: {
        type: "object",
        required: ["message"],
        properties: { message: { type: "string" } },
      },
      canonical_output_schema: {
        type: "object",
        required: ["provider", "effect", "handle"],
        properties: {
          provider: { type: "string" },
          effect: { type: "string" },
          handle: { type: "string" },
        },
      },
      providers: ["mock.side_effect"],
      side_effecting: true,
      credential_handle_required: true,
      default_permission: "approval_required",
    }),
  );

  const worker = client.registerWorker({
    id: REFERENCE_WORKER_ID,
    name: "Reference External Worker",
    runtime: "openmao.reference-worker",
    version: "0.1.0",
    allowed_capabilities: [REFERENCE_CAPABILITY_NAME],
    idempotency_key: "reference-worker:registered",
  });
  const work =
    client.workItems().find((item) => item.id === REFERENCE_WORK_ID) ??
    client.createWork({
      id: REFERENCE_WORK_ID,
      title: "Prepare governed external-worker update",
      objective: "Show that an external worker can execute bounded work under OpenMAO authority.",
      owner: "reference_worker_demo",
      reviewer: "human",
      risk_level: "high",
      success_criteria: [
        "bounded envelope issued",
        "side-effecting capability paused for approval",
        "approved provider execution recorded exactly once",
        "worker outcome submitted",
        "ingestion visible in world model",
      ],
      idempotency_key: "reference-worker:work:created",
    });
  const assigned =
    work.owner === worker.id && work.reviewer === "human"
      ? work
      : client.assignWork({
          work_item_id: work.id,
          owner: worker.id,
          reviewer: "human",
          idempotency_key: "reference-worker:work:assigned",
        });
  const run = ensureReferenceRun(database);
  ensureReferenceTask(database, {
    run_id: run.id,
    work_item_id: assigned.id,
    worker_id: worker.id,
  });
  const envelope =
    client.envelopes(assigned.id).find((item) => item.id === REFERENCE_ENVELOPE_ID) ??
    client.issueEnvelope({
      id: REFERENCE_ENVELOPE_ID,
      work_item_id: assigned.id,
      run_id: run.id,
      worker_id: worker.id,
      allowed_capabilities: [REFERENCE_CAPABILITY_NAME],
      approval_gates: [REFERENCE_CAPABILITY_APPROVAL_ID],
      input: { topic: "external worker governance" },
      idempotency_key: "reference-worker:envelope:created",
    });

  return {
    client,
    worker_id: worker.id,
    worker_name: worker.name,
    work_item_id: assigned.id,
    work_status: assigned.status,
    envelope_id: envelope.id,
    registry,
  };
}

function ensureReferenceRun(database: Database) {
  const runs = new RunStore(database);
  const events = new EventStore(database);
  let run = runs.get(REFERENCE_RUN_ID);
  if (!run) {
    const createdAt = utcNow();
    runs.create(
      RunSchema.parse({
        id: REFERENCE_RUN_ID,
        workspace_id: WORKSPACE_ID,
        status: "queued",
        active_node: null,
        suspended_approval_id: null,
        created_at: createdAt,
        updated_at: createdAt,
      }),
    );
    run = runs.setStatus(REFERENCE_RUN_ID, "running", {
      active_node: "reference_worker_started",
      updated_at: createdAt,
    });
    events.append({
      workspace_id: run.workspace_id,
      run_id: run.id,
      kind: "run.started",
      actor: "reference_worker_demo",
      payload: EventPayloadSchema.parse({ data: { run }, refs: [run.id] }),
      idempotency_key: `${run.id}:started`,
    });
  } else if (run.status === "queued") {
    run = runs.setStatus(run.id, "running", {
      active_node: "reference_worker_started",
    });
  }
  return run;
}

function ensureReferenceTask(
  database: Database,
  input: { run_id: string; work_item_id: string; worker_id: string },
) {
  const task = new TaskEnvelopeStore(database).save(
    TaskEnvelopeSchema.parse({
      id: REFERENCE_TASK_ID,
      workspace_id: WORKSPACE_ID,
      run_id: input.run_id,
      work_item_id: input.work_item_id,
      from_agent: null,
      to_agent: input.worker_id,
      objective: "Execute the bounded reference-worker task.",
      allowed_capabilities: [REFERENCE_CAPABILITY_NAME],
      approval_gates: [REFERENCE_CAPABILITY_APPROVAL_ID],
    }),
  );
  new EventStore(database).append({
    workspace_id: task.workspace_id,
    run_id: task.run_id,
    kind: "task.envelope.created",
    actor: "reference_worker_demo",
    payload: EventPayloadSchema.parse({ data: { task_envelope: task }, refs: [task.id] }),
    idempotency_key: `${task.id}:created`,
  });
  return task;
}

function invokeReferenceCapability(context: ReferenceWorkerContext): CapabilityInvocation {
  return context.registry.invoke(
    CapabilityCallSchema.parse({
      id: REFERENCE_CAPABILITY_CALL_ID,
      workspace_id: WORKSPACE_ID,
      run_id: REFERENCE_RUN_ID,
      capability_name: REFERENCE_CAPABILITY_NAME,
      provider: "mock.side_effect",
      input: { message: "record governed reference-worker side effect" },
      requested_by: context.worker_id,
      external_actor: {
        actor_type: "worker",
        actor_id: context.worker_id,
        display_name: context.worker_name,
      },
      task_id: REFERENCE_TASK_ID,
      credential_handle: REFERENCE_CREDENTIAL_HANDLE,
      side_effecting: true,
      audit_payload: { intent: "prove OpenMAO-gated external worker side effect" },
      risk_level: "high",
      idempotency_key: "reference-worker:capability:side-effect",
    }),
  );
}

function finalizeReferenceWorkerDemo(
  database: Database,
  context: ReferenceWorkerContext,
  invocation: CapabilityInvocation,
): ReferenceWorkerDemoResult {
  const outcome =
    context.client
      .outcomes(context.work_item_id)
      .find((item) => item.id === REFERENCE_OUTCOME_ID) ??
    context.client.submitOutcome({
      id: REFERENCE_OUTCOME_ID,
      envelope_id: context.envelope_id,
      worker_id: context.worker_id,
      status: "completed",
      summary: "Reference worker completed the bounded task and returned an inspectable outcome.",
      output: {
        finding: "External workers execute; OpenMAO owns the organizational record.",
        capability_result_id: invocation.result?.id,
      },
      idempotency_key: "reference-worker:outcome:submitted",
    });
  const ingestion =
    context.client.ingestionRecords().find((item) => item.id === REFERENCE_INGESTION_ID) ??
    context.client.recordIngestion({
      id: REFERENCE_INGESTION_ID,
      kind: "trace",
      source: { provider: "openmao", external_id: "reference-worker", external_url: null },
      actor: {
        actor_type: "worker",
        actor_id: context.worker_id,
        display_name: context.worker_name,
      },
      target_run_id: REFERENCE_RUN_ID,
      target_work_item_id: context.work_item_id,
      payload: {
        node: "reference_worker.completed",
        outcome_id: outcome.id,
        capability_result_id: invocation.result?.id,
      },
      idempotency_key: "reference-worker:trace:completed",
    });
  const currentWork = context.client.workItems().find((item) => item.id === context.work_item_id);
  const reviewed =
    currentWork?.status === "done"
      ? currentWork
      : context.client.reviewWork({
          work_item_id: context.work_item_id,
          decision: "accepted",
          notes: "Reference worker demo completed.",
          idempotency_key: "reference-worker:work:reviewed",
        });

  const run = completeReferenceRun(database, invocation);
  const world = new WorldModelService(database).rebuild(WORKSPACE_ID, REFERENCE_RUN_ID);

  return {
    workspace_id: WORKSPACE_ID,
    run_id: REFERENCE_RUN_ID,
    status: run.status,
    worker_id: context.worker_id,
    work_item_id: reviewed.id,
    envelope_id: context.envelope_id,
    capability_call_id: invocation.call.id,
    capability_approval_id: invocation.approval_id ?? invocation.decision.approval_id,
    capability_result_id: invocation.result?.id ?? null,
    outcome_id: outcome.id,
    ingestion_id: ingestion.id,
    work_status: reviewed.status,
    world_model_id: world.id,
  };
}

function completeReferenceRun(database: Database, invocation: CapabilityInvocation) {
  const runs = new RunStore(database);
  const events = new EventStore(database);
  let run = runs.get(REFERENCE_RUN_ID);
  if (!run) {
    throw new Error(`reference worker run not found: ${REFERENCE_RUN_ID}`);
  }
  if (run.status !== "completed" && run.status !== "failed") {
    run = runs.setStatus(run.id, "completed", {
      active_node: "reference_worker_completed",
    });
    events.append({
      workspace_id: run.workspace_id,
      run_id: run.id,
      kind: "run.completed",
      actor: "reference_worker_demo",
      payload: EventPayloadSchema.parse({
        data: {
          run,
          capability_call_id: invocation.call.id,
          capability_result_id: invocation.result?.id ?? null,
        },
        refs: [run.id, invocation.call.id, invocation.result?.id].filter((ref): ref is string =>
          Boolean(ref),
        ),
      }),
      idempotency_key: `${run.id}:completed`,
    });
  }
  return run;
}

function referenceResult(
  database: Database,
  context: ReferenceWorkerContext,
  invocation: CapabilityInvocation,
): ReferenceWorkerDemoResult {
  const run = new RunStore(database).get(REFERENCE_RUN_ID);
  const world = new WorldModelService(database).rebuild(WORKSPACE_ID, REFERENCE_RUN_ID);

  return {
    workspace_id: WORKSPACE_ID,
    run_id: REFERENCE_RUN_ID,
    status: run?.status ?? "running",
    worker_id: context.worker_id,
    work_item_id: context.work_item_id,
    envelope_id: context.envelope_id,
    capability_call_id: invocation.call.id,
    capability_approval_id:
      run?.suspended_approval_id ?? invocation.approval_id ?? invocation.decision.approval_id,
    capability_result_id: invocation.result?.id ?? null,
    outcome_id: null,
    ingestion_id: null,
    work_status: context.work_status,
    world_model_id: world.id,
  };
}
