import { validateCredentialHandle } from "./sensitive-material.js";

/**
 * Resolves a non-secret `cred_*` capability handle to the underlying secret at
 * provider execution time. Only provider code calls a broker; the resolved
 * secret is never returned to the registry, persisted to a call/result/event/
 * trace, or logged. This keeps the credential boundary intact: workers and the
 * audit trail only ever see the handle.
 */
export type CredentialBroker = {
  resolve(handle: string): string | null | Promise<string | null>;
};

const CREDENTIAL_HANDLE_PREFIX = "cred_";
const DEFAULT_ENV_PREFIX = "OPENMAO_CRED_";
const ENV_HANDLE_NAME = /^[a-z0-9_]+$/;

function handleToEnvKey(handle: string, prefix: string): string {
  const name = handle.slice(CREDENTIAL_HANDLE_PREFIX.length);
  // Environment variable names can only carry [A-Z0-9_]. Restrict the handle
  // name to lowercase letters, digits, and underscores so the handle -> env-key
  // map is injective: without this, `cred_foo.bar`, `cred_foo-bar`, and
  // `cred_foo_bar` would all collapse onto OPENMAO_CRED_FOO_BAR and could
  // resolve the wrong secret. StaticCredentialBroker has no such restriction.
  if (!ENV_HANDLE_NAME.test(name)) {
    throw new Error(
      "EnvCredentialBroker handles must match cred_<name> with only lowercase letters, digits, and underscores",
    );
  }
  return `${prefix}${name.toUpperCase()}`;
}

/**
 * Resolves handles from environment variables: `cred_github` reads
 * `OPENMAO_CRED_GITHUB`, `cred_mock_side_effect` reads
 * `OPENMAO_CRED_MOCK_SIDE_EFFECT`. Returns null when the variable is absent or
 * empty so an unconfigured deployment simply has no credential (the default
 * demo path requires none).
 */
export class EnvCredentialBroker implements CredentialBroker {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly prefix: string = DEFAULT_ENV_PREFIX,
  ) {}

  resolve(handle: string): string | null {
    validateCredentialHandle(handle);
    const value = this.env[handleToEnvKey(handle, this.prefix)];
    return value !== undefined && value.trim().length > 0 ? value.trim() : null;
  }
}

/**
 * In-memory broker for deterministic demos and tests. Holds an explicit
 * handle -> secret map; never reads the environment.
 */
export class StaticCredentialBroker implements CredentialBroker {
  private readonly handles: Map<string, string>;

  constructor(handles: Record<string, string> = {}) {
    this.handles = new Map(Object.entries(handles));
  }

  resolve(handle: string): string | null {
    const value = this.handles.get(handle);
    return value !== undefined && value.trim().length > 0 ? value.trim() : null;
  }
}

export function isCredentialBroker(value: unknown): value is CredentialBroker {
  return typeof (value as { resolve?: unknown } | null)?.resolve === "function";
}
