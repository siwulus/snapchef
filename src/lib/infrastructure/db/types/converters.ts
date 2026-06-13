import { RecipeSession } from "@/lib/core/model/recipe";
import { RecipeSessionRow } from "@/lib/infrastructure/db/types/index";

export const RecipeSessionFromRow = RecipeSessionRow.transform((row) => ({
  id: row.id,
  userId: row.user_id,
  correctedItemsMd: row.corrected_items_md,
  createdAt: row.created_at,
  mealContext: row.meal_context,
  photoPaths: row.photo_paths,
  recognizedItemsMd: row.recognized_items_md,
  state: row.state,
  updatedAt: row.updated_at,
})).pipe(RecipeSession);
