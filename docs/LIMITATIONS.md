# Known Limitations

**Status:** maintained honesty document. Last reviewed 2026-06-11.

A governance project should state its own boundaries instead of letting reviewers discover them.
Every claim below is meant to match the code on `main`. If a statement here overstates or
understates what the code does, that is a bug — please open an issue.

Each limitation links the tracking issue where one exists.

## 1. Enforcement is credential ownership plus deployment discipline

The capability gateway, policy checks, and credential broker run inside the OpenMAO process. An
agent can take a governed side effect only through the gateway, because the broker holds the real
secret and resolves it inside the provider at execution time; agents hold opaque handles and have
nothing to authenticate with on their own.

What this does not cover: if an operator hands a worker raw credentials outside OpenMAO, that
worker is ungoverned. No software layer here can prevent that. "Non-bypassable" therefore means
bypassable only by violating the deployment contract, not by anything an agent can do inside it.
Making this boundary provable rather than asserted — execution-claim events that are verifiably
distinct from worker self-reports, plus a stated deployment topology — is
[#111](https://github.com/OpenMAO/OpenMAO/issues/111).

## 2. The platform trust boundary on main is weaker than the capability boundary

`main` currently uses a single shared operator token and a self-asserted actor header, and there is
no proposer-must-not-approve guard. A holder of the operator token can act as any actor. Hardened
per-worker scoped tokens and the approval-integrity fixes exist on branches and are tracked at
[#101](https://github.com/OpenMAO/OpenMAO/issues/101) and
[#102](https://github.com/OpenMAO/OpenMAO/issues/102). Until they merge, treat the deployment as
single-trusted-operator.

## 3. At-most-once has a crash window at the provider edge

OpenMAO guarantees at most one provider invocation per capability call (durable intent before
execution, node-effect and in-flight guards, restart-replay tested). It cannot guarantee remote
exactly-once: if a request times out after the remote system performed the effect but before the
result is recorded, the call is recorded as failed even though the effect exists. The GitHub
provider documents this window and the reconciliation step. Claim hygiene for this is part of
[#111](https://github.com/OpenMAO/OpenMAO/issues/111).

## 4. The event log is tamper-evident, but verification has no operator surface yet

Events are append-only (enforced with SQL triggers) and hash-chained (SHA-256, each event carrying
the previous event's hash back to a fixed genesis value), and the intended call is logged before
execution. Two gaps: chain verification currently exists only as code, with no one-command operator
surface ([#119](https://github.com/OpenMAO/OpenMAO/issues/119)), and events do not yet carry an
expected-vs-actual decision envelope that would make regressions detectable from the log alone
([#114](https://github.com/OpenMAO/OpenMAO/issues/114)). Events reported by cooperative workers are
attested by the worker, not yet provably distinct from enforced-path events
([#111](https://github.com/OpenMAO/OpenMAO/issues/111)).

## 5. The demo proves the approve path; the deny path is a packaging gap

`make demo` and `make demo-approve` show suspend-on-approval, durable resume, and the promoted
memory. There is not yet a `make demo-deny` showing a rejected approval and a blocked ungranted
call on the record ([#118](https://github.com/OpenMAO/OpenMAO/issues/118)). The rejection and
deny-by-default paths exist in code and tests.

## 6. The self-correction loop is partially real

Learning signals and organization-change proposals are real and deterministic. But exactly one
change type has a real applier today (memory cleanup); every other "applied" change is a marker
that records the decision without changing behavior, and the marker path is not revertible from the
operator surface ([#105](https://github.com/OpenMAO/OpenMAO/issues/105)). The causal-diagnosis
layer is a library with tests, advisory by design, with no operator surface. The autonomy dial's
widening service exists with tests but has no CLI, API, or console surface — autonomy cannot be
widened in a running deployment yet.

## 7. Memory provenance is not yet a hard invariant

Promotion to collective memory requires human ratification, and corroboration means an independent
actor citing distinct evidence. But individual memory without provenance is currently excluded from
the world model rather than structurally forbidden.
[#113](https://github.com/OpenMAO/OpenMAO/issues/113) makes provenance mandatory — one of
capability result, event, or explicit operator attestation — with unprovenanced memory permanently
untrusted.

## 8. Single human operator, single organization

There is no Member model. Multi-human roles (separate proposer, approver, board), and structural
multi-tenant isolation, are future work. Workspace isolation today is logical, not enforced
per-tenant. The supported deployment is a single organization in local mode (see
[DEPLOYMENT_MODES.md](DEPLOYMENT_MODES.md)).

## 9. No mid-run revocation channel

Approval gates run before execution. Once a long-running bounded task is underway, there is no
built-in way to narrow its grants mid-flight; revocation today means rejecting future calls. A
revocation channel is part of the capability-scoping design work
([#102](https://github.com/OpenMAO/OpenMAO/issues/102),
[#112](https://github.com/OpenMAO/OpenMAO/issues/112)).

## 10. Action governance, not reasoning governance

OpenMAO governs what agents do — capability calls, work, memory — not what models think. A prompt
injection can still shape what an agent proposes. The gate bounds the blast radius to deniable,
auditable actions; it does not sanitize cognition.

## 11. No runtime sandbox

OpenMAO does not confine the filesystem, network, or process behavior of worker processes. That is
a different layer; compose OpenMAO with a runtime sandbox if you need it. See
[POSITIONING.md](POSITIONING.md) for how the layers relate.

## 12. Scale honesty

The spine is local SQLite with a deterministic demo topology. No Postgres, no multi-replica, no
multi-run concurrency target yet. The design intent is to sit on a durable-execution substrate when
deployments outgrow the local spine.

## OWASP Agentic Top 10 mapping

Status against the OWASP Top 10 for Agentic Applications (December 2025), stated honestly:

| Risk | Where OpenMAO stands today | Open gap |
| --- | --- | --- |
| Tool misuse | Addressed: deny-by-default capability grants, typed schemas, approval gates, broker-held credentials | Per-run token attenuation ([#102](https://github.com/OpenMAO/OpenMAO/issues/102)) |
| Human-agent trust exploitation | Addressed in part: approvals are durable state with recorded rejection | Proposer-must-not-approve guard not yet on main ([#101](https://github.com/OpenMAO/OpenMAO/issues/101)) |
| Identity abuse | Partial: actor model exists; platform tokens are weak on main | [#101](https://github.com/OpenMAO/OpenMAO/issues/101), [#102](https://github.com/OpenMAO/OpenMAO/issues/102) |
| Memory poisoning | Addressed in part: human-ratified promotion, independent corroboration | Provenance as hard invariant ([#113](https://github.com/OpenMAO/OpenMAO/issues/113)) |
| Rogue agents | Partial: autonomy starts advisory and is bounded by grants | No mid-run revocation (§9); autonomy dial has no operator surface (§6) |
| Cascading failures | Partial: bounded work envelopes, at-most-once invocation guards | Provider-edge crash window (§3) |
| Goal hijacking | Out of scope: reasoning-layer risk; the gate bounds blast radius (§10) | — |
| Code execution | Out of scope: runtime-sandbox layer (§11) | — |
| Insecure communications | Out of scope in local mode: transport security is the deployment's responsibility | Revisit for networked modes |
| Supply chain | Out of scope today: no plugin marketplace; standard dependency hygiene applies | — |

"Out of scope" rows are deliberate: OpenMAO composes with the layers that own those risks rather
than claiming them.
