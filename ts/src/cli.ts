#!/usr/bin/env node
import { ApprovalService } from "./governance/index.js";
import { EventStore, RunStore } from "./persistence/index.js";
import { createApprovalServiceWithApplications } from "./runtime/approvals.js";
import { openLocalDatabase } from "./runtime/local.js";
import { PROMOTION_APPROVAL_ID, RUN_ID, SpineService, WORKSPACE_ID } from "./spine/index.js";
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
  const positions: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--workspace" || arg === "--run") {
      index += 1;
      continue;
    }
    if (arg !== undefined) {
      positions.push(arg);
    }
  }
  return positions;
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
        "openmao demo | demo-approve | init | run demo|resume | approvals list|approve|reject <id> [--workspace workspace_id] | events [run_id]|--workspace [workspace_id] | world [--run run_id] [--workspace workspace_id] | console",
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
    if (command === "approvals" && subcommand === "approve") {
      const approvalId = positions[2];
      if (!approvalId) {
        throw new Error("approval id is required");
      }
      const approval = new ApprovalService(database).approvals.get(approvalId);
      if (approval?.payload.target_type === "capability_call") {
        printJson(
          write,
          spine.resumeApprovedCapability(approvalId, { workspace_id: selectedWorkspace }),
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
