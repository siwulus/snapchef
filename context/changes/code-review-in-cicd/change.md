---
change_id: code-review-in-cicd
title: Run the code-review package in CI on PRs to main with label-gated revalidation
status: implementing
created: 2026-06-28
updated: 2026-06-28
archived_at: null
---

## Notes

### Intent

Wire `packages/code-review` (a freshly added workspace package: git diff on stdin →
validated `Review` JSON via the Claude Agent SDK) into CI as an **AI code-review gate**
on PRs to `main`. The package's v0 deliberately ships _no_ CI/GitHub integration
(README "Scope (v0)"); this change builds exactly that omitted layer as a **new,
separate `code-review.yml` workflow** — it does not modify the existing `ci.yml`
(lint + build) job, whose trigger model (every push/PR) is different from the
label-gated review.

### Resolved decisions (from the architecture-review session)

1. **First run:** review runs automatically once on `pull_request` `opened`/`reopened`
   against `main`; thereafter it re-runs **only** when the `cr:revalidate` label is
   added. (Reconciles original reqs 2 and 5.)
2. **Summary placement:** a single **sticky bot comment** (find-by-HTML-marker, edit in
   place or create), never edits the PR description/body.
3. **CI credential:** `ANTHROPIC_API_KEY` (pay-as-you-go) stored as a repo secret — _not_
   a personal `CLAUDE_CODE_OAUTH_TOKEN` subscription token. Package supports both
   (`src/cli.ts:32`).
4. **Gate rule:** verdict `request_changes` → `cr:fail` → **blocks** merge;
   `approve` and `comment` → `cr:pass` → mergeable.

### Refined requirements

- **R1 — Separate workflow.** Add `.github/workflows/code-review.yml`; leave `ci.yml`
  untouched. Reuse the repo toolchain (`jdx/mise-action`, `pnpm install
--frozen-lockfile`).
- **R2 — Trigger.** `pull_request: [opened, reopened]` (first pass) **and**
  `pull_request: [labeled]` filtered to `cr:revalidate` (re-run). Concurrency group
  keyed on the PR number, `cancel-in-progress: true`.
- **R3 — Merge gate is a required status check, not a label.** The job reports a commit
  status (e.g. `code-review/gate`) that branch protection marks **required**. Labels are
  a human-readable _mirror_ of that status, never the gate themselves (anyone can edit a
  label). Because the required check is per-commit, pushing new commits leaves it
  stale/pending → merge blocked until `cr:revalidate` produces a fresh result for the new
  head SHA — this is the cost-control behavior, working _with_ branch protection.
  **Branch-protection setup (marking the check required) is a one-time repo-settings step,
  documented in the PR but applied by a human with admin rights.**
- **R4 — Verdict → labels.** Map the JSON `verdict` (`src/review.ts:14`) to `cr:pass` /
  `cr:fail` per the gate rule above. **Parse `--json` `verdict`, never the process exit
  code** — the CLI exits `0` on every successful review regardless of verdict
  (`src/cli.ts:88`); exit `1` means no diff / missing credential / crashed run only.
- **R5 — Cost control.** No review on every commit; only the first-open run + explicit
  `cr:revalidate` re-runs (see R2).
- **R6 — Label lifecycle on each run.** At run start: remove `cr:revalidate` (re-arms the
  trigger) and remove any stale `cr:pass` / `cr:fail`. After the review: add exactly one
  of `cr:pass` / `cr:fail` and update the gate status.
- **R7 — Output placement.** Sticky comment carries the `summary` + a roll-up of findings
  that have no line / fall outside the diff. Findings with a `file`+`line` inside the diff
  are posted as **inline review comments** via one PR Review per run
  (`POST /pulls/{n}/reviews`, `event: COMMENT`, `comments[].path/line/side`). Re-runs must
  not duplicate: remove the prior bot review comments before posting fresh ones.

### Design notes / known constraints

- **Diff source:** the package reads stdin and never runs git itself. Workflow computes
  `git diff origin/<base>...HEAD` with `fetch-depth: 0`, pipes to
  `pnpm --filter code-review review -- --json`.
- **Inline-comment constraint:** GitHub rejects review comments on lines not in the diff
  hunk, and the package's `line` is optional (`src/review.ts:28`). Findings without a line
  or outside the diff **must fall back** into the sticky summary, not crash the run or be
  silently dropped.
- **Failure handling:** a non-verdict failure (exit 1 — network/rate-limit/missing
  credential) → gate check **fails (blocks)**, sets **no** verdict label, and the sticky
  comment marks it an infrastructure error to re-run via `cr:revalidate`. An outage must
  not silently allow a merge.
- **Least-privilege `permissions:`** — `contents: read`, `pull-requests: write`
  (reviews + sticky comment), `issues: write` (labels), `statuses: write` (gate).

### Non-goals

- No change to `ci.yml`, to the Cloudflare Workers Builds production deploy, or to the
  package's source/CLI contract.
- No diff chunking / retries / multi-file fan-out (package v0 excludes these; large-PR
  cost/context is a tracked risk, not solved here).
- No support for **fork** PRs (secrets aren't exposed to fork-triggered runs; internal
  PRs only).

### Risks / open items

- Large diffs may exceed model context or run up cost (no chunking in v0).
- Inline-comment placement is the most failure-prone piece (diff-line mapping, dedup on
  re-run); needs careful handling + a test PR.
- Required-check + stale-status interaction with "require branches up to date" should be
  verified on a real PR before relying on it.
