# Design: Multi-Human Governance

**Status:** design proposal. Tracks a direction, not a committed contract. Implementation lands in
stages behind the acceptance criteria below.

## Why

[NORTH_STAR.md](../../NORTH_STAR.md) already describes OpenMAO as the substrate for "an organization
of agents **and humans**," with the human role receding "from operator to board." The current
implementation, however, represents the human as a single `operator` archetype rather than as a
first-class, multi-member organization. This document designs the path from single-operator to
accountable multi-human governance, without changing the charter's direction — it realizes it.

This is a *destination* concern, not the launch wedge. The goal here is to (a) land the small,
clearly-correct hardening that is safe today and (b) lock the design so that going from one human to
many is "add principals," not a rewrite.

## What the code does today

Stated as facts against the current contracts and services:

- **Human identity is not first-class.** `ExternalActorRef.actor_type` includes `"operator"` as one
  enum value with a free-string `actor_id` ([ts/src/contracts/models.ts](../../ts/src/contracts/models.ts)),
  and `WorkerIdentity` models the *machine* side, but there is no symmetric `Principal`/`Member`
  type for humans.
- **Authority is carried as opaque strings.** `WorkItem.owner` / `reviewer`, `ApprovalRequest.requested_by`,
  `AutonomyCase.ratified_by`, and `OrgChangeApplication.applied_by` are all free strings with no
  binding to a known identity or to what that identity is allowed to do.
- **The boundary authenticates with one shared secret.** The HTTP surface gates on a single
  workspace-global operator token (`x-openmao-operator-token`) and reads the acting identity from a
  caller-supplied `x-openmao-actor` header
  ([ts/src/api/server.ts](../../ts/src/api/server.ts)). The console hardcodes a single
  `CONSOLE_ACTOR`. As a result, every separation-of-duties check downstream compares
  caller-controlled values.
- **Separation-of-duties is enforced inconsistently.** Autonomy ratification refuses a ratifier equal
  to the proposer ([ts/src/org/autonomy.ts](../../ts/src/org/autonomy.ts)) and org-change *apply*
  refuses an applier equal to the proposer ([ts/src/org/apply.ts](../../ts/src/org/apply.ts)), but
  `ApprovalService.approve` records the approver and never compares it to `requested_by`
  ([ts/src/governance/approvals.ts](../../ts/src/governance/approvals.ts)) — so memory promotions and
  org-change approvals are self-approvable.
- **Corroboration distinctness is by string, and is off by default.** A promotion's corroboration
  must come from a different actor *string* than the proposer, and `min_corroboration` defaults to
  `0` ([ts/src/memory/service.ts](../../ts/src/memory/service.ts)), so independent evidence is not
  required unless explicitly configured.

These are individually reasonable for a single trusted operator. They become load-bearing the moment
a second human shares the boundary.

## The ordering insight

Three layers must land in dependency order. The data model alone is not enough: a richer identity
type bound to a spoofable boundary is still spoofable.

| Layer | Concern | Without it |
| --- | --- | --- |
| **0 — identity at the boundary** | Acting identity is verified and session-bound, not a free header behind a shared token. | Every separation-of-duties check compares caller-controlled values. |
| **1 — first-class identity & authority** | `Principal` and `AuthorityGrant` give humans the same first-class shape machines already have. | Nothing for the boundary to bind to; authority stays implicit in strings. |
| **2 — collaboration surface** | A swappable adapter lets many humans and agents collaborate in shared rooms, feeding signed evidence in. | No multi-participant surface; or one gets reinvented inside OpenMAO. |

## Proposed model

- **`Principal`** — an OpenMAO-owned identity for a `human`, `agent`, `worker`, `system`, or
  `provider` (and, later, a `group`). Symmetric with the existing `WorkerIdentity`: humans become
  first-class, not an enum value.
- **`ExternalActorRef`** — stays as *provenance* (who, in Sprout / Slack / GitHub / a runtime, did
  this), but resolves to a `principal_id`. Provenance and authority are separated.
