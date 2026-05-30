import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type AutonomyLevel,
  EventPayloadSchema,
  newId,
  OrganizationSchema,
  utcNow,
  WorkspaceSchema,
} from "../src/contracts/index.js";
import {
  AutonomyCapError,
  AutonomyRatificationError,
  AutonomyService,
  AutonomyStepError,
  InsufficientTrackRecordError,
} from "../src/org/index.js";
import {
  AutonomyTransitionConflictError,
  Database,
  EventStore,
  OrganizationStore,
  WorkspaceStore,
} from "../src/persistence/index.js";

const fixturePath = new URL("../../tests/fixtures/canonical_v0.json", import.meta.url);
const ORG_ID = `org_${"a".repeat(32)}`;

let tmpRoot: string;
let database: Database;

async function seedWorkspace(): Promise<string> {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, unknown>;
  return new WorkspaceStore(database).save(WorkspaceSchema.parse(fixture.workspace)).id;
}

function seedOrg(workspaceId: string, level: AutonomyLevel): void {
  new OrganizationStore(database).save(
    OrganizationSchema.parse({
      id: ORG_ID,
      workspace_id: workspaceId,
      name: "Org",
      mission: "Earn autonomy through a supervised track record.",
      autonomy_level: level,
    }),
  );
}

function recordVerifiedApplies(workspaceId: string, count: number): void {
  const events = new EventStore(database);
  for (let index = 0; index < count; index += 1) {
    events.append({
      workspace_id: workspaceId,
      kind: "org_change.verified",
      actor: "org_change_apply_service",
      payload: EventPayloadSchema.parse({ data: { index } }),
      idempotency_key: `verified:${index}`,
    });
  }
}

const evidence = [
  { kind: "event" as const, ref_id: newId("evt"), summary: "track record", weight: 1 },
];

function orgLevel(): AutonomyLevel {
  return new OrganizationStore(database).get(ORG_ID)?.autonomy_level ?? "advisory";
}

function eventKinds(workspaceId: string): string[] {
  return new EventStore(database).listForWorkspace(workspaceId).map((event) => event.kind);
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "openmao-ts-autonomy-"));
  database = new Database(join(tmpRoot, "openmao.sqlite3"));
  database.initialize();
});

