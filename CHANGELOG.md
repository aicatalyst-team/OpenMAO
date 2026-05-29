# Changelog

All notable public release changes for OpenMAO are documented here.

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
