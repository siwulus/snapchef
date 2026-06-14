# Email Verification Gating Implementation Plan

## Overview

Gate access to Snapchef behind email verification. Today email confirmation is effectively off (`enable_confirmations = false`), so a sign-up account is immediately usable and the verification scaffolding (`/auth/confirm-email`, the "unconfirmed → 401" comment in the adapter) is inert.

This change adopts the **Supabase-native hard-block** model: enabling confirmations means `signUp()` returns no session until the user clicks the email link, so unverified users simply cannot obtain a session. The link is redeemed by a dedicated SSR `/auth/confirm` route that calls `verifyOtp`, establishes the cookie session, and lands the user in `/recipes`. A sign-in attempt by an unverified user fails with a new distinct error (`SnapchefEmailNotConfirmedError`, 403) that the UI turns into an inline "verify your email" message with a resend affordance.

## Current State Analysis

- **Confirmations are disabled.** `supabase/config.toml` → `[auth.email] enable_confirmations = false`. Sign-up auto-confirms; no email is sent. `site_url = "http://127.0.0.1:3000"`, `additional_redirect_urls = ["https://127.0.0.1:3000"]`. No custom email templates configured. Local mail is captured by Inbucket (`[inbucket] enabled = true`, web UI on port `54324`). `max_frequency = "1s"` throttles confirmation/reset emails.
- **No verification state in the domain.** `SnapchefUser` (`src/lib/core/model/auth/index.ts`) is `{ id, email? }`. The `AuthUser` wire schema in `SupabaseAuthenticator.ts:22-24` extracts only `{ user }` and drops `email_confirmed_at`. Under the hard-block model this stays unchanged — there is no logged-in-but-unverified session to inspect.
- **Adapter error classification.** `SupabaseAuthenticator.ts:31-37` — `isAuthRejection` folds every 4xx `AuthApiError` (plus `AuthSessionMissingError`) into `SnapchefAuthenticationError` (401); everything else → `SnapchefExternalSystemError` (500). The inline comment at line 27 already anticipates "unconfirmed email" but that branch is never exercised today.
- **Auth surface.** Port `Authenticator` (`core/boundry/auth/ports.ts`) = `signIn|signUp|signOut|getUser`. `AuthenticatorUC` is a thin pass-through. `UserCredentials = { email, password>=6 }` (`commands.ts`); `RedirectTarget = { redirect }` (`responses.ts`); barrel re-exports all three (`index.ts`).
- **Routes.** `signup.ts` → `authenticator.signUp` then `Effect.as({ redirect: "/auth/confirm-email" })`. `signin.ts` → `signIn` then `{ redirect: "/recipes" }`. `signout.ts` → redirect `/`. All use `runApiRoute` + `parseRequestBody`. There is **no** confirmation callback route.
- **Gating.** `src/middleware.ts:16` `PROTECTED_ROUTES = ["/recipes"]`; `resolveResponse` (`:73-76`) redirects `[protected, null-user]` → `/auth/signin`, else `next()`. `/auth/*` is public. `setUserInContext` fails open to anonymous.
- **`confirm-email.astro`** picks its copy from `import.meta.env.DEV` ("Registration successful" in dev vs "Check your email" in prod) — a wrong heuristic once confirmations are on; it never processes a token and has no resend.
- **Client transport.** `post(url, body, dataSchema)` (`components/api/http.ts`) returns the full `ApiResponsePayload`; the error branch is `{ ok:false, error: { name, code, message, cause?, fieldErrors? } }` where `name` is the server error `_tag`. `SignInForm.tsx` reads only `error.message` + `error.fieldErrors` today — it does **not** branch on `error.name`. `useApiClient().post` decorates with an error toast and stays in Effect.
- **Tooling.** `pnpm test` → `vitest run` (config at `vitest.config.ts`; examples: `src/lib/utils/effect.test.ts`, `src/components/recipes/wizard/ProductListEditor.test.tsx`). `pnpm lint` runs type-checked ESLint. `pnpm build` runs `astro build` (full type-check). No standalone `typecheck` script. Config changes require restarting the local Supabase stack.

