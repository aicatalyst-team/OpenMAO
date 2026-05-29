import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChiefOfStaffService } from "../src/chief_of_staff/index.js";
import { WorkspaceSchema } from "../src/contracts/index.js";
import { ApprovalStore, Database, EventStore } from "../src/persistence/index.js";
import { WorkService } from "../src/work/index.js";

const fixturePath = new URL("../../tests/fixtures/canonical_v0.json", import.meta.url);

// Fixed, injected times: the Chief of Staff takes time as a parameter, never an
// ambient clock, so the whole loop is deterministic and replayable.
const AT = "2026-03-01T00:00:00Z";
const HALFWAY = "2026-03-01T00:30:00Z";
const LEARNING_DUE_AGAIN = "2026-03-01T01:00:00Z"; // AT + 3600s (learning_scan interval)

let tmpRoot: string;
let database: Database;

async function seedWorkspace(): Promise<string> {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, unknown>;
  const workspace = WorkspaceSchema.parse(fixture.workspace);
  const { WorkspaceStore } = await import("../src/persistence/index.js");
  return new WorkspaceStore(database).save(workspace).id;
}

function seedRepeatedBlockers(workspaceId: string): void {
  const work = new WorkService(database);
  for (const suffix of ["11111111111111111111111111111111", "22222222222222222222222222222222"]) {
    const item = work.createWork({
      id: `work_${suffix}`,
      workspace_id: workspaceId,
      title: `Blocked item ${suffix.slice(0, 4)}`,
      objective: "Demonstrate a repeated blocker.",
      owner: "worker:research",
      actor: "test",
    });
    work.setStatus({
      workspace_id: workspaceId,
      work_item_id: item.id,
      status: "blocked",
      actor: "test",
      reason: "Missing source access.",
    });
  }
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "openmao-ts-cos-"));
  database = new Database(join(tmpRoot, "openmao.sqlite3"));
  database.initialize();
});

