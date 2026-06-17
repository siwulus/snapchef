<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Saved Recipes Readback (S-04)

- **Plan**: `context/changes/saved-recipes-readback/plan.md`
- **Mode**: Deep
- **Date**: 2026-06-17
- **Verdict**: REVISE → SOUND after fixes
- **Findings**: 0 critical, 2 warnings, 0 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | WARNING |
| Blind Spots           | WARNING |
| Plan Completeness     | PASS    |

## Grounding

9/9 existing paths ✓, 5/5 new paths absent ✓, symbols ✓ (`transposeMapOption`, `tryErrorDataWithSchema`, http verbs incl. `get`/`delete_`, `useApiClient.del`), brief↔plan ✓, Progress well-formed ✓. Blast radius clean: the save-route redirect change does not break `RecipeDisplay.test.tsx` (it mocks the redirect payload, not the server value); adding `RecipeRepository` methods forces the `makeRecipeRepo` double update the plan already calls out. Key precedent surfaced: `src/pages/auth/confirm.astro:15-29` already runs a UC Effect at the Astro page edge via `runWithLogging` + `Effect.match`.

## Findings

### F1 — runPageQuery duplicates the existing confirm.astro page edge

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 §6 (runPageQuery); Current State Analysis; brief
- **Detail**: The plan framed the SSR page edge as a new pattern and added an exported `runPageQuery` + `PageResult` to `infrastructure/api`. But `confirm.astro:15-29` already runs a UC Effect at the page edge (`runWithLogging(...pipe(Effect.match({ onFailure, onSuccess })))` → `Astro.redirect`), commented as "this sanctioned page edge." Neither new page consumes the error `PageResult` preserves (list → empty/error, detail → redirect), and `runPageQuery`'s `catchAllDefect` diverges from the precedent (which lets defects → 500). The novelty claim was inaccurate.
- **Fix A ⭐ Recommended**: Drop `runPageQuery` + `PageResult`; use the `confirm.astro` pattern inline (`runWithLogging` + `Effect.match`); correct the framing.
  - Strength: One page-edge pattern, not two; no new infra export; both pages' real needs met. Live precedent at `confirm.astro:15-29`.
  - Tradeoff: Defects reject → Astro 500 (same as confirm.astro today).
  - Confidence: HIGH — confirm.astro is the working, commented template.
  - Blind spot: None significant.
- **Fix B**: Keep `runPageQuery` as the canonical edge AND refactor `confirm.astro` onto it.
  - Strength: Single helper; centralized defect handling; typed error preserved.
  - Tradeoff: Bigger change touching a working auth page; PageResult unused by consumers.
  - Confidence: MED — refactoring the auth page carries regression risk.
  - Blind spot: confirm.astro collapses to a boolean on purpose (generic error card); a naive refactor could leak error detail.
- **Decision**: FIXED via Fix A (dropped `runPageQuery`/`PageResult`; plan §6 repurposed to a "no new helper" decision note; list §9 and detail Phase 2 §6 now use `runWithLogging` + `Effect.match` inline; Overview, Current State Analysis, Key Discoveries, Critical Implementation Details, Implementation Approach, and the brief reframed to cite the `confirm.astro` precedent).

### F2 — List read failure shows the "add your first recipe" empty state

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §9 (list page); 1.6 success criterion
- **Detail**: The list page fell back to `[]` on read failure, then rendered the empty-state CTA when `length === 0`. A user who has recipes but hits a transient DB/RLS error would be told "No recipes yet — add your first recipe." Failure was indistinguishable from a genuinely empty collection.
- **Fix**: Branch read success vs failure separately from empty vs non-empty — on `!ok` render a distinct error state (short Polish message + reload), reserving the empty-state CTA for a confirmed-empty result.
- **Decision**: FIXED in plan (Phase 1 §9 now a three-way branch: failure → error state, empty → CTA, non-empty → grid; added manual success criterion + Progress item 1.7, renumbered 1.8/1.9).
