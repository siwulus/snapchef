<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Hexagonal Architecture Seam Fixes

- **Plan**: context/changes/hexagonal-architecture-review/plan.md
- **Scope**: All 4 phases (full plan)
- **Date**: 2026-06-11
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — Anonymous getUser() classifies "no session" as 500, not 401

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence (+ reliability)
- **Location**: src/lib/infrastructure/auth/SupabaseAuthenticator.ts:19-25, 62-63
- **Detail**: Plan Phase 2 required "no session" → SnapchefAuthenticationError (401), and the adapter comment claims it. But anonymous getUser() returns error = AuthSessionMissingError (extends CustomAuthError; name "AuthSessionMissingError", not "AuthApiError"), so isAuthApiError() is false → falls to SnapchefExternalSystemError (500). Masked today by middleware catchAll (anonymous browsing + 2.8 redirect still work); latent for any future route surfacing getUser(). Edge: AuthError.status is number|undefined, so undefined-status AuthApiError also falls to 500. Bad-credentials on signIn is a real AuthApiError 400 → 401 (correct).
- **Fix**: Add isAuthSessionMissingError to the rejection predicate: classify as auth-rejection when `isAuthSessionMissingError(error) || (isAuthApiError(error) && error.status < 500)`; 5xx/AuthRetryableFetchError/thrown stay 500. Correct the comment.
  - Strength: Satisfies the Phase 2 contract exactly; keeps 5xx/network → 500; uses a library-shipped guard.
  - Tradeoff: One import + 2-line predicate; no visible app behavior change today (middleware masks it).
  - Confidence: HIGH — verified hierarchy + isAuthSessionMissingError exported (auth-js errors.d.ts:94).
  - Blind spot: Not live-confirmed that @supabase/ssr getUser() yields AuthSessionMissingError vs null-user/no-error; fix is safe either way.
- **Decision**: FIXED — added isAuthSessionMissingError to the isAuthRejection predicate + corrected comment; lint + build green.

### F2 — middleware collapses ALL getUser failures to anonymous

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/middleware.ts:38-42
- **Detail**: setUserInContext Effect.catchAll(() => user = null) catches every failure, so a Supabase outage silently logs out an authenticated user. PRE-EXISTING and explicitly out of plan scope (setUserInContext listed as unchanged). Defensible fail-open. Flag only.
- **Fix**: (optional) catchTag("SnapchefAuthenticationError") so genuine outages propagate/log instead of masquerading as logout.
- **Decision**: FIXED (log + fail-open variant) — catchTag auth → quiet anonymous; tapError(logError) on infra failures; still fail open so public pages stay reachable. Chose this over literal propagate, which would 500 every route (incl. /auth/signin) during a Supabase outage. lint + build green.

### F3 — infrastructure/auth/ not listed in the layer matrix

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency (docs)
- **Location**: src/lib/CLAUDE.md (Layer Access Matrix)
- **Detail**: Phase 2 added src/lib/infrastructure/auth/ but the layer matrix only enumerates infrastructure/db/\*\*. Adapter itself is correct. Pure doc gap.
- **Fix**: Add an infrastructure/auth/** note (server-only, same as infrastructure/db/**) to the matrix.
- **Decision**: FIXED — merged the db/auth heading and added a note that all infrastructure/\*\* subdirs are server-only and the only layer that may name Supabase.
