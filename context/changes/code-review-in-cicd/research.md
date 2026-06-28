---
date: 2026-06-28T18:43:21+0200
researcher: tomasz.worsztynowicz
git_commit: 7b72166cd9e6d3d4de4a59ea42a165dc86e69085
branch: main
repository: siwulus/snapchef
topic: "Wire packages/code-review into CI as a label-gated AI review gate on PRs to main"
tags: [research, codebase, ci-cd, github-actions, code-review, package-code-review]
status: complete
last_updated: 2026-06-28
last_updated_by: tomasz.worsztynowicz
---

# Research: Wire `packages/code-review` into CI as a label-gated AI review gate

**Date**: 2026-06-28T18:43:21+0200
**Researcher**: tomasz.worsztynowicz
**Git Commit**: 7b72166cd9e6d3d4de4a59ea42a165dc86e69085
**Branch**: main
**Repository**: siwulus/snapchef

## Research Question

How do we wire the freshly added `packages/code-review` package (git diff on stdin → validated `Review` JSON via the Claude Agent SDK) into CI as an **AI code-review gate** on PRs to `main`, per the spec in `context/changes/code-review-in-cicd/change.md`: auto-run once on PR open, re-run only on a `cr:revalidate` label, reflect the verdict in `cr:pass`/`cr:fail` labels, block merge on a failing verdict, post a sticky summary comment + inline findings, all cost-controlled?

## Summary

The change is **feasible exactly as specced**, and the research resolved every open item in `change.md`. Two independent platform agents **converged on the same architecture**, which is the key result:

- **The merge gate is a GitHub _commit status_** (`POST /repos/{o}/{r}/statuses/{sha}`, context e.g. `code-review/gate`), made _required_ via branch protection — **not** a label and **not** a bot `REQUEST_CHANGES` review. Labels (`cr:pass`/`cr:fail`) are a human-readable _mirror_; the status is the real gate.
- **The PR review is `event: COMMENT`** — advisory inline comments + a sticky summary comment. The bot must **not** use `REQUEST_CHANGES` (it would create its own merge-block that humans must dismiss, fighting the status gate).

The package is a **pure** diff→JSON tool by design (its v0 deliberately excluded all CI/GitHub/git concerns), so **100% of the GitHub orchestration lives in the new workflow** — no package changes needed, matching the change's non-goals.

The three highest-risk implementation facts, all confirmed:

