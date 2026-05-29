import {
  type BoundedWorkEnvelope,
  BoundedWorkEnvelopeSchema,
  EventPayloadSchema,
  type ExternalActorRef,
  newId,
  utcNow,
  type WorkItem,
  WorkItemSchema,
} from "../contracts/index.js";
import type { Database } from "../persistence/database.js";
import {
  BoundedWorkEnvelopeStore,
  EventStore,
  WorkerIdentityStore,
  WorkItemStore,
} from "../persistence/index.js";

type CreateWorkInput = {
  id?: string | null;
  workspace_id: string;
  title: string;
  objective: string;
  owner: string;
  reviewer?: string | null;
  priority?: WorkItem["priority"];
  risk_level?: WorkItem["risk_level"];
  success_criteria?: string[];
  actor: string;
  idempotency_key?: string | null;
};

type AssignWorkInput = {
  work_item_id: string;
  owner: string;
  reviewer?: string | null;
  actor: string;
  idempotency_key?: string | null;
};

type SetWorkStatusInput = {
  work_item_id: string;
  status: Extract<WorkItem["status"], "in_progress" | "blocked" | "review" | "done" | "failed">;
  actor: string;
  reason?: string | null;
  idempotency_key?: string | null;
};

type CreateBoundedEnvelopeInput = {
  id?: string | null;
  workspace_id: string;
  work_item_id: string;
  run_id?: string | null;
  worker_id: string;
  issued_by: ExternalActorRef;
  objective?: string | null;
  context_refs?: string[];
  allowed_capabilities?: string[];
  approval_gates?: string[];
  input?: Record<string, unknown>;
  expires_at?: string | null;
  idempotency_key?: string | null;
};

function actorString(actor: ExternalActorRef): string {
  return `${actor.actor_type}:${actor.actor_id}`;
}

export class WorkService {
  private readonly workItems: WorkItemStore;
  private readonly workers: WorkerIdentityStore;
  private readonly boundedEnvelopes: BoundedWorkEnvelopeStore;
  private readonly events: EventStore;

  constructor(private readonly database: Database) {
    this.workItems = new WorkItemStore(database);
    this.workers = new WorkerIdentityStore(database);
    this.boundedEnvelopes = new BoundedWorkEnvelopeStore(database);
    this.events = new EventStore(database);
  }

  createWork(input: CreateWorkInput): WorkItem {
    const workItem = WorkItemSchema.parse({
      id: input.id ?? newId("work"),
      workspace_id: input.workspace_id,
      title: input.title,
      objective: input.objective,
      owner: input.owner,
      reviewer: input.reviewer ?? null,
      priority: input.priority ?? "medium",
      risk_level: input.risk_level ?? "low",
      success_criteria: input.success_criteria ?? [],
    });

    return this.database.transaction(() => {
      const saved = this.workItems.save(workItem);
      this.events.append({
        workspace_id: saved.workspace_id,
        kind: "work.created",
        actor: input.actor,
        payload: EventPayloadSchema.parse({
          data: { work_item: saved },
          refs: [saved.id],
        }),
        idempotency_key: input.idempotency_key ?? `work:${saved.id}:created`,
      });
      return saved;
    });
  }

  assignWork(input: AssignWorkInput): WorkItem {
    return this.database.transaction(() => {
      const current = this.requireWorkItem(input.work_item_id);
      const updated = this.workItems.update(
        WorkItemSchema.parse({
          ...current,
          owner: input.owner,
          reviewer: input.reviewer ?? current.reviewer,
          status: current.status === "queued" ? "in_progress" : current.status,
        }),
      );
      this.events.append({
        workspace_id: updated.workspace_id,
        kind: "work.assigned",
        actor: input.actor,
        payload: EventPayloadSchema.parse({
          data: {
            work_item_id: updated.id,
            owner: updated.owner,
            reviewer: updated.reviewer,
            status: updated.status,
          },
          refs: [updated.id],
        }),
        idempotency_key: input.idempotency_key ?? `work:${updated.id}:assigned:${updated.owner}`,
      });
      return updated;
    });
  }

  setStatus(input: SetWorkStatusInput): WorkItem {
    return this.database.transaction(() => {
      const updated = this.workItems.setStatus(input.work_item_id, input.status);
      this.events.append({
        workspace_id: updated.workspace_id,
        kind: `work.${input.status}`,
        actor: input.actor,
        payload: EventPayloadSchema.parse({
          data: {
            work_item_id: updated.id,
            status: updated.status,
            reason: input.reason ?? null,
          },
          refs: [updated.id],
        }),
        idempotency_key: input.idempotency_key ?? `work:${updated.id}:status:${updated.status}`,
      });
      return updated;
    });
  }

  createBoundedEnvelope(input: CreateBoundedEnvelopeInput): BoundedWorkEnvelope {
    return this.database.transaction(() => {
      const workItem = this.requireWorkItem(input.work_item_id);
      const worker = this.workers.get(input.worker_id);
      if (!worker || worker.workspace_id !== input.workspace_id) {
        throw new Error(`worker identity not found in workspace: ${input.worker_id}`);
      }
      if (workItem.workspace_id !== input.workspace_id) {
        throw new Error(`work item not found in workspace: ${input.work_item_id}`);
      }

      const envelope = BoundedWorkEnvelopeSchema.parse({
        id: input.id ?? newId("envelope"),
        workspace_id: input.workspace_id,
        work_item_id: workItem.id,
        run_id: input.run_id ?? null,
        worker_id: worker.id,
        issued_by: input.issued_by,
        objective: input.objective ?? workItem.objective,
        context_refs: input.context_refs ?? [],
        allowed_capabilities: input.allowed_capabilities ?? worker.allowed_capabilities,
        approval_gates: input.approval_gates ?? workItem.approval_gates,
        input: input.input ?? {},
        created_at: utcNow(),
        expires_at: input.expires_at ?? null,
      });
      const saved = this.boundedEnvelopes.save(envelope);
      this.events.append({
        workspace_id: saved.workspace_id,
        run_id: saved.run_id,
        kind: "work.envelope.created",
        actor: actorString(saved.issued_by),
        payload: EventPayloadSchema.parse({
          data: {
            envelope_id: saved.id,
            work_item_id: saved.work_item_id,
            worker_id: saved.worker_id,
            allowed_capabilities: saved.allowed_capabilities,
          },
          refs: [saved.id, saved.work_item_id, saved.worker_id],
        }),
        idempotency_key: input.idempotency_key ?? `work:${saved.work_item_id}:envelope:${saved.id}`,
      });
      return saved;
    });
  }

  private requireWorkItem(workItemId: string): WorkItem {
    const workItem = this.workItems.get(workItemId);
    if (!workItem) {
      throw new Error(`work item not found: ${workItemId}`);
    }
    return workItem;
  }
}
