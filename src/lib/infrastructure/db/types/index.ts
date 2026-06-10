import type { Database } from "@/lib/infrastructure/db/types/generated";

export * from "@/lib/infrastructure/db/types/generated";
export type RecipeSessionRow = Database["public"]["Tables"]["recipe_sessions"]["Row"];
export type RecipeSessionInsert = Database["public"]["Tables"]["recipe_sessions"]["Insert"];
export type RecipeSessionUpdate = Database["public"]["Tables"]["recipe_sessions"]["Update"];
export type RecipeRow = Database["public"]["Tables"]["recipes"]["Row"];
export type RecipeInsert = Database["public"]["Tables"]["recipes"]["Insert"];
export type RecipeUpdate = Database["public"]["Tables"]["recipes"]["Update"];
