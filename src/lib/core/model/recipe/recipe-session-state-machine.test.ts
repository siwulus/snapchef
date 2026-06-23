import { SnapchefConflictError } from "@/lib/core/model/error";
import type { RecipeSessionState } from "@/lib/core/model/recipe";
import { type RecipeSessionEvent, nextState } from "@/lib/core/model/recipe/recipe-session-state-machine";
import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";

// The agreed legal graph (11 edges): upload from every non-`saved` state; recognize from
// photos_uploaded/products_recognized/recipe_generated; generate from
// products_recognized/recipe_generated; save from recipe_generated/saved.
const legalEdges: [RecipeSessionState, RecipeSessionEvent, RecipeSessionState][] = [
  ["created", "upload_photos", "photos_uploaded"],
  ["photos_uploaded", "upload_photos", "photos_uploaded"],
  ["products_recognized", "upload_photos", "photos_uploaded"],
  ["recipe_generated", "upload_photos", "photos_uploaded"],
  ["photos_uploaded", "recognize_products", "products_recognized"],
  ["products_recognized", "recognize_products", "products_recognized"],
  ["recipe_generated", "recognize_products", "products_recognized"],
  ["products_recognized", "generate_recipe", "recipe_generated"],
  ["recipe_generated", "generate_recipe", "recipe_generated"],
  ["recipe_generated", "save", "saved"],
  ["saved", "save", "saved"],
];

// Representative illegal pairs: step-skips and the terminal `saved` rejecting re-edit events.
const illegalPairs: [RecipeSessionState, RecipeSessionEvent][] = [
  ["created", "recognize_products"],
  ["created", "generate_recipe"],
  ["created", "save"],
  ["photos_uploaded", "generate_recipe"],
  ["photos_uploaded", "save"],
  ["products_recognized", "save"],
  ["saved", "upload_photos"],
  ["saved", "recognize_products"],
  ["saved", "generate_recipe"],
];

describe("nextState — legal edges", () => {
  it.each(legalEdges)("%s + %s → %s", async (from, event, expected) => {
    const result = await Effect.runPromise(Effect.either(nextState(event)(from)));

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toBe(expected);
    }
  });
});

describe("nextState — illegal pairs fail with SnapchefConflictError (409)", () => {
  it.each(illegalPairs)("%s + %s → 409 conflict", async (from, event) => {
    const result = await Effect.runPromise(Effect.either(nextState(event)(from)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefConflictError);
      expect(result.left.code).toBe(409);
    }
  });
});
