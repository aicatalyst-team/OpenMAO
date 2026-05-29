import { type Notification, NotificationSchema, utcNow } from "../contracts/index.js";
import type { Database } from "./database.js";
import { dumpJson } from "./serialization.js";

type PayloadRow = { payload_json: string };

/**
 * Stores Chief of Staff notifications: evidence-backed observations the
 * organization surfaces to the human. Notifications are derived from a stable id,
 * so `append` is idempotent — re-running a sensor never duplicates a notice.
 */
export class NotificationStore {
  constructor(private readonly database: Database) {}

  append(notification: Notification): Notification {
    const parsed = NotificationSchema.parse(notification);
    return this.database.transaction(() => {
      const existing = this.get(parsed.id);
      if (existing) {
        return existing;
      }
      this.database.connection
        .prepare(
          `INSERT INTO notifications (id, workspace_id, status, created_at, payload_json)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(parsed.id, parsed.workspace_id, parsed.status, parsed.created_at, dumpJson(parsed));
      return parsed;
    });
  }

  get(notificationId: string): Notification | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM notifications WHERE id = ?")
      .get(notificationId) as PayloadRow | undefined;
    return row ? NotificationSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listForWorkspace(workspaceId: string, options: { unreadOnly?: boolean } = {}): Notification[] {
    const rows = (
      options.unreadOnly
        ? this.database.connection.prepare(
            `SELECT payload_json FROM notifications
             WHERE workspace_id = ? AND status = 'unread'
             ORDER BY created_at, id`,
          )
        : this.database.connection.prepare(
            `SELECT payload_json FROM notifications
             WHERE workspace_id = ?
             ORDER BY created_at, id`,
          )
    ).all(workspaceId) as PayloadRow[];
    return rows.map((row) => NotificationSchema.parse(JSON.parse(row.payload_json)));
  }

  markRead(notificationId: string, options: { read_at?: string | null } = {}): Notification {
    return this.database.transaction(() => {
      const current = this.get(notificationId);
      if (!current) {
        throw new Error(`notification not found: ${notificationId}`);
      }
      if (current.status === "read") {
        return current;
      }
      const updated = NotificationSchema.parse({
        ...current,
        status: "read",
        read_at: options.read_at ?? utcNow(),
      });
      this.database.connection
        .prepare("UPDATE notifications SET status = ?, payload_json = ? WHERE id = ?")
        .run(updated.status, dumpJson(updated), updated.id);
      return updated;
    });
  }
}
