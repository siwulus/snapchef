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

// Lean recipe view for the client — excludes the owner's user id.
export const RecipeView = Recipe.omit({ userId: true });

export type RecipeView = z.infer<typeof RecipeView>;

// One saved-recipe list card: the session id is the durable handle for the detail link
// (`/recipes/[id]`) and the delete call; `mealContext` powers the card snippet.
export const SavedRecipeListItem = z.object({
  sessionId: RecipeSessionId,
  name: z.string(),
  createdAt: z.string(),
  mealContext: z.string().nullable(),
});

export type SavedRecipeListItem = z.infer<typeof SavedRecipeListItem>;

// Lean gallery photo for the detail page — just id + signed url (no per-photo recognition,
// no storage internals).
export const RecipeGalleryPhoto = z.object({
  id: PhotoId,
  photoUrl: z.string(),
});

export type RecipeGalleryPhoto = z.infer<typeof RecipeGalleryPhoto>;

// Everything the detail page renders: the recipe (name + markdown body), then the saved session's
// provenance — meal context, the final consolidated item list, and the photo gallery.
export const SavedRecipeDetail = z.object({
  recipe: RecipeView,
  mealContext: z.string().nullable(),
  items: z.array(RecognizedItem),
  photos: z.array(RecipeGalleryPhoto),
});

export type SavedRecipeDetail = z.infer<typeof SavedRecipeDetail>;
