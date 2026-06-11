import { RecipeSession } from "@/lib/core/model/recipe";
import { z } from "zod";

const RecipeSessionRowSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  corrected_items_md: z.string().nullable(),
  created_at: z.string(),
  meal_context: z.string().nullable(),
  photo_paths: z.array(z.string()),
  recognized_items_md: z.string().nullable(),
  state: z.string(),
  updated_at: z.string(),
});

export const RecipeSessionFromRow = RecipeSessionRowSchema.transform((row) => ({
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
