import { RecipeGenerationCommand } from "@/lib/core/boundry/recipe";
import { Recipe, RecipeSessionId } from "@/lib/core/model/recipe";
import { parseRequestBody, runApiRoute, validateAuthUser } from "@/lib/infrastructure/api";
import { decodeWith } from "@/lib/utils/effect";
import type { APIRoute } from "astro";
import { Effect } from "effect";

export const prerender = false;

export const POST: APIRoute = ({ request, params, locals: { user, recipeSessions } }) =>
  runApiRoute(
    Effect.all([
      validateAuthUser(user),
      decodeWith(RecipeSessionId)(params.id),
      parseRequestBody(request, RecipeGenerationCommand),
    ]).pipe(
      Effect.flatMap(([authUser, id, command]) => recipeSessions.generateRecipe(authUser.id, id, command)),
      Effect.flatMap(decodeWith(Recipe)),
    ),
  );
