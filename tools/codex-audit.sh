#!/usr/bin/env bash
# BEGIN USAGE
#
# codex-audit.sh — thin wrapper around `codex review` + `codex exec` that
# drives the two-pass audit loop codified in docs/runbooks/ship-with-audit.md.
#
# Provenance: this script is an adaptation by the OpenMAO maintainer of
# a tool the same maintainer built in a sibling project they also own.
# The structure and termination-classifier design carry over as durable
# choices; the OpenMAO version updates paths, focus-area prompts, and
# the plugin bypass list for codex-cli 0.130.0. Inline comments retain
# `COG-NN` incident references from the sibling project as historical
# context for non-obvious code choices — readers do not need to know
# what those incidents were; the abstract lessons stand on their own.
#
# Two passes per invocation:
#   1) Stock rubric  — `codex review --base <PREV_SHA>`
#      Fast, default-rubric pass. Catches schema/runtime drift, type
#      mismatches, dependency issues, etc.
#   2) Steered audit — `codex exec '<deep audit prompt>'`
#      Slower, more expensive pass. Catches doc drift, canonical-state
#      contradictions, policy-gate gaps, missing-fallback branches,
#      pre-prod gate bypasses. Commit scope lives INSIDE the prompt
#      because `codex exec` does not accept `--base`/`--commit` flags.
#
# The `[PROMPT]` position on `codex review` is rejected by the CLI in
# combination with any target-selection flag (`--base`, `--commit`,
# `--uncommitted` — observed empirically on @openai/codex@0.122.0).
# That's why the steered pass shells out to `codex exec` instead of
# `codex review <rubric-prompt>`.
#
# Usage:
#   tools/codex-audit.sh <SHA>                 # audit <SHA> vs its parent
#   tools/codex-audit.sh <SHA> <BASE_SHA>      # audit <SHA> vs an explicit base
#   tools/codex-audit.sh --uncommitted         # audit working-tree diff
#   tools/codex-audit.sh --stock-only <SHA>    # skip the steered pass
#   tools/codex-audit.sh --steered-only <SHA>  # skip the stock pass
#
# Output files default to a private per-run directory created via
# `mktemp -d "${TMPDIR:-/tmp}/codex-audit-XXXXXXXX"` with mode 700 (umask
# 077 set at script start). The exact directory is printed at the start
# of every run and embedded in the summary JSON. Override the parent
# directory with CODEX_AUDIT_LOG_DIR (the override is not permission-
# hardened; the caller is responsible for choosing a safe location):
#   $LOG_DIR/codex-audit-<sha>-stock.txt      — stock rubric output (tee'd)
#   $LOG_DIR/codex-audit-<sha>-steered.txt    — steered pass output (tee'd)
#   $LOG_DIR/codex-audit-<sha>-summary.json   — merged findings envelope
#
# The summary JSON shape:
#   {
#     "sha": "<SHA>",
#     "base_sha": "<BASE_SHA>",
#     "stock_log": "/tmp/codex-audit-<sha>-stock.txt",
#     "steered_log": "/tmp/codex-audit-<sha>-steered.txt",
#     "stock_exit": <int>,                — codex exit code for stock pass
#     "steered_exit": <int>,              — codex exit code for steered pass
#     "stock_termination": "<reason>",    — clean | timed_out | nonzero_exit
#                                           | empty_log | no_terminal_marker
#     "steered_termination": "<reason>",  — same vocabulary as stock_termination
#     "stock_verdict_tail": "...",        — last 20 non-empty lines of stock log
#     "steered_verdict_tail": "...",      — last 20 non-empty lines of steered log
#     "steered_verdict_marker": "..."     — explicit "VERDICT: <CLEAN|FINDINGS n=N>"
#                                           or "MISSING" if not found in tail
#   }
#
# Severity classification (P0/P1/P2/P3) is left to the calling Claude
# session — this wrapper just produces the raw audit outputs.
# docs/runbooks/ship-with-audit.md documents the rubric.
#
# Termination detection (COG-106 retrofit):
# A pass terminates as one of:
#   * clean              — codex exited 0 AND log has a recognised terminal
#                          marker (a "VERDICT:" line for steered, OR a
#                          finding/closing-prose line for stock).
#   * timed_out          — codex exited 124 (GNU timeout) or 142 (SIGALRM
#                          via perl). The pass was killed by AUDIT_TIMEOUT.
#   * nonzero_exit       — codex exited non-zero for any other reason.
#   * empty_log          — log file is empty / unreadable / under 200 bytes.
#                          Almost always means codex died before writing.
#   * no_terminal_marker — codex exited 0 and the log has content, but no
#                          recognised closing marker. This is the stall
#                          pattern: codex finished a tool call but never
#                          returned to text-generation mode, so the log
#                          ends mid-context-gather with no review.
#                          Looks "successful" by exit code alone but the
#                          calling agent has no usable findings to act on.
#
# Exit codes:
#   0 — both passes terminated as "clean"
#   1 — invalid args
#   2 — `codex` binary missing
#   3 — git-resolution failed (unknown SHA, empty repo, etc.)
#   124 — at least one pass timed out
#   125 — at least one pass had no_terminal_marker (silent stall)
#   126 — at least one pass had empty_log
#   >3 (other) — codex subprocess nonzero (network / rate limit / auth)
#
# A non-zero exit always prints a stderr banner naming the failed pass(es)
# and pointing at the log files, so the caller does not have to scrape the
# JSON. The ship-with-audit loop's "retry once with AUDIT_TIMEOUT=900"
# fallback handles 124 and 125; other non-zero exits hand back to the
# operator per runbook "Failure modes" section.
#
# Hard timeout: 10 minutes per pass (AUDIT_TIMEOUT env override; unit is s).
#
# User-config bypass (post-COG-106, 2026-05-13):
# Both passes run with user-config plugins/MCP servers disabled because
# their initialization is the empirical root cause of stalls seen under
# parallel sub-agent dispatch. `codex exec` uses --ignore-user-config with
# `model` + `model_reasoning_effort` re-pinned via -c so the audit doesn't
# silently downgrade when the Codex default changes. `codex review`
# (which does not accept --ignore-user-config) gets per-plugin
# `-c plugins."NAME".enabled=false` lines + a single `-c mcp_servers={}`
# whole-section wipe (the per-MCP-server `enabled=false` form is REJECTED
# by codex 0.130.0 with "invalid transport"). Both passes also re-pin
# `model` + `model_reasoning_effort` so stock and steered run on the same
# model regardless of user-config drift. Set CODEX_AUDIT_BYPASS_USER_CONFIG=0
# (or false/no/off, case-insensitive) to turn the bypass off — e.g. to
# debug a regression in plugin init. Override the pinned model/effort
# via CODEX_AUDIT_MODEL / CODEX_AUDIT_REASONING_EFFORT env vars.
# Both passes also redirect stdin from /dev/null so sub-agent / background
# contexts that don't have an attached terminal don't surprise codex.
# END USAGE

