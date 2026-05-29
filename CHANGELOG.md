# Changelog

All notable public release changes for OpenMAO are documented here.

## Unreleased

No unreleased changes.

## v0.4.0 - 2026-05-29

Adds the first real, side-effecting capability provider behind OpenMAO authority.

### Added

- GitHub issue-comment provider: a real, side-effecting capability provider that creates a comment on a GitHub issue. The credential is resolved at execution time and sent only in the Authorization header; it never appears in capability calls, results, events, traces, or logs.
- Credential broker: an environment-backed broker resolves a non-secret `cred_*` handle to a secret inside provider code only. `Capability.credential_handle` binds a capability to a specific handle, and the gateway rejects a call whose handle does not match, so a worker cannot steer credential resolution to another configured secret.
- Async capability execution: providers may perform real network I/O. The gateway awaits provider execution outside the database transaction while preserving at-most-once execution through a durable node-effect guard plus an in-process in-flight join.
- Opt-in real-provider wiring: the GitHub provider is registered only when `OPENMAO_GITHUB_ENABLED=1` and `OPENMAO_CRED_GITHUB` is set. With no configuration the runtime is mock-only, so the default demo and CI need no credentials.

### Changed

- Side-effecting providers declare themselves so the side-effect / approval gate is enforced even if a capability is misregistered as non-side-effecting.
- The runtime secret guard also rejects GitHub fine-grained (`github_pat_`) tokens.

### Semantics

- OpenMAO guarantees at most one provider invocation per capability call, not remote exactly-once: if a request times out after GitHub created the comment but before OpenMAO records success, the call is recorded as failed even though the comment exists. Reconcile by inspecting the issue's comments before retrying.

### Upgrade note

- This release adds `Capability.credential_handle` and enforces capability-bound credentials. A local `.openmao` database created before v0.4.0 that holds a credential-requiring capability without the new field will block such calls; reset local state (`rm -rf .openmao`) or re-register the capability when upgrading. The default demos already reset local state.

### Verification

- `make check`
- `rm -rf .openmao && make demo && make demo-approve && rm -rf .openmao`
- `rm -rf .openmao && npm run cli -- worker demo && npm run cli -- approvals approve approval_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb && rm -rf .openmao`
- Optional, gated (real network, throwaway repo): `OPENMAO_GITHUB_ENABLED=1 OPENMAO_CRED_GITHUB=… ` drive a governed GitHub issue-comment capability end to end.

## v0.3.1 - 2026-05-29

Patch release for public documentation and clarity fixes after the v0.3.0 release.

### Fixed

- Added the missing `docs/POSITIONING.md` file linked from the README and docs index.
- Clarified repeated-blocker detector semantics in code comments.
- Clarified that `OrgChangeProposal.status = "pending"` is retained for compatibility while the
  service creates `proposed` proposals.

## v0.3.0 - 2026-05-29

Stable institutional learning loop release.

This promotes `v0.3.0-rc.1` after implementation checks, smoke verification, and independent QA,
Security, and Architecture review gates.

## v0.3.0-rc.1 - 2026-05-29

Release candidate for the institutional learning loop milestone.

### Added

- Institutional learning scan that detects repeated blockers, failed handoffs, approval bottlenecks, missing/disabled capabilities, and stale memory.
- Evidence-backed `OrgChangeProposal` lifecycle with proposal review approval, rejection, and explicit applied-marker events.
- CLI, API, console, and world-model visibility for learning proposals.
- Acceptance evidence at `docs/release/v0.3.0_acceptance_evidence.md`.

### Verification

- `make check`
- `rm -rf .openmao && make demo && make demo-approve && rm -rf .openmao`
- `rm -rf .openmao && npm run cli -- worker demo && npm run cli -- approvals approve approval_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb && rm -rf .openmao`
- deterministic local learning smoke: create repeated blockers, run `learning scan`, approve the generated proposal, mark it applied, and remove `.openmao`.

## v0.2.0-rc.1 - 2026-05-29

Release candidate for the enforced capability governance milestone.

### Added

- Enforced capability governance candidate.
- Framework-neutral reference worker demo with bounded work, approval-required side effect, outcome submission, ingestion, review, and world-model projection.
- External-worker capability gateway checks for worker identity, capability grants, provider availability, credential handles, approval, and at-most-once execution.
- API, CLI, and console surfaces for the external-worker flow, capability calls, and capability results.
- Acceptance evidence at `docs/release/v0.2.0-rc.1_acceptance_evidence.md`.

### Verification

- `make check`
- `rm -rf .openmao && make demo && make demo-approve && rm -rf .openmao`
- `rm -rf .openmao && npm run cli -- worker demo && npm run cli -- approvals approve approval_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb && rm -rf .openmao`

## v0.1.0 - 2026-05-29

First accepted OpenMAO release.

This promotes `v0.1.0-rc.2` after acceptance verification. It includes the deterministic local
runtime, canonical contracts, approval-gated execution and memory promotion, event/trace audit
records, rebuildable world model, CLI/API/operator console surfaces, and security reporting path.

## v0.1.0-rc.2 - 2026-05-29

Second public release candidate with review-blocker fixes.

### Changes

- Added high-risk capability enforcement: enabled high-risk calls now require approval before provider execution.
- Added a regression test for high-risk enabled capability approval.
- Fixed the operator console work table to display the canonical `owner` field.
- Enabled and documented GitHub private vulnerability reporting.
- Aligned public architecture and vocabulary docs with the implementation boundary and projection model.

### Verification

- `make check`
- `npm run hygiene:public`
- `rm -rf .openmao && make demo && make demo-approve && rm -rf .openmao`

## v0.1.0-rc.1 - 2026-05-29

First public release candidate for OpenMAO as an organizational substrate for AI-native work.

### Ships

- TypeScript runtime on Node.js 22.
- Zod canonical contracts with generated JSON Schema.
- SQLite persistence for workspace state, runs, checkpoints, events, traces, approvals, memory, and world model snapshots.
- Deterministic local demo with no external API keys, live LLM calls, hosted services, or networked tools.
- Two-agent governed handoff through the OpenMAO spine.
- Approval suspension and durable resume.
- Approval-gated collective memory promotion.
- Rebuildable world model projection.
- API, CLI, and minimal local operator console.
- Public hygiene checks for secrets and internal process leaks.

### Verification

- `make check`
- `npm run hygiene:public`
- `rm -rf .openmao && make demo && make demo-approve && rm -rf .openmao`

See [docs/release/v0.1.0_acceptance_evidence.md](docs/release/v0.1.0_acceptance_evidence.md) for the release-candidate evidence map.
