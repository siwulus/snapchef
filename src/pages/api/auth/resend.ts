import { ResendConfirmation, type ConfirmationResent } from "@/lib/core/boundry/auth";
import { parseRequestBody, runApiRoute } from "@/lib/infrastructure/api";
import type { APIRoute } from "astro";
import { Effect } from "effect";

export const prerender = false;

export const POST: APIRoute = ({ request, locals: { authenticator } }) =>
  runApiRoute(
    parseRequestBody(request, ResendConfirmation).pipe(
      Effect.flatMap((body) =>
        authenticator.resendConfirmation(body).pipe(Effect.as<ConfirmationResent>({ email: body.email })),
      ),
    ),
  );
