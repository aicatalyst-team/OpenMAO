import { ChiefOfStaffService } from "../chief_of_staff/index.js";
import { EventPayloadSchema, type Notification, normalizeInstant } from "../contracts/index.js";
import { type Database, EventStore } from "../persistence/index.js";
import { ConsoleTransport, type Digest, type OutboundTransport } from "./transport.js";

// Default volume cap: a single digest never lists more than this many notifications, so a busy
// beat can't flood the human. Anything beyond is counted as `truncated`.
export const DEFAULT_MAX_NOTIFICATIONS_PER_DIGEST = 20;

export type BeatResult = {
  workspace_id: string;
  at: string;
  notification_count: number;
  delivered: boolean;
  truncated: number;
};

export type RunOptions = {
  workspace_id: string;
  interval_seconds: number;
  clock: () => string;
  sleep: (ms: number) => Promise<void>;
  shouldStop: () => boolean;
  onBeat?: (result: BeatResult) => void;
};

/**
 * The heartbeat turns the Chief of Staff's manually-driven `tick` into a self-running loop: on a
 * cadence it beats — senses (via the CoS) and, if there is anything new, delivers one outbound
 * digest. It is **report-only**: it composes only the communication-half CoS and an outbound
 * transport, so it is structurally incapable of taking an org side effect or touching the autonomy
 * dial. Time enters every beat as a recorded parameter, so the whole daemon replays deterministically
 * from the event log.
 */
export class HeartbeatService {
  private readonly cos: ChiefOfStaffService;
  private readonly events: EventStore;
  private readonly transport: OutboundTransport;
  private readonly maxPerDigest: number;

  constructor(
    private readonly database: Database,
    options: { transport?: OutboundTransport; maxNotificationsPerDigest?: number } = {},
  ) {
    this.cos = new ChiefOfStaffService(database);
    this.events = new EventStore(database);
    this.transport = options.transport ?? new ConsoleTransport();
    this.maxPerDigest = options.maxNotificationsPerDigest ?? DEFAULT_MAX_NOTIFICATIONS_PER_DIGEST;
  }

  /**
   * One heartbeat at recorded time `at`: tick the Chief of Staff, then deliver a digest of the
   * notifications that beat produced. The decision (tick + events) is transactional and recorded;
   * physical delivery happens after commit, so a future network transport can fail without
   * corrupting the log. Idempotent: re-beating at the same `at` re-runs an idempotent tick (no new
   * notifications) and delivers nothing.
   */
  beat(input: { workspace_id: string; at: string }): BeatResult {
    const workspace_id = input.workspace_id;
    const at = normalizeInstant(input.at);
    const beatKey = `heartbeat:beat:${workspace_id}:${at}`;
    const prepared = this.database.transaction(
      (): { result: BeatResult; digest: Digest | null } => {
        // Idempotent replay: if this instant was already beaten, do nothing and report no new
        // delivery. The first beat at `at` is authoritative; a re-beat is a deterministic no-op
        // (re-running the tick would see nothing new, since cadences have already advanced).
        if (this.events.getByIdempotencyKey(workspace_id, beatKey)) {
          return {
            result: { workspace_id, at, notification_count: 0, delivered: false, truncated: 0 },
            digest: null,
          };
        }
        const tick = this.cos.tick({ workspace_id, at });
        const newIds = tick.fired.flatMap((entry) => entry.notification_ids);
        const all = newIds
          .map((id) => this.cos.getNotification(workspace_id, id))
          .filter((notification): notification is Notification => notification !== null);
        const shown = all.slice(0, this.maxPerDigest);
        const truncated = all.length - shown.length;

        this.events.append({
          workspace_id,
          kind: "heartbeat.beat",
          actor: ChiefOfStaffService.ACTOR,
          payload: EventPayloadSchema.parse({
            data: { at, notification_count: all.length, delivered: all.length > 0 },
            refs: newIds,
          }),
          idempotency_key: `heartbeat:beat:${workspace_id}:${at}`,
          timestamp: at,
        });

        if (all.length === 0) {
          return {
            result: { workspace_id, at, notification_count: 0, delivered: false, truncated: 0 },
            digest: null,
          };
        }

        const digest: Digest = {
          workspace_id,
          at,
          notifications: shown,
          truncated,
          summary: `${all.length} new notification(s)`,
        };
        this.events.append({
          workspace_id,
          kind: "cos.digest.delivered",
          actor: ChiefOfStaffService.ACTOR,
          payload: EventPayloadSchema.parse({
            data: {
              at,
              transport: this.transport.name,
              notification_count: shown.length,
              truncated,
            },
            refs: shown.map((notification) => notification.id),
          }),
          idempotency_key: `heartbeat:digest:${workspace_id}:${at}`,
          timestamp: at,
        });
        return {
          result: { workspace_id, at, notification_count: all.length, delivered: true, truncated },
          digest,
        };
      },
    );

    if (prepared.digest) {
      this.transport.deliver(prepared.digest);
    }
    return prepared.result;
  }

  /**
   * Run the heartbeat as a daemon: beat, then sleep `interval_seconds`, until `shouldStop()` is
   * true. `clock`, `sleep`, and `shouldStop` are injected so the loop is deterministic under test
   * and uses wall-clock time in production. Returns the number of beats performed.
   */
  async run(options: RunOptions): Promise<number> {
    let beats = 0;
    while (!options.shouldStop()) {
      const result = this.beat({ workspace_id: options.workspace_id, at: options.clock() });
      beats += 1;
      options.onBeat?.(result);
      if (options.shouldStop()) {
        break;
      }
      await options.sleep(options.interval_seconds * 1000);
    }
    return beats;
  }
}
