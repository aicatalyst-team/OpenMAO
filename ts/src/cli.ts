#!/usr/bin/env node
import { ApprovalService } from "./governance/index.js";
import { IngestionService } from "./ingestion/index.js";
import {
  BoundedWorkEnvelopeStore,
  EventStore,
  IngestionRecordStore,
  RunStore,
  WorkerIdentityStore,
  WorkerOutcomeStore,
  WorkItemStore,
} from "./persistence/index.js";
import { createApprovalServiceWithApplications } from "./runtime/approvals.js";
import { createLocalCapabilityRegistry } from "./runtime/capabilities.js";
import { openLocalDatabase } from "./runtime/local.js";
import { PROMOTION_APPROVAL_ID, RUN_ID, SpineService, WORKSPACE_ID } from "./spine/index.js";
import { WorkService } from "./work/index.js";
import {
  approveReferenceWorkerDemo,
  REFERENCE_RUN_ID,
  runReferenceWorkerDemo,
} from "./workers/index.js";
import { WorldModelService } from "./world/index.js";

type CliOptions = {
  dbPath?: string;
  write?: (message: string) => void;
};

function printJson(write: (message: string) => void, value: unknown): void {
  write(JSON.stringify(value, null, 2));
}

function optionValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) {
    return null;
  }
  return args[index + 1] ?? null;
}

function positionalArgs(args: string[]): string[] {
  const flagsWithValues = new Set([
    "--workspace",
    "--run",
    "--id",
    "--title",
    "--objective",
    "--owner",
    "--reviewer",
    "--priority",
    "--risk",
    "--criteria",
    "--name",
    "--runtime",
    "--version",
    "--role",
    "--capabilities",
    "--worker",
    "--input",
    "--output",
    "--status",
    "--summary",
    "--envelope",
    "--decision",
    "--kind",
    "--source-provider",
    "--source-id",
    "--source-url",
    "--actor-type",
    "--actor-id",
    "--payload",
    "--work",
    "--idempotency-key",
  ]);
  const positions: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (flagsWithValues.has(arg ?? "")) {
      index += 1;
      continue;
    }
    if (arg !== undefined) {
      positions.push(arg);
    }
  }
  return positions;
}

