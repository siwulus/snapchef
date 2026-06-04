import type { ErrorCode } from "@/lib/core/model/error";

export interface ApiErrorResponsePayload {
  ok: false;
  code: ErrorCode;
  message?: string;
  fieldErrors?: Record<string, string>;
}

export interface ApiSuccessResponsePayload<T> {
  ok: true;
  data: T;
}

export type ApiResponsePayload<T> = ApiErrorResponsePayload | ApiSuccessResponsePayload<T>;
