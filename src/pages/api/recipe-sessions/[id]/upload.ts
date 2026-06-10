import { RecipeSessionId } from "@/lib/core/model/recipe";
import { parseMultipartFiles, runApiRoute, validateAuthUser } from "@/lib/infrastructure/api";
import { decodeWith } from "@/lib/utils/effect";
import type { APIRoute } from "astro";
import { Effect } from "effect";

export const prerender = false;

export const POST: APIRoute = ({ request, params, locals: { user, recipeSessions } }) =>
  runApiRoute(
    Effect.all([
      validateAuthUser(user),
      decodeWith(RecipeSessionId)(params.id),
      parseMultipartFiles(request, "photos"),
    ]).pipe(Effect.flatMap(([user, id, files]) => recipeSessions.attachPhotos(user.id, id, files))),
  );