## Desired End State

- Local: signing up sends a confirmation email (visible in Inbucket); the account cannot sign in until the link is clicked; clicking `/auth/confirm?token_hash=…&type=…` establishes a session and lands on `/recipes`; an unconfirmed sign-in shows an inline "verify your email" message with a working resend button; resending delivers a fresh link.
- Production: a committed runbook documents the exact Supabase dashboard steps (enable confirmations, Site URL / redirect allow-list, custom SMTP, email template) so the gate engages in prod.
- Code: a new `SnapchefEmailNotConfirmedError` (403) is part of the `SnapchefServerError` union; the auth adapter classifies Supabase's `email_not_confirmed` into it; `confirmEmail` and `resendConfirmation` exist end-to-end (port → adapter → UC → route/page → UI).

Verify: `pnpm lint`, `pnpm test`, `pnpm build` all pass; the manual flow above works against the local stack.

### Key Discoveries:

- Hard-block needs **no** `SnapchefUser` change and **no** middleware change — Supabase prevents the unverified session, so there is nothing to soft-gate (`middleware.ts:73-76` stays as-is; `/auth/confirm` and `/auth/confirm-email` are already public, being outside `/recipes`).
- The brittle seam is **error-code classification**: Supabase returns the unconfirmed-sign-in failure as an `AuthApiError`. The exact discriminator (`error.code === "email_not_confirmed"` vs status/message) must be pinned against the installed `@supabase/supabase-js` — see Critical Implementation Details.
- The second brittle seam is **template `type` ⇄ `verifyOtp` type alignment**: the link's `type` query param must match the `EmailOtpType` passed to `verifyOtp`. The "Confirm signup" flow uses `type=email` (token_hash flow) — pin and test it.
- `signUp()` still returns `{ user, session: null }` with confirmations on, so the existing `AuthUser` decoder and the `signup.ts` → `/auth/confirm-email` redirect keep working unchanged.
- The client already exposes `error.name` on the envelope — `SignInForm` only needs to start reading it; no new client error class is required.

## What We're NOT Doing

- **No app-level soft gating** / no `profiles.email_verified` flag / no `emailConfirmedAt` on `SnapchefUser` (rejected: dead surface under the native block).
- **No forced re-verification** of existing accounts — accounts created while confirmations were off are already auto-confirmed and stay signed-in-capable. Forward-only.
- **No middleware/route-guard changes** and no change to `signin.ts` / `signup.ts` redirect targets.
- **No production config in this repo** — prod activation is a documented manual dashboard step (config.toml only governs local).
- **No PKCE `exchangeCodeForSession` flow**, no custom SMTP wiring locally (Inbucket suffices), and **no Playwright E2E** in this change (manual mailbox verification; E2E is a follow-up).
- No password-reset / magic-link / email-change flows — confirmation (signup) only.

## Implementation Approach

Four phases in dependency order: (1) config + template so local email works for manual testing throughout; (2) the framework-free domain pieces (error + port/adapter/UC) that are unit-testable in isolation; (3) the server edges that redeem the link and resend; (4) the UI surfaces. Tests are folded into each phase. The whole feature follows the existing hexagon: schemas in `core/boundry/auth`, the error in `core/model/error`, the Supabase mechanics in `infrastructure/auth`, thin routes/pages delegating to the UC from `context.locals`.

## Critical Implementation Details

