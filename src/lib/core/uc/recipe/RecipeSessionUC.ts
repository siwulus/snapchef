import {
  type PhotoRepository,
  type ProductRecognizer,
  type RecipeSessionRepository,
  type SessionPhotoStorage,
} from "@/lib/core/boundry/recipe";
import type { SnapchefServerError } from "@/lib/core/model/error";
import { SnapchefBusinessRuleViolationError, SnapchefExternalSystemError } from "@/lib/core/model/error";
import { type Photo, type RecipeSession, type RecognizedItem } from "@/lib/core/model/recipe";
import { getOrThrowNotFound, logResult } from "@/lib/utils/effect";
import { Effect } from "effect";
import { isNotEmpty } from "ramda";
import { match } from "ts-pattern";

export class RecipeSessionUC {
  constructor(
    private readonly sessionRepository: RecipeSessionRepository,
    private readonly photoRepository: PhotoRepository,
    private readonly photosStorage: SessionPhotoStorage,
    private readonly productRecognizer: ProductRecognizer,
  ) {}

  createSession(userId: string): Effect.Effect<RecipeSession, SnapchefServerError> {
    return this.sessionRepository.create(userId).pipe(logResult("recipe.createSession"));
  }

  attachPhotos(userId: string, sessionId: string, files: File[]): Effect.Effect<RecipeSession, SnapchefServerError> {
    return this.fetchRecipeSession(userId, sessionId).pipe(
      Effect.tap((session) => this.removeExistingPhotos(session)),
      Effect.flatMap((session) => this.uploadAndPersistPhotos(session, files)),
      Effect.flatMap((session) => this.markPhotosUploaded(session)),
      logResult("recipe.attachPhotos"),
    );
  }

  // Fan-out one LLM call per photo (concurrent, timed, retried once, per-photo failure → []),
  // persist each photo's recognized items, merge across photos when more than one produced items,
  // and persist the merged list on the session. Retry-safe: any state with photos may re-run.
  recognizeProducts(
    userId: string,
    sessionId: string,
  ): Effect.Effect<{ session: RecipeSession; photos: Photo[] }, SnapchefServerError> {
    return this.fetchRecipeSession(userId, sessionId).pipe(
      Effect.flatMap((session) =>
        this.photoRepository.listBySession(session.userId, session.id).pipe(
          Effect.tap((photos) => this.guardHasPhotos(photos)),
          Effect.flatMap((photos) => this.recognizeEachPhoto(session.userId, photos)),
          Effect.flatMap((recognized) =>
            this.resolveItems(recognized.map((entry) => entry.items)).pipe(
              Effect.flatMap((merged) => this.persistRecognizedItems(session, merged)),
              Effect.map((updatedSession) => ({
                session: updatedSession,
                photos: recognized.map((entry) => ({ ...entry.photo, recognizedItems: entry.items })),
              })),
            ),
          ),
        ),
      ),
      logResult("recipe.recognize"),
    );
  }

  private fetchRecipeSession(userId: string, sessionId: string): Effect.Effect<RecipeSession, SnapchefServerError> {
    return this.sessionRepository.find(userId, sessionId).pipe(Effect.flatMap(getOrThrowNotFound("Session not found")));
  }

  // Re-upload replacement: when a session already has photos, drop them (storage + rows) before
  // attaching the new set so we reduce orphans (Decision #8). Best-effort —
  // a failed cleanup must never fail the upload.
  private removeExistingPhotos(session: RecipeSession): Effect.Effect<void> {
    return this.photoRepository.listBySession(session.userId, session.id).pipe(
      Effect.flatMap((photos) =>
        match(photos.length)
          .with(0, () => Effect.void)
          .otherwise(() =>
            this.photosStorage
              .remove(photos.map((photo) => photo.storagePath))
              .pipe(Effect.flatMap(() => this.photoRepository.deleteBySession(session.userId, session.id))),
          ),
      ),
      Effect.catchAll(() => Effect.void),
    );
  }

  private uploadAndPersistPhotos(
    session: RecipeSession,
    files: File[],
  ): Effect.Effect<RecipeSession, SnapchefServerError> {
    return Effect.forEach(files, (file) =>
      this.photosStorage.upload(session.userId, session.id, file).pipe(
        Effect.flatMap((stored) =>
          this.photoRepository.create({
            sessionId: session.id,
            userId: session.userId,
            storagePath: stored.path,
            storageObjectId: stored.objectId,
            contentType: file.type,
            sizeBytes: file.size,
            originalFilename: file.name,
          }),
        ),
      ),
    ).pipe(Effect.as(session));
  }

  private markPhotosUploaded(session: RecipeSession): Effect.Effect<RecipeSession, SnapchefServerError> {
    return this.sessionRepository
      .update(session.userId, session.id, { state: "photos_uploaded" })
      .pipe(Effect.flatMap(getOrThrowNotFound("Session not found")));
  }

  private guardHasPhotos(photos: Photo[]): Effect.Effect<void, SnapchefServerError> {
    return match(photos.length)
      .with(0, () => Effect.fail(new SnapchefBusinessRuleViolationError({ message: "No photos to recognize" })))
      .otherwise(() => Effect.void);
  }

  // Per photo: ~25 s timeout + one retry; a failing photo resolves to an empty list so a single
  // bad photo never fails the batch. Each photo's items are persisted to its row, and the
  // (photo, items) pair is kept so the response can carry per-photo lists without a re-fetch.
  private recognizeEachPhoto(
    userId: string,
    photos: Photo[],
  ): Effect.Effect<{ photo: Photo; items: RecognizedItem[] }[], SnapchefServerError> {
    return Effect.forEach(
      photos,
      (photo) =>
        this.productRecognizer.recognizePhoto(photo.photoUrl).pipe(
          Effect.timeout("25 seconds"),
          Effect.retry({ times: 1 }),
          Effect.catchAll(() => Effect.succeed<RecognizedItem[]>([])),
          Effect.flatMap((items) =>
            this.photoRepository.updateRecognizedItems(userId, photo.id, items).pipe(Effect.as({ photo, items })),
          ),
        ),
      { concurrency: 5 },
    );
  }

  // All photos failed → external error (500). Skip the merge call when only one photo yielded items.
  private resolveItems(lists: RecognizedItem[][]): Effect.Effect<RecognizedItem[], SnapchefServerError> {
    const nonEmptyLists = lists.filter((list) => isNotEmpty(list));
    return match(nonEmptyLists.length)
      .with(0, () =>
        Effect.fail<SnapchefServerError>(
          new SnapchefExternalSystemError({ message: "Recognition produced no items for any photo" }),
        ),
      )
      .otherwise(() => this.productRecognizer.mergeItems(nonEmptyLists.flat()));
  }

  private persistRecognizedItems(
    session: RecipeSession,
    items: RecognizedItem[],
  ): Effect.Effect<RecipeSession, SnapchefServerError> {
    return this.sessionRepository
      .update(session.userId, session.id, { recognizedItems: items, state: "products_recognized" })
      .pipe(Effect.flatMap(getOrThrowNotFound("Session not found")));
  }
}
