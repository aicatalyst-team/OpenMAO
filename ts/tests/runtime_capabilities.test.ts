import { describe, expect, it } from "vitest";

import { configuredRealProviders } from "../src/runtime/capabilities.js";

describe("configured real providers (opt-in)", () => {
  it("registers no real providers without environment configuration", () => {
    expect(configuredRealProviders({})).toEqual([]);
  });

  it("does not register GitHub unless explicitly enabled", () => {
    expect(configuredRealProviders({ OPENMAO_CRED_GITHUB: "gh-fake-value-abc123" })).toEqual([]);
  });

  it("does not register GitHub when enabled without a resolvable credential", () => {
    expect(configuredRealProviders({ OPENMAO_GITHUB_ENABLED: "1" })).toEqual([]);
  });

  it("registers the GitHub provider only when enabled and a credential resolves", () => {
    const providers = configuredRealProviders({
      OPENMAO_GITHUB_ENABLED: "1",
      OPENMAO_CRED_GITHUB: "gh-fake-value-abc123",
    });
    expect(providers).toHaveLength(1);
    expect(providers[0]?.name).toBe("github");
    expect(providers[0]?.sideEffecting).toBe(true);
  });
});
