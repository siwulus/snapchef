import { Data } from "effect";
import { z } from "zod";

export const ErrorCode = z.enum([
  "PARSE_JSON_ERROR",
  "VALIDATION_FAILED",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "BUSINESS_RULE_VIOLATED",
  "EXTERNAL_SYSTEM_FAILURE",
]);

export type ErrorCode = z.infer<typeof ErrorCode>;

export const BusinessRuleErrorCode = ErrorCode.exclude(["VALIDATION_FAILED", "EXTERNAL_SYSTEM_FAILURE"]);

export type BusinessRuleErrorCode = z.infer<typeof BusinessRuleErrorCode>;

export class ParseJsonError extends Data.TaggedError("ParseJsonError")<{
  readonly message: string;
  readonly cause: unknown;
}> {
  readonly code = "PARSE_JSON_ERROR" as const;
}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string;
  readonly error: z.ZodError;
}> {
  readonly code = "VALIDATION_FAILED" as const;
}

export class BusinessRuleError extends Data.TaggedError("BusinessRuleError")<{
  readonly message: string;
  readonly code: BusinessRuleErrorCode;
}> {}

export class ExternalSystemError extends Data.TaggedError("ExternalSystemError")<{
  readonly message: string;
  readonly cause: unknown;
}> {
  readonly code = "EXTERNAL_SYSTEM_FAILURE" as const;
}

export type ServerSnapchefError = ParseJsonError | ValidationError | BusinessRuleError | ExternalSystemError;
