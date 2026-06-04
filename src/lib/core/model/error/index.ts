import { Data, Effect } from "effect";
import { z } from "zod";

export const ErrorCode = z.enum([
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

export type ServerSnapchefError = ValidationError | BusinessRuleError | ExternalSystemError;

export const decodeWith =
  <Schema extends z.ZodType>(schema: Schema) =>
  (input: unknown): Effect.Effect<z.output<Schema>, ValidationError> => {
    const result = schema.safeParse(input);
    return result.success
      ? Effect.succeed(result.data)
      : Effect.fail(new ValidationError({ message: "Validation failed", error: result.error }));
  };
