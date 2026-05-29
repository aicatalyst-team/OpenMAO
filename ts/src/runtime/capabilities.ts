import {
  type CapabilityInvocation,
  CapabilityRegistryService,
  MockProvider,
  MockSideEffectProvider,
} from "../capabilities/index.js";
import type { ApprovalRequest } from "../contracts/index.js";
import { GovernanceService } from "../governance/index.js";
import { OrgRegistry } from "../org/index.js";
import { CapabilityCallStore, type Database } from "../persistence/index.js";

const LOCAL_MOCK_CREDENTIALS = {
  cred_mock_side_effect: "local_mock_secret_do_not_serialize",
};

export function createLocalCapabilityRegistry(database: Database): CapabilityRegistryService {
  return new CapabilityRegistryService(
    database,
    new GovernanceService(database, new OrgRegistry({ roles: [], agents: [] })),
    [new MockProvider(), new MockSideEffectProvider(LOCAL_MOCK_CREDENTIALS)],
  );
}

export function materializeRejectedCapabilityApproval(
  database: Database,
  approval: ApprovalRequest,
): CapabilityInvocation {
  if (approval.payload.target_type !== "capability_call") {
    throw new Error(`approval does not target a capability call: ${approval.id}`);
  }
  const call = new CapabilityCallStore(database).get(approval.payload.target_id);
  if (!call || call.workspace_id !== approval.workspace_id) {
    throw new Error(`capability call not found in workspace: ${approval.payload.target_id}`);
  }
  return createLocalCapabilityRegistry(database).invoke(call);
}
