import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkerIdentitySchema, WorkItemSchema, WorkspaceSchema } from "../src/contracts/index.js";
import { IngestionService } from "../src/ingestion/index.js";
import {
  Database,
  EventStore,
  IngestionRecordConflictError,
  IngestionRecordStore,
  WorkerIdentityStore,
  WorkItemStore,
  WorkspaceStore,
} from "../src/persistence/index.js";
import { WorldModelService } from "../src/world/index.js";

const fixturePath = new URL("../../tests/fixtures/canonical_v0.json", import.meta.url);

let tmpRoot: string;
let database: Database;

async function loadFixture(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, unknown>;
}

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), "openmao-ts-ingestion-"));
  database = new Database(join(tmpRoot, "openmao.sqlite3"));
  database.initialize();
  const fixture = await loadFixture();
  new WorkspaceStore(database).save(WorkspaceSchema.parse(fixture.workspace));
  new WorkItemStore(database).save(WorkItemSchema.parse(fixture.work_item));
  new WorkerIdentityStore(database).save(
    WorkerIdentitySchema.parse({
      id: "worker_12121212121212121212121212121212",
      workspace_id: (fixture.workspace as { id: string }).id,
      name: "Reference worker",
      runtime: "openmao.test.worker",
    }),
  );
});

afterEach(() => {
  database.close();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("ingestion service", () => {
  it("records external observations idempotently and projects them into the world model", async () => {
    const fixture = await loadFixture();
    const workspaceId = (fixture.workspace as { id: string }).id;
    const workItemId = (fixture.work_item as { id: string }).id;
    const service = new IngestionService(database);

    const record = service.record({
      id: "ingest_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      workspace_id: workspaceId,
      source: { provider: "openmao", external_id: "reference-worker", external_url: null },
      actor: {
        actor_type: "worker",
        actor_id: "worker_12121212121212121212121212121212",
        display_name: "Reference worker",
      },
      kind: "trace",
      target_work_item_id: workItemId,
      payload: { node: "reference_worker.completed" },
      occurred_at: "2026-05-27T15:21:00Z",
      idempotency_key: "reference-worker:trace:completed",
    });
    const replayed = service.record({
      ...record,
      source: record.source,
      actor: record.actor,
    });
    const events = new EventStore(database).listForWorkspace(workspaceId);
    const world = new WorldModelService(database).rebuild(workspaceId);

    expect(replayed).toEqual(record);
    expect(new IngestionRecordStore(database).listForWorkspace(workspaceId)).toEqual([record]);
    expect(events.map((event) => event.kind)).toEqual(["ingestion.recorded"]);
    expect(events[0]?.actor).toBe("worker:worker_12121212121212121212121212121212");
    expect(world.recent_ingestions).toEqual([record.id]);
    expect(() =>
      service.record({
        ...record,
        id: "ingest_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        payload: { changed: true },
      }),
    ).toThrow(IngestionRecordConflictError);
  });

  it("rejects missing identity and idempotency", async () => {
    const fixture = await loadFixture();
    const workspaceId = (fixture.workspace as { id: string }).id;
    const workItemId = (fixture.work_item as { id: string }).id;
    const service = new IngestionService(database);

    expect(() =>
      service.record({
        workspace_id: workspaceId,
        source: { provider: "openmao", external_id: "reference-worker", external_url: null },
        actor: {
          actor_type: "worker",
          actor_id: "worker_12121212121212121212121212121212",
          display_name: null,
        },
        kind: "trace",
        target_work_item_id: workItemId,
        idempotency_key: "",
      }),
    ).toThrow("idempotency");
    expect(() =>
      service.record({
        workspace_id: workspaceId,
        source: { provider: "openmao", external_id: null, external_url: null },
        actor: {
          actor_type: "worker",
          actor_id: "worker_12121212121212121212121212121212",
          display_name: null,
        },
        kind: "trace",
        target_work_item_id: workItemId,
        idempotency_key: "reference-worker:trace:missing-source",
      }),
    ).toThrow("source external identity");
    expect(() =>
      service.record({
        workspace_id: workspaceId,
        source: { provider: "openmao", external_id: "reference-worker", external_url: null },
        actor: {
          actor_type: "worker",
          actor_id: "worker_missingmissingmissingmissingmiss",
          display_name: null,
        },
        kind: "trace",
        target_work_item_id: workItemId,
        idempotency_key: "reference-worker:trace:missing-worker",
      }),
    ).toThrow("worker actor");
  });

  it("rejects secret-shaped ingestion payloads before persistence", async () => {
    const fixture = await loadFixture();
    const workspaceId = (fixture.workspace as { id: string }).id;
    const workItemId = (fixture.work_item as { id: string }).id;
    const service = new IngestionService(database);

    expect(() =>
      service.record({
        id: "ingest_cccccccccccccccccccccccccccccccc",
        workspace_id: workspaceId,
        source: { provider: "openmao", external_id: "reference-worker", external_url: null },
        actor: {
          actor_type: "worker",
          actor_id: "worker_12121212121212121212121212121212",
          display_name: null,
        },
        kind: "trace",
        target_work_item_id: workItemId,
        payload: { api_key: "sk-testsecret123456" },
        idempotency_key: "reference-worker:trace:redacted-payload",
      }),
    ).toThrow("sensitive key");
    expect(new IngestionRecordStore(database).listForWorkspace(workspaceId)).toEqual([]);
    expect(new EventStore(database).listForWorkspace(workspaceId)).toEqual([]);
  });
});
