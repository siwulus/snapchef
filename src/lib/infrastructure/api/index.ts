import { ACCEPTED_IMAGE_TYPES, MAX_LLM_IMAGE_BYTES, MAX_PHOTO_BYTES, MAX_PHOTOS } from "@/lib/core/boundry/recipe";
import { SnapchefUser } from "@/lib/core/model/auth";
import {
  SnapchefParseError,
  SnapchefUnexpectedError,
  SnapchefAuthenticationError,
  type SnapchefServerError,
} from "@/lib/core/model/error";
import type { ApiErrorResponsePayload, ApiSuccessResponsePayload } from "@/lib/infrastructure/api/types";
import { runWithLogging } from "@/lib/infrastructure/logging/logger";
import { decodeWith } from "@/lib/utils/effect";
import { Effect } from "effect";
import { z } from "zod";

const fieldErrorsFromZodError = (zodError?: z.ZodError): Record<string, string> =>
  zodError
    ? zodError.issues.reduce((acc, issue) => {
        const key = issue.path[0];
        return typeof key === "string" && !(key in acc) ? { ...acc, [key]: issue.message } : acc;
      }, {})
    : {};

const toErrorResponsePayload = (shapchefError: SnapchefServerError): ApiErrorResponsePayload => ({
  ok: false,
  error: {
    name: shapchefError._tag,
    code: shapchefError.code,
    message: shapchefError.message,
    cause: shapchefError.cause,
    fieldErrors: fieldErrorsFromZodError("zodError" in shapchefError ? shapchefError.zodError : undefined),
  },
});

const toSuccessResponsePayload = <T>(data: T): ApiSuccessResponsePayload<T> => ({ ok: true, data });

const successPayloadToResponse = <T>(payload: ApiSuccessResponsePayload<T>): Effect.Effect<Response> =>
  Effect.succeed(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );

const errorPayloadToResponse = (payload: ApiErrorResponsePayload): Effect.Effect<Response> =>
  Effect.succeed(
    new Response(JSON.stringify(payload), {
      status: payload.error.code,
      headers: { "Content-Type": "application/json" },
    }),
  );

const defectToResponse = (cause: unknown): Effect.Effect<Response> =>
  errorPayloadToResponse(
    toErrorResponsePayload(new SnapchefUnexpectedError({ message: "Unexpected server error", cause })),
  );

export const runApiRoute = <T>(effect: Effect.Effect<T, SnapchefServerError>): Promise<Response> =>
  effect.pipe(
    Effect.map(toSuccessResponsePayload),
    Effect.flatMap(successPayloadToResponse),
    Effect.tapErrorCause((cause) => Effect.logError("api.error", cause)),
    Effect.catchAll((error) => errorPayloadToResponse(toErrorResponsePayload(error))),
    Effect.catchAllDefect(defectToResponse),
    runWithLogging,
  );

export const parseRequestBody = <S extends z.ZodType>(
  request: Request,
  schema: S,
): Effect.Effect<z.output<S>, SnapchefServerError> =>
  Effect.tryPromise({
    try: () => request.json(),
    catch: (cause) => new SnapchefParseError({ message: "Invalid request body", cause }),
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

export const parseMultipartFiles = (request: Request, fieldName: string): Effect.Effect<File[], SnapchefServerError> =>
  Effect.tryPromise({
    try: () => request.formData(),
    catch: (cause) => new SnapchefParseError({ message: "Invalid multipart form data", cause }),
  }).pipe(
    Effect.flatMap((formData) => {
      const values = formData.getAll(fieldName);
      const files = values.filter((v): v is File => v instanceof File);
      return decodeWith(uploadedFilesSchema)(files);
    }),
  );

export const validateAuthUser = (user: unknown): Effect.Effect<SnapchefUser, SnapchefServerError> =>
  decodeWith(SnapchefUser)(user).pipe(
    Effect.mapError((error) => new SnapchefAuthenticationError({ message: "Invalid user", cause: error })),
  );