set -euo pipefail

# Default umask so any log file or temp directory we create is owner-only
# (mode 600 / 700). Audit output can contain diff content, finding text, and
# in worst case credential fragments; the world-readable default on /tmp would
# expose all of that to any local user. Override is intentional and rare.
umask 077

readonly SCRIPT_NAME="$(basename "$0")"
readonly AUDIT_TIMEOUT="${AUDIT_TIMEOUT:-600}"

# Exit code constants (see header doc for the full table).
readonly EXIT_TIMEOUT=124           # at least one pass timed out
readonly EXIT_STALL=125             # at least one pass had no_terminal_marker
readonly EXIT_EMPTY_LOG=126         # at least one pass had empty_log
readonly EMPTY_LOG_BYTE_THRESHOLD=200

# Termination-classification vocabulary used by classify_termination() and
# emitted into the summary JSON. The calling agent's failure-mode parser
# must understand these strings; do not rename without also updating
# docs/runbooks/ship-with-audit.md "Failure modes" section.
readonly TERM_CLEAN="clean"
readonly TERM_TIMEOUT="timed_out"
readonly TERM_NONZERO="nonzero_exit"
readonly TERM_EMPTY="empty_log"
readonly TERM_NO_MARKER="no_terminal_marker"

err() { echo "$SCRIPT_NAME: $*" >&2; }
die() { err "$*"; exit "${2:-1}"; }

usage() {
  # Print everything between `# BEGIN USAGE` and `# END USAGE` sentinels
  # in this script's own header. Robust against header edits — line
  # numbers are not baked into the sed range.
  awk '/^# BEGIN USAGE$/{f=1; next} /^# END USAGE$/{f=0} f' "$0"
  exit "${1:-0}"
}

# Portable timeout wrapper. GNU coreutils ships `timeout`; macOS without
# brew coreutils has neither `timeout` nor `gtimeout`. Prefer the real
# timeout binary when available; otherwise fall back to the perl alarm
# idiom which is available on both macOS base and Linux. If even perl is
# missing we execute the command unwrapped and rely on codex CLI's own
# internal timeouts.
TIMEOUT_CMD=""
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_CMD="timeout"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_CMD="gtimeout"
elif command -v perl >/dev/null 2>&1; then
  TIMEOUT_CMD="perl_alarm"
fi

run_with_timeout() {
  local secs="$1"; shift
  case "$TIMEOUT_CMD" in
    timeout|gtimeout) "$TIMEOUT_CMD" "${secs}s" "$@" ;;
    perl_alarm)       perl -e 'alarm shift; exec @ARGV' "$secs" "$@" ;;
    "")               err "no timeout binary available — running unwrapped (cap ${secs}s not enforced)"; "$@" ;;
  esac
}

