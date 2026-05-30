import { randomBytes } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import { ChiefOfStaffService } from "../chief_of_staff/index.js";
import { utcNow } from "../contracts/index.js";
import { ApprovalService } from "../governance/index.js";
import { IngestionService } from "../ingestion/index.js";
import { LearningService } from "../learning/index.js";
import { OrgChangeService } from "../org/index.js";
import {
  AgentStore,
  BoundedWorkEnvelopeStore,
  CapabilityCallStore,
  CapabilityResultStore,
  CapabilityStore,
  type Database,
  EventStore,
  IngestionRecordStore,
  MemoryEntryStore,
  OrganizationStore,
  OrgChangeProposalStore,
  PromotionCandidateStore,
  RoleStore,
  RunStore,
  TraceStore,
  WorkerIdentityStore,
  WorkerOutcomeStore,
  WorkItemStore,
  WorkspaceStore,
} from "../persistence/index.js";
import { createApprovalServiceWithApplications } from "../runtime/approvals.js";
import {
  createConfiguredCapabilityRegistry,
  materializeRejectedCapabilityApproval,
} from "../runtime/capabilities.js";
import { openLocalDatabase } from "../runtime/local.js";
import {
  COORDINATOR_AGENT_ID,
  PROMOTION_APPROVAL_ID,
  RUN_ID,
  SpineService,
  WORKSPACE_ID,
} from "../spine/index.js";
import { WorkService } from "../work/index.js";
import {
  approveReferenceWorkerDemo,
  REFERENCE_RUN_ID,
  runReferenceWorkerDemo,
} from "../workers/index.js";
import { WorldModelService } from "../world/index.js";

type ServerOptions = {
  dbPath?: string;
  operatorToken?: string;
  workspaceId?: string;
};

const DEFAULT_HTTP_HOST = "127.0.0.1";
const TOKEN_HEADER = "x-openmao-operator-token";
const ACTOR_HEADER = "x-openmao-actor";
const WORKSPACE_HEADER = "x-openmao-workspace";
const LEGACY_WORKSPACE_HEADER = "x-openmao-workspace-id";
const CONSOLE_ACTOR = "local_operator";

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value, null, 2));
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

function sendNotFound(response: ServerResponse): void {
  sendJson(response, 404, { error: "not_found" });
}

function routePattern(pathname: string): {
  approvalId: string | undefined;
  cosNotificationReadId: string | undefined;
  individualMemoryAgentId: string | undefined;
  learningProposalApplyId: string | undefined;
  learningProposalId: string | undefined;
  runEventsId: string | undefined;
  runId: string | undefined;
  runResumeId: string | undefined;
  runTracesId: string | undefined;
  workEnvelopeId: string | undefined;
  workId: string | undefined;
  workOutcomeId: string | undefined;
  workspaceEventsId: string | undefined;
} {
  const approvalMatch = /^\/approvals\/([^/]+)\/(?:approve|reject)$/.exec(pathname);
  const cosNotificationReadMatch = /^\/cos\/notifications\/([^/]+)\/read$/.exec(pathname);
  const runEventsMatch = /^\/runs\/([^/]+)\/events$/.exec(pathname);
  const runResumeMatch = /^\/runs\/([^/]+)\/resume$/.exec(pathname);
  const runTracesMatch = /^\/runs\/([^/]+)\/traces$/.exec(pathname);
  const runMatch = /^\/runs\/([^/]+)$/.exec(pathname);
  const workEnvelopeMatch = /^\/work\/([^/]+)\/envelopes$/.exec(pathname);
  const workOutcomeMatch = /^\/work\/([^/]+)\/outcomes$/.exec(pathname);
  const workMatch = /^\/work\/([^/]+)(?:\/(?:assign|status|review))?$/.exec(pathname);
  const workspaceEventsMatch = /^\/workspaces\/([^/]+)\/events$/.exec(pathname);
  const individualMemoryMatch = /^\/memory\/individual\/([^/]+)$/.exec(pathname);
  const learningProposalApplyMatch = /^\/learning\/proposals\/([^/]+)\/apply$/.exec(pathname);
  const learningProposalMatch = /^\/learning\/proposals\/([^/]+)$/.exec(pathname);
  return {
    approvalId: approvalMatch?.[1],
    cosNotificationReadId: cosNotificationReadMatch?.[1],
    individualMemoryAgentId: individualMemoryMatch?.[1],
    learningProposalApplyId: learningProposalApplyMatch?.[1],
    learningProposalId: learningProposalMatch?.[1],
    runEventsId: runEventsMatch?.[1],
    runId: runMatch?.[1],
    runResumeId: runResumeMatch?.[1],
    runTracesId: runTracesMatch?.[1],
    workEnvelopeId: workEnvelopeMatch?.[1],
    workId: workMatch?.[1],
    workOutcomeId: workOutcomeMatch?.[1],
    workspaceEventsId: workspaceEventsMatch?.[1],
  };
}

