import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WorkerIdentitySchema, type Workspace, WorkspaceSchema } from "../src/contracts/index.js";
import {
  BoundedWorkEnvelopeStore,
  Database,
  EventStore,
  TaskEnvelopeStore,
  WorkerIdentityStore,
  WorkerOutcomeStore,
  WorkItemStore,
  WorkspaceStore,
} from "../src/persistence/index.js";
import { WorkService } from "../src/work/index.js";

const fixturePath = new URL("../../tests/fixtures/canonical_v0.json", import.meta.url);

let tmpRoot: string;
let database: Database;

async function loadFixture(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, unknown>;
}

async function seedWorkspace(): Promise<Workspace> {
  const fixture = await loadFixture();
  const workspace = WorkspaceSchema.parse(fixture.workspace);
  return new WorkspaceStore(database).save(workspace);
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "openmao-ts-work-"));
  database = new Database(join(tmpRoot, "openmao.sqlite3"));
  database.initialize();
});

afterEach(() => {
  database.close();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("work service", () => {
  it("creates accountable work, assignment events, and bounded external-worker envelopes", async () => {
    const workspace = await seedWorkspace();
    const fixture = await loadFixture();
    const worker = new WorkerIdentityStore(database).save(
      WorkerIdentitySchema.parse(fixture.worker_identity),
    );
    const service = new WorkService(database);

    const work = service.createWork({
      id: "work_12121212121212121212121212121212",
      workspace_id: workspace.id,
      title: "Draft governed update",
      objective: "Prepare an update that may need a governed repository comment.",
      owner: "role_33333333333333333333333333333333",
      reviewer: "human",
      risk_level: "medium",
      success_criteria: ["bounded envelope exists", "events are inspectable"],
      actor: "operator:local",
      idempotency_key: "work:governed-update:create",
    });
    const replayed = service.createWork({
      id: work.id,
      workspace_id: workspace.id,
      title: work.title,
      objective: work.objective,
      owner: work.owner,
      reviewer: work.reviewer,
      risk_level: work.risk_level,
      success_criteria: work.success_criteria,
      actor: "operator:local",
      idempotency_key: "work:governed-update:create",
    });
    const assigned = service.assignWork({
      workspace_id: workspace.id,
      work_item_id: work.id,
      owner: worker.id,
      reviewer: "human",
      actor: "operator:local",
      idempotency_key: "work:governed-update:assign",
    });
    const envelope = service.createBoundedEnvelope({
      id: "envelope_34343434343434343434343434343434",
      workspace_id: workspace.id,
      work_item_id: work.id,
      worker_id: worker.id,
      issued_by: {
        actor_type: "operator",
        actor_id: "operator:local",
        display_name: "Local operator",
      },
      allowed_capabilities: ["mock.research_lookup"],
      input: { topic: "governed update" },
      idempotency_key: "work:governed-update:envelope",
    });
    const outcome = service.submitWorkerOutcome({
      id: "outcome_56565656565656565656565656565656",
      workspace_id: workspace.id,
      envelope_id: envelope.id,
      worker_id: worker.id,
      status: "completed",
      summary: "Prepared the governed update for review.",
      output: { ready_for_review: true },
      idempotency_key: "work:governed-update:outcome",
    });
    const replayedOutcome = service.submitWorkerOutcome({
      id: outcome.id,
      workspace_id: workspace.id,
      envelope_id: envelope.id,
      worker_id: worker.id,
      status: "completed",
      summary: outcome.summary,
      output: outcome.output,
      idempotency_key: "work:governed-update:outcome",
    });
    const reviewed = service.reviewWork({
      workspace_id: workspace.id,
      work_item_id: work.id,
      decision: "accepted",
      actor: "reviewer:human",
      notes: "Accepted for external-worker substrate test.",
      idempotency_key: "work:governed-update:review",
    });
    const events = new EventStore(database).listForWorkspace(workspace.id);

    expect(replayed).toEqual(work);
    expect(assigned.status).toBe("in_progress");
    expect(assigned.owner).toBe(worker.id);
    expect(envelope.work_item_id).toBe(work.id);
    expect(envelope.worker_id).toBe(worker.id);
    expect(envelope.objective).toBe(work.objective);
    expect(outcome.status).toBe("completed");
    expect(replayedOutcome).toEqual(outcome);
    expect(reviewed.status).toBe("done");
    expect(new BoundedWorkEnvelopeStore(database).listForWorkItem(workspace.id, work.id)).toEqual([
      envelope,
    ]);
    expect(new WorkerOutcomeStore(database).listForWorkItem(workspace.id, work.id)).toEqual([
      outcome,
    ]);
    expect(events.map((event) => event.kind)).toEqual([
      "work.created",
      "work.assigned",
      "work.envelope.created",
      "work.outcome_submitted",
      "work.reviewed",
    ]);
    expect(events.every((event) => event.idempotency_key)).toBe(true);
  });

  it("creates run-bound bounded envelopes with gateway task context", async () => {
    const workspace = await seedWorkspace();
    const fixture = await loadFixture();
    const worker = new WorkerIdentityStore(database).save(
      WorkerIdentitySchema.parse(fixture.worker_identity),
    );
    const service = new WorkService(database);
    const work = service.createWork({
      id: "work_23232323232323232323232323232323",
      workspace_id: workspace.id,
      title: "Run-bound governed update",
      objective: "Expose public task context for a governed worker capability call.",
      owner: "operator:local",
      actor: "operator:local",
      idempotency_key: "work:run-bound:create",
    });
    const run = service.ensureExternalRun({
      id: "run_24242424242424242424242424242424",
      workspace_id: workspace.id,
      active_node: "external_worker_started",
      actor: "operator:local",
      idempotency_key: "work:run-bound:run",
    });

    const envelope = service.createBoundedEnvelope({
      id: "envelope_25252525252525252525252525252525",
      workspace_id: workspace.id,
      work_item_id: work.id,
      run_id: run.id,
      worker_id: worker.id,
      issued_by: {
        actor_type: "operator",
        actor_id: "operator:local",
        display_name: null,
      },
      allowed_capabilities: ["mock.research_lookup"],
      idempotency_key: "work:run-bound:envelope",
    });
    const task = new TaskEnvelopeStore(database).get(envelope.task_envelope_id ?? "");

    expect(envelope.run_id).toBe(run.id);
    expect(envelope.task_envelope_id).toBe("task_25252525252525252525252525252525");
    expect(task?.run_id).toBe(run.id);
    expect(task?.to_agent).toBe(worker.id);
    expect(task?.allowed_capabilities).toEqual(["mock.research_lookup"]);
  });

  it("rejects bounded envelopes that exceed worker capability grants", async () => {
    const workspace = await seedWorkspace();
    const fixture = await loadFixture();
    const worker = new WorkerIdentityStore(database).save(
      WorkerIdentitySchema.parse(fixture.worker_identity),
    );
    const service = new WorkService(database);
    const work = service.createWork({
      id: "work_26262626262626262626262626262626",
      workspace_id: workspace.id,
      title: "Over-granted bounded work",
      objective: "Prove the envelope does not advertise ungranted authority.",
      owner: "operator:local",
      actor: "operator:local",
      idempotency_key: "work:over-granted:create",
    });

    expect(() =>
      service.createBoundedEnvelope({
        id: "envelope_27272727272727272727272727272727",
        workspace_id: workspace.id,
        work_item_id: work.id,
        worker_id: worker.id,
        issued_by: {
          actor_type: "operator",
          actor_id: "operator:local",
          display_name: null,
        },
        allowed_capabilities: ["mock.side_effect.record"],
        idempotency_key: "work:over-granted:envelope",
      }),
    ).toThrow("exceed worker grants");
  });

  it("rejects secret-shaped external worker envelope and outcome material", async () => {
    const workspace = await seedWorkspace();
    const fixture = await loadFixture();
    const worker = new WorkerIdentityStore(database).save(
      WorkerIdentitySchema.parse(fixture.worker_identity),
    );
    const service = new WorkService(database);
    const work = service.createWork({
      id: "work_29292929292929292929292929292929",
      workspace_id: workspace.id,
      title: "Secret hygiene work",
      objective: "Prove external worker material is rejected before persistence.",
      owner: "operator:local",
      actor: "operator:local",
      idempotency_key: "work:secret-hygiene:create",
    });

    expect(() =>
      service.createBoundedEnvelope({
        id: "envelope_30303030303030303030303030303030",
        workspace_id: workspace.id,
        work_item_id: work.id,
        worker_id: worker.id,
        issued_by: {
          actor_type: "operator",
          actor_id: "operator:local",
          display_name: null,
        },
        allowed_capabilities: ["mock.research_lookup"],
        input: { api_key: "sk-testsecret123456" },
        idempotency_key: "work:secret-hygiene:bad-envelope",
      }),
    ).toThrow("sensitive key");

    const envelope = service.createBoundedEnvelope({
      id: "envelope_31313131313131313131313131313131",
      workspace_id: workspace.id,
      work_item_id: work.id,
      worker_id: worker.id,
      issued_by: {
        actor_type: "operator",
        actor_id: "operator:local",
        display_name: null,
      },
      allowed_capabilities: ["mock.research_lookup"],
      idempotency_key: "work:secret-hygiene:good-envelope",
    });

    expect(() =>
      service.submitWorkerOutcome({
        id: "outcome_32323232323232323232323232323232",
        workspace_id: workspace.id,
        envelope_id: envelope.id,
        worker_id: worker.id,
        status: "completed",
        summary: "Prepared the governed update.",
        output: { api_key: "sk-testsecret123456" },
        idempotency_key: "work:secret-hygiene:bad-outcome",
      }),
    ).toThrow("sensitive key");
    expect(new BoundedWorkEnvelopeStore(database).listForWorkItem(workspace.id, work.id)).toEqual([
      envelope,
    ]);
    expect(new WorkerOutcomeStore(database).listForWorkItem(workspace.id, work.id)).toEqual([]);
  });

  it("rejects cross-workspace work lifecycle writes at the service boundary", async () => {
    const workspace = await seedWorkspace();
    const otherWorkspace = new WorkspaceStore(database).save(
      WorkspaceSchema.parse({
        id: "ws_22222222222222222222222222222222",
        name: "Second Workspace",
        created_at: "2026-05-27T15:20:00Z",
        default_org_id: null,
      }),
    );
    const service = new WorkService(database);
    const work = service.createWork({
      id: "work_28282828282828282828282828282828",
      workspace_id: workspace.id,
      title: "Workspace-owned work",
      objective: "Prove lifecycle writes cannot cross workspace boundaries.",
      owner: "operator:local",
      actor: "operator:local",
      idempotency_key: "work:workspace-owned:create",
    });

    expect(() =>
      service.assignWork({
        workspace_id: otherWorkspace.id,
        work_item_id: work.id,
        owner: "operator:other",
        actor: "operator:other",
      }),
    ).toThrow("not found in workspace");
    expect(() =>
      service.setStatus({
        workspace_id: otherWorkspace.id,
        work_item_id: work.id,
        status: "done",
        actor: "operator:other",
      }),
    ).toThrow("not found in workspace");
    expect(() =>
      service.reviewWork({
        workspace_id: otherWorkspace.id,
        work_item_id: work.id,
        decision: "accepted",
        actor: "operator:other",
      }),
    ).toThrow("not found in workspace");
    expect(new WorkItemStore(database).get(work.id)?.status).toBe("queued");
  });
});
