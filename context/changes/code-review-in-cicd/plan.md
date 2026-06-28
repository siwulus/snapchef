# Code Review in CI/CD Implementation Plan

## Overview

Add an AI code-review **merge gate** for PRs to `main`, driven by the existing `packages/code-review` package (git diff on stdin → validated `Review` JSON). A new, separate workflow `.github/workflows/code-review.yml` runs the reviewer, reflects the verdict in a **required commit status** (`code-review/gate`) that gates merge, mirrors it in `cr:pass` / `cr:fail` labels, posts findings as **diff-validated inline review comments** plus a **sticky summary comment**, and is **cost-controlled**: it runs automatically once on PR open/reopen and thereafter only when a `cr:revalidate` label is added. The 422-prone diff/partition logic lives in a unit-tested TS module; `actions/github-script` does only GitHub I/O.

## Current State Analysis

- **Existing CI** is a single workflow `.github/workflows/ci.yml`: `checkout → jdx/mise-action → pnpm install --frozen-lockfile → astro sync → lint → build`, on `push` and `pull_request` to `main`. It is app-centric and untouched by this change.
- **The package** (`packages/code-review`) is a pure, stateless reviewer: stdin diff → `--json` emits `{ summary?, findings: [{ severity, file, line?, title, detail, suggestion? }], verdict }` where `verdict ∈ {approve, comment, request_changes}` and `severity ∈ {critical, major, minor, nit}`. It exits **`0` on every successful review regardless of verdict** (`packages/code-review/src/cli.ts:89`); exit `1` = no diff / missing credential / crashed run; exit `2` = bad args. It does **not** run git, makes a **live billable** Anthropic call (`maxTurns: 3`, no built-in timeout), default model `claude-sonnet-4-6`, reads `ANTHROPIC_API_KEY` from the inherited env, runs via `tsx` (no build step), and is independent of the Astro app. Its v0 **deliberately excluded** all CI/GitHub/PR-posting concerns (`context/changes/package-code-review/plan.md:44-51`).
- **Toolchain:** Node 24 / pnpm 11.6.0 (`mise.toml:5-8`); workspace members under `packages/*` (`pnpm-workspace.yaml:5-6`); `manage-package-manager-versions=false` (root `.npmrc`) so `jdx/mise-action` must run before any `pnpm`.
- **Research** (`context/changes/code-review-in-cicd/research.md`) resolved every platform unknown; its findings are the basis for this plan.

## Desired End State

On a PR to `main`:

1. The review runs once automatically on open/reopen.
2. A `code-review/gate` commit status is posted on the PR head SHA — `success` (verdict `approve`/`comment`) or `failure` (verdict `request_changes`, or any infra failure). Branch protection makes it **required**, so it allows/blocks merge.
3. Labels `cr:pass` / `cr:fail` mirror the status; `cr:revalidate` is consumed (removed) at run start.
4. Findings with a diff-valid `file:line` appear as inline `COMMENT` review comments (capped at ~30 by severity); everything else (line-less, out-of-diff, or overflow) rolls into a single **sticky** summary issue comment carrying the verdict + summary.
5. Pushing a new commit leaves the gate stale (no status on the new SHA) → merge blocked until a maintainer adds `cr:revalidate`, which re-runs the review on the new head SHA and refreshes status + labels + comments (no duplicates).

**Verification:** a live test PR exercises each step (Phase 3); the diff/partition logic is verified by unit tests (Phase 1).

### Key Discoveries:

