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

export const RecipeSession = z.object({
  id: z.uuid(),
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

export const Recipe = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  userId: UserId,
  contentMd: z.string(),
  createdAt: z.string(),
  name: z.string(),
});

export type Recipe = z.infer<typeof Recipe>;
