import type { APIRoute, AstroCookies } from "astro";
import { Effect } from "effect";
import { z } from "zod";
import { createClient } from "@/lib/infrastructure/db/supabase";
import { type RedirectTarget } from "@/lib/core/boundry/auth";
import { UserCredentials } from "@/lib/core/model/auth";
import { decodeWith, BusinessRuleError, ExternalSystemError, ValidationError } from "@/lib/core/model/error";
import { runApiRoute } from "@/lib/infrastructure/api";

export const prerender = false;

const parseJsonBody = (request: Request): Effect.Effect<unknown, ValidationError> =>
  Effect.tryPromise({
    try: () => request.json(),
    catch: () => new ValidationError({ message: "Invalid request body", error: new z.ZodError([]) }),
  });

const supabaseClient = (headers: Headers, cookies: AstroCookies) =>
  Effect.suspend(() => {
    const client = createClient(headers, cookies);
    return client
      ? Effect.succeed(client)
      : Effect.fail(new ExternalSystemError({ message: "Supabase is not configured", cause: null }));
  });

export const POST: APIRoute = (context) =>
  runApiRoute(
    parseJsonBody(context.request).pipe(
      Effect.flatMap(decodeWith(UserCredentials)),
      Effect.flatMap((credentials) =>
        supabaseClient(context.request.headers, context.cookies).pipe(
          Effect.flatMap((supabase) =>
            Effect.tryPromise({
              try: () => supabase.auth.signUp(credentials),
              catch: (cause) => new ExternalSystemError({ message: "Authentication service failed", cause }),
            }),
          ),
        ),
      ),
      Effect.flatMap(({ error }) =>
        error
          ? Effect.fail(new BusinessRuleError({ code: "BUSINESS_RULE_VIOLATED", message: error.message }))
          : Effect.succeed<RedirectTarget>({ redirect: "/auth/confirm-email" }),
      ),
    ),
  );
