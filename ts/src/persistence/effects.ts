import { type NodeEffect, NodeEffectSchema } from "../contracts/index.js";
import type { Database } from "./database.js";
import { dumpJson } from "./serialization.js";

type PayloadRow = { payload_json: string };

export class NodeEffectConflictError extends Error {}

export class NodeEffectStore {
  constructor(private readonly database: Database) {}

  record(effect: NodeEffect): NodeEffect {
    const parsed = NodeEffectSchema.parse(effect);

    return this.database.transaction(() => {
      const existing = this.getByKey(parsed.run_id, parsed.node, parsed.idempotency_key);
      if (existing) {
        if (
          existing.workspace_id !== parsed.workspace_id ||
          existing.effect_type !== parsed.effect_type ||
          existing.effect_ref !== parsed.effect_ref ||
          existing.content_hash !== parsed.content_hash
        ) {
          throw new NodeEffectConflictError(
            "node effect idempotency key reused for a different effect",
          );
        }
        return existing;
      }

      this.database.connection
        .prepare(
          `INSERT INTO node_effects (
            id, workspace_id, run_id, node, idempotency_key, effect_type, effect_ref,
            content_hash, created_at, payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          parsed.id,
          parsed.workspace_id,
          parsed.run_id,
          parsed.node,
          parsed.idempotency_key,
          parsed.effect_type,
          parsed.effect_ref,
          parsed.content_hash,
          parsed.created_at,
          dumpJson(parsed),
        );
      return parsed;
    });
  }

  get(effectId: string): NodeEffect | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM node_effects WHERE id = ?")
      .get(effectId) as PayloadRow | undefined;

    return row ? NodeEffectSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  getByKey(runId: string, node: string, idempotencyKey: string): NodeEffect | null {
    const row = this.database.connection
      .prepare(
        `SELECT payload_json
         FROM node_effects
         WHERE run_id = ? AND node = ? AND idempotency_key = ?`,
      )
      .get(runId, node, idempotencyKey) as PayloadRow | undefined;

    return row ? NodeEffectSchema.parse(JSON.parse(row.payload_json)) : null;
  }
}
