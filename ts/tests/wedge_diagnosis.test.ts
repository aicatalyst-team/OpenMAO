import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type Event, WorkerIdentitySchema, WorkspaceSchema } from "../src/contracts/index.js";
import { DiagnosisService } from "../src/diagnosis/index.js";
import {
  Database,
  EventStore,
  WorkerIdentityStore,
  WorkspaceStore,
} from "../src/persistence/index.js";
import { WorkService } from "../src/work/index.js";

const fixturePath = new URL("../../tests/fixtures/canonical_v0.json", import.meta.url);

let tmpRoot: string;
let database: Database;

async function loadFixture(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, unknown>;
}

async function seedWorkspace(): Promise<string> {
  const fixture = await loadFixture();
  return new WorkspaceStore(database).save(WorkspaceSchema.parse(fixture.workspace)).id;
}

function eventsFor(workspaceId: string): Event[] {
  return new EventStore(database).listForWorkspace(workspaceId);
}

function requireEvent(workspaceId: string, kind: string): Event {
  const event = eventsFor(workspaceId).find((candidate) => candidate.kind === kind);
  if (!event) {
    throw new Error(`expected a '${kind}' event to be recorded`);
  }
  return event;
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "openmao-ts-wedge-"));
  database = new Database(join(tmpRoot, "openmao.sqlite3"));
  database.initialize();
});

afterEach(() => {
  database.close();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("wedge: M3 diagnoses real work failures end to end", () => {
  it("traces a status failure back to the work item's creation", async () => {
    const workspaceId = await seedWorkspace();
    const work = new WorkService(database);

    // A real work lifecycle — no hand-crafted causal payloads. The emitters now carry M0 causal
    // fields: created PRODUCES the work item, the later steps CONSUME it.
    const item = work.createWork({
      workspace_id: workspaceId,
      title: "Ship the thing",
      objective: "Do the thing well",
      owner: "agent_worker",
      actor: "agent_planner",
    });
    work.assignWork({
      workspace_id: workspaceId,
      work_item_id: item.id,
      owner: "agent_worker",
      actor: "agent_planner",
    });
    work.setStatus({
      workspace_id: workspaceId,
      work_item_id: item.id,
      status: "failed",
      reason: "the worker could not complete it",
      actor: "agent_worker",
    });

    const created = requireEvent(workspaceId, "work.created");
    const failed = requireEvent(workspaceId, "work.failed");

    const diagnosis = new DiagnosisService(database).diagnose({
      workspace_id: workspaceId,
      failure_event_id: failed.id,
    });

    const candidateIds = diagnosis.candidates.map((candidate) => candidate.event_id);
    expect(candidateIds).toContain(created.id);
    const origin = diagnosis.candidates.find((candidate) => candidate.event_id === created.id);
    expect(origin?.is_root).toBe(true);
    expect(eventsFor(workspaceId).map((event) => event.kind)).toContain("diagnosis.suggested");
  });

  it("traces a failed worker outcome back through the bounded envelope to creation", async () => {
    const workspaceId = await seedWorkspace();
    const fixture = await loadFixture();
    const worker = new WorkerIdentityStore(database).save(
      WorkerIdentitySchema.parse(fixture.worker_identity),
    );
    const work = new WorkService(database);

    const item = work.createWork({
      workspace_id: workspaceId,
      title: "Research the topic",
      objective: "Produce a defensible answer",
      owner: worker.id,
      actor: "operator:local",
    });
    work.assignWork({
      workspace_id: workspaceId,
      work_item_id: item.id,
      owner: worker.id,
      actor: "operator:local",
    });
    const envelope = work.createBoundedEnvelope({
      workspace_id: workspaceId,
      work_item_id: item.id,
      worker_id: worker.id,
      issued_by: { actor_type: "operator", actor_id: "operator:local", display_name: null },
      allowed_capabilities: ["mock.research_lookup"],
      input: { topic: "the topic" },
    });
    work.submitWorkerOutcome({
      workspace_id: workspaceId,
      envelope_id: envelope.id,
      worker_id: worker.id,
      status: "failed",
      summary: "Could not complete the research within the bounded authority.",
      idempotency_key: "wedge:outcome:failed",
    });

    const created = requireEvent(workspaceId, "work.created");
    const envelopeEvent = requireEvent(workspaceId, "work.envelope.created");
    const outcome = requireEvent(workspaceId, "work.outcome_submitted");

    const diagnosis = new DiagnosisService(database).diagnose({
      workspace_id: workspaceId,
      failure_event_id: outcome.id,
    });

    // The failed outcome traces back through the bounded envelope (its authority + input) to the
    // work item's creation — the envelope's produced_refs make it a real link, not a no-op.
    const candidateIds = diagnosis.candidates.map((candidate) => candidate.event_id);
    expect(candidateIds).toContain(envelopeEvent.id);
    expect(candidateIds).toContain(created.id);
    const origin = diagnosis.candidates.find((candidate) => candidate.event_id === created.id);
    expect(origin?.is_root).toBe(true);
  });

  it("traces a rejected review back to the work item's creation", async () => {
    const workspaceId = await seedWorkspace();
    const work = new WorkService(database);

    const item = work.createWork({
      workspace_id: workspaceId,
      title: "Draft the update",
      objective: "Prepare a reviewable draft",
      owner: "agent_worker",
      actor: "agent_planner",
    });
    work.reviewWork({
      workspace_id: workspaceId,
      work_item_id: item.id,
      decision: "rejected",
      notes: "Does not meet the bar",
      actor: "operator:reviewer",
    });

    const created = requireEvent(workspaceId, "work.created");
    const reviewed = requireEvent(workspaceId, "work.reviewed");

    const diagnosis = new DiagnosisService(database).diagnose({
      workspace_id: workspaceId,
      failure_event_id: reviewed.id,
    });

    const candidateIds = diagnosis.candidates.map((candidate) => candidate.event_id);
    expect(candidateIds).toContain(created.id);
  });

  it("keeps lifecycle emission idempotent on replay despite the added causal fields", async () => {
    const workspaceId = await seedWorkspace();
    const work = new WorkService(database);

    const first = work.createWork({
      id: "work_99999999999999999999999999999999",
      workspace_id: workspaceId,
      title: "Idempotent work",
      objective: "Replay must not double-emit",
      owner: "agent_worker",
      actor: "agent_planner",
      idempotency_key: "wedge:idem:create",
    });
    const replay = work.createWork({
      id: first.id,
      workspace_id: workspaceId,
      title: "Idempotent work",
      objective: "Replay must not double-emit",
      owner: "agent_worker",
      actor: "agent_planner",
      idempotency_key: "wedge:idem:create",
    });

    expect(replay.id).toBe(first.id);
    const createdEvents = eventsFor(workspaceId).filter((event) => event.kind === "work.created");
    expect(createdEvents).toHaveLength(1);
  });
});
