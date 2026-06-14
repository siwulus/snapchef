# Email Verification Gating — Plan Brief

> Full plan: `context/changes/email-verification-gating/plan.md`

## What & Why

Gate access to Snapchef behind email verification. Today confirmations are disabled (`enable_confirmations = false`), so sign-up accounts are immediately usable and the existing verification scaffolding is inert. We adopt Supabase's native hard-block: with confirmations on, `signUp()` returns no session until the email link is clicked, so unverified users simply can't get in — verification is enforced at sign-in plus a callback route that redeems the link.

## Starting Point

Auth is a clean hexagon: `Authenticator` port → `SupabaseAuthenticator` adapter → `AuthenticatorUC` → thin routes. `SnapchefUser` is `{ id, email? }`; the adapter folds every 4xx into `SnapchefAuthenticationError` (401). Sign-up already redirects to an informational `/auth/confirm-email` page (which wrongly guesses dev vs prod copy), but there is no confirmation callback route and no resend. The middleware guard protects `/recipes` purely on session presence. Local email is captured by Inbucket (port 54324).

## Desired End State

Sign-up sends a confirmation email; the account can't sign in until the link is clicked; clicking `/auth/confirm?token_hash=…&type=email` sets the session and lands on `/recipes`; an unconfirmed sign-in shows an inline "verify your email" message with a working resend; a committed runbook documents the prod dashboard steps so the gate also engages in production.

## Key Decisions Made

| Decision             | Choice                                                 | Why (1 sentence)                                                                                      | Source |
| -------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ------ |
| Enforcement model    | Supabase-native hard block                             | Unverified users can't get a session at all; minimal custom code, reuses Supabase's mailer/token flow | Plan   |
| Link redemption      | Dedicated SSR `/auth/confirm` (`verifyOtp` token_hash) | Correct for SSR cookie sessions; the hosted/hash flow can't set server cookies cleanly                | Plan   |
| Error semantics      | New `SnapchefEmailNotConfirmedError` (403)             | Client matches by `name` to show verify+resend; avoids conflating with bad-credentials 401            | Plan   |
| Resend               | Endpoint + UI                                          | Lost/expired link must be self-recoverable; standard for this flow                                    | Plan   |
| Post-confirm landing | Straight into `/recipes` (auto-signed-in)              | `verifyOtp` returns a session, so the click logs the user in                                          | Plan   |
| Sign-in UX           | Inline message + resend on the form                    | Keeps the user in context with immediate recovery                                                     | Plan   |
| Prod activation      | Commit local config + prod runbook                     | config.toml governs only local; prod auth settings live in the hosted dashboard                       | Plan   |
| Rollout              | Forward-only; existing = confirmed                     | Accounts created while confirmations were off are already auto-confirmed                              | Plan   |
| Testing              | Unit on brittle bits + manual via Inbucket             | Covers error-classification & callback regressions; matches the repo's vitest style                   | Plan   |

## Scope

**In scope:** enable confirmations (local) + custom confirmation template + prod runbook; `SnapchefEmailNotConfirmedError` (403); adapter classification of `email_not_confirmed`; `confirmEmail`/`resendConfirmation` through port/adapter/UC; `/auth/confirm` page + `POST /api/auth/resend`; corrected `confirm-email.astro`; reusable `ResendConfirmation` island; sign-in inline verify+resend; unit + component tests.

**Out of scope:** app-level soft gating / `emailConfirmedAt` on the model / `profiles` flag; forced re-verification; middleware or signin/signup redirect changes; production config in-repo; PKCE flow; local SMTP; Playwright E2E; password-reset / magic-link / email-change flows.

## Architecture / Approach

Native confirmation flow on the existing hexagon. New schemas in `core/boundry/auth` (`EmailConfirmation`, `ResendConfirmation`, `ConfirmationResent`); new error in `core/model/error`; Supabase `verifyOtp`/`resend` mechanics in `infrastructure/auth`; thin Astro page + API route delegate to the UC from `context.locals`. The email template points the link at our own `/auth/confirm`, which calls `verifyOtp` through the request-scoped SSR client so the session cookie is written on the redirect to `/recipes`. No `SnapchefUser` and no middleware change — Supabase prevents the unverified session, so there is nothing to soft-gate.

## Phases at a Glance

| Phase                           | What it delivers                                                                      | Key risk                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1. Config + template + runbook  | Confirmations on locally; link targets `/auth/confirm`; prod checklist                | Template `type` must match `verifyOtp` type; stack restart needed            |
| 2. Error + adapter + port/UC    | `SnapchefEmailNotConfirmedError`; classification; `confirmEmail`/`resendConfirmation` | Pinning the exact `email_not_confirmed` discriminator vs supabase-js version |
| 3. Callback page + resend route | `/auth/confirm` redeems link & sets session; `POST /api/auth/resend`                  | Cookie session must be set via the request-scoped client, not a new one      |
| 4. UI wiring                    | Corrected confirm-email page; resend island; sign-in verify+resend                    | `SignInForm` must start reading `error.name` without breaking existing paths |

**Prerequisites:** local Supabase stack (Docker) + Inbucket; ability to restart the stack.
**Estimated effort:** ~2 sessions across 4 phases.

## Open Risks & Assumptions

- The unconfirmed-sign-in `AuthApiError` discriminator (`code === "email_not_confirmed"`) and the link `type` (`email`) are assumed but must be verified against the installed `@supabase/supabase-js` during Phase 1/2 and pinned in a test.
- Production enforcement depends on a **manual** dashboard step (runbook) — code alone does not turn the gate on in prod.
- Resend throttling (`max_frequency = "1s"`) means rapid re-sends surface a non-fatal error; the UI must degrade gracefully.

## Success Criteria (Summary)

- An unverified user cannot reach `/recipes`; clicking the emailed link signs them in and lands them there.
- An unconfirmed sign-in shows an inline verify message with a working resend.
- `pnpm lint`, `pnpm test`, `pnpm build` pass; the prod runbook is complete and ordered.