- **Pin the unconfirmed-sign-in discriminator.** When `enable_confirmations` is on, `signInWithPassword` for an unconfirmed user returns an `AuthApiError`. Classify on the stable error **code** (`isAuthApiError(error) && error.code === "email_not_confirmed"`) rather than the human message. Verify the exact `code` string and HTTP `status` against the pinned `@supabase/supabase-js` version by inspecting a real failure (Inbucket flow) and assert it in a unit test. This branch must be checked **before** the generic `isAuthRejection` 4xx→401 fold, otherwise it gets swallowed as a plain 401.
- **Template `type` must equal the `verifyOtp` type.** The confirmation email links to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`; the callback passes that `type` straight into `supabase.auth.verifyOtp({ token_hash, type })`. Keep both at `email` and pin with a test that a known token+type verifies. A mismatch yields a silent "Token has expired or is invalid".
- **Cookie session is set by the SSR client during `verifyOtp`.** The callback must call through the same request-scoped Supabase client wired in middleware (`Astro.locals.authenticator`), which holds the `cookies.setAll` handler — so a successful `verifyOtp` writes the session cookie onto the response, and the subsequent redirect to `/recipes` is authenticated. Do not create a second client in the page.
- **Restart the local stack after editing `config.toml`** (`pnpm exec supabase stop && pnpm exec supabase start`) — `enable_confirmations` and template paths are read at boot.

## Phase 1: Supabase Confirmation Config, Email Template & Prod Runbook

### Overview

Enable email confirmations on the local stack, point the confirmation link at the app's own callback via a custom template, and document the production dashboard steps that cannot live in this repo.

### Changes Required:

#### 1. Enable confirmations + register the template

**File**: `supabase/config.toml`

**Intent**: Turn on the gate locally and wire the custom confirmation email so its link targets `/auth/confirm` instead of the default Supabase verify endpoint.

**Contract**: In `[auth.email]` set `enable_confirmations = true`. Add a new block:

```toml
[auth.email.template.confirmation]
subject = "Confirm your Snapchef account"
content_path = "./supabase/templates/confirmation.html"
```

Leave `site_url`/`additional_redirect_urls` as-is — `/auth/confirm` is same-origin under `site_url`, so it is already an allowed redirect target. (`max_frequency = "1s"` already throttles resends.)

#### 2. Confirmation email template

**File**: `supabase/templates/confirmation.html` (new)

**Intent**: Provide the HTML body whose confirmation link carries the `token_hash` to the app callback.

**Contract**: A minimal HTML email containing a link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`. Must use `{{ .TokenHash }}` (not `{{ .ConfirmationURL }}`) so the token_hash flow drives our own route.

#### 3. Production activation runbook

**File**: `docs/runbooks/enable-email-confirmations-prod.md` (new)

**Intent**: Capture the manual hosted-dashboard steps so production actually enforces verification (config.toml governs only local).

**Contract**: A checklist covering — Authentication → Providers → Email: enable "Confirm email"; Authentication → URL Configuration: Site URL = prod origin, add prod `/auth/confirm` (https) to redirect allow-list; configure a production SMTP sender (Inbucket is local-only); upload the same confirmation template with the `{{ .TokenHash }}` link; note the rollout sequence (ship code first — inert until the toggle — then flip) and that existing accounts remain confirmed.

Include a **Known limitations** note: the `token_hash` link is single-use and consumed on GET, so email-link prefetchers (Outlook SafeLinks, corporate AV/scanners) can burn the token before the user clicks — a valid signup then lands on the "invalid/expired" card. This is invisible locally (Inbucket never prefetches). Recovery is the existing **resend** affordance on the error card / sign-in / confirm-email page. A confirm-button landing or PKCE flow would harden this but is an explicit follow-up, not part of this change.

### Success Criteria:

#### Automated Verification:

- Config parses / stack boots: `pnpm exec supabase start` succeeds after `pnpm exec supabase stop`.
- Repo still builds: `pnpm build`.

#### Manual Verification:

- After restart, signing up via the UI produces a confirmation email visible in Inbucket (`http://127.0.0.1:54324`).
- The email's link points at `http://127.0.0.1:3000/auth/confirm?token_hash=…&type=email`.
- Signing in before clicking the link is rejected by Supabase (observe the raw `AuthApiError` — record its `code`/`status` for Phase 2).
- `docs/runbooks/enable-email-confirmations-prod.md` reads as a complete, ordered checklist.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Domain Error, Auth Adapter, Port & Use Case

### Overview

