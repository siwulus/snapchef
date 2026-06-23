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
import { SnapchefConflictError, SnapchefExternalSystemError, SnapchefNotFoundError } from "@/lib/core/model/error";
import type { Photo, Recipe, RecipeSession, RecipeSessionState, StoredPhoto } from "@/lib/core/model/recipe";
import { RecipeSessionUC } from "@/lib/core/uc/recipe/RecipeSessionUC";
import { createSessionStateManager } from "@/lib/core/uc/recipe/recipe-session-transition";
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

// A session fixture at an arbitrary FSM state — the aspect's `find` returns this, so the dispatched
// event's legality is decided by `state`.
const sessionAt = (state: RecipeSessionState): RecipeSession => ({ ...baseSession, state });

const command = {
  correctedItems: [{ name: "jajko", quantity: "4 sztuki", context: "z lodówki" }],
  mealContext: "coś szybkiego na śniadanie",
  allowExtraIngredients: true,
};

const stubPhotoRepo = {} as PhotoRepository;
const stubPhotoStorage = {} as SessionPhotoStorage;
const stubRecognizer = {} as ProductRecognizer;

// Build the UC with the REAL transition aspect wired from the same session repo instance, so these
// tests double as UC + aspect + reducer integration tests. The repo's `find` decides the `from`
// state; `transition` is the sole state writer (recorded via the repo's transitionCalls array).
const makeUC = (
  sessionRepo: RecipeSessionRepository,
  overrides: Partial<{
    photoRepo: PhotoRepository;
    photoStorage: SessionPhotoStorage;
    recognizer: ProductRecognizer;
    recipeRepo: RecipeRepository;
    generator: RecipeGenerator;
  }> = {},
): RecipeSessionUC =>
  new RecipeSessionUC(
    sessionRepo,
    overrides.photoRepo ?? stubPhotoRepo,
    overrides.photoStorage ?? stubPhotoStorage,
    overrides.recognizer ?? stubRecognizer,
    overrides.recipeRepo ?? ({} as RecipeRepository),
    overrides.generator ?? ({} as RecipeGenerator),
    createSessionStateManager(sessionRepo),
  );

