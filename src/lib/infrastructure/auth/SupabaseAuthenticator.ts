import type {
  Authenticator,
  EmailConfirmation,
  RequestPasswordReset,
  ResendConfirmation,
  ResetPassword,
  UserCredentials,
} from "@/lib/core/boundry/auth";
import { SnapchefUser } from "@/lib/core/model/auth";
import {
  SnapchefAuthenticationError,
  SnapchefBusinessRuleViolationError,
  SnapchefEmailNotConfirmedError,
  SnapchefExternalSystemError,
  type SnapchefServerError,
} from "@/lib/core/model/error";
import type { Database } from "@/lib/infrastructure/db/types";
import { decodeWith } from "@/lib/utils/effect";
import {
  isAuthApiError,
  isAuthSessionMissingError,
  type SignInWithPasswordCredentials,
  type SignUpWithPasswordCredentials,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { Effect } from "effect";
import { match } from "ts-pattern";
import { z } from "zod";

// Supabase Auth wraps the user behind a `data.user` envelope. This wire schema is a
// Supabase response detail and lives with the adapter, never in core.
const AuthUser = z.object({
  user: SnapchefUser,
});

// An unconfirmed-email sign-in (with enable_confirmations on) surfaces as an AuthApiError carrying
// the stable `email_not_confirmed` code (HTTP 400 — verified against @supabase/supabase-js@2.106.2).
// It must be classified BEFORE the generic 4xx fold below, otherwise it is swallowed as a plain 401.
const isEmailNotConfirmed = (error: unknown): boolean => isAuthApiError(error) && error.code === "email_not_confirmed";

// updateUser can reject a password that cleared the boundary min(6) when the (remote) project's
// policy is stricter — a `weak_password` AuthApiError (HTTP 422). It must be classified BEFORE the
// generic 4xx fold below, otherwise it is swallowed as a plain 401 ("link expired") instead of a
// 422 the reset form can surface as a password message.
const isWeakPassword = (error: unknown): boolean => isAuthApiError(error) && error.code === "weak_password";

// A genuine auth rejection — a missing session (getUser on an anonymous request) or a
// 4xx AuthApiError (bad credentials) — maps to 401. Note a missing session surfaces as
// AuthSessionMissingError, which is NOT an AuthApiError, so it needs its own guard. Everything
// else (5xx, AuthRetryableFetchError / network, non-auth or thrown) is an infrastructure failure
// → 500. The cause is always forwarded.
const isAuthRejection = (error: unknown): boolean =>
  isAuthSessionMissingError(error) || (isAuthApiError(error) && error.status < 500);

const toAuthFailure = (error: unknown, message: string): SnapchefServerError =>
  match(error)
    .when(isEmailNotConfirmed, (cause) => new SnapchefEmailNotConfirmedError({ message, cause }))
    .when(isWeakPassword, (cause) => new SnapchefBusinessRuleViolationError({ message, cause }))
    .when(isAuthRejection, (cause) => new SnapchefAuthenticationError({ message, cause }))
    .otherwise((cause) => new SnapchefExternalSystemError({ message: "Authentication service failed", cause }));

const liftAuthUser =
  (authMessage: string) =>
  (fn: () => PromiseLike<{ data: unknown; error: unknown }>): Effect.Effect<SnapchefUser, SnapchefServerError> =>
    Effect.tryPromise({
      try: fn,
      catch: (cause) => new SnapchefExternalSystemError({ message: "Authentication service failed", cause }),
    }).pipe(
      Effect.flatMap(({ data, error }) =>
        error
          ? Effect.fail(toAuthFailure(error, authMessage))
          : decodeWith(AuthUser)(data).pipe(
              Effect.mapError(
                (cause) => new SnapchefExternalSystemError({ message: "Unexpected authentication response", cause }),
              ),
            ),
      ),
      Effect.map(({ user }) => user),
    );

const signIn =
  (supabase: SupabaseClient) =>
  (credentials: UserCredentials): Effect.Effect<SnapchefUser, SnapchefServerError> =>
    liftAuthUser("Failed to sign in")(() =>
      supabase.auth
        .signInWithPassword(credentials as SignInWithPasswordCredentials)
        .then(({ data, error }) => ({ data, error })),
    );

const signUp =
  (supabase: SupabaseClient) =>
  (credentials: UserCredentials): Effect.Effect<SnapchefUser, SnapchefServerError> =>
    liftAuthUser("Failed to sign up")(() =>
      supabase.auth.signUp(credentials as SignUpWithPasswordCredentials).then(({ data, error }) => ({ data, error })),
    );

const getUser = (supabase: SupabaseClient) => (): Effect.Effect<SnapchefUser, SnapchefServerError> =>
  liftAuthUser("Failed to get user")(() => supabase.auth.getUser().then(({ data, error }) => ({ data, error })));

const signOut = (supabase: SupabaseClient) => (): Effect.Effect<void, SnapchefServerError> =>
  Effect.tryPromise({
    try: () => supabase.auth.signOut(),
    catch: (cause) => new SnapchefExternalSystemError({ message: "Authentication service failed", cause }),
  }).pipe(Effect.asVoid);

// Redeems the confirmation link's token_hash. `type` ("email") must match the &type emitted by the
// confirmation template — it is narrowed to that single literal at the boundary (EmailConfirmation).
// verifyOtp returns { user, session }; reuse the AuthUser { user } decoder via liftAuthUser, and the
// request-scoped client writes the session cookie as a side effect of a successful verify.
const confirmEmail =
  (supabase: SupabaseClient) =>
  ({ tokenHash, type }: EmailConfirmation): Effect.Effect<SnapchefUser, SnapchefServerError> =>
    liftAuthUser("Failed to confirm email")(() =>
      supabase.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ data, error }) => ({ data, error })),
    );

