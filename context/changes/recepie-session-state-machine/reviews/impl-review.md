<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Centralized State Machine & Transition Aspect for Recipe Sessions

- **Plan**: context/changes/recepie-session-state-machine/plan.md
- **Scope**: All phases (1–4 of 4, all complete)
- **Date**: 2026-06-23
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Evidence

- **Plan Adherence** — all 9 changed source files match the plan's file list exactly; nothing planned-but-missing, no unplanned source files. Reducer encodes the 11 legal edges via `match` + `P.union` + `.otherwise → SnapchefConflictError` (20 passing table cases); aspect signature is the exact load→guard→work→close pipeline; the four UC methods route through `this.sessions.run`; `markPhotosUploaded` + `persistRecognizedItems` removed; inline `{state:"recipe_generated"}` and `{state:"saved"}` writes removed.
- **Scope Discipline** — `git diff` confirms: `src/pages/api/**` untouched (no route changes), `src/env.d.ts` untouched (App.Locals unchanged), no `supabase/migrations/**` (no migration), `transition` has no `from` predicate (no CAS), `deleteSession`/`getSavedRecipe`/`listSavedRecipes` unchanged.
- **Safety & Quality** — enforcement seal is compile-enforced: `state` removed from `RecipeSessionUpdatePayload` and from `toRecipeSessionUpdate`; the only `state` writes left are the list _filter_ (`RecipeSessionUC.ts:167`) and the sole writer `transition` (`RecipeSessionRepository.ts:84`), which is owner-scoped (`.eq("id").eq("user_id")`). Guard precedes side effects (asserted by the aspect test); state advances only on action success. No `throw`/`await` inside Effect logic.
- **Architecture** — the aspect lives in `core/uc` and imports only types from `core/boundry`, the reducer from `core/model`, and `getOrThrowNotFound` from `utils`; no `infrastructure/**` runtime imports. Hexagonal direction respected.
- **Pattern Consistency** — Effect pipe-first throughout; ts-pattern `match`+`P.union` in the reducer; zod same-name (`RecipeSessionEvent`); `transition` adapter mirrors `update`/`find` (curried factory, `transposeMapOption(decodeWith(RecipeSessionFromRow))`, `maybeSingle`); test files mirror the `Effect.runPromise(Effect.either(...))` + hand-rolled-fake style. `recipe-session-transition.ts` / `recipe-session-state-machine.ts` correctly kebab-case (factory/reducer modules, not class or core/boundry-port-implementing files).
- **Success Criteria** — `pnpm lint` clean; `pnpm test` 106/106; `pnpm build` succeeds; `pnpm test:e2e` 6/6 (incl. the critical recipe flow). All Automated + Manual Progress rows checked with the Phase-4 SHA.

## Findings

### F1 — Inner data-writes no longer assert session presence (the aspect's find + close cover it)

- **Severity**: 🟦 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/core/uc/recipe/RecipeSessionUC.ts (generateRecipe provenance `update`; recognizeProducts `update({ recognizedItems })`)
- **Detail**: The data-only `update` calls inside the `generate_recipe` and `recognize_products` actions discard their `Option<RecipeSession>` result (previously `persistRecognizedItems` and the provenance write unwrapped it via `getOrThrowNotFound`). If a session row were deleted between the aspect's `find` (load) and the inner `update`, the write would silently no-op and the not-found would now surface at the closing `transition` (which returns `None` → `SnapchefNotFoundError`) instead of at the inner write. This is a sound, intentional consequence of the aspect owning load + close — no data loss, no behavior regression for the normal flow, and a single not-found point is arguably cleaner. Noted only so a future reader understands the not-found timing.
- **Fix**: None required — accept as designed. (If stricter fail-fast on the inner write were ever wanted, unwrap the inner `update` with `getOrThrowNotFound` — but it duplicates the close's guarantee.)
- **Decision**: ACCEPTED — intentional design (the aspect's find + close own the not-found guarantee); no code change.