Introduce the distinct verification error, classify Supabase's unconfirmed-sign-in failure into it, and add the `confirmEmail` and `resendConfirmation` capabilities through the port → adapter → UC chain, with their boundary schemas.

### Changes Required:

#### 1. New domain error

**File**: `src/lib/core/model/error/index.ts`

**Intent**: A meaning-specific 403 the client can match by name to show the verify+resend UI, instead of conflating with bad-credentials 401.

**Contract**: `export class SnapchefEmailNotConfirmedError extends Data.TaggedError("SnapchefEmailNotConfirmedError")<{ readonly message: string; readonly cause?: unknown }> { readonly code = 403 as const }`, added as a member of the `SnapchefServerError` union. No mapper edits needed (the boundary mapper is generic over `code`).

#### 2. Boundary schemas

**File**: `src/lib/core/boundry/auth/commands.ts`

**Intent**: Inputs for the two new operations, shared by routes/pages.

**Contract**: `EmailConfirmation = z.object({ tokenHash: z.string().min(1), type: z.literal("email") })` (+ inferred type, same-name). `type` is narrowed to the single value the confirmation template emits (`&type=email`) so the template↔`verifyOtp` contract is enforced in one place and a crafted `?type=recovery` is rejected at the boundary; widen the literal to a `z.enum([...])` only if/when recovery or email-change reuse this route (out of scope here). `ResendConfirmation = UserCredentials.pick({ email: true })` (+ inferred type).

**File**: `src/lib/core/boundry/auth/responses.ts`

**Intent**: Typed success payload for the resend route so the client can validate the envelope.

**Contract**: `ConfirmationResent = z.object({ email: z.email() })` (+ inferred type). (`index.ts` is a `export *` barrel — no edit needed.)

#### 3. Extend the port

**File**: `src/lib/core/boundry/auth/ports.ts`

**Intent**: Declare the two new driven-side operations on the contract.

**Contract**: Add to `Authenticator`: `confirmEmail(params: EmailConfirmation): Effect.Effect<SnapchefUser, SnapchefServerError>` and `resendConfirmation(email: ResendConfirmation): Effect.Effect<void, SnapchefServerError>`. Import the new command types from `./commands` (type-only).

#### 4. Adapter: classify + implement

**File**: `src/lib/infrastructure/auth/SupabaseAuthenticator.ts`

**Intent**: Map the unconfirmed-sign-in failure to the new error, and implement `confirmEmail` (token_hash verify) and `resendConfirmation` (resend).

**Contract**:

- Extend `toAuthFailure` so an `AuthApiError` with the pinned `email_not_confirmed` code returns `SnapchefEmailNotConfirmedError` — checked **before** the existing 4xx→`SnapchefAuthenticationError` fold (see Critical Implementation Details).
- `confirmEmail` lifts `supabase.auth.verifyOtp({ token_hash: params.tokenHash, type: params.type })` through the existing `liftAuthUser` helper (reuses the `AuthUser` `{ user }` decoder; `verifyOtp` returns `{ user, session }`).
- `resendConfirmation` lifts `supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: <site>/auth/confirm } })`. It returns only `{ error }` (no decodable user) — use a bare `Effect.tryPromise` with a `SnapchefExternalSystemError` catch (the sanctioned auth exception in `effect.md`), mapping `error` likewise. Add both to the `createSupabaseAuthenticator` returned object.

#### 5. Use-case pass-throughs

**File**: `src/lib/core/uc/auth/AuthenticatorUC.ts`

**Intent**: Expose the new operations to the edges.

**Contract**: Add `confirmEmail(params)` and `resendConfirmation(email)` methods delegating to the port (mirroring the existing thin methods).

#### 6. Unit tests

**File**: `src/lib/infrastructure/auth/SupabaseAuthenticator.test.ts` (new)

**Intent**: Pin the brittle classification and the new lifts against a faked Supabase auth client.

