<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Centralized State Machine & Transition Aspect for Recipe Sessions

- **Plan**: `context/changes/recepie-session-state-machine/plan.md`
- **Mode**: Deep
- **Date**: 2026-06-23
- **Verdict**: REVISE → **SOUND after fixes** (all 3 findings triaged & applied)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension             | Verdict               | After fixes |
| --------------------- | --------------------- | ----------- |
| End-State Alignment   | PASS                  | PASS        |
| Lean Execution        | WARNING (F1)          | PASS        |
| Architectural Fitness | PASS                  | PASS        |
| Blind Spots           | PASS (F3 observation) | PASS        |
| Plan Completeness     | WARNING (F2)          | PASS        |

## Grounding

10/10 paths ✓ · blast radius confirmed (1 prod caller · 3 test fakes · no e2e fakes) ✓ · brief↔plan ✓ · Progress↔Phase ✓ · contract-surfaces.md absent (skipped). Deep verification confirmed all 5 risky claims: save's 409 flows through `runApiRoute`'s code-based mapper; `find` is owner-scoped (`.eq id .eq user_id`); `RecognitionResult`/`RecipeGenerationResult` shapes match; current write-sequencing is as described; no existing FSM to reuse.

## Findings

### F1 — UC test strategy under-committed; collides with the FSM guard

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Phase 4 — Change #4 (Migrate + extend UC tests)
- **Detail**: Phase 4 #4 offered two test approaches without committing. With the real manager, `baseSession` (state `products_recognized`, test `:31`) is illegal for `save`, so the `saveSession` tests (`:189`/`:212`) would 409; and recognize/attach coverage needs pipeline fakes the aspect test already covers generically.
- **Fix A ⭐**: Commit to a fake `SessionStateManager` for UC tests; reducer+aspect tests own guard coverage.
- **Fix B**: Keep the real manager; add per-test legal from-state fixtures + recognize/attach pipeline fakes.
- **Decision**: FIXED via Fix B — Phase 4 #4 now commits to the real `createSessionStateManager(fakeSessionRepo)`, names the `saveSession` fixture switch (→ `recipe_generated`/`saved`), and calls out the photo/recognizer/storage pipeline fakes.

### F2 — `toRecipeSessionUpdate` state-mapping edit not named

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 — Change #3 (Enforcement seal)
- **Detail**: `toRecipeSessionUpdate` (`RecipeSessionRepository.ts:40-51`) maps `["state", data.state]`; dropping `state` from `RecipeSessionUpdatePayload` makes `data.state` a type error there. The plan said "no longer receives state" but didn't name the concrete edit.
- **Fix**: Add the explicit "remove `["state", data.state]` from `toRecipeSessionUpdate`" step to Phase 4 #3.
- **Decision**: FIXED — Phase 4 #3 Contract now names the exact deletion.

### F3 — Status-code delta for out-of-order calls is incompletely recorded

- **Severity**: 🔎 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Desired End State / Migration Notes
- **Detail**: The plan flags save tightening but not the broader delta — `recognizeProducts` from `created` was 422 (`guardHasPhotos`), now 409 (state guard). UX is unaffected (clients show `error.message`; wizard calls in order).
- **Fix**: Add a one-line "uniform 409 for out-of-order calls" note to Migration Notes.
- **Decision**: FIXED — Migration Notes now records the uniform-409 delta and that `guardHasPhotos` (422) still fires for the legal-but-empty recognize case.
