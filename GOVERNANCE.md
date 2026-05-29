# OpenMAO Governance

This document defines public project governance for OpenMAO.

## Role Legend

- `R` = Responsible: executes the work.
- `A` = Accountable: final authority.
- `C` = Consulted: gives input before decision.
- `I` = Informed: receives outcome.

## Roles

- `Maintainer` - final authority for scope, releases, and repository policy.
- `Contributor` - proposes and implements scoped changes.
- `Reviewer` - reviews pull requests for correctness and maintainability.
- `Security Reviewer` - reviews security-sensitive changes and vulnerability reports.
- `Researcher` - produces approved public pattern briefs only.

## RACI Matrix

| Decision / Action | Maintainer | Contributor | Reviewer | Security Reviewer | Researcher |
| --- | --- | --- | --- | --- | --- |
| Scope and roadmap approval | A | C | C | C | I |
| Canonical contract change | A | R | C | C | I |
| Feature implementation | A | R | C | I | I |
| Pull request review | A | C | R | C | I |
| Security-sensitive change | A | I | C | R | I |
| External research approval | A | I | C | C | R |
| Release approval | A | I | C | C | I |

## Control Rules

1. Maintainers decide scope, roadmap priority, and release readiness.
2. Canonical contract changes require maintainer approval.
3. Security-sensitive changes require security review.
4. No real external credentials, networked tools, or live infrastructure mutation are required for the default demo.
5. External runtimes may execute bounded tasks, but no foreign runtime or framework becomes the source of truth for OpenMAO work, authority, approvals, memory, events, or world model state.
6. Tool access must be exposed through scoped capability contracts before it is treated as governed.
7. High-risk external capabilities must be designed to run through OpenMAO-managed providers or credential brokers before they are treated as enforceable.
8. The operator console never orchestrates and never writes directly to storage.