function requireOption(args: string[], name: string): string {
  const value = optionValue(args, name);
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function commaList(value: string | null): string[] {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function jsonOption(value: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON option must be an object");
  }
  return parsed as Record<string, unknown>;
}

function requireDefaultWorkspace(workspaceId: string): void {
  if (workspaceId !== WORKSPACE_ID) {
    throw new Error(`demo run does not belong to workspace: ${workspaceId}`);
  }
}

export async function runCli(args: string[], options: CliOptions = {}): Promise<number> {
  const write = options.write ?? console.log;
  const database = openLocalDatabase(options.dbPath);
  try {
    const spine = new SpineService(database);
    const positions = positionalArgs(args);
    const command = positions[0] ?? "help";
    const subcommand = positions[1] ?? "";
    const selectedWorkspace = optionValue(args, "--workspace") ?? WORKSPACE_ID;

    if (command === "help" || command === "--help" || command === "-h") {
      write(
        "openmao demo | demo-approve | init | run demo|resume | worker demo|demo-approve | work list|show|create|assign|status|envelope|outcome|review | workers list|register | ingest list|record | approvals list|approve|reject <id> [--workspace workspace_id] | events [run_id]|--workspace [workspace_id] | world [--run run_id] [--workspace workspace_id] | console",
      );
      return 0;
    }
    if (command === "init") {
      printJson(write, { workspace_id: spine.initDemoWorkspace() });
      return 0;
    }
    if (command === "demo" || (command === "run" && subcommand === "demo")) {
      requireDefaultWorkspace(selectedWorkspace);
      printJson(write, spine.startDemo());
      return 0;
    }
    if (command === "demo-approve") {
      requireDefaultWorkspace(selectedWorkspace);
      printJson(write, spine.resumeDemo(positions[1] ?? PROMOTION_APPROVAL_ID));
      return 0;
    }
    if (command === "run" && subcommand === "resume") {
      requireDefaultWorkspace(selectedWorkspace);
      const runId = positions[2] ?? RUN_ID;
      printJson(write, spine.resumeRun(runId));
      return 0;
    }
    if (command === "approvals" && subcommand === "list") {
      spine.initDemoWorkspace();
      printJson(write, new ApprovalService(database).approvals.listPending(selectedWorkspace));
      return 0;
    }
    if (command === "workers" && subcommand === "list") {
      printJson(write, new WorkerIdentityStore(database).listForWorkspace(selectedWorkspace));
      return 0;
    }
    if (command === "worker" && subcommand === "demo") {
      requireDefaultWorkspace(selectedWorkspace);
      printJson(write, runReferenceWorkerDemo(database));
      return 0;
    }
    if (command === "worker" && subcommand === "demo-approve") {
      requireDefaultWorkspace(selectedWorkspace);
      printJson(write, approveReferenceWorkerDemo(database));
      return 0;
    }
    if (command === "workers" && subcommand === "register") {
      const service = new WorkService(database);
      printJson(
        write,
        service.registerWorker({
          id: optionValue(args, "--id"),
          workspace_id: selectedWorkspace,
          name: requireOption(args, "--name"),
          runtime: requireOption(args, "--runtime"),
          version: optionValue(args, "--version"),
          role_id: optionValue(args, "--role"),
          allowed_capabilities: commaList(optionValue(args, "--capabilities")),
          actor: "cli_operator",
        }),
      );
      return 0;
    }
    if (command === "work" && subcommand === "list") {
      printJson(write, new WorkItemStore(database).listForWorkspace(selectedWorkspace));
      return 0;
    }
    if (command === "work" && subcommand === "show") {
      const workId = positions[2];
      if (!workId) {
        throw new Error("work id is required");
      }
      const work = new WorkItemStore(database).get(workId);
      if (!work || work.workspace_id !== selectedWorkspace) {
        throw new Error(`work item not found: ${workId}`);
      }
      printJson(write, work);
      return 0;
    }
    if (command === "work" && subcommand === "create") {
      const service = new WorkService(database);
      printJson(
        write,
        service.createWork({
          id: optionValue(args, "--id"),
          workspace_id: selectedWorkspace,
          title: requireOption(args, "--title"),
          objective: requireOption(args, "--objective"),
          owner: requireOption(args, "--owner"),
          reviewer: optionValue(args, "--reviewer"),
          priority: (optionValue(args, "--priority") ?? "medium") as never,
          risk_level: (optionValue(args, "--risk") ?? "low") as never,
          success_criteria: commaList(optionValue(args, "--criteria")),
          actor: "cli_operator",
        }),
      );
      return 0;
    }
    if (command === "work" && subcommand === "assign") {
      const workId = positions[2];
      if (!workId) {
        throw new Error("work id is required");
      }
      printJson(
        write,
        new WorkService(database).assignWork({
          work_item_id: workId,
          owner: requireOption(args, "--owner"),
          reviewer: optionValue(args, "--reviewer"),
          actor: "cli_operator",
        }),
      );
      return 0;
    }
    if (command === "work" && subcommand === "status") {
      const workId = positions[2];
      const status = positions[3] ?? optionValue(args, "--status");
      if (!workId || !status) {
        throw new Error("work id and status are required");
      }
      printJson(
        write,
        new WorkService(database).setStatus({
          work_item_id: workId,
          status: status as never,
          actor: "cli_operator",
        }),
      );
      return 0;
    }
    if (command === "work" && subcommand === "outcome") {
      const workId = positions[2];
      if (!workId) {
        throw new Error("work id is required");
      }
      printJson(
        write,
        new WorkService(database).submitWorkerOutcome({
          id: optionValue(args, "--id"),
          workspace_id: selectedWorkspace,
          envelope_id: requireOption(args, "--envelope"),
          worker_id: requireOption(args, "--worker"),
          status: (optionValue(args, "--status") ?? "completed") as never,
          summary: requireOption(args, "--summary"),
          output: jsonOption(optionValue(args, "--output") ?? optionValue(args, "--input")),
          idempotency_key: `work:${workId}:outcome:${requireOption(args, "--envelope")}`,
        }),
      );
      return 0;
    }
    if (command === "work" && subcommand === "outcomes") {
      const workId = positions[2];
      if (!workId) {
        throw new Error("work id is required");
      }
      printJson(write, new WorkerOutcomeStore(database).listForWorkItem(workId));
      return 0;
    }
    if (command === "work" && subcommand === "review") {
      const workId = positions[2];
      const decision = positions[3] ?? optionValue(args, "--decision");
      if (!workId || !decision) {
        throw new Error("work id and review decision are required");
      }
      printJson(
        write,
        new WorkService(database).reviewWork({
          work_item_id: workId,
          decision: decision as never,
          actor: "cli_operator",
        }),
      );
      return 0;
    }
    if (command === "work" && subcommand === "envelope") {
      const workId = positions[2];
      if (!workId) {
        throw new Error("work id is required");
      }
      printJson(
        write,
        new WorkService(database).createBoundedEnvelope({
          id: optionValue(args, "--id"),
          workspace_id: selectedWorkspace,
          work_item_id: workId,
          worker_id: requireOption(args, "--worker"),
          issued_by: { actor_type: "operator", actor_id: "cli_operator", display_name: null },
          allowed_capabilities: commaList(optionValue(args, "--capabilities")),
          input: jsonOption(optionValue(args, "--input")),
        }),
      );
      return 0;
    }
    if (command === "work" && subcommand === "envelopes") {
      const workId = positions[2];
      if (!workId) {
        throw new Error("work id is required");
      }
      printJson(write, new BoundedWorkEnvelopeStore(database).listForWorkItem(workId));
      return 0;
    }
    if (command === "ingest" && (subcommand === "list" || subcommand === "")) {
      printJson(write, new IngestionRecordStore(database).listForWorkspace(selectedWorkspace));
      return 0;
    }
    if (command === "ingest" && subcommand === "record") {
      printJson(
        write,
        new IngestionService(database).record({
          id: optionValue(args, "--id"),
          workspace_id: selectedWorkspace,
          source: {
            provider: optionValue(args, "--source-provider") ?? "openmao",
            external_id: optionValue(args, "--source-id"),
            external_url: optionValue(args, "--source-url"),
          },
          actor: {
            actor_type: (optionValue(args, "--actor-type") ?? "worker") as never,
            actor_id: requireOption(args, "--actor-id"),
            display_name: null,
          },
          kind: (optionValue(args, "--kind") ?? "event") as never,
          target_run_id: optionValue(args, "--run"),
          target_work_item_id: optionValue(args, "--work"),
          payload: jsonOption(optionValue(args, "--payload")),
          idempotency_key: requireOption(args, "--idempotency-key"),
        }),
      );
      return 0;
    }
    if (command === "approvals" && subcommand === "approve") {
      const approvalId = positions[2];
      if (!approvalId) {
        throw new Error("approval id is required");
      }
      const approval = new ApprovalService(database).approvals.get(approvalId);
      if (approval?.payload.target_type === "capability_call" && approval.run_id === RUN_ID) {
        printJson(
          write,
          spine.resumeApprovedCapability(approvalId, { workspace_id: selectedWorkspace }),
        );
      } else if (
        approval?.payload.target_type === "capability_call" &&
        approval.run_id === REFERENCE_RUN_ID
      ) {
        printJson(write, approveReferenceWorkerDemo(database));
      } else if (approval?.payload.target_type === "capability_call") {
        new ApprovalService(database).approve(approvalId, {
          workspace_id: selectedWorkspace,
          actor: "cli_operator",
        });
        printJson(
          write,
          createLocalCapabilityRegistry(database).resumeApprovedCall(approvalId, {
            workspace_id: selectedWorkspace,
          }),
        );
      } else if (approvalId === PROMOTION_APPROVAL_ID) {
        requireDefaultWorkspace(selectedWorkspace);
        printJson(write, spine.resumeDemo(approvalId));
      } else {
        printJson(
          write,
          createApprovalServiceWithApplications(database).approve(approvalId, {
            workspace_id: selectedWorkspace,
          }),
        );
      }
      return 0;
    }
    if (command === "approvals" && subcommand === "reject") {
      const approvalId = positions[2];
      if (!approvalId) {
        throw new Error("approval id is required");
      }
      printJson(
        write,
        new ApprovalService(database).reject(approvalId, {
          workspace_id: selectedWorkspace,
        }),
      );
      return 0;
    }
    if (command === "events") {
      const runId = subcommand || null;
      printJson(
        write,
        runId
          ? new EventStore(database).listForRun(selectedWorkspace, runId)
          : new EventStore(database).listForWorkspace(selectedWorkspace),
      );
      return 0;
    }
    if (command === "console") {
      write("OpenMAO console is served by `make console` at http://127.0.0.1:8000/console.");
      return 0;
    }
    if (command === "world") {
      const runId = optionValue(args, "--run") ?? (subcommand || null);
      const defaultRun = new RunStore(database).get(RUN_ID);
      const fallbackRunId =
        selectedWorkspace === WORKSPACE_ID && defaultRun?.workspace_id === selectedWorkspace
          ? RUN_ID
          : null;
      printJson(
        write,
        new WorldModelService(database).rebuild(selectedWorkspace, runId ?? fallbackRunId),
      );
      return 0;
    }

    throw new Error(`unknown command: ${args.join(" ")}`);
  } finally {
    database.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
