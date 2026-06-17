import type { RecipeListFilter, RecipeListItem, RecipeRepository, RecipeWritePayload } from "@/lib/core/boundry/recipe";
import type { UserId } from "@/lib/core/model/auth";
import type { SnapchefServerError } from "@/lib/core/model/error";
import type { Recipe } from "@/lib/core/model/recipe";
import type { Database, RecipeRow } from "@/lib/infrastructure/db/types";
import { RecipeFromRow, RecipeListItemFromRow } from "@/lib/infrastructure/db/types/converters";
import { decodeWith, tryErrorDataOption, tryErrorDataWithSchema } from "@/lib/utils/effect";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Effect, type Option } from "effect";
import { z } from "zod";

// Overwrite-safe upsert on the UNIQUE session_id: one recipe per session, re-generation
// replaces the row in place (no duplicate, no UNIQUE violation). The returned row is decoded
// through RecipeFromRow so the adapter speaks the domain's camelCase vocabulary.
const upsert =
  (supabase: SupabaseClient<Database>) =>
  (payload: RecipeWritePayload): Effect.Effect<Recipe, SnapchefServerError> =>
    tryErrorDataWithSchema(RecipeFromRow)(() =>
      supabase
        .from("recipes")
        .upsert(
          {
            session_id: payload.sessionId,
            user_id: payload.userId,
            name: payload.name,
            content_md: payload.contentMd,
          },
          { onConflict: "session_id" },
        )
        .select("*")
        .single()
        .then(({ error, data }) => ({ error, data })),
    );

// Owner-scoped list of recipes: recipes inner-joined to their session, narrowed by the filter
// (currently only the session state), newest first. The forward `recipes.session_id →
// recipe_sessions.id` embed returns a single object per row; each row is decoded through
// RecipeListItemFromRow. An empty result is a valid `[]`, so tryErrorDataWithSchema (not
// tryErrorData) is used — no NotFound on zero rows.
const list =
  (supabase: SupabaseClient<Database>) =>
  (userId: UserId, filter: RecipeListFilter): Effect.Effect<RecipeListItem[], SnapchefServerError> =>
    tryErrorDataWithSchema(z.array(RecipeListItemFromRow))(() => {
      const base = supabase
        .from("recipes")
        .select("session_id, name, created_at, recipe_sessions!inner(meal_context, state)")
        .eq("user_id", userId);
      const filtered = filter.state ? base.eq("recipe_sessions.state", filter.state) : base;
      return filtered.order("created_at", { ascending: false }).then(({ error, data }) => ({ error, data }));
    });

// Owner-scoped fetch of the one recipe belonging to a session. Absence (no recipe for this
// session, or not owned) is reported as Option.none(); the UC decides whether that is a 404.
const findBySession =
  (supabase: SupabaseClient<Database>) =>
  (userId: UserId, sessionId: string): Effect.Effect<Option.Option<Recipe>, SnapchefServerError> =>
    tryErrorDataOption<RecipeRow>(() =>
      supabase
        .from("recipes")
        .select("*")
        .eq("user_id", userId)
        .eq("session_id", sessionId)
        .single()
        .then(({ error, data }) => ({ error, data })),
    ).pipe(Effect.flatMap((option) => Effect.transposeMapOption(option, decodeWith(RecipeFromRow))));

export const createRecipeRepository = (supabase: SupabaseClient<Database>): RecipeRepository => ({
  upsert: upsert(supabase),
  list: list(supabase),
  findBySession: findBySession(supabase),
});
