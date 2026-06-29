import { SnapchefClientUploadStepError, type SnapchefClientError } from "@/components/errors";
import { useApiClient } from "@/components/hooks/useApiClient";
import { prepareForUpload } from "@/components/recipes/photo/photo-processing";
import { RecognitionResult } from "@/lib/core/boundry/recipe";
import { RecipeSession } from "@/lib/core/model/recipe";
import type { ApiResponsePayload } from "@/lib/infrastructure/api/types";
import { Effect } from "effect";
import { useState } from "react";
import { match } from "ts-pattern";

export type Phase = "idle" | "uploading" | "recognizing";

export const LOADER_MESSAGE: Record<Exclude<Phase, "idle">, string> = {
  uploading: "Wysyłanie zdjęć…",
  recognizing: "Rozpoznawanie produktów… to może potrwać do 30 s",
};

const unwrap = (result: ApiResponsePayload<RecipeSession>): Effect.Effect<RecipeSession, SnapchefClientError> =>
  match(result)
    .with({ ok: true }, ({ data }) => Effect.succeed(data))
    .with({ ok: false }, ({ error }) => Effect.fail(new SnapchefClientUploadStepError({ message: error.message })))
    .exhaustive();

// Owns the upload→recognize workflow and its UI state. The single consumer (UploadStep) feeds it the
// selected files; success is reported through `onComplete`. Kept as one pipe-first Effect chain with a
// single runPromise edge per effect.md. When `existingSession` is non-null (a back-navigation re-upload),
// it reuses that session id instead of minting a new one — the upload route full-replaces photos on an
// existing session, so re-uploading never orphans a second session's storage + rows.
export const usePhotoUpload = (
  onComplete: (result: RecognitionResult) => void,
  existingSession: RecipeSession | null,
) => {
  const [phase, setPhase] = useState<Phase>("idle");
  const [recognitionError, setRecognitionError] = useState<string | null>(null);
  const [createdSession, setCreatedSession] = useState<RecipeSession | null>(null);

  const { post, postFormData } = useApiClient();

  const prepareFiles = (files: File[]): Effect.Effect<File[], SnapchefClientError> =>
    Effect.tryPromise({
      try: () => Promise.all(files.map(prepareForUpload)),
      catch: () => new SnapchefClientUploadStepError({ message: "Nie udało się przygotować zdjęć." }),
    });

  const uploadPhotos = (
    session: RecipeSession,
    prepared: File[],
  ): Effect.Effect<RecipeSession, SnapchefClientError> => {
    const formData = new FormData();
    prepared.forEach((file) => {
      formData.append("photos", file);
    });
    return postFormData(`/api/recipe-sessions/${session.id}/upload`, formData, RecipeSession).pipe(
      Effect.flatMap(unwrap),
    );
  };

  // Recognition is isolated so retry() can re-run only this stage; it never fails (handles
  // success/failure as side effects), so the upload chain can flatMap into it.
  const recognize = (session: RecipeSession): Effect.Effect<void> =>
    Effect.sync(() => {
      setPhase("recognizing");
      setRecognitionError(null);
    }).pipe(
      Effect.flatMap(() => post(`/api/recipe-sessions/${session.id}/recognition`, {}, RecognitionResult)),
      Effect.flatMap((result) =>
        match(result)
          .with({ ok: true }, ({ data }) =>
            Effect.sync(() => {
              onComplete(data);
            }),
          )
          .with({ ok: false }, ({ error }) =>
            Effect.sync(() => {
              setPhase("idle");
              setRecognitionError(error.message);
            }),
          )
          .exhaustive(),
      ),
      Effect.catchAll(() =>
        Effect.sync(() => {
          setPhase("idle");
          setRecognitionError("Nie udało się rozpoznać produktów. Spróbuj ponownie.");
        }),
      ),
    );

  // Reuse the wizard's session on a re-upload; otherwise mint a new one. The upload + recognition
  // routes both operate on an existing session, so the only branch is "create or not".
  const ensureSession = (): Effect.Effect<RecipeSession, SnapchefClientError> =>
    existingSession
      ? Effect.succeed(existingSession)
      : post("/api/recipe-sessions", {}, RecipeSession).pipe(Effect.flatMap(unwrap));

  const submit = (files: File[]) => {
    void Effect.sync(() => {
      setPhase("uploading");
    }).pipe(
      Effect.flatMap(() => prepareFiles(files)),
      Effect.flatMap((prepared) => ensureSession().pipe(Effect.flatMap((session) => uploadPhotos(session, prepared)))),
      Effect.tap((session) =>
        Effect.sync(() => {
          setCreatedSession(session);
        }),
      ),
      Effect.flatMap((session) => recognize(session)),
      Effect.catchAll((error) =>
        Effect.sync(() => {
          setPhase("idle");
          // Surface the server-envelope message; transport errors are already toasted.
          if (error._tag === "SnapchefClientUploadStepError") setRecognitionError(error.message);
        }),
      ),
      Effect.runPromise,
    );
  };

  const retry = () => {
    if (createdSession) void Effect.runPromise(recognize(createdSession));
  };

  const clearRecognitionError = () => {
    setRecognitionError(null);
  };

  return {
    phase,
    recognitionError,
    isBusy: phase !== "idle",
    canRetry: createdSession !== null,
    submit,
    retry,
    clearRecognitionError,
  };
};
