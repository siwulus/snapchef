import { createClient } from "@/lib/infrastructure/db/supabase";
import type { APIContext, MiddlewareNext } from "astro";
import { defineMiddleware } from "astro:middleware";
import { Effect } from "effect";
import { ExternalSystemError } from "./lib/core/model/error";
import { AuthenticatorUC } from "./lib/core/uc/auth/AuthenticatorUC";

const PROTECTED_ROUTES = ["/recipes"];

export const onRequest = defineMiddleware(async (context, next) => {
  injectDependencies(context);
  await setUserInContext(context);
  return checkProtectedRoutes(context, next);
});

const injectDependencies = (context: APIContext) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (supabase) {
    context.locals.authenticator = new AuthenticatorUC(supabase);
  } else {
    throw new ExternalSystemError({ message: "Supabase is not configured", cause: null });
  }
};

const setUserInContext = async (context: APIContext) =>
  context.locals.authenticator.getUser().pipe(
    Effect.map((user) => {
      context.locals.user = user;
      return context;
    }),
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
