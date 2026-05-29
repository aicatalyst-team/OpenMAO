# v1.5 Acceptance Evidence

This document maps the v1.5 institutional learning loop to code and test evidence.

**Status:** accepted stable release
**Last updated:** 2026-05-29
**Runtime:** TypeScript on Node.js 22 LTS

## Verification Commands

Run these before v1.5 acceptance:

```bash
make check
rm -rf .openmao && make demo && make demo-approve && rm -rf .openmao
rm -rf .openmao && npm run cli -- worker demo && npm run cli -- approvals approve approval_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb && rm -rf .openmao
```

Latest verification on 2026-05-29:

- `make check` passed: TypeScript lint, typecheck, 76 Vitest tests across the public `ts/tests`
  suite, and public hygiene scan.
- `rm -rf .openmao && make demo && make demo-approve && rm -rf .openmao` passed.
- `rm -rf .openmao && npm run cli -- worker demo && npm run cli -- approvals approve approval_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb && rm -rf .openmao` passed.
- A local v1.5 smoke created repeated blockers, ran `learning scan`, approved the generated proposal, marked it applied, and removed `.openmao`.

## Acceptance Map

| Check | Required behavior | Evidence |
| --- | --- | --- |
| Research-informed design | v1.5 follows evidence clustering, human review, and no auto-apply constraints. | GitHub issue #24 |
| Contracts | `OrgChangeProposal` carries evidence, source signal, confidence, impact, review approval, and lifecycle status. | `ts/src/contracts/models.ts`, `ts/tests/contracts.test.ts`, generated schema |
| Detectors | Learning scan detects repeated blockers, failed handoffs, approval bottlenecks, missing capabilities, and stale memory. | `ts/src/learning/service.ts`, `ts/tests/learning.test.ts` |
| Proposal lifecycle | Proposals can be proposed, approved, rejected, and marked applied explicitly. | `ts/src/org/changes.ts`, `ts/src/governance/approvals.ts`, `ts/tests/learning.test.ts` |
| No silent mutation | Applied proposals are audit markers and do not mutate org config, roles, policies, memory, capabilities, or org graph. | `ts/src/org/changes.ts`, `ts/tests/learning.test.ts` |
| Idempotency | Repeated scans reuse stable proposals and approvals for unchanged evidence. | `ts/tests/learning.test.ts` |
| World model | Open proposals and learning signals project from source state and remain cache-only. | `ts/src/world/service.ts`, `ts/tests/learning.test.ts` |
| CLI/API | Operator surfaces can scan, list, approve, reject, apply, and inspect proposals through services. | `ts/src/cli.ts`, `ts/src/api/server.ts`, `ts/tests/surfaces.test.ts` |
| Console | Console exposes a learning proposal view and calls API routes for actions. | `ts/src/api/server.ts`, `ts/tests/surfaces.test.ts` |
| Existing release paths | v0 demo and v1 worker gateway remain compatible. | smoke commands above |

## Release Gate Status

| Gate | Status |
| --- | --- |
| Implementation checks | Passing |
| v0 compatibility smoke | Passing |
| v1 worker gateway smoke | Passing |
| v1.5 learning smoke | Passing |
| Public hygiene | Passing |
| QA review | Passed after repeated-blocker and hygiene fixes; tracked by GitHub issue #33 |
| Security review | Passed after sensitive-material blocker fix; tracked by GitHub issue #34 |
| Architecture review | Passed; tracked by GitHub issue #35 |
| Maintainer release approval | Approved for `v0.3.0` stable release |
