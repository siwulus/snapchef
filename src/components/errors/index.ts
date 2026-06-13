import { Data } from "effect";

export class SnapchefClientApiRequestError extends Data.TaggedError("SnapchefClientApiRequestError")<{
  readonly message: string;
  readonly status?: number;
  readonly cause?: unknown;
}> {}

export class SnapchefClientUnexpectedResponseError extends Data.TaggedError("SnapchefClientUnexpectedResponseError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// Local failure marker for the non-recognition stages (resize/create/upload). Transport errors
// (ClientSnapchefError) are toasted by useApiClient; this carries the server-envelope message.
export class SnapchefClientUploadStepError extends Data.TaggedError("SnapchefClientUploadStepError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type SnapchefClientError =
  | SnapchefClientApiRequestError
  | SnapchefClientUnexpectedResponseError
  | SnapchefClientUploadStepError;
