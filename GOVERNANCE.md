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
5. External runtimes may execute governed work, but no foreign runtime or framework becomes an OpenMAO source of truth.
6. The operator console never orchestrates and never writes directly to storage.
