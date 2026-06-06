import type { SupabaseClient, User } from "@supabase/supabase-js";
import { Effect } from "effect";
import type { UserCredentials } from "../../model/auth";
import { BusinessRuleError, ExternalSystemError, type ServerSnapchefError } from "../../model/error";

export class AuthenticatorUC {
  constructor(private readonly supabase: SupabaseClient) {}

  signIn(credentials: UserCredentials): Effect.Effect<{ redirect: string }, ServerSnapchefError> {
    return Effect.tryPromise({
      try: () => this.supabase.auth.signInWithPassword(credentials),
      catch: (cause) => new ExternalSystemError({ message: "Authentication service failed", cause }),
    }).pipe(
      Effect.flatMap(({ error }) =>
        error
          ? Effect.fail(new BusinessRuleError({ code: "UNAUTHORIZED", message: error.message }))
          : Effect.succeed({ redirect: "/recipes" }),
      ),
    );
  }

  signUp(credentials: UserCredentials): Effect.Effect<{ redirect: string }, ServerSnapchefError> {
    return Effect.tryPromise({
      try: () => this.supabase.auth.signUp(credentials),
      catch: (cause) => new ExternalSystemError({ message: "Authentication service failed", cause }),
    }).pipe(
      Effect.flatMap(({ error }) =>
        error
          ? Effect.fail(new BusinessRuleError({ code: "BUSINESS_RULE_VIOLATED", message: error.message }))
          : Effect.succeed({ redirect: "/auth/confirm-email" }),
      ),
    );
  }

  signOut(): Effect.Effect<void, ServerSnapchefError> {
    return Effect.tryPromise({
      try: () => this.supabase.auth.signOut(),
      catch: (cause) => new ExternalSystemError({ message: "Authentication service failed", cause }),
    });
  }

  getUser(): Effect.Effect<User, ServerSnapchefError> {
    return Effect.tryPromise({
      try: () => this.supabase.auth.getUser(),
      catch: (cause) => new ExternalSystemError({ message: "Authentication service failed", cause }),
    }).pipe(
      Effect.flatMap(({ error, data: { user } }) =>
        error || !user
          ? Effect.fail(new BusinessRuleError({ code: "UNAUTHORIZED", message: error?.message ?? "User not found" }))
          : Effect.succeed(user),
      ),
    );
  }
}
