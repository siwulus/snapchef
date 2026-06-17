import type { Effect, Option } from "effect";
import type { z } from "zod";
import type { SnapchefServerError } from "@/lib/core/model/error";
import { Photo, Recipe, RecipeSession, StoredPhoto, type RecognizedItem } from "@/lib/core/model/recipe";
import type { UserId } from "@/lib/core/model/auth";
// Type-only, same-folder reference: the list-read port returns the driving-side client projection.
import type { SavedRecipeListItem } from "./responses";

export const RecipeSessionUpdatePayload = RecipeSession.pick({
  correctedItems: true,
  mealContext: true,
  recognizedItems: true,
  allowExtraIngredients: true,
  state: true,
}).partial();

export type RecipeSessionUpdatePayload = z.infer<typeof RecipeSessionUpdatePayload>;

export const RecipeWritePayload = Recipe.pick({
  sessionId: true,
  userId: true,
  name: true,
  contentMd: true,
});

export type RecipeWritePayload = z.infer<typeof RecipeWritePayload>;

// The storage metadata returned by a binary upload — the path plus the stable
// storage object id, so the UC can persist them onto the photo row.
export interface StoredObject {
  path: string;
  objectId: string | null;
  fullPath: string;
}

export const PhotoCreatePayload = StoredPhoto.pick({
  sessionId: true,
  userId: true,
  storagePath: true,
  storageObjectId: true,
  contentType: true,
  sizeBytes: true,
  originalFilename: true,
});

export type PhotoCreatePayload = z.infer<typeof PhotoCreatePayload>;

export interface RecipeSessionRepository {
  create(userId: UserId): Effect.Effect<RecipeSession, SnapchefServerError>;
  update(
    userId: UserId,
    sessionId: string,
    data: RecipeSessionUpdatePayload,
  ): Effect.Effect<Option.Option<RecipeSession>, SnapchefServerError>;
  find(userId: UserId, sessionId: string): Effect.Effect<Option.Option<RecipeSession>, SnapchefServerError>;
  delete(userId: UserId, sessionId: string): Effect.Effect<void, SnapchefServerError>;
}

export interface SessionPhotoStorage {
  upload(userId: UserId, sessionId: string, file: File): Effect.Effect<StoredObject, SnapchefServerError>;
  createPreviewUrls(paths: string[]): Effect.Effect<{ path: string; previewUrl: string }[], SnapchefServerError>;
  remove(paths: string[]): Effect.Effect<void, SnapchefServerError>;
}

export interface PhotoRepository {
  create(payload: PhotoCreatePayload): Effect.Effect<StoredPhoto, SnapchefServerError>;
  // Lists a session's photos and populates each `photoUrl` with a signed URL.
  listBySession(userId: UserId, sessionId: string): Effect.Effect<Photo[], SnapchefServerError>;
  updateRecognizedItems(
    userId: UserId,
    photoId: string,
    items: RecognizedItem[],
  ): Effect.Effect<StoredPhoto, SnapchefServerError>;
  deleteBySession(userId: UserId, sessionId: string): Effect.Effect<void, SnapchefServerError>;
}

export interface ProductRecognizer {
  recognizePhoto(url: string): Effect.Effect<RecognizedItem[], SnapchefServerError>;
  mergeItems(lists: RecognizedItem[]): Effect.Effect<RecognizedItem[], SnapchefServerError>;
}

export interface RecipeRepository {
  // Idempotent upsert keyed on the session's UNIQUE session_id — one recipe per session,
  // overwrite-safe on re-generation. Returns the saved domain Recipe.
  upsert(payload: RecipeWritePayload): Effect.Effect<Recipe, SnapchefServerError>;
  // Lists the user's saved recipes (sessions in state `saved`), newest first, as lean list cards.
  listSaved(userId: UserId): Effect.Effect<SavedRecipeListItem[], SnapchefServerError>;
  // Fetches the single recipe belonging to a session (owner-scoped); absence is `Option.none()`.
  findBySession(userId: UserId, sessionId: string): Effect.Effect<Option.Option<Recipe>, SnapchefServerError>;
}

export interface RecipeGenerator {
  // Generate a recipe from the edited product list, the user's free-text meal context, and the
  // off-list-ingredients preference. Returns the AI-generated name and the markdown body
  // (already mapped to the domain's `contentMd` vocabulary).
  generate(input: {
    items: RecognizedItem[];
    mealContext: string;
    allowExtraIngredients: boolean;
  }): Effect.Effect<{ name: string; contentMd: string }, SnapchefServerError>;
}
