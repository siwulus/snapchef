import type { RecipeSessionRepository } from "@/lib/core/boundry/recipe";
import { SnapchefConflictError, SnapchefExternalSystemError, SnapchefNotFoundError } from "@/lib/core/model/error";
import type { RecipeSession, RecipeSessionState } from "@/lib/core/model/recipe";
import { createSessionStateManager } from "@/lib/core/uc/recipe/recipe-session-transition";
import { Effect, Either, Option } from "effect";
import { describe, expect, it } from "vitest";

const USER_ID = "5838d7ca-5e55-4924-9f8e-e230946fe24a";
const SESSION_ID = "11111111-2222-3333-4444-555555555555";

const sessionAt = (state: RecipeSessionState): RecipeSession => ({
  id: SESSION_ID,
  userId: USER_ID,
  correctedItems: null,
  createdAt: "2026-06-16T00:00:00.000Z",
  mealContext: null,
  allowExtraIngredients: null,
  recognizedItems: null,
  state,
  updatedAt: "2026-06-16T00:00:00.000Z",
});

// Fake repository exercising only the two methods the aspect touches: `find` (load) and
// `transition` (close). The others are present to satisfy the port but are never invoked.
const makeRepo = (opts: {
  found: RecipeSession | null;
  transitionCalls: RecipeSessionState[];
}): RecipeSessionRepository => ({
  create: () => Effect.die("create not used by the aspect"),
  update: () => Effect.die("update not used by the aspect"),
  remove: () => Effect.void,
  find: () => Effect.succeed(opts.found ? Option.some(opts.found) : Option.none()),
  transition: (_userId, _sessionId, to) => {
    opts.transitionCalls.push(to);
    return Effect.succeed(opts.found ? Option.some({ ...opts.found, state: to }) : Option.none());
  },
});

describe("SessionStateManager.run", () => {
  it("legal event: runs the action once and closes by transitioning to the derived state", async () => {
    const transitionCalls: RecipeSessionState[] = [];
    const actionSessions: RecipeSession[] = [];
    const manager = createSessionStateManager(makeRepo({ found: sessionAt("products_recognized"), transitionCalls }));

    const result = await Effect.runPromise(
      Effect.either(
        manager.run("generate_recipe", USER_ID, SESSION_ID, (session) => {
          actionSessions.push(session);
          return Effect.succeed("recipe-payload");
        }),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.result).toBe("recipe-payload");
      expect(result.right.session.state).toBe("recipe_generated");
    }
    // Action ran exactly once, against the loaded session; the derived state was written on close.
    expect(actionSessions).toHaveLength(1);
    expect(transitionCalls).toEqual(["recipe_generated"]);
  });

  it("illegal event: fails SnapchefConflictError (409) before the action runs (guard precedes side effects)", async () => {
    const transitionCalls: RecipeSessionState[] = [];
    const actionSessions: RecipeSession[] = [];
    const manager = createSessionStateManager(makeRepo({ found: sessionAt("created"), transitionCalls }));

    const result = await Effect.runPromise(
      Effect.either(
        manager.run("save", USER_ID, SESSION_ID, (session) => {
          actionSessions.push(session);
          return Effect.succeed("unreachable");
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefConflictError);
      expect(result.left.code).toBe(409);
    }
    // The guard rejected before any side effect: the action never ran and state never advanced.
    expect(actionSessions).toHaveLength(0);
    expect(transitionCalls).toEqual([]);
  });

  it("action failure: surfaces the error and does NOT transition (state advances only on success)", async () => {
    const transitionCalls: RecipeSessionState[] = [];
    const actionSessions: RecipeSession[] = [];
    const manager = createSessionStateManager(makeRepo({ found: sessionAt("products_recognized"), transitionCalls }));

    const result = await Effect.runPromise(
      Effect.either(
        manager.run("generate_recipe", USER_ID, SESSION_ID, (session) => {
          actionSessions.push(session);
          return Effect.fail(new SnapchefExternalSystemError({ message: "generation failed" }));
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefExternalSystemError);
    }
    // The guard passed and the action ran, but its failure means the close (transition) never fires.
    expect(actionSessions).toHaveLength(1);
    expect(transitionCalls).toEqual([]);
  });

  it("missing session: fails SnapchefNotFoundError before the guard, never running the action", async () => {
    const transitionCalls: RecipeSessionState[] = [];
    const actionSessions: RecipeSession[] = [];
    const manager = createSessionStateManager(makeRepo({ found: null, transitionCalls }));

    const result = await Effect.runPromise(
      Effect.either(
        manager.run("generate_recipe", USER_ID, SESSION_ID, (session) => {
          actionSessions.push(session);
          return Effect.succeed("unreachable");
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefNotFoundError);
    }
    expect(actionSessions).toHaveLength(0);
    expect(transitionCalls).toEqual([]);
  });
});
