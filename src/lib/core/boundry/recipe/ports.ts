import type { Effect, Option } from "effect";
import { z } from "zod";
import type { ExternalSystemError, ServerSnapchefError } from "@/lib/core/model/error";
import { RecipeSession } from "@/lib/core/model/recipe";
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
  create(userId: UserId): Effect.Effect<RecipeSession, ServerSnapchefError>;
  update(
    userId: UserId,
    sessionId: string,
    data: RecipeSessionUpdatePayload,
  ): Effect.Effect<Option.Option<RecipeSession>, ServerSnapchefError>;
  find(userId: UserId, sessionId: string): Effect.Effect<Option.Option<RecipeSession>, ServerSnapchefError>;
}

export interface SessionPhotoStorage {
  upload(userId: UserId, sessionId: string, file: File): Effect.Effect<string, ServerSnapchefError>;
  createPreviewUrls(paths: string[]): Effect.Effect<{ path: string; previewUrl: string }[], ServerSnapchefError>;
}

export const RecognizedItem = z.object({
  name: z.string().min(1).max(120).trim(),
  quantity: z.string().min(1).max(60),
});

export type RecognizedItem = z.infer<typeof RecognizedItem>;

export interface ProductRecognizer {
  recognizePhoto(url: string): Effect.Effect<RecognizedItem[], ExternalSystemError>;
  mergeItems(lists: RecognizedItem[]): Effect.Effect<RecognizedItem[], ExternalSystemError>;
}
