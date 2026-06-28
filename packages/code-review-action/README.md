# code-review-action

A composite GitHub Action that runs the AI code reviewer over a pull request and
applies the result: **inline comments**, a **sticky summary** comment, and a
**fail-closed merge-gate commit status**. It is the composition layer over two
workspace packages — the platform-agnostic reviewer engine (`packages/code-review`)
and the GitHub orchestration (`@snapchef/code-review-ci`) — wired together so a
workflow runs the whole gate in one step.

The engine stays GitHub-free; this action is the only piece that knows about pull
requests. See `context/changes/code-review-reusable-action/` for the design.

## Usage

The caller checks out the repo (full history, for the diff) and passes secrets; the
action owns toolchain setup, install, diff, review, plan, and apply:

```yaml
permissions:
  contents: read
  statuses: write
  pull-requests: write
  issues: write

steps:
  - uses: actions/checkout@v4
    with:
      ref: ${{ github.event.pull_request.head.sha }}
      fetch-depth: 0
  - uses: ./packages/code-review-action
    with:
      anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
      github-token: ${{ secrets.GITHUB_TOKEN }}
      base-ref: ${{ github.base_ref }}
```

When (and whether) to run — triggers, concurrency, fork/event gating — is **policy**
that stays in the calling workflow. See `.github/workflows/code-review.yml` for the
reference consumer.

## Inputs

| Input               | Required | Default                  | Description                                                                                       |
| ------------------- | -------- | ------------------------ | ------------------------------------------------------------------------------------------------- |
| `anthropic-api-key` | yes      | —                        | Anthropic API key the reviewer authenticates with.                                                |
| `github-token`      | no       | `${{ github.token }}`    | Token used to post the review, sticky comment, labels, and gate status.                           |
| `model`             | no       | `claude-sonnet-4-6`      | Reviewer model id (e.g. `claude-opus-4-8` for a deeper, slower review).                           |
| `base-ref`          | no       | `${{ github.base_ref }}` | Base branch for the three-dot diff (`origin/<base-ref>...HEAD`). Ignored when `diff-file` is set. |
| `max-inline`        | no       | `30`                     | Max inline comments before overflow rolls into the sticky summary.                                |
| `diff-file`         | no       | `""`                     | Path to a pre-computed unified diff. When set, the action skips `git diff` and reviews this file. |
| `status-context`    | no       | `code-review/gate`       | Commit-status context name. Set a distinct value when more than one review config runs on a repo. |

## Outputs

| Output       | Description                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `verdict`    | `approve` \| `comment` \| `request_changes` — `approve` on an empty diff, `error` on the infra / I-O fail-closed paths. |
| `gate-state` | `success` \| `failure` — the state posted to the gate commit status.                                                    |

## Behavior & guarantees

- **Fail-closed.** The apply step runs `if: always()` and always posts the gate
  status. A reviewer that exits non-zero (e.g. missing key, rate limit) yields a
  blocking `failure` status with an "infrastructure error" sticky — never a code
  verdict. Any I/O error while posting also blocks. If toolchain/install itself
  fails, no status is posted and branch protection blocks via the _missing required
  status_ — still fail-closed.
- **Gate semantics.** Only a `request_changes` verdict blocks; `comment` and
  `approve` pass. An empty diff passes with no billable AI call.
- **Idempotent re-runs.** Prior bot inline comments are removed before posting and
  the sticky is upserted in place, so re-running (e.g. via a revalidate label) does
  not duplicate.

## Scope

PR-only: the apply step requires a `pull_request` in the event payload. The action is
intended for `pull_request` workflows; it is not designed for `push` / other events.

## Future extraction (deferred)

This action is intentionally a **composite** that shells into the workspace packages
via `tsx` — no build step, in-repo only. Its **inputs/outputs are the stable public
contract**: extracting it into a standalone published action later changes only the
`runs:` implementation, leaving consumers untouched. Checklist when that day comes:

1. Move `packages/code-review`, `packages/code-review-ci`, and this directory into a
   new repository (they already sit together under `packages/`).
2. Add a bundler (`@vercel/ncc` or esbuild) to produce a single `dist/index.js` that
   runs the engine then the orchestration.
3. Switch `runs:` from `composite` to `node20` + `main: dist/index.js`.
4. Vendor dependencies into the bundle (no `pnpm install` at consume time).
5. Tag with semver and publish.
6. Consumers switch `uses: ./packages/code-review-action` →
   `uses: <org>/code-review-action@v1`. Inputs/outputs stay identical → zero churn.
