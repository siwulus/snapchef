import { post, postFormData } from "@/components/api/http";
import type { ApiResponsePayload } from "@/lib/infrastructure/api/types";
import { Effect } from "effect";
import { useMemo } from "react";
import { toast } from "sonner";
import type { z } from "zod";
import type { SnapchefClientError } from "../errors";

export const useApiClient = () =>
  useMemo(
    () => ({
      post: <S extends z.ZodType>(
        url: string,
        body: unknown,
        dataSchema: S,
      ): Effect.Effect<ApiResponsePayload<z.output<S>>, SnapchefClientError> =>
        post(url, body, dataSchema).pipe(Effect.tapError((error) => Effect.sync(() => toast.error(error.message)))),
      postFormData: <S extends z.ZodType>(
        url: string,
        formData: FormData,
        dataSchema: S,
      ): Effect.Effect<ApiResponsePayload<z.output<S>>, SnapchefClientError> =>
        postFormData(url, formData, dataSchema).pipe(
          Effect.tapError((error) => Effect.sync(() => toast.error(error.message))),
        ),
    }),
    [],
  );
