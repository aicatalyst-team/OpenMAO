import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type Event,
  EventPayloadSchema,
  EventSchema,
  newId,
  WorkspaceSchema,
} from "../src/contracts/index.js";
import {
  ancestors,
  buildCausalGraph,
  type CausalEdge,
  type CausalGraph,
} from "../src/diagnosis/index.js";
import { Database, EventStore, WorkspaceStore } from "../src/persistence/index.js";

const fixturePath = new URL("../../tests/fixtures/canonical_v0.json", import.meta.url);

let tmpRoot: string;
let database: Database;

async function seedWorkspace(): Promise<string> {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Record<string, unknown>;
  const workspace = WorkspaceSchema.parse(fixture.workspace);
  return new WorkspaceStore(database).save(workspace).id;
}

function hasEdge(edges: CausalEdge[], kind: CausalEdge["kind"], from: string, to: string): boolean {
  return edges.some(
    (edge) => edge.kind === kind && edge.from_event_id === from && edge.to_event_id === to,
  );
}

function edgesOfKind(graph: CausalGraph, kind: CausalEdge["kind"]): CausalEdge[] {
  return graph.edges.filter((edge) => edge.kind === kind);
}

const WORKSPACE_FIXED = `ws_${"0".repeat(32)}`;
const agentA = { actor_type: "agent" as const, actor_id: "agent_a", display_name: null };
const agentB = { actor_type: "agent" as const, actor_id: "agent_b", display_name: null };

// Build an Event directly (bypassing the store) so a test can assign `seq` and craft
// references the append path can't express — e.g. an event that points at a *later*
// event. Mirrors how persisted events are shaped via `EventSchema`.
function makeEvent(input: {
  id: string;
  seq: number;
  kind?: string;
  payload?: Record<string, unknown>;
}): Event {
  return EventSchema.parse({
    id: input.id,
    workspace_id: WORKSPACE_FIXED,
    seq: input.seq,
    kind: input.kind ?? "test.event",
    actor: "spine",
    payload: EventPayloadSchema.parse(input.payload ?? {}),
    timestamp: "2026-01-01T00:00:00Z",
  });
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "openmao-ts-causal-"));
  database = new Database(join(tmpRoot, "openmao.sqlite3"));
  database.initialize();
});

