import { Data } from "effect";
import { z } from "zod";

export class SnapchefAuthenticationError extends Data.TaggedError("SnapchefAuthenticationError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  readonly code = 401 as const;
}

export class SnapchefAuthorizationError extends Data.TaggedError("SnapchefAuthorizationError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  readonly code = 403 as const;
}

export class SnapchefEmailNotConfirmedError extends Data.TaggedError("SnapchefEmailNotConfirmedError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  readonly code = 403 as const;
}

export class SnapchefNotFoundError extends Data.TaggedError("SnapchefNotFoundError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  readonly code = 404 as const;
}

export class SnapchefConflictError extends Data.TaggedError("SnapchefConflictError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  readonly code = 409 as const;
}

export class SnapchefBusinessRuleViolationError extends Data.TaggedError("SnapchefBusinessRuleViolationError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  readonly code = 422 as const;
}

export class SnapchefParseError extends Data.TaggedError("SnapchefParseError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  readonly code = 400 as const;
}

export class SnapchefInternalSystemError extends Data.TaggedError("SnapchefInternalSystemError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  readonly code = 502 as const;
}

export class SnapchefExternalSystemError extends Data.TaggedError("SnapchefExternalSystemError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  readonly code = 500 as const;
}

export class SnapchefValidationError extends Data.TaggedError("SnapchefValidationError")<{
  readonly message: string;
  readonly zodError: z.ZodError;
  readonly cause?: unknown;
}> {
  readonly code = 400 as const;
}

export class SnapchefDatabaseError extends Data.TaggedError("SnapchefDatabaseError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  readonly code = 500 as const;
}

export class SnapchefUnexpectedError extends Data.TaggedError("SnapchefUnexpectedError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  readonly code = 500 as const;
}

export type SnapchefServerError =
  | SnapchefAuthenticationError
  | SnapchefAuthorizationError
  | SnapchefEmailNotConfirmedError
  | SnapchefNotFoundError
  | SnapchefConflictError
  | SnapchefBusinessRuleViolationError
  | SnapchefParseError
  | SnapchefValidationError
  | SnapchefDatabaseError
  | SnapchefExternalSystemError
  | SnapchefInternalSystemError
  | SnapchefUnexpectedError;
