import { UserCredentials, type RedirectTarget } from "@/lib/core/boundry/auth";
import { parseRequestBody, runApiRoute } from "@/lib/infrastructure/api";
import type { APIRoute } from "astro";
import { Effect } from "effect";

export const prerender = false;

export const POST: APIRoute = ({ request, locals: { authenticator } }) =>
  runApiRoute(
    parseRequestBody(request, UserCredentials).pipe(
      Effect.flatMap((credentials) => authenticator.signIn(credentials)),
      Effect.as<RedirectTarget>({ redirect: "/recipes" }),
    ),
  );
