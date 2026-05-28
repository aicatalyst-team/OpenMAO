# OpenMAO Vocabulary

OpenMAO uses native names for its organizational control concepts. This page maps product vocabulary
to the current contract model names. If a concept is not listed here, defer to
[docs/ARCHITECTURE.md](./ARCHITECTURE.md) and the executable contracts in
[ts/src/contracts/models.ts](../ts/src/contracts/models.ts).

## Canonical Types

| Concept | OpenMAO type | Notes |
| --- | --- | --- |
| Workspace (tenant) | `Workspace` | Every persisted resource carries `workspace_id`. |
| Organization | `Organization` | Holds `mission`, `vision`, `values`, `goals` as fields. |
| Mission | field on `Organization` | Not a standalone type in the current contracts. |
| Goal | `Goal` | Independent because goals outlive missions and have lifecycle. |
| Role | `Role` | Purpose, permissions, capability grants, reports-to. |
| Agent | `Agent` | Role-bound worker with private memory scope. |
| Unit of work | `WorkItem` | Accountable: owner, reviewer, criteria, risk, gates. |
| Delegated task | `TaskEnvelope` | Bounded handoff between spine and agent. |
| Agent return | `AgentOutcome` | Structured outcome with artifacts and cost. |
| Execution unit | `Run` | Status includes `suspended_approval`. |
| Capability (declaration) | `Capability` | Canonical input/output schemas. |
| Capability invocation | `CapabilityCall` | Persisted before approval evaluation. |
| Capability result | `CapabilityResult` | Output, artifacts, status. |
| Memory entry | `MemoryEntry` | Scope is `individual` or `collective`. |
| Promotion proposal | `PromotionCandidate` | Individual memory to collective memory requires approval. |
| Artifact | `Artifact` | Structured output with content hash. |
| Policy | `Policy` | Human-readable policy text in the current release. |
| Policy outcome | `PolicyDecision` | `allow`, `block`, `require_approval`, `log_only`. |
| Approval | `ApprovalRequest` | Resumes run or applies without run. |
| Evaluation | `Evaluation` | Rubric-driven scoring. |
| Audit event | `Event` | Workspace-local `seq`, optional `run_seq`. |
| Run trace node | `Trace` | Required for every graph node. |
| Idempotency record | `NodeEffect` | Tracks one-time side effects per node. |
| Model request | `ModelRequest` | All inference routes through here. |
| Model response | `ModelResponse` | Persisted with cost. |
| Org change proposal | `OrgChangeProposal` | Placeholder seam for future self-improvement. |
| Operational view | `WorldModelSnapshot` | Materialized projection from events; cache only. |

## Notable Splits

Three places where OpenMAO's vocabulary diverges from common usage. Each split is intentional.

### Task → `WorkItem` + `TaskEnvelope`

OpenMAO splits "task" into two types because they answer different questions.

- `WorkItem` is *what* must be done: objective, owner, reviewer, success criteria, risk, approval gates. It outlives any single execution attempt.
- `TaskEnvelope` is *how* a piece of work is handed to an agent for one run: bounded objective, allowed capabilities, context refs.

One `WorkItem` can produce many `TaskEnvelope`s across retries or re-delegations.

### WorldModelEvent → `Event` + `WorldModelSnapshot`

OpenMAO is event-sourced.

- `Event` is the durable atomic record of something that happened.
- `WorldModelSnapshot` is a materialized projection over events. It is a cache, not a source of truth. The world model never writes events; events feed the world model.

### Mission → field on `Organization`

`Mission` is not its own model because the current contract treats a mission as an immutable
statement owned by exactly one `Organization`. If multi-mission organizations ever exist, mission
may become its own type.

## See Also

- [ARCHITECTURE.md](./ARCHITECTURE.md) — current architecture and module ownership.
- [../ts/src/contracts/models.ts](../ts/src/contracts/models.ts) — executable contract definitions.
- [ROADMAP.md](./ROADMAP.md) — where OpenMAO goes next.
- [V0_SCOPE.md](./V0_SCOPE.md) — first-release scope and deferrals.
