# v1 Acceptance Evidence

This document maps the v1 enforced-capability governance surface to code and test evidence.
It does not replace maintainer release approval or independent review.

**Status:** implementation candidate, pending independent review
**Last updated:** 2026-05-29
**Runtime:** TypeScript on Node.js 22 LTS

## Verification Commands

Run these before v1 acceptance:

```bash
make install
make check
npm run hygiene:public
rm -rf .openmao && make demo && make demo-approve && rm -rf .openmao
rm -rf .openmao && npm run cli -- worker demo && npm run cli -- approvals approve approval_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb && rm -rf .openmao
```

Latest verification on 2026-05-29:

- `make check` passed: TypeScript lint, typecheck, 58 Vitest tests, and public hygiene scan.
- `rm -rf .openmao && make demo && make demo-approve && rm -rf .openmao` passed.
- `rm -rf .openmao && npm run cli -- worker demo && npm run cli -- approvals approve approval_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb && rm -rf .openmao` passed.

The default v0 demo and the v1 worker demo require no live external credentials or hosted services.

## Acceptance Map

| Check | Required behavior | Evidence |
| --- | --- | --- |
| v0 compatibility | The local demo still runs with no external credentials. | `ts/tests/spine.test.ts`, `ts/tests/surfaces.test.ts`, smoke command above |
| Work substrate | Work can be created, assigned, enveloped, reviewed, and closed through services. | `ts/tests/work_service.test.ts`, `ts/tests/surfaces.test.ts`, `ts/src/work/service.ts` |
| External worker | A framework-neutral worker registers, receives bounded work, and submits an outcome. | `ts/tests/reference_worker.test.ts`, `ts/src/workers/reference-worker.ts` |
| Gateway | A side-effecting capability call is persisted before execution. | `ts/tests/governance.test.ts`, `ts/tests/reference_worker.test.ts` |
| Approval | High-risk worker capability calls suspend before provider execution. | `ts/tests/governance.test.ts`, `ts/tests/reference_worker.test.ts` |
| Resume | Approval resumes from persisted capability-call state after process restart. | `ts/tests/governance.test.ts`, `ts/tests/surfaces.test.ts` |
| Idempotency | Approved provider execution happens at most once. | `ts/tests/governance.test.ts`, `ts/tests/reference_worker.test.ts` |
| Rejection | Rejected capability approvals produce an explicit blocked result. | `ts/src/capabilities/registry.ts`, `ts/tests/governance.test.ts` |
| Credential boundary | Workers receive credential handles, not raw credential values. | `ts/tests/contracts.test.ts`, `ts/tests/governance.test.ts`, `ts/src/capabilities/providers.ts` |
| Grants | Worker identity must be enabled and granted the capability. | `ts/tests/governance.test.ts`, `ts/src/capabilities/registry.ts` |
| Ingestion | External worker ingestion is workspace-scoped and idempotent. | `ts/tests/ingestion.test.ts`, `ts/tests/reference_worker.test.ts` |
| World model | External workers and ingestions project into a rebuildable world model. | `ts/tests/reference_worker.test.ts`, `ts/tests/memory_world.test.ts` |
| SDK | The local SDK preserves workspace, actor, idempotency, work, outcome, and ingestion identity. | `ts/tests/sdk.test.ts`, `ts/src/sdk/local-client.ts` |
| API | HTTP surfaces expose work, workers, ingestion, capability calls, capability results, approvals, and world model state through services. | `ts/tests/surfaces.test.ts`, `ts/src/api/server.ts` |
| CLI | CLI supports the v1 worker start/approval flow. | `ts/tests/surfaces.test.ts`, `ts/src/cli.ts` |
| Console | The console can inspect worker approvals, capability calls, results, events, traces, and world state. | `ts/tests/surfaces.test.ts`, `ts/src/api/server.ts` |
| Hygiene | Public hygiene checks pass. | `scripts/check-public-hygiene.ts`, `make check` |

## v1 Demo Story

The v1 local demo proves the enforced worker path:

1. `npm run cli -- worker demo` registers the reference worker, creates accountable work, issues a bounded envelope, records a capability call, and suspends at approval.
2. `npm run cli -- approvals approve approval_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb` approves the request, resumes the provider call, records the result exactly once, submits the worker outcome, records ingestion, reviews the work, and completes the run.
3. API and console surfaces can inspect the same state through `/approvals`, `/capability-calls`, `/capability-results`, `/events`, `/runs`, `/work`, `/ingestion`, and `/world`.

## Release Gate Status

| Gate | Status |
| --- | --- |
| Implementation checks | Passing |
| v0 compatibility smoke | Passing |
| v1 worker gateway smoke | Passing |
| Public hygiene | Passing |
| QA review | Pending |
| Security review | Pending |
| Architecture review | Pending |
| Maintainer release approval | Pending |

Release acceptance should be recorded only after the pending review gates are complete.
