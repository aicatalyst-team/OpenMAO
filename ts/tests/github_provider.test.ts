import { describe, expect, it } from "vitest";

import { type FetchLike, GitHubProvider } from "../src/capabilities/index.js";
import { CapabilityCallSchema } from "../src/contracts/index.js";
import { StaticCredentialBroker } from "../src/security/credential-broker.js";

// Deterministic non-token-shaped placeholder (not ghp_/github_pat_/sk-/xox-).
const FAKE_TOKEN = "gh-fake-value-abc123xyz";

function broker() {
  return new StaticCredentialBroker({ cred_github: FAKE_TOKEN });
}

function commentCall(input: Record<string, unknown>) {
  return CapabilityCallSchema.parse({
    id: "capcall_cccccccccccccccccccccccccccccccc",
    workspace_id: "ws_11111111111111111111111111111111",
    run_id: "run_99999999999999999999999999999999",
    capability_name: "github.create_issue_comment",
    provider: "github",
    input,
    requested_by: "worker_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    task_id: "task_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    credential_handle: "cred_github",
    side_effecting: true,
    risk_level: "high",
    idempotency_key: "github-test:comment",
  });
}

type RecordedRequest = {
  url: string;
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  };
};

describe("GitHubProvider", () => {
  it("posts an issue comment and maps the response to the canonical output", async () => {
    const requests: RecordedRequest[] = [];
    const transport: FetchLike = async (url, init) => {
      requests.push({ url, init });
      return {
        ok: true,
        status: 201,
        json: async () => ({ id: 4242, html_url: "https://github.com/o/r/issues/7#c-4242" }),
      };
    };
    const provider = new GitHubProvider(broker(), { transport });

    const result = await provider.execute(
      commentCall({ owner: "o", repo: "r", issue_number: 7, body: "hello there" }),
    );

    expect(result.status).toBe("ok");
    expect(result.output).toEqual({
      comment_id: 4242,
      html_url: "https://github.com/o/r/issues/7#c-4242",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.github.com/repos/o/r/issues/7/comments");
    expect(requests[0]?.init.method).toBe("POST");
    // Token is sent only in the Authorization header (asserted without writing a
    // "Bearer <token>" literal into this source file).
    expect(requests[0]?.init.headers.authorization?.startsWith("Bearer")).toBe(true);
    expect(requests[0]?.init.headers.authorization).toContain(FAKE_TOKEN);
    expect(requests[0]?.init.headers["x-github-api-version"]).toBe("2022-11-28");
    expect(JSON.parse(requests[0]?.init.body ?? "{}")).toEqual({ body: "hello there" });
  });

  it("never includes the resolved token in the result", async () => {
    const transport: FetchLike = async () => ({
      ok: true,
      status: 201,
      json: async () => ({ id: 1, html_url: "https://github.com/o/r/issues/1#c-1" }),
    });
    const provider = new GitHubProvider(broker(), { transport });
    const result = await provider.execute(
      commentCall({ owner: "o", repo: "r", issue_number: 1, body: "x" }),
    );
    expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN);
  });

  it("throws a sanitized error on a non-2xx response", async () => {
    const transport: FetchLike = async () => ({ ok: false, status: 403, json: async () => ({}) });
    const provider = new GitHubProvider(broker(), { transport });
    await expect(
      provider.execute(commentCall({ owner: "o", repo: "r", issue_number: 1, body: "x" })),
    ).rejects.toThrow("status 403");
  });

  it("maps an abort to a timeout error", async () => {
    const transport: FetchLike = async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    };
    const provider = new GitHubProvider(broker(), { transport, timeoutMs: 5 });
    await expect(
      provider.execute(commentCall({ owner: "o", repo: "r", issue_number: 1, body: "x" })),
    ).rejects.toThrow("timed out");
  });

  it("validates input and rejects path-traversal segments before calling the transport", async () => {
    let called = false;
    const transport: FetchLike = async () => {
      called = true;
      return { ok: true, status: 201, json: async () => ({ id: 1, html_url: "x" }) };
    };
    const provider = new GitHubProvider(broker(), { transport });

    await expect(
      provider.execute(commentCall({ owner: "", repo: "r", issue_number: 1, body: "x" })),
    ).rejects.toThrow("owner");
    await expect(
      provider.execute(commentCall({ owner: "o", repo: "r", issue_number: 0, body: "x" })),
    ).rejects.toThrow("issue_number");
    await expect(
      provider.execute(commentCall({ owner: "o", repo: "r", issue_number: 1, body: "" })),
    ).rejects.toThrow("body");
    // Traversal segments must never reach the URL.
    await expect(
      provider.execute(commentCall({ owner: "..", repo: "r", issue_number: 1, body: "x" })),
    ).rejects.toThrow("owner");
    await expect(
      provider.execute(commentCall({ owner: "o", repo: "..", issue_number: 1, body: "x" })),
    ).rejects.toThrow("repo");
    expect(called).toBe(false);
  });

  it("throws when the credential cannot be resolved", async () => {
    const transport: FetchLike = async () => ({
      ok: true,
      status: 201,
      json: async () => ({ id: 1, html_url: "x" }),
    });
    const provider = new GitHubProvider(new StaticCredentialBroker({}), { transport });
    await expect(
      provider.execute(commentCall({ owner: "o", repo: "r", issue_number: 1, body: "x" })),
    ).rejects.toThrow("not available");
  });
});