// In-memory session repo that records each data update and each state transition, reflecting the
// session at `find` so getOrThrowNotFound always sees a present session. `from` defaults to
// baseSession (products_recognized); pass `from` to fix the starting state for FSM legality.
const makeSessionRepo = (
  updateCalls: RecipeSessionUpdatePayload[],
  transitionCalls: RecipeSessionState[],
  from: RecipeSession = baseSession,
): RecipeSessionRepository => ({
  create: () => Effect.succeed(from),
  find: () => Effect.succeed(Option.some(from)),
  update: (_userId, _sessionId, data) => {
    updateCalls.push(data);
    return Effect.succeed(Option.some({ ...from, ...data }));
  },
  transition: (_userId, _sessionId, to) => {
    transitionCalls.push(to);
    return Effect.succeed(Option.some({ ...from, state: to }));
  },
  remove: () => Effect.void,
});

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
  it("persists inputs, generates, upserts, transitions to recipe_generated, returns the recipe and session", async () => {
    const updateCalls: RecipeSessionUpdatePayload[] = [];
    const transitionCalls: RecipeSessionState[] = [];
    const upsertCalls: RecipeWritePayload[] = [];
    const uc = makeUC(makeSessionRepo(updateCalls, transitionCalls), {
      recipeRepo: makeRecipeRepo(upsertCalls),
      generator: successGenerator,
    });

    const result = await Effect.runPromise(Effect.either(uc.generateRecipe(USER_ID, SESSION_ID, command)));

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.recipe.name).toBe("Jajecznica");
      expect(result.right.recipe.contentMd).toContain("## Składniki");
      // The returned session is the post-transition one (state advanced via the aspect).
      expect(result.right.session.state).toBe("recipe_generated");
    }
    // Inputs persisted (data-only) before generation; the state advance is a transition, not an update.
    expect(updateCalls[0]).toMatchObject({
      correctedItems: command.correctedItems,
      mealContext: command.mealContext,
      allowExtraIngredients: true,
    });
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]).toMatchObject({ sessionId: SESSION_ID, userId: USER_ID, name: "Jajecznica" });
    expect(transitionCalls).toContain("recipe_generated");
  });

  it("surfaces a generator failure and leaves state untouched (no recipe_generated transition, no recipe write)", async () => {
    const updateCalls: RecipeSessionUpdatePayload[] = [];
    const transitionCalls: RecipeSessionState[] = [];
    const upsertCalls: RecipeWritePayload[] = [];
    const uc = makeUC(makeSessionRepo(updateCalls, transitionCalls), {
      recipeRepo: makeRecipeRepo(upsertCalls),
      generator: failingGenerator,
    });

    const result = await Effect.runPromise(Effect.either(uc.generateRecipe(USER_ID, SESSION_ID, command)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefExternalSystemError);
    }
    // The inputs write happened, but generation failed: no recipe upsert, no state transition.
    expect(updateCalls[0]).toMatchObject({ mealContext: command.mealContext });
    expect(upsertCalls).toHaveLength(0);
    expect(transitionCalls).not.toContain("recipe_generated");
  });

  it("rejects generate from photos_uploaded with SnapchefConflictError (409) before any work", async () => {
    const updateCalls: RecipeSessionUpdatePayload[] = [];
    const transitionCalls: RecipeSessionState[] = [];
    const upsertCalls: RecipeWritePayload[] = [];
    const uc = makeUC(makeSessionRepo(updateCalls, transitionCalls, sessionAt("photos_uploaded")), {
      recipeRepo: makeRecipeRepo(upsertCalls),
      generator: successGenerator,
    });

    const result = await Effect.runPromise(Effect.either(uc.generateRecipe(USER_ID, SESSION_ID, command)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefConflictError);
      expect(result.left.code).toBe(409);
    }
    // Guard precedes side effects: no inputs write, no upsert, no transition.
    expect(updateCalls).toHaveLength(0);
    expect(upsertCalls).toHaveLength(0);
    expect(transitionCalls).toEqual([]);
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

const storedPhoto = (id: string, storagePath: string): StoredPhoto => ({
  id,
  sessionId: SESSION_ID,
  userId: USER_ID,
  storagePath,
  storageObjectId: null,
  contentType: "image/jpeg",
  sizeBytes: 1234,
  originalFilename: "fridge.jpg",
  recognizedItems: null,
  createdAt: "2026-06-16T00:00:00.000Z",
  updatedAt: "2026-06-16T00:00:00.000Z",
});

describe("RecipeSessionUC.attachPhotos", () => {
  it("uploads + persists the photos and transitions to photos_uploaded (from created)", async () => {
    const transitionCalls: RecipeSessionState[] = [];
    const createCalls: { storagePath: string }[] = [];
    const photoRepo: PhotoRepository = {
      ...stubPhotoRepo,
      listBySession: () => Effect.succeed([]), // no existing photos → removeExistingPhotos is a no-op
      create: (payload) => {
        createCalls.push({ storagePath: payload.storagePath });
        return Effect.succeed(storedPhoto("p1", payload.storagePath));
      },
    };
    const photoStorage: SessionPhotoStorage = {
      ...stubPhotoStorage,
      upload: () => Effect.succeed({ path: "user/sess/a.jpg", objectId: "obj-1", fullPath: "bucket/user/sess/a.jpg" }),
      remove: () => Effect.void,
    };
    const uc = makeUC(makeSessionRepo([], transitionCalls, sessionAt("created")), { photoRepo, photoStorage });

    const file = new File([new Uint8Array([1, 2, 3])], "fridge.jpg", { type: "image/jpeg" });
    const result = await Effect.runPromise(Effect.either(uc.attachPhotos(USER_ID, SESSION_ID, [file])));

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.state).toBe("photos_uploaded");
    }
    expect(createCalls).toHaveLength(1);
    expect(transitionCalls).toEqual(["photos_uploaded"]);
  });

  it("rejects re-upload from the terminal saved state with SnapchefConflictError (409)", async () => {
    const transitionCalls: RecipeSessionState[] = [];
    const uploadCalls: number[] = [];
    const photoRepo: PhotoRepository = { ...stubPhotoRepo, listBySession: () => Effect.succeed([]) };
    const photoStorage: SessionPhotoStorage = {
      ...stubPhotoStorage,
      upload: () => {
        uploadCalls.push(1);
        return Effect.succeed({ path: "x", objectId: null, fullPath: "x" });
      },
      remove: () => Effect.void,
    };
    const uc = makeUC(makeSessionRepo([], transitionCalls, sessionAt("saved")), { photoRepo, photoStorage });

    const file = new File([new Uint8Array([1])], "fridge.jpg", { type: "image/jpeg" });
    const result = await Effect.runPromise(Effect.either(uc.attachPhotos(USER_ID, SESSION_ID, [file])));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefConflictError);
      expect(result.left.code).toBe(409);
    }
    // Guard precedes side effects: nothing uploaded, state never advanced.
    expect(uploadCalls).toHaveLength(0);
    expect(transitionCalls).toEqual([]);
  });
});

