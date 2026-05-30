import { EventPayloadSchema } from "../contracts/index.js";
import { type Database, EventStore } from "../persistence/index.js";
import { ancestors, buildCausalGraph, type CausalGraph } from "./causal-graph.js";

export type DiagnosisCandidate = {
  event_id: string;
  kind: string;
  actor_id: string | null;
  // How many upstream events become unreachable from the failure when this candidate is removed —
  // i.e. how load-bearing it is on the causal path to the failure (the counterfactual screen).
  counterfactual_score: number;
  // A source of the failure's causal cone: nothing upstream of it within the cone. The deepest cause.
  is_root: boolean;
};

export type Diagnosis = {
  workspace_id: string;
  failure_event_id: string;
  // Ranked most-load-bearing-first. The first candidate is the suggested root cause.
  candidates: DiagnosisCandidate[];
  note: string;
};

const ADVISORY_NOTE =
  "Advisory causal diagnosis (backward-trace + counterfactual screening over the event log). " +
  "Low reliability — a hint for a human to investigate, not a proposal. Gates nothing, applies nothing.";

export class DiagnosisServiceError extends Error {}

/**
 * Advisory causal diagnosis (M3). Given a failure event, it builds the M0 causal graph from the
 * event log, backward-traces the failure's causal ancestors, and counterfactually screens them —
 * for each ancestor, how much of the failure's causal cone collapses if that ancestor is removed.
 * The most load-bearing ancestor is the suggested root cause.
 *
 * It is **purely advisory**: it emits a `diagnosis.suggested` event and returns a ranked hint. It
 * never creates an org-change proposal, never applies, never touches the autonomy dial. Reliability
 * is low by design (the research frontier), so it is framed as a hint, not a verdict.
 */
export class DiagnosisService {
  private readonly events: EventStore;

  constructor(private readonly database: Database) {
    this.events = new EventStore(database);
  }

  diagnose(input: { workspace_id: string; failure_event_id: string }): Diagnosis {
    const workspace_id = input.workspace_id;
    const failureId = input.failure_event_id;
    return this.database.transaction(() => {
      const events = this.events.listForWorkspace(workspace_id);
      const failure = events.find((event) => event.id === failureId);
      if (!failure) {
        throw new DiagnosisServiceError(
          `failure event not found in workspace ${workspace_id}: ${failureId}`,
        );
      }
      const eventById = new Map(events.map((event) => [event.id, event]));
      const graph = buildCausalGraph(events);
      const incoming = buildIncoming(graph);
      const ancestorSet = ancestors(graph, failureId);
      const fullSize = ancestorSet.size;

      const candidates: DiagnosisCandidate[] = [...ancestorSet].map((id) => {
        const event = eventById.get(id);
        const withoutSize = ancestorsExcluding(incoming, failureId, id).size;
        // Ancestors that were only reachable via this candidate (excluding the candidate itself).
        const counterfactual = Math.max(0, fullSize - withoutSize - 1);
        const isRoot = !(incoming.get(id) ?? []).some((parent) => ancestorSet.has(parent));
        return {
          event_id: id,
          kind: event?.kind ?? "unknown",
          actor_id: event?.payload.actor_ref?.actor_id ?? null,
          counterfactual_score: counterfactual,
          is_root: isRoot,
        };
      });

      // Backward-trace to the origin: surface the deepest cause (a source of the failure's causal
      // cone) first, then the most load-bearing by the counterfactual screen, then the earliest.
      candidates.sort(
        (left, right) =>
          Number(right.is_root) - Number(left.is_root) ||
          right.counterfactual_score - left.counterfactual_score ||
          (eventById.get(left.event_id)?.seq ?? 0) - (eventById.get(right.event_id)?.seq ?? 0),
      );

      const top = candidates[0] ?? null;
      this.events.append({
        workspace_id,
        kind: "diagnosis.suggested",
        actor: "diagnosis_service",
        payload: EventPayloadSchema.parse({
          data: {
            failure_event_id: failureId,
            candidate_count: candidates.length,
            suggested_root_cause: top,
            reliability: "advisory",
          },
          refs: [failureId, ...candidates.slice(0, 5).map((candidate) => candidate.event_id)],
        }),
      });

      return { workspace_id, failure_event_id: failureId, candidates, note: ADVISORY_NOTE };
    });
  }
}

function buildIncoming(graph: CausalGraph): Map<string, string[]> {
  const incoming = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const parents = incoming.get(edge.to_event_id) ?? [];
    parents.push(edge.from_event_id);
    incoming.set(edge.to_event_id, parents);
  }
  return incoming;
}

/**
 * Backward reachability from `eventId` that never traverses into or through `excludeId` — i.e. the
 * failure's ancestors *as if* the excluded event had not happened. Comparing this against the full
 * ancestor set is the counterfactual screen.
 */
function ancestorsExcluding(
  incoming: Map<string, string[]>,
  eventId: string,
  excludeId: string,
): Set<string> {
  const seen = new Set<string>();
  const stack: string[] = [eventId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }
    for (const parent of incoming.get(current) ?? []) {
      if (parent === excludeId || seen.has(parent)) {
        continue;
      }
      seen.add(parent);
      stack.push(parent);
    }
  }
  seen.delete(eventId);
  return seen;
}