afterEach(() => {
  database.close();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("M4 earned autonomy", () => {
  it("widens one step only via a human-ratified, evidence-backed case", async () => {
    const workspaceId = await seedWorkspace();
    seedOrg(workspaceId, "advisory");
    recordVerifiedApplies(workspaceId, 1);
    const service = new AutonomyService(database, { minTrackRecord: 1 });

    const proposed = service.proposeWidening({
      workspace_id: workspaceId,
      org_id: ORG_ID,
      proposed_by: "learning_service",
      rationale: "Three incident-free supervised applies.",
      evidence,
    });

    // Proposing NEVER moves the dial.
    expect(proposed.current_level).toBe("advisory");
    expect(proposed.proposed_level).toBe("supervised");
    expect(orgLevel()).toBe("advisory");

    const ratified = service.ratifyWidening(proposed.id, {
      workspace_id: workspaceId,
      actor: "operator",
    });

    expect(ratified.status).toBe("ratified");
    expect(ratified.ratified_by).toBe("operator");
    expect(orgLevel()).toBe("supervised");
    expect(eventKinds(workspaceId)).toEqual(
      expect.arrayContaining(["autonomy.widening_proposed", "autonomy.widened"]),
    );
  });

  it("refuses to widen without an audited track record", async () => {
    const workspaceId = await seedWorkspace();
    seedOrg(workspaceId, "advisory");
    // No verified applies recorded.
    expect(() =>
      new AutonomyService(database, { minTrackRecord: 3 }).proposeWidening({
        workspace_id: workspaceId,
        org_id: ORG_ID,
        proposed_by: "learning_service",
        rationale: "Premature.",
        evidence,
      }),
    ).toThrow(InsufficientTrackRecordError);
    expect(orgLevel()).toBe("advisory");
  });

  it("refuses to widen without an evidence packet", async () => {
    const workspaceId = await seedWorkspace();
    seedOrg(workspaceId, "advisory");
    recordVerifiedApplies(workspaceId, 5);
    expect(() =>
      new AutonomyService(database, { minTrackRecord: 1 }).proposeWidening({
        workspace_id: workspaceId,
        org_id: ORG_ID,
        proposed_by: "learning_service",
        rationale: "No evidence.",
        evidence: [],
      }),
    ).toThrow(InsufficientTrackRecordError);
  });

  it("refuses to widen beyond the configured ceiling", async () => {
    const workspaceId = await seedWorkspace();
    seedOrg(workspaceId, "advisory");
    recordVerifiedApplies(workspaceId, 5);
    // Ceiling pinned at advisory → a step to supervised is over the cap.
    expect(() =>
      new AutonomyService(database, { minTrackRecord: 1, maxLevel: "advisory" }).proposeWidening({
        workspace_id: workspaceId,
        org_id: ORG_ID,
        proposed_by: "learning_service",
        rationale: "Over the cap.",
        evidence,
      }),
    ).toThrow(AutonomyCapError);
  });

  it("refuses to widen past the top of the ladder", async () => {
    const workspaceId = await seedWorkspace();
    seedOrg(workspaceId, "bounded");
    recordVerifiedApplies(workspaceId, 5);
    expect(() =>
      new AutonomyService(database, { minTrackRecord: 1 }).proposeWidening({
        workspace_id: workspaceId,
        org_id: ORG_ID,
        proposed_by: "learning_service",
        rationale: "Already widest.",
        evidence,
      }),
    ).toThrow(AutonomyStepError);
  });

  it("refuses self-ratification (the proposer cannot ratify their own widening)", async () => {
    const workspaceId = await seedWorkspace();
    seedOrg(workspaceId, "advisory");
    recordVerifiedApplies(workspaceId, 1);
    const service = new AutonomyService(database, { minTrackRecord: 1 });
    const proposed = service.proposeWidening({
      workspace_id: workspaceId,
      org_id: ORG_ID,
      proposed_by: "agent_scribe",
      rationale: "Self-serving.",
      evidence,
    });

    expect(() =>
      service.ratifyWidening(proposed.id, { workspace_id: workspaceId, actor: "agent_scribe" }),
    ).toThrow(AutonomyRatificationError);
    expect(orgLevel()).toBe("advisory");
  });

  it("refuses to ratify when the dial drifted since the case was made (CAS)", async () => {
    const workspaceId = await seedWorkspace();
    seedOrg(workspaceId, "advisory");
    recordVerifiedApplies(workspaceId, 1);
    const service = new AutonomyService(database, { minTrackRecord: 1 });
    const proposed = service.proposeWidening({
      workspace_id: workspaceId,
      org_id: ORG_ID,
      proposed_by: "learning_service",
      rationale: "Will drift.",
      evidence,
    });

    // The dial moves out from under the case (e.g. another path widened it).
    new OrganizationStore(database).setAutonomyLevel(ORG_ID, {
      workspace_id: workspaceId,
      expected_level: "advisory",
      next_level: "supervised",
    });

    expect(() =>
      service.ratifyWidening(proposed.id, { workspace_id: workspaceId, actor: "operator" }),
    ).toThrow(AutonomyTransitionConflictError);
  });

  it("narrows (tightens) without a case — the safe direction", async () => {
    const workspaceId = await seedWorkspace();
    seedOrg(workspaceId, "bounded");

    const updated = new AutonomyService(database).narrow({
      workspace_id: workspaceId,
      org_id: ORG_ID,
      to_level: "advisory",
      actor: "operator",
      at: utcNow(),
    });

    expect(updated.autonomy_level).toBe("advisory");
    expect(eventKinds(workspaceId)).toContain("autonomy.narrowed");
  });
});
