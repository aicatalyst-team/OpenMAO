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
  onError?: (error: unknown, at: string) => void;
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
   * notifications that beat produced — atomically. Delivery runs INSIDE the transaction (right
   * before the `cos.digest.delivered` event), so the event and the actual delivery commit together
   * or not at all: the log can never claim a delivery that didn't happen, and a transport throw
   * rolls the whole beat back (no events, the sensed notifications un-created) so a re-beat genuinely
   * retries. This requires a synchronous, fast transport; async/network transports that need
   * at-least-once delivery must sit behind an outbox (deferred). Idempotent: re-beating at the same
   * committed `at` is a deterministic no-op.
   */
  beat(input: { workspace_id: string; at: string }): BeatResult {
    const workspace_id = input.workspace_id;
    const at = normalizeInstant(input.at);
    const beatKey = `heartbeat:beat:${workspace_id}:${at}`;
    return this.database.transaction((): BeatResult => {
      // Idempotent replay: if this instant was already beaten AND committed, do nothing. (A beat
      // that rolled back left no event, so it is correctly retriable.)
      if (this.events.getByIdempotencyKey(workspace_id, beatKey)) {
        return { workspace_id, at, notification_count: 0, delivered: false, truncated: 0 };
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
        idempotency_key: beatKey,
        timestamp: at,
      });

      if (all.length === 0) {
        return { workspace_id, at, notification_count: 0, delivered: false, truncated: 0 };
      }

      const digest: Digest = {
        workspace_id,
        at,
        notifications: shown,
        truncated,
        summary: `${all.length} new notification(s)`,
      };
      // Deliver, then record the delivery — both inside the transaction. If the transport throws,
      // everything above rolls back and the beat retries on the next pass.
      this.transport.deliver(digest);
      this.events.append({
        workspace_id,
        kind: "cos.digest.delivered",
        actor: ChiefOfStaffService.ACTOR,
        payload: EventPayloadSchema.parse({
          data: { at, transport: this.transport.name, notification_count: shown.length, truncated },
          refs: shown.map((notification) => notification.id),
        }),
        idempotency_key: `heartbeat:digest:${workspace_id}:${at}`,
        timestamp: at,
      });
      return { workspace_id, at, notification_count: all.length, delivered: true, truncated };
    });
  }

  /**
   * Run the heartbeat as a daemon: beat, then sleep `interval_seconds`, until `shouldStop()` is
   * true. `clock`, `sleep`, and `shouldStop` are injected so the loop is deterministic under test
   * and uses wall-clock time in production. Returns the number of beats performed.
   */
  async run(options: RunOptions): Promise<number> {
    let beats = 0;
    while (!options.shouldStop()) {
      const at = options.clock();
      try {
        const result = this.beat({ workspace_id: options.workspace_id, at });
        beats += 1;
        options.onBeat?.(result);
      } catch (error) {
        // A failed beat rolled back atomically. Record it and keep beating rather than crashing the
        // daemon; the interval sleep below acts as a simple backoff.
        options.onError?.(error, at);
      }
      if (options.shouldStop()) {
        break;
      }
      await options.sleep(options.interval_seconds * 1000);
    }
    return beats;
  }
}
