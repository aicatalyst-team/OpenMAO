import { createHash } from "node:crypto";

import {
  type Cadence,
  type CadenceKind,
  CadenceSchema,
  EventPayloadSchema,
  formatUtc,
  type Notification,
  NotificationSchema,
  newId,
  normalizeInstant,
  type OrgChangeEvidence,
} from "../contracts/index.js";
import { LearningService } from "../learning/index.js";
import {
  ApprovalStore,
  CadenceStore,
  type Database,
  EventStore,
  NotificationStore,
} from "../persistence/index.js";
import { WorldModelService } from "../world/index.js";

const STALE_APPROVAL_THRESHOLD_SECONDS = 7 * 24 * 60 * 60;

export const DEFAULT_CADENCES: ReadonlyArray<{ kind: CadenceKind; interval_seconds: number }> = [
  { kind: "learning_scan", interval_seconds: 60 * 60 },
  { kind: "stale_approval_sweep", interval_seconds: 24 * 60 * 60 },
  { kind: "status_digest", interval_seconds: 24 * 60 * 60 },
];

export type TickResult = {
  workspace_id: string;
  at: string;
  fired: Array<{ cadence_id: string; kind: CadenceKind; notification_ids: string[] }>;
  notification_count: number;
};

/**
 * The Chief of Staff is the organization's communication loop: on a cadence it
 * senses state and reports evidence-backed observations to the human. It is the
 * existing `learning_service` actor pattern given a schedule, a voice, and a
 * broader sensing remit.
 *
 * Communication-half only. This service is constructed without any capability
 * registry or provider, so it is structurally incapable of taking a side effect:
 * it can sense (read) and speak (notify/event), but action autonomy stays behind
 * the governance gate. Every action it does take is evented under its own actor
 * identity, never the human's.
 */
export class ChiefOfStaffService {
  static readonly ACTOR = "chief_of_staff";

  private readonly approvals: ApprovalStore;
  private readonly cadences: CadenceStore;
  private readonly events: EventStore;
  private readonly learning: LearningService;
  private readonly notifications: NotificationStore;
  private readonly world: WorldModelService;

  constructor(private readonly database: Database) {
    this.approvals = new ApprovalStore(database);
    this.cadences = new CadenceStore(database);
    this.events = new EventStore(database);
    this.learning = new LearningService(database);
    this.notifications = new NotificationStore(database);
    this.world = new WorldModelService(database);
  }

  // Seed the standard cadences for a workspace, due at `at`. Idempotent: stable
  // ids mean re-seeding returns the existing cadences without duplicating them.
  ensureDefaultCadences(workspaceId: string, rawAt: string): Cadence[] {
    const at = normalizeInstant(rawAt);
    return this.database.transaction(() =>
      DEFAULT_CADENCES.map(({ kind, interval_seconds }) =>
        this.cadences.save(
          CadenceSchema.parse({
            id: stableCadenceId(workspaceId, kind),
            workspace_id: workspaceId,
            kind,
            interval_seconds,
            enabled: true,
            created_at: at,
            last_fired_at: null,
            next_due_at: at,
          }),
        ),
      ),
    );
  }

  addCadence(input: {
    workspace_id: string;
    kind: CadenceKind;
    interval_seconds: number;
    at: string;
    id?: string | null;
  }): Cadence {
    const at = normalizeInstant(input.at);
    return this.cadences.save(
      CadenceSchema.parse({
        id: input.id ?? newId("cadence"),
        workspace_id: input.workspace_id,
        kind: input.kind,
        interval_seconds: input.interval_seconds,
        enabled: true,
        created_at: at,
        last_fired_at: null,
        next_due_at: at,
      }),
    );
  }

  // Fire every cadence due at `at`. Time enters as a parameter and is recorded on
  // a `cadence.fired` event, so the whole loop replays deterministically from the
  // event log. Re-ticking at the same `at` is a no-op: a fired cadence advances
  // its next_due_at past `at`, and notifications carry stable ids.
  tick(input: { workspace_id: string; at: string }): TickResult {
    const workspace_id = input.workspace_id;
    const at = normalizeInstant(input.at);
    return this.database.transaction(() => {
      const fired: TickResult["fired"] = [];
      let notificationCount = 0;
      for (const cadence of this.cadences.listDue(workspace_id, at)) {
        this.events.append({
          workspace_id,
          kind: "cadence.fired",
          actor: ChiefOfStaffService.ACTOR,
          payload: EventPayloadSchema.parse({
            data: { cadence_id: cadence.id, kind: cadence.kind, at },
            refs: [cadence.id],
          }),
          idempotency_key: `cos:fired:${cadence.id}:${at}`,
          timestamp: at,
        });
        const notificationIds = this.runSensor(cadence, at);
        notificationCount += notificationIds.length;
        this.cadences.advance(cadence.id, {
          last_fired_at: at,
          next_due_at: addSeconds(at, cadence.interval_seconds),
        });
        fired.push({
          cadence_id: cadence.id,
          kind: cadence.kind,
          notification_ids: notificationIds,
        });
      }
      return { workspace_id, at, fired, notification_count: notificationCount };
    });
  }

  markRead(input: { workspace_id: string; notification_id: string; at: string }): Notification {
    const notification = this.notifications.get(input.notification_id);
    if (!notification || notification.workspace_id !== input.workspace_id) {
      throw new Error(`notification not found in workspace: ${input.notification_id}`);
    }
    return this.notifications.markRead(input.notification_id, {
      read_at: normalizeInstant(input.at),
    });
  }

  getNotification(workspaceId: string, notificationId: string): Notification | null {
    const notification = this.notifications.get(notificationId);
    return notification && notification.workspace_id === workspaceId ? notification : null;
  }

