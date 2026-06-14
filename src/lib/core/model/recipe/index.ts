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

export const RecognizedItem = z.object({
  name: z.string().min(1).max(120).trim(),
  quantity: z.string().min(1).max(60),
  // Short judgment about this item, persisted as JSON alongside name + quantity.
  // On a per-photo list it holds the recognition judgment — the cues / identification
  // reasoning for why this product was spotted on that photo. On the merged/consolidated
  // list it holds the consolidation judgment — why this item belongs in the final set
  // (which per-photo sources merged, dedupe rationale).
  context: z.string().max(280),
});

export type RecognizedItem = z.infer<typeof RecognizedItem>;

export const RecipeSession = z.object({
  id: RecipeSessionId,
  userId: UserId,
  correctedItems: z.array(RecognizedItem).nullable(),
  createdAt: z.string(),
  mealContext: z.string().nullable(),
  recognizedItems: z.array(RecognizedItem).nullable(),
  state: RecipeSessionState,
  updatedAt: z.string(),
});

export type RecipeSession = z.infer<typeof RecipeSession>;

export const PhotoId = z.uuid();
export type PhotoId = z.infer<typeof PhotoId>;

// The persisted shape of a photo row — no transient signed URL.
export const StoredPhoto = z.object({
  id: PhotoId,
  sessionId: RecipeSessionId,
  userId: UserId,
  storagePath: z.string(),
  storageObjectId: z.string().nullable(),
  contentType: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  originalFilename: z.string().nullable(),
  recognizedItems: z.array(RecognizedItem).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type StoredPhoto = z.infer<typeof StoredPhoto>;

// The fetched shape: a stored photo plus the transient signed URL the infra layer
// populates on read. `photoUrl` is never persisted.
export const Photo = StoredPhoto.extend({ photoUrl: z.string() });

export type Photo = z.infer<typeof Photo>;

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
