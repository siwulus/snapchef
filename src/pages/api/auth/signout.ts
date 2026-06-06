import { runApiRoute } from "@/lib/infrastructure/api";
import type { APIRoute } from "astro";
import { Effect } from "effect";

export const prerender = false;

export const POST: APIRoute = (context) =>
  runApiRoute(context.locals.authenticator.signOut().pipe(Effect.map(() => context.redirect("/"))));
