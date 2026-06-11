import type { Authenticator, UserCredentials } from "@/lib/core/boundry/auth";
import { SnapchefUser } from "@/lib/core/model/auth";
import {
  SnapchefAuthenticationError,
  SnapchefExternalSystemError,
  type SnapchefServerError,
} from "@/lib/core/model/error";
import { decodeWith } from "@/lib/utils/effect";
import { isAuthApiError, isAuthSessionMissingError, type SupabaseClient } from "@supabase/supabase-js";
import { Effect } from "effect";
import { z } from "zod";

// Supabase Auth wraps the user behind a `data.user` envelope. This wire schema is a
// Supabase response detail and lives with the adapter, never in core.
const AuthUser = z.object({
  user: SnapchefUser,
});

// A genuine auth rejection — a missing session (getUser on an anonymous request) or a
// 4xx AuthApiError (bad credentials, unconfirmed email) — maps to 401. Note a missing
// session surfaces as AuthSessionMissingError, which is NOT an AuthApiError, so it needs
// its own guard. Everything else (5xx, AuthRetryableFetchError / network, non-auth or
// thrown) is an infrastructure failure → 500. The cause is always forwarded.
const isAuthRejection = (error: unknown): boolean =>
  isAuthSessionMissingError(error) || (isAuthApiError(error) && error.status < 500);

const toAuthFailure = (error: unknown, message: string): SnapchefServerError =>
  isAuthRejection(error)
    ? new SnapchefAuthenticationError({ message, cause: error })
    : new SnapchefExternalSystemError({ message: "Authentication service failed", cause: error });

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
          : // A decode failure here means Supabase's response shape drifted — a driven-side
            // contract break, not a client error. Report 500, not 400.
            decodeWith(AuthUser)(data).pipe(
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
      supabase.auth.signInWithPassword(credentials).then(({ data, error }) => ({ data, error })),
    );

const signUp =
  (supabase: SupabaseClient) =>
  (credentials: UserCredentials): Effect.Effect<SnapchefUser, SnapchefServerError> =>
    liftAuthUser("Failed to sign up")(() =>
      supabase.auth.signUp(credentials).then(({ data, error }) => ({ data, error })),
    );

const getUser = (supabase: SupabaseClient) => (): Effect.Effect<SnapchefUser, SnapchefServerError> =>
  liftAuthUser("Failed to get user")(() => supabase.auth.getUser().then(({ data, error }) => ({ data, error })));

const signOut = (supabase: SupabaseClient) => (): Effect.Effect<void, SnapchefServerError> =>
  Effect.tryPromise({
    try: () => supabase.auth.signOut(),
    catch: (cause) => new SnapchefExternalSystemError({ message: "Authentication service failed", cause }),
  }).pipe(Effect.asVoid);

export const createSupabaseAuthenticator = (supabase: SupabaseClient): Authenticator => ({
  signIn: signIn(supabase),
  signUp: signUp(supabase),
  signOut: signOut(supabase),
  getUser: getUser(supabase),
});
