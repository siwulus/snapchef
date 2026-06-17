import type { RecipeRepository, RecipeWritePayload, SavedRecipeListItem } from "@/lib/core/boundry/recipe";
import type { UserId } from "@/lib/core/model/auth";
import type { SnapchefServerError } from "@/lib/core/model/error";
import type { Recipe } from "@/lib/core/model/recipe";
import type { Database } from "@/lib/infrastructure/db/types";
import { RecipeFromRow, SavedRecipeListItemFromRow } from "@/lib/infrastructure/db/types/converters";
import { tryErrorDataWithSchema } from "@/lib/utils/effect";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Effect } from "effect";
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

// Owner-scoped list of saved recipes: recipes inner-joined to their session, filtered to the
// `saved` state, newest first. The forward `recipes.session_id → recipe_sessions.id` embed returns
// a single object per row; each row is decoded through SavedRecipeListItemFromRow. An empty result
// is a valid `[]`, so tryErrorDataWithSchema (not tryErrorData) is used — no NotFound on zero rows.
const listSaved =
  (supabase: SupabaseClient<Database>) =>
  (userId: UserId): Effect.Effect<SavedRecipeListItem[], SnapchefServerError> =>
    tryErrorDataWithSchema(z.array(SavedRecipeListItemFromRow))(() =>
      supabase
        .from("recipes")
        .select("session_id, name, created_at, recipe_sessions!inner(meal_context, state)")
        .eq("user_id", userId)
        .eq("recipe_sessions.state", "saved")
        .order("created_at", { ascending: false })
        .then(({ error, data }) => ({ error, data })),
    );

export const createRecipeRepository = (supabase: SupabaseClient<Database>): RecipeRepository => ({
  upsert: upsert(supabase),
  listSaved: listSaved(supabase),
});
