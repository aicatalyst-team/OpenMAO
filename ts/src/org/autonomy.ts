import {
  type AutonomyCase,
  AutonomyCaseSchema,
  type AutonomyLevel,
  EventPayloadSchema,
  newId,
  type Organization,
  type OrgChangeEvidence,
  utcNow,
} from "../contracts/index.js";
import {
  AutonomyCaseStore,
  type Database,
  EventStore,
  OrganizationStore,
} from "../persistence/index.js";

// The autonomy ladder, tightest → widest. A widening moves exactly one step up; narrowing moves down.
const LADDER: readonly AutonomyLevel[] = ["advisory", "supervised", "bounded"];

// Minimum audited track record (verified org-change applies) before autonomy may be widened — trust
// is earned through successful supervised operations, not granted.
export const DEFAULT_MIN_TRACK_RECORD = 3;

export class AutonomyServiceError extends Error {}
export class InsufficientTrackRecordError extends AutonomyServiceError {}
export class AutonomyCapError extends AutonomyServiceError {}
export class AutonomyStepError extends AutonomyServiceError {}
export class AutonomyRatificationError extends AutonomyServiceError {}

/**
 * Earned autonomy (M4). The autonomy dial only ever WIDENS via a human-ratified, evidence-backed
 * `AutonomyCase`, **one step at a time**, under a **ceiling**, and only after an **audited track
 * record** of successful supervised operations. The mechanism is conservative by construction:
 *
 *   - `proposeWidening` only RECORDS a case — it never moves the dial.
 *   - `ratifyWidening` is the human gate; it is the *only* path that moves the dial, it requires a
 *     ratifier other than the proposer, and it compare-and-swaps on the exact level the case was
 *     justified against (so the dial can never drift past its evidence).
 *   - Nothing auto-widens; there is no flag.
 *   - `narrow` (tightening) is always allowed without a case — the safe direction.
 */
export class AutonomyService {
  private readonly orgs: OrganizationStore;
  private readonly cases: AutonomyCaseStore;
  private readonly events: EventStore;
  private readonly maxLevel: AutonomyLevel;
  private readonly minTrackRecord: number;

  constructor(
    private readonly database: Database,
    options: { maxLevel?: AutonomyLevel; minTrackRecord?: number } = {},
  ) {
    this.orgs = new OrganizationStore(database);
    this.cases = new AutonomyCaseStore(database);
    this.events = new EventStore(database);
    this.maxLevel = options.maxLevel ?? "bounded";
    this.minTrackRecord = options.minTrackRecord ?? DEFAULT_MIN_TRACK_RECORD;
  }

  /**
   * Propose widening an org's autonomy one step, backed by evidence + an audited track record. This
   * only records a case for a human to ratify; it never moves the dial.
   */
  proposeWidening(input: {
    workspace_id: string;
    org_id: string;
    proposed_by: string;
    rationale: string;
    evidence?: OrgChangeEvidence[];
    id?: string | null;
    at?: string | null;
  }): AutonomyCase {
    return this.database.transaction(() => {
      const org = this.requireOrg(input.workspace_id, input.org_id);
      const currentLevel = org.autonomy_level;
      const proposedLevel = nextWider(currentLevel);
      if (!proposedLevel) {
        throw new AutonomyStepError(
          `organization ${input.org_id} is already at the widest autonomy level`,
        );
      }
      if (ladderIndex(proposedLevel) > ladderIndex(this.maxLevel)) {
        throw new AutonomyCapError(
          `proposed level '${proposedLevel}' exceeds the autonomy ceiling '${this.maxLevel}'`,
        );
      }
      const evidence = input.evidence ?? [];
      if (evidence.length === 0) {
        throw new InsufficientTrackRecordError("widening autonomy requires an evidence packet");
      }
      const trackRecord = this.verifiedApplyCount(input.workspace_id);
      if (trackRecord < this.minTrackRecord) {
        throw new InsufficientTrackRecordError(
          `widening autonomy requires at least ${this.minTrackRecord} verified applies; found ${trackRecord}`,
        );
      }
      const at = input.at ?? utcNow();
      const stored = this.cases.save(
        AutonomyCaseSchema.parse({
          id: input.id ?? newId("autonomy"),
          workspace_id: input.workspace_id,
          org_id: input.org_id,
          current_level: currentLevel,
          proposed_level: proposedLevel,
          evidence,
          rationale: input.rationale,
          status: "proposed",
          proposed_by: input.proposed_by,
          created_at: at,
        }),
      );
      this.events.append({
        workspace_id: input.workspace_id,
        kind: "autonomy.widening_proposed",
        actor: "autonomy_service",
        payload: EventPayloadSchema.parse({
          data: { autonomy_case: stored, track_record: trackRecord },
          refs: [stored.id, stored.org_id],
        }),
        idempotency_key: `${stored.id}:proposed`,
      });
      return stored;
    });
  }