**Contract**: With a fake `supabase.auth` returning `{ data, error }`: (a) `signIn` on an `email_not_confirmed` `AuthApiError` fails `SnapchefEmailNotConfirmedError` (403); (b) a generic 4xx `AuthApiError` still fails `SnapchefAuthenticationError` (401); (c) a 5xx/thrown still fails `SnapchefExternalSystemError` (500); (d) `confirmEmail` success yields the decoded `SnapchefUser`; (e) `resendConfirmation` success is `void`, failure is `SnapchefExternalSystemError`.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`.
- Type-checked lint passes: `pnpm lint`.
- Build passes: `pnpm build`.

#### Manual Verification:

- The `email_not_confirmed` classification matches a real failure captured in Phase 1 (code/status confirmed in the test).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Confirmation Callback Page & Resend Route

### Overview

Add the SSR route that redeems the email link and the API route that resends it. Both are thin edges delegating to the UC from `context.locals`/`Astro.locals`.

### Changes Required:

#### 1. Confirmation callback page

**File**: `src/pages/auth/confirm.astro` (new)

**Intent**: Redeem `token_hash`/`type` from the link, establish the session cookie, and land the user in the app; on failure show a recoverable error.

**Contract**: `export const prerender = false`. Read `token_hash` + `type` from `Astro.url.searchParams`, decode with `EmailConfirmation` via `decodeWith`, call `Astro.locals.authenticator.confirmEmail(params)`. Collapse both channels with `Effect.match` into a success/failure discriminator, then run the resulting (non-failing) Effect through `runWithLogging` from `@/lib/infrastructure/logging/logger` — **not** a bare `Effect.runPromise`. `runWithLogging` is the shared logger runtime used at every other Effect edge (`runApiRoute`, `src/middleware.ts`); this page is a deliberately-sanctioned new edge, so it must use the same runtime for consistent observability. Branch on the awaited result: success → `Astro.redirect("/recipes")`; failure → render a `PublicLayout` error card ("This link is invalid or has expired") linking to `/auth/signin` and `/auth/confirm-email` (resend). Must use the request-scoped client (no second `createClient`).

#### 2. Resend route

**File**: `src/pages/api/auth/resend.ts` (new)

**Intent**: Server endpoint the UI calls to re-send the confirmation email.

**Contract**: `export const prerender = false`. `POST` via `runApiRoute(parseRequestBody(request, ResendConfirmation).pipe(Effect.flatMap((body) => authenticator.resendConfirmation(body)), Effect.as<ConfirmationResent>({ email: body.email })))` (thread `email` through so the success payload echoes it). Returns the `ConfirmationResent` envelope.

#### 3. Verify public-route exclusion

**File**: `src/middleware.ts` (verification only — expected no change)

**Intent**: Confirm `/auth/confirm` and `/api/auth/resend` remain reachable while anonymous.

**Contract**: Both paths are outside `PROTECTED_ROUTES = ["/recipes"]`, so `resolveResponse` falls through to `next()`. Confirm no edit is required; if any guard regression is found, note it — do not broaden the guard.

### Success Criteria:

#### Automated Verification:

- Build passes (routes type-check, `prerender = false` present): `pnpm build`.
- Lint passes: `pnpm lint`.

#### Manual Verification:

- Clicking the Inbucket confirmation link hits `/auth/confirm`, sets the session, and redirects to `/recipes` already signed in.
- A tampered/expired `token_hash` renders the error card with working sign-in / resend links.
- `POST /api/auth/resend` with a known unconfirmed email returns `{ ok: true, data: { email } }` and a fresh email appears in Inbucket.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: UI Wiring (Confirm-Email Page, Resend Island, Sign-In)

### Overview

Make the user-facing surfaces correct: a truthful confirm-email page with resend, a reusable resend component, and a sign-in form that recognizes the verification error and offers inline recovery.

### Changes Required:

#### 1. Reusable resend component

**File**: `src/components/auth/ResendConfirmation.tsx` (new)

**Intent**: One place that POSTs to `/api/auth/resend` and reports status, usable both standalone and embedded in the sign-in form.

**Contract**: React island. Optional `defaultEmail?: string` prop. If `defaultEmail` is present, render a "Resend confirmation email" button operating on it; otherwise render an email input + button. Submit via `useApiClient().post("/api/auth/resend", { email }, ConfirmationResent)`, branch on `result.ok`, show a success/error message (follow `SignInForm`'s envelope pattern; `useApiClient` already toasts transport errors). Default export per `src/components/CLAUDE.md` (top-level feature component).

#### 2. Confirm-email page corrected

**File**: `src/pages/auth/confirm-email.astro`

**Intent**: Stop guessing from `import.meta.env.DEV`; always tell the user to check their email and let them resend.

**Contract**: Remove the `isAutoConfirmed` branch and its dev copy; keep the single "Check your email" content. Mount `<ResendConfirmation client:load />` (no `defaultEmail` — user enters their address) below the copy, alongside the existing "Back to sign in" link.

#### 3. Sign-in recognizes the verification error

**File**: `src/components/auth/SignInForm.tsx`

**Intent**: When sign-in fails because the email is unconfirmed, show a clear message and an inline resend instead of a generic server error.

**Contract**: In `handleSubmitResponse`, on `!result.ok` branch on `result.error.name === "SnapchefEmailNotConfirmedError"` → set a `notConfirmed` flag (and a friendly message) rather than the raw server message; otherwise keep current behavior. When `notConfirmed`, render `<ResendConfirmation defaultEmail={form.getValues("email")} />` near `ServerError`. Reset the flag at the top of `onSubmit` (alongside `setServerMessage(null)`).

#### 4. Component test (sign-in branch)

**File**: `src/components/auth/SignInForm.test.tsx` (new)

**Intent**: Lock the error-name branch so a future envelope change can't silently regress it.

**Contract**: Mock the transport to return an `ok:false` envelope with `error.name = "SnapchefEmailNotConfirmedError"`; assert the verify message + resend control render; assert a generic `ok:false` (e.g. `SnapchefAuthenticationError`) renders only the server message. Follow the existing `ProductListEditor.test.tsx` setup.

### Success Criteria:

#### Automated Verification:

- Unit/component tests pass: `pnpm test`.
- Lint passes: `pnpm lint`.
- Build passes: `pnpm build`.

#### Manual Verification:

- Signing in as an unconfirmed user shows the inline "verify your email" message + resend (not a raw error); resend delivers a new email to Inbucket.
- `confirm-email.astro` shows "Check your email" in dev (no longer "Registration successful") with a working resend.
- After confirming and signing in, a confirmed user reaches `/recipes` normally (no regression).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation. This is the final phase.

---

## Testing Strategy

### Unit Tests:

- `SupabaseAuthenticator.test.ts` — error classification (`email_not_confirmed` → 403; generic 4xx → 401; 5xx/thrown → 500) and the `confirmEmail`/`resendConfirmation` lifts, against a fake `supabase.auth`.
- `SignInForm.test.tsx` — the `error.name` branch (verify+resend vs generic server message).

### Integration / Manual Testing Steps:

1. Restart the local stack; sign up with a fresh email; confirm an email lands in Inbucket with a `/auth/confirm?token_hash=…&type=email` link.
2. Attempt sign-in before confirming → inline verify message + resend; click resend → second email arrives.
3. Click the confirmation link → redirected into `/recipes`, authenticated.
4. Sign out, sign back in with the now-confirmed account → success.
5. Manually corrupt the `token_hash` in the URL → `/auth/confirm` error card with sign-in/resend links.

### Edge cases to check manually:

- Resend throttling: a rapid second resend within `max_frequency` surfaces a non-fatal error (toast / message), not a crash.
- Re-using an already-consumed confirmation link → error card (token already used).

## Migration Notes

- Forward-only. Accounts created while `enable_confirmations` was off are already auto-confirmed and keep signing in. No data migration, no `SnapchefUser`/DB change.
- Rollout sequence: this code is inert in production until the dashboard toggle is flipped (signup still redirects to `/auth/confirm-email`, but Supabase still auto-confirms until then). Ship code first, then flip the toggle per the runbook — a Worker rollback does not affect the hosted auth setting.

## References

- Prod activation runbook (created in Phase 1): `docs/runbooks/enable-email-confirmations-prod.md`
- Auth adapter / classification: `src/lib/infrastructure/auth/SupabaseAuthenticator.ts:31-56`
- Error family + union: `src/lib/core/model/error/index.ts:82-93`
- Route guard: `src/middleware.ts:16,73-76`
- Envelope error branch (client): `src/components/auth/SignInForm.tsx:43-57`, `src/components/api/http.ts:38-48`
- Conventions: `docs/reference/conventions/{effect,api-server,api-client,ports-and-adapters,use-cases}.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Supabase Confirmation Config, Email Template & Prod Runbook

