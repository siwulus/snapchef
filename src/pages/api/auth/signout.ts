import { runWithLogging } from "@/lib/infrastructure/logging/logger";
import type { APIRoute } from "astro";
import { Effect } from "effect";

export const prerender = false;

export const POST: APIRoute = (context) =>
  runWithLogging(
    context.locals.authenticator.signOut().pipe(
      Effect.tapError((cause) => Effect.logError("api.signout.error", cause)),
      Effect.match({
        onSuccess: () => context.redirect("/", 303),
        onFailure: () => context.redirect("/", 303),
      }),
    ),
  );
