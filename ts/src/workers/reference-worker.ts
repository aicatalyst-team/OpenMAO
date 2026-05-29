import type { Database } from "../persistence/index.js";
import { OpenMaoLocalClient } from "../sdk/index.js";
import { SpineService, WORKSPACE_ID } from "../spine/index.js";
import { WorldModelService } from "../world/index.js";

export const REFERENCE_WORKER_ID = "worker_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const REFERENCE_WORK_ID = "work_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const REFERENCE_ENVELOPE_ID = "envelope_cccccccccccccccccccccccccccccccc";
export const REFERENCE_OUTCOME_ID = "outcome_dddddddddddddddddddddddddddddddd";
export const REFERENCE_INGESTION_ID = "ingest_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

export type ReferenceWorkerDemoResult = {
  workspace_id: string;
  worker_id: string;
  work_item_id: string;
  envelope_id: string;
  outcome_id: string;
  ingestion_id: string;
  work_status: string;
  world_model_id: string;
};

export function runReferenceWorkerDemo(database: Database): ReferenceWorkerDemoResult {
  new SpineService(database).initDemoWorkspace();
  const client = new OpenMaoLocalClient(database, {
    workspace_id: WORKSPACE_ID,
    actor: "reference_worker_demo",
  });

  const worker = client.registerWorker({
    id: REFERENCE_WORKER_ID,
    name: "Reference External Worker",
    runtime: "openmao.reference-worker",
    version: "0.1.0",
    allowed_capabilities: ["mock.research_lookup"],
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
      risk_level: "medium",
      success_criteria: [
        "bounded envelope issued",
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
  const envelope =
    client.envelopes(assigned.id).find((item) => item.id === REFERENCE_ENVELOPE_ID) ??
    client.issueEnvelope({
      id: REFERENCE_ENVELOPE_ID,
      work_item_id: assigned.id,
      worker_id: worker.id,
      allowed_capabilities: ["mock.research_lookup"],
      input: { topic: "external worker governance" },
      idempotency_key: "reference-worker:envelope:created",
    });
  const outcome =
    client.outcomes(assigned.id).find((item) => item.id === REFERENCE_OUTCOME_ID) ??
    client.submitOutcome({
      id: REFERENCE_OUTCOME_ID,
      envelope_id: envelope.id,
      worker_id: worker.id,
      status: "completed",
      summary: "Reference worker completed the bounded task and returned an inspectable outcome.",
      output: {
        finding: "External workers execute; OpenMAO owns the organizational record.",
      },
      idempotency_key: "reference-worker:outcome:submitted",
    });
  const ingestion =
    client.ingestionRecords().find((item) => item.id === REFERENCE_INGESTION_ID) ??
    client.recordIngestion({
      id: REFERENCE_INGESTION_ID,
      kind: "trace",
      source: { provider: "openmao", external_id: "reference-worker", external_url: null },
      actor: { actor_type: "worker", actor_id: worker.id, display_name: worker.name },
      target_work_item_id: assigned.id,
      payload: { node: "reference_worker.completed", outcome_id: outcome.id },
      idempotency_key: "reference-worker:trace:completed",
    });
  const reviewed =
    assigned.status === "done"
      ? assigned
      : client.reviewWork({
          work_item_id: assigned.id,
          decision: "accepted",
          notes: "Reference worker demo completed.",
          idempotency_key: "reference-worker:work:reviewed",
        });
  const world = new WorldModelService(database).rebuild(WORKSPACE_ID);

  return {
    workspace_id: WORKSPACE_ID,
    worker_id: worker.id,
    work_item_id: reviewed.id,
    envelope_id: envelope.id,
    outcome_id: outcome.id,
    ingestion_id: ingestion.id,
    work_status: reviewed.status,
    world_model_id: world.id,
  };
}
