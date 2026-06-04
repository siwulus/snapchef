import { type RedirectTarget } from "@/lib/core/boundry/auth";
import { UserCredentials } from "@/lib/core/model/auth";
import { BusinessRuleError, ExternalSystemError } from "@/lib/core/model/error";
import { parseRequestBody, runApiRoute } from "@/lib/infrastructure/api";
import { createClient } from "@/lib/infrastructure/db/supabase";
import type { APIRoute, AstroCookies } from "astro";
import { Effect } from "effect";

export const prerender = false;

const supabaseClient = (headers: Headers, cookies: AstroCookies) =>
  Effect.suspend(() => {
    const client = createClient(headers, cookies);
    return client
      ? Effect.succeed(client)
      : Effect.fail(new ExternalSystemError({ message: "Supabase is not configured", cause: null }));
  });

export const POST: APIRoute = (context) =>
  runApiRoute(
    parseRequestBody(context.request, UserCredentials).pipe(
      Effect.flatMap((credentials) =>
        supabaseClient(context.request.headers, context.cookies).pipe(
          Effect.flatMap((supabase) =>
            Effect.tryPromise({
              try: () => supabase.auth.signInWithPassword(credentials),
              catch: (cause) => new ExternalSystemError({ message: "Authentication service failed", cause }),
            }),
          ),
        ),
      ),
      Effect.flatMap(({ error }) =>
        error
          ? Effect.fail(new BusinessRuleError({ code: "UNAUTHORIZED", message: error.message }))
          : Effect.succeed<RedirectTarget>({ redirect: "/recipes" }),
      ),
    ),
  );
