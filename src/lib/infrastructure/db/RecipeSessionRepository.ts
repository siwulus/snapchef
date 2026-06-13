import type { RecipeSessionRepository, RecipeSessionUpdatePayload } from "@/lib/core/boundry/recipe";
import type { UserId } from "@/lib/core/model/auth";
import type { SnapchefServerError } from "@/lib/core/model/error";
import type { RecipeSession } from "@/lib/core/model/recipe";
import type { Database, RecipeSessionRow, RecipeSessionUpdate } from "@/lib/infrastructure/db/types";
import { RecipeSessionFromRow } from "@/lib/infrastructure/db/types/converters";
import { decodeWith, tryErrorData, tryErrorDataOption } from "@/lib/utils/effect";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Effect, Option } from "effect";

const create =
  (supabase: SupabaseClient<Database>) =>
  (userId: UserId): Effect.Effect<RecipeSession, SnapchefServerError> =>
    tryErrorData<RecipeSessionRow>(() =>
      supabase
        .from("recipe_sessions")
        .insert({ user_id: userId })
        .select("*")
        .single()
        .then(({ error, data }) => ({ error, data })),
    ).pipe(Effect.flatMap(decodeWith(RecipeSessionFromRow)));

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
        ["corrected_items_md", data.correctedItemsMd],
        ["meal_context", data.mealContext],
        ["recognized_items_md", data.recognizedItemsMd],
        ["state", data.state],
        ["photo_paths", data.photoPaths],
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

export const createRecipeSessionRepository = (supabase: SupabaseClient<Database>): RecipeSessionRepository => ({
  create: create(supabase),
  update: update(supabase),
  find: find(supabase),
});
