import type { RecipeSessionRepository, RecipeSessionUpdatePayload } from "@/lib/core/boundry/recipe";
import type { UserId } from "@/lib/core/model/auth";
import type { SnapchefServerError } from "@/lib/core/model/error";
import type { RecipeSession } from "@/lib/core/model/recipe";
import type { Database, RecipeSessionRow, RecipeSessionUpdate } from "@/lib/infrastructure/db/types";
import { RecipeSessionFromRow } from "@/lib/infrastructure/db/types/converters";
import { decodeWith, tryErrorDataOption, tryErrorDataWithSchema } from "@/lib/utils/effect";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Effect, Option } from "effect";

const create =
  (supabase: SupabaseClient<Database>) =>
  (userId: UserId): Effect.Effect<RecipeSession, SnapchefServerError> =>
    tryErrorDataWithSchema(RecipeSessionFromRow)(() =>
      supabase
        .from("recipe_sessions")
        .insert({ user_id: userId })
        .select("*")
        .single()
        .then(({ error, data }) => ({ error, data })),
    );

const find =
  (supabase: SupabaseClient<Database>) =>
  (userId: UserId, sessionId: string): Effect.Effect<Option.Option<RecipeSession>, SnapchefServerError> =>
    tryErrorDataOption<RecipeSessionRow>(() =>
      supabase
        .from("recipe_sessions")
        .select("*")
        .eq("id", sessionId)
        .eq("user_id", userId)
        .single()
        .then(({ error, data }) => ({ error, data })),
    ).pipe(Effect.flatMap((option) => Effect.transposeMapOption(option, decodeWith(RecipeSessionFromRow))));

const toRecipeSessionUpdate = (data: RecipeSessionUpdatePayload): RecipeSessionUpdate =>
  Object.fromEntries(
    (
      [
        ["corrected_items", data.correctedItems],
        ["meal_context", data.mealContext],
        ["recognized_items", data.recognizedItems],
        ["allow_extra_ingredients", data.allowExtraIngredients],
        ["state", data.state],
      ] as const
    ).filter(([, value]) => value != null),
  ) as RecipeSessionUpdate;

const update =
  (supabase: SupabaseClient<Database>) =>
  (
    userId: UserId,
    sessionId: string,
    data: RecipeSessionUpdatePayload,
  ): Effect.Effect<Option.Option<RecipeSession>, SnapchefServerError> =>
    tryErrorDataOption<RecipeSessionRow>(() =>
      supabase
        .from("recipe_sessions")
        .update(toRecipeSessionUpdate(data))
        .eq("id", sessionId)
        .eq("user_id", userId)
        .select("*")
        .maybeSingle()
        .then(({ error, data }) => ({ error, data })),
    ).pipe(Effect.flatMap((option) => Effect.transposeMapOption(option, decodeWith(RecipeSessionFromRow))));

// Owner-scoped hard delete. The DB `on delete cascade` from recipe_sessions drops the recipe +
// photo rows; storage-bucket cleanup is the UC's responsibility. A delete returns no domain row,
// so the builder is shaped to `{ error, data: null }` and lifted through tryErrorDataOption.
// Owner existence is already validated upstream by fetchRecipeSession, so a no-match is harmless.
const remove =
  (supabase: SupabaseClient<Database>) =>
  (userId: UserId, sessionId: string): Effect.Effect<void, SnapchefServerError> =>
    tryErrorDataOption<null>(() =>
      supabase
        .from("recipe_sessions")
        .delete()
        .eq("id", sessionId)
        .eq("user_id", userId)
        .then(({ error }) => ({ error, data: null })),
    ).pipe(Effect.asVoid);

export const createRecipeSessionRepository = (supabase: SupabaseClient<Database>): RecipeSessionRepository => ({
  create: create(supabase),
  update: update(supabase),
  find: find(supabase),
  remove: remove(supabase),
});