# -----------------------------------------------------------------------------
# User-config bypass (post-COG-106 stall-cause fix, 2026-05-13)
# -----------------------------------------------------------------------------
# Audit invocations don't need user-config plugins/MCP servers, and their
# initialization at codex startup has been the empirical root cause of
# intermittent stalls under parallel sub-agent dispatch in the sibling
# project. We bypass them.
#
# codex exec accepts --ignore-user-config which skips plugin loading
# entirely (auth still uses CODEX_HOME). We restore BOTH `model` and
# `model_reasoning_effort` because --ignore-user-config drops every key
# from the user config, not just the plugins. The same pins are also
# passed to codex review (which can't use --ignore-user-config) so both
# passes use the same model regardless of what's in user config.
# Override via CODEX_AUDIT_MODEL / CODEX_AUDIT_REASONING_EFFORT env vars.
#
# codex review does NOT accept --ignore-user-config (CLI rejects it at the
# subcommand level), so for the stock pass we pass per-plugin disable flags
# AND wipe the entire mcp_servers section. The plugin list below must be
# kept in sync with the enabled plugins in ~/.codex/config.toml — re-sync
# if you add a new plugin. Snapshotted 2026-05-28 against codex-cli 0.130.0.
#
# Operators can disable the entire bypass for debugging by exporting
# CODEX_AUDIT_BYPASS_USER_CONFIG=0 — in that mode the wrapper invokes codex
# exactly as before this fix landed. The check below treats ONLY the
# literal strings "0", "false", "no", "off" (and their uppercase variants)
# as disable signals; any other value (including unset) leaves the bypass
# on, so e.g. `=true` does NOT silently disable it.

CODEX_AUDIT_BYPASS_USER_CONFIG="${CODEX_AUDIT_BYPASS_USER_CONFIG:-1}"
case "$CODEX_AUDIT_BYPASS_USER_CONFIG" in
  0|false|FALSE|False|no|NO|No|off|OFF|Off) _bypass_active=0 ;;
  *) _bypass_active=1 ;;
esac

_audit_model="${CODEX_AUDIT_MODEL:-gpt-5.5}"
_audit_effort="${CODEX_AUDIT_REASONING_EFFORT:-xhigh}"

declare -a CODEX_REVIEW_BYPASS_FLAGS=()
declare -a CODEX_EXEC_BYPASS_FLAGS=()
if [[ "$_bypass_active" == "1" ]]; then
  for _plugin in \
      'vercel@openai-curated' \
      'stripe@openai-curated' \
      'computer-use@openai-bundled' \
      'documents@openai-primary-runtime' \
      'spreadsheets@openai-primary-runtime' \
      'presentations@openai-primary-runtime' \
      'github@openai-curated' \
      'linear@openai-curated' \
      'browser@openai-bundled' \
      'chrome@openai-bundled'; do
    CODEX_REVIEW_BYPASS_FLAGS+=( -c "plugins.\"${_plugin}\".enabled=false" )
  done
  unset _plugin
  # Wiping the whole mcp_servers section with `-c mcp_servers={}` is what
  # the CLI accepts. The per-MCP-server `-c mcp_servers."NAME".enabled=false`
  # form is REJECTED by codex 0.130.0 with "invalid transport in
  # `mcp_servers.\"...\"`" because codex re-validates each mcp_servers
  # block as a whole after the -c override merges in, and the
  # transport-discriminator fields are not preserved through the merge.
  CODEX_REVIEW_BYPASS_FLAGS+=( -c 'mcp_servers={}' )
  CODEX_REVIEW_BYPASS_FLAGS+=(
    -c "model=\"${_audit_model}\""
    -c "model_reasoning_effort=\"${_audit_effort}\""
  )
  CODEX_EXEC_BYPASS_FLAGS=(
    --ignore-user-config
    -c "model=\"${_audit_model}\""
    -c "model_reasoning_effort=\"${_audit_effort}\""
  )
fi
unset _bypass_active _audit_model _audit_effort

# -----------------------------------------------------------------------------
# Argument parsing
# -----------------------------------------------------------------------------

MODE="both"                   # both | stock-only | steered-only | uncommitted
SHA=""
BASE_SHA=""
SHA_INPUT=""                  # preserved for error messages after `shift` drains $1
BASE_SHA_INPUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage 0 ;;
    --stock-only) MODE="stock-only"; shift ;;
    --steered-only) MODE="steered-only"; shift ;;
    --uncommitted) MODE="uncommitted"; shift ;;
    --) shift; break ;;
    -*) die "unknown flag: $1"; ;;
    *)
      if [[ -z "$SHA" ]]; then SHA="$1"; SHA_INPUT="$1"
      elif [[ -z "$BASE_SHA" ]]; then BASE_SHA="$1"; BASE_SHA_INPUT="$1"
      else die "too many positional args: $1"
      fi
      shift
      ;;
  esac
