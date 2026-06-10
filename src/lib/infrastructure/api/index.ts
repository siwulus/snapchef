import { ACCEPTED_IMAGE_TYPES, MAX_LLM_IMAGE_BYTES, MAX_PHOTO_BYTES, MAX_PHOTOS } from "@/lib/core/boundry/recipe";
import { ParseJsonError, type ErrorCode, type ServerSnapchefError } from "@/lib/core/model/error";
import type { ApiErrorResponsePayload, ApiSuccessResponsePayload } from "@/lib/infrastructure/api/types";
import { decodeWith } from "@/lib/utils/effect";
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

const uploadedFilesSchema = z
  .array(
    z.custom<File>(
      (v) => {
        if (!(v instanceof File)) return false;
        if (!ACCEPTED_IMAGE_TYPES.includes(v.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) return false;
        if (v.size > MAX_PHOTO_BYTES) return false;
        if (v.size > MAX_LLM_IMAGE_BYTES) return false;
        return true;
      },
      {
        message: `Each file must be jpeg/png/webp, ≤ ${MAX_PHOTO_BYTES / 1024 / 1024} MB, and ≤ ${MAX_LLM_IMAGE_BYTES / 1024 / 1024} MB after resize`,
      },
    ),
  )
  .min(1, "At least one photo is required")
  .max(MAX_PHOTOS, `At most ${MAX_PHOTOS} photos allowed`);

export const parseMultipartFiles = (request: Request, fieldName: string): Effect.Effect<File[], ServerSnapchefError> =>
  Effect.tryPromise({
    try: () => request.formData(),
    catch: (cause) => new ParseJsonError({ message: "Invalid request body", cause }),
  }).pipe(
    Effect.flatMap((formData) => {
      const values = formData.getAll(fieldName);
      const files = values.filter((v): v is File => v instanceof File);
      return decodeWith(uploadedFilesSchema)(files);
    }),
  );
