<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Password Reset (FR-013 / F-03)

- **Plan**: context/changes/password-reset/plan.md
- **Scope**: Phases 1–4 of 4
- **Date**: 2026-06-15
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension           | Verdict                                                |
| ------------------- | ------------------------------------------------------ |
| Plan Adherence      | PASS                                                   |
| Scope Discipline    | PASS                                                   |
| Safety & Quality    | WARNING                                                |
| Architecture        | PASS                                                   |
| Pattern Consistency | PASS                                                   |
| Success Criteria    | PASS (automated; manual pending — correctly unchecked) |

## Summary

No drift across all 18 planned files. The three riskiest mechanics are verified correct:

- **Token redeemed on POST only** — `reset-password.astro` reads `token_hash` and hands it to the island; it never calls `verifyOtp` on GET, so email prefetchers/SafeLinks can't burn the single-use token.
- **`verifyOtp(recovery) → updateUser` on the same request-scoped client** — `SupabaseAuthenticator.resetPassword` chains them via `Effect.flatMap`; the recovery session cookie authenticates the immediately-following `updateUser`. Test proves `updateUser` is not called when `verifyOtp` rejects.
- **`weak_password` → 422 classified before the generic 4xx→401 fold** — `toAuthFailure` orders `isWeakPassword` ahead of `isAuthRejection`, so a 422 isn't mislabeled as "link expired". Pinned by a unit test.

Anti-enumeration (no account-existence disclosure), template `{{ .TokenHash }}` usage, layer-access boundaries, island edge pattern (one pipeline / one runPromise / state in Effect.sync), and test structure are all clean. Automated success criteria re-run at review time: `pnpm test` 37 passing, `pnpm lint` clean, `pnpm build` green.

## Findings

### F1 — `secure_password_change = false` is load-bearing but undocumented

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/config.toml:221
- **Detail**: The recovery flow works because `secure_password_change = false`: after `verifyOtp(recovery)` establishes the recovery session, `updateUser({ password })` succeeds without re-auth. If a later change flips this to `true`, the recovery-session `updateUser` can be rejected as "needs recent login" and reset silently breaks. The dependency is real but invisible — nothing in the config or runbook records it.
- **Fix**: Add a one-line comment above `supabase/config.toml:221` noting the password-reset flow depends on this staying `false`, and a matching note in the prod runbook's URL/auth section.
- **Decision**: PENDING

### F2 — Prod runbook omits recovery-email rate limiting

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: docs/runbooks/enable-password-reset-prod.md
- **Detail**: Local `max_frequency = "1s"` (config.toml:223) is fine for Inbucket, but the prod runbook covers SMTP + template + URLs and never mentions setting a sane recovery-email frequency / rate limit in the hosted dashboard. Mirroring 1s in prod would be a weak anti-abuse posture (recovery-email spamming of arbitrary addresses).
- **Fix**: Add a checklist line to the runbook to set a production-grade email send rate limit in Authentication → Rate Limits.
- **Decision**: PENDING

### F3 — Plan's Current-State precondition is stale (`enable_confirmations`)

- **Severity**: 📝 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: context/changes/password-reset/plan.md:16 / supabase/config.toml:219
- **Detail**: plan.md:16 asserts `enable_confirmations = true` ("turned on by the merged change"), but config.toml:219 reads `false`. This change is unaffected (Phase 1 correctly left the flag untouched, and reset doesn't depend on it). The root cause is real and lives on `main`: commit `3c8931394` ("enhance signout API…") accidentally bundled a one-line flip of `enable_confirmations` true→false, silently disabling the merged email-verification gate locally. Not in scope for this PR — flagged because it's a live regression, not just a doc nit.
- **Fix**: Out of this change's scope. Track separately — restore `enable_confirmations = true` in its own change; optionally correct the plan.md:16 wording.
- **Decision**: PENDING