  /**
   * Ratify a proposed widening — the human gate. This is the only path that moves the dial. It
   * refuses self-ratification and compare-and-swaps on the level the case was justified against, so a
   * widening can never land if the dial has drifted since the case was made.
   */
  ratifyWidening(
    caseId: string,
    input: { workspace_id: string; actor: string; at?: string | null },
  ): AutonomyCase {
    return this.database.transaction(() => {
      const autonomyCase = this.requireCase(input.workspace_id, caseId);
      if (autonomyCase.status !== "proposed") {
        if (autonomyCase.status === "ratified") {
          return autonomyCase;
        }
        throw new AutonomyRatificationError(
          `autonomy case already ${autonomyCase.status}: ${caseId}`,
        );
      }
      if (autonomyCase.proposed_by === input.actor) {
        throw new AutonomyRatificationError(
          `autonomy widening must be ratified by someone other than the proposer: ${input.actor}`,
        );
      }
      const at = input.at ?? utcNow();
      const updatedOrg = this.orgs.setAutonomyLevel(autonomyCase.org_id, {
        workspace_id: input.workspace_id,
        expected_level: autonomyCase.current_level,
        next_level: autonomyCase.proposed_level,
      });
      const ratified = this.cases.setStatus(caseId, "ratified", {
        ratified_by: input.actor,
        resolved_at: at,
      });
      this.events.append({
        workspace_id: input.workspace_id,
        kind: "autonomy.widened",
        actor: input.actor,
        payload: EventPayloadSchema.parse({
          data: {
            autonomy_case: ratified,
            organization: updatedOrg,
            from: autonomyCase.current_level,
            to: autonomyCase.proposed_level,
          },
          refs: [ratified.id, ratified.org_id],
        }),
        idempotency_key: `${caseId}:ratified`,
      });
      return ratified;
    });
  }

  /** Reject a proposed widening (human action). Records the rejection; never touches the dial. */
  rejectWidening(
    caseId: string,
    input: { workspace_id: string; actor: string; at?: string | null },
  ): AutonomyCase {
    return this.database.transaction(() => {
      const autonomyCase = this.requireCase(input.workspace_id, caseId);
      if (autonomyCase.status === "rejected") {
        return autonomyCase;
      }
      const rejected = this.cases.setStatus(caseId, "rejected", {
        resolved_at: input.at ?? utcNow(),
      });
      this.events.append({
        workspace_id: input.workspace_id,
        kind: "autonomy.widening_rejected",
        actor: input.actor,
        payload: EventPayloadSchema.parse({
          data: { autonomy_case: rejected },
          refs: [rejected.id, rejected.org_id],
        }),
        idempotency_key: `${caseId}:rejected`,
      });
      return rejected;
    });
  }

  /**
   * Tighten an org's autonomy (operator action). Always allowed without a case or evidence —
   * narrowing is the safe direction. Must lower the level.
   */
  narrow(input: {
    workspace_id: string;
    org_id: string;
    to_level: AutonomyLevel;
    actor: string;
    at?: string | null;
  }): Organization {
    return this.database.transaction(() => {
      const org = this.requireOrg(input.workspace_id, input.org_id);
      if (ladderIndex(input.to_level) >= ladderIndex(org.autonomy_level)) {
        throw new AutonomyStepError(
          `narrow must lower autonomy; '${input.to_level}' is not below '${org.autonomy_level}'`,
        );
      }
      const updated = this.orgs.setAutonomyLevel(input.org_id, {
        workspace_id: input.workspace_id,
        expected_level: org.autonomy_level,
        next_level: input.to_level,
      });
      this.events.append({
        workspace_id: input.workspace_id,
        kind: "autonomy.narrowed",
        actor: input.actor,
        payload: EventPayloadSchema.parse({
          data: { organization: updated, from: org.autonomy_level, to: input.to_level },
          refs: [updated.id],
        }),
        idempotency_key: `autonomy:narrow:${input.org_id}:${input.at ?? utcNow()}`,
      });
      return updated;
    });
  }

  // The audited track record: verified org-change applies (successful, post-apply-checked) in the
  // workspace. Autonomy is earned against this history.
  private verifiedApplyCount(workspaceId: string): number {
    return this.events
      .listForWorkspace(workspaceId)
      .filter((event) => event.kind === "org_change.verified").length;
  }

  private requireOrg(workspaceId: string, orgId: string): Organization {
    const org = this.orgs.get(orgId);
    if (!org || org.workspace_id !== workspaceId) {
      throw new AutonomyServiceError(
        `organization not found in workspace ${workspaceId}: ${orgId}`,
      );
    }
    return org;
  }

  private requireCase(workspaceId: string, caseId: string): AutonomyCase {
    const autonomyCase = this.cases.get(caseId);
    if (!autonomyCase || autonomyCase.workspace_id !== workspaceId) {
      throw new AutonomyServiceError(
        `autonomy case not found in workspace ${workspaceId}: ${caseId}`,
      );
    }
    return autonomyCase;
  }
}

function ladderIndex(level: AutonomyLevel): number {
  return LADDER.indexOf(level);
}

function nextWider(level: AutonomyLevel): AutonomyLevel | null {
  const index = ladderIndex(level);
  return index >= 0 && index < LADDER.length - 1 ? (LADDER[index + 1] ?? null) : null;
}
