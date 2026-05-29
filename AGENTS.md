# AGENTS.md - OpenMAO Agent Protocol

This file is for coding agents working in the OpenMAO repository.

## Start Here

Read in this order:

1. `README.md`
2. `docs/ARCHITECTURE.md`
3. `docs/ROADMAP.md`
4. `CONTRIBUTING.md`
5. `SECURITY.md`
6. `GOVERNANCE.md`

## Hard Rules

- Preserve one owner per concern.
- Use deterministic/mock defaults.
- Do not require external credentials for the default demo.
- Do not clone, vendor, fork, embed, or copy external agent framework code.
- External runtimes may execute bounded tasks, but OpenMAO owns the work item, authority, approvals,
  memory promotion, events, and world-model truth.
- Tool access must be modeled as scoped capabilities before it is treated as governed.
- High-risk external actions must not be described as governed unless they run through
  OpenMAO-managed providers or credential brokers.
- Do not copy closed-source project content into this repo.
- Do not commit internal communications, private strategy notes, session transcripts, model
  conversations, scratch decisions, or pre-public build-process records.
- Tests are part of the deliverable.
- Every state-changing action must pass through services, policy, and event logging.
- The UI never orchestrates and never writes directly to storage.
- The world model is a rebuildable projection, not source of truth.

## Working Protocol

Before work:

1. Check `git status --short`.
2. Read the relevant public docs.
3. Identify whether the change touches canonical contracts, security, persistence, approvals, or public API behavior.

During work:

1. Keep changes scoped.
2. Update tests with implementation changes.
3. Add unresolved public design questions to GitHub issues when they are ready for public tracking.
4. Do not overwrite unrelated user changes.

Before handoff:

1. Summarize what changed.
2. List tests/checks run.
3. Note contract, security, or migration impact.
4. Note known risks and deferred items.

## Public Context

Public contributors must be able to understand the product from committed docs, issues, pull requests, and code.

## Documentation Types

- Public docs: durable product and contributor-facing information.
- Pull request: implementation history and review discussion.
- Issue: public task, bug, feature request, or audit finding.

## Do Not Commit

- real secrets or credentials;
- `.env` files with live values;
- private customer data;
- closed-source repo excerpts;
- copied third-party framework code;
- internal communications, model conversations, session notes, or private strategy drafts;
- generated caches, local runtime files, or large artifacts unless explicitly approved.
