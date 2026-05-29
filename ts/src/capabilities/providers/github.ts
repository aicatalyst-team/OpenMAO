import {
  type CapabilityCall,
  type CapabilityResult,
  CapabilityResultSchema,
  newId,
} from "../../contracts/index.js";
import type { CredentialBroker } from "../../security/credential-broker.js";
import type { CapabilityProvider } from "../providers.js";

type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

/**
 * Minimal transport shape (a subset of the global `fetch`) so the provider can
 * be exercised offline with an injected stub and never depends on the network
 * in tests.
 */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<FetchResponse>;

export type GitHubProviderOptions = {
  baseUrl?: string;
  apiVersion?: string;
  timeoutMs?: number;
  transport?: FetchLike;
};

const DEFAULT_BASE_URL = "https://api.github.com";
const DEFAULT_API_VERSION = "2022-11-28";
const DEFAULT_TIMEOUT_MS = 15_000;
// GitHub owner/repo segments: alphanumerics plus . _ -, but never "." or ".."
// (which would let an input traverse out of the /repos/{owner}/{repo} path).
const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
// GitHub rejects issue comments longer than 65536 characters.
const MAX_BODY_LENGTH = 65_536;

/**
 * First real, side-effecting capability provider: creates a comment on a GitHub
 * issue. The credential is resolved through the broker at execution time and is
 * sent only in the Authorization header — it never appears in the result, an
 * error message, or any persisted record (only the structured output does).
 *
 * Canonical input:  { owner: string, repo: string, issue_number: int, body: string }
 * Canonical output: { comment_id: int, html_url: string }
 *
 * At-most-once semantics: OpenMAO guarantees at most one provider invocation
 * per capability call (via the registry's node-effect + in-flight guards). It
 * cannot guarantee remote exactly-once — if the request times out after GitHub
 * created the comment but before OpenMAO records success, the call is recorded
 * as failed even though the comment exists. Reconcile by inspecting the issue's
 * comments before retrying rather than blindly re-issuing.
 */
export class GitHubProvider implements CapabilityProvider {
  readonly name = "github";
  readonly sideEffecting = true;
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly timeoutMs: number;
  private readonly transport: FetchLike;

  constructor(
    private readonly broker: CredentialBroker,
    options: GitHubProviderOptions = {},
  ) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.transport = options.transport ?? (globalThis.fetch as unknown as FetchLike);
  }

  async execute(call: CapabilityCall): Promise<CapabilityResult> {
    const handle = call.credential_handle;
    if (!handle) {
      throw new Error("github provider requires a credential handle");
    }
    const token = await this.broker.resolve(handle);
    if (!token) {
      throw new Error("github credential handle is not available");
    }

    const { owner, repo, issueNumber, body } = this.readInput(call);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // The whole exchange — send AND body read — runs under the timeout/abort.
      const response = await this.transport(
        `${this.baseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/comments`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
            "content-type": "application/json",
            "x-github-api-version": this.apiVersion,
            "user-agent": "openmao-github-provider",
          },
          body: JSON.stringify({ body }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new Error(`github comment creation failed with status ${response.status}`);
      }
      let payload: { id?: unknown; html_url?: unknown };
      try {
        payload = (await response.json()) as { id?: unknown; html_url?: unknown };
      } catch {
        throw new Error("github response body could not be parsed");
      }
      if (typeof payload.id !== "number" || typeof payload.html_url !== "string") {
        throw new Error("github response did not include a comment id and url");
      }
      return CapabilityResultSchema.parse({
        id: newId("capresult"),
        workspace_id: call.workspace_id,
        run_id: call.run_id,
        call_id: call.id,
        status: "ok",
        output: { comment_id: payload.id, html_url: payload.html_url },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`github request timed out after ${this.timeoutMs}ms`);
      }
      // Re-throw our own already-sanitized messages as-is; wrap any other
      // (transport) failure in a non-secret message. The token lives only in
      // the Authorization header — never the URL — so it cannot appear here.
      if (error instanceof Error && error.message.startsWith("github ")) {
        throw error;
      }
      throw new Error("github request failed before a response was received");
    } finally {
      clearTimeout(timeout);
    }
  }

  private readInput(call: CapabilityCall): {
    owner: string;
    repo: string;
    issueNumber: number;
    body: string;
  } {
    const owner = typeof call.input.owner === "string" ? call.input.owner : "";
    const repo = typeof call.input.repo === "string" ? call.input.repo : "";
    const issueNumber = call.input.issue_number;
    const body = call.input.body;
    if (!this.isSafeSegment(owner)) {
      throw new Error("github provider requires input.owner as a valid repository owner");
    }
    if (!this.isSafeSegment(repo)) {
      throw new Error("github provider requires input.repo as a valid repository name");
    }
    if (typeof issueNumber !== "number" || !Number.isInteger(issueNumber) || issueNumber <= 0) {
      throw new Error("github provider requires a positive integer input.issue_number");
    }
    if (typeof body !== "string" || body.length === 0 || body.length > MAX_BODY_LENGTH) {
      throw new Error("github provider requires input.body as a string of 1..65536 characters");
    }
    return { owner, repo, issueNumber, body };
  }

  private isSafeSegment(segment: string): boolean {
    return SEGMENT_PATTERN.test(segment) && segment !== "." && segment !== "..";
  }
}
