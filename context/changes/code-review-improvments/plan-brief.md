# Concern-Structured Reviewer — Plan Brief

> Full plan: `context/changes/code-review-improvments/plan.md`
> Frame brief: `context/changes/code-review-improvments/frame.md`

## What & Why

The AI reviewer in `packages/code-review` reads shallow **not because it is "one prompt"** but because its prompt's concern mandate is incidental and silent — it names only five concern areas and records no per-area coverage, so the model examines an arbitrary subset and emits a verdict that never reveals what it checked. We make the concern mandate explicit and exhaustive, make per-area coverage a first-class field, and derive the verdict from it.

## Starting Point

A single generic prompt returns `summary + findings[] + a model-chosen verdict`. The prompt (`prompt.ts:9–11`) lists only correctness/security/data-loss/error-handling/maintainability — tests, API/contract, and design-fit are never requested. The verdict is opaque (`request_changes → fail`, else pass) with no breakdown. Single-pass and diff-only are deliberate, cost-controlled choices.

## Desired End State

For **every** concern area the reviewer emits a status (`ok | concerns | blocking | not_applicable`) + a one-line rationale, so a PR's sticky comment shows what was examined — not just what was flagged. Coverage of all seven concerns is enforced by the output schema (the model cannot skip one). The verdict is computed from the area statuses and provably tracks them.

## Key Decisions Made

| Decision                            | Choice                                                | Why                                                                                                   | Source     |
| ----------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------- |
| Real problem                        | Mandate + coverage contract, not execution shape      | Root cause is an incidental, silent prompt mandate                                                    | Frame      |
| Concern set                         | Diff-answerable generic 7 (frontend conditional)      | Answerable from the diff; package stays platform-agnostic                                             | Plan       |
| Drop dependency-cruiser cross-check | Yes                                                   | Not installed in this repo                                                                            | Frame      |
| Per-area result shape               | Coarse status + rationale (not 1–10)                  | LLM ordinals are reliable and map cleanly to the verdict; `not_applicable` handles untouched concerns | Plan       |
| Coverage enforcement                | `areas` as object with every concern key **required** | JSON-Schema-enforced at generation, not a post-parse refine                                           | Plan       |
| Verdict                             | Derived in code from area statuses                    | Verdict provably tracks areas; enum/gate/CI untouched                                                 | Plan       |
| Execution + extras                  | Single structured prompt; defer confidence + caps     | Solves observed coverage at 1× cost; preserves cost decision                                          | Frame/Plan |
| Duplicated contract                 | Mirror by hand, guard with boundary test              | Respects the deliberate engine ⊥ orchestration boundary                                               | Frame      |

## Scope

**In scope:** rewrite the system prompt into per-concern sections; add `ConcernArea`/`AreaStatus`/`areas`/`category` to the review object; `ReviewDraft` (model) vs `Review` (derived verdict); `deriveVerdict`; CLI + sticky-comment rendering of area coverage; mirror the CI wire contract; tests + fixtures; README touch-ups.

**Out of scope:** multi-pass calls; per-finding confidence; changing the ~30 inline cap; collapsing the duplicated contract; feeding the reviewer anything beyond the diff; snapchef-specific convention checks; verdict-enum / gate / `apply.ts` / `action.yml` / workflow changes; `dependency-cruiser`.

## Architecture / Approach

Bottom-up. `review.ts` defines the vocabulary, the required-keyed `areas` object, the draft/review split, and the pure `deriveVerdict`. The prompt enumerates one section per concern (mandate + explicit "not responsible for" + forced area entry, no verdict). The engine constrains generation to `ReviewDraft`, derives the verdict, and assembles `Review`. Renderers (CLI + CI sticky) surface the per-area table. The serialized wire shape is additive (`areas` + `category` added; `summary`/`findings`/`verdict` retained), so the gate, action I/O, and workflow are untouched.

## Phases at a Glance

| Phase                                 | What it delivers                                        | Key risk                                                                  |
| ------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1. Domain schema + verdict derivation | `review.ts` types + `deriveVerdict` + tests             | Getting the coverage-enforcement shape (required object keys) right       |
| 2. Concern prompt + engine wiring     | Per-concern prompt; engine emits draft, derives verdict | Prompt quality; the one phase that exercises a model credential           |
| 3. Terminal rendering                 | CLI shows area coverage + finding concerns              | Cosmetic only                                                             |
| 4. CI mirror + PR surfacing           | Sticky shows area coverage; gate intact                 | Forgetting to mirror a field → zod silently drops it (sticky test guards) |

**Prerequisites:** an Anthropic credential for Phase 2 manual checks (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`).
**Estimated effort:** ~1–2 sessions across 4 phases; mostly mechanical once Phase 1's schema lands.

## Open Risks & Assumptions

- **Diff-only ceiling (accepted):** `maintainability`/design-fit and `api_contract`/backwards-compat are only _partially_ answerable from a diff — phrased as diff-answerable questions, results on these stay shallower than a context-aware reviewer would give.
- **Mirror drift:** the wire contract is declared twice; the Phase 4 sticky-render test is the guard against a field being silently stripped.
- **Verdict-rule calibration:** mapping `concerns → comment` (mergeable) vs `blocking → request_changes` assumes the model reserves `blocking` for genuine merge-blockers; watch early outputs.

## Success Criteria (Summary)

- The package's `--json` output always contains a complete 7-key `areas` block, each finding categorized, and a verdict that matches the statuses.
- A PR's sticky comment shows an area-coverage section; the `code-review/gate` still fails closed on `request_changes`.
- All unit/integration tests, typecheck, and lint pass across both packages.