done

command -v codex >/dev/null 2>&1 || die "codex CLI not found in PATH — install via 'npm install -g @openai/codex'" 2

# Git's empty-tree SHA — used as the base when auditing the repo's very
# first commit (which has no parent). `git rev-parse 4b825dc642cb...` is
# always resolvable; `git rev-parse --short <first-commit>^` errors.
readonly GIT_EMPTY_TREE_SHA="4b825dc642cb6eb9a060e54bf8d69288fbee4904"

if [[ "$MODE" == "uncommitted" ]]; then
  # Reject silently-overridden positional args. Pre-fix the wrapper would
  # accept `codex-audit.sh --uncommitted abc123` and discard "abc123" without
  # warning. That looked like working SHA selection to the operator but
  # actually audited the working tree.
  if [[ -n "$SHA_INPUT" || -n "$BASE_SHA_INPUT" ]]; then
    die "--uncommitted does not accept positional SHA arguments (got: ${SHA_INPUT}${BASE_SHA_INPUT:+ ${BASE_SHA_INPUT}}). Drop the SHA(s) or remove --uncommitted." 1
  fi
  SHA="uncommitted"
  BASE_SHA="HEAD"
else
  [[ -n "$SHA" ]] || { err "missing <SHA>"; usage 1; }
  # Preserve SHA_INPUT for error messages — $1 has been `shift`ed away by now
  # and referencing it under `set -u` would crash before `die` could print.
  SHA="$(git rev-parse --short "$SHA" 2>/dev/null)" || die "cannot resolve <SHA> '$SHA_INPUT'" 3
  # Validate resolved SHA shape (defense-in-depth — git rev-parse already
  # rejects anything it doesn't understand, but an explicit hex/ref regex
  # pins the value used in /tmp output paths).
  [[ "$SHA" =~ ^[0-9a-f]{4,40}$ ]] || die "resolved SHA has unexpected shape: '$SHA'" 3
  if [[ -z "$BASE_SHA" ]]; then
    BASE_SHA="$(git rev-parse --short "${SHA}^" 2>/dev/null || true)"
    if [[ -z "$BASE_SHA" ]]; then
      # Root commit — no parent to diff against. Fall back to the empty-
      # tree SHA so `codex review --base <empty>` diffs the whole commit
      # against literally nothing.
      err "no parent commit for $SHA — using empty-tree SHA as base"
      BASE_SHA="$GIT_EMPTY_TREE_SHA"
    fi
  else
    BASE_SHA="$(git rev-parse --short "$BASE_SHA" 2>/dev/null)" || die "cannot resolve <BASE_SHA> '$BASE_SHA_INPUT'" 3
  fi
fi

# Log directory — defaults to a private per-run mktemp directory under
# $TMPDIR (or /tmp if TMPDIR is unset). Audit logs contain diff content,
# finding text, and in worst case credential fragments; world-readable
# /tmp paths exposed those to any local user under the old default. The
# new default creates a mode-700 directory per invocation, and the umask
# at script start ensures files within are mode 600.
#
# CODEX_AUDIT_LOG_DIR overrides the default. Use with care — the override
# is not permission-hardened by this wrapper, so the caller is responsible
# for choosing a safe location. The override exists primarily so future
# smoke harnesses can sandbox their outputs into a known per-run dir.
if [[ -n "${CODEX_AUDIT_LOG_DIR:-}" ]]; then
  LOG_DIR="$CODEX_AUDIT_LOG_DIR"
else
  LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/codex-audit-XXXXXXXX" 2>/dev/null)" || die "failed to create private log directory" 1
fi
STOCK_LOG="${LOG_DIR}/codex-audit-${SHA}-stock.txt"
STEERED_LOG="${LOG_DIR}/codex-audit-${SHA}-steered.txt"
SUMMARY_JSON="${LOG_DIR}/codex-audit-${SHA}-summary.json"

echo "codex-audit: mode=$MODE sha=$SHA base_sha=$BASE_SHA timeout=${AUDIT_TIMEOUT}s"
echo "  stock_log   = $STOCK_LOG"
echo "  steered_log = $STEERED_LOG"
echo "  summary     = $SUMMARY_JSON"
echo

# -----------------------------------------------------------------------------
# Pass 1: stock rubric (`codex review`)
# -----------------------------------------------------------------------------

