import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EventPayloadSchema, WorkspaceSchema } from "../src/contracts/index.js";
import { DiagnosisService } from "../src/diagnosis/index.js";
import { Database, EventStore, WorkspaceStore } from "../src/persistence/index.js";

const fixturePath = new URL("../../tests/fixtures/canonical_v0.json", import.meta.url);

let tmpRoot: string;
let database: Database;

async function seedWorkspace(): Promise<string> {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, unknown>;
  return new WorkspaceStore(database).save(WorkspaceSchema.parse(fixture.workspace)).id;
}

const coordinator = {
  actor_type: "agent" as const,
  actor_id: "agent_coordinator",
  display_name: null,
};
const researcher = {
  actor_type: "agent" as const,
  actor_id: "agent_researcher",
  display_name: null,
};

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "openmao-ts-diagnosis-"));
  database = new Database(join(tmpRoot, "openmao.sqlite3"));
  database.initialize();
});

afterEach(() => {
  database.close();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("M3 advisory causal diagnosis", () => {
  it("backward-traces a failure to its load-bearing origin and emits an advisory hint", async () => {
    const workspaceId = await seedWorkspace();
    const events = new EventStore(database);

    // A causal chain that ends in failure: the coordinator plans and produces a brief, hands off to
    // a researcher who consumes the brief and then fails. The plan is the origin of the chain.
    const planned = events.append({
      workspace_id: workspaceId,
      kind: "work.planned",
      actor: "spine",
      payload: EventPayloadSchema.parse({ actor_ref: coordinator, produced_refs: ["brief_alpha"] }),
    });
    const handoff = events.append({
      workspace_id: workspaceId,
      kind: "handoff.requested",
      actor: "spine",
      payload: EventPayloadSchema.parse({ actor_ref: coordinator }),
    });
    const received = events.append({
      workspace_id: workspaceId,
      kind: "handoff.completed",
      actor: "spine",
      payload: EventPayloadSchema.parse({
        actor_ref: researcher,
        causal_parent_id: handoff.id,
        consumed_refs: ["brief_alpha"],
      }),
    });
    const failed = events.append({
      workspace_id: workspaceId,
      kind: "work.outcome_submitted",
      actor: "spine",
      payload: EventPayloadSchema.parse({ actor_ref: researcher, data: { status: "failed" } }),
    });

    const diagnosis = new DiagnosisService(database).diagnose({
      workspace_id: workspaceId,
      failure_event_id: failed.id,
    });

    // The plan is the deepest (source) cause the failure traces back to.
    expect(diagnosis.candidates[0]?.event_id).toBe(planned.id);
    expect(diagnosis.candidates[0]?.is_root).toBe(true);
    // It backward-traced the full causal cone.
    expect(diagnosis.candidates.map((candidate) => candidate.event_id)).toEqual(
      expect.arrayContaining([planned.id, handoff.id, received.id]),
    );
    // The proximate, most load-bearing link (`received`) carries the highest counterfactual score.
    const received_candidate = diagnosis.candidates.find((c) => c.event_id === received.id);
    expect(received_candidate?.counterfactual_score).toBeGreaterThan(0);

    // Advisory only: a diagnosis.suggested event, never a proposal or an apply.
    const kinds = new EventStore(database).listForWorkspace(workspaceId).map((event) => event.kind);
    expect(kinds).toContain("diagnosis.suggested");
    expect(kinds).not.toContain("org_change.proposed");
    expect(kinds).not.toContain("org_change.applied");
    expect(diagnosis.note).toMatch(/advisory/i);
  });

  it("returns no candidates when the failure has no instrumented causal ancestors", async () => {
    const workspaceId = await seedWorkspace();
    const events = new EventStore(database);
    // A bare failure with no causal fields → no edges → no ancestors to trace.
    const failed = events.append({
      workspace_id: workspaceId,
      kind: "work.outcome_submitted",
      actor: "spine",
    });

    const diagnosis = new DiagnosisService(database).diagnose({
      workspace_id: workspaceId,
      failure_event_id: failed.id,
    });

    expect(diagnosis.candidates).toHaveLength(0);
    // It still records the (empty) advisory, gating nothing.
    const kinds = new EventStore(database).listForWorkspace(workspaceId).map((event) => event.kind);
    expect(kinds).toContain("diagnosis.suggested");
  });

  it("bounds the counterfactual screen to a budget and flags truncation", async () => {
    const workspaceId = await seedWorkspace();
    const events = new EventStore(database);
    const planned = events.append({
      workspace_id: workspaceId,
      kind: "work.planned",
      actor: "spine",
      payload: EventPayloadSchema.parse({ actor_ref: coordinator, produced_refs: ["brief_alpha"] }),
    });
    const handoff = events.append({
      workspace_id: workspaceId,
      kind: "handoff.requested",
      actor: "spine",
      payload: EventPayloadSchema.parse({ actor_ref: coordinator }),
    });
    events.append({
      workspace_id: workspaceId,
      kind: "handoff.completed",
      actor: "spine",
      payload: EventPayloadSchema.parse({
        actor_ref: researcher,
        causal_parent_id: handoff.id,
        consumed_refs: ["brief_alpha"],
      }),
    });
    const failed = events.append({
      workspace_id: workspaceId,
      kind: "work.outcome_submitted",
      actor: "spine",
      payload: EventPayloadSchema.parse({ actor_ref: researcher, data: { status: "failed" } }),
    });

    // Three ancestors, budget of one → screen only the deepest (earliest) and flag truncation.
    const diagnosis = new DiagnosisService(database, { maxAncestors: 1 }).diagnose({
      workspace_id: workspaceId,
      failure_event_id: failed.id,
    });

    expect(diagnosis.truncated).toBe(true);
    expect(diagnosis.candidates).toHaveLength(1);
    expect(diagnosis.candidates[0]?.event_id).toBe(planned.id);
  });
});
