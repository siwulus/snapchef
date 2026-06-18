import type {
  PhotoRepository,
  ProductRecognizer,
  RecipeGenerator,
  RecipeListFilter,
  RecipeListItem,
  RecipeRepository,
  RecipeSessionRepository,
  RecipeSessionUpdatePayload,
  RecipeWritePayload,
  SessionPhotoStorage,
} from "@/lib/core/boundry/recipe";
import { SnapchefExternalSystemError, SnapchefNotFoundError } from "@/lib/core/model/error";
import type { Photo, Recipe, RecipeSession } from "@/lib/core/model/recipe";
import { RecipeSessionUC } from "@/lib/core/uc/recipe/RecipeSessionUC";
import { Effect, Either, Option } from "effect";
import { describe, expect, it } from "vitest";

const USER_ID = "5838d7ca-5e55-4924-9f8e-e230946fe24a";
const SESSION_ID = "11111111-2222-3333-4444-555555555555";
const RECIPE_ID = "99999999-8888-7777-6666-555555555555";

const baseSession: RecipeSession = {
  id: SESSION_ID,
  userId: USER_ID,
  correctedItems: [{ name: "jajko", quantity: "4 sztuki", context: "z lodówki" }],
  createdAt: "2026-06-16T00:00:00.000Z",
  mealContext: null,
  recognizedItems: [{ name: "jajko", quantity: "4 sztuki", context: "z lodówki" }],
  allowExtraIngredients: null,
  state: "products_recognized",
  updatedAt: "2026-06-16T00:00:00.000Z",
};

const command = {
  correctedItems: [{ name: "jajko", quantity: "4 sztuki", context: "z lodówki" }],
  mealContext: "coś szybkiego na śniadanie",
  allowExtraIngredients: true,
};

// In-memory session repo that records each update payload and reflects it back, so
// getOrThrowNotFound always sees a present session.
const makeSessionRepo = (updateCalls: RecipeSessionUpdatePayload[]): RecipeSessionRepository => ({
  create: () => Effect.succeed(baseSession),
  find: () => Effect.succeed(Option.some(baseSession)),
  update: (_userId, _sessionId, data) => {
    updateCalls.push(data);
    return Effect.succeed(Option.some({ ...baseSession, ...data }));
  },
  remove: () => Effect.void,
});

const stubPhotoRepo = {} as PhotoRepository;
const stubPhotoStorage = {} as SessionPhotoStorage;
const stubRecognizer = {} as ProductRecognizer;

const makeRecipeRepo = (upsertCalls: RecipeWritePayload[]): RecipeRepository => ({
  upsert: (payload) => {
    upsertCalls.push(payload);
    return Effect.succeed<Recipe>({
      id: RECIPE_ID,
      sessionId: payload.sessionId,
      userId: payload.userId,
      name: payload.name,
      contentMd: payload.contentMd,
      createdAt: "2026-06-16T00:00:00.000Z",
    });
  },
  list: () => Effect.succeed([]),
  findBySession: () => Effect.succeed(Option.none()),
});

const successGenerator: RecipeGenerator = {
  generate: () =>
    Effect.succeed({ name: "Jajecznica", contentMd: "## Składniki\n- 4 jajka\n\n## Przygotowanie\n1. Usmaż." }),
};

const failingGenerator: RecipeGenerator = {
  generate: () => Effect.fail(new SnapchefExternalSystemError({ message: "generation failed" })),
};

