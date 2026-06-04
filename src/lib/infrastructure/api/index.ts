import { ParseJsonError, decodeWith, type ErrorCode, type ServerSnapchefError } from "@/lib/core/model/error";
import type { ApiErrorResponsePayload, ApiSuccessResponsePayload } from "@/lib/infrastructure/api/types";
import { Effect } from "effect";
import { match } from "ts-pattern";
import { z } from "zod";

const ERROR_STATUS: Record<ErrorCode, number> = {
  PARSE_JSON_ERROR: 400,
  VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  BUSINESS_RULE_VIOLATED: 422,
  EXTERNAL_SYSTEM_FAILURE: 502,
};

const fieldErrorsFromZodError = (error: z.ZodError): Record<string, string> =>
  error.issues.reduce((acc, issue) => {
    const key = issue.path[0];
    return typeof key === "string" && !(key in acc) ? { ...acc, [key]: issue.message } : acc;
  }, {});

const toErrorApiResponsePayload = (shapchefError: ServerSnapchefError): ApiErrorResponsePayload =>
  match<ServerSnapchefError>(shapchefError)
    .returnType<ApiErrorResponsePayload>()
    .with({ _tag: "ValidationError" }, (error) => ({
      ok: false,
      code: error.code,
      message: error.message,
      fieldErrors: fieldErrorsFromZodError(error.error),
    }))
    .with({ _tag: "BusinessRuleError" }, (error) => ({ ok: false, code: error.code, message: error.message }))
    .with({ _tag: "ExternalSystemError" }, (error) => ({
      ok: false,
      code: error.code,
      message: "An external service failed. Please try again later.",
    }))
    .with({ _tag: "ParseJsonError" }, (error) => ({
      ok: false,
      code: error.code,
      message: "Invalid request body",
    }))
    .exhaustive();

const toApiSuccessResponsePayload = <T>(data: T): ApiSuccessResponsePayload<T> => ({ ok: true, data });

const successPayloadToResponse = <T>(payload: ApiSuccessResponsePayload<T>): Response =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const errorPayloadToResponse = (payload: ApiErrorResponsePayload): Response =>
  new Response(JSON.stringify(payload), {
    status: ERROR_STATUS[payload.code],
    headers: { "Content-Type": "application/json" },
  });

const defectToResponse = (): Effect.Effect<Response> =>
  Effect.succeed(
    new Response(JSON.stringify({ ok: false, message: "Unexpected server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    }),
  );

export const runApiRoute = <T>(effect: Effect.Effect<T, ServerSnapchefError>): Promise<Response> =>
  effect.pipe(
    Effect.map(toApiSuccessResponsePayload),
    Effect.map(successPayloadToResponse),
    Effect.catchAll((error) =>
      Effect.succeed(toErrorApiResponsePayload(error)).pipe(Effect.map(errorPayloadToResponse)),
    ),
    Effect.catchAllDefect(defectToResponse),
    Effect.runPromise,
  );

export const parseRequestBody = <S extends z.ZodType>(
  request: Request,
  schema: S,
): Effect.Effect<z.output<S>, ServerSnapchefError> =>
  Effect.tryPromise({
    try: () => request.json(),
    catch: (cause) => new ParseJsonError({ message: "Invalid request body", cause }),
  }).pipe(Effect.flatMap((body) => decodeWith(schema)(body)));
