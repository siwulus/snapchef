import {
  type ProductRecognizer,
  type RecipeSessionRepository,
  type SessionPhotoStorage,
} from "@/lib/core/boundry/recipe";
import type { ServerSnapchefError } from "@/lib/core/model/error";
import { BusinessRuleError } from "@/lib/core/model/error";
import { Effect } from "effect";
import type { RecipeSession } from "../../model/recipe";

export class RecipeSessionUC {
  constructor(
    private readonly sessionRepository: RecipeSessionRepository,
    private readonly photosStorage: SessionPhotoStorage,
  ) {}

  private _productRecognizer: ProductRecognizer | null = null;

  createSession(userId: string): Effect.Effect<RecipeSession, ServerSnapchefError> {
    return this.sessionRepository.create(userId);
  }

  attachPhotos(userId: string, sessionId: string, files: File[]): Effect.Effect<RecipeSession, ServerSnapchefError> {
    return this.fetchRecipeSession(userId, sessionId).pipe(
      Effect.flatMap((session) => this.uploadPhotos(session, files)),
      Effect.flatMap(({ session, paths }) => this.updateRecipeSessionWithPhotos(session, paths)),
    );
  }

  recognizeProducts(_userId: string, _sessionId: string): Effect.Effect<RecipeSession, ServerSnapchefError> {
    return Effect.fail(new BusinessRuleError({ code: "BUSINESS_RULE_VIOLATED", message: "Not implemented" }));
  }

  private fetchRecipeSession(userId: string, sessionId: string): Effect.Effect<RecipeSession, ServerSnapchefError> {
    return this.sessionRepository.find(userId, sessionId).pipe(
      Effect.andThen((session) => session),
      Effect.mapError(() => new BusinessRuleError({ code: "NOT_FOUND", message: "Session not found" })),
    );
  }

  private uploadPhotos(
    session: RecipeSession,
    files: File[],
  ): Effect.Effect<{ session: RecipeSession; paths: string[] }, ServerSnapchefError> {
    return Effect.all(files.map((file) => this.photosStorage.upload(session.userId, session.id, file))).pipe(
      Effect.map((paths) => ({ session, paths })),
    );
  }

  private updateRecipeSessionWithPhotos(
    session: RecipeSession,
    paths: string[],
  ): Effect.Effect<RecipeSession, ServerSnapchefError> {
    return this.sessionRepository
      .update(session.userId, session.id, { photoPaths: paths, state: "photos_uploaded" })
      .pipe(
        Effect.andThen((session) => session),
        Effect.mapError(() => new BusinessRuleError({ code: "NOT_FOUND", message: "Session not found" })),
      );
  }
}
