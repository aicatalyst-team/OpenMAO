import {
  type CapabilityInvocation,
  type CapabilityProvider,
  CapabilityRegistryService,
  GitHubProvider,
  MockProvider,
  MockSideEffectProvider,
} from "../capabilities/index.js";
import type { ApprovalRequest } from "../contracts/index.js";
import { GovernanceService } from "../governance/index.js";
import { OrgRegistry } from "../org/index.js";
import { CapabilityCallStore, type Database } from "../persistence/index.js";
import { EnvCredentialBroker } from "../security/credential-broker.js";

const LOCAL_MOCK_CREDENTIALS = {
  cred_mock_side_effect: "local_mock_secret_do_not_serialize",
};

const GITHUB_CREDENTIAL_HANDLE = "cred_github";

export function createLocalCapabilityRegistry(database: Database): CapabilityRegistryService {
  return new CapabilityRegistryService(
    database,
    new GovernanceService(database, new OrgRegistry({ roles: [], agents: [] })),
    [new MockProvider(), new MockSideEffectProvider(LOCAL_MOCK_CREDENTIALS)],
  );
}

/**
 * Real providers enabled by environment configuration. Returns an empty list
 * unless explicitly enabled, so the default (no-env) runtime stays mock-only and
 * needs no credentials. GitHub is registered only when OPENMAO_GITHUB_ENABLED=1
 * and a non-empty OPENMAO_CRED_GITHUB resolves through the env credential broker.
 */
export function configuredRealProviders(
  env: NodeJS.ProcessEnv = process.env,
): CapabilityProvider[] {
  const providers: CapabilityProvider[] = [];
  if (env.OPENMAO_GITHUB_ENABLED === "1") {
    const broker = new EnvCredentialBroker(env);
    if (broker.resolve(GITHUB_CREDENTIAL_HANDLE)) {
      providers.push(new GitHubProvider(broker));
    }
  }
  return providers;
}

/**
 * Registry used by operator-facing resume/invoke paths: the mock providers plus
 * any environment-enabled real providers. With no env set it is byte-for-byte
 * the mock-only createLocalCapabilityRegistry.
 */
export function createConfiguredCapabilityRegistry(database: Database): CapabilityRegistryService {
  return new CapabilityRegistryService(
    database,
    new GovernanceService(database, new OrgRegistry({ roles: [], agents: [] })),
    [
      new MockProvider(),
      new MockSideEffectProvider(LOCAL_MOCK_CREDENTIALS),
      ...configuredRealProviders(),
    ],
  );
}

export async function materializeRejectedCapabilityApproval(
  database: Database,
  approval: ApprovalRequest,
): Promise<CapabilityInvocation> {
  if (approval.payload.target_type !== "capability_call") {
    throw new Error(`approval does not target a capability call: ${approval.id}`);
  }
  const call = new CapabilityCallStore(database).get(approval.payload.target_id);
  if (!call || call.workspace_id !== approval.workspace_id) {
    throw new Error(`capability call not found in workspace: ${approval.payload.target_id}`);
  }
  return createConfiguredCapabilityRegistry(database).invoke(call);
}
