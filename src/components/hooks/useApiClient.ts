import { useMemo } from "react";
import { Effect } from "effect";
import type { z } from "zod";
import { postJson } from "@/components/api/http";
import type { ClientResult, TransportFailure } from "@/components/api/contract";
import type { ClientSnapchefError } from "@/components/api/errors";

const toTransportFailure = (transport: ClientSnapchefError): TransportFailure => ({ ok: false, transport });

export const useApiClient = () =>
  useMemo(
    () => ({
      post: <S extends z.ZodType>(url: string, body: unknown, dataSchema: S): Promise<ClientResult<z.output<S>>> =>
        postJson(url, body, dataSchema).pipe(
          Effect.map((payload): ClientResult<z.output<S>> => payload),
          Effect.catchAll((error) => Effect.succeed(toTransportFailure(error))),
          Effect.runPromise,
        ),
    }),
    [],
  );