run_stock() {
  : > "$STOCK_LOG"
  local codex_status=0
  local tee_status=0
  # Target selection rules for the stock pass:
  #   * --uncommitted mode: review working-tree diff.
  #   * explicit base provided: review base..SHA range. Codex CLI has no
  #     native "base..head" target — `--base` reviews base..HEAD, so if
  #     HEAD != SHA we'd audit the wrong changeset. Verify HEAD first.
  #   * implicit base (single-SHA call): prefer `--commit SHA` which
  #     isolates the review to that commit's diff regardless of HEAD.
  #
  # Pipeline exit handling: we check BOTH sides of `codex | tee`. A
  # successful codex with a failed tee (disk full, broken pipe, read-only
  # /tmp) still means the log is corrupt/missing.
  set -o pipefail
  if [[ "$MODE" == "uncommitted" ]]; then
    run_with_timeout "$AUDIT_TIMEOUT" codex review ${CODEX_REVIEW_BYPASS_FLAGS[@]:+"${CODEX_REVIEW_BYPASS_FLAGS[@]}"} --uncommitted </dev/null 2>&1 | tee "$STOCK_LOG"
    # Snapshot PIPESTATUS atomically — bash reassigns PIPESTATUS after
    # every simple command including assignments. Copy the whole array
    # first, then index off the copy.
    local -a _ps=( "${PIPESTATUS[@]}" )
    codex_status=${_ps[0]:-0}
    tee_status=${_ps[1]:-0}
  elif [[ -n "$BASE_SHA_INPUT" ]]; then
    local head_short
    head_short="$(git rev-parse --short HEAD 2>/dev/null || echo "")"
    if [[ "$head_short" != "$SHA" ]]; then
      die "codex review --base audits <base>..HEAD, but HEAD ($head_short) != requested SHA ($SHA). Either check out $SHA first, drop the explicit <BASE_SHA> arg (single-SHA mode uses --commit), or --uncommitted the working tree." 3
    fi
    run_with_timeout "$AUDIT_TIMEOUT" codex review ${CODEX_REVIEW_BYPASS_FLAGS[@]:+"${CODEX_REVIEW_BYPASS_FLAGS[@]}"} --base "$BASE_SHA" </dev/null 2>&1 | tee "$STOCK_LOG"
    local -a _ps=( "${PIPESTATUS[@]}" )
    codex_status=${_ps[0]:-0}
    tee_status=${_ps[1]:-0}
  else
    run_with_timeout "$AUDIT_TIMEOUT" codex review ${CODEX_REVIEW_BYPASS_FLAGS[@]:+"${CODEX_REVIEW_BYPASS_FLAGS[@]}"} --commit "$SHA" </dev/null 2>&1 | tee "$STOCK_LOG"
    local -a _ps=( "${PIPESTATUS[@]}" )
    codex_status=${_ps[0]:-0}
    tee_status=${_ps[1]:-0}
  fi
  [[ $codex_status -eq 0 ]] || err "stock pass: codex exited $codex_status (output preserved at $STOCK_LOG)"
  [[ $tee_status -eq 0 ]]   || err "stock pass: tee to $STOCK_LOG exited $tee_status — log may be truncated or missing"
  [[ $codex_status -ne 0 ]] && return $codex_status
  return $tee_status
}

# -----------------------------------------------------------------------------
# Pass 2: steered audit (`codex exec '<deep audit prompt>'`)
# -----------------------------------------------------------------------------

