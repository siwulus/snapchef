<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Saved Recipes Readback (S-04)

- **Plan**: `context/changes/saved-recipes-readback/plan.md`
- **Scope**: Phases 1–2 of 2 (full plan)
- **Date**: 2026-06-17
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension           | Verdict                          |
| ------------------- | -------------------------------- |
| Plan Adherence      | PASS                             |
| Scope Discipline    | PASS                             |
| Safety & Quality    | PASS                             |
| Architecture        | PASS                             |
| Pattern Consistency | PASS                             |
| Success Criteria    | PASS (automated; manual pending) |

## Evidence

- **Drift**: all 20 planned changes MATCH. No DRIFT, no MISSING. Only EXTRA is `src/components/recipes/list/RecipeCard.astro`, which the plan explicitly sanctioned as optional (plan §9). The `RecipeView` construction uses a structural omit of `userId` — an option the plan offered (plan Phase 2 §3).
- **Safety & quality**: per-user isolation enforced in depth (adapter `.eq("user_id", …)` + RLS `auth.uid() = user_id` + `recipes_user_id_drift_guard`); client projections (`SavedRecipeListItem`, `RecipeGalleryPhoto`, `RecipeView`) exclude storage internals + owner id; `react-markdown` XSS-safe by default; both `.astro` pages auth-gate via `Astro.locals.user` and degrade gracefully at the `runWithLogging` + `Effect.match` edge; delete reuses the existing hard-delete route (no new destructive SQL). List query is one indexed join; detail is 3 correctly-sequenced reads gated early.
- **Success criteria**: `pnpm lint` ✓, `pnpm test` ✓ (70 passed), `pnpm build` ✓ (green after the Phase 2 commit; no code change since). Manual rows (1.4–1.9, 2.4–2.8) are honestly `[ ]` → pending, not rubber-stamped.

## Findings

### F1 — Cross-direction type import in ports.ts lacks a clarifying note

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/core/boundry/recipe/ports.ts:6
- **Detail**: The driven-side port imports the driving-side `SavedRecipeListItem` from `./responses` so `RecipeRepository.listSaved` can return the client projection. Type-only, same-folder, non-cyclic, and exactly what the plan prescribed — but a one-line comment prevents a future reader from misreading it as a layering slip.
- **Fix**: Add a short comment above the import noting the intentional type-only cross-direction reference.
- **Decision**: FIXED (added `// Type-only, same-folder reference: the list-read port returns the driving-side client projection.` above the import).

### F2 — useDeleteRecipe reimplements useRecipeFinalize's edge chain inline

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/hooks/useDeleteRecipe.ts:24-55
- **Detail**: `useRecipeFinalize` factored its pipeline into a shared `run(...)` helper; `useDeleteRecipe` inlines the same set-busy → request → `match(ok/!ok)` → `catchAll` chain. Minor duplication, acceptable for a single-action hook; extracting a shared helper for two call sites with different state shapes would be premature.
- **Fix**: None recommended — leave as-is; revisit only if a third delete surface appears.
- **Decision**: SKIPPED (accepted as-is).
