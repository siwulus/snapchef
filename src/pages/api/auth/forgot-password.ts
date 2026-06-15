import { RequestPasswordReset, type PasswordResetRequested } from "@/lib/core/boundry/auth";
import { parseRequestBody, runApiRoute } from "@/lib/infrastructure/api";
import type { APIRoute } from "astro";
import { Effect } from "effect";

export const prerender = false;

// Triggers the recovery email. resetPasswordForEmail succeeds whether or not the account exists, so
// the route always echoes the address back (anti-enumeration) — the client renders a neutral message.
export const POST: APIRoute = ({ request, locals: { authenticator } }) =>
  runApiRoute(
    parseRequestBody(request, RequestPasswordReset).pipe(
      Effect.flatMap((body) =>
        authenticator.requestPasswordReset(body).pipe(Effect.as<PasswordResetRequested>({ email: body.email })),
      ),
    ),
  );
