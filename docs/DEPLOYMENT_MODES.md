# Deployment Modes

OpenMAO supports three deployment modes. They differ in *which backends serve each plane* — the control plane (OpenMAO's own runtime state) and the data plane (organization-owned infrastructure). The canonical contracts, the governance rules, and the audit log invariants are identical across all three modes; only the backends underneath them change.

This document describes adoption modes. The modes do not introduce additional contract types.

## Mode 1: Native / Local

For hobbyists, contributors, regulated/airgapped environments, and the default local release.

| Concern | Backend |
| --- | --- |
| OpenMAO runtime state | SQLite at `.openmao/openmao.sqlite3` |
| Collective memory | Markdown files at `.openmao/collective_memory/` |
| Artifacts | Local filesystem at `.openmao/artifacts/` |
| Events / traces | SQLite |
| Capabilities | `MockProvider` only |
| Model router | `MockModelRouter` (deterministic) |
| Secrets | None for the default demo |

Properties:
- No external API keys required.
- No network access required.
- Reproducible: same input produces the same trace.
- Suitable for local development, demos, CI, and air-gapped evaluations.

This is the only mode supported by the current release.

## Mode 2: Managed / Simple Cloud

For small organizations after the local release. Deferred — see [ROADMAP.md](./ROADMAP.md).

Indicative shape:

| Concern | Backend |
| --- | --- |
| OpenMAO runtime state | Postgres (managed, e.g., Supabase) |
| Collective memory | Markdown in a Git repository |
| Artifacts | Object store (S3-compatible, Supabase Storage, R2, GCS) |
| Vector index | pgvector |
| Capabilities | Real HTTP providers behind canonical capability contracts |
| Model router | Real LLM provider via the model router seam |
| Secrets | Environment variables or hosted secret store |

Properties:
- One cloud account; minimal infrastructure footprint.
- Suitable for early-stage organizations and small teams.
- All organizational data still lives in the chosen provider, governed by capability contracts and approval gates.

## Mode 3: Enterprise Cloud

For larger organizations after the local release. Deferred — see [ROADMAP.md](./ROADMAP.md).

Indicative shape:

| Concern | Backend |
| --- | --- |
| OpenMAO runtime state | Postgres/RDS/Aurora |
| Collective memory | Git repository or document store |
| Artifacts | S3 / GCS / Azure Blob |
| Vector index | pgvector or external vector store |
| Capabilities | Mix of HTTP providers, MCP servers, sandbox providers |
| Model router | Multi-provider routing through the router seam |
| Secrets | Vault / AWS Secrets Manager / GCP Secret Manager / equivalent |
| Warehouses | Snowflake / BigQuery / Databricks behind capability contracts |
| Business systems | Internal APIs behind capability contracts |

Properties:
- Mixes managed and self-hosted services as the organization requires.
- All access flows through governed capability providers; no direct agent-to-infrastructure connections.
- Cost, audit, and approval semantics are the same as the other modes.

## What stays constant across all modes

These are properties of the OpenMAO control plane, not of any deployment mode:

- Every state-changing action emits an `Event`.
- Every graph node emits a `Trace`.
- Every capability call is checked against policy and may suspend on approval before execution.
- Collective memory writes happen only through approved promotion.
- Agents never receive raw provider credentials.
- The CLI and console run the same way; only the configured backends change.

## What the current release does not include

- Real provider implementations for any database, object store, file store, secret store, or SaaS tool.
- A credential manager beyond the documented invariant.
- Multi-cloud routing logic.
- Hosted SaaS or multi-tenant authentication.

See [docs/V0_SCOPE.md](./V0_SCOPE.md) for the first-release ship-vs-defer matrix.
