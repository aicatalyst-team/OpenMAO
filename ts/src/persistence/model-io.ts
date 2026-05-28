import {
  type ModelRequest,
  ModelRequestSchema,
  type ModelResponse,
  ModelResponseSchema,
} from "../contracts/index.js";
import type { Database } from "./database.js";
import { dumpJson, jsonEqual } from "./serialization.js";

type PayloadRow = { payload_json: string };

export class ModelRequestConflictError extends Error {}
export class ModelResponseConflictError extends Error {}

export class ModelRequestStore {
  constructor(private readonly database: Database) {}

  record(request: ModelRequest): ModelRequest {
    const parsed = ModelRequestSchema.parse(request);
    return this.database.transaction(() => {
      const existing = this.getByIdempotencyKey(parsed.workspace_id, parsed.idempotency_key);
      if (existing) {
        if (jsonEqual(existing, parsed)) {
          return existing;
        }
        throw new ModelRequestConflictError(
          "model request idempotency key was reused for a different request",
        );
      }
      this.database.connection
        .prepare(
          `INSERT INTO model_requests (id, workspace_id, run_id, idempotency_key, payload_json)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          parsed.id,
          parsed.workspace_id,
          parsed.run_id,
          parsed.idempotency_key,
          dumpJson(parsed),
        );
      return parsed;
    });
  }

  get(requestId: string): ModelRequest | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM model_requests WHERE id = ?")
      .get(requestId) as PayloadRow | undefined;
    return row ? ModelRequestSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  getByIdempotencyKey(workspaceId: string, idempotencyKey: string): ModelRequest | null {
    const row = this.database.connection
      .prepare(
        `SELECT payload_json
         FROM model_requests
         WHERE workspace_id = ? AND idempotency_key = ?`,
      )
      .get(workspaceId, idempotencyKey) as PayloadRow | undefined;
    return row ? ModelRequestSchema.parse(JSON.parse(row.payload_json)) : null;
  }
}

export class ModelResponseStore {
  constructor(private readonly database: Database) {}

  record(response: ModelResponse): ModelResponse {
    const parsed = ModelResponseSchema.parse(response);
    return this.database.transaction(() => {
      const existing = this.getForRequest(parsed.workspace_id, parsed.request_id);
      if (existing) {
        if (jsonEqual(existing, parsed)) {
          return existing;
        }
        throw new ModelResponseConflictError(
          `model response already exists for request: ${parsed.request_id}`,
        );
      }
      this.database.connection
        .prepare(
          `INSERT INTO model_responses (id, workspace_id, request_id, payload_json)
           VALUES (?, ?, ?, ?)`,
        )
        .run(parsed.id, parsed.workspace_id, parsed.request_id, dumpJson(parsed));
      return parsed;
    });
  }

  get(responseId: string): ModelResponse | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM model_responses WHERE id = ?")
      .get(responseId) as PayloadRow | undefined;
    return row ? ModelResponseSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  getForRequest(workspaceId: string, requestId: string): ModelResponse | null {
    const row = this.database.connection
      .prepare(
        `SELECT payload_json
         FROM model_responses
         WHERE workspace_id = ? AND request_id = ?`,
      )
      .get(workspaceId, requestId) as PayloadRow | undefined;
    return row ? ModelResponseSchema.parse(JSON.parse(row.payload_json)) : null;
  }
}
