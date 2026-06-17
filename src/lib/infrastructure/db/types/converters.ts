import { SavedRecipeListItem } from "@/lib/core/boundry/recipe";
import { Recipe, RecipeSession, StoredPhoto } from "@/lib/core/model/recipe";
import { PhotoRow, RecipeRow, RecipeSessionRow } from "@/lib/infrastructure/db/types/index";
import { z } from "zod";

export const RecipeSessionFromRow = RecipeSessionRow.transform((row) => ({
  id: row.id,
  userId: row.user_id,
  correctedItems: row.corrected_items,
  createdAt: row.created_at,
  mealContext: row.meal_context,
  recognizedItems: row.recognized_items,
  allowExtraIngredients: row.allow_extra_ingredients ?? null,
  state: row.state,
  updatedAt: row.updated_at,
})).pipe(RecipeSession);

export const RecipeFromRow = RecipeRow.transform((row) => ({
  id: row.id,
  sessionId: row.session_id,
  userId: row.user_id,
  contentMd: row.content_md,
  createdAt: row.created_at,
  name: row.name,
})).pipe(Recipe);

// Row shape of the saved-recipes list query: `recipes` columns plus the embedded (to-one)
// `recipe_sessions` object — the forward `recipes.session_id → recipe_sessions.id` embed always
// returns a single object, so `meal_context` is read off it directly.
const SavedRecipeListRow = z.object({
  session_id: z.string(),
  name: z.string(),
  created_at: z.string(),
  recipe_sessions: z.object({ meal_context: z.string().nullable() }),
});

export const SavedRecipeListItemFromRow = SavedRecipeListRow.transform((row) => ({
  sessionId: row.session_id,
  name: row.name,
  createdAt: row.created_at,
  mealContext: row.recipe_sessions.meal_context,
})).pipe(SavedRecipeListItem);

export const PhotoFromRow = PhotoRow.transform((row) => ({
  id: row.id,
  sessionId: row.session_id,
  userId: row.user_id,
  storagePath: row.storage_path,
  storageObjectId: row.storage_object_id,
  contentType: row.content_type,
  sizeBytes: row.size_bytes,
  originalFilename: row.original_filename,
  recognizedItems: row.recognized_items,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})).pipe(StoredPhoto);
