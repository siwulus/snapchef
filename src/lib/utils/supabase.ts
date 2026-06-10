import { Effect, Option } from "effect";
import type z from "zod";
import { ShapchefExternalSystemError, SnapchefNotFoundError, type SnapchefServerError } from "../core/model/error";
import { decodeWith } from "./effect";

export const tryErrorDataWithSchema =
  <Schema extends z.ZodType>(schema: Schema) =>
  (fn: () => PromiseLike<{ data: unknown; error: unknown }>): Effect.Effect<z.output<Schema>, SnapchefServerError> =>
    Effect.tryPromise({
      try: fn,
      catch: (cause) => new ShapchefExternalSystemError({ message: "Failed to execute function", cause }),
    }).pipe(
      Effect.flatMap(({ data, error }) =>
        error
          ? Effect.fail(new ShapchefExternalSystemError({ message: "Failed to execute function", cause: error }))
          : Effect.succeed(data),
      ),
      Effect.flatMap((data) => decodeWith(schema)(data)),
    );

export const tryErrorDataOption = <T>(
  fn: () => PromiseLike<{ data: T | null; error: unknown }>,
): Effect.Effect<Option.Option<T>, SnapchefServerError> =>
  Effect.tryPromise({
    try: fn,
    catch: (cause) => new ShapchefExternalSystemError({ message: "Failed to execute function", cause }),
  }).pipe(
    Effect.flatMap(({ data, error }) =>
      error
        ? Effect.fail(new ShapchefExternalSystemError({ message: "Failed to execute function", cause: error }))
        : Effect.succeed(data),
    ),
    Effect.map((data) => Option.fromNullable(data)),
  );

export const tryErrorData = <T>(
  fn: () => PromiseLike<{ data: T | null; error: unknown }>,
): Effect.Effect<T, SnapchefServerError> =>
  tryErrorDataOption(fn).pipe(
    Effect.flatMap((option) =>
      Option.match(option, {
        onNone: () =>
          Effect.fail(
            new SnapchefNotFoundError({
              message: "Data is null",
              cause: new Error("Data is null"),
            }),
          ),
        onSome: (data) => Effect.succeed(data),
      }),
    ),
  );
