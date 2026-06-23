import {
  type PhotoRepository,
  type ProductRecognizer,
  type RecipeDetail,
  type RecipeGenerationCommand,
  type RecipeGenerationResult,
  type RecipeGenerator,
  type RecipeListItem,
  type RecipeRepository,
  type RecipeSessionRepository,
  type SessionPhotoStorage,
} from "@/lib/core/boundry/recipe";
import type { SnapchefServerError } from "@/lib/core/model/error";
import {
  SnapchefBusinessRuleViolationError,
  SnapchefExternalSystemError,
  SnapchefNotFoundError,
} from "@/lib/core/model/error";
import { type Photo, type Recipe, type RecipeSession, type RecognizedItem } from "@/lib/core/model/recipe";
import type { SessionStateManager } from "@/lib/core/uc/recipe/recipe-session-transition";
import { getOrThrowNotFound, logResult } from "@/lib/utils/effect";
import { Effect } from "effect";
import { isEmpty, isNotEmpty } from "ramda";
import { match } from "ts-pattern";

export class RecipeSessionUC {
  constructor(
    private readonly sessionRepository: RecipeSessionRepository,
    private readonly photoRepository: PhotoRepository,
    private readonly photosStorage: SessionPhotoStorage,
    private readonly productRecognizer: ProductRecognizer,
    private readonly recipeRepository: RecipeRepository,
    private readonly recipeGenerator: RecipeGenerator,
    // The transition aspect: the sole writer of `state`. Injected (not built here) so it stays
    // external and test-substitutable. Composed in src/middleware.ts from the same sessionRepository.
    private readonly sessions: SessionStateManager,
  ) {}

  createSession(userId: string): Effect.Effect<RecipeSession, SnapchefServerError> {
    return this.sessionRepository.create(userId).pipe(logResult("recipe.createSession"));
  }

