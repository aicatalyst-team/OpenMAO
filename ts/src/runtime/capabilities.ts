import {
  CapabilityRegistryService,
  MockProvider,
  MockSideEffectProvider,
} from "../capabilities/index.js";
import { GovernanceService } from "../governance/index.js";
import { OrgRegistry } from "../org/index.js";
import type { Database } from "../persistence/index.js";

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
