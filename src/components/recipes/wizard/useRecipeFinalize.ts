import { useApiClient } from "@/components/hooks/useApiClient";
import type { SnapchefClientError } from "@/components/errors";
import { RedirectTarget } from "@/lib/core/boundry/auth";
import type { ApiResponsePayload } from "@/lib/infrastructure/api/types";
import { Effect } from "effect";
import { useState } from "react";
import { match } from "ts-pattern";

export type FinalizePhase = "idle" | "saving" | "deleting";

const GENERIC_ERROR = "Nie udało się zakończyć. Spróbuj ponownie.";

// Owns the save/delete calls and the post-success navigation, keeping RecipeDisplay declarative.
// One pipe-first Effect chain per action, run at the edge — mirroring useRecipeGeneration's shape.
// On a successful envelope: disarm the wizard leave-guard (onBeforeNavigate) BEFORE assigning
// window.location, so the browser does not raise its leave-prompt during the intentional redirect.
// Transport errors are already toasted by useApiClient; a server-envelope failure surfaces a Polish
// message and leaves the user on the recipe.
export const useRecipeFinalize = (sessionId: string, onBeforeNavigate: () => void) => {
  const [phase, setPhase] = useState<FinalizePhase>("idle");
  const [error, setError] = useState<string | null>(null);

  const { post, del } = useApiClient();

  const run = (
    phaseLabel: Exclude<FinalizePhase, "idle">,
    request: Effect.Effect<ApiResponsePayload<RedirectTarget>, SnapchefClientError>,
  ): Effect.Effect<void> =>
    Effect.sync(() => {
      setPhase(phaseLabel);
      setError(null);
    }).pipe(
      Effect.flatMap(() => request),
      Effect.flatMap((result) =>
        match(result)
          .with({ ok: true }, ({ data }) =>
            Effect.sync(() => {
              onBeforeNavigate();
              window.location.assign(data.redirect);
            }),
          )
          .with({ ok: false }, ({ error: envelopeError }) =>
            Effect.sync(() => {
              setPhase("idle");
              setError(envelopeError.message || GENERIC_ERROR);
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

  const save = () => {
    void Effect.runPromise(run("saving", post(`/api/recipe-sessions/${sessionId}/save`, {}, RedirectTarget)));
  };

  const confirmDelete = () => {
    void Effect.runPromise(run("deleting", del(`/api/recipe-sessions/${sessionId}`, RedirectTarget)));
  };

  return { save, confirmDelete, phase, isBusy: phase !== "idle", error };
};
