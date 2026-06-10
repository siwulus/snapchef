import type { AuthenticatorUC } from "@/lib/core/uc/auth/AuthenticatorUC";
import type { RecipeSessionUC } from "@/lib/core/uc/recipe/RecipeSessionUC";
import type { SnapchefUser } from "./lib/core/model/auth";

declare global {
  namespace App {
    interface Locals {
      authenticator: AuthenticatorUC;
      recipeSessions: RecipeSessionUC;
      user: SnapchefUser | null;
    }
  }
}
