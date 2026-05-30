import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WorkspaceSchema } from "../src/contracts/index.js";
import { DiagnosisService } from "../src/diagnosis/index.js";
import { Database, EventStore, WorkspaceStore } from "../src/persistence/index.js";
import { WorkService } from "../src/work/index.js";

const fixturePath = new URL("../../tests/fixtures/canonical_v0.json", import.meta.url);

let tmpRoot: string;
let database: Database;

async function seedWorkspace(): Promise<string> {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, unknown>;
  return new WorkspaceStore(database).save(WorkspaceSchema.parse(fixture.workspace)).id;
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

describe("wedge: M3 diagnoses a real work failure end to end", () => {
  it("traces a failed work item back to its creation through the instrumented event log", async () => {
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

    const events = new EventStore(database).listForWorkspace(workspaceId);
    const created = events.find((event) => event.kind === "work.created");
    const failed = events.find((event) => event.kind === "work.failed");
    if (!created || !failed) {
      throw new Error("expected work.created and work.failed events to be recorded");
    }

    const diagnosis = new DiagnosisService(database).diagnose({
      workspace_id: workspaceId,
      failure_event_id: failed.id,
    });

    // The failure causally traces back to the work item's creation — diagnosis on REAL events.
    const candidateIds = diagnosis.candidates.map((candidate) => candidate.event_id);
    expect(candidateIds).toContain(created.id);
    expect(
      diagnosis.candidates.find((candidate) => candidate.event_id === created.id)?.is_root,
    ).toBe(true);
    expect(
      new EventStore(database).listForWorkspace(workspaceId).map((event) => event.kind),
    ).toContain("diagnosis.suggested");
  });
});
