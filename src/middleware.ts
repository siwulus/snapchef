import { createSupabaseAuthenticator } from "@/lib/infrastructure/auth/SupabaseAuthenticator";
import { createPhotoRepository } from "@/lib/infrastructure/db/PhotoRepository";
import { createRecipeRepository } from "@/lib/infrastructure/db/RecipeRepository";
import { createRecipeSessionRepository } from "@/lib/infrastructure/db/RecipeSessionRepository";
import { createSessionPhotoStorage } from "@/lib/infrastructure/db/SessionPhotoStorage";
import { createClient } from "@/lib/infrastructure/db/supabase";
import { createFakeProductRecognizer } from "@/lib/infrastructure/llm/FakeProductRecognizer";
import { createFakeRecipeGenerator } from "@/lib/infrastructure/llm/FakeRecipeGenerator";
import { createProductRecognizer, createRecipeGenerator } from "@/lib/infrastructure/llm/openrouter";
import { runWithLogging, shouldLogBodies } from "@/lib/infrastructure/logging/logger";
import type { APIContext, MiddlewareNext } from "astro";
import { E2E_FAKE_LLM } from "astro:env/server";
import { defineMiddleware } from "astro:middleware";
import { Effect } from "effect";
import { SnapchefExternalSystemError } from "./lib/core/model/error";
import { AuthenticatorUC } from "./lib/core/uc/auth/AuthenticatorUC";
import { RecipeSessionUC } from "./lib/core/uc/recipe/RecipeSessionUC";
import { createSessionStateManager } from "./lib/core/uc/recipe/recipe-session-transition";
import { match } from "ts-pattern";

const PROTECTED_ROUTES = ["/recipes"];

// E2E test seam: swap the paid OpenRouter adapters for deterministic fakes. Only ever true under
// a non-production build (Playwright boots `astro dev`); `import.meta.env.PROD` is statically true
// in the production Worker bundle, so `!PROD` folds to false there and the fake branch is
// dead-code-eliminated — the fakes can never run in prod regardless of the env flag.
const useFakeLlm = E2E_FAKE_LLM && !import.meta.env.PROD;

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
        // One sessionRepository instance feeds both the UC's repo dependency and the transition
        // aspect — the single composition root where the port meets the aspect.
        const sessionRepository = createRecipeSessionRepository(supabase);
        context.locals.recipeSessions = new RecipeSessionUC(
          sessionRepository,
          createPhotoRepository(supabase),
          createSessionPhotoStorage(supabase),
          useFakeLlm ? createFakeProductRecognizer() : createProductRecognizer(),
          createRecipeRepository(supabase),
          useFakeLlm ? createFakeRecipeGenerator() : createRecipeGenerator(),
          createSessionStateManager(sessionRepository),
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