describe("RecipeSessionUC.generateRecipe", () => {
  it("persists inputs, generates, upserts the recipe, transitions to recipe_generated, returns the recipe", async () => {
    const updateCalls: RecipeSessionUpdatePayload[] = [];
    const upsertCalls: RecipeWritePayload[] = [];
    const uc = new RecipeSessionUC(
      makeSessionRepo(updateCalls),
      stubPhotoRepo,
      stubPhotoStorage,
      stubRecognizer,
      makeRecipeRepo(upsertCalls),
      successGenerator,
    );

    const result = await Effect.runPromise(Effect.either(uc.generateRecipe(USER_ID, SESSION_ID, command)));

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.name).toBe("Jajecznica");
      expect(result.right.contentMd).toContain("## Składniki");
    }
    // Inputs persisted before generation, then the state transition after the upsert.
    expect(updateCalls[0]).toMatchObject({
      correctedItems: command.correctedItems,
      mealContext: command.mealContext,
      allowExtraIngredients: true,
    });
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]).toMatchObject({ sessionId: SESSION_ID, userId: USER_ID, name: "Jajecznica" });
    expect(updateCalls.some((c) => c.state === "recipe_generated")).toBe(true);
  });

  it("surfaces a generator failure and leaves state untouched (no recipe_generated, no recipe write)", async () => {
    const updateCalls: RecipeSessionUpdatePayload[] = [];
    const upsertCalls: RecipeWritePayload[] = [];
    const uc = new RecipeSessionUC(
      makeSessionRepo(updateCalls),
      stubPhotoRepo,
      stubPhotoStorage,
      stubRecognizer,
      makeRecipeRepo(upsertCalls),
      failingGenerator,
    );

    const result = await Effect.runPromise(Effect.either(uc.generateRecipe(USER_ID, SESSION_ID, command)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefExternalSystemError);
    }
    // The inputs write happened, but generation failed: no recipe upsert, no state transition.
    expect(upsertCalls).toHaveLength(0);
    expect(updateCalls.some((c) => c.state === "recipe_generated")).toBe(false);
  });
});

const photo = (id: string, storagePath: string): Photo => ({
  id,
  sessionId: SESSION_ID,
  userId: USER_ID,
  storagePath,
  storageObjectId: null,
  contentType: "image/jpeg",
  sizeBytes: 1234,
  originalFilename: "fridge.jpg",
  recognizedItems: null,
  photoUrl: `https://example.test/${storagePath}`,
  createdAt: "2026-06-16T00:00:00.000Z",
  updatedAt: "2026-06-16T00:00:00.000Z",
});

// A session repo whose `find` outcome is configurable, recording delete calls.
const makeSessionRepoFor = (
  found: boolean,
  updateCalls: RecipeSessionUpdatePayload[],
  deleteCalls: { userId: string; sessionId: string }[],
): RecipeSessionRepository => ({
  create: () => Effect.succeed(baseSession),
  find: () => Effect.succeed(found ? Option.some(baseSession) : Option.none()),
  update: (_userId, _sessionId, data) => {
    updateCalls.push(data);
    return Effect.succeed(Option.some({ ...baseSession, ...data }));
  },
  remove: (userId, sessionId) => {
    deleteCalls.push({ userId, sessionId });
    return Effect.void;
  },
});

describe("RecipeSessionUC.saveSession", () => {
  it("advances the session to `saved` and returns it", async () => {
    const updateCalls: RecipeSessionUpdatePayload[] = [];
    const uc = new RecipeSessionUC(
      makeSessionRepoFor(true, updateCalls, []),
      stubPhotoRepo,
      stubPhotoStorage,
      stubRecognizer,
      {} as RecipeRepository,
      {} as RecipeGenerator,
    );

    const result = await Effect.runPromise(Effect.either(uc.saveSession(USER_ID, SESSION_ID)));

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.state).toBe("saved");
    }
    expect(updateCalls).toEqual([{ state: "saved" }]);
  });

  it("surfaces SnapchefNotFoundError when the session is missing (no update)", async () => {
    const updateCalls: RecipeSessionUpdatePayload[] = [];
    const uc = new RecipeSessionUC(
      makeSessionRepoFor(false, updateCalls, []),
      stubPhotoRepo,
      stubPhotoStorage,
      stubRecognizer,
      {} as RecipeRepository,
      {} as RecipeGenerator,
    );

    const result = await Effect.runPromise(Effect.either(uc.saveSession(USER_ID, SESSION_ID)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefNotFoundError);
    }
    expect(updateCalls).toHaveLength(0);
  });
});

