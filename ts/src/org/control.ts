import { EventPayloadSchema, type OrgControlState, utcNow } from "../contracts/index.js";
import { type Database, EventStore, OrgControlStore } from "../persistence/index.js";

/**
 * The operator kill-switch as an audited service. Pausing or resuming the apply loop is a
 * governance action, so it is written through the event log (`org_control.apply_paused` /
 * `org_control.apply_resumed`) and is therefore replayable from history — not a bare store write.
 * The apply engine reads the pause flag directly via `OrgControlStore`; mutations go through here.
 */
export class OrgControlService {
  private readonly control: OrgControlStore;
  private readonly events: EventStore;

  constructor(private readonly database: Database) {
    this.control = new OrgControlStore(database);
    this.events = new EventStore(database);
  }

  get(workspaceId: string): OrgControlState {
    return this.control.get(workspaceId);
  }

  pauseApply(
    workspaceId: string,
    input: { actor: string; reason?: string | null; at?: string | null },
  ): OrgControlState {
    return this.setPaused(workspaceId, true, input);
  }

  resumeApply(
    workspaceId: string,
    input: { actor: string; reason?: string | null; at?: string | null },
  ): OrgControlState {
    return this.setPaused(workspaceId, false, input);
  }

  private setPaused(
    workspaceId: string,
    paused: boolean,
    input: { actor: string; reason?: string | null; at?: string | null },
  ): OrgControlState {
    return this.database.transaction(() => {
      const at = input.at ?? utcNow();
      const state = this.control.setApplyPaused(workspaceId, {
        paused,
        reason: input.reason ?? null,
        updated_by: input.actor,
        updated_at: at,
      });
      this.events.append({
        workspace_id: workspaceId,
        kind: paused ? "org_control.apply_paused" : "org_control.apply_resumed",
        actor: input.actor,
        payload: EventPayloadSchema.parse({ data: { org_control_state: state } }),
      });
      return state;
    });
  }
}
