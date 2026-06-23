# Centralized State Machine & Transition Aspect for Recipe Sessions — Plan Brief

> Full plan: `context/changes/recepie-session-state-machine/plan.md`

## What & Why

`RecipeSession` has a `state` enum but no state machine — every transition in `RecipeSessionUC` is an unguarded side effect that hardcodes the next state, so the API lets callers skip steps (`created → recipe_generated`, `photos_uploaded → saved`). This adds an event-driven FSM reducer and a transition **aspect** that becomes the sole writer of `state`, guarding legality before any side effect.

## Starting Point

Five states (`created → photos_uploaded → products_recognized → recipe_generated → saved`) written ad hoc via `sessionRepository.update(..., { state })` in four UC methods. Several steps are deliberately re-runnable, and the only existing guard (`guardHasPhotos`) checks data, not state. The four API routes are thin and the existing UC test suite asserts state via the `update` payload.

## Desired End State

A pure `nextState(event)(from)` reducer rejects illegal `(state, event)` pairs with 409; a `SessionStateManager.run(event, …, action)` aspect loads → guards → runs the business action → writes the derived state as its closing step. UC business code does data-only writes and never names a state, enforced at compile time by removing `state` from the write payload. Out-of-order calls return 409; the wizard happy path and all current re-runs still work.

## Key Decisions Made

| Decision                 | Choice                                                                                    | Why (1 sentence)                                                                                     | Source |
| ------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------ |
| Guard mechanism          | Event-driven ts-pattern reducer (Approach B)                                              | UC dispatches events; the reducer derives + validates the target, killing the skip bug structurally. | Frame  |
| State-write ownership    | A transition aspect is the sole `state` writer                                            | Centralizes load→guard→work→close; business logic stops touching state.                              | Frame  |
| `saveSession`            | Tighten — legal only from `recipe_generated`/`saved`                                      | Closes the `photos_uploaded → saved` skip; happy path stays legal.                                   | Plan   |
| Illegal-transition error | `SnapchefConflictError` (409)                                                             | Semantically precise (state conflict); no mapper change needed.                                      | Plan   |
| Backward navigation      | Re-edit freely until `saved`; `saved` is terminal                                         | Preserves current re-runnability, blocks only true skips, makes `saved` a real endpoint.             | Plan   |
| Concurrency              | Defer CAS — `transition(userId, sessionId, to)`                                           | Single-user sessions; can add `from`-check later without an API change.                              | Plan   |
| State writer seam        | New `RecipeSessionRepository.transition` + drop `state` from `RecipeSessionUpdatePayload` | Compile-enforces "only the aspect writes state".                                                     | Frame  |
| Manager wiring           | Injected via middleware (not built in the constructor)                                    | Keeps the dependency external for test substitution.                                                 | Plan   |

## Scope

**In scope:** FSM reducer (+test); `transition` port method + adapter impl; transition aspect (+test); inject the manager via middleware; refactor of `attachPhotos`/`recognizeProducts`/`generateRecipe`/`saveSession`; drop `state` from the write payload; migrate + extend UC tests.

**Out of scope:** route changes (none needed); optimistic-concurrency CAS; DB trigger/migration; `deleteSession`; read methods (`getSavedRecipe`/`listSavedRecipes`).

## Architecture / Approach

Hexagonal, inside-out. Pure reducer lives in `core/model/recipe`; the aspect in `core/uc/recipe`, **injected by `src/middleware.ts`** (the composition root) into the UC from the same repository instance — keeping the dependency external and test-substitutable; the state-write seam is a new `transition` on the existing repository port + adapter. The aspect's pipeline: `find → getOrThrowNotFound → nextState(event) (GUARD) → action(session) (WORK) → transition(to) (CLOSE) → { result, session }`.

## Phases at a Glance

| Phase                             | What it delivers                                                                                              | Key risk                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1. FSM reducer                    | `RecipeSessionEvent` + `nextState` (+test)                                                                    | Edge set must exactly match the agreed graph                                                     |
| 2. Repository `transition` seam   | Port method + adapter impl + fakes updated                                                                    | Widening the port breaks fakes until updated                                                     |
| 3. Transition aspect              | `createSessionStateManager`/`run` (+test)                                                                     | Guard-before-side-effects must be proven by test                                                 |
| 4. UC refactor + enforcement seal | Methods routed through aspect (manager injected via middleware); `state` dropped from payload; tests migrated | Test-assertion migration (state now via `transitionCalls`); save tightening is a behavior change |

**Prerequisites:** worktree set up (`mise run worktree-setup`); fake-LLM flag for E2E.
**Estimated effort:** ~1–2 sessions across 4 phases; each phase ends with a green build.

## Open Risks & Assumptions

- Save tightening changes behavior (out-of-order save → 409 instead of silent success) — intended; existing E2E happy path is unaffected.
- The `.otherwise → fail` reducer loses compile-time totality over the (state × event) matrix — accepted trade-off of Approach B; the reducer test covers the matrix instead.
- Dropping `state` from the payload must be the last Phase-4 edit to keep intermediate builds green.

## Success Criteria (Summary)

- Out-of-order recipe-session calls return 409; the wizard happy path and all current re-runs still work.
- `state` is written in exactly one place (the aspect's `transition`), proven by a green build after the payload field is removed.
- Unit suite (reducer, aspect, migrated UC tests) and E2E smoke pass.