#### Automated

- [x] 1.1 Config parses / stack boots: `pnpm exec supabase stop && pnpm exec supabase start` — 92388dff1
- [x] 1.2 Repo still builds: `pnpm build` — 92388dff1

#### Manual

- [x] 1.3 Sign-up produces a confirmation email in Inbucket (`http://127.0.0.1:54324`) — 92388dff1
- [x] 1.4 Email link points at `http://127.0.0.1:3000/auth/confirm?token_hash=…&type=email` — 92388dff1
- [x] 1.5 Pre-confirmation sign-in is rejected; record the `AuthApiError` `code`/`status` (verified: HTTP 400, `error_code = "email_not_confirmed"`) — 92388dff1
- [x] 1.6 `docs/runbooks/enable-email-confirmations-prod.md` is a complete ordered checklist — 92388dff1

### Phase 2: Domain Error, Auth Adapter, Port & Use Case

#### Automated

- [x] 2.1 Unit tests pass: `pnpm test` — 035b516c3
- [x] 2.2 Type-checked lint passes: `pnpm lint` — 035b516c3
- [x] 2.3 Build passes: `pnpm build` — 035b516c3

#### Manual

- [x] 2.4 `email_not_confirmed` classification matches the real failure captured in Phase 1 (HTTP 400, `code = "email_not_confirmed"`; pinned in `SupabaseAuthenticator.test.ts`) — 035b516c3

