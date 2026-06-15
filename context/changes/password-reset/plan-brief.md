# Password Reset — Plan Brief

> Full plan: `context/changes/password-reset/plan.md`

## What & Why

Add self-service password reset (PRD **FR-013**, roadmap **F-03**) so a user who forgot their password can regain access without operator help. This is the last piece of the authentication flow: register + email confirmation → sign in / sign out → **password reset**. Without it, a user with private per-account data who forgets their password is permanently locked out.

## Starting Point

Auth is a clean hexagon (`Authenticator` port → `SupabaseAuthenticator` adapter → `AuthenticatorUC` → thin routes/pages), and the just-merged `email-verification-gating` change built the exact mechanism reset needs: a Supabase `token_hash` email link redeemed by an SSR callback that sets the session cookie. Reset is its near-mirror — `verifyOtp` with `type=recovery` instead of `type=email`. The adapter already has reusable `liftAuthUser` + `toAuthFailure` helpers; `confirm.astro` and `ResendConfirmation.tsx` are direct precedents. Only the recovery email template is missing from config.

## Desired End State

From `/auth/signin`, "Forgot your password?" → enter email → neutral "if an account exists, we sent a link" message → emailed link opens `/auth/reset-password` → set a new password → land on `/recipes` signed in. Invalid/expired links show a clear message with a path to request a fresh one. A committed runbook covers prod dashboard activation.

## Key Decisions Made

| Decision            | Choice                                                    | Why (1 sentence)                                                                                 | Source |
| ------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------ |
| Token redemption    | Server-side on submit (`verifyOtp`+`updateUser`)          | One request-scoped client carries the recovery session into `updateUser`; mirrors `confirmEmail` | Plan   |
| Don't redeem on GET | Page renders form; token → POST                           | The recovery token is single-use; verifying on load would burn it to email-prefetchers           | Plan   |
| Post-reset landing  | Signed in → `/recipes`                                    | `verifyOtp` returns a valid session, so the click logs the owner in; matches confirm flow        | Plan   |
| Entry point         | Static link on `signin.astro`                             | Simplest, matches the existing sign-up link; no island change                                    | Plan   |
| Error semantics     | Reuse `SnapchefAuthenticationError` (401), no new class   | On the reset route 401 unambiguously means "link invalid/expired" (unlike sign-in)               | Plan   |
| Site URL in adapter | None — template owns the link via `{{ .SiteURL }}`        | Mirrors `resendConfirmation`; no `redirectTo`/`PUBLIC_SITE_URL` plumbing needed                  | Plan   |
| Anti-enumeration    | Built-in (always echo success)                            | `resetPasswordForEmail` succeeds whether or not the email exists                                 | Plan   |
| Testing             | Unit (adapter) + component (reset form) + manual Inbucket | Pins the brittle `verifyOtp`→`updateUser` seam; matches the email-verification change's rigor    | Plan   |

## Scope

**In scope:** recovery template + `config.toml` block + prod runbook; `RequestPasswordReset`/`ResetPassword` commands + `PasswordResetRequested` response; `requestPasswordReset`/`resetPassword` through port/adapter/UC; `POST /api/auth/forgot-password` + `POST /api/auth/reset-password`; `forgot-password.astro` + `ForgotPasswordForm`; `reset-password.astro` + `ResetPasswordForm`; "Forgot your password?" link on sign-in; unit + component tests.

**Out of scope:** browser Supabase client; new error class; in-app "change password while logged in"; reauthentication step; production config in-repo; middleware/guard changes; PKCE; local SMTP; Playwright E2E; password policy beyond `min(6)`.

## Architecture / Approach

Two sub-flows on the existing hexagon. **Request:** `ForgotPasswordForm` → `POST /api/auth/forgot-password` → `resetPasswordForEmail` (no `redirectTo`; recovery template builds the link). **Redeem:** the emailed `token_hash` link opens `reset-password.astro`, which mounts `ResetPasswordForm` with the token as a prop (no redemption on GET); submit → `POST /api/auth/reset-password` → adapter chains `verifyOtp({type:"recovery"})` then `updateUser({password})` on the same request-scoped client → session cookie set → `/recipes`. New schemas in `core/boundry/auth`; Supabase mechanics in `infrastructure/auth`; thin routes/pages delegate to the UC from `context.locals`.

## Phases at a Glance

| Phase                                   | What it delivers                                                        | Key risk                                                              |
| --------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1. Recovery config + template + runbook | Recovery email targets `/auth/reset-password`; prod checklist           | Template `type=recovery` must match `verifyOtp`; stack restart needed |
| 2. Schemas + port + adapter + UC        | `requestPasswordReset` / `resetPassword` end-to-end in the domain layer | The `verifyOtp`→`updateUser` same-request session chain               |
| 3. Server routes                        | `POST /api/auth/forgot-password` + `POST /api/auth/reset-password`      | Correct success/redirect + envelope on token failure                  |
| 4. UI wiring                            | Request page+island, reset page+island, sign-in link, component test    | Not redeeming the token on GET; password-mismatch UX                  |

**Prerequisites:** local Supabase stack (Docker) + Inbucket; ability to restart the stack. Builds on the merged `email-verification-gating` change.
**Estimated effort:** ~1–2 sessions across 4 phases.

## Open Risks & Assumptions

- The recovery `verifyOtp` type (`recovery`) and the single-request `verifyOtp`→`updateUser` session continuity are assumed from the `confirmEmail` precedent — pinned by the Phase 2 unit test and confirmed once manually in Phase 3/4.
- Production enforcement depends on a **manual** dashboard step (recovery template upload) — code alone does not send prod recovery emails until the template is set.
- Reset-request throttling (`max_frequency`) means rapid re-requests surface a non-fatal error; the UI must degrade gracefully.

## Success Criteria (Summary)

- A user who forgot their password can reset it from sign-in and end up signed in at `/recipes`.
- Invalid/expired reset links show a clear message with a path to request a new one; reset requests never disclose whether an account exists.
- `pnpm lint`, `pnpm test`, `pnpm build` pass; the prod runbook is complete and ordered.
