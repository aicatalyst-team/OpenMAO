import {
  type Agent,
  AgentSchema,
  AutonomyCaseSchema,
  type Organization,
  OrganizationSchema,
  type Role,
  RoleSchema,
} from "../contracts/index.js";
import type { Database } from "./database.js";
import { dumpJson, jsonEqual } from "./serialization.js";

type PayloadRow = { payload_json: string };

// The autonomy ladder, tightest → widest. Used to forbid skip-level widening on the CAS.
const AUTONOMY_LADDER: ReadonlyArray<Organization["autonomy_level"]> = [
  "advisory",
  "supervised",
  "bounded",
];

export class OrganizationConflictError extends Error {}
// Raised when a compare-and-swap autonomy transition finds the org at a different level than
// expected — the dial drifted since the case was justified, so the widening must not land.
export class AutonomyTransitionConflictError extends OrganizationConflictError {}
export class RoleConflictError extends Error {}
export class AgentConflictError extends Error {}

export class OrganizationStore {
  constructor(private readonly database: Database) {}

  save(organization: Organization): Organization {
    const parsed = OrganizationSchema.parse(organization);
    return this.database.transaction(() => {
      const existing = this.get(parsed.id);
      if (existing) {
        if (jsonEqual(existing, parsed)) {
          return existing;
        }
        throw new OrganizationConflictError(`organization already exists: ${parsed.id}`);
      }
      this.database.connection
        .prepare("INSERT INTO organizations (id, workspace_id, payload_json) VALUES (?, ?, ?)")
        .run(parsed.id, parsed.workspace_id, dumpJson(parsed));
      return parsed;
    });
  }

  get(organizationId: string): Organization | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM organizations WHERE id = ?")
      .get(organizationId) as PayloadRow | undefined;
    return row ? OrganizationSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listForWorkspace(workspaceId: string): Organization[] {
    const rows = this.database.connection
      .prepare("SELECT payload_json FROM organizations WHERE workspace_id = ? ORDER BY id")
      .all(workspaceId) as PayloadRow[];
    return rows.map((row) => OrganizationSchema.parse(JSON.parse(row.payload_json)));
  }

  /**
   * Compare-and-swap the org's autonomy level: move to `next_level` only if it is currently
   * `expected_level`. The CAS makes the dial drift-safe — a widening can only land on the exact
   * level its case was justified against. Workspace-scoped.
   */
  setAutonomyLevel(
    organizationId: string,
    input: {
      workspace_id: string;
      expected_level: Organization["autonomy_level"];
      next_level: Organization["autonomy_level"];
      ratified_case_id?: string | null;
    },
  ): Organization {
    return this.database.transaction(() => {
      const current = this.get(organizationId);
      if (!current || current.workspace_id !== input.workspace_id) {
        throw new OrganizationConflictError(
          `organization not found in workspace ${input.workspace_id}: ${organizationId}`,
        );
      }
      if (current.autonomy_level !== input.expected_level) {
        throw new AutonomyTransitionConflictError(
          `organization ${organizationId} is at autonomy '${current.autonomy_level}', expected '${input.expected_level}'`,
        );
      }
      const expectedIndex = AUTONOMY_LADDER.indexOf(input.expected_level);
      const nextIndex = AUTONOMY_LADDER.indexOf(input.next_level);
      if (nextIndex > expectedIndex) {
        // Widening is never silent and never skips: it may advance only one rung AND must be backed
        // by a matching RATIFIED autonomy case. This makes ratification the only path that widens the
        // dial, even at the store layer. Narrowing (the safe direction) needs neither.
        if (nextIndex > expectedIndex + 1) {
          throw new AutonomyTransitionConflictError(
            `autonomy may only widen one step at a time: '${input.expected_level}' → '${input.next_level}'`,
          );
        }
        this.assertRatifiedCaseJustifies(
          input.ratified_case_id ?? null,
          organizationId,
          input.workspace_id,
          input.expected_level,
          input.next_level,
        );
      }
      if (input.next_level === input.expected_level) {
        return current;
      }
      const updated = OrganizationSchema.parse({ ...current, autonomy_level: input.next_level });
      this.database.connection
        .prepare("UPDATE organizations SET payload_json = ? WHERE id = ? AND workspace_id = ?")
        .run(dumpJson(updated), updated.id, input.workspace_id);
      return updated;
    });
  }

