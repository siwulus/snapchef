import { useApiClient } from "@/components/hooks/useApiClient";
import type { RecipeGenerationCommand } from "@/lib/core/boundry/recipe";
import { Recipe } from "@/lib/core/model/recipe";
import { Effect } from "effect";
import { useState } from "react";
import { match } from "ts-pattern";

export type GenerationPhase = "idle" | "generating";

// Mirrors useRecipeUpload's LOADER_MESSAGE. Under-promises on the retry path (worst case ~60 s),
// acceptable for the MVP per the plan's performance note.
export const GENERATION_LOADER_MESSAGE = "Generowanie przepisu… to może potrwać do 30 s";

const GENERIC_ERROR = "Nie udało się wygenerować przepisu. Spróbuj ponownie.";

// Owns the generate workflow and its UI state, mirroring useRecipeUpload: one pipe-first Effect
// chain, one runPromise edge, branch on the envelope's `ok`. Transport errors are already toasted
// by useApiClient; a server-envelope failure surfaces as a generic Polish retry message. The last
// command is held so retry() can re-run the same generation.
export const useRecipeGeneration = (
  sessionId: string,
  onGenerated: (recipe: Recipe, command: RecipeGenerationCommand) => void,
) => {
  const [phase, setPhase] = useState<GenerationPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastCommand, setLastCommand] = useState<RecipeGenerationCommand | null>(null);

  const { post } = useApiClient();

  const run = (command: RecipeGenerationCommand): Effect.Effect<void> =>
    Effect.sync(() => {
      setPhase("generating");
      setError(null);
      setLastCommand(command);
    }).pipe(
      Effect.flatMap(() => post(`/api/recipe-sessions/${sessionId}/recipe-generation`, command, Recipe)),
      Effect.flatMap((result) =>
        match(result)
          .with({ ok: true }, ({ data }) =>
            Effect.sync(() => {
              setPhase("idle");
              onGenerated(data, command);
            }),
          )
          .with({ ok: false }, () =>
            Effect.sync(() => {
              setPhase("idle");
              setError(GENERIC_ERROR);
            }),
          )
          .exhaustive(),
      ),
      Effect.catchAll(() =>
        Effect.sync(() => {
          setPhase("idle");
          setError(GENERIC_ERROR);
        }),
      ),
    );

  const generate = (command: RecipeGenerationCommand) => {
    void Effect.runPromise(run(command));
  };

  const retry = () => {
    if (lastCommand) void Effect.runPromise(run(lastCommand));
  };

  const clearError = () => {
    setError(null);
  };

  return { phase, error, isBusy: phase !== "idle", generate, retry, clearError };
};
