import type { Authenticator, UserCredentials } from "@/lib/core/boundry/auth";
import type { SnapchefUser } from "@/lib/core/model/auth";
import type { SnapchefServerError } from "@/lib/core/model/error";
import type { Effect } from "effect";

export class AuthenticatorUC {
  constructor(private readonly authenticator: Authenticator) {}

  signIn(credentials: UserCredentials): Effect.Effect<SnapchefUser, SnapchefServerError> {
    return this.authenticator.signIn(credentials);
  }

  signUp(credentials: UserCredentials): Effect.Effect<SnapchefUser, SnapchefServerError> {
    return this.authenticator.signUp(credentials);
  }

  signOut(): Effect.Effect<void, SnapchefServerError> {
    return this.authenticator.signOut();
  }

  getUser(): Effect.Effect<SnapchefUser, SnapchefServerError> {
    return this.authenticator.getUser();
  }
}
