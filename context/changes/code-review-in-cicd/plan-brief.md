# Code Review in CI/CD — Plan Brief

> Full plan: `context/changes/code-review-in-cicd/plan.md`
> Research: `context/changes/code-review-in-cicd/research.md`

## What & Why

Add an AI code-review **merge gate** for PRs to `main`, driven by the existing `packages/code-review` package. Every PR gets an automated review whose verdict blocks or allows merge, with findings posted as inline comments + a summary — but AI calls are cost-controlled so they don't run on every commit.

## Starting Point

CI today is one app-centric workflow (`ci.yml`: lint + build). The `code-review` package is a pure, local `diff → JSON` reviewer whose v0 deliberately shipped **no** CI/GitHub integration. This plan builds exactly that omitted layer — without touching `ci.yml` or the package's source/CLI contract.

## Desired End State

A PR to `main` is auto-reviewed once on open; a required `code-review/gate` commit status allows/blocks merge; `cr:pass`/`cr:fail` labels mirror it; findings land as diff-validated inline comments + a sticky summary. Pushing a commit makes the gate stale (blocked) until a maintainer adds `cr:revalidate`, which re-runs the review on the new commit — refreshing status, labels, and comments with no duplicates.

## Key Decisions Made

| Decision                 | Choice                                                                   | Why (1 sentence)                                                      | Source   |
| ------------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------- | -------- |
| First-run trigger        | Auto on open/reopen; re-run only on `cr:revalidate`                      | Reviews every PR once but caps cost per commit.                       | Frame    |
| Summary placement        | Sticky bot comment (upsert)                                              | Safe + idempotent; never clobbers the author's PR body.               | Frame    |
| CI credential            | `ANTHROPIC_API_KEY` (pay-as-you-go secret)                               | Shared, rotatable, not tied to a person's subscription.               | Frame    |
| Gate rule                | `request_changes`→block; `approve`/`comment`→pass                        | Treats advisory `comment` as mergeable.                               | Frame    |
| Merge gate mechanism     | Commit status `code-review/gate` (required), labels mirror it            | Status is the real gate; a label anyone can edit can't be.            | Research |
| Review event             | `COMMENT` (not bot `REQUEST_CHANGES`)                                    | Keeps "advice" and "gate" independent; avoids dismissable bot blocks. | Research |
| Orchestration logic home | Unit-tested TS module under `.github/scripts/`; `github-script` does I/O | The 422-prone diff/partition logic gets tests; YAML stays thin.       | Plan     |
| Model + safety cap       | `claude-sonnet-4-6` + `timeout-minutes: 15`                              | Cheapest sane default; label-gating already controls cost.            | Plan     |
| Infra-failure policy     | Fail-closed (block, no verdict label, error sticky)                      | An outage can never sneak unreviewed code into `main`.                | Plan     |
| Large-diff posture       | Cap inline comments (~30 by severity); no diff cap                       | Bounds comment spam / 64KB body risk without losing review context.   | Plan     |

## Scope

**In scope:** new `.github/workflows/code-review.yml`; a testable `.github/scripts/code-review/` module (diff parse, finding partition, post-plan); label lifecycle; inline + sticky posting; the required commit-status gate; one-time secret/label/branch-protection setup.

**Out of scope:** changes to `ci.yml`, the prod deploy, or the package source/CLI; diff chunking/retries; a diff-size skip; fork-PR support; using labels or bot `REQUEST_CHANGES` as the gate.

## Architecture / Approach

Pure-transform / thin-I/O. Workflow computes the three-dot diff → pipes to `code-review --json` (capturing exit code, fail-closed) → a unit-tested module turns `(diff, review.json)` into `cr-output.json` (verdict→`{state,label}`, diff-validated inline `comments[]`, sticky body) → one `actions/github-script` step applies it (ensure/cycle labels, delete prior bot comments, post `COMMENT` review, upsert sticky, post `code-review/gate` status on the PR **head SHA**). The job always posts the gate status when it runs, so the required check is never permanently pending for a reviewed SHA.

## Phases at a Glance

| Phase                  | What it delivers                                                        | Key risk                                                                       |
| ---------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1. Testable module     | `.github/scripts/code-review/` pure logic + vitest                      | Getting diff-hunk→valid-line mapping exactly right (drives the 422 risk)       |
| 2. Workflow            | `code-review.yml`: triggers, gate logic, package run, github-script I/O | Untestable-in-isolation YAML; status SHA + fail-closed wiring                  |
| 3. Setup + live verify | Secret, labels, required check; end-to-end PR walkthrough               | GitHub platform behavior only observable on a real PR (422s, stale-SHA, dedup) |

**Prerequisites:** repo admin to add the `ANTHROPIC_API_KEY` secret and the `code-review/gate` required-check rule; an Anthropic API account.
**Estimated effort:** ~2–3 sessions across the 3 phases (Phase 1 fast/tested; Phase 3 is live iteration).

## Open Risks & Assumptions

- Inline-comment posting is **atomic** — one out-of-diff line 422s the whole review; mitigated by pre-validation, but context-line acceptance must be confirmed live (tighten to added-only if needed).
- The required-check name may need one workflow run before it's selectable in classic branch protection (rulesets avoid this).
- Very large diffs still cost more tokens (no chunking); only `timeout-minutes` bounds it.
- Fork PRs can't be reviewed (no secret) and will sit blocked — acceptable for an internal repo.

## Success Criteria (Summary)

- A failing review blocks merge (`code-review/gate=failure`, `cr:fail`); a passing one allows it (`success`, `cr:pass`).
- Findings appear inline at the right file:line, with overflow/line-less ones in a single sticky summary; no duplicates after a revalidate.
- A new commit re-blocks until `cr:revalidate`; AI runs only on open + explicit revalidation.
