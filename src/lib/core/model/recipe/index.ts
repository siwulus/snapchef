import { z } from "zod";
import { UserId } from "../auth";

export const RecipeSessionState = z.enum([
  "created",
  "photos_uploaded",
  "products_recognized",
  "recipe_generated",
  "saved",
]);

export type RecipeSessionState = z.infer<typeof RecipeSessionState>;

export const RecipeSessionId = z.uuid();
export type RecipeSessionId = z.infer<typeof RecipeSessionId>;

export const RecipeSession = z.object({
  id: RecipeSessionId,
  userId: UserId,
  correctedItemsMd: z.string().nullable(),
  createdAt: z.string(),
  mealContext: z.string().nullable(),
  photoPaths: z.array(z.string()),
  recognizedItemsMd: z.string().nullable(),
  state: RecipeSessionState,
  updatedAt: z.string(),
});

export type RecipeSession = z.infer<typeof RecipeSession>;

export const RecipeId = z.uuid();
export type RecipeId = z.infer<typeof RecipeId>;

export const Recipe = z.object({
  id: RecipeId,
  sessionId: RecipeSessionId,
  userId: UserId,
  contentMd: z.string(),
  createdAt: z.string(),
  name: z.string(),
});

export type Recipe = z.infer<typeof Recipe>;