function isLoopbackAddress(address: string | undefined): boolean {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address?.startsWith("127.") === true
  );
}

function headerValue(request: IncomingMessage, name: string): string | null {
  const raw = request.headers[name];
  if (Array.isArray(raw)) {
    return raw[0] ?? null;
  }
  return raw ?? null;
}

function requestContext(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: Required<Pick<ServerOptions, "operatorToken" | "workspaceId">>,
): { actor: string; explicitWorkspace: boolean; workspaceId: string } | null {
  if (headerValue(request, TOKEN_HEADER) !== options.operatorToken) {
    sendJson(response, 403, { error: "forbidden" });
    return null;
  }

  const actor = headerValue(request, ACTOR_HEADER);
  if (!actor) {
    sendJson(response, 400, { error: "missing_actor" });
    return null;
  }

  const selectedWorkspace =
    headerValue(request, WORKSPACE_HEADER) ??
    headerValue(request, LEGACY_WORKSPACE_HEADER) ??
    url.searchParams.get("workspace_id");
  return {
    actor,
    workspaceId: selectedWorkspace ?? options.workspaceId,
    explicitWorkspace: selectedWorkspace !== null,
  };
}

function requireDemoWorkspace(
  response: ServerResponse,
  workspaceId: string,
): workspaceId is typeof WORKSPACE_ID {
  if (workspaceId === WORKSPACE_ID) {
    return true;
  }
  sendJson(response, 400, { error: "unsupported_demo_workspace", workspace_id: workspaceId });
  return false;
}

function ensureDefaultWorkspace(
  spine: SpineService,
  database: Database,
  workspaceId: string,
): void {
  if (workspaceId === WORKSPACE_ID && !new WorkspaceStore(database).get(WORKSPACE_ID)) {
    spine.initDemoWorkspace();
  }
}

function runForContext(database: Database, runId: string, workspaceId: string) {
  const run = new RunStore(database).get(runId);
  return run?.workspace_id === workspaceId ? run : null;
}

function approvalForContext(database: Database, approvalId: string, workspaceId: string) {
  const approval = new ApprovalService(database).approvals.get(approvalId);
  return approval?.workspace_id === workspaceId ? approval : null;
}

function workForContext(database: Database, workId: string, workspaceId: string) {
  const work = new WorkItemStore(database).get(workId);
  return work?.workspace_id === workspaceId ? work : null;
}

