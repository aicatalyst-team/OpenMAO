import type { Event } from "../contracts/index.js";

export type CausalEdgeKind = "sequential" | "communication" | "data_dependency";

export type CausalEdge = {
  kind: CausalEdgeKind;
  from_event_id: string;
  to_event_id: string;
  // Why this edge exists, for explainability: the actor id, the parent event id, or
  // the shared data ref.
  via: string;
};

export type CausalGraph = {
  nodes: string[];
  edges: CausalEdge[];
};

/**
 * Build the three M3 causal edge types from an enriched event log (AgentTrace's
 * schema). This is the M0 deliverable: proof that the instrumented `EventPayload`
 * makes the edges *constructible*. The M3 milestone layers backward tracing and
 * counterfactual screening on top of this graph; it does not change the edges.
 *
 *   - sequential:      consecutive events by the same `actor_ref.actor_id`
 *   - communication:   `causal_parent_id` linking a receiver's event to a prior
 *                      event emitted by a *different* actor (a handoff/message)
 *   - data_dependency: a consumer's `consumed_refs` matching an earlier producer's
 *                      `produced_refs`
 */
export function buildCausalGraph(events: Event[]): CausalGraph {
  const ordered = [...events].sort((left, right) => left.seq - right.seq);
  const nodes = ordered.map((event) => event.id);
  const byId = new Map(ordered.map((event) => [event.id, event]));

  const edges: CausalEdge[] = [];
  // Collapse structurally-identical edges (e.g. a ref written twice, or duplicate
  // refs on one event) so each causal relationship is represented exactly once.
  const seenEdges = new Set<string>();
  const addEdge = (kind: CausalEdgeKind, from: string, to: string, via: string): void => {
    const key = JSON.stringify([kind, from, to, via]);
    if (seenEdges.has(key)) {
      return;
    }
    seenEdges.add(key);
    edges.push({ kind, from_event_id: from, to_event_id: to, via });
  };

  // Sequential edges: same-actor consecutive actions. `ordered` is strictly
  // increasing in seq, so every edge points forward in time.
  const lastByActor = new Map<string, string>();
  for (const event of ordered) {
    const actorId = event.payload.actor_ref?.actor_id;
    if (!actorId) {
      continue;
    }
    const previous = lastByActor.get(actorId);
    if (previous) {
      addEdge("sequential", previous, event.id, actorId);
    }
    lastByActor.set(actorId, event.id);
  }

  // Communication edges: an explicit causal parent emitted EARLIER by a DIFFERENT
  // actor (a handoff/message). An effect cannot precede its cause, so the parent
  // must be strictly earlier in seq — this rejects forward and self references.
  for (const event of ordered) {
    const parentId = event.payload.causal_parent_id;
    if (!parentId) {
      continue;
    }
    const parent = byId.get(parentId);
    if (!parent || parent.seq >= event.seq) {
      continue;
    }
    const actorId = event.payload.actor_ref?.actor_id;
    const parentActorId = parent.payload.actor_ref?.actor_id;
    if (actorId !== undefined && parentActorId !== undefined && actorId !== parentActorId) {
      addEdge("communication", parentId, event.id, parentId);
    }
  }

  // Data-dependency edges: a consumer reads a ref an EARLIER producer wrote. One
  // ordered pass resolves each event's consumes against producers seen so far (all
  // strictly earlier), then registers its own produces — so a producer that writes
  // the ref later can never become an ancestor of an earlier consumer.
  const producersByRef = new Map<string, string[]>();
  for (const event of ordered) {
    for (const ref of event.payload.consumed_refs) {
      for (const producerId of producersByRef.get(ref) ?? []) {
        if (producerId !== event.id) {
          addEdge("data_dependency", producerId, event.id, ref);
        }
      }
    }
    for (const ref of event.payload.produced_refs) {
      const producers = producersByRef.get(ref) ?? [];
      producers.push(event.id);
      producersByRef.set(ref, producers);
    }
  }

  return { nodes, edges };
}

/**
 * Backward reachability from a (failure) event — the seed M3 will backward-trace
 * over. Returns every event the given event causally depends on, transitively
 * (strict ancestors, excluding the seed itself). Because `buildCausalGraph` only
 * emits forward-in-seq edges the graph is acyclic, so the traversal terminates and
 * never revisits the seed; the `seen` guard additionally hardens against any
 * malformed (cyclic) input.
 */
export function ancestors(graph: CausalGraph, eventId: string): Set<string> {
  const incoming = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const parents = incoming.get(edge.to_event_id) ?? [];
    parents.push(edge.from_event_id);
    incoming.set(edge.to_event_id, parents);
  }

  const seen = new Set<string>();
  const stack: string[] = [eventId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }
    for (const parent of incoming.get(current) ?? []) {
      if (!seen.has(parent)) {
        seen.add(parent);
        stack.push(parent);
      }
    }
  }
  // Strict ancestors: well-formed (forward-only) graphs never route back to the seed,
  // but a malformed cyclic input could — never report the seed as its own ancestor.
  seen.delete(eventId);
  return seen;
}
