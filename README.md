# OpenMAO

OpenMAO is the open-source organizational substrate for AI-native companies.

It helps teams answer the questions that appear once agents and tools start doing real work:

- Who owns this task?
- What is this agent allowed to do?
- Which actions need human approval?
- What should become trusted organizational memory?
- What happened, in what order, and why?

OpenMAO does not try to replace every agent framework or business tool. Bring your own agents,
workflows, APIs, and MCP tools; OpenMAO gives the work a place to live with shared ownership,
policies, approvals, memory governance, audit trails, and a live world model.

> Bring your agents and tools. OpenMAO gives the work a place to live.
> Start with enforced approvals and audit for agent actions.
> Grow into trusted organizational memory and governed self-learning.

---

## What OpenMAO Does

OpenMAO is the system of record for AI work:

- **Roles and ownership:** define who is responsible for work, review, and capabilities.
- **Work lifecycle:** track accountable work from intake through assignment, blocking, review, and completion.
- **Policy and authority:** decide what agents or workers can read, write, call, or change.
- **Approval gates:** pause high-stakes actions until the right human approves or rejects them.
- **Tool governance:** expose business tools, MCP servers, APIs, browsers, shells, files, and SaaS
  products through scoped contracts instead of raw access.
- **Capability enforcement:** route risky side effects through governed providers instead of handing raw credentials to agents.
- **Memory promotion:** keep scratchpad knowledge separate from trusted shared memory.
- **Learning loops:** turn repeated blockers, stale memory, policy gaps, and weak handoffs into reviewed improvement proposals.
- **Events and traces:** record state changes and execution steps so work can be audited.
- **World model:** maintain a rebuildable view of goals, runs, blockers, approvals, memory, and recent activity.

The key rule is simple: external frameworks may execute bounded tasks, but the work item, owner,
lifecycle, approvals, memory consequences, event history, and world model live in OpenMAO. For risky
side effects, OpenMAO should be in the execution path: the agent cannot send, spend, deploy, write,
or mutate through governed capabilities without policy, approval, and audit.

## Current Status

OpenMAO is a local TypeScript release candidate. It proves the core semantics with a deterministic
demo that requires no external API keys, no real LLM calls, and no hosted services.

The demo creates a small organization, runs a two-agent workflow, pauses for human approval,
resumes from durable state, promotes memory only after approval, and leaves an inspectable event
and trace history.

License: Apache-2.0.

## Quickstart

Requirements:

- Node.js 22+
- npm
- make

Install and check the project:

```bash
make install
make check
```

Run the local demo:

```bash
make demo
make demo-approve
```

Inspect the world model:

```bash
npm run cli -- world --run run_99999999999999999999999999999999
```

Start the local operator console:

```bash
make console
```

The console runs on `127.0.0.1` and prompts for the operator token printed by the server.

## How It Fits

OpenMAO is the organizational substrate. Execution frameworks are workers on top of it.

```text
OpenMAO work items, owners, policies, approvals, memory, events, world model
  -> bounded work envelopes
  -> agents, workers, tools, and workflows execute bounded tasks
  -> risky capabilities route back through OpenMAO before execution
  -> outcomes return to OpenMAO as organizational record
```

The current execution path is deterministic and local. Future integration modes will let external
workers participate through SDK calls, enforced capability gateways, and event/trace ingestion.

## Useful Commands

```bash
make lint
make format
make typecheck
make test
make api
make console
npm run cli -- approvals list
npm run cli -- approvals approve <approval_id>
npm run cli -- approvals reject <approval_id>
npm run cli -- events [run_id]
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - current architecture and invariants.
- [docs/ROADMAP.md](docs/ROADMAP.md) - where OpenMAO goes after the local release.
- [docs/V0_SCOPE.md](docs/V0_SCOPE.md) - what the first release ships and what is deferred.
- [docs/VOCABULARY.md](docs/VOCABULARY.md) - terms used across OpenMAO.
- [docs/DEPLOYMENT_MODES.md](docs/DEPLOYMENT_MODES.md) - local, managed, and enterprise shapes.
- [docs/examples/acme_learning_lab.md](docs/examples/acme_learning_lab.md) - default demo walkthrough.
- [CHANGELOG.md](CHANGELOG.md) - public release history.
- [CONTRIBUTING.md](CONTRIBUTING.md) - contributor workflow.
- [SECURITY.md](SECURITY.md) - security reporting and expectations.
- [GOVERNANCE.md](GOVERNANCE.md) - project governance.
- [LICENSE](LICENSE) - Apache-2.0 license.

## Project Boundary

OpenMAO may learn from public agent and orchestration projects, and future versions may integrate
them through governed worker/capability adapters. It does not clone, vendor, fork, embed, or copy
external framework code.

Do not commit secrets, private data, local-only artifacts, or closed-source project material.
