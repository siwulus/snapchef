# Reusable Composite Code-Review Action — Implementation Plan

## Overview

Expose the existing code-review **engine** (`packages/code-review`) and **GitHub orchestration** (`@snapchef/code-review-ci`) as a single `uses:`-able **composite GitHub Action**, without merging the two modules. The action wraps the whole pipeline (setup → diff → review → plan → apply → gate) behind one input/output contract so any workflow in this repo can run a reviewed, fail-closed merge gate in one step. The orchestration package is co-located under `packages/` so a future extraction into a published action is a directory move, and the action's `action.yml` interface is the forward-compatible artifact (only `runs:` changes on extraction).

This builds directly on the in-progress `code-review-in-cicd` work (whose `apply.ts`/`apply.test.ts` are currently uncommitted on `feat/code-review-in-cicd`).

## Current State Analysis

- **Engine** — `packages/code-review` (package name `code-review`): diff on stdin → validated `Review` JSON. CI-agnostic; runs via `tsx src/cli.ts`. Unchanged by this plan.
- **Orchestration** — `.github/scripts/code-review` (package name `@snapchef/code-review-ci`): `diff.ts` (valid-line map), `plan.ts` (`buildPostPlan`: verdict→gate, inline/sticky partition), `index.ts` (file I/O CLI), `apply.ts` (Octokit shell: labels, dedup, sticky upsert, **always** posts the `code-review/gate` status — fail-closed), plus `__fixtures__/`. All logic is unit-tested; the YAML/GitHub-I/O layer is not (it can't be faithfully mocked).
- **Workflow** — `.github/workflows/code-review.yml` (`.github/workflows/code-review.yml:54-113`): inline steps for toolchain, install, three-dot diff, run reviewer (captures exit code), build plan, and apply. Policy (`on`/`concurrency`/`permissions`, the fork+event **Gate decision** github-script step, checkout) is interleaved with the mechanical pipeline.
- **Move is mechanically safe**: both packages' `tsconfig.json` (`include: ["src"]`) and `vitest.config.ts` (relative globs) carry no cross-dir paths; fixtures load via `new URL("./__fixtures__/…", import.meta.url)`. The workflow references the orchestration only by **package name** (`pnpm --filter @snapchef/code-review-ci`, `.github/workflows/code-review.yml:96,113`), so a directory move does not touch it as long as the name is kept.
- **Verification precedent**: `code-review-in-cicd` verified the gate live on PR #19 (run 28330027406) — the fail-closed path was proven by running with no `ANTHROPIC_API_KEY`. `pull_request` triggers run the workflow file from the PR head, so a verification PR exercises the new action + workflow on itself.

### Key Discoveries:

- The commit-status context is hardcoded at `apply.ts` `createCommitStatus({ … context: "code-review/gate" })` (`.github/scripts/code-review/src/apply.ts:205`); `finalState`/`finalDescription` (`:212-213`) are resolved across every branch and posted in `finally` via `setStatus` (`:285`) — the single place that knows the outcome on all paths.
- `apply.ts` already injects a narrow `CoreApi` (`:129-134`) and `env` (`:141`), so adding a configurable status context and emitting outputs are localized, testable changes.
- `PostPlan` (`.github/scripts/code-review/src/plan.ts:60-70`) carries `state`/`label` but **not** `verdict`; `buildPostPlan` (`:129-163`) already has `review.verdict` in hand.
- `pnpm-workspace.yaml` already globs `packages/*` and **separately** lists `.github/scripts/code-review` — moving under `packages/` means **deleting** that explicit line, not editing it.
- Dead-after-move config: `eslint.config.js:74` ignores both `packages/**` and `.github/scripts/**`; `code-review-in-cicd/setup.md:76,78` reference the old `diff.ts` path (doc-only).

## Desired End State

A workflow runs the full gate with one step:

```yaml
- uses: ./packages/code-review-action
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
    base-ref: ${{ github.base_ref }}
```

`packages/` holds three sibling members — `code-review` (engine, unchanged), `code-review-ci` (orchestration, moved + extended), `code-review-action` (the composite manifest + README). `code-review.yml` is thin: policy only, delegating capability to the action. Behavior on every branch (success / empty diff / infra failure / I/O error) is identical to today, plus a configurable status context and `verdict`/`gate-state` outputs. Verified by: all unit tests + lint + typecheck green, `actionlint` clean, and a live test PR showing the review posts and the gate reports correctly through the action.

## What We're NOT Doing

- **Not** merging the engine into the GitHub orchestration — the separation is the whole point.
- **Not** extracting to a separate repo, bundling a Node action (`ncc`/esbuild), or publishing/versioning externally. Composite + `tsx`, in-repo only, for now.
- **Not** changing engine review logic, the reviewer prompt, the `Review` wire contract, the orchestration's partition/dedup/fail-closed logic, or the gate semantics (only `request_changes` blocks).
- **Not** adding new triggers, fork-PR support, diff chunking, or retries (deferred in prior plans; still deferred).
- **Not** supporting non-`pull_request` events — `apply.ts` requires `context.payload.pull_request`; the action stays PR-scoped (documented in its README).
- **Not** moving the fork/event **Gate decision** into the action — that is per-workflow policy and stays in the workflow.

## Implementation Approach

Three phases, each leaving the repo in a working state and ending in a human-confirmation gate (matching the `code-review-in-cicd` rhythm):

1. **Structural move first** — relocate the orchestration package with zero behavior change. The existing inline workflow keeps working because it filters by package name, so `main`'s gate is never broken mid-change.
2. **Build the contract, then the action** — extend the orchestration package (still consumed by the old inline workflow harmlessly, since it doesn't yet set the new env) and author the composite `action.yml` + README. The action exists but isn't wired yet.
3. **Switch + prove live** — thin the workflow to consume the action and verify on a real PR (the only faithful test of GitHub I/O).

## Critical Implementation Details

- **Lockfile must be regenerated and committed.** Moving a workspace member rewrites the `pnpm-lock.yaml` importer key (was `.github/scripts/code-review:`). CI installs with `--frozen-lockfile`, so an un-updated lockfile fails CI. Run a plain `pnpm install` after the move and commit the resulting `pnpm-lock.yaml`.
- **`apply.ts` is the single source of truth for outputs.** Emit `gate-state` and `verdict` from `apply.ts` (via the injected `core.setOutput`) so they are populated on _every_ branch — including the empty-diff, infra-failure, and I/O-error fail-closed paths — not derived with `jq` in YAML (which would have no value on the branches where no JSON file exists). The composite action maps its `outputs:` to the apply step's `id` outputs.
- **Composite-action mechanics:** every `run:` step needs an explicit `shell: bash`; any step whose outputs are consumed (`diff`→`empty`, `review`→`code`, `apply`→`verdict`/`gate-state`) needs an `id:`; the apply step must be `if: always()` so the gate posts on failure paths. Inside the action the conditions simplify (no `gate.outputs.run` guard — that lives in the workflow): review runs `if empty=='false'`, plan runs `if empty=='false' && code=='0'`, apply runs `if always()`.
- **Artifact paths stay under `$GITHUB_WORKSPACE`.** `apply.ts` reads `${GITHUB_WORKSPACE}/cr-output.json` and `${GITHUB_WORKSPACE}/review.err`; keep the action's diff/review/plan steps writing `pr.diff`/`review.json`/`review.err`/`cr-output.json` there.
- **Package name is load-bearing.** Keep the moved package named `@snapchef/code-review-ci`; the `pnpm --filter` calls resolve by name, not path.
- **`pull_request` uses the head's workflow**, so the refactored `code-review.yml` and the new action are exercised on the verification PR itself (no merge-to-main needed to test).

## Phase 1: Co-locate the orchestration package

### Overview

Relocate `.github/scripts/code-review` → `packages/code-review-ci` and fix repo wiring. Pure structural move, no behavior change; the existing workflow continues to work via name-based `--filter`.

### Changes Required:

#### 1. Move the package directory

**File**: `.github/scripts/code-review/**` → `packages/code-review-ci/**`

**Intent**: Co-locate the orchestration alongside the engine so the three artifacts (engine, orchestration, action) sit under `packages/`, making future extraction a single directory move.

**Contract**: `git mv .github/scripts/code-review packages/code-review-ci`. Package name stays `@snapchef/code-review-ci`; `src/` (`diff.ts`, `plan.ts`, `index.ts`, `apply.ts` + tests), `__fixtures__/`, `package.json`, `tsconfig.json`, `vitest.config.ts` move verbatim. Includes the currently-uncommitted `apply.ts`/`apply.test.ts`.

#### 2. Workspace + lint wiring

**File**: `pnpm-workspace.yaml`, `eslint.config.js`

**Intent**: Drop now-redundant references to the old path; the `packages/*` glob already covers the new location.

**Contract**: Remove the explicit `- ".github/scripts/code-review"` workspace entry (the `packages/*` glob picks up the moved member). Remove the dead `".github/scripts/**"` entry from the ESLint ignore list at `eslint.config.js:74` (`packages/**` already covers it).

#### 3. Regenerate the lockfile

**File**: `pnpm-lock.yaml`

**Intent**: Reflect the moved workspace member so `--frozen-lockfile` installs (CI) succeed.

**Contract**: Run `pnpm install`; commit the regenerated `pnpm-lock.yaml` (importer key changes from `.github/scripts/code-review` to `packages/code-review-ci`).

#### 4. Fix doc references

**File**: `context/changes/code-review-in-cicd/setup.md`

**Intent**: Keep the prior runbook accurate after the move.

**Contract**: Update the two `.github/scripts/code-review/src/diff.ts` path references (`setup.md:76,78`) to `packages/code-review-ci/src/diff.ts`.

### Success Criteria:

#### Automated Verification:

- [ ] Orchestration tests pass: `pnpm --filter @snapchef/code-review-ci test`
- [ ] Orchestration typecheck passes: `pnpm --filter @snapchef/code-review-ci typecheck`
- [ ] Engine unaffected: `pnpm --filter code-review test` and `pnpm --filter code-review typecheck`
- [ ] Root lint passes: `pnpm lint`
- [ ] Lockfile is stable + committed: a second `pnpm install` leaves `pnpm-lock.yaml` with no diff
- [ ] No stray config references: `git grep -n ".github/scripts/code-review"` returns no hits in `pnpm-workspace.yaml`, `eslint.config.js`, or `.github/workflows/`

#### Manual Verification:

- [ ] `packages/code-review-ci/` contains `src/` + `__fixtures__/` and `.github/scripts/code-review/` no longer exists

**Implementation Note**: After all automated verification passes, pause for human confirmation before Phase 2.

---

## Phase 2: Action contract + composite action

### Overview

Extend the orchestration package with the action contract (`PostPlan.verdict`, configurable status context, `gate-state`/`verdict` outputs), then author the composite `action.yml` and its README. The action is created but not yet consumed by the workflow.

### Changes Required:

#### 1. Carry the verdict through the plan

**File**: `packages/code-review-ci/src/plan.ts`, `packages/code-review-ci/src/plan.test.ts`

**Intent**: Expose the verdict on `PostPlan` so `apply.ts` can emit it as an output without re-reading `review.json`.

**Contract**: Add `verdict: Verdict` to the `PostPlan` interface; `buildPostPlan` sets `verdict: review.verdict`. Add a `plan.test.ts` assertion that the built plan's `verdict` equals the review's. `index.ts` is unchanged (it serializes `PostPlan` as-is, so the field flows through `cr-output.json`).

#### 2. Configurable status context + action outputs in apply

**File**: `packages/code-review-ci/src/apply.ts`, `packages/code-review-ci/src/apply.test.ts`

**Intent**: Make the commit-status context configurable (so multiple review configs can coexist) and emit `gate-state`/`verdict` outputs on every branch.

**Contract**: Read `env.STATUS_CONTEXT` (default `"code-review/gate"`) and pass it as `createCommitStatus`'s `context`. Track a `finalVerdict` alongside `finalState` (empty → `"approve"`; infra-failure & I/O-error → `"error"`; success → `plan.verdict`). Add `setOutput(name: string, value: string): void` to the injected `CoreApi` interface; in the `finally`, call `core.setOutput("gate-state", finalState)` and `core.setOutput("verdict", finalVerdict)`. The real edge passes `@actions/core` (which has `setOutput`). Extend `apply.test.ts`: assert the custom + default status context, and assert `setOutput` is called with the right `gate-state`/`verdict` for the success, empty, and infra branches.

#### 3. The composite action manifest

**File**: `packages/code-review-action/action.yml`

**Intent**: Wrap engine + orchestration as a turnkey, self-contained composite action — the composition layer and the stable public contract.

**Contract**: Inputs — `anthropic-api-key` (required), `github-token` (default `${{ github.token }}`), `model` (default `claude-sonnet-4-6`), `base-ref` (default `${{ github.base_ref }}`), `max-inline` (default `30`), `diff-file` (default `''`), `status-context` (default `code-review/gate`). Outputs — `verdict` → `${{ steps.apply.outputs.verdict }}`, `gate-state` → `${{ steps.apply.outputs.gate-state }}`. Steps mirror the current workflow's mechanical pipeline (the non-obvious part — composite specifics in the skeleton below):

```yaml
runs:
  using: composite
  steps:
    - uses: jdx/mise-action@v4
    - shell: bash
      run: pnpm install --frozen-lockfile
    - id: diff
      shell: bash
      env: { BASE_REF: ${{ inputs.base-ref }}, DIFF_FILE: ${{ inputs.diff-file }} }
      run: |   # use DIFF_FILE if set, else: git fetch base; git diff origin/$BASE_REF...HEAD > "$GITHUB_WORKSPACE/pr.diff"; set empty=
    - id: review
      if: steps.diff.outputs.empty == 'false'
      shell: bash
      env: { ANTHROPIC_API_KEY: ${{ inputs.anthropic-api-key }} }
      run: |   # set +e; pnpm --filter code-review exec tsx src/cli.ts --json --model "${{ inputs.model }}" < pr.diff > review.json 2> review.err; echo code=$?
    - if: steps.diff.outputs.empty == 'false' && steps.review.outputs.code == '0'
      shell: bash
      run: pnpm --filter @snapchef/code-review-ci exec tsx src/index.ts "$GITHUB_WORKSPACE/pr.diff" "$GITHUB_WORKSPACE/review.json" "$GITHUB_WORKSPACE/cr-output.json" "${{ inputs.max-inline }}"
    - id: apply
      if: always()
      shell: bash
      env: { GITHUB_TOKEN: ${{ inputs.github-token }}, PKG_CODE: ${{ steps.review.outputs.code }}, DIFF_EMPTY: ${{ steps.diff.outputs.empty }}, STATUS_CONTEXT: ${{ inputs.status-context }} }
      run: pnpm --filter @snapchef/code-review-ci exec tsx src/apply.ts
```

#### 4. Action README

**File**: `packages/code-review-action/README.md`

**Intent**: Document the public contract and the deferred extraction path.

**Contract**: Inputs/outputs tables, a minimal `uses:` example, the PR-only scope note, and the **extraction checklist** (new repo → add bundler → flip `runs:` to `node20` + `dist/index.js` → vendor deps → semver tag → consumers switch `./packages/code-review-action` → `org/code-review-action@v1`; inputs/outputs stay stable → zero consumer churn).

### Success Criteria:

#### Automated Verification:

- [ ] Orchestration tests pass incl. new verdict/status-context/output assertions: `pnpm --filter @snapchef/code-review-ci test`
- [ ] Orchestration typecheck passes (`CoreApi.setOutput`, `PostPlan.verdict`): `pnpm --filter @snapchef/code-review-ci typecheck`
- [ ] Root lint passes: `pnpm lint`
- [ ] `action.yml` is valid YAML (parse via `node -e` / `python -c "import yaml,sys;yaml.safe_load(open('packages/code-review-action/action.yml'))"`)
- [ ] `actionlint` over `.github/workflows/` stays green (existing workflows unaffected)

#### Manual Verification:

- [ ] Read `action.yml` against the contract: inputs/outputs present; every `run:` has `shell: bash`; `diff`/`review`/`apply` steps have `id:`; step `if:` conditions match the current workflow; apply step is `if: always()` with the four env vars (`GITHUB_TOKEN`, `PKG_CODE`, `DIFF_EMPTY`, `STATUS_CONTEXT`)
- [ ] `README.md` documents inputs, outputs, usage, PR-only scope, and the extraction checklist

**Implementation Note**: After all automated verification passes, pause for human confirmation before Phase 3.

---

## Phase 3: Thin the workflow + live verification

### Overview

Refactor `code-review.yml` to consume the action, keeping only policy. Then verify live on a test PR — the only faithful test of the GitHub I/O.

### Changes Required:

#### 1. Refactor the workflow to consume the action

**File**: `.github/workflows/code-review.yml`

**Intent**: Collapse the mechanical pipeline (toolchain → install → diff → review → plan → apply) into a single `uses:` step; retain policy.

**Contract**: Keep `on`/`concurrency`/`permissions`, the **Gate decision** github-script step (`:32-45`), and **Checkout PR head** (`:47-52`, `fetch-depth: 0`). Replace steps `:54-113` with one step, `if: steps.gate.outputs.run == 'true'`, `uses: ./packages/code-review-action`, passing `anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}`, `github-token: ${{ secrets.GITHUB_TOKEN }}`, `base-ref: ${{ github.base_ref }}` (model/max-inline/status-context use defaults). The action internally computes the diff, so the workflow no longer needs the diff/empty plumbing.

### Success Criteria:

#### Automated Verification:

- [ ] `actionlint .github/workflows/code-review.yml` passes
- [ ] `code-review.yml` is valid YAML
- [ ] Root lint passes: `pnpm lint`

#### Manual Verification:

- [ ] On a test PR to `main`: the **Code Review** workflow runs the action and posts an inline + sticky review; the `code-review/gate` commit status matches the verdict
- [ ] Adding `cr:revalidate` re-runs the action without duplicating inline comments and updates the sticky in place
- [ ] The run log shows the action's `verdict` and `gate-state` outputs populated

**Implementation Note**: This phase requires the `ANTHROPIC_API_KEY` repo secret (already configured during `code-review-in-cicd`) and a throwaway PR. After verification, pause for final human confirmation.

---

## Testing Strategy

### Unit Tests:

- `plan.test.ts`: `buildPostPlan` sets `verdict` from the review.
- `apply.test.ts`: default vs custom `STATUS_CONTEXT` reaches `createCommitStatus`; `setOutput("gate-state", …)` / `setOutput("verdict", …)` fire with correct values on the success, empty-diff, and infra-failure branches.
- Existing `diff.test.ts` / `plan.test.ts` / `apply.test.ts` continue to pass unchanged after the move.

### Integration Tests:

- None automated (GitHub I/O isn't faithfully mockable — established in `code-review-in-cicd`). The composite action is intentionally thin; all real logic stays in the unit-tested TS modules.

### Manual Testing Steps:

1. Open a test PR to `main` from a branch containing all three phases; confirm the action runs and posts inline + sticky review with the correct `code-review/gate` status.
2. Add the `cr:revalidate` label; confirm a clean re-run (no duplicate inline comments, sticky updated in place).
3. Inspect the run log for populated `verdict` / `gate-state` outputs.

## Performance Considerations

No change to runtime cost: the same single reviewer call runs once per gated PR. The action adds a `jdx/mise-action` setup step (cached) — negligible. The `concurrency` cancel-in-progress and once-per-PR cost controls live in the workflow and are preserved.

## Migration Notes

- The package move regenerates `pnpm-lock.yaml`; it must be committed or CI's `--frozen-lockfile` install fails.
- Phase ordering guarantees `main`'s gate is never broken mid-change: Phase 1 keeps the old workflow working (name-based filter), Phase 2 adds the unused action, Phase 3 switches and verifies.
- No production deploy implications (this is CI tooling, not the Astro Worker).

## References

- Change identity + validated decisions: `context/changes/code-review-reusable-action/change.md`
- Prior orchestration plan: `context/changes/code-review-in-cicd/plan.md`; live-verify runbook: `context/changes/code-review-in-cicd/setup.md`
- Engine origin: `context/changes/package-code-review/`
- Key code: `.github/scripts/code-review/src/apply.ts:205,212-213,285` (status/finalState), `:129-134` (CoreApi), `src/plan.ts:60-70,129-163` (PostPlan/buildPostPlan), `.github/workflows/code-review.yml:54-113` (steps to collapse)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Co-locate the orchestration package

#### Automated

- [x] 1.1 Orchestration tests pass: `pnpm --filter @snapchef/code-review-ci test` — 90a9c0fc1
- [x] 1.2 Orchestration typecheck passes: `pnpm --filter @snapchef/code-review-ci typecheck` — 90a9c0fc1
- [x] 1.3 Engine unaffected: `pnpm --filter code-review test` and typecheck — 90a9c0fc1
- [x] 1.4 Root lint passes: `pnpm lint` — 90a9c0fc1
- [x] 1.5 Lockfile stable + committed: a second `pnpm install` leaves `pnpm-lock.yaml` with no diff — 90a9c0fc1
- [x] 1.6 No stray config refs: `git grep -n ".github/scripts/code-review"` clean in workspace/eslint/workflows — 90a9c0fc1

#### Manual

- [x] 1.7 `packages/code-review-ci/` has `src/` + `__fixtures__/`; old path gone — 90a9c0fc1

### Phase 2: Action contract + composite action

#### Automated

- [x] 2.1 Orchestration tests pass incl. verdict/status-context/output assertions — 457b6d760
- [x] 2.2 Orchestration typecheck passes (`CoreApi.setOutput`, `PostPlan.verdict`) — 457b6d760
- [x] 2.3 Root lint passes: `pnpm lint` — 457b6d760
- [x] 2.4 `action.yml` is valid YAML — 457b6d760
- [x] 2.5 `actionlint` over `.github/workflows/` stays green — 457b6d760

#### Manual

- [x] 2.6 `action.yml` read against contract (inputs/outputs, `shell: bash`, `id:`s, `if:` conditions, apply env) — 457b6d760
- [x] 2.7 `README.md` documents inputs/outputs/usage/PR-only scope/extraction checklist — 457b6d760

### Phase 3: Thin the workflow + live verification

#### Automated

- [x] 3.1 `actionlint .github/workflows/code-review.yml` passes
- [x] 3.2 `code-review.yml` is valid YAML
- [x] 3.3 Root lint passes: `pnpm lint`

#### Manual

- [ ] 3.4 Test PR: action posts inline + sticky review; `code-review/gate` status matches verdict
- [ ] 3.5 `cr:revalidate` re-runs without duplicating inline comments; sticky updated in place
- [ ] 3.6 Run log shows `verdict` + `gate-state` outputs populated
