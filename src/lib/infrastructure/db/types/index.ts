import { RecognizedItem } from "@/lib/core/model/recipe";
import type { Database } from "@/lib/infrastructure/db/types/generated";
import z from "zod";

export * from "@/lib/infrastructure/db/types/generated";
export type RecipeSessionRow = Database["public"]["Tables"]["recipe_sessions"]["Row"];
export type RecipeSessionInsert = Database["public"]["Tables"]["recipe_sessions"]["Insert"];
export type RecipeSessionUpdate = Database["public"]["Tables"]["recipe_sessions"]["Update"];
export type RecipeRow = Database["public"]["Tables"]["recipes"]["Row"];
export type RecipeInsert = Database["public"]["Tables"]["recipes"]["Insert"];
export type RecipeUpdate = Database["public"]["Tables"]["recipes"]["Update"];
export type PhotoRow = Database["public"]["Tables"]["photos"]["Row"];
export type PhotoInsert = Database["public"]["Tables"]["photos"]["Insert"];
export type PhotoUpdate = Database["public"]["Tables"]["photos"]["Update"];

export const RecipeSessionRow = z.object({
  id: z.string(),
  user_id: z.string(),
  corrected_items: z.array(RecognizedItem).nullable(),
  created_at: z.string(),
  meal_context: z.string().nullable(),
  recognized_items: z.array(RecognizedItem).nullable(),
  // `.nullish()` (not `.nullable()`) so a Worker that is ahead of the DB — before the additive
  // migration 20260616120000 has been applied — decodes a row missing this column instead of
  // 500-ing. The converter coalesces the absent value (undefined) to null.
  allow_extra_ingredients: z.boolean().nullish(),
  state: z.string(),
  updated_at: z.string(),
});

export const RecipeRow = z.object({
  id: z.string(),
  session_id: z.string(),
  user_id: z.string(),
  content_md: z.string(),
  created_at: z.string(),
  name: z.string(),
});

export const PhotoRow = z.object({
  id: z.string(),
  session_id: z.string(),
  user_id: z.string(),
  storage_path: z.string(),
  storage_object_id: z.string().nullable(),
  content_type: z.string().nullable(),
  size_bytes: z.number().nullable(),
  original_filename: z.string().nullable(),
  recognized_items: z.array(RecognizedItem).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
