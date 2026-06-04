import { z } from "zod";
import { ErrorCode } from "@/lib/core/model/error";

export const ApiErrorResponsePayload = z.object({
  ok: z.literal(false),
  code: ErrorCode,
  message: z.string().optional(),
  fieldErrors: z.record(z.string(), z.string()).optional(),
});

export type ApiErrorResponsePayload = z.infer<typeof ApiErrorResponsePayload>;

export interface ApiSuccessResponsePayload<T> {
  ok: true;
  data: T;
}

export const ApiSuccessResponsePayload = <S extends z.ZodType>(data: S) => z.object({ ok: z.literal(true), data });

export type ApiResponsePayload<T> = ApiErrorResponsePayload | ApiSuccessResponsePayload<T>;

export const ApiResponsePayload = <S extends z.ZodType>(data: S): z.ZodType<ApiResponsePayload<z.output<S>>> =>
  z.discriminatedUnion("ok", [ApiSuccessResponsePayload(data), ApiErrorResponsePayload]) as z.ZodType<
    ApiResponsePayload<z.output<S>>
  >;
