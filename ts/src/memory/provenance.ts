import type { MemoryEntry } from "../contracts/index.js";
import type { CapabilityResultStore, EventStore } from "../persistence/index.js";

/**
 * Single source of truth for the `provenance.note` marker that links a
 * collective memory entry back to the promotion that produced it. The producer
 * (PromotionService) and the consumer (MemoryRetrievalService) must agree on
 * this format, so it lives here rather than as duplicated string literals.
 */
export const SOURCE_PROMOTION_PREFIX = "source_promotion:";

/** Builds the provenance note recorded on a collective memory entry. */
export function sourcePromotionNote(candidateId: string): string {
  return `${SOURCE_PROMOTION_PREFIX}${candidateId}`;
}

/**
 * Extracts the source promotion candidate id from a provenance note, or null if
 * the note is absent, not a source-promotion marker, or carries no id.
 */
export function parseSourcePromotion(note: string | null | undefined): string | null {
  if (!note || !note.startsWith(SOURCE_PROMOTION_PREFIX)) {
    return null;
  }
  const candidateId = note.slice(SOURCE_PROMOTION_PREFIX.length).trim();
  return candidateId.length > 0 ? candidateId : null;
}

/**
 * The provenance invariant (#113): unprovenanced memory stays untrusted.
 *
 * `guidance_eligible` memory can be recalled by agents, proposed as collective
 * guidance, and counted as corroborating evidence. `untrusted` memory is still
 * recorded — anything may be remembered — but it is excluded from every agent
 * surface and only reachable through the evented operator review path.
 */
export type MemoryTrust = "guidance_eligible" | "untrusted";

/** Which provenance ref made an entry guidance-eligible. */
export type MemoryTrustBasis = "capability_result" | "source_event" | "operator_attestation";

export type MemoryTrustDerivation = {
  trust: MemoryTrust;
  /** First ref (in precedence order) that resolved; null when untrusted. */
  basis: MemoryTrustBasis | null;
  /**
   * Trust markers that were supplied but did not resolve or validate
   * (forged or dangling), as `<kind>:<value>` strings. Distinguishes "the
   * writer claimed provenance the store could not honor" from "the writer
   * supplied no provenance at all" — only the former is an integrity signal.
   */
  unresolved: string[];
};

export type MemoryTrustStores = {
  events: EventStore;
  capabilityResults: CapabilityResultStore;
};

// A canonical agent id can never stand in as an operator attestor: attestation
// is the explicitly human path into guidance, not a second self-assertion lane.
const AGENT_ID_REGEX = /^agent_[0-9a-f]{32}$/;

/**
 * Derives the trust tier of a memory entry from its provenance refs. The tier
 * is computed, never writer-asserted: a ref only confers trust if the store
 * resolves it inside the entry's own workspace, in this precedence order:
 *
 * 1. `provenance.capability_result_id` resolves in the CapabilityResultStore;
 * 2. `provenance.source_event_id` resolves in the EventStore;
 * 3. `provenance.attested_by` names an operator (non-blank, not an agent id).
 *
 * All supplied markers are evaluated (no short-circuit) so the derivation also
 * reports every forged/dangling ref, even ones outranked by a resolving ref.
 */
export function deriveMemoryTrust(
  entry: MemoryEntry,
  stores: MemoryTrustStores,
): MemoryTrustDerivation {
  const unresolved: string[] = [];
  let basis: MemoryTrustBasis | null = null;

  const capabilityResultId = entry.provenance.capability_result_id;
  if (capabilityResultId) {
    const result = stores.capabilityResults.get(capabilityResultId);
    if (result && result.workspace_id === entry.workspace_id) {
      basis = "capability_result";
    } else {
      unresolved.push(`capability_result:${capabilityResultId}`);
    }
  }

  const sourceEventId = entry.provenance.source_event_id;
  if (sourceEventId) {
    const event = stores.events.get(sourceEventId);
    if (event && event.workspace_id === entry.workspace_id) {
      basis ??= "source_event";
    } else {
      unresolved.push(`source_event:${sourceEventId}`);
    }
  }

  const attestedBy = entry.provenance.attested_by;
  if (attestedBy !== null) {
    const attestor = attestedBy.trim();
    if (attestor.length > 0 && !AGENT_ID_REGEX.test(attestor)) {
      basis ??= "operator_attestation";
    } else {
      unresolved.push(`operator_attestation:${attestedBy}`);
    }
  }

  return basis
    ? { trust: "guidance_eligible", basis, unresolved }
    : { trust: "untrusted", basis: null, unresolved };
}
