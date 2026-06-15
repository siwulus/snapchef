<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Email Verification Gating

- **Plan**: `context/changes/email-verification-gating/plan.md`
- **Mode**: Deep
- **Date**: 2026-06-14
- **Verdict**: SOUND (all findings fixed in plan)
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | WARNING |
| Blind Spots           | PASS    |
| Plan Completeness     | PASS    |

## Grounding

9/9 existing paths ✓ (4 new files — `confirm.astro`, `resend.ts`, `ResendConfirmation.tsx`, runbook — correctly absent). APIs verified against `@supabase/supabase-js@2.106.2`: `AuthApiError.code` exists (`code: ErrorCode | (string & {}) | undefined`, runtime `this.code = code`); `VerifyTokenHashParams { token_hash, type }` exists; `EmailOtpType` includes `'email'`; `ResendParams.type` = `Extract<EmailOtpType, 'signup' | 'email_change'>` (plan correctly uses `'signup'` for resend, `'email'` for verifyOtp). Progress↔Phase mechanical contract ✓. brief↔plan ✓.

Sub-agent verification: union extension is safe — sole `Authenticator` implementer is `createSupabaseAuthenticator` (`:83`, typed `: Authenticator`), no test fakes; boundary mapper `toErrorResponsePayload` is generic over `._tag`/`.code`/`.message`/`.cause`; the only `.exhaustive()` sites (`useRecipeUpload.ts:22,74`) match the `{ ok }` envelope, not error tags; route guard protects only `/recipes`. Cookie-on-redirect works via the request-scoped client bound to `context.cookies`. Contradiction found: no `.astro` page runs an Effect today (→ F1).

## Findings

### F1 — `/auth/confirm.astro` introduces a new "Effect in page frontmatter" edge

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 3 — #1 Confirmation callback page
- **Detail**: No `.astro` page in the repo runs an Effect; every `Effect.runPromise` site composes `runWithLogging` (shared logger runtime) via `runApiRoute`, middleware, or a React hook. The plan's `confirm.astro` called `Effect.runPromise` directly, running the confirmEmail Effect outside that runtime (default-runtime logs, ad-hoc error handling).
- **Fix A ⭐ Recommended**: Run the page Effect through `runWithLogging` and treat the page as a sanctioned edge.
  - Strength: Same observability/runtime as every other edge; one small import; effect.md's "outermost handler" exception covers a page frontmatter.
  - Tradeoff: Imports a logging-infra helper into a page file.
  - Confidence: HIGH — `runWithLogging` wraps all three existing edges and is exported as `runWithLogging<A,E>(effect): Promise<A>`.
  - Blind spot: Confirmed page-importable (`@/lib/infrastructure/logging/logger:48`).
- **Fix B**: Make `/auth/confirm` an API GET route.
  - Strength: Reuses an existing edge type.
  - Tradeoff: `runApiRoute` wraps success as JSON; can't render the HTML error card or a clean redirect.
  - Confidence: MED.
  - Blind spot: Failure rendering for an email-clicked link.
- **Decision**: FIXED via Fix A — plan Phase 3 #1 now specifies composing `Effect.match` then running through `runWithLogging` (not bare `runPromise`), documented as a sanctioned edge.

### F2 — Single-use token + email-link prefetch is an unmentioned prod failure mode

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 (runbook) / Phase 3 (confirm flow)
- **Detail**: `token_hash` link is single-use, consumed on GET; Outlook SafeLinks / corporate AV / scanners can prefetch and burn it before the user clicks, landing a valid signup on the "invalid/expired" card. Invisible locally (Inbucket never prefetches); only bites in prod. Unmentioned.
- **Fix**: Document the limitation in the prod runbook; recovery is the existing resend path; confirm-button/PKCE noted as a follow-up only.
- **Decision**: FIXED — plan Phase 1 #3 runbook contract now includes a "Known limitations" note.

### F3 — `EmailConfirmation.type` accepts 5 values but the flow only emits `email`

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 2 — #2 Boundary schemas (`EmailConfirmation`)
- **Detail**: Template hardcodes `&type=email` and resend/email-change are out of scope, yet the schema validated `type` against the full `EmailOtpType` enum — lets a crafted `?type=recovery` reach `verifyOtp` and weakens the brittle template↔verifyOtp contract.
- **Fix**: Narrow `type` to `z.literal("email")`.
- **Decision**: FIXED — plan Phase 2 #2 now uses `z.literal("email")` with a note to widen only if recovery/email-change reuse the route.
