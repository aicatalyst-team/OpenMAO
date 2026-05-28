# OpenMAO

OpenMAO is an open-source control layer for AI-native organizations.

It helps teams answer the questions that appear once agents and tools start doing real work:

- Who owns this task?
- What is this agent allowed to do?
- Which actions need human approval?
- What should become trusted organizational memory?
- What happened, in what order, and why?

OpenMAO does not try to replace every agent framework or business tool. Bring your own agents,
workflows, APIs, and MCP tools; OpenMAO gives them shared roles, policies, approvals, memory
governance, audit trails, and a live world model.

> Bring your own agents. OpenMAO makes them accountable.

---

## What OpenMAO Does

OpenMAO provides the organizational layer around AI work:

- **Roles and ownership:** define who is responsible for work, review, and capabilities.
- **Policy and authority:** decide what agents or workers can read, write, call, or change.
- **Approval gates:** pause high-stakes actions until the right human approves or rejects them.
- **Memory promotion:** keep scratchpad knowledge separate from trusted shared memory.
- **Events and traces:** record state changes and execution steps so work can be audited.
- **World model:** maintain a rebuildable view of goals, runs, blockers, approvals, memory, and recent activity.

The key rule is simple: external workers may execute tasks, but OpenMAO remains the system of
record for organizational truth.

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

OpenMAO is the control plane, not the data plane.

```text
Agents, workers, tools, and workflows
  -> governed capabilities and worker adapters
  -> OpenMAO policy, approvals, memory, events, traces
  -> rebuildable world model and operator surfaces
```

The current execution path is deterministic and local. Future integration modes will let external
workers participate through SDK calls, governed capability gateways, and event/trace ingestion.

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
