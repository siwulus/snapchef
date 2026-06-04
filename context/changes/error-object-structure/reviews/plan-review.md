<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Application Domain Error Structure (SnapchefError family)

- **Plan**: context/changes/error-object-structure/plan.md
- **Mode**: Deep
- **Date**: 2026-06-04
- **Verdict**: REVISE → SOUND (after triage fixes applied)
- **Findings**: 1 critical, 1 warning, 0 observations

## Verdicts

| Dimension             | Verdict                   |
| --------------------- | ------------------------- |
| End-State Alignment   | PASS                      |
| Lean Execution        | PASS                      |
| Architectural Fitness | FAIL (fixed in triage)    |
| Blind Spots           | WARNING (fixed in triage) |
| Plan Completeness     | PASS                      |

## Grounding

6/6 paths ✓, symbols ✓, brief↔plan ✓, Progress↔Phase contract ✓.
Import topology verified: `SignInForm.tsx`/`SignUpForm.tsx` import `submitJson` (value, `src/lib`), command schemas (values, `core/boundry/auth`), `UserCredentials` type (`core/model/auth`); `submitJson.ts` imports the `ApiResult` type (`infrastructure/api/types`).

## Findings

### F1 — Client transport errors planted in the framework-free core

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 — Core error family (client leaves + root union)
- **Detail**: `ApiRequestError` (carries HTTP `status?`, models browser fetch failures) and `UnexpectedResponseError` are transport errors, not domain errors. Placing them in `core/model/error` contradicts the layer rule ("framework-free domain") AND the plan's own Phase 2 principle that infrastructure owns all HTTP knowledge. The root `SnapchefError` union must follow the client branch out of core (core cannot import outward). Raised by the user; confirmed against the codebase.
- **Fix A ⭐ Recommended**: Move client branch + root union to `src/lib/infrastructure/api/client-errors.ts`
  - Strength: Co-located with `ApiResult`, which React forms already import (proven precedent); all HTTP knowledge lands in infrastructure/api.
  - Tradeoff: Root union becomes an infrastructure-level alias.
  - Confidence: HIGH — based on verified import topology.
  - Blind spot: A future client-side _domain_ error would still belong in core.
- **Fix B**: Move client branch to `src/components/api/errors.ts` (literal browser/components ownership)
  - Strength: Browser-only code lives under the React tree; `src/lib` stays conceptually server-leaning.
  - Tradeoff: Separates the errors from `ApiResult`/`submitJson`; non-UI module under the React tree; root union usable client-side only.
  - Confidence: MEDIUM.
  - Blind spot: `submitJson` remains in `src/lib` until the follow-up relocates it.
- **Decision**: FIXED via Fix B — client branch + root union moved to `src/components/api/errors.ts`; core keeps `ErrorCode`, server leaves, `ServerSnapchefError`, `decodeWith`. Server branch crosses into the client module via `import type` only. Follow-up change will relocate `submitJson` to `src/components/api/`.

### F2 — Stale src/lib/CLAUDE.md gives implementers contradictory binding rules

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1, doc amendment
- **Detail**: `src/lib/CLAUDE.md` still asserts "Server-only by default… never import from `src/lib/` into a React component" and "No barrel `index.ts`" — both already de-facto dead (React forms import `src/lib` modules; core uses per-domain `index.ts`). The plan amended only the root CLAUDE.md.
- **Fix**: Extend Phase 1's doc amendment to update `src/lib/CLAUDE.md` with the layer access rules.
- **Decision**: FIXED via extended user-specified access matrix, now in Phase 1 change #3:
  - `src/components/**` may import from `src/lib` only: types from `infrastructure/api/types`, types from `core/model/**`, command schemas from `core/boundry/**`. All other references forbidden (`submitJson.ts` = documented legacy exception until relocated).
  - `src/pages/api/**` may import `core/boundry`, `core/model`, `core/usecase` (business-logic exposure; created with the first use case), and `infrastructure/**`.
  - `infrastructure/db/**` strictly server-only.
  - Barrel-`index.ts` rule aligned with the per-domain convention.

## Triage Summary

- Fixed: F1 (Fix B), F2 (custom — extended access matrix) (2)
- Skipped: none
- Accepted: none
- Dismissed: none

Verdict after fixes: **SOUND**
