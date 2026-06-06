import type { User } from "@supabase/supabase-js";
import type { AuthenticatorUC } from "@/lib/core/uc/auth/AuthenticatorUC";

declare global {
  namespace App {
    interface Locals {
      authenticator: AuthenticatorUC;
      user: User | null;
    }
  }
}
