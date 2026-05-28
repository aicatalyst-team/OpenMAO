import { type Agent, AgentSchema, type Role, RoleSchema } from "../contracts/index.js";

export type OrgRegistryInput = {
  roles: unknown[];
  agents: unknown[];
  communication?: Record<string, string[]>;
};

export class OrgConfigError extends Error {}

export class OrgRegistry {
  private readonly rolesById = new Map<string, Role>();
  private readonly agentsById = new Map<string, Agent>();
  private readonly roleNamesById = new Map<string, string>();
  private readonly communication: Record<string, Set<string>>;

  constructor(input: OrgRegistryInput) {
    for (const rawRole of input.roles) {
      const role = RoleSchema.parse(rawRole);
      if ([...this.rolesById.values()].some((existing) => existing.name === role.name)) {
        throw new OrgConfigError(`duplicate role name: ${role.name}`);
      }
      this.rolesById.set(role.id, role);
      this.roleNamesById.set(role.id, role.name);
    }

    for (const rawAgent of input.agents) {
      const agent = AgentSchema.parse(rawAgent);
      if (!this.rolesById.has(agent.role_id)) {
        throw new OrgConfigError(`agent references unknown role: ${agent.role_id}`);
      }
      if ([...this.agentsById.values()].some((existing) => existing.identity === agent.identity)) {
        throw new OrgConfigError(`duplicate agent identity: ${agent.identity}`);
      }
      this.agentsById.set(agent.id, agent);
    }

    this.communication = Object.fromEntries(
      Object.entries(input.communication ?? {}).map(([fromRole, toRoles]) => [
        fromRole,
        new Set(toRoles),
      ]),
    );
  }

  canHandoff(fromAgentId: string, toAgentId: string): boolean {
    const fromRole = this.roleNameForAgent(fromAgentId);
    const toRole = this.roleNameForAgent(toAgentId);
    if (!fromRole || !toRole) {
      return false;
    }

    return this.communication[fromRole]?.has(toRole) ?? false;
  }

  allowedCapabilitiesForAgent(agentId: string): Set<string> {
    const agent = this.agentsById.get(agentId);
    if (!agent) {
      return new Set();
    }
    const role = this.rolesById.get(agent.role_id);
    return new Set(role?.capability_grants ?? []);
  }

  private roleNameForAgent(agentId: string): string | null {
    const agent = this.agentsById.get(agentId);
    if (!agent) {
      return null;
    }

    return this.roleNamesById.get(agent.role_id) ?? null;
  }
}
