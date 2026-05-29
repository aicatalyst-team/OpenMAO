# Where OpenMAO Fits

This is a short orientation to how OpenMAO relates to the wider ecosystem of agent and AI
infrastructure projects.

Positioning snapshot: May 2026. This landscape moves quickly.

OpenMAO is an open, self-hostable organization-of-record for AI-native organizations: the substrate
that owns work, roles, ownership, policy, approvals, memory, and the audit trail, so an organization
of agents and humans can operate accountably and earn autonomy over time. See
[NORTH_STAR.md](../NORTH_STAR.md) for the full charter.

## The Shape of the Ecosystem

Most of the surrounding ecosystem solves one layer, and solves it well:

- **Agent frameworks** orchestrate how individual agents reason and act.
- **Memory layers** give agents and applications recall, personalization, and knowledge retrieval.
- **Governance and control planes** add policy, identity, and guardrails around agent calls.
- **Durable-execution substrates** make long-running, reliable workflows possible.
- **Enterprise autonomous-suite platforms** bring "the business runs itself" to large proprietary
  stacks.

These are complementary capabilities. OpenMAO is designed to sit with them, not to replace them.

## Where OpenMAO Sits

OpenMAO operates at the organization altitude, above any single agent or framework, and ties these
layers into one accountable system of record.

Two properties define the niche:

1. **Open and self-hostable.** The organization owns its substrate, data, memory, and audit trail.
   This matters for sovereignty, regulated environments, and teams that cannot put their operating
   brain inside a closed cloud.
2. **Autonomy is earned.** OpenMAO starts supervised and widens autonomy only on an audited track
   record, with a governed self-correction loop as the long-horizon goal.

In short:

> open + self-hostable + cross-framework + organization-of-record + governed self-correction, as one
> coherent thing.

## How It Composes

OpenMAO is bring-your-own by design: bring your agents, agent framework, model providers, memory
store, and durable-execution substrate.

OpenMAO provides the organizational layer above them:

- accountable work items;
- roles, owners, and reviewers;
- policy and approvals;
- promoted institutional memory;
- event and audit history;
- world-model projection;
- evidence-backed improvement proposals.

A reference worker and sensible defaults can help users get started, but nothing is fused. OpenMAO's
value is meant to survive swapping the framework underneath.

## Related Work

This is a non-exhaustive, respectful map of neighboring projects and what they focus on. OpenMAO
complements rather than competes with most of these:

- **Agent frameworks** such as LangGraph, CrewAI, and OpenAI Agents SDK orchestrate agent reasoning
  and multi-step execution. OpenMAO can govern and learn above any of them.
- **Memory layers** such as Mem0, Zep, Letta, and Cognee provide recall and personalization.
  OpenMAO governs and promotes institutional memory at the organization level and can sit above a
  memory store.
- **Governance and control planes** provide policy and guardrails around agent calls. OpenMAO treats
  this as substrate and adds the organizational layer above it.
- **Durable-execution substrates** such as Temporal, Restate, Inngest, and DBOS make reliable
  long-running workflows possible. OpenMAO is designed to run on top of such a substrate when the
  local spine outgrows simple persistence.
- **Self-improving agents** improve at the agent or skill level. OpenMAO's frontier is governed
  organizational self-correction: the organization revising its own roles, policies, SOPs,
  capabilities, and workflows from evidence.

If a project belongs here, or a description needs correcting, contributions are welcome.
