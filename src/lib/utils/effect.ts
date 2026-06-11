import { Effect } from "effect";
import type z from "zod";
import { SnapchefValidationError } from "../core/model/error";

export const decodeWith =
  <Schema extends z.ZodType>(schema: Schema) =>
  (input: unknown): Effect.Effect<z.output<Schema>, SnapchefValidationError> => {
    const result = schema.safeParse(input);
    return result.success
      ? Effect.succeed(result.data)
      : Effect.fail(new SnapchefValidationError({ message: "Validation failed", zodError: result.error }));
  };
