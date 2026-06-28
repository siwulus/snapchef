# Reusable Composite Code-Review Action — Plan Brief

> Full plan: `context/changes/code-review-reusable-action/plan.md`

## What & Why

Expose the existing code-review **engine** and **GitHub orchestration** as one `uses:`-able composite GitHub Action that reviews a PR and applies the result (inline comments + sticky summary + fail-closed merge gate). The goal is composition, not coupling — a thin action layer on top of the two modules, so any workflow in this repo can run the gate in one step, and a future extraction into a published action is a directory move rather than a rewrite.

## Starting Point

Today the pipeline is spelled out inline in `.github/workflows/code-review.yml` (`:54-113`): toolchain → install → diff → run engine → build plan → apply. The engine (`packages/code-review`) and orchestration (`@snapchef/code-review-ci`, currently at `.github/scripts/code-review`) are already decoupled by a `Review` JSON wire contract and unit-tested; only the GitHub-I/O/YAML layer is verified live. This builds on the in-progress `code-review-in-cicd` work (its `apply.ts` is uncommitted on `feat/code-review-in-cicd`).

## Desired End State

`packages/` holds three siblings — `code-review` (engine, unchanged), `code-review-ci` (orchestration, moved + lightly extended), `code-review-action` (the composite `action.yml` + README). A workflow runs the whole gate with a single `uses: ./packages/code-review-action` step; `code-review.yml` keeps only policy (triggers, permissions, concurrency, fork/event gate, checkout). Behavior on every branch (success / empty / infra failure / I/O error) is identical to today, plus a configurable status context and `verdict`/`gate-state` outputs.

## Key Decisions Made

| Decision                   | Choice                                                           | Why (1 sentence)                                                                 | Source |
| -------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------ |
| Engine vs GitHub mechanics | Keep separate; add a 3rd composition layer                       | Composition ≠ coupling; engine stays platform-agnostic and reusable              | Change |
| Layout                     | Co-locate all three under `packages/`                            | Future extraction becomes a single directory move                                | Change |
| Action self-containment    | Turnkey (action owns toolchain + install + diff)                 | Caller only checks out + passes secrets — a genuinely simple action              | Change |
| Status context             | Configurable `status-context` input (default `code-review/gate`) | Lets two review configs coexist in one repo without clobbering each other's gate | Plan   |
| Action outputs             | Add `verdict` + `gate-state` (emitted from `apply.ts`)           | Completes the action contract; turnkey for future consumers                      | Plan   |
| Live verification          | Targeted re-verify on one test PR                                | Underlying behavior already live-verified (PR #19); only the wrapper is new      | Plan   |

## Scope

**In scope:** move orchestration → `packages/code-review-ci`; extend it (`PostPlan.verdict`, configurable `STATUS_CONTEXT`, `verdict`/`gate-state` outputs) with tests; author `packages/code-review-action/action.yml` + README (with extraction checklist); thin `code-review.yml` to consume it; update `pnpm-workspace.yaml`/`eslint.config.js`/lockfile/`setup.md`.

**Out of scope:** separate repo, bundling/Node-action conversion, external publishing/versioning, cross-repo consumption, new triggers, fork-PR support, non-`pull_request` events, any engine/orchestration logic change.

## Architecture / Approach

Three layers: **engine** (diff → `Review`, platform-agnostic) → **orchestration** (`Review` → PR effects + fail-closed gate, the GitHub adapter) → **composite `action.yml`** (the composition root that wires the two and is the only thing workflows touch). The `action.yml` input/output contract is the forward-compatible artifact: on extraction only `runs:` changes (composite → `node20` + bundled `dist`), inputs/outputs stay identical → zero consumer churn.

## Phases at a Glance

| Phase                     | What it delivers                                                                 | Key risk                                                                              |
| ------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1. Co-locate package      | Orchestration moved to `packages/code-review-ci`; wiring + lockfile updated      | Un-regenerated lockfile breaks CI's `--frozen-lockfile` install                       |
| 2. Contract + action      | `PostPlan.verdict`, configurable status, outputs (tested); `action.yml` + README | Composite-action mechanics (`shell:`, `id:`, `if: always()`) only fully testable live |
| 3. Thin workflow + verify | `code-review.yml` consumes the action; targeted live verification                | Live GitHub I/O behavior; needs a throwaway PR + the `ANTHROPIC_API_KEY` secret       |

**Prerequisites:** in-progress `code-review-in-cicd` files committed (incl. `apply.ts`); `ANTHROPIC_API_KEY` repo secret (already set); ability to open a test PR to `main`.
**Estimated effort:** ~2-3 sessions across 3 phases; Phase 3 gated on a live PR run.

## Open Risks & Assumptions

- Phase ordering keeps `main`'s gate working throughout (name-based `--filter` survives the move; the action is unused until Phase 3) — assumes the package **name** is not changed.
- `pull_request` runs the workflow from the PR head, so the new action + workflow are exercised on the verification PR itself (no merge-to-main needed to test).
- If toolchain/install fails inside the action, the apply step can't post a status → branch protection blocks merge via the _missing required status_ (same fail-closed property as today, different mechanism).
- Assumes work continues on / branches from `feat/code-review-in-cicd`, since this depends on its uncommitted files.

## Success Criteria (Summary)

- A workflow runs the full gate via one `uses: ./packages/code-review-action` step, behavior unchanged from today.
- All unit tests + lint + typecheck green; `actionlint` clean; lockfile stable.
- Live PR: review posts inline + sticky, `code-review/gate` status matches the verdict, `cr:revalidate` re-runs without duplicates, and `verdict`/`gate-state` outputs are populated.
