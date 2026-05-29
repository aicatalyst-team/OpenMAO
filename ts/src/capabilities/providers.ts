import {
  type CapabilityCall,
  type CapabilityResult,
  CapabilityResultSchema,
  newId,
} from "../contracts/index.js";

export type CapabilityProvider = {
  name: string;
  execute(call: CapabilityCall): CapabilityResult;
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
  readonly executedCallIds: string[] = [];

  constructor(private readonly credentialHandles: Record<string, string> = {}) {}

  execute(call: CapabilityCall): CapabilityResult {
    const handle = call.credential_handle;
    if (!handle || !Object.hasOwn(this.credentialHandles, handle)) {
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
