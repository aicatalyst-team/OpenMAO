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
