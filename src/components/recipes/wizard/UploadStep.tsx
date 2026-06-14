import { SnapchefClientUploadStepError, type SnapchefClientError } from "@/components/errors";
import { useApiClient } from "@/components/hooks/useApiClient";
import { prepareForUpload, validateFiles } from "@/components/recipes/image-processing";
import { Button } from "@/components/ui/button";
import { RecognitionResult } from "@/lib/core/boundry/recipe";
import { RecipeSession } from "@/lib/core/model/recipe";
import type { ApiResponsePayload } from "@/lib/infrastructure/api/types";
import { Effect } from "effect";
import { ImagePlus, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface UploadStepProps {
  onComplete: (result: RecognitionResult) => void;
  onDirtyChange: (dirty: boolean) => void;
}

interface SelectedPhoto {
  file: File;
  url: string;
}

type Phase = "idle" | "uploading" | "recognizing";

const LOADER_MESSAGE: Record<Exclude<Phase, "idle">, string> = {
  uploading: "Wysyłanie zdjęć…",
  recognizing: "Rozpoznawanie produktów… to może potrwać do 30 s",
};

const unwrap = (result: ApiResponsePayload<RecipeSession>): Effect.Effect<RecipeSession, SnapchefClientError> =>
  result.ok
    ? Effect.succeed(result.data)
    : Effect.fail(new SnapchefClientUploadStepError({ message: result.error.message }));

export const UploadStep = ({ onComplete, onDirtyChange }: UploadStepProps) => {
  const [photos, setPhotos] = useState<SelectedPhoto[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [recognitionError, setRecognitionError] = useState<string | null>(null);
  const [createdSession, setCreatedSession] = useState<RecipeSession | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { post, postFormData } = useApiClient();

  // Revoke object URLs on unmount so previews don't leak.
  useEffect(
    () => () => {
      photos.forEach((photo) => {
        URL.revokeObjectURL(photo.url);
      });
    },
    [photos],
  );

  const handleSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    photos.forEach((photo) => {
      URL.revokeObjectURL(photo.url);
    });
    setErrors(validateFiles(files));
    setPhotos(files.map((file) => ({ file, url: URL.createObjectURL(file) })));
    setRecognitionError(null);
    onDirtyChange(true);
  };

  const handleRemove = (index: number) => {
    URL.revokeObjectURL(photos[index].url);
    const next = photos.filter((_, i) => i !== index);
    setPhotos(next);
    setErrors(validateFiles(next.map((photo) => photo.file)));
    onDirtyChange(next.length > 0);
  };

  const prepareFiles = (files: File[]): Effect.Effect<File[], SnapchefClientError> =>
    Effect.tryPromise({
      try: () => Promise.all(files.map(prepareForUpload)),
      catch: () => new SnapchefClientUploadStepError({ message: "Nie udało się przygotować zdjęć." }),
    });

  // Recognition is isolated so the "Spróbuj ponownie" button can re-run only this stage; it never
  // fails (handles success/failure as side effects), so the upload chain can flatMap into it.
  const recognize = (session: RecipeSession): Effect.Effect<void> =>
    Effect.sync(() => {
      setPhase("recognizing");
      setRecognitionError(null);
    }).pipe(
      Effect.flatMap(() => post(`/api/recipe-sessions/${session.id}/recognition`, {}, RecognitionResult)),
      Effect.flatMap((result) =>
        Effect.sync(() => {
          if (result.ok) {
            onComplete(result.data);
          } else {
            setPhase("idle");
            setRecognitionError(result.error.message);
          }
        }),
      ),
      Effect.catchAll(() =>
        Effect.sync(() => {
          setPhase("idle");
          setRecognitionError("Nie udało się rozpoznać produktów. Spróbuj ponownie.");
        }),
      ),
    );

  const submit = () => {
    const files = photos.map((photo) => photo.file);
    const validationErrors = validateFiles(files);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors([]);

    void Effect.sync(() => {
      setPhase("uploading");
    }).pipe(
      Effect.flatMap(() => prepareFiles(files)),
      Effect.flatMap((prepared) =>
        post("/api/recipe-sessions", {}, RecipeSession).pipe(
          Effect.flatMap(unwrap),
          Effect.flatMap((session) => uploadPhotos(session, prepared)),
        ),
      ),
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

  const retryRecognition = () => {
    if (createdSession) void Effect.runPromise(recognize(createdSession));
  };

  const isBusy = phase !== "idle";
  const canSubmit = photos.length > 0 && errors.length === 0 && !isBusy;

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        aria-label="Wybierz zdjęcia produktów"
        onChange={handleSelect}
      />

      <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={isBusy}>
        <ImagePlus className="size-4" />
        Wybierz zdjęcia
      </Button>

      {errors.length > 0 && (
        <ul className="text-destructive space-y-1 text-sm" role="alert">
          {errors.map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      )}

      {photos.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo, index) => (
            <li key={photo.url} className="border-border relative overflow-hidden rounded-md border">
              <img src={photo.url} alt={photo.file.name} className="aspect-square w-full object-cover" />
              <button
                type="button"
                onClick={() => {
                  handleRemove(index);
                }}
                disabled={isBusy}
                aria-label={`Usuń ${photo.file.name}`}
                className="bg-background/80 text-foreground absolute top-1 right-1 rounded-full p-1"
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {recognitionError && (
        <div className="text-destructive flex flex-col gap-2 text-sm" role="alert">
          <p>{recognitionError}</p>
          {createdSession && (
            <Button type="button" variant="outline" onClick={retryRecognition} className="self-start">
              Spróbuj ponownie
            </Button>
          )}
        </div>
      )}

      <Button type="button" onClick={submit} disabled={!canSubmit}>
        Rozpoznaj produkty
      </Button>

      {isBusy && (
        <div
          className="bg-background/70 fixed inset-0 z-50 flex flex-col items-center justify-center gap-3"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="text-foreground size-8 animate-spin" />
          <p className="text-foreground text-sm">{LOADER_MESSAGE[phase]}</p>
        </div>
      )}
    </div>
  );
};
