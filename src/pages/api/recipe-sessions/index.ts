import { BusinessRuleError } from "@/lib/core/model/error";
import { runApiRoute } from "@/lib/infrastructure/api";
import type { APIRoute } from "astro";
import { Effect } from "effect";

export const prerender = false;

export const POST: APIRoute = ({ locals: { user, recipeSessions } }) =>
  runApiRoute(
    Effect.fromNullable(user).pipe(
      Effect.flatMap((user) => recipeSessions.createSession(user.id)),
      Effect.mapError(() => new BusinessRuleError({ code: "UNAUTHORIZED", message: "Authentication required" })),
    ),
  );
