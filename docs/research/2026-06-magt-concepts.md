# Research Brief: Runtime-Governance Concepts from Microsoft's Agent Governance Toolkit

**Date:** 2026-06-11
**Source reviewed:** [microsoft/agent-governance-toolkit](https://github.com/microsoft/agent-governance-toolkit) (MIT), v4.1.0
**Boundary:** This project allows external projects to influence design but forbids cloning,
vendoring, embedding, or copying external implementation code, and forbids adopting foreign runtime
APIs as OpenMAO contracts. This review inspected public documentation and source for concepts only.
No code from the reviewed project enters this repository.

**Research question (approved by the project owner):** which concepts from the Agent Governance
Toolkit strengthen OpenMAO's substrate without diluting it?

## Adopted concepts

Each entry names the OpenMAO concern it fills.

### 1. Schema-pinned MCP tool bindings (definition-drift detection)

**Concern:** MCP binding granularity and audit integrity —
[#112](https://github.com/OpenMAO/OpenMAO/issues/112).

The toolkit's MCP gateway intercepts at tool level (one policy per MCP tool, not per server) and
fingerprints tool definitions to detect "rug-pull" drift, where a server silently changes what a
tool does after trust was granted. Adopted as design input: pin a fingerprint of the tool
definition on the Capability at registration; at invocation, drift between the live definition and
the pinned fingerprint blocks the call and emits an event. The approval that granted a capability
then refers to a specific tool shape, not whatever the server later serves under the same name.
Posted to #112 as a design comment.

### 2. Asymmetric autonomy adjustment

**Concern:** earned autonomy and real reversibility —
[#120](https://github.com/OpenMAO/OpenMAO/issues/120).

The toolkit implements automated trust decay on a numeric 0–1000 score. The score was deliberately
not adopted (it conflicts with human-ratified, evidence-cited autonomy). What was adopted is the
asymmetry underneath it: audited evidence can tighten automatically, while loosening stays
human-ratified. OpenMAO's version uses typed, deterministic triggers over events already recorded,
suspends specific capability grants (not organization-level autonomy), and records each narrowing
as a hash-chained event with evidence references. The proposal passed the project's two-model
charter drift test before filing; the converged conditions are in the issue.

### 3. First-class limitations documentation

**Concern:** truth-in-status and reviewer trust — [LIMITATIONS.md](../LIMITATIONS.md).

The toolkit maintains an unusually thorough limitations document enumerating its own boundary
(in-process enforcement, attempts-versus-outcomes logging, knowledge-governance gap) with
mitigations. The practice — stating your own boundaries instead of letting reviewers discover
them — was adopted directly: `docs/LIMITATIONS.md` now states OpenMAO's enforcement boundary,
trust-boundary gaps on main, crash windows, partial-flywheel honesty, and an OWASP Agentic Top-10
mapping with explicit out-of-scope rows.

## Explicitly not adopted

- **Numeric trust scoring (0–1000 with tiers):** pseudo-quantified trust conflicts with autonomy
  earned through audited, reversible, human-governed widening. The evidence trail is the asset; a
  number summarizing it invites gaming and false precision.
- **Policy-language pluggability (YAML/Rego/Cedar):** OpenMAO owns governance semantics through
  typed capability classes. A policy-DSL surface would widen the kernel without sharpening it.
- **Execution rings, SRE package, plugin marketplace, inter-agent trust protocol:** runtime,
  operations, and supply-chain layers that belong to other altitudes, or that remain
  design-stage in the reviewed project itself.

## Influence statement

OpenMAO and the Agent Governance Toolkit sit at different altitudes (see
[POSITIONING.md](../POSITIONING.md)): the toolkit governs the moment of a call in-process and is
deliberately stateless; OpenMAO owns the durable record the call belongs to. The concepts adopted
above were chosen because they sharpen OpenMAO's existing primitives — capability bindings,
the autonomy dial, truth-in-status documentation — rather than adding a parallel system.
