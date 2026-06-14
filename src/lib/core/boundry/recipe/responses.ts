import { z } from "zod";
import { PhotoId, RecipeSession, RecognizedItem } from "@/lib/core/model/recipe";

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
