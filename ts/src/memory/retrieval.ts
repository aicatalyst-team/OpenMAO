import type { MemoryEntry } from "../contracts/index.js";
import { CorroborationStore, type Database, MemoryEntryStore } from "../persistence/index.js";

export type MemorySearchFilters = {
  scope?: MemoryEntry["scope"];
  kind?: MemoryEntry["kind"];
  min_confidence?: number;
  limit?: number;
};

/**
 * The evidence that justifies reusing a piece of remembered knowledge: how
 * confident it is, how many independent sources corroborated its promotion, and
 * which promotion produced it (for collective memory).
 */
export type MemorySearchEvidence = {
  confidence: number;
  corroboration_count: number;
  source_promotion: string | null;
};

export type MemorySearchResult = {
  entry: MemoryEntry;
  score: number;
  matched_terms: string[];
  evidence: MemorySearchEvidence;
};

const DEFAULT_LIMIT = 50;
const TOKEN_PATTERN = /[a-z0-9]+/g;
const SOURCE_PROMOTION_PREFIX = "source_promotion:";

function uniqueTokens(text: string): Set<string> {
  return new Set(text.toLowerCase().match(TOKEN_PATTERN) ?? []);
}

/**
 * Deterministic, dependency-free retrieval over stored memory. Ranks entries by
 * query-term overlap, breaking ties by confidence, then corroboration evidence,
 * then id, so results are stable and reproducible without a search engine. Each
 * result carries the evidence (confidence, corroboration count, source
 * promotion) that justifies reusing the knowledge — turning memory from
 * write-only storage into a reusable, evidence-backed asset.
 */
export class MemoryRetrievalService {
  private readonly entries: MemoryEntryStore;
  private readonly corroborations: CorroborationStore;

  constructor(database: Database) {
    this.entries = new MemoryEntryStore(database);
    this.corroborations = new CorroborationStore(database);
  }

  search(
    workspaceId: string,
    query: string,
    filters: MemorySearchFilters = {},
  ): MemorySearchResult[] {
    const queryTerms = [...uniqueTokens(query)];
    if (queryTerms.length === 0) {
      return [];
    }

    const minConfidence = filters.min_confidence ?? 0;
    const limit =
      filters.limit !== undefined ? Math.max(0, Math.floor(filters.limit)) : DEFAULT_LIMIT;

    const results: MemorySearchResult[] = [];
    for (const entry of this.entries.listForWorkspace(workspaceId)) {
      if (filters.scope && entry.scope !== filters.scope) {
        continue;
      }
      if (filters.kind && entry.kind !== filters.kind) {
        continue;
      }
      if (entry.confidence < minConfidence) {
        continue;
      }

      const contentTokens = uniqueTokens(entry.content);
      const matched = queryTerms.filter((term) => contentTokens.has(term));
      if (matched.length === 0) {
        continue;
      }

      const evidence = this.evidenceFor(entry);
      results.push({
        entry,
        score: matched.length + entry.confidence,
        matched_terms: matched,
        evidence,
      });
    }

    results.sort((a, b) => {
      if (b.matched_terms.length !== a.matched_terms.length) {
        return b.matched_terms.length - a.matched_terms.length;
      }
      if (b.entry.confidence !== a.entry.confidence) {
        return b.entry.confidence - a.entry.confidence;
      }
      if (b.evidence.corroboration_count !== a.evidence.corroboration_count) {
        return b.evidence.corroboration_count - a.evidence.corroboration_count;
      }
      if (a.entry.id < b.entry.id) {
        return -1;
      }
      return a.entry.id > b.entry.id ? 1 : 0;
    });

    return results.slice(0, limit);
  }

  private evidenceFor(entry: MemoryEntry): MemorySearchEvidence {
    let sourcePromotion: string | null = null;
    let corroborationCount = 0;
    const note = entry.provenance.note;
    if (entry.scope === "collective" && note?.startsWith(SOURCE_PROMOTION_PREFIX)) {
      sourcePromotion = note.slice(SOURCE_PROMOTION_PREFIX.length);
      corroborationCount = this.corroborations.countForCandidate(sourcePromotion);
    }
    return {
      confidence: entry.confidence,
      corroboration_count: corroborationCount,
      source_promotion: sourcePromotion,
    };
  }
}
