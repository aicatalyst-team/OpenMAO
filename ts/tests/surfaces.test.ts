import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createServer } from "../src/api/server.js";
import { runCli } from "../src/cli.js";
import { WorkspaceSchema } from "../src/contracts/index.js";
import { Database, WorkspaceStore } from "../src/persistence/index.js";
import {
  COORDINATOR_AGENT_ID,
  PROMOTION_APPROVAL_ID,
  RUN_ID,
  WORKSPACE_ID,
} from "../src/spine/index.js";

let tmpRoot: string;
let dbPath: string;
const operatorToken = "test-operator-token";
const operatorHeaders = {
  "x-openmao-actor": "test_operator",
  "x-openmao-operator-token": operatorToken,
};

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "openmao-ts-surfaces-"));
  dbPath = join(tmpRoot, "openmao.sqlite3");
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function capture(): { lines: string[]; write: (message: string) => void } {
  const lines: string[] = [];
  return { lines, write: (message: string) => lines.push(message) };
}

describe("TypeScript operator surfaces", () => {
  it("runs demo and approval through the CLI", async () => {
    const demoOutput = capture();
    const approvalOutput = capture();
    const worldOutput = capture();

    expect(await runCli(["demo"], { dbPath, write: demoOutput.write })).toBe(0);
    expect(JSON.parse(demoOutput.lines[0] ?? "{}").status).toBe("suspended_approval");
    const resumeOutput = capture();
    expect(await runCli(["run", "resume"], { dbPath, write: resumeOutput.write })).toBe(0);
    expect(JSON.parse(resumeOutput.lines[0] ?? "{}").status).toBe("suspended_approval");

    expect(await runCli(["approvals", "list"], { dbPath, write: approvalOutput.write })).toBe(0);
    expect(JSON.parse(approvalOutput.lines[0] ?? "[]")[0].id).toBe(PROMOTION_APPROVAL_ID);

    await expect(
      runCli(
        [
          "approvals",
          "approve",
          PROMOTION_APPROVAL_ID,
          "--workspace",
          "ws_22222222222222222222222222222222",
        ],
        { dbPath },
      ),
    ).rejects.toThrow("demo run does not belong to workspace");
    expect(await runCli(["approvals", "approve", PROMOTION_APPROVAL_ID], { dbPath })).toBe(0);
    expect(await runCli(["world"], { dbPath, write: worldOutput.write })).toBe(0);
    expect(JSON.parse(worldOutput.lines[0] ?? "{}").latest_run_status).toBe("completed");
    const workspaceWorldOutput = capture();
    expect(
      await runCli(["world", "--workspace", WORKSPACE_ID], {
        dbPath,
        write: workspaceWorldOutput.write,
      }),
    ).toBe(0);
    expect(JSON.parse(workspaceWorldOutput.lines[0] ?? "{}").latest_run_status).toBe("completed");
    const workspaceEventsOutput = capture();
    expect(
      await runCli(["events", "--workspace", WORKSPACE_ID], {
        dbPath,
        write: workspaceEventsOutput.write,
      }),
    ).toBe(0);
    expect(JSON.parse(workspaceEventsOutput.lines[0] ?? "[]").length).toBeGreaterThan(0);
    const consoleOutput = capture();
    expect(await runCli(["console"], { dbPath, write: consoleOutput.write })).toBe(0);
    expect(consoleOutput.lines[0]).toContain("127.0.0.1");

    const runEventsOutput = capture();
    expect(
      await runCli(["events", RUN_ID], {
        dbPath,
        write: runEventsOutput.write,
      }),
    ).toBe(0);
    expect(JSON.parse(runEventsOutput.lines[0] ?? "[]").length).toBeGreaterThan(0);
  });

  it("serves demo, approvals, world, and console over HTTP", async () => {
    const server = createServer({ dbPath, operatorToken });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const rejected = await fetch(`${baseUrl}/runs/demo`, { method: "POST" });
      const missingActor = await fetch(`${baseUrl}/runs/demo`, {
        method: "POST",
        headers: { "x-openmao-operator-token": operatorToken },
      });
      const demo = (await fetch(`${baseUrl}/runs/demo`, {
        method: "POST",
        headers: operatorHeaders,
      }).then((response) => response.json())) as { status: string };
      const approvals = (await fetch(`${baseUrl}/approvals`, { headers: operatorHeaders }).then(
        (response) => response.json(),
      )) as Array<{ id: string }>;
      const workspaces = (await fetch(`${baseUrl}/workspaces`, { headers: operatorHeaders }).then(
        (response) => response.json(),
      )) as Array<{ id: string }>;
      const org = (await fetch(`${baseUrl}/org`, { headers: operatorHeaders }).then((response) =>
        response.json(),
      )) as { agents: unknown[]; organizations: unknown[]; roles: unknown[] };
      const capabilities = (await fetch(`${baseUrl}/capabilities`, {
        headers: operatorHeaders,
      }).then((response) => response.json())) as unknown[];
      const runs = (await fetch(`${baseUrl}/runs`, { headers: operatorHeaders }).then((response) =>
        response.json(),
      )) as unknown[];
      const run = (await fetch(`${baseUrl}/runs/${RUN_ID}`, { headers: operatorHeaders }).then(
        (response) => response.json(),
      )) as { id: string };
      const wrongWorkspaceRun = await fetch(`${baseUrl}/runs/${RUN_ID}`, {
        headers: {
          ...operatorHeaders,
          "x-openmao-workspace": "ws_22222222222222222222222222222222",
        },
      });
      const wrongWorkspaceRunBody = (await wrongWorkspaceRun.json()) as { error: string };
      const wrongWorkspaceResume = await fetch(`${baseUrl}/runs/${RUN_ID}/resume`, {
        method: "POST",
        headers: {
          ...operatorHeaders,
          "x-openmao-workspace": "ws_22222222222222222222222222222222",
        },
      });
      const work = (await fetch(`${baseUrl}/work`, { headers: operatorHeaders }).then((response) =>
        response.json(),
      )) as unknown[];
      const individualMemory = (await fetch(
        `${baseUrl}/memory/individual/${COORDINATOR_AGENT_ID}`,
        {
          headers: operatorHeaders,
        },
      ).then((response) => response.json())) as unknown[];
      const promotions = (await fetch(`${baseUrl}/memory/promotions`, {
        headers: operatorHeaders,
      }).then((response) => response.json())) as unknown[];
      const wrongWorkspaceEvents = (await fetch(
        `${baseUrl}/events?run_id=${RUN_ID}&workspace_id=${WORKSPACE_ID}`,
        {
          headers: {
            ...operatorHeaders,
            "x-openmao-workspace": "ws_22222222222222222222222222222222",
          },
        },
      ).then((response) => response.json())) as unknown[];
      const wrongWorkspacePathEvents = await fetch(`${baseUrl}/workspaces/${WORKSPACE_ID}/events`, {
        headers: {
          ...operatorHeaders,
          "x-openmao-workspace": "ws_22222222222222222222222222222222",
        },
      });
      const completed = (await fetch(`${baseUrl}/approvals/${PROMOTION_APPROVAL_ID}/approve`, {
        method: "POST",
        headers: operatorHeaders,
      }).then((response) => response.json())) as { status: string };
      const collectiveMemory = (await fetch(`${baseUrl}/memory/collective`, {
        headers: operatorHeaders,
      }).then((response) => response.json())) as unknown[];
      const world = (await fetch(`${baseUrl}/world`, { headers: operatorHeaders }).then(
        (response) => response.json(),
      )) as { latest_run_status: string };
      const runEvents = (await fetch(`${baseUrl}/runs/${RUN_ID}/events`, {
        headers: operatorHeaders,
      }).then((response) => response.json())) as unknown[];
      const runTraces = (await fetch(`${baseUrl}/runs/${RUN_ID}/traces`, {
        headers: operatorHeaders,
      }).then((response) => response.json())) as unknown[];
      const wrongWorkspaceTraces = await fetch(`${baseUrl}/runs/${RUN_ID}/traces`, {
        headers: {
          ...operatorHeaders,
          "x-openmao-workspace": "ws_22222222222222222222222222222222",
        },
      });
      const workspaceEvents = (await fetch(`${baseUrl}/workspaces/${WORKSPACE_ID}/events`, {
        headers: operatorHeaders,
      }).then((response) => response.json())) as unknown[];
      const consoleHtml = await fetch(`${baseUrl}/console`).then((response) => response.text());

      expect(rejected.status).toBe(403);
      expect(missingActor.status).toBe(400);
      expect(demo.status).toBe("suspended_approval");
      expect(approvals.at(0)?.id).toBe(PROMOTION_APPROVAL_ID);
      expect(workspaces.at(0)?.id).toBe(WORKSPACE_ID);
      expect(org.organizations).toHaveLength(1);
      expect(org.roles).toHaveLength(2);
      expect(org.agents).toHaveLength(2);
      expect(capabilities).toHaveLength(1);
      expect(runs).toHaveLength(1);
      expect(run.id).toBe(RUN_ID);
      expect(wrongWorkspaceRun.status).toBe(404);
      expect(wrongWorkspaceRunBody).toEqual({ error: "not_found" });
      expect(wrongWorkspaceResume.status).toBe(404);
      expect(work).toHaveLength(1);
      expect(individualMemory.length).toBeGreaterThan(0);
      expect(promotions).toHaveLength(1);
      expect(wrongWorkspaceEvents).toEqual([]);
      expect(wrongWorkspacePathEvents.status).toBe(404);
      expect(completed.status).toBe("completed");
      expect(collectiveMemory).toHaveLength(1);
      expect(world.latest_run_status).toBe("completed");
      expect(runEvents.length).toBeGreaterThan(0);
      expect(runTraces.length).toBeGreaterThan(0);
      expect(wrongWorkspaceTraces.status).toBe(404);
      expect(workspaceEvents.length).toBeGreaterThan(runEvents.length);
      expect(consoleHtml).toContain("OpenMAO Console");
      expect(consoleHtml).toContain('data-view="traces"');
      expect(consoleHtml).toContain("/approvals/");
      expect(consoleHtml).not.toContain(operatorToken);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("requires explicit workspace selection for writes once multiple workspaces exist", async () => {
    const server = createServer({ dbPath, operatorToken });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const demo = (await fetch(`${baseUrl}/runs/demo`, {
        method: "POST",
        headers: operatorHeaders,
      }).then((response) => response.json())) as { status: string };
      const database = new Database(dbPath);
      database.initialize();
      try {
        new WorkspaceStore(database).save(
          WorkspaceSchema.parse({
            id: "ws_22222222222222222222222222222222",
            name: "Second Workspace",
            created_at: "2026-05-27T15:20:00Z",
            default_org_id: null,
          }),
        );
      } finally {
        database.close();
      }

      const ambiguousApproval = await fetch(`${baseUrl}/runs/demo/approve`, {
        method: "POST",
        headers: operatorHeaders,
      });
      const ambiguousWorld = await fetch(`${baseUrl}/world`, { headers: operatorHeaders });
      const explicitApproval = (await fetch(`${baseUrl}/runs/demo/approve`, {
        method: "POST",
        headers: { ...operatorHeaders, "x-openmao-workspace": WORKSPACE_ID },
      }).then((response) => response.json())) as { status: string };

      expect(demo.status).toBe("suspended_approval");
      expect(ambiguousApproval.status).toBe(400);
      expect(await ambiguousApproval.json()).toEqual({ error: "workspace_required" });
      expect(ambiguousWorld.status).toBe(400);
      expect(await ambiguousWorld.json()).toEqual({ error: "workspace_required" });
      expect(explicitApproval.status).toBe("completed");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
