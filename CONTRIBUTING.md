# Contributing to OpenMAO

OpenMAO is an organizational control layer for AI-native work. Contributions should preserve the
authority, approval, memory, audit, and world-model boundaries described in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Ground Rules

- Read [README.md](README.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and
  [docs/ROADMAP.md](docs/ROADMAP.md) before proposing substantial implementation changes.
- Keep changes scoped to a clear product, bug, documentation, or roadmap item.
- Do not clone, vendor, fork, embed, or copy external agent framework code.
- Do not commit secrets, private customer data, private project artifacts, internal communications,
  private strategy notes, session transcripts, or closed-source repo content.
- Tests are part of the deliverable.
- Changes to canonical contracts, persistence, policy, approvals, memory promotion, or public API
  behavior require maintainer approval and public documentation updates.

## Contribution Workflow

1. Open or reference the relevant GitHub issue form.
2. Identify the affected product area.
3. Keep the change focused.
4. Add or update tests for behavior changes.
5. Update docs when source-of-truth behavior changes.
6. Run relevant checks.
7. Use the pull request template.

## Review Expectations

Implementation work should include:

- scope summary;
- related issue;
- tests/checks run;
- contract impact;
- review impact;
- known risks or deferred items.

For non-trivial implementation streams, maintainers may require additional review before merge.

## Documentation Changes

Use:

- public docs for durable product and contributor-facing information;
- pull requests and issues for implementation history;
- GitHub issues for public roadmap questions, bugs, and feature requests.

Do not use public docs for private deliberation, model conversations, session notes, scratch
decisions, or pre-public build-process records. Those belong in ignored local workspace paths.

## Code of Conduct

Be direct, kind, and precise. Focus review comments on behavior, risk, maintainability, and project fit.
