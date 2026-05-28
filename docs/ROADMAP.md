# OpenMAO Roadmap

OpenMAO starts with a deterministic local release that proves the control layer: governed handoff,
approval suspension/resume, memory promotion, audit events, traces, and a rebuildable world model.

The roadmap keeps that control layer stable while expanding what OpenMAO can govern.

## Current Release

The current release candidate provides:

- local TypeScript runtime;
- SQLite persistence;
- canonical contracts and generated JSON Schema;
- deterministic two-agent demo;
- approval-gated memory promotion;
- workspace-scoped events and run traces;
- API, CLI, and minimal operator console;
- public hygiene checks for secrets and internal process leaks.

See [docs/release/v0_acceptance_evidence.md](release/v0_acceptance_evidence.md) for the current
release evidence.

## Near-Term Priorities

### Governed Worker Adapter Contract

Define the first public adapter contract for external workers. The adapter must let external systems
execute bounded work while OpenMAO keeps ownership of authority, policy, approvals, memory, events,
traces, and world-model state.

### Real Capability Providers

Add the first non-mock capability provider. The provider contract must include provider identity,
credential handles, scopes, audit payloads, failure behavior, and approval requirements without
exposing raw credentials to agents.

### Stronger Operator Experience

Expand the operator console from inspection and approval into a clearer working surface for runs,
approvals, world model state, and event/trace inspection. The console must remain a client over the
service layer.

### Public Templates

Add organization templates, role templates, capability packs, and policy packs after the core
contracts are stable enough for reuse.

## Later Directions

- Hosted deployment mode.
- Managed Postgres and object storage backends.
- Vector retrieval over memory and artifacts.
- Real model provider routing.
- Sandboxed browser, shell, file, and API workers.
- Multi-user authentication and permissions.
- Role and SOP versioning.
- Bounded review/deliberation nodes.
- Corroboration-based memory ratification.
- Self-improvement proposals for workflows, policies, and organization structure.
- Enterprise deployment patterns for regulated environments.

## Non-Goals

OpenMAO should not become:

- a replacement for every agent framework;
- a general-purpose project-management app;
- a tool that lets external runtimes own OpenMAO truth;
- a system that silently mutates collective memory or authority boundaries;
- a default path for live external side effects without explicit approval and auditability.
