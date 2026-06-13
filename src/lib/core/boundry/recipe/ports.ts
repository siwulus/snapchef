import type { Effect, Option } from "effect";
import type { z } from "zod";
import type { SnapchefServerError } from "@/lib/core/model/error";
import { RecipeSession, type RecognizedItem } from "@/lib/core/model/recipe";
import type { UserId } from "@/lib/core/model/auth";

export const RecipeSessionUpdatePayload = RecipeSession.pick({
  correctedItemsMd: true,
  mealContext: true,
  recognizedItemsMd: true,
  state: true,
  photoPaths: true,
}).partial();

export type RecipeSessionUpdatePayload = z.infer<typeof RecipeSessionUpdatePayload>;

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
  upload(userId: UserId, sessionId: string, file: File): Effect.Effect<string, SnapchefServerError>;
  createPreviewUrls(paths: string[]): Effect.Effect<{ path: string; previewUrl: string }[], SnapchefServerError>;
  remove(paths: string[]): Effect.Effect<void, SnapchefServerError>;
}

export interface ProductRecognizer {
  recognizePhoto(url: string): Effect.Effect<RecognizedItem[], SnapchefServerError>;
  mergeItems(lists: RecognizedItem[]): Effect.Effect<RecognizedItem[], SnapchefServerError>;
}
