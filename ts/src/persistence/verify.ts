import type { Database } from "./database.js";
import { type EventChainVerification, EventStore } from "./events.js";
import { WorkspaceStore } from "./workspaces.js";

export type WorkspaceChainReport = {
  workspace_id: string;
  events: number;
  verification: EventChainVerification;
};

export type ChainVerificationReport = {
  ok: boolean;
  workspaces: WorkspaceChainReport[];
};

/**
 * Re-derives the hash chain of every workspace in the store and reports the
 * first break per workspace. The chain itself is sealed by EventStore.append;
 * this is the operator-facing read path that turns "the log is tamper-evident"
 * into a one-command check.
 */
export function verifyAllChains(database: Database): ChainVerificationReport {
  const events = new EventStore(database);
  const workspaces = new WorkspaceStore(database).listAll();
  const countStatement = database.connection.prepare(
    "SELECT COUNT(*) AS count FROM events WHERE workspace_id = ?",
  );
  const reports = workspaces.map((workspace) => ({
    workspace_id: workspace.id,
    events: (countStatement.get(workspace.id) as { count: number }).count,
    // Events written before the hash chain landed carry null hashes and are
    // reported as a break ("event is not hash-chained"): unverifiable rows
    // fail closed rather than passing silently.
    verification: events.verifyChain(workspace.id),
  }));
  return {
    ok: reports.every((report) => report.verification.ok),
    workspaces: reports,
  };
}
