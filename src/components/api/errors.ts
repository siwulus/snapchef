import { Data } from "effect";

export class ApiRequestError extends Data.TaggedError("ApiRequestError")<{
  readonly message: string;
  readonly status?: number;
  readonly cause?: unknown;
}> {}

export class UnexpectedResponseError extends Data.TaggedError("UnexpectedResponseError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type ClientSnapchefError = ApiRequestError | UnexpectedResponseError;
