<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Recipe Generation from List

- **Plan**: `context/changes/recipe-generation-from-list/plan.md`
- **Mode**: Deep
- **Date**: 2026-06-16
- **Verdict**: REVISE → SOUND (all findings fixed)
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension             | Verdict                     |
| --------------------- | --------------------------- |
| End-State Alignment   | PASS                        |
| Lean Execution        | PASS                        |
| Architectural Fitness | PASS                        |
| Blind Spots           | WARNING (F3, F4) → resolved |
| Plan Completeness     | WARNING (F1, F2) → resolved |

## Grounding

11/11 paths ✓, 5/5 symbols ✓ (`parseRequestBody`, `tryErrorDataWithSchema`, `getOrThrowNotFound`, SDK `finishReason`/`refusal`/`temperature`/`maxTokens`), `recipes` RLS (INSERT+UPDATE) + drift-guard trigger (`before insert or update`) ✓ → upsert sound, brief↔plan ✓. Progress↔Phase consistency ✓ (one `## Progress`, all four phases mirrored, every Success Criteria bullet has a matching `- [ ]`).

## Findings

### F1 — LLM-adapter test setup is underestimated

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §5 (openrouter.test.ts) + §1 (env vars)
- **Detail**: The cited "SupabaseAuthenticator mock style" doesn't transfer — that adapter is constructor-injected, while the OpenRouter client is built at module scope behind an env-gated Effect (`const client = Effect.fromNullable(OPENROUTER_API_KEY)…new OpenRouter(...)`). The test env stub (`src/test/astro-env-server.stub.ts`, aliased to `astro:env/server` in `vitest.config.ts`) sets `OPENROUTER_API_KEY = undefined` (so `completeStructured` fails before the SDK is called) and lacks the new recipe model vars. The test needs `vi.mock("@openrouter/sdk")` + a present key, not a fake object.
- **Fix**: Expanded Phase 2 §5 with concrete setup (test-local `vi.mock("astro:env/server", …)` supplying a key + recipe vars; `vi.mock("@openrouter/sdk")` for canned `ChatResult`s; mock-before-import note) and added the env-stub update to Phase 2 §1. Dropped the SupabaseAuthenticator reference.
- **Decision**: FIXED (Fix in plan)

### F2 — finish_reason field name/type is imprecise

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Critical Implementation Details + Phase 2 §2
- **Detail**: The guard read `result.choices[0].finish_reason === "length"`, but the SDK exposes `ChatChoice.finishReason: ChatFinishReasonEnum | null` (camelCase; wire `finish_reason` mapped to `finishReason`). As written it won't type-check and the string compare may miss the enum.
- **Fix**: Corrected both locations to `result.choices[0]?.finishReason`, noted the `ChatFinishReasonEnum | null` type, and flagged verifying the length member's value at impl time.
- **Decision**: FIXED (Fix in plan)

### F3 — Worst-case latency (~60s) contradicts the "caps under 30s" claim

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §3 + Performance Considerations
- **Detail**: `Effect.timeout("30 seconds")` + `Effect.retry({ times: 1 })` yields ~60s worst case, but the Performance section claimed it "caps the worst case" under the ~30s NFR and the spinner promises "do 30 s." The NFR governs normal conditions (happy path = seconds), so it's defensible and consistent with recognition (25s + retry ≈ 50s), but the wording over-promised on the retry path.
- **Fix**: Reworded Performance Considerations — happy path is what the NFR targets; added an explicit retry-path caveat (worst case ≈ 2× per-attempt timeout, abnormal path, spinner copy under-promises, revisit if retries prove common). Timeout/retry config left as-is (consistent with recognition).
- **Decision**: FIXED (Soften the wording)

### F4 — Prompt doesn't forbid repeating the dish name in `content`

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §3 (prompt) + Phase 4 §5 (RecipeDisplay)
- **Detail**: `RecipeDisplay` renders `recipe.name` as a heading AND the `contentMd` body. The prompt skeleton didn't tell the model to keep the dish title out of `content`, so the name could appear twice on screen.
- **Fix**: Added a system-prompt rule to Phase 2 §3 — the dish name belongs only in `name`; `content` must start at `## Składniki` and must not repeat the title.
- **Decision**: FIXED (Fix in plan)