  attachPhotos(userId: string, sessionId: string, files: File[]): Effect.Effect<RecipeSession, SnapchefServerError> {
    // Dispatch "upload_photos": the aspect loads + guards (legal from any non-`saved` state), runs
    // the data-only work (drop existing photos, upload + persist the new set), then advances state
    // to photos_uploaded. The returned session is the authoritative post-transition one.
    return this.sessions
      .run("upload_photos", userId, sessionId, (session) =>
        this.removeExistingPhotos(session).pipe(Effect.flatMap(() => this.uploadAndPersistPhotos(session, files))),
      )
      .pipe(
        Effect.map(({ session }) => session),
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
    // Dispatch "recognize_products": the aspect loads + guards (legal from any state with photos),
    // then the data-only work fans out one LLM call per photo, persists the merged list (no state
    // write — wouldn't compile), and the aspect advances state to products_recognized on close.
    return this.sessions
      .run("recognize_products", userId, sessionId, (session) =>
        this.photoRepository.listBySession(session.userId, session.id).pipe(
          Effect.tap((photos) => this.guardHasPhotos(photos)),
          Effect.flatMap((photos) => this.recognizeEachPhoto(session.userId, photos)),
          Effect.flatMap((recognized) =>
            this.resolveItems(recognized.map((entry) => entry.items)).pipe(
              Effect.tap((merged) =>
                this.sessionRepository.update(session.userId, session.id, { recognizedItems: merged }),
              ),
              Effect.map(() => recognized.map((entry) => ({ ...entry.photo, recognizedItems: entry.items }))),
            ),
          ),
        ),
      )
      .pipe(
        Effect.map(({ result, session }) => ({ session, photos: result })),
        logResult("recipe.recognize"),
      );
  }

  // S-02: dispatch "generate_recipe" (legal from products_recognized|recipe_generated). The aspect
  // loads + guards before any work. The data-only business action persists the edited inputs
  // (provenance) BEFORE generating — so a generation failure leaves the session re-runnable with its
  // inputs saved (hence the inputs write lives INSIDE the action, and the aspect's close is
  // state-only). Generate is timed (30 s) and retried once — the only thing that re-rolls a
  // truncated/invalid model response (OpenRouter's model fallback only covers provider-side errors).
  // The recipe is upserted; the aspect then advances state to `recipe_generated` on success only.
  // Returns the recipe together with the post-transition session (the single source of truth the
  // final step renders from) — the session carries the persisted items / meal context / off-list
  // toggle that `Recipe` alone does not.
  generateRecipe(
    userId: string,
    sessionId: string,
    command: RecipeGenerationCommand,
  ): Effect.Effect<RecipeGenerationResult, SnapchefServerError> {
    return this.sessions
      .run("generate_recipe", userId, sessionId, () =>
        this.sessionRepository
          .update(userId, sessionId, {
            correctedItems: command.correctedItems,
            mealContext: command.mealContext,
            allowExtraIngredients: command.allowExtraIngredients,
          })
          .pipe(
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
          ),
      )
      .pipe(
        Effect.map(({ result: recipe, session }) => ({ recipe, session })),
        logResult("recipe.generate"),
      );
  }

  // Final step (save): dispatch "save". The aspect loads + owns the session (NotFound on a
  // missing/foreign row) and guards legality — save is legal only from `recipe_generated` (or the
  // idempotent `saved` self-loop), so saving a session that skipped generation now fails 409. The
  // recipe row already exists from generation, so the business action is a no-op and the aspect's
  // close performs the sole state write.
  saveSession(userId: string, sessionId: string): Effect.Effect<RecipeSession, SnapchefServerError> {
    return this.sessions
      .run("save", userId, sessionId, () => Effect.void)
      .pipe(
        Effect.map(({ session }) => session),
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
      Effect.flatMap(() => this.sessionRepository.remove(userId, sessionId)),
      logResult("recipe.delete"),
    );
  }

  // Readback (S-04): the user's saved recipes as lean list cards, newest first. The `saved`-state
  // filter is the use case's business rule; the repository runs the owner-scoped (RLS-backed) query.
  listSavedRecipes(userId: string): Effect.Effect<RecipeListItem[], SnapchefServerError> {
    return this.recipeRepository.list(userId, { state: "saved" }).pipe(logResult("recipe.listSaved"));
  }

  // Readback (S-04): the full detail of one saved recipe — body + provenance (meal context, the
  // final consolidated item list, the photo gallery). Only the owner's *saved* recipe is viewable;
  // a missing/foreign session or a non-`saved` state both surface as NotFound, so the page can
  // redirect uniformly. The final item list is the edited (corrected) list persisted at generation.
  getSavedRecipe(userId: string, sessionId: string): Effect.Effect<RecipeDetail, SnapchefServerError> {
    return this.fetchRecipeSession(userId, sessionId).pipe(
      Effect.flatMap((session) =>
        match(session.state)
          .with("saved", () => Effect.succeed(session))
          .otherwise(() =>
            Effect.fail<SnapchefServerError>(new SnapchefNotFoundError({ message: "Recipe not saved" })),
          ),
      ),
      Effect.flatMap((session) =>
        this.recipeRepository.findBySession(userId, sessionId).pipe(
          Effect.flatMap(getOrThrowNotFound("Recipe not found")),
          Effect.flatMap((recipe) =>
            this.photoRepository
              .listBySession(userId, sessionId)
              .pipe(Effect.map((photos) => this.toRecipeDetail(session, recipe, photos))),
          ),
        ),
      ),
      logResult("recipe.getSaved"),
    );
  }

  // Assemble the detail payload: drop the recipe's owner id (Recipe shape), take the final
  // consolidated list (corrected, falling back to recognized), and project photos to the gallery.
  private toRecipeDetail(session: RecipeSession, recipe: Recipe, photos: Photo[]): RecipeDetail {
    return {
      recipe,
      mealContext: session.mealContext,
      items: session.correctedItems ?? session.recognizedItems ?? [],
      photos: photos.map((photo) => ({ id: photo.id, photoUrl: photo.photoUrl })),
    };
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
        match(isEmpty(photos))
          .with(true, () => Effect.void)
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

  private guardHasPhotos(photos: Photo[]): Effect.Effect<void, SnapchefServerError> {
    return match(isEmpty(photos))
      .with(true, () => Effect.fail(new SnapchefBusinessRuleViolationError({ message: "No photos to recognize" })))
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
    return match(isEmpty(nonEmptyLists))
      .with(true, () =>
        Effect.fail<SnapchefServerError>(
          new SnapchefExternalSystemError({ message: "Recognition produced no items for any photo" }),
        ),
      )
      .otherwise(() => this.productRecognizer.mergeItems(nonEmptyLists.flat()));
  }
}
