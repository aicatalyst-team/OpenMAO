# OpenMAO Roadmap

OpenMAO starts with a deterministic local release that proves the organizational substrate:
accountable work, governed handoff, approval suspension/resume, memory promotion, audit events,
traces, and a rebuildable world model.

The roadmap keeps that substrate stable while expanding the workers, tools, and execution runtimes
that can operate on top of it.

The near-term wedge is enforced capability governance: route risky agent actions through OpenMAO so
policy, approval, idempotency, and audit happen before side effects execute.

## Long-Term Mission

OpenMAO's mission is to become the organizational substrate for AI-native companies: the durable
place where AI work is owned, governed, remembered, audited, and improved.

The long-term vision has four pillars:

1. **Enforced action governance** — risky agent actions route through OpenMAO-managed capability
   providers or credential brokers so policy, approval, idempotency, and audit happen before side
   effects execute.
2. **Governed tool access** — business tools, MCP servers, APIs, databases, browsers, shells, file
   systems, and SaaS products are exposed to agents through scoped tool contracts instead of raw,
   ambient access.
3. **Organizational memory** — private working knowledge, artifacts, decisions, and recurring
   lessons can be promoted into trusted collective memory through evidence and approval instead of
   silently drifting into shared truth.
4. **Governed self-learning** — OpenMAO can detect repeated blockers, missing capabilities, weak
   handoffs, stale memory, unclear roles, policy gaps, and unreliable workflows, then propose
   improvements for human review before they become active.

The destination is not autonomous chaos. It is an accountable organization that can remember,
explain, improve, and remain under human-governed authority as more work moves to agents.

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

## v1 Target: Enforced Capability Governance on the Organizational Substrate

v1 should prove that real work can live in OpenMAO while risky external actions are enforced through
OpenMAO before execution.

The v1 promise:

> A developer can create accountable work in OpenMAO, assign it to an external worker, gate risky
> actions before execution, resume safely after approval, review the outcome, and inspect the
> resulting events, traces, memory, and world model.

v1 is not a hosted enterprise platform yet. It is the first release where OpenMAO becomes useful with
real agents, tools, or workflows by making at least one side-effecting capability enforceable rather
than merely cooperative.

### v1 User Journey

1. A developer installs OpenMAO locally.
2. They create or import accountable work with an owner, reviewer, criteria, risk, and capability grants.
3. OpenMAO assigns bounded work to an external worker through the TypeScript SDK.
4. The worker executes the bounded task in its own framework/runtime.
5. The worker requests a side-effecting capability action through OpenMAO because the relevant credential/provider is brokered by OpenMAO.
6. OpenMAO checks role permissions and policy.
7. A high-risk action creates a durable approval request before execution.
8. The operator approves or rejects through CLI, API, or console.
9. Approved work resumes exactly once.
10. The worker returns an outcome and artifact reference.
11. OpenMAO records events, traces, policy decisions, memory proposals, and a world-model update.
12. The operator reviews or closes the work in OpenMAO.

### v1 Required Work

#### 1. Work Substrate

Ship the public work-intake and assignment path: create/import work, assign owner and reviewer,
produce bounded work envelopes, track lifecycle state, and close or review work after worker
outcomes return.

#### 2. SDK Mode

Ship a TypeScript client for governed workers. The SDK should cover worker identity, work envelopes,
authorization checks, event recording, approval requests, artifact/outcome submission, and memory
promotion proposals.

#### 3. Gateway Mode

Ship one enforced side-effecting capability path. The first provider should be narrow and
developer-visible, such as a GitHub issue/comment/pull-request action. Credentials must be handled
by provider code and never exposed to workers, events, traces, or capability payloads. Policy and
approval must run before execution, and approval resume must execute at most once.

In OpenMAO terms, tools are concrete things agents want to use: GitHub, email, Slack, a database, a
browser, a shell, an MCP server, or an internal API. Capabilities are the governed OpenMAO
declarations that expose those tools safely: named action, schema, provider, risk, credential handle,
policy, approval behavior, and audit payload.

#### 4. Ingestion Mode

Ship an event/trace/outcome ingestion path for external runtimes that already execute work
elsewhere. Ingested records must be idempotent, authenticated, workspace-scoped, and projected into
the world model only through approved rules.

#### 5. Reference External Worker

Ship a small example worker outside the local spine. It should demonstrate the contract boundary:
the worker executes bounded work, while OpenMAO owns authority, policy, approval state, memory,
events, traces, and world-model truth.

#### 6. Operator Review Loop

Improve the console enough for the v1 story: runs, pending approvals, capability calls, events,
traces, artifacts, memory proposals, and world-model state should be easy to inspect during the
external-worker demo.

### v1 Acceptance Criteria

- A clean clone can run the local v0 demo without external credentials.
- A developer can create/import a work item, assign ownership, and hand bounded work to an external worker.
- With configured test credentials or a mock remote provider, a developer can run the v1 external
  worker demo end to end.
- At least one external worker integrates without becoming the source of OpenMAO truth.
- At least one side-effecting capability is enforceable through an OpenMAO-managed provider or
  credential broker.
- The external worker cannot execute that side effect with raw credentials in the default v1 demo path.
- Approval resume works after process restart and executes the approved action at most once.
- SDK, gateway, and ingestion writes require workspace identity, actor/source identity, and
  idempotency keys.
- Raw secrets never appear in events, traces, capability-call payloads, artifacts, or logs.
- The world model reflects external-worker activity through rebuildable projection rules.
- The operator can inspect what happened, who/what requested it, which policy applied, who approved
  it, how the work state changed, and what changed afterward.

### v1 Non-Goals

- Hosted SaaS control plane.
- Multi-tenant enterprise authentication.
- Full marketplace of providers.
- Full compatibility adapters for every agent framework.
- Execution-framework internal checkpointing/retry semantics.
- Broad credential brokering for every external system.
- Autonomous self-improvement.
- Broad sandboxed browser/shell/file execution.

### Governed Worker Adapter Contract

Define the first public adapter contract for external workers. The adapter must let external systems
execute bounded work while OpenMAO keeps ownership of authority, policy, approvals, memory, events,
traces, and world-model state.

### Enforced Capability Providers

Add the first non-mock capability provider. The provider contract must include provider identity,
credential handles, scopes, audit payloads, failure behavior, and approval requirements without
exposing raw credentials to agents. For approval-required actions, the provider must not execute
until OpenMAO records approval.

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
- Tool registry and scoped tool grants for MCP, HTTP APIs, SaaS tools, and internal systems.
- Sandboxed browser, shell, file, and API workers.
- Multi-user authentication and permissions.
- Evidence-backed organizational memory search and review.
- Memory decay, contradiction detection, and stale-memory review.
- Role and SOP versioning.
- Bounded review/deliberation nodes.
- Corroboration-based memory ratification.
- Self-improvement proposals for workflows, policies, roles, memory, tools, capabilities, and organization structure.
- Enterprise deployment patterns for regulated environments.

## Non-Goals

OpenMAO should not become:

- a replacement for every agent framework;
- a general-purpose project-management app;
- a tool that lets external runtimes own OpenMAO truth;
- a system that silently mutates collective memory or authority boundaries;
- a default path for live external side effects without explicit approval and auditability.
