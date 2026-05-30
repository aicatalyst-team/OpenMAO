import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChiefOfStaffService } from "../src/chief_of_staff/index.js";
import { MemoryEntrySchema, newId, utcNow, WorkspaceSchema } from "../src/contracts/index.js";
import { HeartbeatService, RecordingTransport } from "../src/heartbeat/index.js";
import {
  Database,
  EventStore,
  MemoryEntryStore,
  WorkspaceStore,
} from "../src/persistence/index.js";

const fixturePath = new URL("../../tests/fixtures/canonical_v0.json", import.meta.url);
const T0 = "2026-01-01T00:00:00Z";

let tmpRoot: string;
let database: Database;

async function seedWorkspace(): Promise<string> {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, unknown>;
  return new WorkspaceStore(database).save(WorkspaceSchema.parse(fixture.workspace)).id;
}

function seedStaleMemory(workspaceId: string): void {
  new MemoryEntryStore(database).save(
    MemoryEntrySchema.parse({
      id: newId("mem"),
      workspace_id: workspaceId,
      scope: "individual",
      owner_id: null,
      kind: "semantic",
      content: "an old fact nobody trusts anymore",
      provenance: {},
      confidence: 0.2,
      status: "stale",
      created_at: utcNow(),
    }),
  );
}

function eventKinds(workspaceId: string): string[] {
  return new EventStore(database).listForWorkspace(workspaceId).map((event) => event.kind);
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "openmao-ts-heartbeat-"));
  database = new Database(join(tmpRoot, "openmao.sqlite3"));
  database.initialize();
});

afterEach(() => {
  database.close();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("M2 heartbeat", () => {
  it("beats: senses via the Chief of Staff and delivers one digest of what's new", async () => {
    const workspaceId = await seedWorkspace();
    new ChiefOfStaffService(database).ensureDefaultCadences(workspaceId, T0);
    const transport = new RecordingTransport();

    const result = new HeartbeatService(database, { transport }).beat({
      workspace_id: workspaceId,
      at: T0,
    });

    expect(result.delivered).toBe(true);
    expect(result.notification_count).toBeGreaterThan(0);
    expect(transport.delivered).toHaveLength(1);
    expect(transport.delivered[0]?.notifications.length).toBe(result.notification_count);
    expect(eventKinds(workspaceId)).toEqual(
      expect.arrayContaining(["heartbeat.beat", "cos.digest.delivered"]),
    );
  });

  it("delivers nothing when a beat surfaces nothing new", async () => {
    const workspaceId = await seedWorkspace();
    // No cadences seeded → nothing is due → the beat produces no notifications.
    const transport = new RecordingTransport();

    const result = new HeartbeatService(database, { transport }).beat({
      workspace_id: workspaceId,
      at: T0,
    });

    expect(result.delivered).toBe(false);
    expect(result.notification_count).toBe(0);
    expect(transport.delivered).toHaveLength(0);
    // The beat itself is still recorded (the org's pulse), even with nothing to say.
    expect(eventKinds(workspaceId)).toContain("heartbeat.beat");
    expect(eventKinds(workspaceId)).not.toContain("cos.digest.delivered");
  });

  it("caps digest volume so a busy beat cannot flood the human", async () => {
    const workspaceId = await seedWorkspace();
    seedStaleMemory(workspaceId); // → a learning_proposal notification, plus the status_digest one
    new ChiefOfStaffService(database).ensureDefaultCadences(workspaceId, T0);
    const transport = new RecordingTransport();

    const result = new HeartbeatService(database, {
      transport,
      maxNotificationsPerDigest: 1,
    }).beat({ workspace_id: workspaceId, at: T0 });

    expect(result.notification_count).toBeGreaterThanOrEqual(2);
    expect(result.truncated).toBe(result.notification_count - 1);
    expect(transport.delivered[0]?.notifications).toHaveLength(1);
    expect(transport.delivered[0]?.truncated).toBe(result.truncated);
  });

  it("re-beating at the same instant is a no-op (idempotent, deterministic from the log)", async () => {
    const workspaceId = await seedWorkspace();
    new ChiefOfStaffService(database).ensureDefaultCadences(workspaceId, T0);
    const transport = new RecordingTransport();
    const heartbeat = new HeartbeatService(database, { transport });

    const first = heartbeat.beat({ workspace_id: workspaceId, at: T0 });
    const second = heartbeat.beat({ workspace_id: workspaceId, at: T0 });

    expect(first.delivered).toBe(true);
    expect(second.delivered).toBe(false);
    expect(transport.delivered).toHaveLength(1);
    expect(eventKinds(workspaceId).filter((kind) => kind === "cos.digest.delivered")).toHaveLength(
      1,
    );
  });

  it("runs as a deterministic daemon loop until told to stop", async () => {
    const workspaceId = await seedWorkspace();
    new ChiefOfStaffService(database).ensureDefaultCadences(workspaceId, T0);
    const transport = new RecordingTransport();
    const clockTimes = [T0, "2026-01-01T01:00:00Z", "2026-01-01T02:00:00Z"];
    let beatCount = 0;

    const beats = await new HeartbeatService(database, { transport }).run({
      workspace_id: workspaceId,
      interval_seconds: 3600,
      clock: () => clockTimes[beatCount] ?? clockTimes[clockTimes.length - 1] ?? T0,
      sleep: async () => {
        /* no real delay under test */
      },
      shouldStop: () => beatCount >= clockTimes.length,
      onBeat: () => {
        beatCount += 1;
      },
    });

    expect(beats).toBe(3);
    // The first beat had due cadences and delivered; the loop mechanics carried the rest.
    expect(transport.delivered.length).toBeGreaterThanOrEqual(1);
  });

  it("is report-only: a beat never applies a change or moves the autonomy dial", async () => {
    const workspaceId = await seedWorkspace();
    seedStaleMemory(workspaceId);
    new ChiefOfStaffService(database).ensureDefaultCadences(workspaceId, T0);

    new HeartbeatService(database, { transport: new RecordingTransport() }).beat({
      workspace_id: workspaceId,
      at: T0,
    });

    const kinds = new Set(eventKinds(workspaceId));
    // Proposing is allowed (the communication side); applying / pausing / autonomy changes are not.
    expect(kinds.has("org_change.applied")).toBe(false);
    expect(kinds.has("org_change.verified")).toBe(false);
    expect(kinds.has("org_control.apply_paused")).toBe(false);
  });
});
