import { parseMultipartFiles, runApiRoute } from "@/lib/infrastructure/api";
import { BusinessRuleError } from "@/lib/core/model/error";
import type { APIRoute } from "astro";
import { Effect } from "effect";

export const prerender = false;

export const POST: APIRoute = ({ request, params, locals: { user, recipeSessions } }) =>
  runApiRoute(
    Effect.all([
      Effect.fromNullable(user),
      Effect.fromNullable(params.id),
      parseMultipartFiles(request, "photos"),
    ]).pipe(
      Effect.mapError(() => new BusinessRuleError({ code: "BUSINESS_RULE_VIOLATED", message: "Invalid request" })),
      Effect.flatMap(([user, id, files]) => recipeSessions.attachPhotos(user.id, id, files)),
    ),
  );
