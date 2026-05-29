import { type Cadence, CadenceSchema } from "../contracts/index.js";
import type { Database } from "./database.js";
import { dumpJson, jsonEqual } from "./serialization.js";

type PayloadRow = { payload_json: string };

export class CadenceConflictError extends Error {}

/**
 * Stores Chief of Staff cadences (standing obligations). Cadences are
 * organization-of-record objects, not agent-local state: any worker can read or
 * advance them, and they survive swapping the Chief of Staff out.
 */
export class CadenceStore {
  constructor(private readonly database: Database) {}

  save(cadence: Cadence): Cadence {
    const parsed = CadenceSchema.parse(cadence);
    return this.database.transaction(() => {
      const existing = this.get(parsed.id);
      if (existing) {
        if (jsonEqual(existing, parsed)) {
          return existing;
        }
        throw new CadenceConflictError(`cadence already exists: ${parsed.id}`);
      }
      this.database.connection
        .prepare(
          `INSERT INTO cadences (id, workspace_id, enabled, next_due_at, payload_json)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          parsed.id,
          parsed.workspace_id,
          parsed.enabled ? 1 : 0,
          parsed.next_due_at,
          dumpJson(parsed),
        );
      return parsed;
    });
  }

  get(cadenceId: string): Cadence | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM cadences WHERE id = ?")
      .get(cadenceId) as PayloadRow | undefined;
    return row ? CadenceSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listForWorkspace(workspaceId: string): Cadence[] {
    const rows = this.database.connection
      .prepare("SELECT payload_json FROM cadences WHERE workspace_id = ? ORDER BY id")
      .all(workspaceId) as PayloadRow[];
    return rows.map((row) => CadenceSchema.parse(JSON.parse(row.payload_json)));
  }

  // Due cadences are enabled and have a next_due_at at or before `at`. `at` is an
  // explicit recorded time, never an ambient clock read, so listing is replayable.
  listDue(workspaceId: string, at: string): Cadence[] {
    const rows = this.database.connection
      .prepare(
        `SELECT payload_json FROM cadences
         WHERE workspace_id = ? AND enabled = 1 AND next_due_at <= ?
         ORDER BY id`,
      )
      .all(workspaceId, at) as PayloadRow[];
    return rows.map((row) => CadenceSchema.parse(JSON.parse(row.payload_json)));
  }

  advance(cadenceId: string, update: { last_fired_at: string; next_due_at: string }): Cadence {
    return this.database.transaction(() => {
      const current = this.get(cadenceId);
      if (!current) {
        throw new Error(`cadence not found: ${cadenceId}`);
      }
      const updated = CadenceSchema.parse({
        ...current,
        last_fired_at: update.last_fired_at,
        next_due_at: update.next_due_at,
      });
      this.database.connection
        .prepare("UPDATE cadences SET next_due_at = ?, payload_json = ? WHERE id = ?")
        .run(updated.next_due_at, dumpJson(updated), updated.id);
      return updated;
    });
  }

  setEnabled(cadenceId: string, enabled: boolean): Cadence {
    return this.database.transaction(() => {
      const current = this.get(cadenceId);
      if (!current) {
        throw new Error(`cadence not found: ${cadenceId}`);
      }
      const updated = CadenceSchema.parse({ ...current, enabled });
      this.database.connection
        .prepare("UPDATE cadences SET enabled = ?, payload_json = ? WHERE id = ?")
        .run(updated.enabled ? 1 : 0, dumpJson(updated), updated.id);
      return updated;
    });
  }
}
