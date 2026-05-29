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
  WorkerIdentityStore,
  WorkerOutcomeStore,
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

describe("v1 work service", () => {
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
      work_item_id: work.id,
      decision: "accepted",
      actor: "reviewer:human",
      notes: "Accepted for v1 substrate test.",
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
    expect(new BoundedWorkEnvelopeStore(database).listForWorkItem(work.id)).toEqual([envelope]);
    expect(new WorkerOutcomeStore(database).listForWorkItem(work.id)).toEqual([outcome]);
    expect(events.map((event) => event.kind)).toEqual([
      "work.created",
      "work.assigned",
      "work.envelope.created",
      "work.outcome_submitted",
      "work.reviewed",
    ]);
    expect(events.every((event) => event.idempotency_key)).toBe(true);
  });
});
