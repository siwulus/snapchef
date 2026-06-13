<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Photo Upload & Product Recognition (S-01) — Round 3 (re-alignment to live code)

- **Plan**: `context/changes/photo-upload-and-recognition/plan.md`
- **Mode**: Deep — re-review against the codebase after the `hexagonal-architecture-review` refactor (7 commits) + the npm→pnpm migration landed past the plan's 2026-06-10 revalidation.
- **Date**: 2026-06-13
- **Verdict**: REVISE → **all 6 findings FIXED** in this pass (plan + change.md + plan-brief.md aligned to current state)
- **Findings**: 1 critical, 3 warnings, 2 observations
- **Prior round** (2026-06-06, superseded): 3 findings (UC layering, LLM port, `decodeWith` location) — all FIXED at the time. The codebase has since moved again; this round re-aligns the document to it.

## Verdicts

| Dimension             | Verdict         |
| --------------------- | --------------- |
| End-State Alignment   | PASS            |
| Lean Execution        | WARNING → fixed |
| Architectural Fitness | FAIL → fixed    |
| Blind Spots           | PASS            |
| Plan Completeness     | FAIL → fixed    |

Both FAILs were staleness (the plan described a pre-refactor codebase), not design — the approach is sound. This was a mechanical re-alignment pass, not a redesign.

## Grounding

8/8 paths ✓ verified against code (`core/model/error/index.ts`, `core/uc/recipe/RecipeSessionUC.ts`, `core/boundry/recipe/ports.ts`, `core/model/recipe/{index,markdown}.ts`, `infrastructure/api/index.ts`, `infrastructure/db/{SessionPhotoStorage,types/converters}.ts`, `pages/api/recipe-sessions/{index,[id]/upload}.ts`, `middleware.ts`, `env.d.ts`, `docs/reference/conventions/use-cases.md`, `astro.config.mjs`). Ports/UC/routes/machinery cross-checked. brief↔plan ✓. Progress↔Phase ✓.

## What moved under the plan (all after 2026-06-10)

The `hexagonal-architecture-review` refactor renamed the error family to `Snapchef…Error` (numeric `code`), migrated `AuthenticatorUC` to the `Authenticator` port, settled the route auth-gating helpers (`validateAuthUser` / `decodeWith(RecipeSessionId)`), removed the `recognizeProducts` stub + `_productRecognizer` placeholder from the UC, and relocated `RecipeSessionFromRow` (→ `db/types/converters.ts`) and `serializeItemsToMarkdown` (→ `core/model/recipe/markdown.ts`). Then the repo migrated npm → pnpm.

## Findings

### F1 — Error model + route-gating patterns are stale; Phase 3 won't compile as written

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — wide but mechanical; one real 500-vs-502 decision
- **Dimension**: Architectural Fitness
- **Location**: Established Patterns #4/#5; Critical Implementation Details; Phase 2 #1; Phase 3 #1/#3/#4
- **Detail**: The "binding" patterns referenced symbols that no longer exist and a route pattern the code abandoned. (a) Error names: `ServerSnapchefError`, `BusinessRuleError`/`BUSINESS_RULE_VIOLATED`, `ExternalSystemError`, `NOT_FOUND`, `ErrorCode` — reality is the `SnapchefServerError` union (`SnapchefBusinessRuleViolationError` 422, `SnapchefExternalSystemError` 500, `SnapchefNotFoundError` 404, `SnapchefInternalSystemError` 502), each with a numeric `code`; no `ErrorCode` enum. (b) Route auth-gate: plan said `Effect.fromNullable(user)/(params.id)` → `mapError` to `BusinessRuleError UNAUTHORIZED` (422); landed routes use `validateAuthUser(user)` (401) + `decodeWith(RecipeSessionId)(params.id)` (400). (c) UC unwrap: plan said `Effect.andThen` + `mapError(()=>NOT_FOUND)`; UC uses `Option.match` → `SnapchefNotFoundError`. (d) Concrete bug: Phase 3 #1 mapped missing API key → `ExternalSystemError` (500) but Phase 3 verification asserted "502" — could never pass.
- **Fix**: Renamed all error tokens to the `Snapchef…Error` family; replaced the route-gate recipe with `validateAuthUser` + `decodeWith(RecipeSessionId)`; aligned Pattern #4 to `Option.match`→`SnapchefNotFoundError`; dropped `ErrorCode` language; settled missing-key = 500 (`SnapchefExternalSystemError`) and fixed the 502→500 mismatch in both the contract and verification (plan body + Progress 3.3 + Testing Strategy).
- **Decision**: FIXED