describe("RecipeSessionUC.recognizeProducts", () => {
  const recognizer: ProductRecognizer = {
    recognizePhoto: () => Effect.succeed([{ name: "mleko", quantity: "1 l", context: "na drzwiach" }]),
    mergeItems: (lists) => Effect.succeed(lists),
  };

  it("recognizes the session's photos, persists items (data-only), and transitions to products_recognized", async () => {
    const updateCalls: RecipeSessionUpdatePayload[] = [];
    const transitionCalls: RecipeSessionState[] = [];
    const photoRepo: PhotoRepository = {
      ...stubPhotoRepo,
      listBySession: () => Effect.succeed([photo("p1", "user/sess/a.jpg")]),
      updateRecognizedItems: () => Effect.succeed(storedPhoto("p1", "user/sess/a.jpg")),
    };
    const uc = makeUC(makeSessionRepo(updateCalls, transitionCalls, sessionAt("photos_uploaded")), {
      photoRepo,
      recognizer,
    });

    const result = await Effect.runPromise(Effect.either(uc.recognizeProducts(USER_ID, SESSION_ID)));

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.session.state).toBe("products_recognized");
      expect(result.right.photos).toHaveLength(1);
      expect(result.right.photos[0].recognizedItems).toEqual([
        { name: "mleko", quantity: "1 l", context: "na drzwiach" },
      ]);
    }
    // The merged list is persisted via a data-only update; the state advance is a transition.
    expect(updateCalls.some((c) => c.recognizedItems)).toBe(true);
    expect(updateCalls.some((c) => "state" in c)).toBe(false);
    expect(transitionCalls).toEqual(["products_recognized"]);
  });

  it("rejects recognize from created with SnapchefConflictError (409) before listing photos", async () => {
    const updateCalls: RecipeSessionUpdatePayload[] = [];
    const transitionCalls: RecipeSessionState[] = [];
    const listCalls: number[] = [];
    const photoRepo: PhotoRepository = {
      ...stubPhotoRepo,
      listBySession: () => {
        listCalls.push(1);
        return Effect.succeed([photo("p1", "user/sess/a.jpg")]);
      },
      updateRecognizedItems: () => Effect.succeed(storedPhoto("p1", "user/sess/a.jpg")),
    };
    const uc = makeUC(makeSessionRepo(updateCalls, transitionCalls, sessionAt("created")), { photoRepo, recognizer });

    const result = await Effect.runPromise(Effect.either(uc.recognizeProducts(USER_ID, SESSION_ID)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefConflictError);
      expect(result.left.code).toBe(409);
    }
    // Guard precedes side effects: photos never listed, nothing persisted, state never advanced.
    expect(listCalls).toHaveLength(0);
    expect(transitionCalls).toEqual([]);
  });
});