- **Parse JSON `verdict`, never `$?`** — the CLI exits `0` even for `request_changes` (`packages/code-review/src/cli.ts:89`). Exit `1` is the infra-failure signal.
- **Inline-comment posting is atomic** — one comment whose `(path, line)` is not in a diff hunk fails the **entire** `POST /pulls/{n}/reviews` with HTTP 422 ("line must be part of the diff"). Every finding's line **must** be pre-validated against parsed hunks; non-valid ones route to the summary.
- **Required checks evaluate against the PR _head_ SHA** — attach the status to `github.event.pull_request.head.sha` (never `github.sha`, the ephemeral merge commit). A push without a workflow run leaves the new SHA statusless → blocked. This is the cost-control mechanism, free of extra logic.
- **The required-check deadlock** — a required check whose workflow never runs stays "Expected — waiting" forever; a _job_ skipped via `if:` reports _success_. So the gate must be an **explicit commit-status API call**, not a function of whether a job ran.
- **`GITHUB_TOKEN`-driven label/comment/status writes do not trigger new workflow runs** — removing `cr:revalidate` and adding `cr:pass`/`cr:fail` inside the run is loop-safe.
- **Commit Status API works with plain `GITHUB_TOKEN`** (Checks API is GitHub-App-only) — use it for the gate.
- **`pull_request` (not `_target`) withholds secrets from forks** — the safe trigger; add a fork guard so the job no-ops on forks.
- **Sticky summary = an _issue_ comment** (`/issues/{n}/comments`), distinct from review comments (`/pulls/{n}/comments`); find-by-HTML-marker then update-or-create. Bot identity is `github-actions[bot]` (the dedup filter).

## What We're NOT Doing