### Phase 3: Confirmation Callback Page & Resend Route

#### Automated

- [x] 3.1 Build passes (routes type-check, `prerender = false`): `pnpm build` — 4e6259bab
- [x] 3.2 Lint passes: `pnpm lint` — 4e6259bab

#### Manual

- [x] 3.3 Inbucket link → `/auth/confirm` sets session and redirects to `/recipes` signed in (verified: `302 → /recipes` + `Set-Cookie: sb-…-auth-token`, dev server pointed at the local stack) — 4e6259bab
- [x] 3.4 Tampered/expired `token_hash` renders the error card with working links (verified: `200` with "This link is invalid or has expired" + resend/sign-in links) — 4e6259bab
- [x] 3.5 `POST /api/auth/resend` returns `{ ok: true, data: { email } }` and a fresh Inbucket email (verified through the running app; invalid email → `400` validation envelope) — 4e6259bab

### Phase 4: UI Wiring (Confirm-Email Page, Resend Island, Sign-In)

#### Automated

- [x] 4.1 Unit/component tests pass: `pnpm test`
- [x] 4.2 Lint passes: `pnpm lint`
- [x] 4.3 Build passes: `pnpm build`

#### Manual

- [x] 4.4 Unconfirmed sign-in shows inline verify message + working resend (verified: `/api/auth/signin` → `403 SnapchefEmailNotConfirmedError` envelope; `SignInForm.test.tsx` locks the verify-message + resend render on that envelope)
- [x] 4.5 `confirm-email.astro` shows "Check your email" in dev with working resend (verified: server HTML shows "Check your email" + mounted resend island; the `import.meta.env.DEV` guess copy removed)
- [x] 4.6 Confirmed user reaches `/recipes` with no regression (verified: `/api/auth/signin` for a confirmed user → `{ ok: true, data: { redirect: "/recipes" } }`)