afterEach(() => {
  database.close();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("Chief of Staff communication loop", () => {
  it("fires due cadences and reports evidence-backed notifications attributed to the Chief of Staff", async () => {
    const workspaceId = await seedWorkspace();
    seedRepeatedBlockers(workspaceId);
    const cos = new ChiefOfStaffService(database);
    cos.ensureDefaultCadences(workspaceId, AT);

    const result = cos.tick({ workspace_id: workspaceId, at: AT });

    expect(result.fired.map((entry) => entry.kind).sort()).toEqual([
      "learning_scan",
      "stale_approval_sweep",
      "status_digest",
    ]);
    const notifications = cos.listNotifications(workspaceId);
    expect(notifications.length).toBeGreaterThan(0);
    // Invariant 3: every notification is the Chief of Staff's, never the human's.
    expect(notifications.every((note) => note.actor === "chief_of_staff")).toBe(true);
    // Invariant 6: the evidence-bearing notices cite their source.
    const learning = notifications.filter((note) => note.kind === "learning_proposal");
    expect(learning.length).toBeGreaterThan(0);
    expect(learning.every((note) => note.evidence.length > 0)).toBe(true);

    const events = new EventStore(database).listForWorkspace(workspaceId);
    const cosKinds = new Set(["cadence.fired", "cos.notification.created"]);
    const cosEvents = events.filter((event) => cosKinds.has(event.kind));
    expect(cosEvents.length).toBeGreaterThan(0);
    expect(cosEvents.every((event) => event.actor === "chief_of_staff")).toBe(true);
  });

  it("is idempotent: re-ticking at the same time produces no new notifications or events", async () => {
    const workspaceId = await seedWorkspace();
    seedRepeatedBlockers(workspaceId);
    const cos = new ChiefOfStaffService(database);
    cos.ensureDefaultCadences(workspaceId, AT);

    cos.tick({ workspace_id: workspaceId, at: AT });
    const notificationsAfterFirst = cos.listNotifications(workspaceId).length;
    const eventsAfterFirst = new EventStore(database).listForWorkspace(workspaceId).length;

    const second = cos.tick({ workspace_id: workspaceId, at: AT });

    expect(second.fired).toHaveLength(0);
    expect(cos.listNotifications(workspaceId).length).toBe(notificationsAfterFirst);
    expect(new EventStore(database).listForWorkspace(workspaceId).length).toBe(eventsAfterFirst);
  });

  it("never takes a side effect: a tick proposes and notifies but applies nothing", async () => {
    const workspaceId = await seedWorkspace();
    seedRepeatedBlockers(workspaceId);
    const cos = new ChiefOfStaffService(database);
    cos.ensureDefaultCadences(workspaceId, AT);

    cos.tick({ workspace_id: workspaceId, at: AT });

    const kinds = new EventStore(database).listForWorkspace(workspaceId).map((event) => event.kind);
    // It may propose (communication side); it must never apply, execute, promote, or
    // invoke a capability — the action side stays behind the governance gate.
    expect(
      kinds.filter((kind) => /^capability\.|\.applied$|\.executed$|\.promoted$/.test(kind)),
    ).toEqual([]);
    // And proposing is the communication mechanism, so the tick does surface proposals.
    expect(kinds).toContain("org_change.proposed");
  });

  it("flags a stale approval using the recorded tick time, not a wall clock", async () => {
    const workspaceId = await seedWorkspace();
    const work = new WorkService(database);
    const item = work.createWork({
      id: "work_33333333333333333333333333333333",
      workspace_id: workspaceId,
      title: "Needs review",
      objective: "Has a long-pending operational approval.",
      owner: "worker:research",
      actor: "test",
    });
    const approvals = new ApprovalStore(database);
    approvals.create({
      id: "approval_dddddddddddddddddddddddddddddddd",
      workspace_id: workspaceId,
      run_id: null,
      action: "work.review",
      requested_by: "worker:research",
      payload: {
        target_type: "work_item",
        target_id: item.id,
        reason: "Long-pending review.",
        data: {},
      },
      status: "pending",
      on_approve: "resume_run",
      on_reject: "fail_run",
      created_at: "2020-01-01T00:00:00Z",
      resolved_at: null,
    });
    approvals.create({
      id: "approval_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      workspace_id: workspaceId,
      run_id: null,
      action: "work.review",
      requested_by: "worker:research",
      payload: {
        target_type: "work_item",
        target_id: item.id,
        reason: "Just-created review.",
        data: {},
      },
      status: "pending",
      on_approve: "resume_run",
      on_reject: "fail_run",
      created_at: AT,
      resolved_at: null,
    });

    const cos = new ChiefOfStaffService(database);
    cos.ensureDefaultCadences(workspaceId, AT);
    cos.tick({ workspace_id: workspaceId, at: AT });

    const stale = cos
      .listNotifications(workspaceId)
      .filter((note) => note.kind === "stale_approval");
    expect(stale).toHaveLength(1);
    expect(stale[0]?.refs).toContain("approval_dddddddddddddddddddddddddddddddd");
    expect(stale[0]?.refs).not.toContain("approval_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
  });

  it("marks a notification read and filters it from the unread inbox", async () => {
    const workspaceId = await seedWorkspace();
    seedRepeatedBlockers(workspaceId);
    const cos = new ChiefOfStaffService(database);
    cos.ensureDefaultCadences(workspaceId, AT);
    cos.tick({ workspace_id: workspaceId, at: AT });

    const target = cos.listNotifications(workspaceId, { unreadOnly: true })[0];
    expect(target).toBeDefined();
    const read = cos.markRead({
      workspace_id: workspaceId,
      notification_id: target?.id ?? "",
      at: AT,
    });

    expect(read.status).toBe("read");
    expect(
      cos.listNotifications(workspaceId, { unreadOnly: true }).some((note) => note.id === read.id),
    ).toBe(false);
  });

  it("respects cadence scheduling: a cadence does not re-fire before it is due", async () => {
    const workspaceId = await seedWorkspace();
    seedRepeatedBlockers(workspaceId);
    const cos = new ChiefOfStaffService(database);
    cos.ensureDefaultCadences(workspaceId, AT);
    cos.tick({ workspace_id: workspaceId, at: AT });

    // Halfway to the learning interval: nothing is due.
    expect(cos.tick({ workspace_id: workspaceId, at: HALFWAY }).fired).toHaveLength(0);

    // At the learning interval, only learning_scan is due again; its proposals are
    // unchanged, so the dedupe keeps it from re-notifying.
    const reFire = cos.tick({ workspace_id: workspaceId, at: LEARNING_DUE_AGAIN });
    expect(reFire.fired.map((entry) => entry.kind)).toEqual(["learning_scan"]);
    expect(reFire.notification_count).toBe(0);
  });

  it("normalizes the tick time so a sub-second-precision tick still fires due cadences", async () => {
    const workspaceId = await seedWorkspace();
    seedRepeatedBlockers(workspaceId);
    const cos = new ChiefOfStaffService(database);
    cos.ensureDefaultCadences(workspaceId, AT); // due at whole-second AT

    // Raw lexicographic compare of "...00Z" <= "...00.500Z" would wrongly skip these;
    // normalization to second precision makes the schedule fire correctly.
    const result = cos.tick({ workspace_id: workspaceId, at: "2026-03-01T00:00:00.500Z" });

    expect(result.fired.length).toBe(3);
  });
});
