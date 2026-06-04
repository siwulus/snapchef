import type { ErrorCode } from "@/lib/core/model/error";

export type FieldErrors<T = Record<string, string>> = Partial<Record<keyof T & string, string>>;

export type ApiResult<T = Record<string, string>> =
  | { ok: true; redirect?: string }
  | { ok: false; code?: ErrorCode; message?: string; fieldErrors?: FieldErrors<T> };
