import { createSupabaseAuthenticator } from "@/lib/infrastructure/auth/SupabaseAuthenticator";
import { createRecipeSessionRepository } from "@/lib/infrastructure/db/RecipeSessionRepository";
import { createSessionPhotoStorage } from "@/lib/infrastructure/db/SessionPhotoStorage";
import { createClient } from "@/lib/infrastructure/db/supabase";
import { createProductRecognizer } from "@/lib/infrastructure/llm/openrouter";
import { runWithLogging, shouldLogBodies } from "@/lib/infrastructure/logging/logger";
import type { APIContext, MiddlewareNext } from "astro";
import { defineMiddleware } from "astro:middleware";
import { Effect } from "effect";
import { SnapchefExternalSystemError } from "./lib/core/model/error";
import { AuthenticatorUC } from "./lib/core/uc/auth/AuthenticatorUC";
import { RecipeSessionUC } from "./lib/core/uc/recipe/RecipeSessionUC";
import { match } from "ts-pattern";

const PROTECTED_ROUTES = ["/recipes"];

// Single Effect edge for every request (pages + API + redirects): capture the request body
// (when enabled) → inject dependencies (fail fast on misconfig) → resolve the user → produce the
// response (redirect or next()) → emit one structured access log. The whole pipe runs in the
// "http" span so the log carries `http=<ms>ms`, and runs through the shared logger runtime.
export const onRequest = defineMiddleware((context, next) =>
  captureBody(context.request).pipe(
    Effect.flatMap((requestBody) =>
      injectDependencies(context).pipe(
        Effect.flatMap(() => setUserInContext(context)),
        Effect.flatMap(() => resolveResponse(context, next)),
        Effect.tap((response) => logAccess(context, response, requestBody)),
      ),
    ),
    Effect.tapErrorCause((cause) => Effect.logError("http.error", cause)),
    Effect.withLogSpan("http"),
    runWithLogging,
  ),
);

const injectDependencies = (context: APIContext): Effect.Effect<void, SnapchefExternalSystemError> =>
  Effect.suspend(() =>
    Effect.fromNullable(createClient(context.request.headers, context.cookies)).pipe(
      Effect.mapError(() => new SnapchefExternalSystemError({ message: "Supabase is not configured" })),
      Effect.flatMap((supabase) => {
        context.locals.authenticator = new AuthenticatorUC(createSupabaseAuthenticator(supabase));
        context.locals.recipeSessions = new RecipeSessionUC(
          createRecipeSessionRepository(supabase),
          createSessionPhotoStorage(supabase),
          createProductRecognizer(),
        );
        return Effect.void;
      }),
    ),
  );

const setUserInContext = (context: APIContext): Effect.Effect<void> =>
  context.locals.authenticator.getUser().pipe(
    Effect.map((user) => {
      context.locals.user = user;
    }),
    // An unauthenticated request is the normal case (no session) — fall through quietly.
    Effect.catchTag("SnapchefAuthenticationError", () => {
      context.locals.user = null;
      return Effect.void;
    }),
    // A genuine infrastructure failure (e.g. Supabase outage) must not silently masquerade
    // as logout: log the cause, but still fail open to anonymous so public pages stay reachable.
    Effect.tapError((error) => Effect.logError("getUser failed during setUserInContext", error)),
    Effect.catchAll(() => {
      context.locals.user = null;
      return Effect.void;
    }),
  );

const resolveResponse = (context: APIContext, next: MiddlewareNext): Effect.Effect<Response> =>
  match([PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route)), context.locals.user])
    .with([true, null], () => Effect.succeed(context.redirect("/auth/signin")))
    .otherwise(() => Effect.promise(() => next()));

const isJsonContentType = (headers: Headers): boolean =>
  (headers.get("content-type") ?? "").toLowerCase().includes("application/json");

// Body logging is opt-in (LOG_HTTP_BODIES) and JSON-only — multipart/binary (photo uploads) is
// never read. Reads from a clone so the original stream stays available to the route / client.
const captureBody = (source: Request | Response): Effect.Effect<string | null> =>
  shouldLogBodies && isJsonContentType(source.headers)
    ? Effect.promise(() => source.clone().text())
    : Effect.succeed(null);

const logAccess = (context: APIContext, response: Response, requestBody: string | null): Effect.Effect<void> =>
  captureBody(response).pipe(
    Effect.flatMap((responseBody) =>
      Effect.logInfo("http.request").pipe(
        Effect.annotateLogs({
          method: context.request.method,
          path: context.url.pathname,
          status: response.status,
          // Cloudflare sets cf-ray in prod; fall back to a UUID so correlation works in plain dev.
          cfRay: context.request.headers.get("cf-ray") ?? globalThis.crypto.randomUUID(),
          userId: context.locals.user?.id ?? "anonymous",
          ...(requestBody === null ? {} : { requestBody }),
          ...(responseBody === null ? {} : { responseBody }),
        }),
      ),
    ),
  );
