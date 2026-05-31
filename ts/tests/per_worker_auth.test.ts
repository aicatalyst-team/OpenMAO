import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createServer } from "../src/api/server.js";
import { Database } from "../src/persistence/index.js";
import { WorkerAuthService } from "../src/security/worker-auth.js";
import { WORKSPACE_ID } from "../src/spine/index.js";
import {
  prepareReferenceWorkerDemo,
  REFERENCE_CREDENTIAL_HANDLE,
  REFERENCE_RUN_ID,
  REFERENCE_TASK_ID,
  REFERENCE_WORK_ID,
  REFERENCE_WORKER_ID,
} from "../src/workers/index.js";

const OPERATOR_TOKEN = "test-operator-token";

let tmpRoot: string;
let dbPath: string;
let server: Server;
let baseUrl: string;
let workerToken: string;

type Res = {
  status: number;
  // biome-ignore lint/suspicious/noExplicitAny: test asserts on a dynamic JSON response shape.
  json: any;
};

async function req(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<Res> {
  const init: RequestInit = {
    method,
    headers: { "content-type": "application/json", ...headers },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

const workerHeaders = (): Record<string, string> => ({ "x-openmao-worker-token": workerToken });
const operatorHeaders = (): Record<string, string> => ({
  "x-openmao-operator-token": OPERATOR_TOKEN,
  "x-openmao-actor": "operator",
});

function capabilityCallBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    run_id: REFERENCE_RUN_ID,
    capability_name: "mock.side_effect.record",
    provider: "mock.side_effect",
    input: { message: "x" },
    task_id: REFERENCE_TASK_ID,
    credential_handle: REFERENCE_CREDENTIAL_HANDLE,
    side_effecting: true,
    risk_level: "high",
    idempotency_key: "pwa:call",
    ...overrides,
  };
}

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), "openmao-pwa-"));
  dbPath = join(tmpRoot, "openmao.sqlite3");
  const database = new Database(dbPath);
  database.initialize();
  prepareReferenceWorkerDemo(database);
  workerToken = new WorkerAuthService(database).mint({
    workspace_id: WORKSPACE_ID,
    worker_id: REFERENCE_WORKER_ID,
  }).token;
  database.close();

  server = createServer({ dbPath, operatorToken: OPERATOR_TOKEN, workspaceId: WORKSPACE_ID });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("per-worker auth", () => {
  it("lets a worker token request a capability AS ITSELF — identity is forced from the token", async () => {
    const { status, json } = await req(
      "POST",
      "/capability-calls",
      workerHeaders(),
      // The body tries to name another worker; the route ignores it and forces the token's worker.
      capabilityCallBody({ requested_by: "worker_imposter", idempotency_key: "pwa:self" }),
    );
    expect(status).toBe(200);
    expect(json.call.requested_by).toBe(REFERENCE_WORKER_ID);
    expect(json.approval_id).toBeTruthy();
  });

  it("forbids a worker token from issuing itself an envelope (operator-only)", async () => {
    const { status, json } = await req(
      "POST",
      `/work/${REFERENCE_WORK_ID}/envelopes`,
      workerHeaders(),
      {
        worker_id: REFERENCE_WORKER_ID,
        run_id: REFERENCE_RUN_ID,
        allowed_capabilities: ["mock.side_effect.record"],
        resource_grants: {},
      },
    );
    expect(status).toBe(403);
    expect(json.error).toBe("worker_forbidden");
  });

  it("forbids a worker token from approving a capability call", async () => {
    const { status } = await req(
      "POST",
      "/approvals/approval_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/approve",
      workerHeaders(),
      {},
    );
    expect(status).toBe(403);
  });

  it("rejects an invalid worker token", async () => {
    const { status } = await req(
      "POST",
      "/capability-calls",
      { "x-openmao-worker-token": "wkr_invalid" },
      capabilityCallBody({ idempotency_key: "pwa:invalid" }),
    );
    expect(status).toBe(403);
  });

  it("still lets the operator issue an envelope — operator retains full authority", async () => {
    const { status } = await req(
      "POST",
      `/work/${REFERENCE_WORK_ID}/envelopes`,
      operatorHeaders(),
      {
        id: "envelope_dddddddddddddddddddddddddddddddd",
        worker_id: REFERENCE_WORKER_ID,
        run_id: REFERENCE_RUN_ID,
        allowed_capabilities: ["mock.side_effect.record"],
      },
    );
    expect(status).not.toBe(403);
  });
});
