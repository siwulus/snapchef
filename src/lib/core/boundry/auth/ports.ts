import type { Effect } from "effect";
import type { SnapchefUser } from "@/lib/core/model/auth";
import type { SnapchefServerError } from "@/lib/core/model/error";
import type {
  EmailConfirmation,
  RequestPasswordReset,
  ResendConfirmation,
  ResetPassword,
  UserCredentials,
} from "./commands";

export interface Authenticator {
  signIn(credentials: UserCredentials): Effect.Effect<SnapchefUser, SnapchefServerError>;
  signUp(credentials: UserCredentials): Effect.Effect<SnapchefUser, SnapchefServerError>;
  signOut(): Effect.Effect<void, SnapchefServerError>;
  getUser(): Effect.Effect<SnapchefUser, SnapchefServerError>;
  confirmEmail(params: EmailConfirmation): Effect.Effect<SnapchefUser, SnapchefServerError>;
  resendConfirmation(params: ResendConfirmation): Effect.Effect<void, SnapchefServerError>;
  requestPasswordReset(params: RequestPasswordReset): Effect.Effect<void, SnapchefServerError>;
  resetPassword(params: ResetPassword): Effect.Effect<SnapchefUser, SnapchefServerError>;
}
