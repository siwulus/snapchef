import { type RecipeSessionRepository, type SessionPhotoStorage } from "@/lib/core/boundry/recipe";
import type { SnapchefServerError } from "@/lib/core/model/error";
import { SnapchefNotFoundError } from "@/lib/core/model/error";
import type { RecipeSession } from "@/lib/core/model/recipe";
import { Effect, Option } from "effect";
import { match } from "ts-pattern";

export class RecipeSessionUC {
  constructor(
    private readonly sessionRepository: RecipeSessionRepository,
    private readonly photosStorage: SessionPhotoStorage,
  ) {}

  createSession(userId: string): Effect.Effect<RecipeSession, SnapchefServerError> {
    return this.sessionRepository.create(userId);
  }

  attachPhotos(userId: string, sessionId: string, files: File[]): Effect.Effect<RecipeSession, SnapchefServerError> {
    return this.fetchRecipeSession(userId, sessionId).pipe(
      Effect.tap((session) => this.removeExistingPhotos(session)),
      Effect.flatMap((session) => this.uploadPhotos(session, files)),
      Effect.flatMap(({ session, paths }) => this.updateRecipeSessionWithPhotos(session, paths)),
    );
  }

  // Re-upload replacement: when a session already has photos, drop them before
  // attaching the new set so we reduce orphans (Decision #8). Best-effort —
  // a failed cleanup must never fail the upload.
  private removeExistingPhotos(session: RecipeSession): Effect.Effect<void> {
    return match(session.photoPaths.length)
      .with(0, () => Effect.void)
      .otherwise(() => this.photosStorage.remove(session.photoPaths).pipe(Effect.catchAll(() => Effect.void)));
  }

  private fetchRecipeSession(userId: string, sessionId: string): Effect.Effect<RecipeSession, SnapchefServerError> {
    return this.sessionRepository.find(userId, sessionId).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new SnapchefNotFoundError({ message: "Session not found" })),
          onSome: Effect.succeed,
        }),
      ),
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
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(new SnapchefNotFoundError({ message: "Session not found" })),
            onSome: Effect.succeed,
          }),
        ),
      );
  }
}