// Re-sends the signup confirmation email. `resend` returns only { error } with no decodable user, so
// it uses a bare tryPromise (the sanctioned auth exception in effect.md) and folds any failure —
// thrown or a non-null { error } such as the max_frequency throttle — into SnapchefExternalSystemError.
// The committed template builds its link from {{ .SiteURL }}, so no emailRedirectTo is needed.
const resendConfirmation =
  (supabase: SupabaseClient) =>
  ({ email }: ResendConfirmation): Effect.Effect<void, SnapchefServerError> =>
    Effect.tryPromise({
      try: () => supabase.auth.resend({ type: "signup", email }),
      catch: (cause) => new SnapchefExternalSystemError({ message: "Failed to resend confirmation email", cause }),
    }).pipe(
      Effect.flatMap(({ error }) =>
        error
          ? Effect.fail(
              new SnapchefExternalSystemError({ message: "Failed to resend confirmation email", cause: error }),
            )
          : Effect.void,
      ),
    );

// Sends the recovery (password-reset) email. Like resendConfirmation, resetPasswordForEmail returns
// only { error } (no decodable user) and succeeds regardless of account existence (anti-enumeration),
// so it uses a bare tryPromise and folds any failure — thrown or a non-null { error } such as the
// max_frequency throttle — into SnapchefExternalSystemError. The committed recovery template builds
// its link from {{ .SiteURL }}, so no redirectTo is needed.
const requestPasswordReset =
  (supabase: SupabaseClient) =>
  ({ email }: RequestPasswordReset): Effect.Effect<void, SnapchefServerError> =>
    Effect.tryPromise({
      try: () => supabase.auth.resetPasswordForEmail(email),
      catch: (cause) => new SnapchefExternalSystemError({ message: "Failed to send password reset email", cause }),
    }).pipe(
      Effect.flatMap(({ error }) =>
        error
          ? Effect.fail(
              new SnapchefExternalSystemError({ message: "Failed to send password reset email", cause: error }),
            )
          : Effect.void,
      ),
    );

// Redeems the recovery link's token_hash and sets the new password in one request. verifyOtp
// (type "recovery") establishes the recovery session on the request-scoped client (writing the
// session cookie as a side effect), so the immediately-following updateUser is authenticated within
// the same request. Both calls reuse the AuthUser { user } decoder via liftAuthUser. Classification
// falls out of toAuthFailure: expired/invalid token → 401, weak password from updateUser → 422,
// service/network → 500.
const resetPassword =
  (supabase: SupabaseClient) =>
  ({ tokenHash, newPassword }: ResetPassword): Effect.Effect<SnapchefUser, SnapchefServerError> =>
    liftAuthUser("This password reset link is invalid or has expired")(() =>
      supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" }).then(({ data, error }) => ({ data, error })),
    ).pipe(
      Effect.flatMap(() =>
        liftAuthUser("Failed to update password")(() =>
          supabase.auth.updateUser({ password: newPassword }).then(({ data, error }) => ({ data, error })),
        ),
      ),
    );

export const createSupabaseAuthenticator = (supabase: SupabaseClient<Database>): Authenticator => ({
  signIn: signIn(supabase),
  signUp: signUp(supabase),
  signOut: signOut(supabase),
  getUser: getUser(supabase),
  confirmEmail: confirmEmail(supabase),
  resendConfirmation: resendConfirmation(supabase),
  requestPasswordReset: requestPasswordReset(supabase),
  resetPassword: resetPassword(supabase),
});
