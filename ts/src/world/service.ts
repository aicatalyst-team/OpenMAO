import { createHash } from "node:crypto";

import {
  type Event,
  type Run,
  type WorkItem,
  type WorldModelSnapshot,
  WorldModelSnapshotSchema,
} from "../contracts/index.js";
import {
  ApprovalStore,
  CapabilityStore,
  type Database,
  EventStore,
  GoalStore,
  RunStore,
  TaskEnvelopeStore,
  WorkItemStore,
  WorkspaceStore,
  WorldModelSnapshotStore,
} from "../persistence/index.js";

const RECENT_EVENT_LIMIT = 20;
const WORLD_MODEL_EVENT_KINDS = new Set(["world_model.updated"]);

export class WorldModelServiceError extends Error {}

export class WorldModelService {
  private readonly approvals: ApprovalStore;
  private readonly capabilities: CapabilityStore;
  private readonly events: EventStore;
  private readonly goals: GoalStore;
  private readonly runs: RunStore;
  private readonly snapshots: WorldModelSnapshotStore;
  private readonly tasks: TaskEnvelopeStore;
  private readonly workItems: WorkItemStore;
  private readonly workspaces: WorkspaceStore;

  constructor(private readonly database: Database) {
    this.approvals = new ApprovalStore(database);
    this.capabilities = new CapabilityStore(database);
    this.events = new EventStore(database);
    this.goals = new GoalStore(database);
    this.runs = new RunStore(database);
    this.snapshots = new WorldModelSnapshotStore(database);
    this.tasks = new TaskEnvelopeStore(database);
    this.workItems = new WorkItemStore(database);
    this.workspaces = new WorkspaceStore(database);
  }

  rebuild(workspaceId: string, runId: string | null = null): WorldModelSnapshot {
    return this.database.transaction(() => {
      const workspace = this.workspaces.get(workspaceId);
      if (!workspace) {
        throw new Error(`workspace not found: ${workspaceId}`);
      }

      const run = this.runForScope(workspaceId, runId);
      const workspaceEvents = this.sourceEvents(this.events.listForWorkspace(workspaceId));
      const runEvents = runId ? this.sourceEvents(this.events.listForRun(workspaceId, runId)) : [];
      const goals = this.goals.listForWorkspace(workspaceId);
      const workItems = this.workForScope(workspaceId, runId);
      const pendingApprovals = this.approvals
        .listPending(workspaceId)
        .filter((approval) => !runId || approval.run_id === runId);
      const activeGoals = goals
        .filter((goal) => goal.status === "active")
        .map((goal) => goal.id)
        .sort();
      const activeWork = workItems
        .filter((workItem) => !["done", "failed"].includes(workItem.status))
        .map((workItem) => workItem.id)
        .sort();
      const blockers = [
        ...goals.filter((goal) => goal.status === "blocked").map((goal) => goal.id),
        ...workItems
          .filter((workItem) => workItem.status === "blocked")
          .map((workItem) => workItem.id),
      ].sort();
      const pendingApprovalIds = pendingApprovals.map((approval) => approval.id).sort();
      const capabilityGaps = this.capabilityGaps(workspaceId);
      const recentEvents = workspaceEvents.slice(-RECENT_EVENT_LIMIT).map((event) => event.id);
      const sourceWorkspaceSeq = Math.max(0, ...workspaceEvents.map((event) => event.seq));
      const runSeqs = runEvents
        .map((event) => event.run_seq)
        .filter((seq): seq is number => seq !== null);
      const sourceRunSeq = runId ? Math.max(0, ...runSeqs) : null;
      const generatedAt = workspaceEvents.at(-1)?.timestamp ?? workspace.created_at;
      const payload = {
        workspace_id: workspaceId,
        run_id: runId,
        active_goals: activeGoals,
        active_work: activeWork,
        blockers,
        pending_approvals: pendingApprovalIds,
        capability_gaps: capabilityGaps,
        recent_events: recentEvents,
        latest_run_status: run?.status ?? null,
        source_workspace_seq: sourceWorkspaceSeq,
        source_run_seq: sourceRunSeq,
        generated_at: generatedAt,
        cache_only: true,
      };

      const snapshot = WorldModelSnapshotSchema.parse({
        id: this.snapshotId(payload),
        ...payload,
      });
      return this.snapshots.save(snapshot);
    });
  }

  private runForScope(workspaceId: string, runId: string | null): Run | null {
    if (runId) {
      const run = this.runs.get(runId);
      if (!run) {
        throw new Error(`run not found: ${runId}`);
      }
      if (run.workspace_id !== workspaceId) {
        throw new WorldModelServiceError("run does not belong to workspace");
      }
      return run;
    }

    const activeRunId = this.runs.activeRunId(workspaceId);
    if (activeRunId) {
      return this.runs.get(activeRunId);
    }
    return (
      this.runs
        .listForWorkspace(workspaceId)
        .sort((left, right) =>
          `${right.updated_at}:${right.id}`.localeCompare(`${left.updated_at}:${left.id}`),
        )[0] ?? null
    );
  }

  private workForScope(workspaceId: string, runId: string | null): WorkItem[] {
    const workspaceWork = this.workItems.listForWorkspace(workspaceId);
    if (!runId) {
      return workspaceWork;
    }
    const workIds = new Set(
      this.tasks
        .listForRun(runId)
        .filter((task) => task.workspace_id === workspaceId)
        .map((task) => task.work_item_id),
    );
    return workspaceWork.filter((workItem) => workIds.has(workItem.id));
  }

  private capabilityGaps(workspaceId: string): string[] {
    return this.capabilities
      .listForWorkspace(workspaceId)
      .flatMap((capability) => [
        ...(capability.providers.length === 0 ? [`missing_provider:${capability.name}`] : []),
        ...(capability.default_permission === "disabled" ? [`disabled:${capability.name}`] : []),
      ])
      .sort();
  }

  private sourceEvents(events: Event[]): Event[] {
    return events.filter((event) => !WORLD_MODEL_EVENT_KINDS.has(event.kind));
  }

  private snapshotId(payload: Record<string, unknown>): string {
    const encoded = JSON.stringify(payload, Object.keys(payload).sort());
    return `world_${createHash("sha256").update(encoded).digest("hex").slice(0, 32)}`;
  }
}
