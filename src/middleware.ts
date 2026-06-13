import { createSupabaseAuthenticator } from "@/lib/infrastructure/auth/SupabaseAuthenticator";
import { createRecipeSessionRepository } from "@/lib/infrastructure/db/RecipeSessionRepository";
import { createSessionPhotoStorage } from "@/lib/infrastructure/db/SessionPhotoStorage";
import { createClient } from "@/lib/infrastructure/db/supabase";
import { createProductRecognizer } from "@/lib/infrastructure/llm/openrouter";
import type { APIContext, MiddlewareNext } from "astro";
import { defineMiddleware } from "astro:middleware";
import { Effect } from "effect";
import { SnapchefExternalSystemError } from "./lib/core/model/error";
import { AuthenticatorUC } from "./lib/core/uc/auth/AuthenticatorUC";
import { RecipeSessionUC } from "./lib/core/uc/recipe/RecipeSessionUC";

const PROTECTED_ROUTES = ["/recipes"];

export const onRequest = defineMiddleware(async (context, next) => {
  injectDependencies(context);
  await setUserInContext(context);
  return checkProtectedRoutes(context, next);
});

const injectDependencies = (context: APIContext) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (supabase) {
    context.locals.authenticator = new AuthenticatorUC(createSupabaseAuthenticator(supabase));
    context.locals.recipeSessions = new RecipeSessionUC(
      createRecipeSessionRepository(supabase),
      createSessionPhotoStorage(supabase),
      createProductRecognizer(),
    );
  } else {
    throw new SnapchefExternalSystemError({ message: "Supabase is not configured" });
  }
};

const setUserInContext = async (context: APIContext) =>
  context.locals.authenticator.getUser().pipe(
    Effect.map((user) => {
      context.locals.user = user;
      return context;
    }),
    // An unauthenticated request is the normal case (no session) — fall through quietly.
    Effect.catchTag("SnapchefAuthenticationError", () => {
      context.locals.user = null;
      return Effect.succeed(context);
    }),
    // A genuine infrastructure failure (e.g. Supabase outage) must not silently masquerade
    // as logout: log the cause, but still fail open to anonymous so public pages stay reachable.
    Effect.tapError((error) => Effect.logError("getUser failed during setUserInContext", error)),
    Effect.catchAll(() => {
      context.locals.user = null;
      return Effect.succeed(context);
    }),
    Effect.runPromise,
  );

const checkProtectedRoutes = async (context: APIContext, next: MiddlewareNext) => {
  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }
  return next();
};
