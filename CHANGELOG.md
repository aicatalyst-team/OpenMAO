# Changelog

All notable public release changes for OpenMAO are documented here.

## Unreleased

No unreleased changes.

## v0.3.1 - 2026-05-29

Patch release for public documentation and clarity fixes after the v0.3.0 release.

### Fixed

- Added the missing `docs/POSITIONING.md` file linked from the README and docs index.
- Clarified repeated-blocker detector semantics in code comments.
- Clarified that `OrgChangeProposal.status = "pending"` is retained for compatibility while the
  service creates `proposed` proposals.

## v0.3.0 - 2026-05-29

Stable v1.5 institutional learning loop release.

This promotes `v0.3.0-rc.1` after implementation checks, smoke verification, and independent QA,
Security, and Architecture review gates.

## v0.3.0-rc.1 - 2026-05-29

Release candidate for the v1.5 institutional learning loop milestone.

### Added

- Institutional learning scan that detects repeated blockers, failed handoffs, approval bottlenecks, missing/disabled capabilities, and stale memory.
- Evidence-backed `OrgChangeProposal` lifecycle with proposal review approval, rejection, and explicit applied-marker events.
- CLI, API, console, and world-model visibility for learning proposals.
- v1.5 acceptance evidence at `docs/release/v1_5_acceptance_evidence.md`.

### Verification

- `make check`
- `rm -rf .openmao && make demo && make demo-approve && rm -rf .openmao`
- `rm -rf .openmao && npm run cli -- worker demo && npm run cli -- approvals approve approval_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb && rm -rf .openmao`
- deterministic local learning smoke: create repeated blockers, run `learning scan`, approve the generated proposal, mark it applied, and remove `.openmao`.

## v0.2.0-rc.1 - 2026-05-29

Release candidate for the v1 enforced capability governance milestone.

### Added

- Enforced capability governance candidate.
- Framework-neutral reference worker demo with bounded work, approval-required side effect, outcome submission, ingestion, review, and world-model projection.
- External-worker capability gateway checks for worker identity, capability grants, provider availability, credential handles, approval, and at-most-once execution.
- API, CLI, and console surfaces for the v1 worker flow, capability calls, and capability results.
- v1 acceptance evidence at `docs/release/v1_acceptance_evidence.md`.

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

See [docs/release/v0_acceptance_evidence.md](docs/release/v0_acceptance_evidence.md) for the release-candidate evidence map.
