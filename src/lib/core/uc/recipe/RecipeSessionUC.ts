import {
  type ProductRecognizer,
  type RecipeSessionRepository,
  type SessionPhotoStorage,
} from "@/lib/core/boundry/recipe";
import type { SnapchefServerError } from "@/lib/core/model/error";
import {
  SnapchefBusinessRuleViolationError,
  SnapchefExternalSystemError,
  SnapchefNotFoundError,
} from "@/lib/core/model/error";
import { type RecipeSession, type RecognizedItem } from "@/lib/core/model/recipe";
import { getOrThrowNotFound, logResult } from "@/lib/utils/effect";
import { Effect, Option } from "effect";
import { isNotEmpty } from "ramda";
import { match } from "ts-pattern";

export class RecipeSessionUC {
  constructor(
    private readonly sessionRepository: RecipeSessionRepository,
    private readonly photosStorage: SessionPhotoStorage,
    private readonly productRecognizer: ProductRecognizer,
  ) {}

  createSession(userId: string): Effect.Effect<RecipeSession, SnapchefServerError> {
    return this.sessionRepository.create(userId).pipe(logResult("recipe.createSession"));
  }

  attachPhotos(userId: string, sessionId: string, files: File[]): Effect.Effect<RecipeSession, SnapchefServerError> {
    return this.fetchRecipeSession(userId, sessionId).pipe(
      Effect.tap((session) => this.removeExistingPhotos(session)),
      Effect.flatMap((session) => this.uploadPhotos(session, files)),
      Effect.flatMap(({ session, paths }) => this.updateRecipeSessionWithPhotos(session, paths)),
      logResult("recipe.attachPhotos"),
    );
  }

  // Fan-out one LLM call per photo (concurrent, timed, retried once, per-photo failure → []),
  // merge across photos when more than one produced items, persist the markdown + state.
  // Retry-safe: any state with photos may re-run (overwrites recognized_items_md).
  recognizeProducts(userId: string, sessionId: string): Effect.Effect<RecipeSession, SnapchefServerError> {
    return this.fetchRecipeSession(userId, sessionId).pipe(
      Effect.tap((session) => this.guardHasPhotos(session)),
      Effect.flatMap((session) =>
        this.recognizeAllPhotos(session.photoPaths).pipe(
          Effect.flatMap((lists) => this.resolveItems(lists)),
          Effect.flatMap((items) => this.persistRecognizedItems(session, items)),
        ),
      ),
      logResult("recipe.recognize"),
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
    return this.sessionRepository.find(userId, sessionId).pipe(Effect.flatMap(getOrThrowNotFound("Session not found")));
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

  private guardHasPhotos(session: RecipeSession): Effect.Effect<void, SnapchefServerError> {
    return match(session.photoPaths.length)
      .with(0, () => Effect.fail(new SnapchefBusinessRuleViolationError({ message: "No photos to recognize" })))
      .otherwise(() => Effect.void);
  }

  // Per photo: ~25 s timeout + one retry; a failing photo resolves to an empty list so a single
  // bad photo never fails the batch. createPreviewUrls supplies the 30-min signed URLs the LLM fetches.
  private recognizeAllPhotos(paths: string[]): Effect.Effect<RecognizedItem[][], SnapchefServerError> {
    return this.photosStorage.createPreviewUrls(paths).pipe(
      Effect.flatMap((entries) =>
        Effect.forEach(
          entries,
          (entry) =>
            this.productRecognizer.recognizePhoto(entry.previewUrl).pipe(
              Effect.timeout("25 seconds"),
              Effect.retry({ times: 1 }),
              Effect.catchAll(() => Effect.succeed<RecognizedItem[]>([])),
            ),
          { concurrency: 5 },
        ),
      ),
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
      .update(session.userId, session.id, {
        recognizedItemsMd: this.serializeItemsToMarkdown(items),
        state: "products_recognized",
      })
      .pipe(Effect.flatMap(getOrThrowNotFound("Session not found")));
  }

  private serializeItemsToMarkdown(items: RecognizedItem[]): string {
    return items.map((item) => `- ${item.name} - ${item.quantity}`).join("\n");
  }
}
