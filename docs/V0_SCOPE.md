# First Release Scope

This page records what the first OpenMAO release candidate ships and what it intentionally defers.
It is release-specific; for current architecture and future direction, see
[ARCHITECTURE.md](./ARCHITECTURE.md) and [ROADMAP.md](./ROADMAP.md).

## Shipped

### Core Runtime

| Feature | Evidence |
| --- | --- |
| TypeScript runtime on Node.js 22 | `package.json`, `tsconfig.json` |
| Zod contracts and generated JSON Schema | `ts/src/contracts/`, `schemas/canonical/v0.schema.json` |
| SQLite persistence | `ts/src/persistence/` |
| Workspace-scoped state | `ts/src/persistence/workspaces.ts`, `ts/tests/persistence.test.ts` |
| Active-run lock with crash recovery | `ts/src/persistence/runs.ts`, `ts/tests/persistence.test.ts` |
| Durable checkpoints and node effects | `ts/src/persistence/checkpoints.ts`, `ts/src/persistence/effects.ts` |
| Deterministic local demo | `ts/src/spine/service.ts`, `ts/tests/spine.test.ts` |

### Governance and Memory

| Feature | Evidence |
| --- | --- |
| Policy outcomes: `allow`, `block`, `require_approval`, `log_only` | `ts/src/contracts/models.ts`, `ts/tests/contracts.test.ts` |
| Deny-by-default handoff behavior | `ts/src/governance/service.ts`, `ts/tests/governance.test.ts` |
| Capability call persisted before approval evaluation | `ts/src/capabilities/`, `ts/tests/governance.test.ts` |
| Approval-required suspension and resume | `ts/src/governance/approvals.ts`, `ts/tests/spine.test.ts` |
| Individual memory writes | `ts/src/memory/service.ts`, `ts/tests/memory_world.test.ts` |
| Collective memory through promotion and approval | `ts/src/memory/service.ts`, `ts/tests/spine.test.ts` |
| Markdown-backed collective memory | `ts/tests/memory_world.test.ts` |
| Workspace-scoped event log and run traces | `ts/src/persistence/events.ts`, `ts/src/persistence/audit.ts` |

### Operator Surface

| Feature | Evidence |
| --- | --- |
| CLI with approval approve/reject parity | `ts/src/cli.ts`, `ts/tests/surfaces.test.ts` |
| HTTP API inspection and control endpoints | `ts/src/api/server.ts`, `ts/tests/surfaces.test.ts` |
| Minimal local operator console | `ts/src/api/server.ts` |
| World model snapshot projection | `ts/src/world/service.ts`, `ts/tests/memory_world.test.ts` |
| `make demo` suspends, `make demo-approve` resumes | `Makefile`, `ts/tests/spine.test.ts` |

## Deferred

### Real-World Execution

- real LLM provider integration;
- real MCP client/server execution;
- browser, shell, email, payment, or file operating workers;
- long-running external workers;
- hosted SaaS integrations;
- live external side effects.

### Storage and Deployment

- Postgres or managed database backends;
- pgvector or external vector stores;
- object-store-backed artifacts;
- hosted control plane;
- multi-tenant authentication;
- enterprise secret-management integrations.

### Coordination and Learning

- multi-run concurrency;
- multi-handoff workflows beyond the demo path;
- bounded group deliberation nodes;
- automatic memory ratification;
- skill creation;
- autonomous organization restructuring;
- role and SOP versioning;
- self-improvement loops.

## Positioning

The first release is positioned as a governance-first, audit-first local control layer. It proves
that an AI organization can suspend for human approval, resume from durable state, treat collective
memory as gated shared state, and leave an auditable trail.

It is not positioned as:

- a replacement for external agent/orchestration frameworks at runtime feature parity;
- a sandbox-execution environment for AI agents;
- a self-improving AI organization;
- a hosted product.