// A session repo whose `find` outcome is configurable, recording delete + transition calls.
const makeSessionRepoFor = (
  found: boolean,
  updateCalls: RecipeSessionUpdatePayload[],
  deleteCalls: { userId: string; sessionId: string }[],
  transitionCalls: RecipeSessionState[] = [],
  from: RecipeSession = baseSession,
): RecipeSessionRepository => ({
  create: () => Effect.succeed(from),
  find: () => Effect.succeed(found ? Option.some(from) : Option.none()),
  update: (_userId, _sessionId, data) => {
    updateCalls.push(data);
    // Owner-scoped update: a missing / unowned row yields None (mirrors the maybeSingle() adapter).
    return Effect.succeed(found ? Option.some({ ...from, ...data }) : Option.none());
  },
  transition: (_userId, _sessionId, to) => {
    transitionCalls.push(to);
    // Owner-scoped state write: a missing / unowned row yields None (mirrors the maybeSingle() adapter).
    return Effect.succeed(found ? Option.some({ ...from, state: to }) : Option.none());
  },
  remove: (userId, sessionId) => {
    deleteCalls.push({ userId, sessionId });
    return Effect.void;
  },
});

describe("RecipeSessionUC.saveSession", () => {
  it("advances a recipe_generated session to `saved` and returns it", async () => {
    const transitionCalls: RecipeSessionState[] = [];
    const uc = makeUC(makeSessionRepoFor(true, [], [], transitionCalls, sessionAt("recipe_generated")));

    const result = await Effect.runPromise(Effect.either(uc.saveSession(USER_ID, SESSION_ID)));

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.state).toBe("saved");
    }
    expect(transitionCalls).toEqual(["saved"]);
  });

  it("surfaces SnapchefNotFoundError when the owner-scoped find matches no row", async () => {
    const transitionCalls: RecipeSessionState[] = [];
    const uc = makeUC(makeSessionRepoFor(false, [], [], transitionCalls, sessionAt("recipe_generated")));

    const result = await Effect.runPromise(Effect.either(uc.saveSession(USER_ID, SESSION_ID)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefNotFoundError);
    }
    // Missing session fails at load, before the guard — no transition attempted.
    expect(transitionCalls).toEqual([]);
  });

  it("rejects save from created (step-skip) with SnapchefConflictError (409)", async () => {
    const transitionCalls: RecipeSessionState[] = [];
    const uc = makeUC(makeSessionRepoFor(true, [], [], transitionCalls, sessionAt("created")));

    const result = await Effect.runPromise(Effect.either(uc.saveSession(USER_ID, SESSION_ID)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefConflictError);
      expect(result.left.code).toBe(409);
    }
    expect(transitionCalls).toEqual([]);
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
    const uc = makeUC(makeSessionRepoFor(true, [], deleteCalls), { photoRepo, photoStorage });

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
    const uc = makeUC(makeSessionRepoFor(true, [], deleteCalls), { photoRepo, photoStorage });

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
    const uc = makeUC(makeSessionRepoFor(false, [], deleteCalls), { photoRepo, photoStorage });

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
    const uc = makeUC(makeSessionRepoFor(true, [], []), { recipeRepo });

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
  transition: (_userId, _sessionId, to) =>
    Effect.succeed(session ? Option.some({ ...session, state: to }) : Option.none()),
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
    const uc = makeUC(sessionRepoReturning(savedSession), {
      photoRepo: photoRepoListing(photos),
      recipeRepo: recipeRepoFindBySession(sampleRecipe),
    });

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
    const uc = makeUC(sessionRepoReturning(baseSession), {
      photoRepo: photoRepoListing([]),
      recipeRepo: recipeRepoFindBySession(sampleRecipe),
    });

    const result = await Effect.runPromise(Effect.either(uc.getSavedRecipe(USER_ID, SESSION_ID)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefNotFoundError);
    }
  });

  it("fails SnapchefNotFoundError when the session is missing or not owned", async () => {
    const uc = makeUC(sessionRepoReturning(null), {
      photoRepo: photoRepoListing([]),
      recipeRepo: recipeRepoFindBySession(sampleRecipe),
    });

    const result = await Effect.runPromise(Effect.either(uc.getSavedRecipe(USER_ID, SESSION_ID)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefNotFoundError);
    }
  });

  it("fails SnapchefNotFoundError when a saved session has no recipe row", async () => {
    const uc = makeUC(sessionRepoReturning(savedSession), {
      photoRepo: photoRepoListing([]),
      recipeRepo: recipeRepoFindBySession(null),
    });

    const result = await Effect.runPromise(Effect.either(uc.getSavedRecipe(USER_ID, SESSION_ID)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefNotFoundError);
    }
  });
});
