# First Release Acceptance Evidence

This document maps the first-release acceptance surface to code and test evidence.
It does not replace maintainer release approval.

**Status:** `v0.1.0` accepted
**Last updated:** 2026-05-29
**Runtime:** TypeScript on Node.js 22 LTS

## Verification Commands

Run these before release acceptance:

```bash
make install
make check
npm run hygiene:public
rm -rf .openmao && make demo && make demo-approve && rm -rf .openmao
```

The default demo must require no external API keys or external services.

Latest verification on 2026-05-29:

- `make check` passed: TypeScript lint, typecheck, and 44 Vitest tests.
- `npm run hygiene:public` passed: tracked-file secret and public-boundary scan.
- `rm -rf .openmao && make demo && make demo-approve && rm -rf .openmao` passed.
- `make install` passed with `0` reported vulnerabilities.

## Acceptance Map

| Check | Required behavior | Evidence |
| --- | --- | --- |
| Demo flow | Coordinator creates schema-valid work and task envelope. | `ts/tests/spine.test.ts`, `ts/tests/contracts.test.ts`, `tests/fixtures/canonical_v0.json` |
| Demo flow | Worker invokes capability through the contract and returns schema-valid outcome/artifact. | `ts/tests/governance.test.ts`, `ts/tests/spine.test.ts`, `ts/tests/memory_world.test.ts` |
| Demo flow | Handoff is structured through Agent-Spine contract only. | `ts/tests/governance.test.ts`, `ts/tests/spine.test.ts` |
| Memory | Both agents write individual memory; promotion candidate is not auto-merged. | `ts/tests/spine.test.ts`, `ts/tests/memory_world.test.ts` |
| Audit | Run nodes emit traces; workspace/bootstrap events remain auditable. | `ts/tests/spine.test.ts`, `ts/tests/memory_world.test.ts`, `ts/tests/persistence.test.ts` |
| Approval | Approval gate blocks until human/API/CLI approval. | `ts/tests/spine.test.ts`, `ts/tests/governance.test.ts`, `ts/tests/surfaces.test.ts` |
| Authority | Only the spine coordinates; collective writes go through promotion approval. | `ts/tests/spine.test.ts`, `ts/tests/memory_world.test.ts`, `ts/src/spine/service.ts` |
| Resume | Resume continues from latest checkpoint. | `ts/tests/spine.test.ts` |
| Idempotency | Resume does not duplicate committed side effects. | `ts/tests/spine.test.ts`, `ts/tests/governance.test.ts`, `ts/tests/persistence.test.ts` |
| Idempotency | Resuming a completed run is idempotent. | `ts/tests/spine.test.ts` |
| Idempotency | Node effects enforce `(run_id, node, idempotency_key)`. | `ts/tests/persistence.test.ts` |
| Approval | Approval gate persists `suspended_approval` and `suspended_approval_id`. | `ts/tests/governance.test.ts`, `ts/tests/spine.test.ts` |
| Approval | Approval through API/CLI resumes after process exit. | `ts/tests/spine.test.ts`, `ts/tests/surfaces.test.ts` |
| Approval | Rejection follows `on_reject`. | `ts/tests/spine.test.ts`, `ts/tests/governance.test.ts` |
| Governance | Disallowed handoff is blocked. | `ts/tests/governance.test.ts` |
| Governance | Disabled capability is blocked. | `ts/tests/governance.test.ts` |
| Governance | Approval-required capability suspends before provider execution. | `ts/tests/governance.test.ts`, `ts/tests/spine.test.ts` |
| Governance | Approved capability resumes from persisted `CapabilityCall` and executes once; rejection follows `on_reject`. | `ts/tests/governance.test.ts`, `ts/tests/spine.test.ts` |
| Governance | `Policy.rule` is not evaluated as a DSL or host expression. | `ts/tests/governance.test.ts`, `ts/src/governance/service.ts` |
| Contracts | Policy outcomes use the canonical vocabulary only. | `ts/tests/contracts.test.ts` |
| World model | World model rebuilds from events and task/approval state. | `ts/tests/memory_world.test.ts`, `ts/tests/spine.test.ts` |
| World model | Deleting cached snapshots and rebuilding is deterministic. | `ts/tests/memory_world.test.ts` |
| World model | World-model snapshots are cache-only, not source of truth. | `ts/tests/memory_world.test.ts`, `ts/src/world/service.ts` |
| World model | Latest run status and workspace sequence match source state. | `ts/tests/memory_world.test.ts`, `ts/tests/spine.test.ts` |
| Surfaces | API, CLI, console, and demo use the shared service layer. | `ts/tests/surfaces.test.ts`, `ts/src/api/server.ts`, `ts/src/cli.ts` |
| Surfaces | Frontend/API write paths do not write directly to storage. | `ts/tests/surfaces.test.ts`, `ts/src/api/server.ts` |
| Workspace | One active run per workspace. | `ts/tests/persistence.test.ts`, `ts/tests/surfaces.test.ts` |
| Workspace | Workspace events with `run_id = null` are ordered by workspace `seq`. | `ts/tests/persistence.test.ts`, `ts/tests/spine.test.ts` |
| CLI | CLI supports approval approve and reject. | `ts/tests/surfaces.test.ts`, `ts/src/cli.ts` |
| Org changes | `OrgChangeProposal` is valid and persisted without autonomous mutation. | `ts/tests/memory_world.test.ts`, `ts/tests/contracts.test.ts` |
| Model routing | Simulated inference goes through `ModelRouterService`. | `ts/tests/memory_world.test.ts`, `ts/src/modeling/router.ts` |
| Contracts | Capability fixtures use canonical schema field names only. | `ts/tests/contracts.test.ts` |
| Capability resume | `capability_calls` persists before approval suspension and resume is not in-memory. | `ts/tests/governance.test.ts`, `ts/tests/spine.test.ts` |
| Events | Workspace events are visible through event API endpoints. | `ts/tests/surfaces.test.ts` |
| Approval | `apply_without_run` dispatches through `ApprovalService`; `no_op` rejection has no side effect. | `ts/tests/governance.test.ts`, `ts/tests/memory_world.test.ts` |
| Workspace | Active-run lock prevents second non-terminal run and survives restart. | `ts/tests/persistence.test.ts`, `ts/tests/surfaces.test.ts` |
| Workspace | Persisted capabilities and model responses include `workspace_id`. | `ts/tests/spine.test.ts`, `ts/tests/memory_world.test.ts`, `ts/tests/contracts.test.ts` |

## Release Evidence Summary

| Release requirement | Evidence |
| --- | --- |
| Repository installs locally. | `make install` is the documented install path. |
| Demo runs without external keys. | `make demo` and `make demo-approve`; deterministic mock provider. |
| Tests pass. | `make check`. |
| Two-agent handoff works. | `ts/tests/spine.test.ts`, `ts/tests/governance.test.ts`. |
| Checkpoint/resume works. | `ts/tests/spine.test.ts`, `ts/tests/persistence.test.ts`. |
| Promotion gate works. | `ts/tests/memory_world.test.ts`, `ts/tests/spine.test.ts`. |
| Collective memory is markdown-backed. | `ts/tests/memory_world.test.ts`, `ts/tests/spine.test.ts`. |
| Event/trace log reconstructs run. | `ts/tests/spine.test.ts`, `ts/tests/memory_world.test.ts`, `ts/tests/persistence.test.ts`. |
| Operator console can inspect and approve. | `ts/tests/surfaces.test.ts`. |
| README includes quickstart and architecture overview. | `README.md`. |
| No external runtime or service is required. | `README.md`, deterministic TypeScript demo tests. |

Release acceptance is recorded by the `v0.1.0` GitHub release.
