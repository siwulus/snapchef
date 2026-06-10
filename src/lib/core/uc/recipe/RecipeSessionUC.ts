import {
  type ProductRecognizer,
  type RecipeSessionRepository,
  type SessionPhotoStorage,
} from "@/lib/core/boundry/recipe";
import type { SnapchefServerError } from "@/lib/core/model/error";
import { SnapchefBusinessRuleViolationError, SnapchefNotFoundError } from "@/lib/core/model/error";
import type { RecipeSession } from "@/lib/core/model/recipe";
import { Effect } from "effect";

export class RecipeSessionUC {
  constructor(
    private readonly sessionRepository: RecipeSessionRepository,
    private readonly photosStorage: SessionPhotoStorage,
  ) {}

  private _productRecognizer: ProductRecognizer | null = null;

  createSession(userId: string): Effect.Effect<RecipeSession, SnapchefServerError> {
    return this.sessionRepository.create(userId);
  }

  attachPhotos(userId: string, sessionId: string, files: File[]): Effect.Effect<RecipeSession, SnapchefServerError> {
    return this.fetchRecipeSession(userId, sessionId).pipe(
      Effect.flatMap((session) => this.uploadPhotos(session, files)),
      Effect.flatMap(({ session, paths }) => this.updateRecipeSessionWithPhotos(session, paths)),
    );
  }

  recognizeProducts(_userId: string, _sessionId: string): Effect.Effect<RecipeSession, SnapchefServerError> {
    return Effect.fail(new SnapchefBusinessRuleViolationError({ message: "Not implemented" }));
  }

  private fetchRecipeSession(userId: string, sessionId: string): Effect.Effect<RecipeSession, SnapchefServerError> {
    return this.sessionRepository.find(userId, sessionId).pipe(
      Effect.andThen((session) => session),
      Effect.mapError(() => new SnapchefNotFoundError({ message: "Session not found" })),
    );
  }

  private uploadPhotos(
    session: RecipeSession,
    files: File[],
  ): Effect.Effect<{ session: RecipeSession; paths: string[] }, SnapchefServerError> {
    return Effect.all(files.map((file) => this.photosStorage.upload(session.userId, session.id, file))).pipe(
      Effect.map((paths) => ({ session, paths })),
    );
  }

  private updateRecipeSessionWithPhotos(
    session: RecipeSession,
    paths: string[],
  ): Effect.Effect<RecipeSession, SnapchefServerError> {
    return this.sessionRepository
      .update(session.userId, session.id, { photoPaths: paths, state: "photos_uploaded" })
      .pipe(
        Effect.andThen((session) => session),
        Effect.mapError(() => new SnapchefNotFoundError({ message: "Session not found" })),
      );
  }
}