afterEach(() => {
  database.close();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("M0 causal-graph constructibility", () => {
  it("builds sequential, communication, and data-dependency edges from the recorded event log", async () => {
    const workspaceId = await seedWorkspace();
    const events = new EventStore(database);
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

    // Coordinator plans and produces a brief.
    const planned = events.append({
      workspace_id: workspaceId,
      kind: "work.planned",
      actor: "spine",
      payload: EventPayloadSchema.parse({ actor_ref: coordinator, produced_refs: ["brief_alpha"] }),
    });
    // Coordinator hands the work off (same actor → sequential edge from `planned`).
    const handoff = events.append({
      workspace_id: workspaceId,
      kind: "handoff.requested",
      actor: "spine",
      payload: EventPayloadSchema.parse({ actor_ref: coordinator }),
    });
    // Researcher receives the handoff (cross-actor causal parent → communication edge)
    // and consumes the brief (matches the producer → data-dependency edge).
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
    // Researcher fails (same actor → sequential edge from `received`).
    const failed = events.append({
      workspace_id: workspaceId,
      kind: "work.outcome_submitted",
      actor: "spine",
      payload: EventPayloadSchema.parse({ actor_ref: researcher, data: { status: "failed" } }),
    });

    const graph = buildCausalGraph(events.listForWorkspace(workspaceId));

    // All three AgentTrace edge types are present.
    expect(hasEdge(graph.edges, "sequential", planned.id, handoff.id)).toBe(true);
    expect(hasEdge(graph.edges, "sequential", received.id, failed.id)).toBe(true);
    expect(hasEdge(graph.edges, "communication", handoff.id, received.id)).toBe(true);
    expect(hasEdge(graph.edges, "data_dependency", planned.id, received.id)).toBe(true);

    // Backward tracing from the failure reaches the upstream root cause (the plan).
    const reached = ancestors(graph, failed.id);
    expect(reached.has(received.id)).toBe(true);
    expect(reached.has(handoff.id)).toBe(true);
    expect(reached.has(planned.id)).toBe(true);
  });

  it("loads a legacy stored row that predates the causal fields and builds zero edges", async () => {
    const workspaceId = await seedWorkspace();
    const events = new EventStore(database);

    // The event log is append-only, so a row can never be edited after the fact. To
    // exercise genuine pre-M0 data we build a valid event, physically strip the M0 keys
    // from its serialized payload, and INSERT that legacy-shaped row directly.
    const legacy = EventSchema.parse({
      id: newId("evt"),
      workspace_id: workspaceId,
      seq: 1,
      kind: "run.created",
      actor: "spine",
      payload: EventPayloadSchema.parse({}),
      timestamp: "2026-01-01T00:00:00Z",
    });
    const serialized = JSON.parse(JSON.stringify(legacy)) as { payload: Record<string, unknown> };
    for (const key of ["actor_ref", "produced_refs", "consumed_refs", "causal_parent_id"]) {
      delete serialized.payload[key];
    }
    expect(serialized.payload).not.toHaveProperty("actor_ref");
    database.connection
      .prepare(
        `INSERT INTO events (
          id, workspace_id, run_id, seq, run_seq, kind, actor, payload_json,
          timestamp, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        legacy.id,
        legacy.workspace_id,
        legacy.run_id,
        legacy.seq,
        legacy.run_seq,
        legacy.kind,
        legacy.actor,
        JSON.stringify(serialized),
        legacy.timestamp,
        legacy.idempotency_key,
      );

    // The legacy row still parses (defaults fill the missing keys) and yields a lone
    // node with zero edges — the instrumentation is purely additive on existing data.
    const loaded = events.listForWorkspace(workspaceId);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.payload.produced_refs).toEqual([]);
    expect(loaded[0]?.payload.actor_ref).toBeNull();
    const graph = buildCausalGraph(loaded);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(0);
  });

  it("rejects a communication edge to a causal parent that is not strictly earlier", () => {
    // `early` (seq 1) names `late` (seq 2) as its causal parent — a forward reference
    // an effect cannot have. The edge must be rejected.
    const lateId = newId("evt");
    const earlyId = newId("evt");
    const early = makeEvent({
      id: earlyId,
      seq: 1,
      payload: { actor_ref: agentA, causal_parent_id: lateId },
    });
    const late = makeEvent({ id: lateId, seq: 2, payload: { actor_ref: agentB } });

    const graph = buildCausalGraph([early, late]);
    expect(edgesOfKind(graph, "communication")).toHaveLength(0);
    // Backward-tracing the later event does not reach the spurious child.
    expect(ancestors(graph, lateId).has(earlyId)).toBe(false);
  });

  it("rejects a data-dependency edge from a producer that writes the ref later", () => {
    // Consumer at seq 1 reads "brief"; the only producer of "brief" is at seq 2.
    const consumer = makeEvent({
      id: newId("evt"),
      seq: 1,
      payload: { actor_ref: agentA, consumed_refs: ["brief"] },
    });
    const producer = makeEvent({
      id: newId("evt"),
      seq: 2,
      payload: { actor_ref: agentB, produced_refs: ["brief"] },
    });

    const graph = buildCausalGraph([consumer, producer]);
    expect(edgesOfKind(graph, "data_dependency")).toHaveLength(0);
  });

  it("collapses duplicate refs into a single data-dependency edge", () => {
    const producerId = newId("evt");
    const consumerId = newId("evt");
    const producer = makeEvent({
      id: producerId,
      seq: 1,
      payload: { actor_ref: agentA, produced_refs: ["brief", "brief"] },
    });
    const consumer = makeEvent({
      id: consumerId,
      seq: 2,
      payload: { actor_ref: agentB, consumed_refs: ["brief", "brief"] },
    });

    const graph = buildCausalGraph([producer, consumer]);
    const dataEdges = edgesOfKind(graph, "data_dependency");
    expect(dataEdges).toHaveLength(1);
    expect(dataEdges[0]).toMatchObject({
      from_event_id: producerId,
      to_event_id: consumerId,
      via: "brief",
    });
  });

  it("excludes the seed from its own ancestors and terminates on a malformed cyclic graph", () => {
    const a = newId("evt");
    const b = newId("evt");
    // A cycle a → b → a that the forward-only builder would never emit; `ancestors`
    // must still terminate and honour strict-ancestor semantics.
    const cyclic: CausalGraph = {
      nodes: [a, b],
      edges: [
        { kind: "sequential", from_event_id: a, to_event_id: b, via: "x" },
        { kind: "sequential", from_event_id: b, to_event_id: a, via: "x" },
      ],
    };

    const reached = ancestors(cyclic, a);
    expect(reached.has(b)).toBe(true);
    expect(reached.has(a)).toBe(false);
  });
});