### F2 — Current State Analysis asserts facts that are no longer true

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — misleads the implementer; rewrite the section
- **Dimension**: Plan Completeness
- **Location**: Current State Analysis (l.27, l.39); Decision Log #14; Phase 3 #3
- **Detail**: (a) "`recognizeProducts` is a stub; a `_productRecognizer` placeholder field exists" — the UC has neither (both removed in the refactor's UC-hygiene pass), so Phase 3 #3's "replace the stub / drop the field" instructed edits to absent symbols. (b) "Upload route collapses auth/id/multipart into one 422" — `upload.ts` is per-error typed. (c) Decision #14's "no per-error route typing (accepted as-is)" was superseded.
- **Fix**: Rewrote the UC bullet (recognition unbuilt; two-arg constructor; `Option.match`→`SnapchefNotFoundError`), the upload-route bullet (per-error typed 401/400), appended a "partly superseded 2026-06-13" note to Decision #14, and reframed Phase 3 #3 as "add the method + add the third constructor param".
- **Decision**: FIXED

### F3 — Phase 2 #2 (use-cases.md update) is already done — and done differently than planned

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — mark the task done; obvious
- **Dimension**: Lean Execution
- **Location**: Phase 2 #2; Implementation Approach; Phase 2 manual verification; Progress 2.3
- **Detail**: The `use-cases.md` update landed in `c641e2606`, and the premise is false: `AuthenticatorUC` was _migrated to the `Authenticator` port_ (`use-cases.md` records this; middleware wires `createSupabaseAuthenticator(supabase)`), not kept as a `SupabaseClient` exception. Re-doing the task per the plan would re-introduce the wrong framing into a correct doc.
- **Fix**: Marked Phase 2 #2 ✅ LANDED (`c641e2606`) with the AuthenticatorUC-migration correction; updated Implementation Approach, Phase 2 manual verification, and Progress 2.3 (`- [x]`).
- **Decision**: FIXED

### F4 — Stale symbol homes: helpers/schema live elsewhere than the plan says

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — retarget file paths; obvious once known
- **Dimension**: Plan Completeness
- **Location**: Current State Analysis (l.22, l.29); Key Discoveries; Critical Impl Details; Phase 4 #4; Phase 5 #1; References
- **Detail**: `serializeItemsToMarkdown` is in `core/model/recipe/markdown.ts` (not `utils/recipe.ts`, which doesn't exist); `RecipeSessionFromRow` is in `infrastructure/db/types/converters.ts`. Phase 4 #4 told the implementer to add `deserializeRecognizedItems` to `utils/recipe.ts` — should be `core/model/recipe/markdown.ts` (src/lib/CLAUDE.md: markdown serialization belongs in `core/model/**`). `RecognizedItem` is a domain model (`core/model/recipe`), not a boundary schema, despite repeated "boundary `RecognizedItem`" phrasing.
- **Fix**: Repointed `serializeItemsToMarkdown`/`deserializeRecognizedItems` → `core/model/recipe/markdown.ts`, `RecipeSessionFromRow` → `db/types/converters.ts`, and "boundary `RecognizedItem`" → "`RecognizedItem` from `@/lib/core/model/recipe`" across Current State, Key Discoveries, Critical Impl Details, Phase 4 #4, Phase 5 #1, and References.
- **Decision**: FIXED

### F5 — Verification commands said `npm run`; repo migrated to pnpm

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Success Criteria (every phase), Testing Strategy, Progress
- **Detail**: Plan used `npm run lint`/`npm run build`/`npm run db:types`/`npm run dev`/`npx supabase db reset` (24 tokens). Current branch `chore/migrate-to-pnpm` (commit 81e433b8e); CLAUDE.md commands are pnpm-based.
- **Fix**: `npm run …` → `pnpm …`, `npx supabase db reset` → `pnpm exec supabase db reset`, applied uniformly across the plan body and Progress (both sides stay in sync).
- **Decision**: FIXED

### F6 — change.md/brief model IDs didn't match the configured defaults

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: change.md decision #1; plan-brief.md model row
- **Detail**: Docs named `google/gemini-3.1-flash-lite` + `openai/gpt-5.4-mini`; `astro.config.mjs` defaults are `google/gemini-2.0-flash-lite` + `openai/gpt-4o-mini`. Env-configurable, so functionally harmless — doc drift only.
- **Fix**: Updated the model IDs in change.md and plan-brief.md to the configured defaults, noting env-swappability; dropped the stale per-token pricing claim.
- **Decision**: FIXED

## Notes

- `change.md` `updated` bumped to 2026-06-13; **status kept `implementing`** (not regressed to `plan_reviewed`) — implementation is underway (Phase 1 + most of Phase 2 landed). A "Plan re-alignment (2026-06-13)" note was appended to change.md's Notes for traceability; the historical 2026-06-10 revalidation note was left intact as a point-in-time record.
- Note: `effect.md` / `src/lib/CLAUDE.md` claim the `tryError…` helpers live in `infrastructure/db/supabase-effect.ts`, but they are still defined in `utils/effect.ts`. The plan correctly references `utils/effect.ts` (matches code) — this is a _conventions-doc_ drift, out of scope for this plan-review, but worth a future `/10x-rule-review` or a `supabase-effect.ts` extraction.
