import { useApiClient } from "@/components/hooks/useApiClient";
import { RedirectTarget } from "@/lib/core/boundry/auth";
import { Effect } from "effect";
import { useState } from "react";
import { match } from "ts-pattern";

const GENERIC_ERROR = "Nie udało się usunąć przepisu. Spróbuj ponownie.";

// Owns the delete call + post-success navigation for the saved-recipe readback surfaces (list card
// and detail page). One pipe-first Effect chain run at the edge. On a successful envelope it follows
// the server-owned redirect (window.location.assign); a server-envelope failure surfaces a Polish
// message and stays on the page. Transport errors are already toasted by useApiClient. Unlike
// useRecipeFinalize there is no wizard leave-guard to disarm — these pages have no dirty state.
export const useDeleteRecipe = (sessionId: string) => {
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { del } = useApiClient();

  const confirmDelete = () =>
    Effect.sync(() => {
      setIsBusy(true);
      setError(null);
    }).pipe(
      Effect.flatMap(() => del(`/api/recipe-sessions/${sessionId}`, RedirectTarget)),
      Effect.flatMap((result) =>
        match(result)
          .with({ ok: true }, ({ data }) =>
            Effect.sync(() => {
              window.location.assign(data.redirect);
            }),
          )
          .with({ ok: false }, ({ error: envelopeError }) =>
            Effect.sync(() => {
              setIsBusy(false);
              setError(envelopeError.message || GENERIC_ERROR);
            }),
          )
          .exhaustive(),
      ),
      Effect.catchAll(() =>
        Effect.sync(() => {
          setIsBusy(false);
          setError(GENERIC_ERROR);
        }),
      ),
      Effect.runPromise,
    );

  return { confirmDelete, isBusy, error };
};
