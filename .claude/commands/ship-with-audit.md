---
description: Deliver a task + run the deliver→audit→fix→re-audit loop automatically.
argument-hint: <task description>
allowed-tools:
  - Agent
  - Bash(tools/codex-audit.sh*)
  - Bash(git log*)
  - Bash(git diff*)
  - Bash(git status*)
  - Bash(git add*)
  - Bash(git commit*)
  - Bash(git push*)
  - Bash(git rev-parse*)
  - Bash(git show*)
  - Bash(git blame*)
  - Bash(git diff --name-only*)
  - Bash(gh pr view*)
  - Bash(gh pr comment*)
  - Bash(gh issue view*)
  - Bash(gh issue comment*)
  - Bash(make*)
  - Bash(uv*)
  - Bash(pytest*)
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - TodoWrite
  - ToolSearch
---

# /ship-with-audit — automated deliver → audit → fix → re-audit loop

Runbook: [docs/runbooks/ship-with-audit.md](../../docs/runbooks/ship-with-audit.md)
Codex wrapper: [tools/codex-audit.sh](../../tools/codex-audit.sh) — present. Requires `codex` CLI on `PATH`; if absent, the loop degrades to Claude-only audit (see runbook § "Codex augmentation").

## Task

**$ARGUMENTS**

**STOP HERE if the task above is empty or whitespace-only.** Do not proceed into § 1 Pre-flight until the user has described a concrete deliverable. Ask them what they want built, get an answer, then restart the command with that as the argument. Do not guess the intent from conversation history — the argument is the contract.

## Protocol — follow in order

### 1. Pre-flight
- `git status --short` and `git log -1 --oneline` to confirm branch + head.
- If the working tree is dirty with unrelated changes, surface it and ask before proceeding.

### 1.5. Runtime feasibility spike (iter-0)

**Before starting § 2 Implement, ask: "where is this code going to run, and can it actually run there?"** A negative answer here invalidates every audit cycle below — fixing audit findings on code that can't deploy is wasted effort.

This step is mandatory when ANY of these are true about the deliverable:
- The deliverable depends on a Python version, library, or platform feature not already proven in this repo.
- The deliverable depends on a runtime environment variable, capability provider, or external service whose presence in the target deployment is not already proven.
- The deliverable introduces a new mock provider, capability, or seam that must integrate with the spine, governance, or memory layers.
- The deliverable involves schema generation, migrations, or any artifact that must round-trip cleanly through `make schemas` / `make test` / `make demo`.

**Spike protocol (5–30 min):**
1. **Identify each library or language feature the deliverable will use** (Pydantic v2 features, FastAPI routes, SQLite operations, async patterns, etc.).
2. **For each, verify it works in the target runtime via a minimal proof.** A 10-line throwaway in the actual stack beats any documentation review. For new Pydantic models: instantiate one with a fixture and assert `model_dump_json()` round-trips. For new SQLite tables: confirm the schema applies on a fresh DB. For new capabilities: invoke through `CapabilityRegistry` not directly.
3. **Document findings** as a 2–3 line note in the task brief or commit message. Make the discovered constraint visible — future audit-loop work should not have to rediscover it.

**Common traps (OpenMAO-specific; expand as the project accumulates incidents):**
- **v0 demo must require no external credentials.** Any path that depends on a real API key violates the v0 contract.
- **All state changes must pass through services + policy + event log.** Direct DB writes bypass the audit invariant.
- **Collective memory writes only happen through approved promotion.** Direct file writes to `workspace/collective_memory/` violate the invariant in [SPEC §27](../../SPEC.md).
- **Agents never see raw provider credentials.** Any path that surfaces a secret in a model prompt, capability payload, memory entry, artifact, event, or trace violates [SPEC §27.1](../../SPEC.md).
- **Code shipped to main ≠ code that runs.** When `make demo` exists, a deliverable is not done until `make demo` succeeds end-to-end on a fresh checkout with no external credentials.

