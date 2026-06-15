# Password Reset Implementation Plan

## Overview

Add self-service password reset so a user who forgot their password can regain access without operator intervention. The user requests a reset by email, receives a `token_hash` link, lands on a page that collects a new password, and submits it; the server redeems the recovery token and sets the new password in one request, leaving the user signed in at `/recipes`.

This completes the authentication flow (PRD **FR-013**, roadmap **F-03**): register + email confirmation (FR-001) → sign in / sign out (FR-002) → **password reset**. It is a near-mirror of the merged `email-verification-gating` change and reuses the same hexagon, the same `token_hash` callback mechanism, and the same Supabase email-template pattern — with `type=recovery` in place of `type=email`.

## Current State Analysis

- **Auth is a clean hexagon.** `Authenticator` port (`src/lib/core/boundry/auth/ports.ts:6-13`) → `SupabaseAuthenticator` adapter (`src/lib/infrastructure/auth/SupabaseAuthenticator.ts`) → `AuthenticatorUC` thin pass-throughs (`src/lib/core/uc/auth/AuthenticatorUC.ts`) → thin routes/pages consuming the UC from `context.locals`. Current methods: `signIn|signUp|signOut|getUser|confirmEmail|resendConfirmation`.
- **The reusable adapter helpers already cover everything reset needs.** `liftAuthUser(message)(fn)` (`SupabaseAuthenticator.ts:47-64`) lifts any `{ data, error }` auth call, decodes `{ user }` via the `AuthUser` schema, and returns `SnapchefUser`. `toAuthFailure` (`:41-45`) classifies errors: `email_not_confirmed` → 403, other 4xx / missing session → `SnapchefAuthenticationError` (401), everything else → `SnapchefExternalSystemError` (500).
- **`confirmEmail` is the exact precedent for token redemption.** `:95-100` calls `supabase.auth.verifyOtp({ token_hash, type })` through `liftAuthUser`; the request-scoped client writes the session cookie as a side effect of a successful verify. `confirm.astro` (`src/pages/auth/confirm.astro`) is the callback-page precedent (reads `token_hash`/`type` from the URL, runs through `runWithLogging`, redirects on success / renders an error card on failure).
- **`resendConfirmation` is the precedent for an email-send-only call.** `:106-120` uses a bare `Effect.tryPromise` (the sanctioned auth exception in `effect.md`), folds any `{ error }` into `SnapchefExternalSystemError`, returns `void`, and passes **no `emailRedirectTo`** because the committed template builds its link from `{{ .SiteURL }}` (`:105`).
- **`ResendConfirmation.tsx` is the precedent island** for an email-only request form (optional input, one Effect pipeline, one `runPromise`, inline success/error). `SignInForm.tsx` is the precedent for a credential form that redirects on success (`setPendingRedirect` + `useEffect`). `SignUpForm.tsx` is the precedent for a two-password form with `confirmPassword` + `.refine()`.
- **Supabase config.** `supabase/config.toml`: `enable_confirmations = true` (turned on by the merged change), `secure_password_change = false` (no reauth needed to change password), `otp_expiry = 3600` (1 h — governs recovery-link validity), `max_frequency = "1s"` (throttle), `site_url = "http://127.0.0.1:3000"`. A `[auth.email.template.confirmation]` block + `supabase/templates/confirmation.html` exist; the **recovery template block is absent / commented out** and `supabase/templates/recovery.html` does not exist. Local mail is captured by Inbucket (`http://127.0.0.1:54324`).
- **No browser Supabase client exists** (`src/lib/infrastructure/db/supabase.ts` is SSR-only) — and none is needed: redemption stays server-side.
- **Routing.** `PROTECTED_ROUTES = ["/recipes"]` (`src/middleware.ts:16`); all `/auth/*` and `/api/auth/*` paths are public by falling through to `next()`.
- **Tooling.** `pnpm test` (vitest), `pnpm lint` (type-checked ESLint), `pnpm build` (`astro build`, full type-check). No standalone `typecheck` script. Editing `config.toml` requires restarting the local Supabase stack.

