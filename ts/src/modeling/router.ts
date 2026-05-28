import { createHash } from "node:crypto";

import {
  CostSchema,
  type Event,
  EventPayloadSchema,
  type ModelRequest,
  ModelRequestSchema,
  type ModelResponse,
  ModelResponseSchema,
  newId,
  TraceSchema,
  utcNow,
} from "../contracts/index.js";
import {
  type Database,
  EventStore,
  ModelRequestStore,
  ModelResponseStore,
  RunStore,
  TraceStore,
} from "../persistence/index.js";

export class ModelRouterError extends Error {}

export class ModelRouterService {
  private readonly events: EventStore;
  private readonly requests: ModelRequestStore;
  private readonly responses: ModelResponseStore;
  private readonly runs: RunStore;
  private readonly traces: TraceStore;

  constructor(private readonly database: Database) {
    this.events = new EventStore(database);
    this.requests = new ModelRequestStore(database);
    this.responses = new ModelResponseStore(database);
    this.runs = new RunStore(database);
    this.traces = new TraceStore(database);
  }

  generate(request: ModelRequest, input: { output_ref?: string | null } = {}): ModelResponse {
    return this.complete(request, input);
  }

  complete(requestInput: ModelRequest, input: { output_ref?: string | null } = {}): ModelResponse {
    return this.database.transaction(() => {
      let request = ModelRequestSchema.parse(requestInput);
      const existingRequest = this.requests.getByIdempotencyKey(
        request.workspace_id,
        request.idempotency_key,
      );
      const existingResponse = existingRequest
        ? this.responses.getForRequest(existingRequest.workspace_id, existingRequest.id)
        : null;
      if (!existingRequest || !existingResponse) {
        this.requireModelExecutableRun(request);
      }
      request = this.requests.record(request);
      const requestedEvent = this.emitRequested(request);
      const existing = this.responses.getForRequest(request.workspace_id, request.id);
      if (existing) {
        this.saveTrace(request, existing, requestedEvent);
        return existing;
      }

      const response = this.responses.record(
        ModelResponseSchema.parse({
          id: newId("modelres"),
          workspace_id: request.workspace_id,
          request_id: request.id,
          status: "ok",
          output_ref: input.output_ref ?? `mock:${request.purpose}`,
          cost: CostSchema.parse({ provider: "mock", model: request.model_binding }),
        }),
      );
      this.appendResponseEventAndTrace(request, response, requestedEvent);
      return response;
    });
  }

  fail(requestInput: ModelRequest, input: { error: string }): ModelResponse {
    return this.database.transaction(() => {
      let request = ModelRequestSchema.parse(requestInput);
      const existingRequest = this.requests.getByIdempotencyKey(
        request.workspace_id,
        request.idempotency_key,
      );
      const existingResponse = existingRequest
        ? this.responses.getForRequest(existingRequest.workspace_id, existingRequest.id)
        : null;
      if (!existingRequest || !existingResponse) {
        this.requireModelExecutableRun(request);
      }
      request = this.requests.record(request);
      const requestedEvent = this.emitRequested(request);
      const existing = this.responses.getForRequest(request.workspace_id, request.id);
      if (existing) {
        this.saveTrace(request, existing, requestedEvent);
        return existing;
      }

      const response = this.responses.record(
        ModelResponseSchema.parse({
          id: newId("modelres"),
          workspace_id: request.workspace_id,
          request_id: request.id,
          status: "failed",
          error: input.error,
          cost: CostSchema.parse({ provider: "mock", model: request.model_binding }),
        }),
      );
      this.appendResponseEventAndTrace(request, response, requestedEvent);
      return response;
    });
  }

  private requireModelExecutableRun(request: ModelRequest): void {
    if (!request.run_id) {
      return;
    }
    const run = this.runs.get(request.run_id);
    if (!run) {
      throw new ModelRouterError(`run not found: ${request.run_id}`);
    }
    if (run.workspace_id !== request.workspace_id) {
      throw new ModelRouterError(`run does not belong to workspace: ${request.run_id}`);
    }
    if (run.status !== "running") {
      throw new ModelRouterError(`run must be running before model request: ${request.run_id}`);
    }
  }

  private emitRequested(request: ModelRequest): Event {
    return this.events.append({
      workspace_id: request.workspace_id,
      run_id: request.run_id,
      kind: "model.requested",
      actor: "model_router",
      payload: EventPayloadSchema.parse({ data: { model_request: request }, refs: [request.id] }),
      idempotency_key: `${request.id}:requested`,
    });
  }

  private appendResponseEventAndTrace(
    request: ModelRequest,
    response: ModelResponse,
    requestedEvent: Event,
  ): Event {
    const responseEvent = this.events.append({
      workspace_id: response.workspace_id,
      run_id: request.run_id,
      kind: response.status === "ok" ? "model.completed" : "model.failed",
      actor: "model_router",
      payload: EventPayloadSchema.parse({
        data: { model_response: response },
        refs: [response.id],
      }),
      idempotency_key: this.responseEventKey(request, response),
    });
    this.saveTrace(request, response, requestedEvent);
    return responseEvent;
  }

  private saveTrace(request: ModelRequest, response: ModelResponse, requestedEvent: Event): void {
    if (!request.run_id) {
      return;
    }
    let responseEvent = this.events.getByIdempotencyKey(
      request.workspace_id,
      this.responseEventKey(request, response),
    );
    if (!responseEvent) {
      responseEvent = this.appendResponseEventAndTrace(request, response, requestedEvent);
    }
    this.traces.save(
      TraceSchema.parse({
        id: `trace_${createHash("sha256").update(request.id).digest("hex").slice(0, 32)}`,
        workspace_id: request.workspace_id,
        run_id: request.run_id,
        node: `model:${request.purpose}`,
        inputs_ref: request.input_ref,
        outputs_ref: response.output_ref,
        cost: response.cost,
        timestamp: responseEvent.timestamp ?? utcNow(),
        event_ids: [requestedEvent.id, responseEvent.id],
      }),
    );
  }

  private responseEventKey(request: ModelRequest, response: ModelResponse): string {
    return `${request.id}:${response.status === "ok" ? "completed" : "failed"}`;
  }
}
