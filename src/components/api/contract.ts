import { z } from "zod";
import { ErrorCode } from "@/lib/core/model/error";
import type { ApiResponsePayload } from "@/lib/infrastructure/api/types";
import type { ClientSnapchefError } from "@/components/api/errors";

export const apiResponsePayload = <S extends z.ZodType>(data: S): z.ZodType<ApiResponsePayload<z.output<S>>> =>
  z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), data }),
    z.object({
      ok: z.literal(false),
      code: ErrorCode,
      message: z.string().optional(),
      fieldErrors: z.record(z.string(), z.string()).optional(),
    }),
  ]);

export interface TransportFailure {
  ok: false;
  transport: ClientSnapchefError;
}

export type ClientResult<T> = ApiResponsePayload<T> | TransportFailure;
