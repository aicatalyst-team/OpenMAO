import type { Notification } from "../contracts/index.js";

/**
 * A digest is one outbound report from the Chief of Staff: the notifications a single heartbeat
 * produced, plus how many were held back by the volume cap. `summary` is a one-line headline.
 */
export type Digest = {
  workspace_id: string;
  at: string;
  notifications: Notification[];
  truncated: number;
  summary: string;
};

/**
 * The outbound side of the heartbeat — where a digest is delivered. M2 keeps this an abstraction
 * with simple local sinks (console for the daemon, recording for tests); real network transports
 * (email/webhook) are a later concern and should deliver out of the heartbeat's DB transaction.
 */
export interface OutboundTransport {
  readonly name: string;
  deliver(digest: Digest): void;
}

/** Renders a digest as human-readable lines through an injectable sink (stdout by default). */
export class ConsoleTransport implements OutboundTransport {
  readonly name = "console";

  constructor(private readonly write: (line: string) => void = defaultWrite) {}

  deliver(digest: Digest): void {
    this.write(formatDigest(digest));
  }
}

/** Collects delivered digests in memory — for tests and callers that want the payloads. */
export class RecordingTransport implements OutboundTransport {
  readonly name = "recording";
  readonly delivered: Digest[] = [];

  deliver(digest: Digest): void {
    this.delivered.push(digest);
  }
}

export function formatDigest(digest: Digest): string {
  const lines = [`[chief-of-staff digest @ ${digest.at}] ${digest.summary}`];
  for (const notification of digest.notifications) {
    lines.push(`  - (${notification.severity}) ${notification.kind}: ${notification.summary}`);
  }
  if (digest.truncated > 0) {
    lines.push(`  …and ${digest.truncated} more held back by the volume cap.`);
  }
  return lines.join("\n");
}

function defaultWrite(line: string): void {
  process.stdout.write(`${line}\n`);
}
