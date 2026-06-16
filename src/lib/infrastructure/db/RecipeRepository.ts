import type { RecipeRepository, RecipeWritePayload } from "@/lib/core/boundry/recipe";
import type { SnapchefServerError } from "@/lib/core/model/error";
import type { Recipe } from "@/lib/core/model/recipe";
import type { Database } from "@/lib/infrastructure/db/types";
import { RecipeFromRow } from "@/lib/infrastructure/db/types/converters";
import { tryErrorDataWithSchema } from "@/lib/utils/effect";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Effect } from "effect";

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

export const createRecipeRepository = (supabase: SupabaseClient<Database>): RecipeRepository => ({
  upsert: upsert(supabase),
});
