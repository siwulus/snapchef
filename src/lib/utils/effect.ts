import {
  SnapchefExternalSystemError,
  SnapchefNotFoundError,
  SnapchefValidationError,
  type SnapchefServerError,
} from "@/lib/core/model/error";
import { Effect, Option } from "effect";
import type z from "zod";

export const decodeWith =
  <Schema extends z.ZodType>(schema: Schema) =>
  (input: unknown): Effect.Effect<z.output<Schema>, SnapchefValidationError> => {
    const result = schema.safeParse(input);
    return result.success
      ? Effect.succeed(result.data)
      : Effect.fail(new SnapchefValidationError({ message: "Validation failed", zodError: result.error }));
  };

const defaultErrFn = (error: unknown) =>
  new SnapchefExternalSystemError({ message: "Failed to execute function", cause: error });

export const tryErrorDataWithSchema =
  <Schema extends z.ZodType>(schema: Schema) =>
  (
    fn: () => PromiseLike<{ data: unknown; error: unknown }>,
    errFn: (error: unknown) => SnapchefServerError = defaultErrFn,
  ): Effect.Effect<z.output<Schema>, SnapchefServerError> =>
    Effect.tryPromise({
      try: fn,
      catch: errFn,
    }).pipe(
      Effect.flatMap(({ data, error }) => (error ? Effect.fail(errFn(error)) : Effect.succeed(data))),
      Effect.flatMap((data) => decodeWith(schema)(data)),
    );

export const tryErrorDataOption = <T>(
  fn: () => PromiseLike<{ data: T | null; error: unknown }>,
  errFn: (error: unknown) => SnapchefServerError = defaultErrFn,
): Effect.Effect<Option.Option<T>, SnapchefServerError> =>
  Effect.tryPromise({
    try: fn,
    catch: errFn,
  }).pipe(
    Effect.flatMap(({ data, error }) => (error ? Effect.fail(errFn(error)) : Effect.succeed(data))),
    Effect.map((data) => Option.fromNullable(data)),
  );

export const tryErrorData = <T>(
  fn: () => PromiseLike<{ data: T | null; error: unknown }>,
  errFn: (error: unknown) => SnapchefServerError = defaultErrFn,
): Effect.Effect<T, SnapchefServerError> =>
  tryErrorDataOption(fn, errFn).pipe(Effect.flatMap(getOrThrowNotFound("Data is null")));

export const getOrThrowNotFound =
  (message = "Data is null") =>
  <T>(option: Option.Option<T>): Effect.Effect<T, SnapchefNotFoundError> =>
    option.pipe(
      Option.match({
        onNone: () => Effect.fail(new SnapchefNotFoundError({ message })),
        onSome: (data) => Effect.succeed(data),
      }),
    );

export const fromNullable = <T>(value: T | null | undefined): Effect.Effect<T, SnapchefNotFoundError> =>
  Effect.fromNullable(value).pipe(
    Effect.flatMap((value) => Effect.succeed(value)),
    Effect.mapError(() => new SnapchefNotFoundError({ message: "Value is null" })),
  );

// Pipe-ready result-logging combinators (identity on value/error/requirement channels) — drop into
// any `.pipe(...)` to observe a step's outcome and timing without changing what it returns.

/** Log the success value under `label` (no-op on failure). */
export const logStep =
  (label: string) =>
  <A, E, R>(eff: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    eff.pipe(Effect.tap((a) => Effect.logInfo(label, a)));

/** Log success as `label.ok` and failure as `label.fail`, and record a `label=<ms>ms` span. */
export const logResult =
  (label: string) =>
  <A, E, R>(eff: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    eff.pipe(
      Effect.tapBoth({
        onSuccess: (a) => Effect.logInfo(`${label}.ok`, a),
        onFailure: (e) => Effect.logError(`${label}.fail`, e),
      }),
      Effect.withLogSpan(label),
    );
