import {
  type ApprovalRequest,
  ApprovalRequestSchema,
  type Run,
  RunSchema,
  type RunStatus,
  RunStatusSchema,
  utcNow,
} from "../contracts/index.js";
import type { Database } from "./database.js";
import { dumpJson } from "./serialization.js";

const terminalStatuses = new Set<RunStatus>(["completed", "failed"]);
const allowedTransitions: Record<RunStatus, Set<RunStatus>> = {
  queued: new Set(["running"]),
  running: new Set(["suspended_approval", "completed", "failed"]),
  suspended_approval: new Set(["running", "failed"]),
  completed: new Set(),
  failed: new Set(),
};

type PayloadRow = { payload_json: string };
type LockRow = { run_id: string };

const unset = Symbol("unset");
type MaybeUnset<T> = T | typeof unset;

export class ActiveRunExistsError extends Error {}
export class TerminalRunTransitionError extends Error {}
export class InvalidRunTransitionError extends Error {}

export type SetRunStatusOptions = {
  active_node?: string | null;
  suspended_approval_id?: string | null;
  updated_at?: string | null;
};

export class RunStore {
  constructor(private readonly database: Database) {}

  create(run: Run): Run {
    const parsed = RunSchema.parse(run);

    return this.database.transaction(() => {
      this.validateApprovalPointer(
        parsed.id,
        parsed.workspace_id,
        parsed.status,
        parsed.suspended_approval_id,
      );
      if (!terminalStatuses.has(parsed.status)) {
        const lock = this.database.connection
          .prepare("SELECT run_id FROM active_run_locks WHERE workspace_id = ?")
          .get(parsed.workspace_id) as LockRow | undefined;
        if (lock) {
          throw new ActiveRunExistsError(
            `workspace ${parsed.workspace_id} already has active run ${lock.run_id}`,
          );
        }
      }

      this.database.connection
        .prepare(
          `INSERT INTO runs (
            id, workspace_id, status, active_node, suspended_approval_id,
            created_at, updated_at, payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          parsed.id,
          parsed.workspace_id,
          parsed.status,
          parsed.active_node,
          parsed.suspended_approval_id,
          parsed.created_at,
          parsed.updated_at,
          dumpJson(parsed),
        );

      if (!terminalStatuses.has(parsed.status)) {
        this.database.connection
          .prepare(
            `INSERT INTO active_run_locks (workspace_id, run_id, acquired_at, heartbeat_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(parsed.workspace_id, parsed.id, parsed.created_at, parsed.updated_at);
      }

      return parsed;
    });
  }

  get(runId: string): Run | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM runs WHERE id = ?")
      .get(runId) as PayloadRow | undefined;

    return row ? RunSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listForWorkspace(workspaceId: string): Run[] {
    const rows = this.database.connection
      .prepare(
        `SELECT payload_json
         FROM runs
         WHERE workspace_id = ?
         ORDER BY updated_at, id`,
      )
      .all(workspaceId) as PayloadRow[];

    return rows.map((row) => RunSchema.parse(JSON.parse(row.payload_json)));
  }

  setStatus(runId: string, status: RunStatus, options: SetRunStatusOptions = {}): Run {
    const parsedStatus = RunStatusSchema.parse(status);

    return this.database.transaction(() => {
      const current = this.get(runId);
      if (!current) {
        throw new Error(`run not found: ${runId}`);
      }

      const nextActiveNode: MaybeUnset<string | null> =
        "active_node" in options ? (options.active_node ?? null) : unset;
      const nextSuspendedApprovalId: MaybeUnset<string | null> =
        "suspended_approval_id" in options ? (options.suspended_approval_id ?? null) : unset;
      const activeNode = nextActiveNode === unset ? current.active_node : nextActiveNode;
      const suspendedApprovalId =
        nextSuspendedApprovalId === unset
          ? parsedStatus === "suspended_approval"
            ? current.suspended_approval_id
            : null
          : nextSuspendedApprovalId;

      if (terminalStatuses.has(current.status)) {
        const updatedAtMatches = !options.updated_at || options.updated_at === current.updated_at;
        if (
          parsedStatus === current.status &&
          activeNode === current.active_node &&
          suspendedApprovalId === current.suspended_approval_id &&
          updatedAtMatches
        ) {
          return current;
        }

        throw new TerminalRunTransitionError(`terminal run cannot be mutated: ${runId}`);
      }

      if (
        parsedStatus !== current.status &&
        !allowedTransitions[current.status].has(parsedStatus)
      ) {
        throw new InvalidRunTransitionError(
          `invalid run transition for ${runId}: ${current.status} -> ${parsedStatus}`,
        );
      }
      if (
        current.status === "suspended_approval" &&
        parsedStatus === "suspended_approval" &&
        suspendedApprovalId !== current.suspended_approval_id
      ) {
        throw new InvalidRunTransitionError(`suspended approval id cannot be replaced: ${runId}`);
      }
      if (current.status === "suspended_approval" && parsedStatus === "running") {
        this.validateApprovedResume(current);
      }
      if (parsedStatus === "suspended_approval" && !suspendedApprovalId) {
        throw new InvalidRunTransitionError(
          `suspended approval run requires an approval id: ${runId}`,
        );
      }
      if (parsedStatus !== "suspended_approval" && suspendedApprovalId) {
        throw new InvalidRunTransitionError(
          `only suspended approval runs may carry an approval id: ${runId}`,
        );
      }

      this.validateApprovalPointer(
        current.id,
        current.workspace_id,
        parsedStatus,
        suspendedApprovalId,
      );

      const updated = RunSchema.parse({
        ...current,
        status: parsedStatus,
        active_node: activeNode,
        suspended_approval_id: suspendedApprovalId,
        updated_at: options.updated_at ?? utcNow(),
      });

      this.database.connection
        .prepare(
          `UPDATE runs
           SET status = ?, active_node = ?, suspended_approval_id = ?, updated_at = ?, payload_json = ?
           WHERE id = ?`,
        )
        .run(
          updated.status,
          updated.active_node,
          updated.suspended_approval_id,
          updated.updated_at,
          dumpJson(updated),
          updated.id,
        );

      if (terminalStatuses.has(updated.status)) {
        this.database.connection
          .prepare("DELETE FROM active_run_locks WHERE workspace_id = ? AND run_id = ?")
          .run(updated.workspace_id, updated.id);
      } else {
        this.refreshActiveRunLock(updated);
      }

      return updated;
    });
  }

  activeRunId(workspaceId: string): string | null {
    const row = this.database.connection
      .prepare("SELECT run_id FROM active_run_locks WHERE workspace_id = ?")
      .get(workspaceId) as LockRow | undefined;

    return row?.run_id ?? null;
  }

  private refreshActiveRunLock(run: Run): void {
    const lock = this.database.connection
      .prepare("SELECT run_id FROM active_run_locks WHERE workspace_id = ?")
      .get(run.workspace_id) as LockRow | undefined;

    if (lock && lock.run_id !== run.id) {
      throw new ActiveRunExistsError(
        `workspace ${run.workspace_id} already has active run ${lock.run_id}`,
      );
    }
    if (!lock) {
      this.database.connection
        .prepare(
          `INSERT INTO active_run_locks (workspace_id, run_id, acquired_at, heartbeat_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(run.workspace_id, run.id, run.updated_at, run.updated_at);
      return;
    }

    this.database.connection
      .prepare("UPDATE active_run_locks SET heartbeat_at = ? WHERE workspace_id = ? AND run_id = ?")
      .run(run.updated_at, run.workspace_id, run.id);
  }

  private validateApprovalPointer(
    runId: string,
    workspaceId: string,
    status: RunStatus,
    approvalId: string | null,
  ): void {
    if (status !== "suspended_approval") {
      if (approvalId) {
        throw new InvalidRunTransitionError(
          `only suspended approval runs may carry an approval id: ${runId}`,
        );
      }
      return;
    }

    if (!approvalId) {
      throw new InvalidRunTransitionError(
        `suspended approval run requires an approval id: ${runId}`,
      );
    }

    const row = this.database.connection
      .prepare(
        `SELECT payload_json
         FROM approval_requests
         WHERE id = ? AND workspace_id = ? AND run_id = ? AND status = 'pending'`,
      )
      .get(approvalId, workspaceId, runId) as PayloadRow | undefined;

    if (!row) {
      throw new InvalidRunTransitionError(
        `suspended approval id must reference a pending approval request: ${approvalId}`,
      );
    }
  }

  private validateApprovedResume(run: Run): void {
    if (!run.suspended_approval_id) {
      throw new InvalidRunTransitionError(
        `suspended run cannot resume without an approval id: ${run.id}`,
      );
    }

    const row = this.database.connection
      .prepare(
        `SELECT payload_json
         FROM approval_requests
         WHERE id = ? AND workspace_id = ? AND run_id = ?`,
      )
      .get(run.suspended_approval_id, run.workspace_id, run.id) as PayloadRow | undefined;

    if (!row) {
      throw new InvalidRunTransitionError(
        `suspended approval must be resolved before resume: ${run.suspended_approval_id}`,
      );
    }

    const approval = ApprovalRequestSchema.parse(JSON.parse(row.payload_json)) as ApprovalRequest;
    if (approval.status === "approved") {
      return;
    }
    if (approval.status === "rejected" && approval.on_reject === "skip_action") {
      return;
    }

    throw new InvalidRunTransitionError(
      `suspended approval must be approved or rejected with skip_action before resume: ${run.suspended_approval_id}`,
    );
  }
}
