import { describe, expect, it } from "vitest";

import { MockSideEffectProvider } from "../src/capabilities/index.js";
import { CapabilityCallSchema } from "../src/contracts/index.js";
import {
  EnvCredentialBroker,
  isCredentialBroker,
  StaticCredentialBroker,
} from "../src/security/credential-broker.js";

function sideEffectCall(handle: string | null) {
  return CapabilityCallSchema.parse({
    id: "capcall_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    workspace_id: "ws_11111111111111111111111111111111",
    run_id: "run_99999999999999999999999999999999",
    capability_name: "mock.side_effect.record",
    provider: "mock.side_effect",
    input: { message: "go" },
    requested_by: "worker_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    task_id: "task_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    credential_handle: handle,
    side_effecting: true,
    idempotency_key: "broker-test:side-effect",
  });
}

describe("credential broker", () => {
  describe("EnvCredentialBroker", () => {
    it("resolves cred_<name> handles from prefixed env vars (uppercased)", () => {
      const broker = new EnvCredentialBroker({
        OPENMAO_CRED_GITHUB: "github-token-value",
        OPENMAO_CRED_MOCK_SIDE_EFFECT: "mock-secret",
      });
      expect(broker.resolve("cred_github")).toBe("github-token-value");
      expect(broker.resolve("cred_mock_side_effect")).toBe("mock-secret");
    });

    it("rejects handle names that cannot map unambiguously to an env var", () => {
      const broker = new EnvCredentialBroker({ OPENMAO_CRED_FOO_BAR: "x" });
      // `.`, `-`, `:`, and uppercase would all collapse onto OPENMAO_CRED_FOO_BAR,
      // so the env broker refuses them rather than resolve the wrong secret.
      expect(() => broker.resolve("cred_foo.bar")).toThrow();
      expect(() => broker.resolve("cred_foo-bar")).toThrow();
      expect(() => broker.resolve("cred_FooBar")).toThrow();
    });

    it("returns null when the env var is absent, empty, or whitespace-only", () => {
      const broker = new EnvCredentialBroker({
        OPENMAO_CRED_PRESENT: "x",
        OPENMAO_CRED_EMPTY: "",
        OPENMAO_CRED_BLANK: "   ",
      });
      expect(broker.resolve("cred_present")).toBe("x");
      expect(broker.resolve("cred_missing")).toBeNull();
      expect(broker.resolve("cred_empty")).toBeNull();
      expect(broker.resolve("cred_blank")).toBeNull();
    });

    it("supports a custom env prefix", () => {
      const broker = new EnvCredentialBroker({ KLARVO_CRED_GITHUB: "tok" }, "KLARVO_CRED_");
      expect(broker.resolve("cred_github")).toBe("tok");
    });

    it("rejects a handle that is not a cred_* identifier", () => {
      const broker = new EnvCredentialBroker({});
      expect(() => broker.resolve("not-a-handle")).toThrow();
    });
  });

  describe("StaticCredentialBroker", () => {
    it("resolves from an explicit map and returns null for misses, empties, and blanks", () => {
      const broker = new StaticCredentialBroker({
        cred_x: "secret",
        cred_empty: "",
        cred_blank: "   ",
      });
      expect(broker.resolve("cred_x")).toBe("secret");
      expect(broker.resolve("cred_y")).toBeNull();
      expect(broker.resolve("cred_empty")).toBeNull();
      expect(broker.resolve("cred_blank")).toBeNull();
    });
  });

  it("isCredentialBroker distinguishes brokers from plain maps", () => {
    expect(isCredentialBroker(new StaticCredentialBroker())).toBe(true);
    expect(isCredentialBroker(new EnvCredentialBroker({}))).toBe(true);
    expect(isCredentialBroker({ cred_x: "y" })).toBe(false);
    expect(isCredentialBroker(null)).toBe(false);
  });

  describe("MockSideEffectProvider", () => {
    it("resolves through a broker and never emits the secret", async () => {
      const provider = new MockSideEffectProvider(
        new StaticCredentialBroker({ cred_mock_side_effect: "do-not-serialize-secret" }),
      );
      const call = sideEffectCall("cred_mock_side_effect");
      const result = await provider.execute(call);
      expect(result.status).toBe("ok");
      expect(result.output).toEqual({
        provider: "mock.side_effect",
        effect: "recorded",
        handle: "cred_mock_side_effect",
      });
      expect(JSON.stringify(result)).not.toContain("do-not-serialize-secret");
      expect(provider.executedCallIds).toEqual([call.id]);
    });

    it("accepts a Record for back-compat and throws on an unresolved handle", async () => {
      const provider = new MockSideEffectProvider({ cred_present: "secret" });
      await expect(provider.execute(sideEffectCall("cred_absent"))).rejects.toThrow(
        "credential handle is not available",
      );
    });
  });
});
