import {
  type Capability,
  type CapabilityCall,
  CapabilityCallSchema,
  type CapabilityResult,
  CapabilityResultSchema,
  CapabilitySchema,
} from "../contracts/index.js";
import type { Database } from "./database.js";
import { dumpJson, jsonEqual } from "./serialization.js";

type PayloadRow = { payload_json: string };

export class CapabilityConflictError extends Error {}
export class CapabilityCallConflictError extends Error {}
export class CapabilityResultConflictError extends Error {}

export class CapabilityStore {
  constructor(private readonly database: Database) {}

  save(capability: Capability): Capability {
    const parsed = CapabilitySchema.parse(capability);

    return this.database.transaction(() => {
      const existing = this.get(parsed.workspace_id, parsed.name);
      if (existing) {
        if (jsonEqual(existing, parsed)) {
          return existing;
        }

        throw new CapabilityConflictError(
          `capability already exists: ${parsed.workspace_id}/${parsed.name}`,
        );
      }

      this.database.connection
        .prepare(
          `INSERT INTO capabilities (workspace_id, name, payload_json)
           VALUES (?, ?, ?)`,
        )
        .run(parsed.workspace_id, parsed.name, dumpJson(parsed));
      return parsed;
    });
  }

  get(workspaceId: string, name: string): Capability | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM capabilities WHERE workspace_id = ? AND name = ?")
      .get(workspaceId, name) as PayloadRow | undefined;

    return row ? CapabilitySchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listForWorkspace(workspaceId: string): Capability[] {
    const rows = this.database.connection
      .prepare("SELECT payload_json FROM capabilities WHERE workspace_id = ? ORDER BY name")
      .all(workspaceId) as PayloadRow[];

    return rows.map((row) => CapabilitySchema.parse(JSON.parse(row.payload_json)));
  }
}

export class CapabilityCallStore {
  constructor(private readonly database: Database) {}

  record(call: CapabilityCall): CapabilityCall {
    const parsed = CapabilityCallSchema.parse(call);

    return this.database.transaction(() => {
      const existing = this.getByIdempotencyKey(parsed.workspace_id, parsed.idempotency_key);
      if (existing) {
        if (jsonEqual(existing, parsed)) {
          return existing;
        }

        throw new CapabilityCallConflictError(
          "capability call idempotency key was reused for a different call",
        );
      }

      this.database.connection
        .prepare(
          `INSERT INTO capability_calls (
            id, workspace_id, run_id, capability_name, idempotency_key, payload_json
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          parsed.id,
          parsed.workspace_id,
          parsed.run_id,
          parsed.capability_name,
          parsed.idempotency_key,
          dumpJson(parsed),
        );
      return parsed;
    });
  }

  get(callId: string): CapabilityCall | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM capability_calls WHERE id = ?")
      .get(callId) as PayloadRow | undefined;

    return row ? CapabilityCallSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  getByIdempotencyKey(workspaceId: string, idempotencyKey: string): CapabilityCall | null {
    const row = this.database.connection
      .prepare(
        `SELECT payload_json
         FROM capability_calls
         WHERE workspace_id = ? AND idempotency_key = ?`,
      )
      .get(workspaceId, idempotencyKey) as PayloadRow | undefined;

    return row ? CapabilityCallSchema.parse(JSON.parse(row.payload_json)) : null;
  }
}

export class CapabilityResultStore {
  constructor(private readonly database: Database) {}

  record(result: CapabilityResult): CapabilityResult {
    const parsed = CapabilityResultSchema.parse(result);

    return this.database.transaction(() => {
      const existing = this.getForCall(parsed.workspace_id, parsed.call_id);
      if (existing) {
        if (jsonEqual(existing, parsed)) {
          return existing;
        }

        throw new CapabilityResultConflictError(
          `capability result already exists for call: ${parsed.call_id}`,
        );
      }

      this.database.connection
        .prepare(
          `INSERT INTO capability_results (
            id, workspace_id, run_id, call_id, node_effect_id, payload_json
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          parsed.id,
          parsed.workspace_id,
          parsed.run_id,
          parsed.call_id,
          parsed.node_effect_id,
          dumpJson(parsed),
        );
      return parsed;
    });
  }

  get(resultId: string): CapabilityResult | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM capability_results WHERE id = ?")
      .get(resultId) as PayloadRow | undefined;

    return row ? CapabilityResultSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  getForCall(workspaceId: string, callId: string): CapabilityResult | null {
    const row = this.database.connection
      .prepare(
        `SELECT payload_json
         FROM capability_results
         WHERE workspace_id = ? AND call_id = ?`,
      )
      .get(workspaceId, callId) as PayloadRow | undefined;

    return row ? CapabilityResultSchema.parse(JSON.parse(row.payload_json)) : null;
  }
}
