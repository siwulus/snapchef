# Runbook: Enable Email Confirmations in Production

`supabase/config.toml` governs **only the local stack**. The hosted project's auth settings live
in the Supabase dashboard and are **not** managed by this repo or by a Worker deploy. This runbook
captures the manual steps that turn the email-verification gate on in production.

> **Rollout principle:** ship the code first (it is inert until the toggle is flipped — sign-up still
> redirects to `/auth/confirm-email`, but the hosted project keeps auto-confirming until "Confirm
> email" is enabled), then flip the dashboard toggle. A Worker rollback does **not** roll back the
> hosted auth setting, so the gate stays on independently of the deployed code version.

## Prerequisites

- Admin access to the Supabase project dashboard for the production project.
- The production origin (e.g. `https://app.snapchef.example`) — referred to below as `<PROD_ORIGIN>`.
- A production SMTP sender (Inbucket/Mailpit is local-only and never sends real mail).
- The confirmation email template from this repo: `supabase/templates/confirmation.html`.

## Steps (in order)

1. **Deploy the code first.** Merge this change to `main` and let Cloudflare Workers Builds deploy it.
   At this point the `/auth/confirm` callback and `POST /api/auth/resend` endpoints exist but are inert
   in prod because the hosted project still auto-confirms.

2. **Configure a production SMTP sender.**
   Dashboard → **Authentication → Emails → SMTP Settings** (or Project Settings → Auth → SMTP).
   Enter your provider host/port/user/pass and the sender address. Without a real SMTP sender,
   confirmation emails will not be delivered. Save.

3. **Upload the confirmation email template.**
   Dashboard → **Authentication → Emails → Templates → Confirm signup**.
   Paste the contents of `supabase/templates/confirmation.html`. The link **must** use the
   `{{ .TokenHash }}` form so it targets the app's own callback:

   ```
   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
   ```

   Do **not** use `{{ .ConfirmationURL }}` — that points at the default Supabase verify endpoint and
   bypasses the SSR cookie flow. Keep `&type=email` exactly (it must match the `EmailOtpType` the
   `/auth/confirm` route passes to `verifyOtp`). Save.

4. **Set the Site URL and redirect allow-list.**
   Dashboard → **Authentication → URL Configuration**.
   - **Site URL** = `<PROD_ORIGIN>` (so `{{ .SiteURL }}` in the template resolves to the prod origin).
   - **Redirect URLs**: add `<PROD_ORIGIN>/auth/confirm` (https). Same-origin redirects under Site URL
     are normally allowed, but add it explicitly to be safe and to cover the resend `emailRedirectTo`.
     Save.

5. **Enable the gate (flip last).**
   Dashboard → **Authentication → Providers → Email** (or Sign In / Providers → Email).
   Turn **"Confirm email"** ON. From this moment, new sign-ups receive a confirmation email and
   cannot sign in until they click the link.

6. **Smoke test in production.**
   - Sign up with a fresh address → a confirmation email arrives via your SMTP sender.
   - The link points at `<PROD_ORIGIN>/auth/confirm?token_hash=…&type=email`.
   - Clicking it lands you in `/recipes`, signed in.
   - Attempting to sign in before clicking shows the inline "verify your email" message + resend.

## Existing accounts

Forward-only. Accounts created while confirmations were off are already marked confirmed and keep
signing in normally. There is **no** forced re-verification and **no** data migration.

## Known limitations

The `token_hash` confirmation link is **single-use** and is consumed on the first `GET` to
`/auth/confirm`. Email-link **prefetchers** (Outlook SafeLinks, corporate AV/security scanners,
some mail clients) can fetch the link before the human clicks it, burning the token — a valid
signup then lands on the "This link is invalid or has expired" card even though nothing was wrong.

- This is **invisible locally** (Inbucket/Mailpit never prefetches), so it only surfaces in prod.
- **Recovery** is the existing **resend** affordance shown on the error card, the sign-in form, and
  the `/auth/confirm-email` page — the user requests a fresh link and clicks it directly.
- A confirm-**button** landing page (user clicks a button that POSTs the verification) or a full
  **PKCE `exchangeCodeForSession`** flow would harden this against prefetchers. Both are explicit
  **follow-ups**, not part of this change.

## Reverting

To disable the gate, turn **"Confirm email"** OFF in step 5's location. New sign-ups auto-confirm
again immediately; already-confirmed accounts are unaffected.
