import { z } from "zod";
import { PhotoId, Recipe, RecipeSession, RecipeSessionId, RecognizedItem } from "@/lib/core/model/recipe";

// Lean per-photo projection for the client — excludes storage internals
// (storage path, object id, user id) so they never reach the browser.
export const PhotoView = z.object({
  id: PhotoId,
  photoUrl: z.string(),
  recognizedItems: z.array(RecognizedItem).nullable(),
});

export type PhotoView = z.infer<typeof PhotoView>;

export const RecognitionResult = z.object({
  session: RecipeSession,
  photos: z.array(PhotoView),
});

export type RecognitionResult = z.infer<typeof RecognitionResult>;

// One recipe list card: the session id is the durable handle for the detail link
// (`/recipes/[id]`) and the delete call; `mealContext` powers the card snippet.
export const RecipeListItem = z.object({
  sessionId: RecipeSessionId,
  name: z.string(),
  createdAt: z.string(),
  mealContext: z.string().nullable(),
});

export type RecipeListItem = z.infer<typeof RecipeListItem>;

// Lean gallery photo for the detail page — just id + signed url (no per-photo recognition,
// no storage internals).
export const RecipeGalleryPhoto = z.object({
  id: PhotoId,
  photoUrl: z.string(),
});

export type RecipeGalleryPhoto = z.infer<typeof RecipeGalleryPhoto>;

// Everything the detail page renders: the recipe (name + markdown body), then the saved session's
// provenance — meal context, the final consolidated item list, and the photo gallery.
export const RecipeDetail = z.object({
  recipe: Recipe,
  mealContext: z.string().nullable(),
  items: z.array(RecognizedItem),
  photos: z.array(RecipeGalleryPhoto),
});

export type RecipeDetail = z.infer<typeof RecipeDetail>;