function requireUnambiguousWriteWorkspace(
  response: ServerResponse,
  database: Database,
  context: { explicitWorkspace: boolean },
): boolean {
  if (!context.explicitWorkspace && new WorkspaceStore(database).listAll().length > 1) {
    sendJson(response, 400, { error: "workspace_required" });
    return false;
  }
  return true;
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function createServer(options: ServerOptions = {}) {
  const resolvedOptions = {
    operatorToken:
      options.operatorToken ??
      process.env.OPENMAO_OPERATOR_TOKEN ??
      randomBytes(16).toString("hex"),
    workspaceId: options.workspaceId ?? WORKSPACE_ID,
  };

  return createHttpServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      sendJson(response, 403, { error: "loopback_only" });
      return;
    }

    const database = openLocalDatabase(options.dbPath);
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const spine = new SpineService(database);
      const approvalRoute = routePattern(url.pathname);

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true });
        return;
      }
      if (request.method === "GET" && url.pathname === "/console") {
        sendHtml(response, consoleHtml());
        return;
      }

      const context = requestContext(request, response, url, resolvedOptions);
      if (!context) {
        return;
      }

      if (request.method === "POST" && url.pathname === "/runs/demo") {
        if (!requireUnambiguousWriteWorkspace(response, database, context)) {
          return;
        }
        if (!requireDemoWorkspace(response, context.workspaceId)) {
          return;
        }
        sendJson(response, 200, await spine.startDemo());
        return;
      }
      if (request.method === "POST" && url.pathname === "/runs/demo/approve") {
        if (!requireUnambiguousWriteWorkspace(response, database, context)) {
          return;
        }
        if (!requireDemoWorkspace(response, context.workspaceId)) {
          return;
        }
        sendJson(response, 200, spine.resumeDemo(PROMOTION_APPROVAL_ID, { actor: context.actor }));
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspaces") {
        ensureDefaultWorkspace(spine, database, context.workspaceId);
        sendJson(response, 200, new WorkspaceStore(database).listAll());
        return;
      }
      if (request.method === "GET" && url.pathname === "/workspaces/current") {
        ensureDefaultWorkspace(spine, database, context.workspaceId);
        sendJson(response, 200, new WorkspaceStore(database).get(context.workspaceId));
        return;
      }
      if (request.method === "GET" && url.pathname === "/org") {
        ensureDefaultWorkspace(spine, database, context.workspaceId);
        sendJson(response, 200, {
          organizations: new OrganizationStore(database).listForWorkspace(context.workspaceId),
          roles: new RoleStore(database).listForWorkspace(context.workspaceId),
          agents: new AgentStore(database).listForWorkspace(context.workspaceId),
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/agents") {
        ensureDefaultWorkspace(spine, database, context.workspaceId);
        sendJson(response, 200, new AgentStore(database).listForWorkspace(context.workspaceId));
        return;
      }
      if (request.method === "GET" && url.pathname === "/capabilities") {
        ensureDefaultWorkspace(spine, database, context.workspaceId);
        sendJson(
          response,
          200,
          new CapabilityStore(database).listForWorkspace(context.workspaceId),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/capability-calls") {
        sendJson(
          response,
          200,
          new CapabilityCallStore(database).listForWorkspace(context.workspaceId),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/capability-results") {
        sendJson(
          response,
          200,
          new CapabilityResultStore(database).listForWorkspace(context.workspaceId),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/workers") {
        sendJson(
          response,
          200,
          new WorkerIdentityStore(database).listForWorkspace(context.workspaceId),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/workers") {
        if (!requireUnambiguousWriteWorkspace(response, database, context)) {
          return;
        }
        const body = await readJsonBody(request);
        sendJson(
          response,
          201,
          new WorkService(database).registerWorker({
            id: typeof body.id === "string" ? body.id : null,
            workspace_id: context.workspaceId,
            name: String(body.name ?? ""),
            runtime: String(body.runtime ?? ""),
            version: typeof body.version === "string" ? body.version : null,
            role_id: typeof body.role_id === "string" ? body.role_id : null,
            allowed_capabilities: stringArray(body.allowed_capabilities),
            actor: context.actor,
            idempotency_key: typeof body.idempotency_key === "string" ? body.idempotency_key : null,
          }),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/workers/reference-demo") {
        if (!requireUnambiguousWriteWorkspace(response, database, context)) {
          return;
        }
        if (!requireDemoWorkspace(response, context.workspaceId)) {
          return;
        }
        sendJson(response, 200, await runReferenceWorkerDemo(database));
        return;
      }
      if (request.method === "POST" && url.pathname === "/workers/reference-demo/approve") {
        if (!requireUnambiguousWriteWorkspace(response, database, context)) {
          return;
        }
        if (!requireDemoWorkspace(response, context.workspaceId)) {
          return;
        }
        sendJson(response, 200, await approveReferenceWorkerDemo(database));
        return;
      }
      if (request.method === "GET" && url.pathname === "/ingestion") {
        sendJson(
          response,
          200,
          new IngestionRecordStore(database).listForWorkspace(context.workspaceId),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/ingestion") {
        if (!requireUnambiguousWriteWorkspace(response, database, context)) {
          return;
        }
        const body = await readJsonBody(request);
        const source = body.source && typeof body.source === "object" ? body.source : {};
        const actor = body.actor && typeof body.actor === "object" ? body.actor : {};
        const payload = body.payload;
        const sourceProvider = stringField((source as { provider?: unknown }).provider);
        const sourceId = stringField((source as { external_id?: unknown }).external_id);
        const sourceUrl = stringField((source as { external_url?: unknown }).external_url);
        const actorType = stringField((actor as { actor_type?: unknown }).actor_type);
        const actorId = stringField((actor as { actor_id?: unknown }).actor_id);
        const idempotencyKey = stringField(body.idempotency_key);
        if (!sourceProvider) {
          sendJson(response, 400, { error: "missing_source_provider" });
          return;
        }
        if (!sourceId && !sourceUrl) {
          sendJson(response, 400, { error: "missing_source_identity" });
          return;
        }
        if (!actorType || !actorId) {
          sendJson(response, 400, { error: "missing_actor_identity" });
          return;
        }
        if (!idempotencyKey) {
          sendJson(response, 400, { error: "missing_idempotency_key" });
          return;
        }
        sendJson(
          response,
          201,
          new IngestionService(database).record({
            id: typeof body.id === "string" ? body.id : null,
            workspace_id: context.workspaceId,
            source: {
              provider: sourceProvider,
              external_id: sourceId,
              external_url: sourceUrl,
            },
            actor: {
              actor_type: actorType as never,
              actor_id: actorId,
              display_name:
                typeof (actor as { display_name?: unknown }).display_name === "string"
                  ? (actor as { display_name: string }).display_name
                  : null,
            },
            kind: String(body.kind ?? "event") as never,
            target_run_id: typeof body.target_run_id === "string" ? body.target_run_id : null,
            target_work_item_id:
              typeof body.target_work_item_id === "string" ? body.target_work_item_id : null,
            payload:
              payload && typeof payload === "object" && !Array.isArray(payload)
                ? (payload as Record<string, unknown>)
                : {},
            idempotency_key: idempotencyKey,
          }),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/runs") {
        ensureDefaultWorkspace(spine, database, context.workspaceId);
        sendJson(response, 200, new RunStore(database).listForWorkspace(context.workspaceId));
        return;
      }
      if (request.method === "GET" && approvalRoute.runId) {
        const run = runForContext(database, approvalRoute.runId, context.workspaceId);
        if (!run) {
          sendNotFound(response);
          return;
        }
        sendJson(response, 200, run);
        return;
      }
      if (request.method === "POST" && approvalRoute.runResumeId) {
        if (!requireUnambiguousWriteWorkspace(response, database, context)) {
          return;
        }
        if (!runForContext(database, approvalRoute.runResumeId, context.workspaceId)) {
          sendNotFound(response);
          return;
        }
        sendJson(
          response,
          200,
          await spine.resumeRun(approvalRoute.runResumeId, { actor: context.actor }),
        );
        return;
      }
      if (request.method === "GET" && approvalRoute.runEventsId) {
        sendJson(
          response,
          200,
          new EventStore(database).listForRun(context.workspaceId, approvalRoute.runEventsId),
        );
        return;
      }
      if (request.method === "GET" && approvalRoute.runTracesId) {
        const run = runForContext(database, approvalRoute.runTracesId, context.workspaceId);
        if (!run) {
          sendNotFound(response);
          return;
        }
        sendJson(response, 200, new TraceStore(database).listForRun(approvalRoute.runTracesId));
        return;
      }
      if (request.method === "GET" && approvalRoute.workspaceEventsId) {
        if (approvalRoute.workspaceEventsId !== context.workspaceId) {
          sendNotFound(response);
          return;
        }
        sendJson(
          response,
          200,
          new EventStore(database).listForWorkspace(approvalRoute.workspaceEventsId),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/work") {
        ensureDefaultWorkspace(spine, database, context.workspaceId);
        sendJson(response, 200, new WorkItemStore(database).listForWorkspace(context.workspaceId));
        return;
      }
      if (request.method === "POST" && url.pathname === "/work") {
        if (!requireUnambiguousWriteWorkspace(response, database, context)) {
          return;
        }
        const body = await readJsonBody(request);
        sendJson(
          response,
          201,
          new WorkService(database).createWork({
            id: typeof body.id === "string" ? body.id : null,
            workspace_id: context.workspaceId,
            title: String(body.title ?? ""),
            objective: String(body.objective ?? ""),
            owner: String(body.owner ?? ""),
            reviewer: typeof body.reviewer === "string" ? body.reviewer : null,
            priority: (body.priority ?? "medium") as never,
            risk_level: (body.risk_level ?? "low") as never,
            success_criteria: stringArray(body.success_criteria),
            actor: context.actor,
            idempotency_key: typeof body.idempotency_key === "string" ? body.idempotency_key : null,
          }),
        );
        return;
      }
      if (request.method === "GET" && approvalRoute.workId) {
        const work = new WorkItemStore(database).get(approvalRoute.workId);
        if (!work || work.workspace_id !== context.workspaceId) {
          sendNotFound(response);
          return;
        }
        sendJson(response, 200, work);
        return;
      }
      if (request.method === "POST" && approvalRoute.workId && url.pathname.endsWith("/assign")) {
        if (!requireUnambiguousWriteWorkspace(response, database, context)) {
          return;
        }
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          new WorkService(database).assignWork({
            workspace_id: context.workspaceId,
            work_item_id: approvalRoute.workId,
            owner: String(body.owner ?? ""),
            reviewer: typeof body.reviewer === "string" ? body.reviewer : null,
            actor: context.actor,
            idempotency_key: typeof body.idempotency_key === "string" ? body.idempotency_key : null,
          }),
        );
        return;
      }
      if (request.method === "POST" && approvalRoute.workId && url.pathname.endsWith("/status")) {
        if (!requireUnambiguousWriteWorkspace(response, database, context)) {
          return;
        }
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          new WorkService(database).setStatus({
            workspace_id: context.workspaceId,
            work_item_id: approvalRoute.workId,
            status: String(body.status ?? "") as never,
            reason: typeof body.reason === "string" ? body.reason : null,
            actor: context.actor,
            idempotency_key: typeof body.idempotency_key === "string" ? body.idempotency_key : null,
          }),
        );
        return;
      }
      if (request.method === "POST" && approvalRoute.workId && url.pathname.endsWith("/review")) {
        if (!requireUnambiguousWriteWorkspace(response, database, context)) {
          return;
        }
        const body = await readJsonBody(request);
        sendJson(
          response,
          200,
          new WorkService(database).reviewWork({
            workspace_id: context.workspaceId,
            work_item_id: approvalRoute.workId,
            decision: String(body.decision ?? "") as never,
            notes: typeof body.notes === "string" ? body.notes : null,
            actor: context.actor,
            idempotency_key: typeof body.idempotency_key === "string" ? body.idempotency_key : null,
          }),
        );
        return;
      }
      if (request.method === "GET" && approvalRoute.workOutcomeId) {
        if (!workForContext(database, approvalRoute.workOutcomeId, context.workspaceId)) {
          sendNotFound(response);
          return;
        }
        sendJson(
          response,
          200,
          new WorkerOutcomeStore(database).listForWorkItem(
            context.workspaceId,
            approvalRoute.workOutcomeId,
          ),
        );
        return;
      }
      if (request.method === "POST" && approvalRoute.workOutcomeId) {
        if (!requireUnambiguousWriteWorkspace(response, database, context)) {
          return;
        }
        const body = await readJsonBody(request);
        const output = body.output;
        sendJson(
          response,
          201,
          new WorkService(database).submitWorkerOutcome({
            id: typeof body.id === "string" ? body.id : null,
            workspace_id: context.workspaceId,
            envelope_id: String(body.envelope_id ?? ""),
            worker_id: String(body.worker_id ?? ""),
            status: String(body.status ?? "completed") as never,
            summary: String(body.summary ?? ""),
            output:
              output && typeof output === "object" && !Array.isArray(output)
                ? (output as Record<string, unknown>)
                : {},
            actor: context.actor,
            idempotency_key:
              typeof body.idempotency_key === "string"
                ? body.idempotency_key
                : `work:${approvalRoute.workOutcomeId}:outcome:${String(body.envelope_id ?? "")}`,
          }),
        );
        return;
      }
      if (request.method === "GET" && approvalRoute.workEnvelopeId) {
        if (!workForContext(database, approvalRoute.workEnvelopeId, context.workspaceId)) {
          sendNotFound(response);
          return;
        }
        sendJson(
          response,
          200,
          new BoundedWorkEnvelopeStore(database).listForWorkItem(
            context.workspaceId,
            approvalRoute.workEnvelopeId,
          ),
        );
        return;
      }
      if (request.method === "POST" && approvalRoute.workEnvelopeId) {
        if (!requireUnambiguousWriteWorkspace(response, database, context)) {
          return;
        }
        const body = await readJsonBody(request);
        const input = body.input;
        sendJson(
          response,
          201,
          new WorkService(database).createBoundedEnvelope({
            id: typeof body.id === "string" ? body.id : null,
            workspace_id: context.workspaceId,
            work_item_id: approvalRoute.workEnvelopeId,
            run_id: typeof body.run_id === "string" ? body.run_id : null,
            worker_id: String(body.worker_id ?? ""),
            issued_by: { actor_type: "operator", actor_id: context.actor, display_name: null },
            allowed_capabilities: stringArray(body.allowed_capabilities),
            input:
              input && typeof input === "object" && !Array.isArray(input)
                ? (input as Record<string, unknown>)
                : {},
            idempotency_key: typeof body.idempotency_key === "string" ? body.idempotency_key : null,
          }),
        );
        return;
      }
      if (request.method === "GET" && approvalRoute.individualMemoryAgentId) {
        sendJson(
          response,
          200,
          new MemoryEntryStore(database)
            .listForWorkspace(context.workspaceId)
            .filter(
              (entry) =>
                entry.scope === "individual" &&
                entry.owner_id === approvalRoute.individualMemoryAgentId,
            ),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/memory/collective") {
        sendJson(
          response,
          200,
          new MemoryEntryStore(database)
            .listForWorkspace(context.workspaceId)
            .filter((entry) => entry.scope === "collective"),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/memory/promotions") {
        sendJson(
          response,
          200,
          new PromotionCandidateStore(database).listForWorkspace(context.workspaceId),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/learning/proposals") {
        sendJson(
          response,
          200,
          new OrgChangeProposalStore(database).listForWorkspace(context.workspaceId),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/learning/scan") {
        if (!requireUnambiguousWriteWorkspace(response, database, context)) {
          return;
        }
        sendJson(response, 200, new LearningService(database).scan(context.workspaceId));
        return;
      }
      if (request.method === "GET" && approvalRoute.learningProposalId) {
        const proposal = new OrgChangeProposalStore(database).get(approvalRoute.learningProposalId);
        if (!proposal || proposal.workspace_id !== context.workspaceId) {
          sendNotFound(response);
          return;
        }
        sendJson(response, 200, proposal);
        return;
      }
      if (request.method === "POST" && approvalRoute.learningProposalApplyId) {
        if (!requireUnambiguousWriteWorkspace(response, database, context)) {
          return;
        }
        sendJson(
          response,
          200,
          new OrgChangeService(database).markApplied(approvalRoute.learningProposalApplyId, {
            workspace_id: context.workspaceId,
            actor: context.actor,
          }),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/cos/notifications") {
        sendJson(
          response,
          200,
          new ChiefOfStaffService(database).listNotifications(context.workspaceId, {
            unreadOnly: url.searchParams.get("unread") === "1",
          }),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/cadences") {
        sendJson(
          response,
          200,
          new ChiefOfStaffService(database).listCadences(context.workspaceId),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/cos/init") {
        if (!requireUnambiguousWriteWorkspace(response, database, context)) {
          return;
        }
        sendJson(
          response,
          200,
          new ChiefOfStaffService(database).ensureDefaultCadences(context.workspaceId, utcNow()),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/cos/tick") {
        if (!requireUnambiguousWriteWorkspace(response, database, context)) {
          return;
        }
        sendJson(
          response,
          200,
          new ChiefOfStaffService(database).tick({
            workspace_id: context.workspaceId,
            at: utcNow(),
          }),
        );
        return;
      }
      if (request.method === "POST" && approvalRoute.cosNotificationReadId) {
        if (!requireUnambiguousWriteWorkspace(response, database, context)) {
          return;
        }
        const notificationId = approvalRoute.cosNotificationReadId;
        const chiefOfStaff = new ChiefOfStaffService(database);
        if (!chiefOfStaff.getNotification(context.workspaceId, notificationId)) {
          sendNotFound(response);
          return;
        }
        sendJson(
          response,
          200,
          chiefOfStaff.markRead({
            workspace_id: context.workspaceId,
            notification_id: notificationId,
            at: utcNow(),
          }),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/approvals") {
        sendJson(
          response,
          200,
          new ApprovalService(database).approvals.listPending(context.workspaceId),
        );
        return;
      }
      if (request.method === "POST" && approvalRoute.approvalId) {
        if (!requireUnambiguousWriteWorkspace(response, database, context)) {
          return;
        }
        const approval = approvalForContext(
          database,
          approvalRoute.approvalId,
          context.workspaceId,
        );
        if (!approval) {
          sendNotFound(response);
          return;
        }
        if (url.pathname.endsWith("/reject")) {
          const rejected = new ApprovalService(database).reject(approvalRoute.approvalId, {
            workspace_id: context.workspaceId,
            actor: context.actor,
          });
          sendJson(
            response,
            200,
            rejected.payload.target_type === "capability_call"
              ? await materializeRejectedCapabilityApproval(database, rejected)
              : rejected,
          );
        } else if (approvalRoute.approvalId === PROMOTION_APPROVAL_ID) {
          if (!requireDemoWorkspace(response, context.workspaceId)) {
            return;
          }
          sendJson(
            response,
            200,
            spine.resumeDemo(approvalRoute.approvalId, { actor: context.actor }),
          );
        } else if (
          approval.payload.target_type === "capability_call" &&
          approval.run_id === RUN_ID
        ) {
          sendJson(
            response,
            200,
            await spine.resumeApprovedCapability(approvalRoute.approvalId, {
              actor: context.actor,
              workspace_id: context.workspaceId,
            }),
          );
        } else if (
          approval.payload.target_type === "capability_call" &&
          approval.run_id === REFERENCE_RUN_ID
        ) {
          sendJson(response, 200, await approveReferenceWorkerDemo(database));
        } else if (approval.payload.target_type === "capability_call") {
          new ApprovalService(database).approve(approvalRoute.approvalId, {
            workspace_id: context.workspaceId,
            actor: context.actor,
          });
          sendJson(
            response,
            200,
            await createConfiguredCapabilityRegistry(database).resumeApprovedCall(
              approvalRoute.approvalId,
              {
                workspace_id: context.workspaceId,
              },
            ),
          );
        } else {
          sendJson(
            response,
            200,
            createApprovalServiceWithApplications(database).approve(approvalRoute.approvalId, {
              workspace_id: context.workspaceId,
              actor: context.actor,
            }),
          );
        }
        return;
      }
      if (request.method === "GET" && url.pathname === "/events") {
        const runId = url.searchParams.get("run_id");
        sendJson(
          response,
          200,
          runId
            ? new EventStore(database).listForRun(context.workspaceId, runId)
            : new EventStore(database).listForWorkspace(context.workspaceId),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/world") {
        if (!requireUnambiguousWriteWorkspace(response, database, context)) {
          return;
        }
        ensureDefaultWorkspace(spine, database, context.workspaceId);
        const runId = url.searchParams.get("run_id");
        sendJson(
          response,
          200,
          new WorldModelService(database).rebuild(
            context.workspaceId,
            runId ??
              (new RunStore(database).get(RUN_ID)?.workspace_id === context.workspaceId
                ? RUN_ID
                : null),
          ),
        );
        return;
      }
      sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      database.close();
    }
  });
}

function consoleHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenMAO Console</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #16201d;
      --muted: #607069;
      --line: #d8e0dc;
      --surface: #f6f8f7;
      --accent: #0c6b58;
      --danger: #9f2f2f;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background: #ffffff;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 20px 24px;
      border-bottom: 1px solid var(--line);
    }
    h1 { margin: 0; font-size: 20px; font-weight: 700; }
    main { display: grid; grid-template-columns: 220px 1fr; min-height: calc(100vh - 73px); }
    nav {
      padding: 16px;
      border-right: 1px solid var(--line);
      background: var(--surface);
    }
    section { min-width: 0; padding: 20px 24px; }
    .actions, .tabs { display: flex; flex-wrap: wrap; gap: 8px; }
    .tabs { flex-direction: column; }
    button {
      min-height: 36px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 0 12px;
      background: #ffffff;
      color: var(--ink);
      font: inherit;
      cursor: pointer;
    }
    button:hover, button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
    button[data-tone="danger"]:hover { border-color: var(--danger); color: var(--danger); }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
    input {
      min-height: 36px;
      width: min(260px, 100%);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 0 10px;
      font: inherit;
    }
    .title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 16px;
    }
    h2 { margin: 0; font-size: 18px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border-bottom: 1px solid var(--line); padding: 10px 8px; text-align: left; vertical-align: top; }
    th { color: var(--muted); font-size: 12px; text-transform: uppercase; }
    td { overflow-wrap: anywhere; }
    pre {
      margin: 0;
      padding: 16px;
      overflow: auto;
      min-height: 320px;
      background: #101716;
      color: #f4f7f6;
      border-radius: 6px;
    }
    .meta { color: var(--muted); font-size: 13px; }
    @media (max-width: 760px) {
      header { align-items: flex-start; flex-direction: column; }
      main { grid-template-columns: 1fr; }
      nav { border-right: 0; border-bottom: 1px solid var(--line); }
      .tabs { flex-direction: row; }
      .toolbar { justify-content: flex-start; }
    }
  </style>
</head>
<body>
  <header>
    <h1>OpenMAO Console</h1>
    <div class="toolbar">
      <input id="token-input" type="password" autocomplete="off" placeholder="Operator token" />
      <button data-action="/runs/demo">Run Demo</button>
      <button data-action="/runs/demo/approve">Approve Demo</button>
      <button data-action="/workers/reference-demo">Run Worker</button>
      <button data-action="/workers/reference-demo/approve">Approve Worker</button>
      <button data-action="/cos/tick">Tick CoS</button>
      <button id="refresh">Refresh</button>
      <button id="reset-token">Reset Token</button>
    </div>
  </header>
  <main>
    <nav class="tabs" aria-label="Console views">
      <button data-view="world" aria-pressed="true">World</button>
      <button data-view="runs">Runs</button>
      <button data-view="work">Work</button>
      <button data-view="agents">Agents</button>
      <button data-view="approvals">Approvals</button>
      <button data-view="promotions">Promotions</button>
      <button data-view="learning">Learning</button>
      <button data-view="chiefOfStaff">Chief of Staff</button>
      <button data-view="cadences">Cadences</button>
      <button data-view="memory">Memory</button>
      <button data-view="capabilities">Capabilities</button>
      <button data-view="capabilityCalls">Capability Calls</button>
      <button data-view="capabilityResults">Capability Results</button>
      <button data-view="events">Events</button>
      <button data-view="traces">Traces</button>
    </nav>
    <section>
      <div class="title-row">
        <div>
          <h2 id="view-title">World</h2>
          <div id="view-meta" class="meta">${WORKSPACE_ID}</div>
        </div>
      </div>
      <div id="table"></div>
      <pre id="output">{}</pre>
    </section>
  </main>
  <script>
    const defaultRunId = ${JSON.stringify(RUN_ID)};
    const coordinatorAgentId = ${JSON.stringify(COORDINATOR_AGENT_ID)};
    const tokenInput = document.querySelector("#token-input");
    const output = document.querySelector("#output");
    const table = document.querySelector("#table");
    const viewTitle = document.querySelector("#view-title");
    const viewMeta = document.querySelector("#view-meta");
    let activeView = "world";

    function operatorToken() {
      return tokenInput.value || sessionStorage.getItem("openmaoOperatorToken") || "";
    }
    function headers() {
      return {
        ${JSON.stringify(TOKEN_HEADER)}: operatorToken(),
        ${JSON.stringify(ACTOR_HEADER)}: ${JSON.stringify(CONSOLE_ACTOR)}
      };
    }
    async function parse(response) {
      const body = await response.json();
      if (!response.ok) throw body;
      return body;
    }
    async function request(path, init = {}) {
      if (!operatorToken()) throw { error: "operator_token_required" };
      return parse(await fetch(path, { ...init, headers: { ...headers(), ...(init.headers || {}) } }));
    }
    function setActive(view) {
      activeView = view;
      viewTitle.textContent = view[0].toUpperCase() + view.slice(1);
      document.querySelectorAll("[data-view]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.view === view));
      });
    }
    function renderJson(value) {
      table.replaceChildren();
      output.textContent = JSON.stringify(value, null, 2);
    }
    function renderRows(rows, columns, actions) {
      table.replaceChildren();
      const element = document.createElement("table");
      const thead = element.createTHead();
      const headRow = thead.insertRow();
      columns.concat(actions ? ["actions"] : []).forEach((column) => {
        const th = document.createElement("th");
        th.textContent = column;
        headRow.appendChild(th);
      });
      const tbody = element.createTBody();
      rows.forEach((row) => {
        const tr = tbody.insertRow();
        columns.forEach((column) => {
          const td = tr.insertCell();
          const value = row[column];
          td.textContent = value === undefined || value === null ? "" : String(value);
        });
        if (actions) {
          const td = tr.insertCell();
          actions(row).forEach((button) => td.appendChild(button));
        }
      });
      table.appendChild(element);
      output.textContent = JSON.stringify(rows, null, 2);
    }
    function actionButton(label, path, tone) {
      const button = document.createElement("button");
      button.textContent = label;
      if (tone) button.dataset.tone = tone;
      button.addEventListener("click", async () => {
        renderJson(await request(path, { method: "POST" }));
        await load(activeView);
      });
      return button;
    }
    async function load(view) {
      setActive(view);
      try {
        if (view === "world") return renderJson(await request("/world"));
        if (view === "runs") return renderRows(await request("/runs"), ["id", "status", "active_node", "suspended_approval_id"]);
        if (view === "work") return renderRows(await request("/work"), ["id", "status", "title", "owner"]);
        if (view === "agents") return renderRows(await request("/agents"), ["id", "identity", "role_id", "status"]);
        if (view === "approvals") {
          return renderRows(await request("/approvals"), ["id", "action", "status", "on_approve", "on_reject"], (row) => [
            actionButton("Approve", "/approvals/" + row.id + "/approve"),
            actionButton("Reject", "/approvals/" + row.id + "/reject", "danger")
          ]);
        }
        if (view === "promotions") return renderRows(await request("/memory/promotions"), ["id", "status", "proposed_by", "source_memory_entry"]);
        if (view === "learning") {
          return renderRows(await request("/learning/proposals"), ["id", "status", "change_type", "source_signal", "confidence"], (row) => {
            const actions = [];
            if (row.status === "proposed" && row.review_approval_id) {
              actions.push(actionButton("Approve", "/approvals/" + row.review_approval_id + "/approve"));
              actions.push(actionButton("Reject", "/approvals/" + row.review_approval_id + "/reject", "danger"));
            }
            if (row.status === "approved") {
              actions.push(actionButton("Apply", "/learning/proposals/" + row.id + "/apply"));
            }
            return actions;
          });
        }
        if (view === "chiefOfStaff") {
          return renderRows(await request("/cos/notifications"), ["severity", "kind", "summary", "status"], (row) => {
            return row.status === "unread" ? [actionButton("Mark read", "/cos/notifications/" + row.id + "/read")] : [];
          });
        }
        if (view === "cadences") return renderRows(await request("/cadences"), ["kind", "interval_seconds", "enabled", "next_due_at"]);
        if (view === "memory") return renderJson({
          collective: await request("/memory/collective"),
          coordinator: await request("/memory/individual/" + coordinatorAgentId)
        });
        if (view === "capabilities") return renderRows(await request("/capabilities"), ["name", "default_permission", "providers"]);
        if (view === "capabilityCalls") return renderRows(await request("/capability-calls"), ["id", "capability_name", "provider", "requested_by", "risk_level"]);
        if (view === "capabilityResults") return renderRows(await request("/capability-results"), ["id", "call_id", "status", "run_id"]);
        if (view === "events") return renderRows(await request("/events"), ["seq", "run_seq", "kind", "actor", "run_id"]);
        if (view === "traces") {
          const runs = await request("/runs");
          const run = runs.find((item) => item.id === defaultRunId) || runs[0];
          return renderRows(run ? await request("/runs/" + run.id + "/traces") : [], ["node", "timestamp", "run_id"]);
        }
      } catch (error) {
        renderJson({ error });
      }
    }
    async function show(responsePromise) {
      const response = await responsePromise;
      renderJson(await response.json());
    }
    document.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        await show(fetch(button.dataset.action, { method: "POST", headers: headers() }));
        await load(activeView);
      });
    });
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => load(button.dataset.view));
    });
    document.querySelector("#refresh").addEventListener("click", () => load(activeView));
    document.querySelector("#reset-token").addEventListener("click", () => {
      sessionStorage.removeItem("openmaoOperatorToken");
      tokenInput.value = "";
      load(activeView);
    });
    tokenInput.value = sessionStorage.getItem("openmaoOperatorToken") || "";
    tokenInput.addEventListener("change", () => {
      sessionStorage.setItem("openmaoOperatorToken", tokenInput.value);
      load(activeView);
    });
    load(activeView);
  </script>
</body>
</html>`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? "8000");
  const operatorToken = process.env.OPENMAO_OPERATOR_TOKEN ?? randomBytes(16).toString("hex");
  createServer({ operatorToken }).listen(port, DEFAULT_HTTP_HOST, () => {
    console.log(`OpenMAO API/console listening on http://${DEFAULT_HTTP_HOST}:${port}`);
    if (!process.env.OPENMAO_OPERATOR_TOKEN) {
      console.log(`OpenMAO local operator token: ${operatorToken}`);
    }
  });
}