1. **The gate must parse JSON `verdict`, never `$?`.** The CLI exits `0` on every successful review regardless of verdict ([cli.ts:89](https://github.com/siwulus/snapchef/blob/7b72166cd9e6d3d4de4a59ea42a165dc86e69085/packages/code-review/src/cli.ts#L89)); exit `1` = no diff / missing credential / crashed run.
2. **Inline comments are all-or-nothing and reject any line not in the diff (HTTP 422).** One bad `(file, line)` fails the _entire_ review submission. → We **must pre-validate** every finding's line against the parsed diff hunks and route non-diff/line-less findings to the summary.
3. **Required checks evaluate against the PR _head_ SHA**, so a normal push (which we deliberately don't trigger on) leaves the gate "missing" → merge blocked until `cr:revalidate` re-runs the review on the new SHA. This _is_ the cost-control mechanism; it requires no extra logic but must be communicated to authors.

A complete, annotated workflow skeleton is in [Architecture Insights](#architecture-insights--recommended-design).

## Detailed Findings

### A. The package's CI contract (`packages/code-review`)

**Invocation.** The reviewer reads a git diff on **stdin** and prints to **stdout**; `--json` emits machine-readable output. Two equivalent forms:

```bash
# via pnpm (README form) — flags after `--` so pnpm forwards them
git diff "origin/${BASE}...HEAD" | pnpm --filter code-review review -- --json
# direct via tsx (recommended for CI — sidesteps the `--` artifact entirely)
git diff "origin/${BASE}...HEAD" | pnpm --filter code-review exec tsx src/cli.ts --json
```

The `--` strip at [cli.ts:53](https://github.com/siwulus/snapchef/blob/7b72166cd9e6d3d4de4a59ea42a165dc86e69085/packages/code-review/src/cli.ts#L53) only undoes pnpm's separator artifact; calling `tsx src/cli.ts --json` directly needs no separator. The package does **not** run `git` itself — the workflow computes and pipes the diff.

**Exit codes** ([cli.ts:67,72,78,84,89,91](https://github.com/siwulus/snapchef/blob/7b72166cd9e6d3d4de4a59ea42a165dc86e69085/packages/code-review/src/cli.ts#L89); README "Exit codes"):

| Code | Meaning                                                              |
| ---- | -------------------------------------------------------------------- |
| `0`  | Review printed — **regardless of verdict** (incl. `request_changes`) |
| `1`  | No diff on stdin / missing credential / review run threw             |
| `2`  | Invalid CLI args/options                                             |

⇒ **Gate logic must `jq -r '.verdict'` the JSON, not read `$?`.**

**JSON contract** (the `Review` schema, [review.ts:50-65](https://github.com/siwulus/snapchef/blob/7b72166cd9e6d3d4de4a59ea42a165dc86e69085/packages/code-review/src/review.ts#L50)):

```jsonc
{
  "summary": "…", // OPTIONAL string (review.ts:51-54)
  "findings": [
    // REQUIRED array, may be empty
    {
      "severity": "critical", // REQUIRED enum: critical|major|minor|nit (review.ts:7)
      "file": "src/x.ts", // REQUIRED string (path as in the diff)
      "line": 12, // OPTIONAL number, 1-based NEW-file line (review.ts:28-31)
      "title": "…", // REQUIRED
      "detail": "…", // REQUIRED
      "suggestion": "…",
    }, // OPTIONAL
  ],
  "verdict": "request_changes", // REQUIRED enum: approve|comment|request_changes (review.ts:14)
}
```

Consumer must treat `summary`, `line`, `suggestion` as possibly absent. Per the change's gate rule: `request_changes` → `cr:fail` (block); `approve` + `comment` → `cr:pass`.

**Auth in CI.** Credential precedence ([cli.ts:32,39-40](https://github.com/siwulus/snapchef/blob/7b72166cd9e6d3d4de4a59ea42a165dc86e69085/packages/code-review/src/cli.ts#L32)): `CLAUDE_CODE_OAUTH_TOKEN` → `ANTHROPIC_API_KEY` → `ANTHROPIC_AUTH_TOKEN`, first non-blank wins. The package `.env` autoload only fires when **no** env credential is present ([cli.ts:122](https://github.com/siwulus/snapchef/blob/7b72166cd9e6d3d4de4a59ea42a165dc86e69085/packages/code-review/src/cli.ts#L122)) and is **gitignored** (absent in CI). For CI, set in the job/step env:

```yaml
env: { ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }} }
```

The SDK spawns a subprocess that inherits this env — no flag passes the credential.

**Toolchain & cost.** Node 24 / pnpm 11.6.0 pinned in `mise.toml:5-8`; existing `ci.yml` bootstraps via `actions/checkout@v4` → `jdx/mise-action@v4` → `pnpm install --frozen-lockfile` ([.github/workflows/ci.yml:11-18](https://github.com/siwulus/snapchef/blob/7b72166cd9e6d3d4de4a59ea42a165dc86e69085/.github/workflows/ci.yml#L11)). The package needs **no build step** (runs via `tsx`) and is **independent of the Astro app** (no `astro sync`/`build`). One root `pnpm install --frozen-lockfile` links it (`pnpm-workspace.yaml:5-6`). The SDK ships prebuilt platform binaries (no `requiresBuild`, not in `allowBuilds` — and doesn't need to be). Each run makes a **live, billable** Anthropic call; `maxTurns: 3`, no built-in timeout ([engine.ts:51](https://github.com/siwulus/snapchef/blob/7b72166cd9e6d3d4de4a59ea42a165dc86e69085/packages/code-review/src/engine.ts#L51)) → set `timeout-minutes` on the job. Default model `claude-sonnet-4-6` (`options.ts:4`), overridable with `--model`.

### B. GitHub Actions gate mechanics

**Triggers.**

```yaml
on:
  pull_request:
    types: [opened, reopened, labeled]
    branches: [main]
```

Discriminate event type inside the job: run the AI when `(action != 'labeled') || (label.name == 'cr:revalidate')`. Adding any _other_ label still fires a `labeled` event, but the guard skips the expensive step.

**The required-check deadlock (the central platform gotcha).** GitHub distinguishes:

- A **workflow that never triggers** (or is skipped by path/branch filter) → its required check stays **`Expected — Waiting for status to be reported`** → **permanent merge block**.
- A **job skipped via `if:`** → reports **`Success`** (`success`/`skipped`/`neutral` all count as passing) → would **silently let the PR merge**.

Both are footguns. **Resolution (canonical):** don't make the gate a function of whether a job ran. Use a job that posts an **explicit commit status** via the API under a fixed context name; make _that_ the required check. The expensive AI call is conditional _steps inside_ the job; the status post is an explicit API call with `state: success|failure`. (Docs: [Troubleshooting required status checks → "Handling skipped but required checks"](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/defining-the-mergeability-of-pull-requests/troubleshooting-required-status-checks).)

**Commit status vs Checks API.** Use the **Commit Status API** — works with plain `GITHUB_TOKEN` (Checks API is GitHub-App-only). Attach to **`github.event.pull_request.head.sha`**, _never_ `github.sha` (which is the ephemeral merge commit in a `pull_request` event). Branch protection matches by the `context` string.

**Stale-per-SHA.** Required checks evaluate against the PR's **latest head SHA** ("Checks triggered using a previous commit SHA will not be used"). So: push a commit → no workflow run (we don't listen to `synchronize`) → new SHA has no `code-review/gate` status → blocked → author adds `cr:revalidate` → review runs on the new SHA → status posted. Intended cost-control behavior, free of extra logic.

**Label ops & no recursion.** Add/remove labels via `actions/github-script` (`issues.addLabels` / `issues.removeLabel`). Removing an absent label returns **404** — wrap in try/catch and swallow 404. Re-adding `cr:revalidate` later fires a **fresh `labeled` event** (re-arm works). **Label/comment/status writes performed with `GITHUB_TOKEN` do NOT trigger new workflow runs** — GitHub suppresses this to prevent recursion, so removing `cr:revalidate` and adding `cr:pass`/`cr:fail` inside the run is loop-safe. (Only a PAT/App token would re-trigger.)

**Permissions (minimal).**

```yaml
permissions:
  contents: read # checkout + git diff
  statuses: write # the required gate status
  pull-requests: write # PR review with inline comments
  issues: write # labels + sticky issue-comment
```

**Concurrency.** `group: code-review-${{ github.event.pull_request.number }}`, `cancel-in-progress: true` — prevents label-spam from piling up billable runs. Fail-closed: a cancelled run that cleaned labels but didn't post a verdict leaves the gate "missing" → blocked (safe).

**Secrets & forks.** `pull_request` (NOT `pull_request_target`) is correct: secrets are withheld from fork-triggered runs, so `ANTHROPIC_API_KEY` can't leak to fork code. Add a belt-and-suspenders guard `github.event.pull_request.head.repo.full_name == github.repository` to no-op on forks. `pull_request_target` is explicitly the _unsafe_ choice here.

**Diff range.** `actions/checkout@v4` with `fetch-depth: 0`, then `git diff "origin/${{ github.base_ref }}...HEAD"` — **three-dot** = merge-base vs head (what the PR introduces; matches the PR UI). Two-dot would pollute the diff when `main` moves. (`...` for `git diff` = merge-base..head; note the meaning is inverted for `git log`.)

### C. PR review / comment API specifics

**Inline comments via the PR Review API.** Post **one review** with all inline comments: `POST /repos/{o}/{r}/pulls/{n}/reviews` with `commit_id = head.sha`, `event: "COMMENT"`, a top-level `body`, and `comments[]` where each is `{ path, line, side: "RIGHT", body }` (add `start_line`+`start_side` only for multi-line). Use `line`+`side`, **not** the deprecated `position`. Always pass an explicit `event` (blank ⇒ a hidden PENDING draft).

**Why `COMMENT`, not `REQUEST_CHANGES`.** A bot `REQUEST_CHANGES` review creates a standing merge-block that a human must dismiss, and it flip-flops across runs — fighting the commit-status gate. Keep "advice" (the review) and "gate" (the status) independent.

**The 422 diff-line constraint (must pre-validate).** GitHub rejects a comment whose `(path, line, side)` isn't inside a diff hunk → HTTP **422** "Pull request review thread line must be part of the diff." The `reviews` call is **atomic**: one invalid comment fails the _whole_ submission (no partial post). So:

**Diff-line validation algorithm** (the load-bearing piece):

1. Fetch the PR diff (`GET /pulls/{n}/files`, paginated — each file has a `patch`; or the raw `.diff` media type).
2. Build `Map<path, Set<newLine>>`: per hunk header `@@ -a,b +c,d @@`, set `newLine = c`; for each body line — `+` → add `newLine`, `newLine++`; ` ` (context) → add `newLine`, `newLine++`; `-` → skip (don't advance). (If sporadic 422s appear on context lines, tighten to **added (`+`) lines only**.)
3. Partition findings: `(file, line)` in the set → **inline**; else (no `line`, or line outside the diff) → **summary roll-up**.
4. Post only validated inline comments. Reference libs that already do this: `parse-diff` (npm), reviewdog, pr-agent.

**Sticky summary = an _issue_ comment.** PR conversation comments use `/issues/{n}/comments` (distinct from review comments). Embed a first-line HTML marker `<!-- code-review-bot -->`; list issue comments, find the one containing the marker (optionally also `user.login === 'github-actions[bot]'`), then `updateComment` (in place) or `createComment`. Equivalent to `peter-evans/create-or-update-comment` + `find-comment`, or `marocchino/sticky-pull-request-comment`.

**Dedup inline comments on re-run.** Cleanest "one fresh review per run": `GET /pulls/{n}/comments`, filter to `github-actions[bot]` (and/or a per-comment marker), `DELETE /pulls/comments/{id}` each, then post the fresh review. You **cannot delete a submitted review** (only _unsubmitted_ ones; `DELETE /pulls/{n}/reviews/{id}`), and **dismiss** (`PUT …/dismissals`) only clears verdict state, leaving comment threads — so deletion of the prior bot comments is the right tool. Since we use `COMMENT` (no verdict state), dismissal is irrelevant.

**Tooling.** Use **`actions/github-script@v7`** for all GitHub I/O — it gives an authenticated Octokit + `context`, native JSON/array handling for parsing the reviewer output, diff parsing, building `comments[]`, and find-or-create sticky logic. `gh api`/`curl` are awkward for the array+diff-parse work. Keep each comment body < 64KB; cap inline comments (e.g. top ~30 by severity) and push the rest to the summary if a run is huge.

### D. Historical context — the package's deliberate boundary

The package was built in the prior `package-code-review` change. Its v0 **explicitly excluded** the entire CI layer (`context/changes/package-code-review/plan.md:44-51`, `plan-brief.md:32-34`):

> Out of scope: CI/GitHub Action, PR-comment posting, git-hook integration; the tool running `git` itself; multi-file fan-out, diff chunking, retry/repair, caching; native `outputFormat` or JSON-parsing paths; … **deriving exit code from `verdict`.**

This confirms the responsibility split: **package = pure diff→JSON; workflow = all GitHub orchestration.** It also confirms the exit-code-vs-verdict decision was intentional (not an oversight to "fix" in the package). No prior change/archive attempted CI review — no duplication risk. The current `change.md` spec aligns cleanly with this boundary (its non-goal "No change to the package's source/CLI contract" is correct).

## Code References

- [`packages/code-review/src/cli.ts#L32`](https://github.com/siwulus/snapchef/blob/7b72166cd9e6d3d4de4a59ea42a165dc86e69085/packages/code-review/src/cli.ts#L32) — `CREDENTIAL_ENV_VARS` precedence + exit codes (`L67,72,78,84,89,91`), `--` strip (`L53`), `.env` fallback (`L101-124`)
- [`packages/code-review/src/review.ts#L7`](https://github.com/siwulus/snapchef/blob/7b72166cd9e6d3d4de4a59ea42a165dc86e69085/packages/code-review/src/review.ts#L7) — `Severity` + `Verdict` enums (`L14`), `Review`/`Finding` shape, optional `line`/`summary`/`suggestion`
- [`packages/code-review/src/engine.ts#L46`](https://github.com/siwulus/snapchef/blob/7b72166cd9e6d3d4de4a59ea42a165dc86e69085/packages/code-review/src/engine.ts#L46) — SDK `query()`, `maxTurns: 3`, structured-output via `z.toJSONSchema(…, draft-07)`, network call
- [`packages/code-review/src/render.ts#L9`](https://github.com/siwulus/snapchef/blob/7b72166cd9e6d3d4de4a59ea42a165dc86e69085/packages/code-review/src/render.ts#L9) — `--json` = `JSON.stringify(review, null, 2)`
- [`packages/code-review/src/options.ts#L4`](https://github.com/siwulus/snapchef/blob/7b72166cd9e6d3d4de4a59ea42a165dc86e69085/packages/code-review/src/options.ts#L4) — `DEFAULT_MODEL = "claude-sonnet-4-6"`
- [`.github/workflows/ci.yml#L11`](https://github.com/siwulus/snapchef/blob/7b72166cd9e6d3d4de4a59ea42a165dc86e69085/.github/workflows/ci.yml#L11) — existing CI (checkout → mise → install → astro sync → lint → build); leave untouched
- `mise.toml:5-8` — Node 24 / pnpm 11.6.0; `pnpm-workspace.yaml:5-6` — workspace linking; `pnpm-workspace.yaml:16-23` — `allowBuilds` (SDK not needed)
- `context/changes/package-code-review/plan.md:44-51` — v0 out-of-scope (the package↔CI boundary)
- `context/changes/code-review-in-cicd/change.md` — the refined spec these findings ground

## Architecture Insights — recommended design

**Single new workflow `.github/workflows/code-review.yml`; `ci.yml` untouched.** One job, no job-level `if:` on the gate. All GitHub I/O via `actions/github-script@v7`. The gate is a commit status; the review is `COMMENT`-only.

**Run flow (when the AI should run = open/reopen, or `cr:revalidate` added, and not a fork):**

1. Checkout `fetch-depth: 0`; `git diff "origin/${base_ref}...HEAD"`.
2. Remove `cr:revalidate` + stale `cr:pass`/`cr:fail` (swallow 404s).
3. Pipe diff → `code-review --json`; capture JSON (guard: tool exit `1` = infra failure → post `failure` status, no verdict label, sticky comment marks it an error to re-run).
4. Parse `verdict`; build diff-line `Map<path,Set<newLine>>`; partition findings inline vs summary.
5. Delete prior `github-actions[bot]` inline review comments; post one fresh `event: COMMENT` review with validated `comments[]` (`commit_id = head.sha`).
6. Upsert the sticky summary issue comment (marker `<!-- code-review-bot -->`).
7. Add `cr:pass` (verdict approve/comment) or `cr:fail` (request_changes).
8. Post commit status `code-review/gate` = `success`/`failure` on `head.sha`.

**One-time human setup (NOT done by the workflow):** mark `code-review/gate` as a _required_ status check in branch protection / a ruleset for `main`. The workflow can report the status but cannot make it blocking. (Folklore: a commit-status context may need to be reported once before it appears in the branch-protection picker; rulesets let you type the name freely.)

**Annotated skeleton:**

```yaml
name: Code Review
on:
  pull_request:
    types: [opened, reopened, labeled]
    branches: [main]
concurrency:
  group: code-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true
permissions:
  contents: read
  statuses: write
  pull-requests: write
  issues: write
jobs:
  review:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - id: gate
        uses: actions/github-script@v7
        with:
          script: |
            const a = context.payload.action, repo = context.repo;
            const isFork = context.payload.pull_request.head.repo.full_name !== `${repo.owner}/${repo.repo}`;
            const run = !isFork && (a === 'opened' || a === 'reopened'
              || (a === 'labeled' && context.payload.label?.name === 'cr:revalidate'));
            core.setOutput('run', run);
      - if: steps.gate.outputs.run == 'true'
        uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - if: steps.gate.outputs.run == 'true'
        uses: jdx/mise-action@v4
      - if: steps.gate.outputs.run == 'true'
        run: pnpm install --frozen-lockfile
      # … remove stale labels → git diff | code-review --json → parse →
      #    delete prior bot comments → post COMMENT review → sticky summary →
      #    add cr:pass/cr:fail → createCommitStatus(code-review/gate, head.sha)
        env: { ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }} }
```

**Convergent decisions (both platform agents agreed):** commit-status gate + `COMMENT` review. **Decisions from the prior Q&A baked into `change.md`:** auto-run on open + label-gated re-runs; sticky comment (not PR-body edit); `ANTHROPIC_API_KEY`; `request_changes`→block.

## Historical Context (from prior changes)

- `context/changes/package-code-review/plan.md:44-51` & `plan-brief.md:32-34` — v0 deliberately excluded CI/GitHub/git/posting/chunking/retries and exit-code-from-verdict. Establishes the package↔CI boundary this change builds on.
- `context/changes/code-review-in-cicd/change.md` — the refined spec (4 resolved decisions, R1–R7, non-goals, risks) produced before this research; all of it is corroborated below, none contradicted.

## Related Research

- None — this is the first CI/code-review research artifact in the repo. `context/foundation/lessons.md` is absent.

## Open Questions

1. **Large-diff handling.** The package has no chunking/`maxTurns` is 3; a huge PR may exceed model context or cost more. Cap diff size / inline-comment count, or split? (Risk noted in `change.md`; not solved by the package.)
2. **Required-check picker visibility.** Confirm on the real repo whether `code-review/gate` appears in the branch-protection UI after the first report, or whether a ruleset (free-text check name) is cleaner. (Folklore-level; verify during setup.)
3. **`comment` verdict UX.** Decided: `comment`→`cr:pass` (mergeable). Confirm this matches reviewer behavior — does the model emit `comment` for "minor nits, mergeable" or for "needs discussion"? May want to inspect a few real runs.
4. **Context-line inline comments.** Start by allowing added + context lines; if 422s appear, tighten to added-only. Decide at implementation time after a test PR.
5. **Infra-failure policy.** Decided default: AI/network failure → `failure` status (blocks), no verdict label, error sticky comment. Confirm we don't want a `neutral`/non-blocking treatment to avoid an Anthropic outage blocking all merges.
6. **Model choice & cost.** Default `claude-sonnet-4-6`; confirm vs `--model claude-opus-4-8` for deeper (costlier) reviews. Add a `timeout-minutes` safety net.
