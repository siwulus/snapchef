import { type RedirectTarget } from "@/lib/core/boundry/auth";
import { RecipeSessionId } from "@/lib/core/model/recipe";
import { runApiRoute, validateAuthUser } from "@/lib/infrastructure/api";
import { decodeWith } from "@/lib/utils/effect";
import type { APIRoute } from "astro";
import { Effect } from "effect";

export const prerender = false;

export const DELETE: APIRoute = ({ params, locals: { user, recipeSessions } }) =>
  runApiRoute(
    Effect.all([validateAuthUser(user), decodeWith(RecipeSessionId)(params.id)]).pipe(
      Effect.flatMap(([authUser, id]) => recipeSessions.deleteSession(authUser.id, id)),
      Effect.as<RedirectTarget>({ redirect: "/recipes" }),
    ),
  );
