import { SnapchefConflictError, type SnapchefServerError } from "@/lib/core/model/error";
import type { RecipeSessionState } from "@/lib/core/model/recipe";
import { Effect } from "effect";
import { match, P } from "ts-pattern";
import { z } from "zod";

// The domain events the UC dispatches. The UC never names a target state — it dispatches an event
// and the reducer derives the next state (or rejects the transition as illegal).
export const RecipeSessionEvent = z.enum(["upload_photos", "recognize_products", "generate_recipe", "save"]);
export type RecipeSessionEvent = z.infer<typeof RecipeSessionEvent>;

// Pure FSM reducer: derive the target state for a legal (state, event) pair, or fail 409 on any
// illegal pair. Encodes the 11 legal edges — upload from every non-`saved` state, recognize from
// photos_uploaded/products_recognized/recipe_generated, generate from
// products_recognized/recipe_generated, save from recipe_generated/saved — via `P.union` arms with
// an `.otherwise → fail` default (full (state × event) exhaustiveness is impractical here).
export const nextState =
  (event: RecipeSessionEvent) =>
  (from: RecipeSessionState): Effect.Effect<RecipeSessionState, SnapchefServerError> =>
    match([from, event] as const)
      .with([P.union("created", "photos_uploaded", "products_recognized", "recipe_generated"), "upload_photos"], () =>
        Effect.succeed<RecipeSessionState>("photos_uploaded"),
      )
      .with([P.union("photos_uploaded", "products_recognized", "recipe_generated"), "recognize_products"], () =>
        Effect.succeed<RecipeSessionState>("products_recognized"),
      )
      .with([P.union("products_recognized", "recipe_generated"), "generate_recipe"], () =>
        Effect.succeed<RecipeSessionState>("recipe_generated"),
      )
      .with([P.union("recipe_generated", "saved"), "save"], () => Effect.succeed<RecipeSessionState>("saved"))
      .otherwise(([s, e]) => Effect.fail(new SnapchefConflictError({ message: `Cannot ${e} from state ${s}` })));