- **Not** modifying `ci.yml`, the Cloudflare Workers Builds production deploy, or the `packages/code-review` **source / CLI contract** (the orchestration module is new and separate; it does not import or alter the package).
- **No** diff chunking, retries/repair, or multi-file fan-out (package v0 excludes these; large-diff token cost is an accepted risk bounded only by `timeout-minutes`).
- **No** diff-size cap that skips review (we cap _inline comments_, not the diff).
- **No** support for **fork** PRs (secrets aren't exposed to fork runs; the job no-ops on forks).
- **Not** using a bot `REQUEST_CHANGES` review or labels as the merge gate — the commit status is the sole gate.
- **Not** automating the branch-protection rule, the `ANTHROPIC_API_KEY` secret, or (beyond a defensive ensure-step) label creation — these are one-time human/admin setup, documented in Phase 3.

## Implementation Approach

A pure-transform / thin-I/O split. The reviewer package emits `review.json`; a **pure, unit-tested TS module** (`.github/scripts/code-review/`) consumes `(pr.diff, review.json)` and produces a single `cr-output.json` "post plan" (verdict→`{state,label}`, validated inline `comments[]`, sticky body). A single `actions/github-script` step consumes that plan and performs **all** GitHub I/O (ensure labels, label lifecycle, delete prior bot review comments, post one `COMMENT` review, upsert the sticky comment, post the commit status). This keeps the risky logic testable and the YAML thin. The job **always** posts the gate status whenever it decides to run (fail-closed on infra failure), so the required check is never permanently pending for a reviewed SHA.

## Critical Implementation Details

- **Status SHA & ordering** — always post `code-review/gate` to `github.event.pull_request.head.sha`. The status post is the **last** step and runs on infra failure too (fail-closed). When the gate-decision step says "don't run" (unrelated label added), the job no-ops and does **not** clobber an existing status.
- **Empty-diff short-circuit** — if the three-dot diff is empty, skip the (billable) AI call: post `success` + `cr:pass` + a sticky "no reviewable changes". Distinguishes the package's exit-`1`-on-empty-stdin from a genuine infra failure.
- **Diff-line validity** — build `Map<path, Set<newLine>>` by walking each hunk (`@@ -a,b +c,d @@`, `newLine=c`): `+` and context (` `) lines add `newLine` then increment; `-` lines do not advance. Start by allowing added **and** context lines on `side: RIGHT`; if live 422s appear, tighten to added-only (Phase 3 note).
- **Concurrency** — `group: code-review-${{ github.event.pull_request.number }}`, `cancel-in-progress: true`. Safe because fail-closed + stale-per-SHA mean a cancelled mid-run never yields a false green.

## Phase 1: Testable orchestration module

### Overview

Build the pure logic that turns a diff + a `Review` into a GitHub "post plan", with vitest unit tests. No GitHub or network access. This is the highest-risk logic (the 422 mapping) and is the automated checkpoint before the workflow.

### Changes Required:

#### 1. Workspace member scaffold

**File**: `.github/scripts/code-review/package.json`, `tsconfig.json`, `vitest.config.ts`

**Intent**: Create a minimal, self-contained workspace member so the module resolves the repo's `tsx`/`vitest`/`typescript` toolchain and participates in `pnpm install --frozen-lockfile`. Mirrors `packages/code-review`'s setup (no build step; run via `tsx`).

**Contract**: New package (e.g. name `@snapchef/code-review-ci`, `private: true`, `type: "module"`) with scripts `test` (`vitest run`), `typecheck` (`tsc --noEmit --ignoreDeprecations 6.0`). Register its path in `pnpm-workspace.yaml` `packages:` (add `.github/scripts/code-review`). Commit the resulting `pnpm-lock.yaml` update so CI's `--frozen-lockfile` stays green.

#### 2. Diff parser

**File**: `.github/scripts/code-review/src/diff.ts`

**Intent**: Parse a unified diff into the set of comment-able new-file line numbers per path, so findings can be validated before posting.

**Contract**: `parseValidLines(diff: string): Map<string, Set<number>>`. Walks hunk headers `@@ -a,b +c,d @@`; for each hunk body line: `+`/context → record current new-file line, advance; `-` → skip without advancing. Handles multiple files, multiple hunks per file, added/deleted/renamed files, and `\ No newline at end of file` markers.

#### 3. Finding partition + post-plan builder

**File**: `.github/scripts/code-review/src/plan.ts`

**Intent**: Turn the validated `Review` + valid-line map into the exact GitHub post plan, applying the inline-comment cap and the verdict→gate mapping.

**Contract**:

- `verdictToGate(verdict): { state: "success" | "failure"; label: "cr:pass" | "cr:fail" }` — `request_changes`→`{failure, cr:fail}`; `approve`/`comment`→`{success, cr:pass}`.
- `buildPostPlan(review, validLines, opts): PostPlan` where `PostPlan = { state, label, reviewBody, comments: {path,line,side:"RIGHT",body}[], stickyBody }`. A finding is **inline** iff it has a `line` present in `validLines.get(file)`; inline comments are capped at `opts.maxInline` (default 30), ordered by severity (`critical→major→minor→nit`); all non-inline findings (line-less, out-of-diff, or beyond the cap) are rendered into `stickyBody`. `stickyBody` begins with the marker `<!-- code-review-bot -->`, then verdict + `summary` + the roll-up. Each inline `body` carries a per-comment marker (e.g. trailing `<!-- crb-inline -->`) for precise dedup.

#### 4. Module entrypoint

**File**: `.github/scripts/code-review/src/index.ts`

**Intent**: A thin CLI the workflow invokes: read `pr.diff` + `review.json` from argv paths, write `cr-output.json` (the `PostPlan`). Pure I/O over the pure functions.

**Contract**: `tsx src/index.ts <pr.diff> <review.json> <out.json>` → writes the `PostPlan` as JSON. No network, no GitHub.

#### 5. Unit tests + fixtures

**File**: `.github/scripts/code-review/src/diff.test.ts`, `plan.test.ts`, `src/__fixtures__/*`

**Intent**: Lock the risky behavior with fixtures.

**Contract**: `diff.test.ts` covers single/multi-hunk, multi-file, added/deleted/renamed files, context-line inclusion, no-newline marker. `plan.test.ts` covers: line in-diff → inline; line missing/out-of-diff → summary; >30 findings → top-30 by severity inline, rest in summary; each verdict → correct `{state,label}`; sticky body contains marker + verdict + summary + roll-up.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm --filter @snapchef/code-review-ci test`
- Type checking passes: `pnpm --filter @snapchef/code-review-ci typecheck`
- Root lint passes: `pnpm lint`
- Lockfile is consistent: `pnpm install --frozen-lockfile` succeeds
- Entrypoint produces a valid `PostPlan` from a sample diff+review: `tsx .github/scripts/code-review/src/index.ts <fixture.diff> <fixture-review.json> /tmp/out.json` exits 0 and writes parseable JSON

#### Manual Verification:

- Spot-check `cr-output.json` from a real local `git diff` + a real `code-review --json`: inline vs summary partition looks correct; no out-of-diff line slips into `comments[]`

**Implementation Note**: After completing this phase and all automated verification passes, pause for human confirmation before proceeding.

---

## Phase 2: The `code-review.yml` workflow

### Overview

Wire the reviewer + module into a label-gated workflow that posts the gate status, labels, inline review, and sticky comment. All GitHub I/O is one `actions/github-script` step consuming `cr-output.json`.

### Changes Required:

#### 1. Workflow triggers, concurrency, permissions

**File**: `.github/workflows/code-review.yml`

**Intent**: Run on the cost-controlled trigger set with least privilege and no overlapping runs.

**Contract**:

- `on: pull_request: { types: [opened, reopened, labeled], branches: [main] }`.
- `concurrency: { group: code-review-${{ github.event.pull_request.number }}, cancel-in-progress: true }`.
- `permissions: { contents: read, statuses: write, pull-requests: write, issues: write }`.
- Single job `review`, `runs-on: ubuntu-latest`, `timeout-minutes: 15`.

#### 2. Gate-decision + fork guard

**File**: `.github/workflows/code-review.yml` (first step)

**Intent**: Decide whether to actually run the review; no-op (and don't touch status) otherwise.

**Contract**: An `actions/github-script` step setting output `run` = true iff **not a fork** (`head.repo.full_name === '${{ github.repository }}'`) **and** (`action ∈ {opened, reopened}` **or** (`action == 'labeled'` **and** `label.name == 'cr:revalidate'`)). All subsequent steps are `if: steps.gate.outputs.run == 'true'`.

#### 3. Bootstrap + diff + run reviewer (fail-closed capture)

**File**: `.github/workflows/code-review.yml`

**Intent**: Produce `pr.diff` and `review.json`, capturing the package exit code so an infra failure is detectable.

**Contract**:

- `actions/checkout@v4` with `fetch-depth: 0`; `jdx/mise-action@v4`; `pnpm install --frozen-lockfile`.
- Compute diff: `git diff "origin/${{ github.base_ref }}...HEAD" > pr.diff` (three-dot/merge-base).
- **Empty-diff short-circuit**: if `pr.diff` is empty, set an output marking "empty" and skip the AI step.
- Run package capturing exit code (don't abort the job):
  ```bash
  set +e
  cat pr.diff | pnpm --filter code-review exec tsx src/cli.ts --json > review.json 2> review.err
  echo "code=$?" >> "$GITHUB_OUTPUT"
  ```
  with `env: { ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }} }`. A non-zero `code` (and non-empty diff) is the **infra-failure** path.

#### 4. Build the post plan

**File**: `.github/workflows/code-review.yml`

**Intent**: Run the Phase-1 module to produce `cr-output.json`.

**Contract**: `tsx .github/scripts/code-review/src/index.ts pr.diff review.json cr-output.json`, only on the success path (package exit 0, non-empty diff).

#### 5. GitHub I/O (single `github-script` step)

**File**: `.github/workflows/code-review.yml`

**Intent**: Apply the post plan to the PR, idempotently, and post the gate status. Always runs (`if: always()` within the run branch) so the status is posted even on the failure/empty paths.

**Contract**: One `actions/github-script@v7` step that:

1. **Ensure labels exist** — create `cr:pass`, `cr:fail`, `cr:revalidate` if missing (404-tolerant).
2. **Label lifecycle (run start)** — remove `cr:revalidate`, `cr:pass`, `cr:fail` (swallow 404 via try/catch).
3. Branch on path:
   - **Empty diff** → `state=success`, add `cr:pass`, upsert sticky "no reviewable changes".
   - **Infra failure** (package exit ≠ 0) → `state=failure`, **no** verdict label, upsert sticky error ("review didn't run — re-add `cr:revalidate`", include `review.err` tail). Fail-closed.
   - **Success** → read `cr-output.json`: delete prior `github-actions[bot]` inline review comments (`GET /pulls/{n}/comments` → filter by login/`crb-inline` marker → `DELETE /pulls/comments/{id}`); post one review `POST /pulls/{n}/reviews` with `commit_id = head.sha`, `event: "COMMENT"`, `body = reviewBody`, `comments`; upsert sticky (find issue comment containing `<!-- code-review-bot -->` → update or create); add `cr:pass` or `cr:fail` from the plan.
4. **Always** `repos.createCommitStatus({ sha: head.sha, context: "code-review/gate", state, target_url: run URL })`.

### Success Criteria:

#### Automated Verification:

- Workflow YAML parses / lints: `pnpm dlx actionlint .github/workflows/code-review.yml` (or `actionlint` if installed)
- Phase-1 module still green: `pnpm --filter @snapchef/code-review-ci test`
- Root lint + lockfile unaffected: `pnpm lint` and `pnpm install --frozen-lockfile`

#### Manual Verification:

- Read-through confirms: status attached to `head.sha`; `event: COMMENT`; fail-closed status on the infra path; no status write when `gate.outputs.run == false`; `ANTHROPIC_API_KEY` only on the package step.

**Implementation Note**: After automated verification passes, pause for human confirmation before Phase 3 (which needs the secret + a live PR).

---

## Phase 3: Repo setup + live verification

### Overview

Perform the one-time human setup and validate the full lifecycle on a real PR.

### Changes Required:

#### 1. Secret + labels (one-time)

**File**: GitHub repo settings (no repo file)

**Intent**: Provide the credential and the labels the workflow manages.

**Contract**: Add repo secret `ANTHROPIC_API_KEY` (pay-as-you-go). Ensure labels `cr:pass`, `cr:fail`, `cr:revalidate` exist (`gh label create …`, or rely on the workflow's defensive ensure-step). Documented in the change folder.

#### 2. Required status check (one-time, admin)

**File**: GitHub branch protection / ruleset for `main`

**Intent**: Make the gate actually block merges.

**Contract**: In a ruleset (preferred — lets you type the context name) or branch protection, require status check **`code-review/gate`**. If using classic branch protection and the name isn't listed, trigger the workflow once so the context is registered, then select it.

#### 3. Live end-to-end walkthrough

**File**: a throwaway test PR

**Intent**: Verify the whole contract against real GitHub behavior.

**Contract**: Open a PR with a deliberately flawed diff and confirm, in order: (a) review runs on open; (b) inline comments land on diff lines, line-less/out-of-diff findings appear in the sticky; (c) `cr:fail` + `code-review/gate=failure` block merge; (d) push a fix commit → gate goes stale/"waiting" on the new SHA → merge blocked; (e) add `cr:revalidate` → it's consumed, review re-runs on the new head SHA, prior bot inline comments are replaced (no duplicates), labels swap to `cr:pass`, status flips to `success`, merge allowed; (f) an unrelated label add does **not** trigger a review or clobber status. Also verify the **context-line** decision: if any inline post 422s, tighten the module to added-lines-only and re-run Phase 1 tests.

### Success Criteria:

#### Automated Verification:

- The `code-review` check appears on the test PR and transitions `failure → (stale) → success` across the walkthrough (observable in the PR checks UI / `gh pr checks`).

#### Manual Verification:

- Each step (a)–(f) above behaves as specified.
- Merge is blocked while `code-review/gate` is `failure` or missing, and allowed when `success`.
- The infra-failure path (e.g. temporarily set a bad `ANTHROPIC_API_KEY`) yields a blocking `failure` status + error sticky + no verdict label.
- No duplicate inline comments after a revalidate cycle.

**Implementation Note**: This phase is mostly manual + admin; capture the branch-protection setup steps in the change folder for repeatability.

---

## Testing Strategy

### Unit Tests:

- `diff.ts`: hunk parsing across added/deleted/renamed/multi-file/multi-hunk diffs, context-line inclusion, no-newline markers.
- `plan.ts`: inline-vs-summary partition (in-diff, out-of-diff, line-less), the 30-comment severity cap + overflow roll-up, verdict→`{state,label}`, sticky body composition (marker + verdict + summary + roll-up), per-comment dedup marker.

### Integration Tests:

- The GitHub I/O step is exercised on a **live test PR** (Phase 3) rather than mocked — Octokit/branch-protection behavior is the thing under test and isn't faithfully unit-testable.

### Manual Testing Steps:

1. Open a test PR with a flawed diff; confirm auto-review, inline + sticky output, `cr:fail`, blocked merge.
2. Push a fix; confirm the gate goes stale (blocked) on the new SHA.
3. Add `cr:revalidate`; confirm consume + re-run + comment replacement + `cr:pass` + `success` + merge allowed.
4. Add an unrelated label; confirm no review and no status change.
5. Break the credential; confirm fail-closed (blocking status + error sticky, no verdict label).

## Performance Considerations

One billable Anthropic call per open + per revalidate (sonnet-4-6), bounded by `maxTurns: 3` and `timeout-minutes: 15`. Label-gating + per-SHA staleness prevent per-commit cost. Very large diffs cost more tokens (accepted; no chunking). Inline comments capped at ~30 to avoid the 64KB body / many-comments edges; overflow goes to the summary.

## Migration Notes

Additive only — a new workflow, a new workspace member, an updated `pnpm-lock.yaml`, and `pnpm-workspace.yaml`. No DB, no app code, `ci.yml` untouched. Rollback = delete the workflow (and drop the required-check rule). The required-check rule is the only change that affects merges; it can be unset instantly in repo settings.

## References

- Research: `context/changes/code-review-in-cicd/research.md`
- Change spec: `context/changes/code-review-in-cicd/change.md`
- Package contract: `packages/code-review/src/cli.ts:32,89`, `src/review.ts:7,14,50`, `src/engine.ts:46`, `README.md`
- Package history (scope boundary): `context/changes/package-code-review/plan.md:44-51`
- Existing CI: `.github/workflows/ci.yml`; toolchain `mise.toml:5-8`, `pnpm-workspace.yaml:5-6`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Testable orchestration module

#### Automated

- [x] 1.1 Unit tests pass: `pnpm --filter @snapchef/code-review-ci test` — e84728b37
- [x] 1.2 Type checking passes: `pnpm --filter @snapchef/code-review-ci typecheck` — e84728b37
- [x] 1.3 Root lint passes: `pnpm lint` — e84728b37
- [x] 1.4 Lockfile consistent: `pnpm install --frozen-lockfile` succeeds — e84728b37
- [x] 1.5 Entrypoint writes a valid `PostPlan` JSON from a sample diff+review — e84728b37

#### Manual

- [x] 1.6 Spot-check `cr-output.json` from a real `git diff` + `code-review --json`: partition correct, no out-of-diff line in `comments[]` — e84728b37

### Phase 2: The `code-review.yml` workflow

#### Automated

- [x] 2.1 Workflow YAML lints (`actionlint`) — 4c58947d8
- [x] 2.2 Phase-1 module still green: `pnpm --filter @snapchef/code-review-ci test` — 4c58947d8
- [x] 2.3 Root lint + `--frozen-lockfile` unaffected — 4c58947d8

#### Manual

- [x] 2.4 Read-through: status on `head.sha`; `event: COMMENT`; fail-closed on infra path; no status write when not running; secret scoped to the package step — 4c58947d8

### Phase 3: Repo setup + live verification

#### Automated

- [ ] 3.1 `code-review/gate` check appears and transitions `failure → stale → success` on the test PR (`gh pr checks`)

#### Manual

- [ ] 3.2 `ANTHROPIC_API_KEY` secret + the three labels exist
- [ ] 3.3 `code-review/gate` marked required in a ruleset/branch protection for `main`
- [ ] 3.4 Walkthrough steps (a)–(f) behave as specified
- [ ] 3.5 Merge blocked on `failure`/missing, allowed on `success`
- [ ] 3.6 Infra-failure path is fail-closed (blocking status + error sticky, no verdict label)
- [ ] 3.7 No duplicate inline comments after a revalidate cycle
