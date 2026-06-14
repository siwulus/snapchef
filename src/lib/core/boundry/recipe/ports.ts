import type { Effect, Option } from "effect";
import type { z } from "zod";
import type { SnapchefServerError } from "@/lib/core/model/error";
import { Photo, RecipeSession, StoredPhoto, type RecognizedItem } from "@/lib/core/model/recipe";
import type { UserId } from "@/lib/core/model/auth";

export const RecipeSessionUpdatePayload = RecipeSession.pick({
  correctedItems: true,
  mealContext: true,
  recognizedItems: true,
  state: true,
}).partial();

export type RecipeSessionUpdatePayload = z.infer<typeof RecipeSessionUpdatePayload>;

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
