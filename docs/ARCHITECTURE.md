# OpenMAO Architecture

OpenMAO is an organizational control layer for AI-native work. Agents, tools, workflows, and
external runtimes may execute bounded work, but OpenMAO remains the system of record for authority,
policy, approvals, memory promotion, event semantics, auditability, and the world model.

The product principle:

> Bring your own agents. OpenMAO makes them accountable.

## Core Invariants

A change that violates these invariants is a bug.

1. OpenMAO owns organizational truth.
2. Every state-changing action goes through services and emits an event.
3. Shared memory changes only through promotion and approval.
4. Capability execution is governed before it runs.
5. The UI and API are adapters over services; they do not orchestrate or write directly to storage.
6. The world model is a rebuildable projection, not a source of truth.
7. External runtimes can execute work, but they cannot own policy, approval state, memory, events, or run lifecycle.
8. The default local demo requires no external credentials, live LLM calls, hosted services, or networked tools.

## Product Shape

OpenMAO models the organizational layer around AI work:

- **Workspace:** local tenant boundary for runs, state, memory, and events.
- **Organization:** mission, roles, policies, goals, and operating context.
- **Role:** responsibility, permissions, capability grants, and reporting structure.
- **Agent:** role-bound worker with scoped memory and model binding.
- **WorkItem:** accountable unit of work with owner, reviewer, criteria, risk, and gates.
- **Run:** one execution attempt over work.
- **Capability:** declared action with canonical input/output schemas.
- **ApprovalRequest:** durable human gate for high-risk actions.
- **MemoryEntry:** individual or collective knowledge.
- **PromotionCandidate:** proposal to move individual memory into trusted collective memory.
- **Event:** durable record of what happened.
- **Trace:** run-node execution record.
- **WorldModelSnapshot:** materialized operational view built from source state.

The executable contracts live in [ts/src/contracts/models.ts](../ts/src/contracts/models.ts), and
the generated portable schema lives in [schemas/canonical/v0.schema.json](../schemas/canonical/v0.schema.json).

## Layer Model

```text
Agents, tools, external runtimes
  -> governed worker/capability adapters
  -> OpenMAO services
  -> SQLite state, events, checkpoints, memory metadata
  -> world model projection
  -> CLI, API, operator console
```

## Concern Ownership

| Concern | Owner |
| --- | --- |
| Canonical contracts and IDs | `ts/src/contracts/` |
| SQLite schema and stores | `ts/src/persistence/` |
| Workspace-local events and audit records | `ts/src/persistence/events.ts` |
| Runs, checkpoints, and node effects | `ts/src/persistence/runs.ts`, `checkpoints.ts`, `effects.ts` |
| Organization and role registry | `ts/src/org/` |
| Policy decisions and approvals | `ts/src/governance/` |
| Capability registry and providers | `ts/src/capabilities/` |
| Individual and collective memory promotion | `ts/src/memory/` |
| World model projection | `ts/src/world/` |
| Deterministic model routing | `ts/src/modeling/` |
| Control spine and demo flow | `ts/src/spine/` |
| Local runtime wiring | `ts/src/runtime/` |
| HTTP API and console | `ts/src/api/` |
| CLI | `ts/src/cli.ts` |

## Control Spine

The spine is the only component that coordinates organizational work. It creates runs, checkpoints
state, routes handoffs, invokes workers through bounded envelopes, evaluates capability boundaries,
suspends for approval, resumes after approval, writes traces, and updates source state through
services.

The local release supports one active non-terminal run per workspace. This keeps approval/resume and
idempotency behavior deterministic. A run in `queued`, `running`, or `suspended_approval` holds the
workspace active-run lock; the lock is released only when the run reaches `completed` or `failed`.

## Approval Flow

Approval is durable state, not an in-memory callback.

1. A service creates an `ApprovalRequest`.
2. OpenMAO emits `approval.requested`.
3. The run is checkpointed with `status = "suspended_approval"` when the approval is run-scoped.
4. API, CLI, or console approval records `approval.approved` or `approval.rejected`.
5. Approved run-scoped work resumes from persisted state.
6. Rejected work follows its configured rejection behavior.

Approval-required capabilities suspend before provider execution. Resume reloads the persisted
`CapabilityCall` and executes it once through the node-effect/idempotency protocol.

## Memory Model

OpenMAO separates private working knowledge from trusted organizational memory.

- Agents may write individual memory.
- Collective memory requires a `PromotionCandidate`.
- Promotion requires approval.
- Approved promotion writes markdown-backed collective memory exactly once.
- Collective memory files are outputs of OpenMAO services, not direct UI or agent writes.

## Events, Traces, and World Model

Events are the durable audit trail. Traces describe run-node execution. The world model is a cache
rebuilt from events and source state so operators can inspect what the organization is doing, what is
blocked, what needs approval, and what changed recently.

Deleting a world-model snapshot must not delete truth. Rebuilding it from source state should produce
the same operational picture.

## Runtime Choices

The current implementation uses:

- TypeScript 5.x
- Node.js 22 LTS
- Zod contracts
- generated JSON Schema
- SQLite
- a lightweight TypeScript HTTP server
- a TypeScript CLI
- Vitest tests

These choices keep the local release easy to install and deterministic while preserving clear seams
for later providers, hosted storage, and external workers.

## Integration Boundary

OpenMAO can integrate with external services, tools, and runtimes through governed adapters. Those
adapters must translate work into OpenMAO-native contracts and return through OpenMAO services.

Do not clone, vendor, fork, embed, or copy external framework code. New external dependencies require
maintainer approval and tests proving they preserve OpenMAO authority, policy, approval, memory,
event, and world-model invariants.