build_steered_prompt() {
  local target_clause
  if [[ "$MODE" == "uncommitted" ]]; then
    target_clause="Audit the uncommitted working-tree diff (staged + unstaged + untracked)."
  else
    target_clause="Audit the diff between ${BASE_SHA} and ${SHA}."
  fi
  # Focus areas adapted for OpenMAO — see docs/runbooks/ship-with-audit.md
  # § "Codex augmentation" for the prompt template and its rationale.
  cat <<PROMPT
${target_clause}

This is the OpenMAO repository — a native runtime for AI organizations with governance-first, audit-first invariants defined in SPEC.md. Perform a deep audit with P0/P1/P2/P3 severity classification and file:line references. Focus on:
  (1) security or governance gaps — policy bypass paths, missing approval gates, credential leakage, agent-visible secrets (SPEC §27.1), direct DB writes that skip the service layer, capability calls executing before policy evaluation;
  (2) contract drift — Pydantic models or canonical schemas diverging from SPEC §8.3, capability schemas not matching the registry, event/trace contracts breaking the §20 invariants, source-of-truth declarations referencing non-v0 backends (SPEC §16.2);
  (3) memory invariants — collective memory writes outside promotion (SPEC §17-18), provenance fields missing, scope leakage between agents, free-form chat used at load-bearing seams (§5 invariant 4);
  (4) capability layer — approval-required capabilities running before suspension (SPEC §16), providers seeing unredacted credentials (§27.1), missing idempotency keys on writes, persisted CapabilityCall not preceding governance evaluation;
  (5) v0 scope boundary — code paths requiring external credentials in the default demo, real LLM provider calls bypassing ModelRouterService (§16.1), foreign framework dependencies (LangGraph, CrewAI, etc.) violating §0 rule 6;
  (6) doc drift — README, ADR, SPEC section, or docs/* file referring to removed/renamed/deprecated state; type names that diverge from SPEC §8.3; references to deferred features as if they were shipped;
  (7) test/fixture coverage gaps on surfaces a schema or invariant claims to constrain — every state-changing action must emit an event (§5 invariant 8), every graph/run node must emit a trace, tests must prove these;
  (8) anything an operator could run that would reach production in a broken state — auto-apply paths that skip human review, non-deterministic mock providers, env-var defaults that escape v0 constraints, push paths that mutate live state.

For EVERY finding, emit it in this shape (one finding per item):
  - severity: P0 | P1 | P2 | P3
    confidence: high | medium | low
    file:line
    finding: <one sentence>

Confidence rubric (this is consumed downstream by the ship-with-audit
fix-queue ordering — it is not decoration):
  - high   = clear evidence; you can point to the line that breaks; no
             plausible reading of the code saves it.
  - medium = strong suspicion; rests on an assumption about runtime
             behaviour, caller patterns, or unwritten invariants. The
             calling agent will verify before acting.
  - low    = pattern smell or speculation; flag it, but assume the
             calling agent will need to verify before fixing or even
             before accepting the severity classification.

Be honest with confidence. A confident wrong finding is more expensive
than a hedged right one — the loop will downrank low-confidence findings
behind higher-confidence ones at lower severity, which is the correct
ordering when you genuinely are unsure.

End the response with an explicit marker line of the form:
  VERDICT: CLEAN        (if no P0/P1/P2 were raised)
  VERDICT: FINDINGS n=N (otherwise, where N is the P0+P1+P2 count)

The "VERDICT:" token must be the final line of the response so the
calling wrapper can parse it robustly even when the CLI appends
trailing telemetry or banners.
PROMPT
}

run_steered() {
  : > "$STEERED_LOG"
  local prompt
  prompt="$(build_steered_prompt)"
  local codex_status=0
  local tee_status=0
  set -o pipefail
  run_with_timeout "$AUDIT_TIMEOUT" codex exec ${CODEX_EXEC_BYPASS_FLAGS[@]:+"${CODEX_EXEC_BYPASS_FLAGS[@]}"} "$prompt" </dev/null 2>&1 | tee "$STEERED_LOG"
  local -a _ps=( "${PIPESTATUS[@]}" )
  codex_status=${_ps[0]:-0}
  tee_status=${_ps[1]:-0}
  [[ $codex_status -eq 0 ]] || err "steered pass: codex exited $codex_status (output preserved at $STEERED_LOG)"
  [[ $tee_status -eq 0 ]]   || err "steered pass: tee to $STEERED_LOG exited $tee_status — log may be truncated or missing"
  [[ $codex_status -ne 0 ]] && return $codex_status
  return $tee_status
}

# -----------------------------------------------------------------------------
# Dispatch
# -----------------------------------------------------------------------------

stock_status=0
steered_status=0

case "$MODE" in
  stock-only)
    run_stock || stock_status=$?
    : > "$STEERED_LOG"
    ;;
  steered-only)
    : > "$STOCK_LOG"
    run_steered || steered_status=$?
    ;;
  both|uncommitted)
    run_stock || stock_status=$?
    echo
    echo "---"
    echo
    run_steered || steered_status=$?
    ;;
esac

# -----------------------------------------------------------------------------
# Summary JSON
# -----------------------------------------------------------------------------

json_encode_string() {
  # Reads stdin, emits a valid JSON string value (including surrounding
  # quotes). Works for any byte sequence including control chars.
  if command -v jq >/dev/null 2>&1; then
    jq -Rs .
  else
    # awk fallback: escape backslash + quote + CR + tab, then strip remaining
    # control characters (POSIX [[:cntrl:]]) so the emitted string is valid
    # per RFC 8259 §7 even when codex output contains ANSI escapes, NUL bytes,
    # or other control codes. Stripping rather than \uXXXX-escaping is a
    # deliberate simplification: audit logs do not need round-trippable ANSI
    # colors; they need valid JSON that downstream `jq` / `json.loads()`
    # accept.
    awk 'BEGIN{printf "\""}
         {
           gsub(/\\/, "\\\\")
           gsub(/"/, "\\\"")
           gsub(/\r/, "\\r")
           gsub(/\t/, "\\t")
           gsub(/[[:cntrl:]]/, "")
           printf "%s\\n", $0
         }
         END{printf "\""}'
  fi
}

extract_verdict_tail() {
  local log_path="$1"
  tail -n 40 "$log_path" 2>/dev/null | awk 'NF' | tail -n 20
}

extract_verdict_marker() {
  local log_path="$1"
  local marker
  marker="$(tail -n 200 "$log_path" 2>/dev/null | grep -E '^VERDICT:' | tail -n 1 || true)"
  [[ -n "$marker" ]] && printf '%s' "$marker" || printf 'MISSING'
}

# classify_termination — returns one of the TERM_* constants. The caller's
# retry / failure-mode logic switches on this string, so do not rename
# without updating docs/runbooks/ship-with-audit.md.
classify_termination() {
  local label="$1"
  local exit_code="$2"
  local log_path="$3"

  # 1. Timeout — propagated by `timeout`/`gtimeout` (124) or by the perl
  #    alarm fallback (SIGALRM = signal 14, exit 128+14 = 142).
  if [[ "$exit_code" -eq 124 || "$exit_code" -eq 142 ]]; then
    printf '%s' "$TERM_TIMEOUT"
    return
  fi

  # 2. Empty / tiny log — codex died or never wrote useful output.
  local log_size=0
  if [[ -r "$log_path" ]]; then
    log_size=$(wc -c <"$log_path" 2>/dev/null | tr -d ' ' || echo 0)
  fi
  if [[ "$log_size" -lt "$EMPTY_LOG_BYTE_THRESHOLD" ]]; then
    printf '%s' "$TERM_EMPTY"
    return
  fi

  # 3. Non-zero exit for any reason other than timeout.
  if [[ "$exit_code" -ne 0 ]]; then
    printf '%s' "$TERM_NONZERO"
    return
  fi

  # 4 + 5. Exit 0 + non-empty log — check for a terminal marker.
  local last_line
  last_line="$(tail -n 200 "$log_path" 2>/dev/null | awk 'NF' | tail -n 1 || true)"

  if [[ "$label" == "steered" ]]; then
    if grep -qE '^VERDICT:' <(tail -n 50 "$log_path" 2>/dev/null); then
      printf '%s' "$TERM_CLEAN"
    else
      printf '%s' "$TERM_NO_MARKER"
    fi
    return
  fi

  # Stock pass: detect two stall signatures (i) unclosed exec block, and
  # (ii) completed-tool-output with no review synthesis. See sibling
  # project's COG-95/COG-98/COG-106 incident notes for the empirical
  # observations behind these heuristics.
  local exec_count=0 done_count=0
  if [[ -r "$log_path" ]]; then
    exec_count=$(grep -cE '^exec$' "$log_path" 2>/dev/null || true)
    done_count=$(grep -cE '^ (succeeded|exited)' "$log_path" 2>/dev/null || true)
  fi
  exec_count=${exec_count:-0}
  done_count=${done_count:-0}

  # Signature (i): unclosed exec block.
  if [[ "$exec_count" -gt "$done_count" ]]; then
    printf '%s' "$TERM_NO_MARKER"
    return
  fi

  # Signature (ii): completed-tool-output, no review synthesis. Constrain
  # both checks to the LAST 200 lines so codex's tool-output (which can
  # contain marker-looking text by accident) cannot game the heuristic.
  local synthesis_window
  synthesis_window="$(tail -n 200 "$log_path" 2>/dev/null || true)"

  # (a) `^codex$` synthesis prefix in the tail — codex's marker for
  #     "model is writing prose now, not running a tool."
  if ! grep -qaE '^codex$' <<<"$synthesis_window"; then
    printf '%s' "$TERM_NO_MARKER"
    return
  fi

  # (b) Review-like marker (case-insensitive) in the tail.
  if ! grep -qaiE '\[P[0-3]\]|Review comment|no actionable|no findings|found no|no issues|^VERDICT:|did not (identif|find)|does not (introduce|change|add)|appears consistent|behavior-neutral|remain unchanged|tests passed' <<<"$synthesis_window"; then
    printf '%s' "$TERM_NO_MARKER"
    return
  fi

  printf '%s' "$TERM_CLEAN"
}

stock_termination="$(classify_termination "stock" "$stock_status" "$STOCK_LOG")"
steered_termination="$(classify_termination "steered" "$steered_status" "$STEERED_LOG")"

case "$MODE" in
  stock-only)   steered_termination="not_run" ;;
  steered-only) stock_termination="not_run" ;;
esac

stock_tail_json="$(extract_verdict_tail "$STOCK_LOG" | json_encode_string)"
steered_tail_json="$(extract_verdict_tail "$STEERED_LOG" | json_encode_string)"
steered_verdict_marker="$(extract_verdict_marker "$STEERED_LOG")"

cat >"$SUMMARY_JSON" <<JSON
{
  "sha": "$SHA",
  "base_sha": "$BASE_SHA",
  "mode": "$MODE",
  "stock_log": "$STOCK_LOG",
  "steered_log": "$STEERED_LOG",
  "stock_exit": $stock_status,
  "steered_exit": $steered_status,
  "stock_termination": "$stock_termination",
  "steered_termination": "$steered_termination",
  "audit_timeout_seconds": $AUDIT_TIMEOUT,
  "steered_verdict_marker": $(printf '%s' "$steered_verdict_marker" | json_encode_string),
  "stock_verdict_tail": $stock_tail_json,
  "steered_verdict_tail": $steered_tail_json
}
JSON

# -----------------------------------------------------------------------------
# Final exit-code mapping (COG-106): elevate stalls + timeouts above the
# raw codex exit so the calling agent's retry / fallback path triggers
# even when codex returned 0 with an unusable log.
# -----------------------------------------------------------------------------

final_exit=0
abnormal_passes=()
saw_timeout=0
saw_stall=0
saw_empty=0
saw_nonzero=0
nonzero_exit_code=0

for pass_state in "stock=$stock_termination" "steered=$steered_termination"; do
  pass_label="${pass_state%%=*}"
  pass_term="${pass_state#*=}"
  case "$pass_term" in
    "$TERM_CLEAN"|not_run) ;;
    "$TERM_TIMEOUT")
      abnormal_passes+=("$pass_label=$TERM_TIMEOUT")
      saw_timeout=1
      ;;
    "$TERM_NO_MARKER")
      abnormal_passes+=("$pass_label=$TERM_NO_MARKER")
      saw_stall=1
      ;;
    "$TERM_EMPTY")
      abnormal_passes+=("$pass_label=$TERM_EMPTY")
      saw_empty=1
      ;;
    "$TERM_NONZERO")
      abnormal_passes+=("$pass_label=$TERM_NONZERO")
      saw_nonzero=1
      if [[ "$nonzero_exit_code" -eq 0 ]]; then
        if [[ "$pass_label" == "stock" ]]; then
          nonzero_exit_code=$stock_status
        else
          nonzero_exit_code=$steered_status
        fi
      fi
      ;;
  esac
done

if [[ "$saw_timeout" -eq 1 ]]; then
  final_exit=$EXIT_TIMEOUT
elif [[ "$saw_stall" -eq 1 ]]; then
  final_exit=$EXIT_STALL
elif [[ "$saw_empty" -eq 1 ]]; then
  final_exit=$EXIT_EMPTY_LOG
elif [[ "$saw_nonzero" -eq 1 ]]; then
  final_exit=$nonzero_exit_code
fi

echo
echo "codex-audit: complete."
echo "  stock:   exit=$stock_status   termination=$stock_termination"
echo "  steered: exit=$steered_status termination=$steered_termination"
echo "Summary: $SUMMARY_JSON"

if [[ ${#abnormal_passes[@]} -gt 0 ]]; then
  echo >&2
  echo "============================================================" >&2
  echo "codex-audit: ABNORMAL TERMINATION DETECTED" >&2
  echo "============================================================" >&2
  for entry in "${abnormal_passes[@]}"; do
    label="${entry%%=*}"
    term="${entry#*=}"
    case "$term" in
      "$TERM_TIMEOUT")
        echo "  $label: TIMED OUT after ${AUDIT_TIMEOUT}s" >&2
        echo "    → retry once with AUDIT_TIMEOUT=$((AUDIT_TIMEOUT * 3 / 2)) per runbook" >&2
        ;;
      "$TERM_NO_MARKER")
        echo "  $label: STALLED (codex exit=0 but log has no terminal marker)" >&2
        echo "    → stall pattern: codex finished a tool call but never returned" >&2
        echo "      to text-generation mode; log ends mid-context-gather with" >&2
        echo "      no actionable review. Substitute Claude self-audit per the" >&2
        echo "      runbook's failure-modes section." >&2
        ;;
      "$TERM_EMPTY")
        echo "  $label: EMPTY LOG (codex died before writing useful output)" >&2
        echo "    → likely transport/auth failure. Check ~/.codex/config.toml" >&2
        echo "      for newly-broken MCP servers." >&2
        ;;
      "$TERM_NONZERO")
        local_exit=$stock_status; [[ "$label" == "steered" ]] && local_exit=$steered_status
        echo "  $label: NON-ZERO EXIT ($local_exit)" >&2
        echo "    → check log tail for codex CLI error message" >&2
        ;;
    esac
    case "$label" in
      stock)   echo "    log: $STOCK_LOG" >&2 ;;
      steered) echo "    log: $STEERED_LOG" >&2 ;;
    esac
  done
  echo "============================================================" >&2
  echo "Summary JSON: $SUMMARY_JSON" >&2
  echo "Wrapper exit code: $final_exit" >&2
  echo "============================================================" >&2
fi

exit $final_exit