describe("RecipeSessionUC.deleteSession", () => {
  it("removes the listed photos' storage paths, then deletes the session row", async () => {
    const deleteCalls: { userId: string; sessionId: string }[] = [];
    const removeCalls: string[][] = [];
    const photos = [photo("p1", "user/sess/a.jpg"), photo("p2", "user/sess/b.jpg")];
    const photoRepo: PhotoRepository = {
      ...stubPhotoRepo,
      listBySession: () => Effect.succeed(photos),
    };
    const photoStorage: SessionPhotoStorage = {
      ...stubPhotoStorage,
      remove: (paths) => {
        removeCalls.push(paths);
        return Effect.void;
      },
    };
    const uc = new RecipeSessionUC(
      makeSessionRepoFor(true, [], deleteCalls),
      photoRepo,
      photoStorage,
      stubRecognizer,
      {} as RecipeRepository,
      {} as RecipeGenerator,
    );

    const result = await Effect.runPromise(Effect.either(uc.deleteSession(USER_ID, SESSION_ID)));

    expect(Either.isRight(result)).toBe(true);
    expect(removeCalls).toEqual([["user/sess/a.jpg", "user/sess/b.jpg"]]);
    expect(deleteCalls).toEqual([{ userId: USER_ID, sessionId: SESSION_ID }]);
  });

  it("still deletes the session when storage cleanup fails (best-effort)", async () => {
    const deleteCalls: { userId: string; sessionId: string }[] = [];
    const photoRepo: PhotoRepository = {
      ...stubPhotoRepo,
      listBySession: () => Effect.succeed([photo("p1", "user/sess/a.jpg")]),
    };
    const photoStorage: SessionPhotoStorage = {
      ...stubPhotoStorage,
      remove: () => Effect.fail(new SnapchefExternalSystemError({ message: "storage down" })),
    };
    const uc = new RecipeSessionUC(
      makeSessionRepoFor(true, [], deleteCalls),
      photoRepo,
      photoStorage,
      stubRecognizer,
      {} as RecipeRepository,
      {} as RecipeGenerator,
    );

    const result = await Effect.runPromise(Effect.either(uc.deleteSession(USER_ID, SESSION_ID)));

    expect(Either.isRight(result)).toBe(true);
    expect(deleteCalls).toEqual([{ userId: USER_ID, sessionId: SESSION_ID }]);
  });

  it("surfaces SnapchefNotFoundError before any deletion when the session is missing", async () => {
    const deleteCalls: { userId: string; sessionId: string }[] = [];
    const removeCalls: string[][] = [];
    const photoRepo: PhotoRepository = {
      ...stubPhotoRepo,
      listBySession: () => Effect.succeed([photo("p1", "user/sess/a.jpg")]),
    };
    const photoStorage: SessionPhotoStorage = {
      ...stubPhotoStorage,
      remove: (paths) => {
        removeCalls.push(paths);
        return Effect.void;
      },
    };
    const uc = new RecipeSessionUC(
      makeSessionRepoFor(false, [], deleteCalls),
      photoRepo,
      photoStorage,
      stubRecognizer,
      {} as RecipeRepository,
      {} as RecipeGenerator,
    );

    const result = await Effect.runPromise(Effect.either(uc.deleteSession(USER_ID, SESSION_ID)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefNotFoundError);
    }
    expect(removeCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });
});

describe("RecipeSessionUC.listSavedRecipes", () => {
  it("returns the saved recipes from the repository, scoped to the user and filtered to `saved`", async () => {
    const items: RecipeListItem[] = [
      { sessionId: SESSION_ID, name: "Jajecznica", createdAt: "2026-06-16T00:00:00.000Z", mealContext: "śniadanie" },
    ];
    const listCalls: { userId: string; filter: RecipeListFilter }[] = [];
    const recipeRepo: RecipeRepository = {
      upsert: () => Effect.fail(new SnapchefExternalSystemError({ message: "unused" })),
      list: (userId, filter) => {
        listCalls.push({ userId, filter });
        return Effect.succeed(items);
      },
      findBySession: () => Effect.succeed(Option.none()),
    };
    const uc = new RecipeSessionUC(
      makeSessionRepoFor(true, [], []),
      stubPhotoRepo,
      stubPhotoStorage,
      stubRecognizer,
      recipeRepo,
      {} as RecipeGenerator,
    );

    const result = await Effect.runPromise(uc.listSavedRecipes(USER_ID));

    expect(result).toEqual(items);
    expect(listCalls).toEqual([{ userId: USER_ID, filter: { state: "saved" } }]);
  });
});

const savedSession: RecipeSession = { ...baseSession, state: "saved" };

const sampleRecipe: Recipe = {
  id: RECIPE_ID,
  sessionId: SESSION_ID,
  userId: USER_ID,
  name: "Jajecznica",
  contentMd: "## Składniki\n- 4 jajka",
  createdAt: "2026-06-16T00:00:00.000Z",
};

const sessionRepoReturning = (session: RecipeSession | null): RecipeSessionRepository => ({
  create: () => Effect.succeed(baseSession),
  find: () => Effect.succeed(session ? Option.some(session) : Option.none()),
  update: (_userId, _sessionId, data) => Effect.succeed(Option.some({ ...baseSession, ...data })),
  remove: () => Effect.void,
});

const recipeRepoFindBySession = (recipe: Recipe | null): RecipeRepository => ({
  upsert: () => Effect.fail(new SnapchefExternalSystemError({ message: "unused" })),
  list: () => Effect.succeed([]),
  findBySession: () => Effect.succeed(recipe ? Option.some(recipe) : Option.none()),
});

const photoRepoListing = (photos: Photo[]): PhotoRepository => ({
  ...stubPhotoRepo,
  listBySession: () => Effect.succeed(photos),
});

describe("RecipeSessionUC.getSavedRecipe", () => {
  it("composes the detail from a saved session, its recipe, and photos (items from correctedItems)", async () => {
    const photos = [photo("p1", "user/sess/a.jpg")];
    const uc = new RecipeSessionUC(
      sessionRepoReturning(savedSession),
      photoRepoListing(photos),
      stubPhotoStorage,
      stubRecognizer,
      recipeRepoFindBySession(sampleRecipe),
      {} as RecipeGenerator,
    );

    const result = await Effect.runPromise(uc.getSavedRecipe(USER_ID, SESSION_ID));

    expect(result.recipe).toEqual({
      id: RECIPE_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
      name: "Jajecznica",
      contentMd: sampleRecipe.contentMd,
      createdAt: sampleRecipe.createdAt,
    });
    expect(result.mealContext).toBe(savedSession.mealContext);
    expect(result.items).toEqual(baseSession.correctedItems);
    expect(result.photos).toEqual([{ id: "p1", photoUrl: "https://example.test/user/sess/a.jpg" }]);
  });

  it("fails SnapchefNotFoundError when the session is not in the `saved` state", async () => {
    const uc = new RecipeSessionUC(
      sessionRepoReturning(baseSession), // state: products_recognized
      photoRepoListing([]),
      stubPhotoStorage,
      stubRecognizer,
      recipeRepoFindBySession(sampleRecipe),
      {} as RecipeGenerator,
    );

    const result = await Effect.runPromise(Effect.either(uc.getSavedRecipe(USER_ID, SESSION_ID)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefNotFoundError);
    }
  });

  it("fails SnapchefNotFoundError when the session is missing or not owned", async () => {
    const uc = new RecipeSessionUC(
      sessionRepoReturning(null),
      photoRepoListing([]),
      stubPhotoStorage,
      stubRecognizer,
      recipeRepoFindBySession(sampleRecipe),
      {} as RecipeGenerator,
    );

    const result = await Effect.runPromise(Effect.either(uc.getSavedRecipe(USER_ID, SESSION_ID)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefNotFoundError);
    }
  });

  it("fails SnapchefNotFoundError when a saved session has no recipe row", async () => {
    const uc = new RecipeSessionUC(
      sessionRepoReturning(savedSession),
      photoRepoListing([]),
      stubPhotoStorage,
      stubRecognizer,
      recipeRepoFindBySession(null),
      {} as RecipeGenerator,
    );

    const result = await Effect.runPromise(Effect.either(uc.getSavedRecipe(USER_ID, SESSION_ID)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefNotFoundError);
    }
  });
});