- **`AuthorityGrant`** — what a principal may do as a governance act: `approve`, `ratify`, `review`,
  `apply`, `escalate`, scoped by impact/target. Authority is data, not a string convention.
- **`GovernanceBody` / `PrincipalGroup`** *(later)* — quorum and board semantics, so widening can
  require a body rather than any single human.

References that carry authority — `reviewer`, `requested_by`, `ratified_by`, `applied_by`,
`owner` — migrate from free strings toward typed principal references.

## Governance semantics under many humans

- **Corroboration.** Distinct actors can raise factual confidence; *policy* decides whether a given
  promotion requires distinct **humans**, distinct **roles**, or merely independent evidence.
  Distinctness should ultimately be checked on `principal_id`, not on actor string, so two identities
  driven by one person do not corroborate each other.
- **Ratification.** Widening autonomy must come from an authorized human principal (or governance
  body), separated from the proposer — not from any non-equal string.
- **Autonomy cases.** A widening should record, as audited events, *who* ratified, *under what
  authority/policy*, and *why* — preserving the "earned on evidence" property as the human set grows.
- **Approvals.** Consequential approvals (promotion, org change) require an approver distinct from the
  requester, and — for high-impact org changes — an approver carrying sufficient authority.

## Migration sequence

1. Specify `Principal` and authority semantics (this document → contracts).
2. Add compatibility so the current single-operator demo keeps working (the lone operator is simply
   the first `Principal`).
3. Migrate `reviewer` / `requested_by` / `ratified_by` / `applied_by` / `owner` toward typed
   principal references.
4. Bind identity at the boundary (Layer 0), then only afterward build the swappable
   `CollaborationAdapter` (Layer 2) as identity-and-evidence ingestion across Sprout / Matrix / Slack.

## Acceptance criteria

A change in this direction is on-charter when each holds (these are the project's drift checks made
concrete):

1. **Flywheel.** Multi-human contribution strengthens institutional memory and self-correction, and
   the governance/enforcement stage keeps its integrity through the transition.
2. **Substrate, not identity.** `Principal` / `AuthorityGrant` and the collaboration adapter are
   substrate plumbing; they do not turn OpenMAO into a chat product or recenter it on governance
   theater.
3. **Earned autonomy.** Ratification authority is verifiable, so widening is backed by *who had
   authority*, not just a distinct string.
4. **Swap test.** The collaboration surface is swappable (Sprout / Matrix / Slack); principals,
   governance events, memory, and autonomy cases stay in OpenMAO if it changes.
5. **Real enforcement.** Identity is session-bound at the boundary; separation-of-duties checks
   compare verified principals, not caller-controlled strings. Until this holds, multi-human
   governance is advisory, not enforced, and must be labeled as such.
6. **Wedge vs destination.** First-class `Principal` advances the self-correcting-organization
   destination without blocking the single-operator wedge.
7. **Ownership.** Principals and authority live in the OpenMAO store; swapping the collaboration
   surface never migrates the institutional asset out.

## Landed alongside this design

Two small, clearly-correct hardening changes ship now because they are safe under the current
single-operator surface and close real self-approval / weak-evidence gaps:

- A proposer ≠ approver guard on `ApprovalService.approve`, mirroring the guard autonomy ratification
  already enforces.
- Independent corroboration required (`min_corroboration: 1`) on the production promotion path, while
  the deterministic demo path is unchanged.

## Deferred (tracked as issues)

Layers 0–2 above and the authority/quorum semantics are tracked as separate issues linked from the
multi-human governance tracking issue. They are deliberately *not* in the launch wedge.

## See also

- [NORTH_STAR.md](../../NORTH_STAR.md) — direction and the Drift Test.
- [docs/VOCABULARY.md](../VOCABULARY.md) — canonical types.
- [docs/ARCHITECTURE.md](../ARCHITECTURE.md) — module ownership and invariants.
- [docs/ROADMAP.md](../ROADMAP.md) — where multi-user authentication sits as a cross-cutting enabler.
