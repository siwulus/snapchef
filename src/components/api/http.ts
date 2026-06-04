import { Effect } from "effect";
import { z } from "zod";
import type { ApiResponsePayload } from "@/lib/infrastructure/api/types";
import { ApiRequestError, UnexpectedResponseError, type ClientSnapchefError } from "@/components/api/errors";
import { apiResponsePayload } from "@/components/api/contract";

const fetchJson = (url: string, body: unknown): Effect.Effect<unknown, ClientSnapchefError> =>
  Effect.tryPromise({
    try: () =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
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
  );

export const postJson = <S extends z.ZodType>(
  url: string,
  body: unknown,
  dataSchema: S,
): Effect.Effect<ApiResponsePayload<z.output<S>>, ClientSnapchefError> =>
  fetchJson(url, body).pipe(
    Effect.flatMap((json) => {
      const result = apiResponsePayload(dataSchema).safeParse(json);
      return result.success
        ? Effect.succeed(result.data)
        : Effect.fail(
            new UnexpectedResponseError({ message: "Response did not match the API contract", cause: result.error }),
          );
    }),
  );