## Desired End State

- A user clicks **"Forgot your password?"** on `/auth/signin`, enters their email, and is told a reset link is on its way _if an account exists_ (no account-existence disclosure).
- The recovery email (visible in Inbucket locally) links to `/auth/reset-password?token_hash=…&type=recovery`.
- That page presents a new-password form (new password + confirm). On submit, the server redeems the recovery token and sets the new password in one request; the user lands on `/recipes` already signed in.
- An invalid/expired/already-used link surfaces a clear "link is invalid or has expired" message with a path to request a fresh one.
- A committed runbook documents the production dashboard steps (recovery template + redirect allow-list).
- Code: `requestPasswordReset` and `resetPassword` exist end-to-end (port → adapter → UC → routes → pages → UI), unit-tested at the adapter and component level.

Verify: `pnpm lint`, `pnpm test`, `pnpm build` pass; the manual Inbucket flow above works against the local stack.

### Key Discoveries:

- **No site-URL plumbing in the adapter.** Like `resendConfirmation`, `resetPasswordForEmail` needs **no `redirectTo`** — the custom recovery template builds the link from `{{ .SiteURL }}`. (Discards the speculative `PUBLIC_SITE_URL` approach; that variable does not exist here.)
- **`verifyOtp(recovery)` → `updateUser` works within one request** because both run on the same request-scoped client: `verifyOtp` establishes the recovery session in memory (and writes the cookie), so the immediately-following `updateUser` is authenticated. See Critical Implementation Details.
- **The recovery token is single-use and consumed on `verifyOtp`** — so the callback page must NOT verify on GET; it renders the form and carries `token_hash` to the POST, where redemption happens exactly once.
- **No new error class needed.** Unlike sign-in (where 401 collides with bad-credentials and motivated `SnapchefEmailNotConfirmedError`), the reset route's 401 unambiguously means "link invalid/expired" — reuse `SnapchefAuthenticationError`.
- **Anti-enumeration is built in.** `resetPasswordForEmail` returns success whether or not the email exists, so the request route can always echo success.

## What We're NOT Doing

- **No browser Supabase client** and no client-side `verifyOtp`/`updateUser` — redemption stays server-side on the request-scoped client, consistent with the whole app.
- **No new domain error class** — 401/400/500 from the existing family cover every reset failure.
- **No reauthentication / "current password" step** (`secure_password_change = false`); reset is recovery-by-email, not in-app change-password.
- **No production config in this repo** — prod activation (recovery template upload, redirect allow-list) is a documented manual dashboard step; `config.toml` governs local only.
- **No middleware / route-guard changes** and no change to existing `signin.ts` / `signup.ts` redirect targets.
- **No PKCE `exchangeCodeForSession` flow, no custom SMTP locally** (Inbucket suffices), **no Playwright E2E** (manual mailbox verification; E2E remains a deferred follow-up, as in the email-verification change).
- **No "change password while logged in" surface** in the account UI — out of scope for FR-013 (recovery only).
- **No password-strength policy beyond the existing `min(6)`** shared with sign-up.

## Implementation Approach

Four phases in dependency order, mirroring the merged `email-verification-gating` change: (1) config + recovery template + prod runbook so local email works for manual testing throughout; (2) the framework-free domain pieces (schemas, port, UC) plus the Supabase mechanics in the adapter, unit-tested in isolation; (3) the two server routes; (4) the UI surfaces. Tests fold into each phase. Everything follows the existing hexagon — schemas in `core/boundry/auth`, Supabase mechanics in `infrastructure/auth`, thin routes/pages delegating to the UC from `context.locals`.

The reset is split into two sub-flows: **request** (`/auth/forgot-password` → `POST /api/auth/forgot-password` → `resetPasswordForEmail`) and **redeem** (`/auth/reset-password` callback → `POST /api/auth/reset-password` → `verifyOtp(recovery)` + `updateUser`).

