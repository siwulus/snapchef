import type { Database } from "@/lib/infrastructure/db/types/generated";
import z from "zod";

export * from "@/lib/infrastructure/db/types/generated";
export type RecipeSessionRow = Database["public"]["Tables"]["recipe_sessions"]["Row"];
export type RecipeSessionInsert = Database["public"]["Tables"]["recipe_sessions"]["Insert"];
export type RecipeSessionUpdate = Database["public"]["Tables"]["recipe_sessions"]["Update"];
export type RecipeRow = Database["public"]["Tables"]["recipes"]["Row"];
export type RecipeInsert = Database["public"]["Tables"]["recipes"]["Insert"];
export type RecipeUpdate = Database["public"]["Tables"]["recipes"]["Update"];

export const RecipeSessionRow = z.object({
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
