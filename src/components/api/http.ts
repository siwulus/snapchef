import { Effect } from "effect";
import { z } from "zod";
import { ApiResponsePayload } from "@/lib/infrastructure/api/types";
import { ApiRequestError, UnexpectedResponseError, type ClientSnapchefError } from "@/components/api/errors";

const fetchJson = <S extends z.ZodType>(params: {
  url: string;
  body?: unknown;
  dataSchema: S;
  method: "POST" | "PUT" | "GET" | "DELETE";
}): Effect.Effect<ApiResponsePayload<z.output<S>>, ClientSnapchefError> =>
  Effect.tryPromise({
    try: () =>
      fetch(params.url, {
        method: params.method,
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: params.body ? JSON.stringify(params.body) : undefined,
      }),
    catch: (cause) => new ApiRequestError({ message: "Network request failed", cause }),
  }).pipe(
    Effect.flatMap((response) =>
      Effect.tryPromise({
        try: () => response.json(),
        catch: (cause) =>
          new UnexpectedResponseError({
            message: `Response body is not JSON (status ${response.status})`,
            cause,
          }),
      }),
    ),
    Effect.flatMap((json) =>
      Effect.try({
        try: () => ApiResponsePayload(params.dataSchema).parse(json),
        catch: (cause) =>
          new UnexpectedResponseError({
            message: "Response did not match the API contract",
            cause,
          }),
      }),
    ),
  );

export const post = <S extends z.ZodType>(
  url: string,
  body: unknown,
  dataSchema: S,
): Effect.Effect<ApiResponsePayload<z.output<S>>, ClientSnapchefError> =>
  fetchJson({ url, body, dataSchema, method: "POST" });

export const putJson = <S extends z.ZodType>(
  url: string,
  body: unknown,
  dataSchema: S,
): Effect.Effect<ApiResponsePayload<z.output<S>>, ClientSnapchefError> =>
  fetchJson({ url, body, dataSchema, method: "PUT" });

export const get = <S extends z.ZodType>(
  url: string,
  dataSchema: S,
): Effect.Effect<ApiResponsePayload<z.output<S>>, ClientSnapchefError> => fetchJson({ url, dataSchema, method: "GET" });

export const delete_ = <S extends z.ZodType>(
  url: string,
  dataSchema: S,
): Effect.Effect<ApiResponsePayload<z.output<S>>, ClientSnapchefError> =>
  fetchJson({ url, dataSchema, method: "DELETE" });