## Critical Implementation Details

- **`verifyOtp(recovery)` and `updateUser` must run on the same request-scoped client, in this order.** `resetPassword` chains them inside the adapter; the client injected by `src/middleware.ts` (one per request) holds the recovery session after `verifyOtp`, so `updateUser({ password })` is authenticated within that same request. Never split the two across requests and never construct a second client. Pin the chain in the unit test against a fake `supabase.auth`, and confirm it once manually via Inbucket.
- **Do not redeem the token on GET.** `reset-password.astro` must not call `verifyOtp` on page load — that would burn the single-use recovery token (e.g. to email-link prefetchers) before the user submits, and prevent the form from working. The page only reads `token_hash` from the URL and passes it to the form island; redemption happens once, on POST.
- **`type` alignment.** The recovery template emits `&type=recovery`; the adapter passes `type: "recovery"` to `verifyOtp`. A mismatch yields a silent "Token has expired or is invalid". `otp_expiry = 3600` bounds validity.
- **Weak-password is a 422, not a 401.** `updateUser` can reject a password that passed the boundary `min(6)` (the remote project's policy may be stricter) with a `weak_password` `AuthApiError`. Classify it explicitly in `toAuthFailure` → `SnapchefBusinessRuleViolationError` (422) ahead of the generic 4xx→401 fold, so the reset form shows a password message rather than the "link expired" copy. Pin the `weak_password` code string in the unit test.
- **No `redirectTo` on `resetPasswordForEmail`.** The recovery template owns the link via `{{ .SiteURL }}` — mirror `resendConfirmation` (no `emailRedirectTo`).
- **Restart the local stack after editing `config.toml`** (`pnpm exec supabase stop && pnpm exec supabase start`) — template paths and auth settings are read at boot.

## Phase 1: Supabase Recovery Config, Email Template & Prod Runbook

### Overview

Register a custom recovery email template on the local stack so the reset link targets the app's own `/auth/reset-password` callback, and document the production dashboard steps that cannot live in this repo.

### Changes Required:

#### 1. Register the recovery template

**File**: `supabase/config.toml`

**Intent**: Wire the custom recovery email so its link carries `token_hash` to `/auth/reset-password` instead of the default Supabase endpoint.

**Contract**: Add a `[auth.email.template.recovery]` block mirroring the existing confirmation block:

```toml
[auth.email.template.recovery]
subject = "Reset your Snapchef password"
content_path = "./supabase/templates/recovery.html"
```

Leave `site_url` / `additional_redirect_urls` as-is — `/auth/reset-password` is same-origin under `site_url`, already an allowed target. `enable_confirmations`, `secure_password_change`, `otp_expiry`, `max_frequency` need no change.

#### 2. Recovery email template

**File**: `supabase/templates/recovery.html` (new)

**Intent**: Provide the HTML body whose reset link carries the `token_hash` to the app callback.

**Contract**: A minimal HTML email (model it on `supabase/templates/confirmation.html`) containing a link to `{{ .SiteURL }}/auth/reset-password?token_hash={{ .TokenHash }}&type=recovery`. Must use `{{ .TokenHash }}` (not `{{ .ConfirmationURL }}`) so the token_hash flow drives our own route. Polish user-facing copy, consistent with the confirmation template.

#### 3. Production activation runbook

**File**: `docs/runbooks/enable-password-reset-prod.md` (new)

**Intent**: Capture the manual hosted-dashboard steps so production sends recovery emails that point at our callback (`config.toml` governs only local).

**Contract**: A checklist covering — Authentication → Email Templates → "Reset Password": upload the same template with the `{{ .TokenHash }}` link; Authentication → URL Configuration: confirm Site URL = prod origin and the prod `/auth/reset-password` (https) is within the redirect allow-list; confirm an SMTP sender is configured (shared with the confirmation flow). Note the rollout sequence (ship code first — inert until the template is set — then upload the template) and that a Worker rollback does not revert the hosted auth setting. Reference the sibling `docs/runbooks/enable-email-confirmations-prod.md`. Include the same **Known limitations** note as the confirmation runbook: a `token_hash` link is single-use; here it is consumed on POST (not GET), so email-prefetchers do not burn it — recovery from an expired/used link is the "request a new reset" affordance.

### Success Criteria:

#### Automated Verification:

- Config parses / stack boots: `pnpm exec supabase stop && pnpm exec supabase start` succeeds.
- Repo still builds: `pnpm build`.

#### Manual Verification:

- After restart, triggering a reset (via the Phase 3/4 flow, or temporarily via the Supabase Studio "send recovery" action) produces an email in Inbucket (`http://127.0.0.1:54324`).
- The email's link points at `http://127.0.0.1:3000/auth/reset-password?token_hash=…&type=recovery`.
- `docs/runbooks/enable-password-reset-prod.md` reads as a complete, ordered checklist.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Boundary Schemas, Port, Adapter & Use Case

### Overview

Add the reset command/response schemas, declare the two new port operations, implement them in the Supabase adapter (reusing `liftAuthUser` / `toAuthFailure`), expose them on the UC, and unit-test the adapter.

### Changes Required:

#### 1. Boundary schemas

**File**: `src/lib/core/boundry/auth/commands.ts`

**Intent**: Inputs for the request and redeem operations, shared by routes/pages.

**Contract**: `RequestPasswordReset = UserCredentials.pick({ email: true })` (mirrors `ResendConfirmation`) and `ResetPassword = z.object({ tokenHash: z.string().min(1), newPassword: z.string().min(6) })` — both with same-name inferred types per `zod.md`. `newPassword.min(6)` mirrors `UserCredentials.password` so a weak password fails at the boundary as `SnapchefValidationError` (400) with `fieldErrors`, before reaching the adapter. `type` is not part of `ResetPassword` (the adapter hardcodes `"recovery"`; the URL `type` param is read only on the callback page).

**File**: `src/lib/core/boundry/auth/responses.ts`

**Intent**: Typed success payload for the request route so the client can validate the envelope.

**Contract**: `PasswordResetRequested = z.object({ email: z.email() })` (+ inferred type), mirroring `ConfirmationResent`. The redeem route reuses the existing `RedirectTarget`. (`index.ts` is a `export *` barrel — no edit.)

#### 2. Extend the port

**File**: `src/lib/core/boundry/auth/ports.ts`

**Intent**: Declare the two new driven-side operations on the contract.

**Contract**: Add to `Authenticator`: `requestPasswordReset(params: RequestPasswordReset): Effect.Effect<void, SnapchefServerError>` and `resetPassword(params: ResetPassword): Effect.Effect<SnapchefUser, SnapchefServerError>`. Import the new command types from `./commands` (type-only).

#### 3. Adapter: implement both operations

**File**: `src/lib/infrastructure/auth/SupabaseAuthenticator.ts`

**Intent**: Send the recovery email (request) and redeem the recovery token + set the new password (redeem), reusing existing helpers.

**Contract**:

- `requestPasswordReset` mirrors `resendConfirmation`: a bare `Effect.tryPromise` around `supabase.auth.resetPasswordForEmail(email)` (no `redirectTo` — the template owns the link), folding any thrown error or non-null `{ error }` into `SnapchefExternalSystemError`, returning `void`. `resetPasswordForEmail` succeeds regardless of account existence (anti-enumeration), so no special "not found" handling.
- Extend `toAuthFailure` with an `isWeakPassword` guard (`isAuthApiError(error) && error.code === "weak_password"`) → `SnapchefBusinessRuleViolationError` (422), checked **before** the generic `isAuthRejection` 4xx→401 fold (mirrors the existing `isEmailNotConfirmed` special-case at `SupabaseAuthenticator.ts:31,43`). Without it, an `updateUser` weak-password rejection (HTTP 422 `weak_password`) is mislabeled 401 — wrong by the "pick the error by meaning" convention and surfaced as a misleading "link expired" message in the UI. This matters because `dev` points at the **remote** Supabase project (see memory), whose password policy may exceed the local `minimum_password_length = 6`.
- `resetPassword` chains two `liftAuthUser` lifts: first `supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" })`, then `Effect.flatMap(() => liftAuthUser("Failed to update password")(() => supabase.auth.updateUser({ password: newPassword })))`. Both return `{ user }` decodable by the existing `AuthUser` schema; the final success is the updated `SnapchefUser`. Classification then falls out of `toAuthFailure`: expired/invalid recovery token → 401, weak password from `updateUser` → 422 (via the new guard), service/network → 500. Both calls use `.then(({ data, error }) => ({ data, error }))` to line up the lift signature, exactly like `confirmEmail`.
- Add both to the `createSupabaseAuthenticator` returned object.

#### 4. Use-case pass-throughs

**File**: `src/lib/core/uc/auth/AuthenticatorUC.ts`

**Intent**: Expose the new operations to the edges.

**Contract**: Add `requestPasswordReset(params)` and `resetPassword(params)` methods delegating to the port (mirroring the existing thin methods).

#### 5. Unit tests

**File**: `src/lib/infrastructure/auth/SupabaseAuthenticator.test.ts`

**Intent**: Pin the new lifts and their error classification against a fake `supabase.auth` (extend the existing test file).

**Contract**: With a fake `supabase.auth`: (a) `requestPasswordReset` success is `void`; (b) `requestPasswordReset` on a non-null `{ error }` / thrown fails `SnapchefExternalSystemError` (500); (c) `resetPassword` success (both `verifyOtp` and `updateUser` return a user) yields the decoded `SnapchefUser` and calls `updateUser` with the new password; (d) `resetPassword` with a 4xx `AuthApiError` from `verifyOtp` (expired/invalid token) fails `SnapchefAuthenticationError` (401) and does **not** call `updateUser`; (e) `resetPassword` with a 5xx/thrown fails `SnapchefExternalSystemError` (500); (f) `resetPassword` where `verifyOtp` succeeds but `updateUser` returns a 422 `weak_password` `AuthApiError` fails `SnapchefBusinessRuleViolationError` (422) — pinning the `weak_password` code string. Follow the existing test's fake-client setup.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`.
- Type-checked lint passes: `pnpm lint`.
- Build passes: `pnpm build`.

#### Manual Verification:

- None beyond automated (the live Supabase behavior is exercised manually in Phases 3–4).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Forgot-Password & Reset-Password Routes

### Overview

Add the two thin API routes: one that triggers the recovery email, one that redeems the token and sets the new password. Both delegate to the UC from `context.locals` through `runApiRoute`.

### Changes Required:

#### 1. Forgot-password route

**File**: `src/pages/api/auth/forgot-password.ts` (new)

**Intent**: Server endpoint the request form calls to send a recovery email.

**Contract**: `export const prerender = false`. `POST` via `runApiRoute(parseRequestBody(request, RequestPasswordReset).pipe(Effect.flatMap((body) => authenticator.requestPasswordReset(body).pipe(Effect.as<PasswordResetRequested>({ email: body.email })))))` — thread `email` through so the success payload echoes it (mirrors `resend.ts`). Returns the `PasswordResetRequested` envelope. Anti-enumeration is inherent (always succeeds for a well-formed email).

#### 2. Reset-password route

**File**: `src/pages/api/auth/reset-password.ts` (new)

**Intent**: Server endpoint the new-password form calls to redeem the token and set the password.

**Contract**: `export const prerender = false`. `POST` via `runApiRoute(parseRequestBody(request, ResetPassword).pipe(Effect.flatMap((body) => authenticator.resetPassword(body)), Effect.as<RedirectTarget>({ redirect: "/recipes" })))`. A successful `resetPassword` writes the session cookie via the request-scoped client (side effect of `verifyOtp`), so the `/recipes` redirect the client follows is authenticated. Failures surface as the typed envelope (`SnapchefAuthenticationError` 401 for bad/expired token, `SnapchefValidationError` 400 for weak password).

#### 3. Verify public-route exclusion

**File**: `src/middleware.ts` (verification only — expected no change)

**Intent**: Confirm `/auth/forgot-password`, `/auth/reset-password`, `/api/auth/forgot-password`, `/api/auth/reset-password` are reachable while anonymous.

**Contract**: All are outside `PROTECTED_ROUTES = ["/recipes"]`, so `resolveResponse` falls through to `next()`. Confirm no edit is required; if any guard regression is found, note it — do not broaden the guard.

### Success Criteria:

#### Automated Verification:

- Build passes (routes type-check, `prerender = false` present): `pnpm build`.
- Lint passes: `pnpm lint`.

#### Manual Verification:

- `POST /api/auth/forgot-password` with a known email returns `{ ok: true, data: { email } }` and a recovery email appears in Inbucket; a malformed email returns a `400` validation envelope.
- `POST /api/auth/reset-password` with a valid `token_hash` (copied from the Inbucket link) + a new password returns `{ ok: true, data: { redirect: "/recipes" } }` with a `Set-Cookie` session header; a tampered/expired `token_hash` returns a `401` envelope.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: UI Wiring (Forgot-Password & Reset-Password Pages + Islands, Sign-In Link)

### Overview

Add the user-facing surfaces: a "forgot password" request page + island, a "set new password" callback page + island, and the "Forgot your password?" entry link on sign-in.

### Changes Required:

#### 1. Forgot-password request island

**File**: `src/components/auth/ForgotPasswordForm.tsx` (new)

**Intent**: Collect an email and POST it to trigger the recovery email, reporting a neutral (anti-enumeration) success message.

**Contract**: React island modeled on `ResendConfirmation.tsx`: an email input + submit button, one Effect pipeline (`useApiClient().post("/api/auth/forgot-password", { email }, PasswordResetRequested)`), `Effect.catchAll(() => Effect.void)` + `Effect.ensuring` for the submitting flag, one `runPromise`. On `result.ok`, show "If an account exists for {email}, a password reset link is on its way." On `!result.ok`, show `result.error.fieldErrors?.email ?? result.error.message`. Default export (top-level feature component per `src/components/CLAUDE.md`).

#### 2. Forgot-password page

**File**: `src/pages/auth/forgot-password.astro` (new)

**Intent**: Host the request island.

**Contract**: `PublicLayout` card (model on `confirm-email.astro` / `signin.astro`), heading "Reset your password", short copy, `<ForgotPasswordForm client:load />`, and a "Back to sign in" link to `/auth/signin`.

#### 3. Reset-password (set new password) island

**File**: `src/components/auth/ResetPasswordForm.tsx` (new)

**Intent**: Collect a new password (with confirmation), POST it with the token, and land the user in the app on success.

**Contract**: React island taking a required `tokenHash: string` prop. Form model via `useZodForm` with `{ newPassword: min(6), confirmPassword }` + `.refine()` for equality (mirror `SignUpForm`'s confirm-password pattern and `PasswordToggle` usage). `onSubmit` posts `{ tokenHash, newPassword }` (strip `confirmPassword` client-side) via `useApiClient().post("/api/auth/reset-password", …, RedirectTarget)`; on `result.ok` set `pendingRedirect = result.data.redirect` and navigate via the `useEffect` redirect pattern from `SignInForm`; on `!result.ok` branch by `result.error.name` (mirroring `SignInForm`'s `error.name` branch): for `SnapchefBusinessRuleViolationError` (422 weak password) or any `result.error.fieldErrors`, surface the password message on the field / as a server message; for everything else (401 invalid/expired token) show "This reset link is invalid or has expired — request a new one." with a link to `/auth/forgot-password`. Default export.

#### 4. Reset-password callback page

**File**: `src/pages/auth/reset-password.astro` (new)

**Intent**: Receive the emailed link, present the new-password form, and handle a missing/garbage link gracefully — **without** redeeming the token on GET.

**Contract**: `export const prerender = false`. Read `token_hash` from `Astro.url.searchParams`. If present, render a `PublicLayout` card mounting `<ResetPasswordForm client:load tokenHash={tokenHash} />`. If absent, render the same generic error card as `confirm.astro` ("This link is invalid or has expired") linking to `/auth/forgot-password` and `/auth/signin`. Do NOT call `verifyOtp` / the UC here (redemption is the POST's job — see Critical Implementation Details).

#### 5. Sign-in entry link

**File**: `src/pages/auth/signin.astro`

**Intent**: Give users a way to start the reset.

**Contract**: Add a "Forgot your password?" link to `/auth/forgot-password`, alongside the existing sign-up link (static markup; no change to the `SignInForm` island).

#### 6. Component test (reset form)

**File**: `src/components/auth/ResetPasswordForm.test.tsx` (new)

**Intent**: Lock the success-redirect and invalid-link branches so an envelope change can't silently regress them.

**Contract**: Mock the transport: (a) an `ok:true` envelope with `data.redirect = "/recipes"` triggers the redirect path (assert `pendingRedirect` effect / navigation hook); (b) an `ok:false` envelope (e.g. `SnapchefAuthenticationError`) renders the "invalid or has expired" message + the "request a new one" link; (c) an `ok:false` envelope with `error.name = "SnapchefBusinessRuleViolationError"` renders the password-rejection message, NOT the "link expired" copy; (d) mismatched passwords are blocked by client validation before any POST. Follow the existing `SignInForm.test.tsx` / `ProductListEditor.test.tsx` setup.

### Success Criteria:

#### Automated Verification:

- Unit/component tests pass: `pnpm test`.
- Lint passes: `pnpm lint`.
- Build passes: `pnpm build`.

#### Manual Verification:

- "Forgot your password?" on `/auth/signin` opens the request page; submitting a known email shows the neutral success message and delivers a recovery email to Inbucket.
- Clicking the Inbucket link opens `/auth/reset-password` with the new-password form; submitting a valid new password lands on `/recipes` signed in; signing out and back in with the new password works.
- A reused/expired link (submit twice, or tamper the URL) shows the "invalid or has expired" message with a working "request a new one" link.
- Mismatched new/confirm passwords are rejected inline before submit.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation. This is the final phase.

---

## Testing Strategy

### Unit Tests:

- `SupabaseAuthenticator.test.ts` (extended) — `requestPasswordReset` (void / 500), `resetPassword` (success → decoded user + `updateUser` called; expired token → 401 with `updateUser` not called; 5xx/thrown → 500), against a fake `supabase.auth`.

### Component Tests:

- `ResetPasswordForm.test.tsx` — success-redirect branch, invalid-link branch, client-side password-mismatch guard.

### Manual Testing Steps:

1. Restart the local stack; from `/auth/signin` click "Forgot your password?", enter a known account's email → neutral success message; confirm a recovery email in Inbucket with a `/auth/reset-password?token_hash=…&type=recovery` link.
2. Click the link → new-password form; submit a valid new password → redirected into `/recipes`, authenticated.
3. Sign out, sign back in with the new password → success.
4. Re-click the now-consumed link (or tamper `token_hash`) → "invalid or has expired" message + "request a new one" link.
5. Submit mismatched new/confirm passwords → inline validation error, no network call.

### Edge cases to check manually:

- Rapid second reset request within `max_frequency` surfaces a non-fatal error (toast / message), not a crash.
- A request for an unknown email still shows the neutral success message (no account-existence disclosure) and sends no email.

## Performance Considerations

None of note. Each operation is a single user-initiated request with one or two Supabase auth calls, well within the app's existing latency envelope. No new hot paths.

## Migration Notes

- Forward-only; no schema or data migration (auth lives in Supabase's built-in `auth.users`). No `SnapchefUser` change.
- Rollout sequence: ship code first (inert in prod until the recovery template is uploaded in the dashboard), then upload the template per the runbook. A Worker rollback does not affect the hosted auth setting.

## References

- Prior art (near-mirror): `context/changes/email-verification-gating/plan.md`, `…/plan-brief.md`
- Prod runbook (created in Phase 1): `docs/runbooks/enable-password-reset-prod.md`; sibling: `docs/runbooks/enable-email-confirmations-prod.md`
- Auth adapter (helpers + classification): `src/lib/infrastructure/auth/SupabaseAuthenticator.ts:41-120`
- Token-redemption precedent: `src/pages/auth/confirm.astro`, `confirmEmail` at `SupabaseAuthenticator.ts:95-100`
- Email-send precedent: `resendConfirmation` at `SupabaseAuthenticator.ts:106-120`
- Island precedents: `src/components/auth/ResendConfirmation.tsx`, `SignInForm.tsx`, `SignUpForm.tsx`
- Config: `supabase/config.toml` ([auth.email] + templates), `supabase/templates/confirmation.html`
- Conventions: `docs/reference/conventions/{effect,api-server,api-client,ports-and-adapters,use-cases,zod,generic}.md`
- PRD/roadmap: FR-013 (`context/foundation/prd.md`), F-03 (`context/foundation/roadmap.md`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Supabase Recovery Config, Email Template & Prod Runbook

#### Automated

- [x] 1.1 Config parses / stack boots: `pnpm exec supabase stop && pnpm exec supabase start`
- [x] 1.2 Repo still builds: `pnpm build`

#### Manual

- [ ] 1.3 Triggering a reset produces a recovery email in Inbucket (`http://127.0.0.1:54324`)
- [ ] 1.4 Email link points at `http://127.0.0.1:3000/auth/reset-password?token_hash=…&type=recovery`
- [ ] 1.5 `docs/runbooks/enable-password-reset-prod.md` is a complete ordered checklist

### Phase 2: Boundary Schemas, Port, Adapter & Use Case

#### Automated

- [ ] 2.1 Unit tests pass: `pnpm test`
- [ ] 2.2 Type-checked lint passes: `pnpm lint`
- [ ] 2.3 Build passes: `pnpm build`

### Phase 3: Forgot-Password & Reset-Password Routes

#### Automated

- [ ] 3.1 Build passes (routes type-check, `prerender = false`): `pnpm build`
- [ ] 3.2 Lint passes: `pnpm lint`

#### Manual

- [ ] 3.3 `POST /api/auth/forgot-password` returns `{ ok: true, data: { email } }` + Inbucket email; malformed email → `400`
- [ ] 3.4 `POST /api/auth/reset-password` with a valid token + new password → `{ ok: true, data: { redirect: "/recipes" } }` + `Set-Cookie`; tampered token → `401`

### Phase 4: UI Wiring (Forgot-Password & Reset-Password Pages + Islands, Sign-In Link)

#### Automated

- [ ] 4.1 Unit/component tests pass: `pnpm test`
- [ ] 4.2 Lint passes: `pnpm lint`
- [ ] 4.3 Build passes: `pnpm build`

#### Manual

- [ ] 4.4 Full happy path: forgot-password → Inbucket link → set new password → signed in at `/recipes`; re-login with new password works
- [ ] 4.5 Reused/expired/tampered link shows "invalid or has expired" + working "request a new one" link
- [ ] 4.6 Mismatched new/confirm passwords rejected inline before submit
