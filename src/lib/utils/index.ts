import { Effect } from "effect";
import type z from "zod";
import { ValidationError } from "../core/model/error";

export const decodeWith =
  <Schema extends z.ZodType>(schema: Schema) =>
  (input: unknown): Effect.Effect<z.output<Schema>, ValidationError> => {
    const result = schema.safeParse(input);
    return result.success
      ? Effect.succeed(result.data)
      : Effect.fail(new ValidationError({ message: "Validation failed", error: result.error }));
  };
