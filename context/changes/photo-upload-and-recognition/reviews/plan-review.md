<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Photo Upload & Product Recognition (S-01) — Round 2 (conventions re-validation)

- **Plan**: `context/changes/photo-upload-and-recognition/plan.md`
- **Mode**: Deep — re-review against `docs/reference/conventions/use-cases.md` (landed 8f8f85a53, after the plan's first draft)
- **Date**: 2026-06-06
- **Verdict**: REVISE → **SOUND after fixes** (all 3 findings fixed in plan)
- **Findings**: 1 critical, 1 warning, 1 observation
- **Prior round** (same date, superseded): 5 findings (F1 create-then-upload schema conflict, F2 uniform session object, F3 preview URLs, F4 Workers can't resize, F5 in-memory-doc edits) — all FIXED and folded into the plan's Decision Log rows 3, 9, 10 and Phase 1 #4.

## Verdicts

| Dimension             | Verdict         |
| --------------------- | --------------- |
| End-State Alignment   | PASS            |
| Lean Execution        | PASS            |
| Architectural Fitness | FAIL → fixed    |
| Blind Spots           | PASS            |
| Plan Completeness     | WARNING → fixed |

## Grounding

6/6 paths ✓ (`src/middleware.ts`, `src/env.d.ts`, `src/lib/core/uc/auth/AuthenticatorUC.ts`, `src/pages/api/auth/signin.ts`, `src/lib/infrastructure/api/index.ts`, `src/components/api/http.ts`), 4/4 symbols ✓ (`injectDependencies`, `App.Locals.authenticator`, `runApiRoute`, `decodeWith` — found in `src/lib/utils/index.ts:5`, not `infrastructure/api`), brief↔plan ✓, Progress↔Phase contract ✓. Phase 1 landed (5e1e713ea) and is unaffected — re-review scope is Phases 2–5; Phases 4–5 (client) already comply with `api-client.md`.

## Findings

### F1 — Phases 2–3 inline business logic in routes; no UC layer

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff settled by convention; wide but mechanical edit
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 #3/#4 (create/upload routes), Phase 3 #3 (recognition route)
- **Detail**: All three route contracts put the full domain pipeline (session load → state guard → storage → row update → signed URLs; fan-out/merge/persist) in the handlers. The now-binding `use-cases.md` requires this logic in a `core/uc` class consumed from `context.locals`, wired in `src/middleware.ts` and declared on `App.Locals` — none of which the plan mentioned ("all three in the same change" rule).
- **Fix**: Add `RecipeSessionUC` (`core/uc/recipe-session/RecipeSessionUC.ts`) with `createSession` / `attachPhotos` (Phase 2) and `recognizeProducts` (Phase 3); constructor DI (`SupabaseClient` + recognition port, types only); routes rewritten as thin `signin.ts`-style delegates; middleware + `env.d.ts` wiring added to Phase 2, constructor extension in Phase 3.
- **Decision**: FIXED (applied to plan — Decision Log #11, Implementation Approach, Critical Implementation Details "UC layering", Phase 2 #3–#5, Phase 3 #4–#5, References)

### F2 — LLM adapter ↔ core boundary undefined under the new rule

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architectural Fitness
- **Location**: Phase 3 #1 (openrouter.ts), #2 (prompts.ts)
- **Detail**: With orchestration moving into the UC, the LLM capability must be injected — but `core/uc` cannot runtime-import `src/lib/infrastructure/llm`. `AuthenticatorUC` sidesteps this because `SupabaseClient` is an npm-package type; the OpenRouter adapter is our own module, so the plan must define the crossing type and the home of the domain-policy prompts (FR-004, Polish, merge rules).
- **Fix A ⭐ Recommended**: Domain-shaped port in core — `ProductRecognitionService { recognizePhoto(signedUrl); mergeItems(lists) }` in `core/uc/recipe-session/ports.ts`; `infrastructure/llm` implements it (openrouter.ts + prompts.ts stay together behind a `createProductRecognitionService()` factory); middleware injects.
  - Strength: Small, domain-typed, trivially mockable port; prompts + transport cohere in one infra module; minimal plan churn; mirrors how `SupabaseClient` enters `AuthenticatorUC` as a type-only contract.
  - Tradeoff: FR-004 prompt wording lives in infra — core keeps the orchestration policy (fan-out, timeout, partial failure, merge-skip).
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Fix B**: Generic completion port (`completeStructured(messages, schema)`); prompt builders move into `core/uc/recipe-session/`.
  - Strength: All domain policy incl. prompt rules in core.
  - Tradeoff: Vendor message shapes (`image_url` content parts) leak into the framework-free layer; port harder to mock meaningfully.
  - Confidence: MEDIUM.
  - Blind spot: S-02 reuse of the generic shape unsurveyed.
- **Decision**: FIXED via Fix A (applied to plan — Phase 3 #1 new ports.ts item, #2 adapter implements port, #3 prompts intent note, #4 UC orchestration + middleware extension)

### F3 — Stale symbol location: `decodeWith` moved to `@/lib/utils`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Current State Analysis, Phase 2 #2
- **Detail**: Plan placed `decodeWith` in `src/lib/infrastructure/api/index.ts`; since 8f8f85a53 it is exported from `src/lib/utils/index.ts` (infrastructure/api imports it from there).
- **Fix**: Both plan references updated to `@/lib/utils`.
- **Decision**: FIXED (applied to plan)