  private assertRatifiedCaseJustifies(
    caseId: string | null,
    orgId: string,
    workspaceId: string,
    from: Organization["autonomy_level"],
    to: Organization["autonomy_level"],
  ): void {
    if (!caseId) {
      throw new AutonomyTransitionConflictError(
        "widening autonomy requires a ratified case — the dial only widens through ratification",
      );
    }
    const row = this.database.connection
      .prepare(
        `SELECT payload_json FROM autonomy_cases
         WHERE id = ? AND workspace_id = ? AND org_id = ? AND status = 'ratified'`,
      )
      .get(caseId, workspaceId, orgId) as PayloadRow | undefined;
    if (!row) {
      throw new AutonomyTransitionConflictError(
        `no ratified autonomy case justifies this widening: ${caseId}`,
      );
    }
    const autonomyCase = AutonomyCaseSchema.parse(JSON.parse(row.payload_json));
    if (autonomyCase.current_level !== from || autonomyCase.proposed_level !== to) {
      throw new AutonomyTransitionConflictError(
        `ratified case ${caseId} does not justify '${from}' → '${to}'`,
      );
    }
  }
}

export class RoleStore {
  constructor(private readonly database: Database) {}

  save(role: Role): Role {
    const parsed = RoleSchema.parse(role);
    return this.database.transaction(() => {
      const existing = this.get(parsed.id);
      if (existing) {
        if (jsonEqual(existing, parsed)) {
          return existing;
        }
        throw new RoleConflictError(`role already exists: ${parsed.id}`);
      }
      this.database.connection
        .prepare("INSERT INTO roles (id, workspace_id, payload_json) VALUES (?, ?, ?)")
        .run(parsed.id, parsed.workspace_id, dumpJson(parsed));
      return parsed;
    });
  }

  get(roleId: string): Role | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM roles WHERE id = ?")
      .get(roleId) as PayloadRow | undefined;
    return row ? RoleSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listForWorkspace(workspaceId: string): Role[] {
    const rows = this.database.connection
      .prepare("SELECT payload_json FROM roles WHERE workspace_id = ? ORDER BY id")
      .all(workspaceId) as PayloadRow[];
    return rows.map((row) => RoleSchema.parse(JSON.parse(row.payload_json)));
  }
}

export class AgentStore {
  constructor(private readonly database: Database) {}

  save(agent: Agent): Agent {
    const parsed = AgentSchema.parse(agent);
    return this.database.transaction(() => {
      const existing = this.get(parsed.id);
      if (existing) {
        if (jsonEqual(existing, parsed)) {
          return existing;
        }
        throw new AgentConflictError(`agent already exists: ${parsed.id}`);
      }
      this.database.connection
        .prepare("INSERT INTO agents (id, workspace_id, payload_json) VALUES (?, ?, ?)")
        .run(parsed.id, parsed.workspace_id, dumpJson(parsed));
      return parsed;
    });
  }

  get(agentId: string): Agent | null {
    const row = this.database.connection
      .prepare("SELECT payload_json FROM agents WHERE id = ?")
      .get(agentId) as PayloadRow | undefined;
    return row ? AgentSchema.parse(JSON.parse(row.payload_json)) : null;
  }

  listForWorkspace(workspaceId: string): Agent[] {
    const rows = this.database.connection
      .prepare("SELECT payload_json FROM agents WHERE workspace_id = ? ORDER BY id")
      .all(workspaceId) as PayloadRow[];
    return rows.map((row) => AgentSchema.parse(JSON.parse(row.payload_json)));
  }
}
