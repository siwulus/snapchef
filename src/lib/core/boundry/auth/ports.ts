import type { Effect } from "effect";
import type { SnapchefUser, UserCredentials } from "@/lib/core/model/auth";
import type { SnapchefServerError } from "@/lib/core/model/error";

export interface Authenticator {
  signIn(credentials: UserCredentials): Effect.Effect<SnapchefUser, SnapchefServerError>;
  signUp(credentials: UserCredentials): Effect.Effect<SnapchefUser, SnapchefServerError>;
  signOut(): Effect.Effect<void, SnapchefServerError>;
  getUser(): Effect.Effect<SnapchefUser, SnapchefServerError>;
}
