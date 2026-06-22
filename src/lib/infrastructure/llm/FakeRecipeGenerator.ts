import type { RecipeGenerator } from "@/lib/core/boundry/recipe";
import type { SnapchefServerError } from "@/lib/core/model/error";
import type { RecognizedItem } from "@/lib/core/model/recipe";
import { Effect } from "effect";

// Deterministic, happy-path RecipeGenerator for E2E (selected in src/middleware.ts when
// E2E_FAKE_LLM is on under a dev build). The output is derived from the inputs (meal context +
// items + off-list toggle) so a spec can assert the user's choices actually flowed through.
// No network, no API key. User-facing strings stay in Polish — they surface in the UI.
interface GenerateInput {
  items: RecognizedItem[];
  mealContext: string;
  allowExtraIngredients: boolean;
}

const buildName = (mealContext: string): string => {
  const base = mealContext.trim().length > 0 ? mealContext.trim() : "Szybkie danie";
  return `Przepis (atrapa E2E): ${base}`.slice(0, 200);
};

const buildContentMd = (input: GenerateInput): string => {
  const itemsList = input.items.map((item) => `- ${item.name} — ${item.quantity}`).join("\n");
  const extra = input.allowExtraIngredients ? "Dozwolone dodatkowe składniki spoza listy." : "Tylko składniki z listy.";
  return [
    "# Przepis (atrapa E2E)",
    "",
    `Kontekst posiłku: ${input.mealContext.trim().length > 0 ? input.mealContext.trim() : "(brak)"}`,
    "",
    "## Składniki",
    itemsList.length > 0 ? itemsList : "- (brak rozpoznanych składników)",
    "",
    "## Przygotowanie",
    "1. To jest deterministyczna atrapa odpowiedzi LLM na potrzeby testów E2E.",
    `2. ${extra}`,
  ].join("\n");
};

const generate = (input: GenerateInput): Effect.Effect<{ name: string; contentMd: string }, SnapchefServerError> =>
  Effect.succeed({ name: buildName(input.mealContext), contentMd: buildContentMd(input) });

export const createFakeRecipeGenerator = (): RecipeGenerator => ({
  generate,
});