  listNotifications(workspaceId: string, options: { unreadOnly?: boolean } = {}): Notification[] {
    return this.notifications.listForWorkspace(workspaceId, options);
  }

  listCadences(workspaceId: string): Cadence[] {
    return this.cadences.listForWorkspace(workspaceId);
  }

  private runSensor(cadence: Cadence, at: string): string[] {
    switch (cadence.kind) {
      case "learning_scan":
        return this.senseLearning(cadence.workspace_id, at);
      case "stale_approval_sweep":
        return this.senseStaleApprovals(cadence.workspace_id, at);
      case "status_digest":
        return this.senseStatusDigest(cadence.workspace_id, at);
      default:
        return [];
    }
  }

  private senseLearning(workspaceId: string, at: string): string[] {
    // Reuses the institutional-learning scan. Detecting a pattern and recording an
    // evidence-backed, human-gated OrgChangeProposal is the communication side of the
    // dial (proposing, not applying). scan is idempotent on stable proposal ids, and
    // passing `at` stamps the proposals it records, so re-ticks never re-notify and the
    // surfaced signals stay deterministic.
    const scan = this.learning.scan(workspaceId, at);
    const ids: string[] = [];
    for (const { proposal } of scan.proposals) {
      const { notification, created } = this.emit({
        workspace_id: workspaceId,
        kind: "learning_proposal",
        severity: proposal.impact === "high" ? "attention" : "info",
        summary: `Proposed ${proposal.change_type} change: ${proposal.rationale}`,
        evidence: proposal.evidence,
        refs: [proposal.id],
        dedupe_key: proposal.id,
        at,
      });
      if (created) {
        ids.push(notification.id);
      }
    }
    return ids;
  }

  private senseStaleApprovals(workspaceId: string, at: string): string[] {
    const ids: string[] = [];
    const pending = this.approvals
      .listPending(workspaceId)
      // Exclude the review approvals the learning sensor itself mints for proposals:
      // those already surface as learning_proposal notices, so don't double-report them.
      .filter((approval) => approval.payload.target_type !== "org_change_proposal");
    for (const approval of pending) {
      if (ageInSeconds(approval.created_at, at) < STALE_APPROVAL_THRESHOLD_SECONDS) {
        continue;
      }
      const { notification, created } = this.emit({
        workspace_id: workspaceId,
        kind: "stale_approval",
        severity: "attention",
        summary: `Approval pending since ${approval.created_at}: ${approval.payload.reason}`,
        evidence: [
          {
            kind: "approval",
            ref_id: approval.id,
            summary: "Pending approval request",
            weight: 1,
          },
        ],
        refs: [approval.id],
        dedupe_key: approval.id,
        at,
      });
      if (created) {
        ids.push(notification.id);
      }
    }
    return ids;
  }

  private senseStatusDigest(workspaceId: string, at: string): string[] {
    const snapshot = this.world.rebuild(workspaceId);
    const summary =
      `Status: ${snapshot.active_work.length} active work, ${snapshot.blockers.length} blockers, ` +
      `${snapshot.pending_approvals.length} pending approvals, ` +
      `${snapshot.open_org_change_proposals.length} open proposals.`;
    const evidence: OrgChangeEvidence[] = [
      ...snapshot.pending_approvals.map((id) => ({
        kind: "approval" as const,
        ref_id: id,
        summary: "Pending approval",
        weight: 1,
      })),
      ...snapshot.open_org_change_proposals.map((id) => ({
        kind: "other" as const,
        ref_id: id,
        summary: "Open org-change proposal",
        weight: 1,
      })),
    ];
    const { notification, created } = this.emit({
      workspace_id: workspaceId,
      kind: "status_digest",
      severity: "info",
      summary,
      evidence,
      refs: [...snapshot.pending_approvals, ...snapshot.open_org_change_proposals],
      dedupe_key: at,
      at,
    });
    return created ? [notification.id] : [];
  }

  private emit(input: {
    workspace_id: string;
    kind: string;
    severity: Notification["severity"];
    summary: string;
    evidence: OrgChangeEvidence[];
    refs: string[];
    dedupe_key: string;
    at: string;
  }): { notification: Notification; created: boolean } {
    const id = stableNotificationId(input.workspace_id, input.kind, input.dedupe_key);
    const existing = this.notifications.get(id);
    if (existing) {
      return { notification: existing, created: false };
    }
    const event = this.events.append({
      workspace_id: input.workspace_id,
      kind: "cos.notification.created",
      actor: ChiefOfStaffService.ACTOR,
      payload: EventPayloadSchema.parse({
        data: { notification_id: id, notification_kind: input.kind },
        refs: [id],
      }),
      idempotency_key: `cos:notify:${id}`,
      timestamp: input.at,
    });
    const notification = this.notifications.append(
      NotificationSchema.parse({
        id,
        workspace_id: input.workspace_id,
        actor: ChiefOfStaffService.ACTOR,
        kind: input.kind,
        severity: input.severity,
        summary: input.summary,
        evidence: input.evidence,
        refs: input.refs,
        status: "unread",
        source_event_id: event.id,
        created_at: input.at,
        read_at: null,
      }),
    );
    return { notification, created: true };
  }
}

function stableCadenceId(workspaceId: string, kind: string): string {
  return `cadence_${hash([workspaceId, kind].join("|"))}`;
}

function stableNotificationId(workspaceId: string, kind: string, dedupeKey: string): string {
  return `notif_${hash([workspaceId, kind, dedupeKey].join("|"))}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function addSeconds(timestamp: string, seconds: number): string {
  return formatUtc(Date.parse(timestamp) + seconds * 1000);
}

function ageInSeconds(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 1000;
}
