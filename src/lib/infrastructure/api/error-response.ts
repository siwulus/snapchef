import { Effect } from "effect";
import { z } from "zod";
import type { ErrorCode, ServerSnapchefError } from "@/lib/core/model/error";
import type { ApiResult, FieldErrors } from "@/lib/infrastructure/api/types";

export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  BUSINESS_RULE_VIOLATED: 422,
  EXTERNAL_SYSTEM_FAILURE: 502,
};

export const fieldErrorsFromZodError = (error: z.ZodError): FieldErrors =>
  error.issues.reduce<FieldErrors>((acc, issue) => {
    const key = issue.path[0];
    return typeof key === "string" && !(key in acc) ? { ...acc, [key]: issue.message } : acc;
  }, {});

export const errorToApiResult = (error: ServerSnapchefError): ApiResult => {
  switch (error._tag) {
    case "ValidationError":
      return { ok: false, code: error.code, fieldErrors: fieldErrorsFromZodError(error.error) };
    case "BusinessRuleError":
      return { ok: false, code: error.code, message: error.message };
    case "ExternalSystemError":
      return { ok: false, code: error.code, message: "An external service failed. Please try again later." };
  }
};

export const errorToResponse = (error: ServerSnapchefError): Response =>
  new Response(JSON.stringify(errorToApiResult(error)), {
    status: ERROR_STATUS[error.code],
    headers: { "Content-Type": "application/json" },
  });

export const runApiRoute = (effect: Effect.Effect<Response, ServerSnapchefError>): Promise<Response> =>
  Effect.runPromise(
    effect.pipe(
      Effect.catchAll((error) => Effect.succeed(errorToResponse(error))),
      Effect.catchAllDefect(() =>
        Effect.succeed(
          new Response(JSON.stringify({ ok: false, message: "Unexpected server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    ),
  );
