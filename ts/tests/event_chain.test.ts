import { readFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type Workspace, WorkspaceSchema } from "../src/contracts/index.js";
import { Database, EventStore, WorkspaceStore } from "../src/persistence/index.js";
import { dumpJson } from "../src/persistence/serialization.js";

const fixturePath = new URL("../../tests/fixtures/canonical_v0.json", import.meta.url);
const GENESIS_HASH = "0".repeat(64);

describe("event hash chain (tamper-evidence)", () => {
  let database: Database;
  let events: EventStore;
  let workspaceId: string;

  beforeEach(async () => {
    database = new Database();
    database.initialize();
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, unknown>;
    const workspace: Workspace = WorkspaceSchema.parse(fixture.workspace);
    new WorkspaceStore(database).save(workspace);
    workspaceId = workspace.id;
    events = new EventStore(database);
  });

  afterEach(() => {
    database.close();
  });

  it("anchors the first event to genesis and links each event to the previous", () => {
    const first = events.append({ workspace_id: workspaceId, kind: "demo.first", actor: "alice" });
    const second = events.append({ workspace_id: workspaceId, kind: "demo.second", actor: "bob" });

    expect(first.prev_hash).toBe(GENESIS_HASH);
    expect(first.hash).not.toBeNull();
    expect(second.prev_hash).toBe(first.hash);
    expect(events.verifyChain(workspaceId)).toEqual({ ok: true });
  });

  it("detects payload tampering and localizes the break", () => {
    events.append({ workspace_id: workspaceId, kind: "demo.first", actor: "alice" });
    const target = events.append({ workspace_id: workspaceId, kind: "demo.second", actor: "bob" });

    // Simulate out-of-band tampering: an actor who bypasses the append-only
    // triggers (drops them, or edits the SQLite file directly) and rewrites a row
    // without recomputing its hash. The triggers prevent in-DB edits; the chain is
    // what catches an edit that slips past them.
    database.connection.exec("DROP TRIGGER events_no_update");
    const tampered = { ...target, actor: "intruder" };
    database.connection
      .prepare("UPDATE events SET payload_json = ? WHERE id = ?")
      .run(dumpJson(tampered), target.id);

    const result = events.verifyChain(workspaceId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.broken_at).toBe(target.id);
    }
  });

  it("detects reordering through the prev_hash linkage", () => {
    const first = events.append({ workspace_id: workspaceId, kind: "demo.first", actor: "alice" });
    const second = events.append({ workspace_id: workspaceId, kind: "demo.second", actor: "bob" });

    // Out-of-band reorder past the append-only triggers: swap the two sequence
    // numbers. Each row stays internally valid, but the chain order no longer
    // matches the prev_hash links. UNIQUE(workspace_id, seq) forces a temporary
    // parking value mid-swap.
    database.connection.exec("DROP TRIGGER events_no_update");
    database.connection.transaction(() => {
      database.connection.prepare("UPDATE events SET seq = ? WHERE id = ?").run(-1, first.id);
      database.connection
        .prepare("UPDATE events SET seq = ? WHERE id = ?")
        .run(first.seq, second.id);
      database.connection
        .prepare("UPDATE events SET seq = ? WHERE id = ?")
        .run(second.seq, first.id);
    })();

    expect(events.verifyChain(workspaceId).ok).toBe(false);
  });
});
