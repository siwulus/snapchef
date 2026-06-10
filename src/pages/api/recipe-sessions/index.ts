import { runApiRoute, validateAuthUser } from "@/lib/infrastructure/api";
import type { APIRoute } from "astro";
import { Effect } from "effect";

export const prerender = false;

export const POST: APIRoute = ({ locals: { user, recipeSessions } }) =>
  runApiRoute(validateAuthUser(user).pipe(Effect.flatMap((user) => recipeSessions.createSession(user.id))));
