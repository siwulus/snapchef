import {
  ShapchefExternalSystemError,
  SnapchefAuthenticationError,
  type SnapchefServerError,
} from "@/lib/core/model/error";
import { tryErrorDataWithSchema } from "@/lib/utils/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Effect } from "effect";
import z from "zod";
import { SnapchefUser, type UserCredentials } from "../../model/auth";

const AuthUser = z.object({
  user: SnapchefUser,
});
export class AuthenticatorUC {
  constructor(private readonly supabase: SupabaseClient) {}

  signIn(credentials: UserCredentials): Effect.Effect<{ redirect: string }, SnapchefServerError> {
    return tryErrorDataWithSchema(AuthUser)(() => this.supabase.auth.signInWithPassword(credentials)).pipe(
      Effect.as({ redirect: "/recipes" }),
      Effect.mapError(() => new SnapchefAuthenticationError({ message: "Failed to sign in" })),
    );
  }

  signUp(credentials: UserCredentials): Effect.Effect<{ redirect: string }, SnapchefServerError> {
    return tryErrorDataWithSchema(AuthUser)(() => this.supabase.auth.signUp(credentials)).pipe(
      Effect.as({ redirect: "/auth/confirm-email" }),
      Effect.mapError(() => new SnapchefAuthenticationError({ message: "Failed to sign up" })),
    );
  }

  signOut(): Effect.Effect<void, SnapchefServerError> {
    return Effect.tryPromise({
      try: () => this.supabase.auth.signOut(),
      catch: (cause) => new ShapchefExternalSystemError({ message: "Authentication service failed", cause }),
    });
  }

  getUser(): Effect.Effect<SnapchefUser, SnapchefServerError> {
    return tryErrorDataWithSchema(AuthUser)(() => this.supabase.auth.getUser()).pipe(
      Effect.mapError(() => new SnapchefAuthenticationError({ message: "Failed to get user" })),
      Effect.map(({ user }) => user),
    );
  }
}
