import {
  type Corroboration,
  CorroborationSchema,
  type MemoryEntry,
  MemoryEntrySchema,
  type PromotionCandidate,
  PromotionCandidateSchema,
  utcNow,
} from "../contracts/index.js";
import type { Database } from "./database.js";
import { dumpJson, jsonEqual } from "./serialization.js";

export type PromotionStatus = "pending" | "ratified" | "rejected";
type PayloadRow = { payload_json: string };

export class MemoryEntryConflictError extends Error {}
export class PromotionCandidateConflictError extends Error {}
export class CorroborationConflictError extends Error {}

export class MemoryEntryStore {
  constructor(private readonly database: Database) {}

  save(entry: MemoryEntry): MemoryEntry {
    const parsed = MemoryEntrySchema.parse(entry);
    return this.database.transaction(() => {
      const existing = this.get(parsed.id);
      if (existing) {
        if (jsonEqual(existing, parsed)) {
          return existing;
        }
        throw new MemoryEntryConflictError(`memory entry already exists: ${parsed.id}`);
      }
      this.database.connection
        .prepare(
          `INSERT INTO individual_memory (id, workspace_id, owner_id, payload_json)
           VALUES (?, ?, ?, ?)`,
        )
        .run(parsed.id, parsed.workspace_id, parsed.owner_id, dumpJson(parsed));
      return parsed;
    });
  }

  get(entryId: string): MemoryEntry | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM individual_memory WHERE id = ?")
      .get(entryId) as PayloadRow | undefined;
    return row ? MemoryEntrySchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listForWorkspace(workspaceId: string): MemoryEntry[] {
    const rows = this.database.connection
      .prepare("SELECT payload_json FROM individual_memory WHERE workspace_id = ? ORDER BY id")
      .all(workspaceId) as PayloadRow[];
    return rows.map((row) => MemoryEntrySchema.parse(JSON.parse(row.payload_json)));
  }
}

export class PromotionCandidateStore {
  constructor(private readonly database: Database) {}

  save(candidate: PromotionCandidate): PromotionCandidate {
    const parsed = PromotionCandidateSchema.parse(candidate);
    if (parsed.status !== "pending") {
      throw new PromotionCandidateConflictError(
        "new promotion candidates must be saved as pending",
      );
    }

    return this.database.transaction(() => {
      const existing = this.get(parsed.id);
      if (existing) {
        if (jsonEqual(existing, parsed)) {
          return existing;
        }
        throw new PromotionCandidateConflictError(
          `promotion candidate already exists: ${parsed.id}`,
        );
      }
      this.database.connection
        .prepare(
          `INSERT INTO promotion_candidates (id, workspace_id, status, payload_json)
           VALUES (?, ?, ?, ?)`,
        )
        .run(parsed.id, parsed.workspace_id, parsed.status, dumpJson(parsed));
      return parsed;
    });
  }

  get(candidateId: string): PromotionCandidate | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM promotion_candidates WHERE id = ?")
      .get(candidateId) as PayloadRow | undefined;
    return row ? PromotionCandidateSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listForWorkspace(workspaceId: string): PromotionCandidate[] {
    const rows = this.database.connection
      .prepare(
        `SELECT payload_json
         FROM promotion_candidates
         WHERE workspace_id = ?
         ORDER BY id`,
      )
      .all(workspaceId) as PayloadRow[];
    return rows.map((row) => PromotionCandidateSchema.parse(JSON.parse(row.payload_json)));
  }

  setStatus(
    candidateId: string,
    status: PromotionStatus,
    options: { resolved_at?: string | null } = {},
  ): PromotionCandidate {
    if (status === "pending") {
      throw new PromotionCandidateConflictError(
        "saved promotion candidates cannot be reset to pending",
      );
    }

    return this.database.transaction(() => {
      const current = this.get(candidateId);
      if (!current) {
        throw new Error(`promotion candidate not found: ${candidateId}`);
      }
      if (current.status === "ratified" || current.status === "rejected") {
        if (current.status === status) {
          return current;
        }
        throw new PromotionCandidateConflictError(
          `promotion candidate already resolved as ${current.status}: ${candidateId}`,
        );
      }

      const updated = PromotionCandidateSchema.parse({
        ...current,
        status,
        resolved_at: options.resolved_at ?? utcNow(),
      });
      this.database.connection
        .prepare("UPDATE promotion_candidates SET status = ?, payload_json = ? WHERE id = ?")
        .run(updated.status, dumpJson(updated), updated.id);
      return updated;
    });
  }

  setCorroborationCount(candidateId: string, count: number): PromotionCandidate {
    return this.database.transaction(() => {
      const current = this.get(candidateId);
      if (!current) {
        throw new Error(`promotion candidate not found: ${candidateId}`);
      }
      if (current.status !== "pending") {
        throw new PromotionCandidateConflictError(
          `cannot corroborate a resolved promotion candidate: ${candidateId}`,
        );
      }
      const updated = PromotionCandidateSchema.parse({ ...current, corroboration_count: count });
      this.database.connection
        .prepare("UPDATE promotion_candidates SET payload_json = ? WHERE id = ?")
        .run(dumpJson(updated), updated.id);
      return updated;
    });
  }
}

export class CorroborationStore {
  constructor(private readonly database: Database) {}

  save(corroboration: Corroboration): Corroboration {
    const parsed = CorroborationSchema.parse(corroboration);
    return this.database.transaction(() => {
      const existing = this.get(parsed.id);
      if (existing) {
        if (jsonEqual(existing, parsed)) {
          return existing;
        }
        throw new CorroborationConflictError(`corroboration already exists: ${parsed.id}`);
      }
      this.database.connection
        .prepare(
          `INSERT INTO promotion_corroborations (id, workspace_id, candidate_id, source_memory_entry, payload_json)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          parsed.id,
          parsed.workspace_id,
          parsed.candidate_id,
          parsed.source_memory_entry,
          dumpJson(parsed),
        );
      return parsed;
    });
  }

  get(corroborationId: string): Corroboration | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM promotion_corroborations WHERE id = ?")
      .get(corroborationId) as PayloadRow | undefined;
    return row ? CorroborationSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listForCandidate(candidateId: string): Corroboration[] {
    const rows = this.database.connection
      .prepare(
        `SELECT payload_json
         FROM promotion_corroborations
         WHERE candidate_id = ?
         ORDER BY id`,
      )
      .all(candidateId) as PayloadRow[];
    return rows.map((row) => CorroborationSchema.parse(JSON.parse(row.payload_json)));
  }

  countForCandidate(candidateId: string): number {
    const row = this.database.connection
      .prepare("SELECT COUNT(*) AS n FROM promotion_corroborations WHERE candidate_id = ?")
      .get(candidateId) as { n: number };
    return row.n;
  }
}
