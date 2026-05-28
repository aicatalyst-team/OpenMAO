import {
  type Agent,
  AgentSchema,
  type Organization,
  OrganizationSchema,
  type Role,
  RoleSchema,
} from "../contracts/index.js";
import type { Database } from "./database.js";
import { dumpJson, jsonEqual } from "./serialization.js";

type PayloadRow = { payload_json: string };

export class OrganizationConflictError extends Error {}
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