**Exit criteria:**
- ✅ **Spike confirms feasibility** → proceed to § 2 Implement.
- ❌ **Spike surfaces a blocker** → STOP. Hand back to user with the discovered constraint + options. Do not proceed to § 2 hoping it'll work — every iteration cycle below will be wasted.
- ⚠️ **Spike is genuinely impossible to do offline** (e.g., the deliverable depends on an external service that isn't yet stubbed) → document the gap, ask user if they accept the production discovery risk, and only then proceed.

**This step exists because:** ship-with-audit's audit loop is good at code correctness but does not ask "does this work in production?" That question is structural and belongs at iter-0, not at deployment time.

### 2. Implement
- Build the deliverable for the task above.
- **Run the project gates before committing** for any code-changing task: `make check` (covers lint + typecheck + test in the v0 Makefile target), or the closest equivalent if `make check` is not yet wired up. A failing gate means the deliverable is not done — fix and re-run before the commit. AGENTS.md states tests are part of the deliverable. Skip this bullet only when the diff is docs-only with no executable code or schema surface.
- Make one focused commit when the deliverable is complete. Commit message should summarize the change in one line and reference the task description.
- Note the resulting SHA via `git rev-parse --short HEAD` — call this `$SHA_1`.

### 2.5. Trivial-change triage

After § 2's commit, classify the diff before deciding which audit surfaces to spend.

**Trivial** = ALL of the following:
1. NO files in any of these "always-audit-fully" zones:
   - `SPEC.md`
   - `docs/adr/`
   - `docs/VOCABULARY.md`, `docs/V0_SCOPE.md`, `docs/DEPLOYMENT_MODES.md`
   - `GOVERNANCE.md`, `SECURITY.md`, `AGENTS.md`, `CONTRIBUTING.md`, `OPEN_QUESTIONS.md`
   - `schemas/` (when present)
   - `migrations/` (when present)
   - any file matching `src/openmao/**/types*.py` or canonical service interfaces (when present)
2. AND ANY one of:
   - Only `*.md` files changed (docs, sessions, READMEs)
   - Only `pyproject.toml` + lockfile changed (dependency bump)
   - Diff ≤ 10 lines AND no files matching `*.py|*.sql|*.sh|*.toml`

If either condition fails → **non-trivial** (default).

Compute the classification with `git diff --name-only $BASE..$SHA_1` + `git diff --shortstat $BASE..$SHA_1`. Document the verdict (`trivial` / `non-trivial` + the rule that fired) in the session summary's audit trail.

**Effect on § 3:**
- **Trivial** → run only the Claude audit + (if available) stock Codex pass. Skip the steered Codex pass and the history-context sub-agent. Saves ~50% of audit time/cost on doc-only and dep-bump diffs without losing the dual-surface safety net.
- **Non-trivial** → run all surfaces (Claude audit + Codex stock+steered if available + history context).

**Never trivialize** — when in doubt, default to non-trivial. The cost of one wasted steered pass is small; the cost of skipping audit on a quietly-substantive change is the entire reason this loop exists.

### 3. First-pass audit (multi-surface: Claude audit + optional Codex + git-history context)
- **Surface A — Claude audit agent.** Spawn via the `Agent` tool (`general-purpose` subagent). Prompt the agent to deep-audit the diff `<base>..$SHA_1` and emit findings in this shape:
  ```
  - severity: P0 | P1 | P2 | P3
    confidence: high | medium | low
    file:line
    finding: <one sentence>
  ```
  End with a `VERDICT: CLEAN` or `VERDICT: FINDINGS n=N` line. Confidence definitions:
  - **high**: clear evidence; the finding points at the line that breaks; no plausible reading of the code saves it.
  - **medium**: strong suspicion; rests on an assumption about runtime behaviour, caller patterns, or unwritten invariants. Verify before acting.
  - **low**: pattern smell or speculation; flag it, but the calling agent should verify before fixing or even before classifying severity.

- **Surface B — Codex (stock + steered).** Optional augmentation. In parallel with Surface A, if `tools/codex-audit.sh` exists and Codex is configured, run `tools/codex-audit.sh $SHA_1` in the background via `Bash(run_in_background=true)`. The wrapper runs both passes; the steered prompt demands the same `severity + confidence + file:line + finding` shape. The stock pass uses Codex's default rubric — assign confidence post-hoc when reading its output (default `medium` unless the finding is trivially verifiable from the diff). If the wrapper is absent, skip Surface B and proceed with Claude-only audit; document in the session summary that Codex was unavailable.
  - **If trivial-change triage classified the diff as trivial:** invoke the wrapper as `--stock-only` instead. Skip the steered pass.

- **Surface C — git-history context (NON-TRIVIAL diffs only).** In parallel with A + B, spawn a second `Agent` (`general-purpose` subagent) for context-from-history. Feed it the changed-file list (`git diff --name-only <base>..$SHA_1`); have it run `git log --oneline -n 8 -- <file>` and `git blame -L <touched-lines> <file>` for each, then emit findings of the form:
  - "Line X reverts the intent of commit ABC123 (which resolved issue #NN) — verify intent."
  - "Line X removes a pattern stable across N commits / M months — confirm this isn't an accidental drift."
  - "Function Y at file:line was last touched in commit DEF456 by author Z to add behaviour W; this change drops behaviour W."

  Severity for history findings is almost always P2 or P3 unless the change directly conflicts with a recent fix (then P1). Use confidence aggressively here: most blame-derived intuitions are `medium` at best.

  Skip Surface C entirely on re-audit cycles (history doesn't change between iterations on the same task).

- **Merge — union by max severity, attach max confidence.** If two surfaces flag the same issue at different severities, take the stricter severity. If they assign different confidences to the same finding, take the higher confidence (more sources confirming = more confident, not less). Both surfaces finding the same issue at the same severity is expected; do not dedupe by dropping either — record which surfaces raised it.

### 4. Apply fixes — fix queue ordered by severity × confidence

Build the fix queue from the merged findings using this priority matrix:

| Severity \ Confidence | high                | medium                                | low                                                            |
|-----------------------|---------------------|---------------------------------------|----------------------------------------------------------------|
| **P0**                | Fix immediately     | Fix immediately                       | Verify in ≤2 min, then fix (or downgrade with note if disproven) |
| **P1**                | Fix this iteration  | Verify, then fix                      | Verify before classifying — may downgrade to P2/P3              |
| **P2**                | Fix if cheap (run § Fix-vs-file Q1–Q3 below) | Apply rubric                          | Default file or document; fix only if 1-line                    |
| **P3**                | Fix if 1-line, no test surface | Note in session summary               | Skip                                                           |

**Order of operations:**
1. All `P0` first (any confidence). Verify each fix materially addresses the finding — do not wave at it with a comment.
2. All `P1-high` and `P1-medium`.
3. All `P2-high` (these often outrank `P1-low` once you've verified the P1 was speculative).
4. Any `P1-low` that survived verification.
5. `P2-medium`/`P2-low` and `P3-high` per the fix-vs-file rubric (see runbook § "Fix-vs-file decision rubric").

**Anti-pattern:** treating every `P1` flagged by either surface as equally urgent. The whole point of the confidence dimension is to let `P2-high` jump ahead of `P1-low`. Confidence is a real input, not decoration — if you ignore it, you've burned the borrowed feature.

Commit the fixes as one follow-up commit. Message should reference the findings count broken down by severity AND confidence (e.g., `"audit fixes: 2× P1-high, 1× P2-high, 1× P1-medium (claude); 1× P1-low deferred (low confidence, see session summary)"`) and which surface raised each.

Note the new SHA as `$SHA_2`.

### 5. Re-audit — Codex if available, otherwise Claude

**The re-audit must target the cumulative task diff, not just the latest fix commit.** If $SHA_1 is the initial implementation and $SHA_2 is the fix commit, the re-audit covers `$BASE..$SHA_2` (where `$BASE` is the branch base / origin tip — typically `origin/main`). Auditing only `$SHA_1..$SHA_2` would let unchanged-but-buggy code from $SHA_1 disappear from the review surface and the loop could report clean even when first-pass findings were only partially fixed.

Per the repo's standing rule (save Claude credits on repeats), the re-audit pass prefers the Codex CLI if `tools/codex-audit.sh` is present:
- `tools/codex-audit.sh $SHA_2 $BASE` (both stock + steered; background). The wrapper checks HEAD == $SHA_2 and reviews `$BASE..$SHA_2`.
- Read the outputs and classify findings.

If Codex is not available, re-run the Claude audit agent against `$BASE..$SHA_2`. Skip Surface C (history) on re-audit cycles.

### 6. Loop control
- **Clean (no P0/P1/P2)** or **P3-only** → exit the loop. Move to § 7.
- **New P0/P1 surfaced** → go back to § 4 with a new commit.
- **Churning** (this iteration's findings overlap the previous iteration's by >50%, same file/line) → exit the loop with status `likely_churning`. Hand back to human with both audit trails in the summary.
- **Iteration cap: 3.** After three fix commits, exit regardless and hand back to human.
- **One-line-regression extension.** If iteration 3's re-audit returns exactly one finding AND that finding is a confirmed regression from iteration 3's own fix (see [runbook § Iteration budget](../../docs/runbooks/ship-with-audit.md)), iteration 4 is allowed. It must apply only that one-liner fix, and its re-audit must come back clean; otherwise exit with `regression_unresolvable`. Document the extension in the session summary's iteration log.

### 7. Push and summarize
- `git push` all accumulated commits (only if the user has authorized pushing — confirm before the first push if uncertain).
- Write a session summary at `docs/sessions/YYYY-MM-DD-<kebab-task>.md` covering the audit trail: which findings were raised by which surface, with severity AND confidence; which were fixed, which were deferred, and the trivial-vs-non-trivial triage decision from § 2.5.
- Write the per-task audit trail JSON at `docs/audit-trails/<kebab-task>.json` (see runbook § Hand-off contract for shape).
- **Comment posting (best-effort, never fails the loop).**
  - **Security-finding redaction (required before any public surface).** Per [SECURITY.md](../../SECURITY.md), suspected vulnerabilities must not be disclosed in public PRs, issues, screenshots, logs, **or tracked docs**. Scan the findings table for **any** finding regardless of severity (P0 through P3) that matches SECURITY.md's "What To Report" categories — secret leakage, policy/approval bypass, unauthorized capability execution, arbitrary external execution, direct service-bypassing writes, idempotency failures with external effects, cross-workspace data leakage, file writes escaping the workspace. SECURITY.md does not gate disclosure by severity. Redact every such finding from:
      - the public PR / issue comment body;
      - the committed session summary at `docs/sessions/<date>-<task>.md`;
      - any other tracked file that the loop writes.
    Replace each with: `Security-class finding redacted per SECURITY.md — see the maintainer's private channel.` The unredacted text stays only in the local-only audit trail at `docs/audit-trails/<task>.json` (gitignored) and in any private notes the maintainer keeps off-tree.
  - **GitHub PR:** check for an open PR on the current branch (`gh pr view --json number,url 2>/dev/null`). If one exists, post the redacted loop summary as a PR comment via `gh pr comment <PR#> --body-file -`. On failure (network error, permission denied), log a one-line warning in the session summary and continue. Do NOT block the push or the loop exit.
  - **GitHub Issue:** if `$ARGUMENTS` references a GitHub issue (e.g. `#42` or `OpenMAO#42`), attempt to post the redacted loop summary as a comment on that issue via `gh issue comment <number> --body-file -`. Same best-effort failure handling.
  - **Comment body shape:**
    ```
    ## ship-with-audit summary

    **Deliverable:** <one line from $ARGUMENTS>
    **Iterations:** <N> (exit reason: clean | p3_only | max_iterations | likely_churning | regression_unresolvable)
    **Triage:** trivial | non-trivial (rule that fired)
    **Codex augmentation:** available | unavailable

    ### Findings table
    | Iter | Surface | Severity | Confidence | File:line | Finding | Disposition |
    |------|---------|----------|------------|-----------|---------|-------------|
    | ...  | ...     | ...      | ...        | ...       | ...     | fixed in <SHA> / deferred / filed #NN |

    ### Commits
    - `<SHA_1>` — implement
    - `<SHA_2>` — audit fixes (iter 1)
    - ...

    Safe to merge as-is: yes | needs human direction call (reason)
    ```
- Return a one-paragraph message to the user:
  - What was delivered
  - How many iterations the loop ran (and the trivial/non-trivial triage)
  - What (if any) P3 / deferred items remain
  - Whether a PR or issue comment was posted (with link)
  - Whether the commit series is safe to merge as-is, or needs a human direction call

## Hard rules

- **Never skip the audit step.** The loop's entire value is that audits happen before hand-off, not after.
- **Never merge findings by intersection.** If only one surface flags something, it still counts. Union with max severity.
- **Never amend commits mid-loop.** Each iteration is its own commit so the audit trail is reconstructable.
- **Do not apply live-infra mutations as part of the loop.** The loop ships code. Migrations are written, not applied. Capability rows are seeded, not flipped active. Per the runbook's scope boundary.
- **Respect the iteration cap.** The loop is not meant to grind indefinitely; repeated findings on the same surface signal the task needs rescoping.
- **Never push without explicit authorization.** Per AGENTS.md and root-CLAUDE-equivalent rules: pushing is a shared-state action; confirm before the first push of a session.

## If something goes wrong

- `tools/codex-audit.sh` is missing → run Claude-only audit; note in the session summary. Filing the Codex wrapper adoption as follow-up is recommended.
- `codex` CLI is missing (wrapper exits 2) → treat as Codex unavailable, not as a retryable failure. Skip Surface B for the rest of this loop and continue with Claude-only audit. Do NOT retry — the next invocation will fail the same way. Note in the session summary so the user knows the dual-surface coverage was not exercised.
- Codex non-zero exit for any other reason (network, rate limit, timeout 124, stall 125, empty log 126, transport failure) → retry once with `AUDIT_TIMEOUT=900` prepended to the **exact** failed invocation (same SHA, same BASE_SHA if originally provided, same mode flags such as `--stock-only`). Dropping the BASE_SHA on retry would silently change the audited diff from `$BASE..$SHA` back to `parent..$SHA`, which can hide cumulative bugs. If still failing, hand back to human with the last known good log path.
- Agent subprocess fails mid-audit → rerun that single surface; preserve the logs from the other.
- Merge conflicts on fix commit → abort the loop and hand back to human; do not force-resolve.

## Related
- [docs/runbooks/ship-with-audit.md](../../docs/runbooks/ship-with-audit.md) — full pattern, scope boundaries, fix-vs-file rubric, hand-off contract.
- [AGENTS.md](../../AGENTS.md) — repo-wide agent rules.
- [SPEC.md](../../SPEC.md) — canonical product and architecture specification.
