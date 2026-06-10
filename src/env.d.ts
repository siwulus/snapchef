import type { User } from "@supabase/supabase-js";
import type { AuthenticatorUC } from "@/lib/core/uc/auth/AuthenticatorUC";
import type { RecipeSessionUC } from "@/lib/core/uc/recipe/RecipeSessionUC";

declare global {
  namespace App {
    interface Locals {
      authenticator: AuthenticatorUC;
      recipeSessions: RecipeSessionUC;
      user: User | null;
    }
  }
}
