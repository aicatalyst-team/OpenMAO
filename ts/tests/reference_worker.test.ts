import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Database, EventStore, WorkItemStore } from "../src/persistence/index.js";
import {
  REFERENCE_INGESTION_ID,
  REFERENCE_OUTCOME_ID,
  REFERENCE_WORK_ID,
  REFERENCE_WORKER_ID,
  runReferenceWorkerDemo,
} from "../src/workers/index.js";
import { WorldModelService } from "../src/world/index.js";

let tmpRoot: string;
let database: Database;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "openmao-ts-reference-worker-"));
  database = new Database(join(tmpRoot, "openmao.sqlite3"));
  database.initialize();
});

afterEach(() => {
  database.close();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("v1 reference external worker", () => {
  it("runs idempotently under OpenMAO authority and projects into the world model", () => {
    const result = runReferenceWorkerDemo(database);
    const replayed = runReferenceWorkerDemo(database);
    const events = new EventStore(database).listForWorkspace(result.workspace_id);
    const work = new WorkItemStore(database).get(REFERENCE_WORK_ID);
    const world = new WorldModelService(database).rebuild(result.workspace_id);

    expect(replayed).toEqual(result);
    expect(result.worker_id).toBe(REFERENCE_WORKER_ID);
    expect(result.outcome_id).toBe(REFERENCE_OUTCOME_ID);
    expect(result.ingestion_id).toBe(REFERENCE_INGESTION_ID);
    expect(result.work_status).toBe("done");
    expect(work?.status).toBe("done");
    expect(events.map((event) => event.kind)).toEqual(
      expect.arrayContaining([
        "worker.registered",
        "work.created",
        "work.assigned",
        "work.envelope.created",
        "work.outcome_submitted",
        "ingestion.recorded",
        "work.reviewed",
      ]),
    );
    expect(world.external_workers).toContain(REFERENCE_WORKER_ID);
    expect(world.recent_ingestions).toContain(REFERENCE_INGESTION_ID);
  });
});
