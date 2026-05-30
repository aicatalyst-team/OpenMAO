import {
  type CapabilityCall,
  type CapabilityResult,
  CapabilityResultSchema,
  newId,
} from "../contracts/index.js";
import {
  type CredentialBroker,
  isCredentialBroker,
  StaticCredentialBroker,
} from "../security/credential-broker.js";

export type CapabilityProvider = {
  name: string;
  // Providers that perform real external side effects declare this so the
  // gateway can require the side-effect/approval gate even if a capability is
  // misregistered as non-side-effecting.
  sideEffecting?: boolean;
  execute(call: CapabilityCall): CapabilityResult | Promise<CapabilityResult>;
};

export class MockProvider implements CapabilityProvider {
  readonly name = "mock";
  readonly executedCallIds: string[] = [];

  constructor(private readonly seededFindings: Record<string, string[]> = {}) {}

  execute(call: CapabilityCall): CapabilityResult {
    this.executedCallIds.push(call.id);
    const query = String(call.input.query ?? "").toLowerCase();
    const findings = this.seededFindings[query] ?? [
      "Use explicit assumptions.",
      "Prefer short, reliable artifacts.",
    ];

    return CapabilityResultSchema.parse({
      id: newId("capresult"),
      workspace_id: call.workspace_id,
      run_id: call.run_id,
      call_id: call.id,
      status: "ok",
      output: { findings },
    });
  }
}

export class MockSideEffectProvider implements CapabilityProvider {
  readonly name = "mock.side_effect";
  readonly sideEffecting = true;
  readonly executedCallIds: string[] = [];
  private readonly broker: CredentialBroker;

  constructor(credentials: CredentialBroker | Record<string, string> = {}) {
    this.broker = isCredentialBroker(credentials)
      ? credentials
      : new StaticCredentialBroker(credentials);
  }

  async execute(call: CapabilityCall): Promise<CapabilityResult> {
    const handle = call.credential_handle;
    if (!handle) {
      throw new Error("mock side-effect requires a credential handle");
    }
    // Resolve the secret through the broker to prove the credential is
    // available, but never emit it: only the non-secret handle leaves here.
    const secret = await this.broker.resolve(handle);
    if (!secret) {
      throw new Error("mock side-effect credential handle is not available");
    }

    this.executedCallIds.push(call.id);
    return CapabilityResultSchema.parse({
      id: newId("capresult"),
      workspace_id: call.workspace_id,
      run_id: call.run_id,
      call_id: call.id,
      status: "ok",
      output: {
        provider: this.name,
        effect: "recorded",
        handle,
      },
    });
  }
}

export class MCPProvider implements CapabilityProvider {
  readonly name = "mcp";

  execute(_call: CapabilityCall): CapabilityResult {
    throw new Error("real MCP provider execution is deferred beyond v0");
  }
}
