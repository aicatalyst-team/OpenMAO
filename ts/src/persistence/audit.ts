import { type Artifact, ArtifactSchema, type Trace, TraceSchema } from "../contracts/index.js";
import type { Database } from "./database.js";
import { dumpJson, jsonEqual } from "./serialization.js";

type PayloadRow = { payload_json: string };

export class ArtifactConflictError extends Error {}
export class TraceConflictError extends Error {}

export class ArtifactStore {
  constructor(private readonly database: Database) {}

  save(artifact: Artifact): Artifact {
    const parsed = ArtifactSchema.parse(artifact);
    return this.database.transaction(() => {
      const existing = this.get(parsed.id);
      if (existing) {
        if (jsonEqual(existing, parsed)) {
          return existing;
        }
        throw new ArtifactConflictError(`artifact already exists: ${parsed.id}`);
      }
      this.database.connection
        .prepare(
          `INSERT INTO artifacts (
            id, workspace_id, task_id, content_ref, content_hash, payload_json
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          parsed.id,
          parsed.workspace_id,
          parsed.task_id,
          parsed.content_ref,
          parsed.content_hash,
          dumpJson(parsed),
        );
      return parsed;
    });
  }

  get(artifactId: string): Artifact | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM artifacts WHERE id = ?")
      .get(artifactId) as PayloadRow | undefined;
    return row ? ArtifactSchema.parse(JSON.parse(row.payload_json)) : null;
  }
}

export class TraceStore {
  constructor(private readonly database: Database) {}

  save(trace: Trace): Trace {
    const parsed = TraceSchema.parse(trace);
    return this.database.transaction(() => {
      const existing = this.get(parsed.id);
      if (existing) {
        if (
          existing.workspace_id === parsed.workspace_id &&
          existing.run_id === parsed.run_id &&
          existing.node === parsed.node
        ) {
          const eventIds = [...new Set([...existing.event_ids, ...parsed.event_ids])];
          if (jsonEqual(eventIds, existing.event_ids)) {
            return existing;
          }
          const merged = TraceSchema.parse({ ...existing, event_ids: eventIds });
          this.database.connection
            .prepare("UPDATE traces SET payload_json = ? WHERE id = ?")
            .run(dumpJson(merged), merged.id);
          return merged;
        }
        throw new TraceConflictError(`trace already exists: ${parsed.id}`);
      }
      this.database.connection
        .prepare(
          `INSERT INTO traces (id, workspace_id, run_id, node, timestamp, payload_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          parsed.id,
          parsed.workspace_id,
          parsed.run_id,
          parsed.node,
          parsed.timestamp,
          dumpJson(parsed),
        );
      return parsed;
    });
  }

  get(traceId: string): Trace | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM traces WHERE id = ?")
      .get(traceId) as PayloadRow | undefined;
    return row ? TraceSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listForRun(runId: string): Trace[] {
    const rows = this.database.connection
      .prepare("SELECT payload_json FROM traces WHERE run_id = ? ORDER BY timestamp, id")
      .all(runId) as PayloadRow[];
    return rows.map((row) => TraceSchema.parse(JSON.parse(row.payload_json)));
  }
}
