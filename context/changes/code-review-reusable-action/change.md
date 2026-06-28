---
change_id: code-review-reusable-action
title: Reusable composite Action wrapping the code-review engine + orchestration
status: implementing
created: 2026-06-28
updated: 2026-06-28
archived_at: null
---

## Notes

Add a composition layer that exposes the existing code-review engine + GitHub
orchestration as a single reusable composite GitHub Action (`uses:`-able from any
workflow in this repo), keeping the engine platform-agnostic and preparing the
artifacts for future extraction into a published action.

### Accepted architecture (validated 2026-06-28)

**Principle — composition, not coupling.** Keep the review engine separate from the
GitHub mechanics; add a thin third layer on top rather than merging the two modules.
Maps onto the repo's hexagonal conventions: engine = core, orchestration = adapter,
`action.yml` = composition root.

**Three layers:**

1. **Engine** — `packages/code-review` (`code-review`). UNCHANGED. Diff → validated
   `Review` JSON. Stays GitHub-free and terminal-runnable.
2. **Orchestration** — `@snapchef/code-review-ci`. Logic UNCHANGED. `Review` JSON →
   inline comments + sticky summary + fail-closed `code-review/gate` status. The
   GitHub adapter (`diff.ts` / `plan.ts` / `index.ts` / `apply.ts`).
3. **Composition (NEW)** — a **composite `action.yml`** that wires 1 → 2 and is the
   only thing consuming workflows touch.

**Decision 1 — Layout: co-locate under `packages/` (accepted).** Move
`.github/scripts/code-review` → `packages/code-review-ci`; add
`packages/code-review-action/` (`action.yml` + `README.md`). Drop the explicit
`".github/scripts/code-review"` line from `pnpm-workspace.yaml` (now matched by
`packages/*`). Package **names** are unchanged, so all `pnpm --filter` commands keep
working — only directories move. Future extraction then becomes a single directory move.

**Decision 2 — Action self-containment: turnkey (accepted).** The action owns
toolchain setup (`jdx/mise-action@v4`, node 24 + pnpm 11.6.0), `pnpm install
--frozen-lockfile`, and diff computation (`git diff origin/<base>...HEAD`, with an
optional `diff-file` override). The caller only checks out the repo + passes secrets.

**Action contract (stable public surface):**

- Inputs: `anthropic-api-key` (req), `github-token` (default `${{ github.token }}`),
  `model` (default `claude-sonnet-4-6`), `base-ref` (default `${{ github.base_ref }}`),
  `max-inline` (default `30`), `diff-file` (optional override),
  `status-context` (default `code-review/gate` — needs a small `apply.ts` env tweak so
  multiple configs don't collide).
- Outputs: `verdict`, `gate-state`, `review-json-path`.
- Internal steps preserve behavior exactly, fail-closed intact: setup → install →
  diff (set `empty`) → run engine (`set +e`, capture exit code, guard
  `empty=='false'`) → build plan (guard `empty=='false' && code=='0'`) → apply
  (`if: always()`, always posts the gate status on empty/infra/IO-error branches).

**Workflow refactor.** `.github/workflows/code-review.yml` keeps only POLICY
(triggers, `concurrency`, `permissions`, fork/event gate decision, secrets, checkout)
and delegates CAPABILITY to `uses: ./packages/code-review-action`.

**Future-extraction readiness.** The forward-compatible artifact is `action.yml`'s
input/output contract. Extraction later changes only `runs:` (composite → `node20` +
bundled `dist/index.js`); inputs/outputs stay identical → zero consumer churn. Deferred
extraction checklist (document in plan): new repo → add bundler (ncc/esbuild) → flip
`runs:` → vendor deps → semver tag → consumers switch `./packages/code-review-action`
→ `org/code-review-action@v1`.

### Scope

**In scope now:** composite `action.yml`; co-location move (orchestration →
`packages/code-review-ci`, new `packages/code-review-action/`); workflow refactor to
consume the action; small `status-context` env tweak in `apply.ts`; action `README.md`
(contract + usage + extraction notes); `pnpm-workspace.yaml` update.

**Deferred:** separate repo; bundling / Node-action conversion; external
publishing/versioning; cross-repo consumption; any new triggers or behavior changes.

**Unchanged:** engine review logic & prompt; orchestration logic; existing unit tests;
the `Review` JSON wire contract; fail-closed gate semantics; triggers/permissions/
concurrency.
