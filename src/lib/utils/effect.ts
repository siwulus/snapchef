import { Effect, Option } from "effect";
import type z from "zod";
import { ExternalSystemError, ValidationError, type ServerSnapchefError } from "../core/model/error";

export const decodeWith =
  <Schema extends z.ZodType>(schema: Schema) =>
  (input: unknown): Effect.Effect<z.output<Schema>, ValidationError> => {
    const result = schema.safeParse(input);
    return result.success
      ? Effect.succeed(result.data)
      : Effect.fail(new ValidationError({ message: "Validation failed", error: result.error }));
  };

export const tryErrorDataWithSchema =
  <Schema extends z.ZodType>(schema: Schema) =>
  (fn: () => PromiseLike<{ data: unknown; error: unknown }>): Effect.Effect<z.output<Schema>, ServerSnapchefError> =>
    Effect.tryPromise({
      try: fn,
      catch: (cause) => new ExternalSystemError({ message: "Failed to execute function", cause }),
    }).pipe(
      Effect.flatMap(({ data, error }) =>
        error
          ? Effect.fail(new ExternalSystemError({ message: "Failed to execute function", cause: error }))
          : Effect.succeed(data),
      ),
      Effect.flatMap((data) => decodeWith(schema)(data)),
    );

export const tryErrorDataOption = <T>(
  fn: () => PromiseLike<{ data: T | null; error: unknown }>,
): Effect.Effect<Option.Option<T>, ServerSnapchefError> =>
  Effect.tryPromise({
    try: fn,
    catch: (cause) => new ExternalSystemError({ message: "Failed to execute function", cause }),
  }).pipe(
    Effect.flatMap(({ data, error }) =>
      error
        ? Effect.fail(new ExternalSystemError({ message: "Failed to execute function", cause: error }))
        : Effect.succeed(data),
    ),
    Effect.map((data) => Option.fromNullable(data)),
  );

export const tryErrorData = <T>(
  fn: () => PromiseLike<{ data: T | null; error: unknown }>,
): Effect.Effect<T, ServerSnapchefError> =>
  tryErrorDataOption(fn).pipe(
    Effect.flatMap((option) =>
      Option.match(option, {
        onNone: () =>
          Effect.fail(
            new ExternalSystemError({ message: "Failed to execute function", cause: new Error("Data is null") }),
          ),
        onSome: (data) => Effect.succeed(data),
      }),
    ),
  );
