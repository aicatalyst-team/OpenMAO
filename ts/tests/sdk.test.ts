import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WorkspaceSchema } from "../src/contracts/index.js";
import { Database, WorkspaceStore } from "../src/persistence/index.js";
import { OpenMaoLocalClient } from "../src/sdk/index.js";

const fixturePath = new URL("../../tests/fixtures/canonical_v0.json", import.meta.url);

let tmpRoot: string;
let database: Database;

async function loadFixture(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, unknown>;
}

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), "openmao-ts-sdk-"));
  database = new Database(join(tmpRoot, "openmao.sqlite3"));
  database.initialize();
  const fixture = await loadFixture();
  new WorkspaceStore(database).save(WorkspaceSchema.parse(fixture.workspace));
});

afterEach(() => {
  database.close();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("local SDK client", () => {
  it("lets a governed worker flow use services without importing stores", async () => {
    const fixture = await loadFixture();
    const workspaceId = (fixture.workspace as { id: string }).id;
    const client = new OpenMaoLocalClient(database, {
      workspace_id: workspaceId,
      actor: "sdk_operator",
    });

    const worker = client.registerWorker({
      id: "worker_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      name: "SDK Reference Worker",
      runtime: "openmao.sdk.test",
      allowed_capabilities: ["mock.research_lookup"],
      idempotency_key: "sdk:worker:register",
    });
    const work = client.createWork({
      id: "work_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      title: "SDK governed work",
      objective: "Demonstrate service-backed SDK worker flow.",
      owner: "sdk_operator",
      reviewer: "human",
      success_criteria: ["outcome is reviewable"],
      idempotency_key: "sdk:work:create",
    });
    const assigned = client.assignWork({
      work_item_id: work.id,
      owner: worker.id,
      idempotency_key: "sdk:work:assign",
    });
    const envelope = client.issueEnvelope({
      id: "envelope_cccccccccccccccccccccccccccccccc",
      work_item_id: work.id,
      worker_id: worker.id,
      input: { task: "prepare update" },
      idempotency_key: "sdk:work:envelope",
    });
    const outcome = client.submitOutcome({
      id: "outcome_dddddddddddddddddddddddddddddddd",
      envelope_id: envelope.id,
      worker_id: worker.id,
      status: "completed",
      summary: "SDK worker completed the bounded task.",
      output: { ready: true },
      idempotency_key: "sdk:work:outcome",
    });
    const ingestion = client.recordIngestion({
      id: "ingest_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      kind: "trace",
      target_work_item_id: work.id,
      payload: { node: "sdk_worker.completed" },
      idempotency_key: "sdk:ingestion:trace",
    });
    const reviewed = client.reviewWork({
      work_item_id: work.id,
      decision: "accepted",
      idempotency_key: "sdk:work:review",
    });

    expect(client.workers()).toEqual([worker]);
    expect(client.workItems().map((item) => item.id)).toEqual([work.id]);
    expect(assigned.status).toBe("in_progress");
    expect(client.envelopes(work.id)).toEqual([envelope]);
    expect(client.outcomes(work.id)).toEqual([outcome]);
    expect(client.ingestionRecords()).toEqual([ingestion]);
    expect(reviewed.status).toBe("done");
    expect(client.events().map((event) => event.kind)).toEqual([
      "worker.registered",
      "work.created",
      "work.assigned",
      "work.envelope.created",
      "work.outcome_submitted",
      "ingestion.recorded",
      "work.reviewed",
    ]);
  });
});
