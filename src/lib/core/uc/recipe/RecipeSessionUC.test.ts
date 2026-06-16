import type {
  PhotoRepository,
  ProductRecognizer,
  RecipeGenerator,
  RecipeRepository,
  RecipeSessionRepository,
  RecipeSessionUpdatePayload,
  RecipeWritePayload,
  SessionPhotoStorage,
} from "@/lib/core/boundry/recipe";
import { SnapchefExternalSystemError } from "@/lib/core/model/error";
import type { Recipe, RecipeSession } from "@/lib/core/model/recipe";
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
