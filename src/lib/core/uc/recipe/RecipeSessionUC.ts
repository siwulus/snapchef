import {
  type PhotoRepository,
  type ProductRecognizer,
  type RecipeGenerationCommand,
  type RecipeGenerator,
  type RecipeRepository,
  type RecipeSessionRepository,
  type SavedRecipeListItem,
  type SessionPhotoStorage,
} from "@/lib/core/boundry/recipe";
import type { SnapchefServerError } from "@/lib/core/model/error";
import { SnapchefBusinessRuleViolationError, SnapchefExternalSystemError } from "@/lib/core/model/error";
import { type Photo, type Recipe, type RecipeSession, type RecognizedItem } from "@/lib/core/model/recipe";
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
    private readonly recipeRepository: RecipeRepository,
    private readonly recipeGenerator: RecipeGenerator,
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

  // S-02: persist the edited inputs (provenance) BEFORE generating, so a generation failure leaves
  // the session re-runnable with its inputs saved. Generate is timed (30 s) and retried once — the
  // only thing that re-rolls a truncated/invalid model response (OpenRouter's model fallback only
  // covers provider-side errors). The recipe is upserted, then the state advances to
  // `recipe_generated` only after the recipe row is safely persisted.
  generateRecipe(
    userId: string,
    sessionId: string,
    command: RecipeGenerationCommand,
  ): Effect.Effect<Recipe, SnapchefServerError> {
    return this.fetchRecipeSession(userId, sessionId).pipe(
      Effect.flatMap(() =>
        this.sessionRepository
          .update(userId, sessionId, {
            correctedItems: command.correctedItems,
            mealContext: command.mealContext,
            allowExtraIngredients: command.allowExtraIngredients,
          })
          .pipe(Effect.flatMap(getOrThrowNotFound("Session not found"))),
      ),
      Effect.flatMap(() =>
        this.recipeGenerator
          .generate({
            items: command.correctedItems,
            mealContext: command.mealContext,
            allowExtraIngredients: command.allowExtraIngredients,
          })
          .pipe(
            Effect.timeoutFail({
              duration: "30 seconds",
              onTimeout: () => new SnapchefExternalSystemError({ message: "Recipe generation timed out" }),
            }),
            Effect.retry({ times: 1 }),
          ),
      ),
      Effect.flatMap((generated) =>
        this.recipeRepository.upsert({ sessionId, userId, name: generated.name, contentMd: generated.contentMd }),
      ),
      Effect.tap(() =>
        this.sessionRepository
          .update(userId, sessionId, { state: "recipe_generated" })
          .pipe(Effect.flatMap(getOrThrowNotFound("Session not found"))),
      ),
      logResult("recipe.generate"),
    );
  }

  // Final step (save): validate ownership, then advance the session to `saved`. The recipe row
  // already exists from generation, so this is solely a state transition — idempotent,
  // last-write-wins (no `recipe_generated` precondition).
  saveSession(userId: string, sessionId: string): Effect.Effect<RecipeSession, SnapchefServerError> {
    return this.fetchRecipeSession(userId, sessionId).pipe(
      Effect.flatMap(() => this.sessionRepository.update(userId, sessionId, { state: "saved" })),
      Effect.flatMap(getOrThrowNotFound("Session not found")),
      logResult("recipe.save"),
    );
  }

  // Final step (delete): validate ownership, clean up the storage-bucket files (best-effort,
  // mirroring removeExistingPhotos), then hard-delete the session row. The DB `on delete cascade`
  // drops the recipe + photo rows. Files must be removed BEFORE the row is gone — afterwards the
  // photos can no longer be listed.
  deleteSession(userId: string, sessionId: string): Effect.Effect<void, SnapchefServerError> {
    return this.fetchRecipeSession(userId, sessionId).pipe(
      Effect.tap((session) => this.removeSessionPhotos(session)),
      Effect.flatMap(() => this.sessionRepository.delete(userId, sessionId)),
      logResult("recipe.delete"),
    );
  }

  // Readback (S-04): the user's saved recipes as lean list cards, newest first. Owner scoping +
  // the `saved`-state filter live in the repository query (RLS-backed).
  listSavedRecipes(userId: string): Effect.Effect<SavedRecipeListItem[], SnapchefServerError> {
    return this.recipeRepository.listSaved(userId).pipe(logResult("recipe.listSaved"));
  }

  // Best-effort storage cleanup for a session about to be deleted — a transient storage hiccup
  // must never block the delete (the DB rows still go via cascade). Mirrors removeExistingPhotos.
  private removeSessionPhotos(session: RecipeSession): Effect.Effect<void> {
    return this.photoRepository.listBySession(session.userId, session.id).pipe(
      Effect.flatMap((photos) =>
        match(photos.length)
          .with(0, () => Effect.void)
          .otherwise(() => this.photosStorage.remove(photos.map((photo) => photo.storagePath))),
      ),
      Effect.catchAll(() => Effect.void),
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
