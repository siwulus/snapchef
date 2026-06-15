# Runbook: Enable Password Reset in Production

`supabase/config.toml` governs **only the local stack**. The hosted project's auth settings and
email templates live in the Supabase dashboard and are **not** managed by this repo or by a Worker
deploy. This runbook captures the manual steps that make production send recovery emails pointing at
the app's own `/auth/reset-password` callback.

> **Rollout principle:** ship the code first — the `/auth/forgot-password` and `/auth/reset-password`
> routes/pages exist but are inert in prod until the **Reset Password** template is uploaded (the
> default Supabase recovery link points at the hosted verify endpoint, not our SSR callback). Upload
> the template last. A Worker rollback does **not** roll back the hosted auth template, so the flow
> stays wired independently of the deployed code version.

## Prerequisites

- Admin access to the Supabase project dashboard for the production project.
- The production origin (e.g. `https://app.snapchef.example`) — referred to below as `<PROD_ORIGIN>`.
- A production SMTP sender (Inbucket/Mailpit is local-only and never sends real mail). This is the
  **same** sender used by the email-confirmation flow — see `enable-email-confirmations-prod.md`.
- The recovery email template from this repo: `supabase/templates/recovery.html`.

## Steps (in order)

1. **Deploy the code first.** Merge this change to `main` and let Cloudflare Workers Builds deploy it.
   At this point the `/auth/forgot-password` + `/auth/reset-password` pages and the
   `POST /api/auth/forgot-password` + `POST /api/auth/reset-password` endpoints exist, but recovery
   emails still use the default Supabase link until the template is uploaded.

2. **Confirm a production SMTP sender is configured.**
   Dashboard → **Authentication → Emails → SMTP Settings** (or Project Settings → Auth → SMTP).
   Recovery email is sent through the same SMTP sender as the confirmation email; if you already
   configured it for `enable-email-confirmations-prod.md`, no change is needed. Without a real SMTP
   sender, recovery emails will not be delivered.

3. **Upload the recovery email template.**
   Dashboard → **Authentication → Emails → Templates → Reset Password**.
   Paste the contents of `supabase/templates/recovery.html`. The link **must** use the
   `{{ .TokenHash }}` form so it targets the app's own callback:

   ```
   {{ .SiteURL }}/auth/reset-password?token_hash={{ .TokenHash }}&type=recovery
   ```

   Do **not** use `{{ .ConfirmationURL }}` — that points at the default Supabase verify endpoint and
   bypasses the SSR cookie flow. Keep `&type=recovery` exactly (it must match the `EmailOtpType` the
   `/api/auth/reset-password` route passes to `verifyOtp`). Save.

4. **Set the Site URL and redirect allow-list.**
   Dashboard → **Authentication → URL Configuration**.
   - **Site URL** = `<PROD_ORIGIN>` (so `{{ .SiteURL }}` in the template resolves to the prod origin).
   - **Redirect URLs**: add `<PROD_ORIGIN>/auth/reset-password` (https). Same-origin redirects under
     Site URL are normally allowed, but add it explicitly to be safe. Save.

5. **Smoke test in production.**
   - From `/auth/signin`, click "Forgot your password?", submit a known account's address → a recovery
     email arrives via your SMTP sender.
   - The link points at `<PROD_ORIGIN>/auth/reset-password?token_hash=…&type=recovery`.
   - Clicking it opens the new-password form; submitting a valid new password lands you in `/recipes`,
     signed in.
   - Signing out and back in with the new password works.

## Existing accounts

Nothing to migrate. Any account (confirmed or otherwise) can request a reset; `resetPasswordForEmail`
succeeds whether or not the address exists, so the request screen never discloses account existence.

## Known limitations

The `token_hash` recovery link is **single-use**. Unlike the confirmation link (consumed on `GET`),
the recovery token is redeemed only on the **POST** from the new-password form — the
`/auth/reset-password` page does **not** call `verifyOtp` on load. So email-link **prefetchers**
(Outlook SafeLinks, corporate AV/security scanners, some mail clients) that fetch the URL do **not**
burn the token: they only render the form. The token is spent when the user actually submits a new
password.

- Recovery from an expired/used link is the **"request a new reset"** affordance shown on the
  reset-password error state and the `/auth/forgot-password` page — the user requests a fresh link.
- `otp_expiry` (1 h locally; mirror in the dashboard if stricter) bounds link validity.

## Reverting

To disable self-service reset, remove (or revert to default) the **Reset Password** template in
step 3's location. Recovery emails then fall back to the default Supabase verify endpoint, which the
app's `/auth/reset-password` callback does not service — effectively turning the flow off. The app
routes/pages remain harmless (a recovery POST with no valid token returns the "invalid or expired"
state).
