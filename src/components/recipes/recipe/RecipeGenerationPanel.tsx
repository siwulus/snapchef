import { RecipeContextEditor } from "@/components/recipes/recipe/RecipeContextEditor";
import { RecipeExtraProducts } from "@/components/recipes/recipe/RecipeExtraProducts";
import { RecipeOverlay } from "@/components/recipes/recipe/RecipeOverlay";
import { GENERATION_LOADER_MESSAGE, useRecipeGeneration } from "@/components/recipes/recipe/useRecipeGeneration";
import { Button } from "@/components/ui/button";
import type { RecipeGenerationResult } from "@/lib/core/boundry/recipe";
import type { RecognizedItem } from "@/lib/core/model/recipe";
import { useEffect, useState } from "react";

interface RecipeGenerationPanelProps {
  sessionId: string;
  // Projection of the edited list, owned by the parent (ReviewStep). Read at submit time so the
  // command carries exactly what the user sees.
  toCorrectedItems: () => RecognizedItem[];
  // Session-backed seeds so returning to this step shows what the user last entered. Both are
  // nullable on the wire: `null` falls back to the forward-flow defaults (empty context, toggle ON).
  initialMealContext: string | null;
  initialAllowExtraIngredients: boolean | null;
  // The backend `{ recipe, session }` bundle is reported up; the final step renders its read-only
  // echo from the returned session (source of truth), not from the submitted command.
  onGenerated: (result: RecipeGenerationResult) => void;
  // Reflects the generation in-flight state up to the wizard so it can gate stepper navigation.
  onBusyChange: (busy: boolean) => void;
}

// The generation panel below the product list: a free-text meal-context textarea (with a guiding
// hint making the user conscious of their influence), an off-list-ingredients Switch defaulting to
// ON, and the Generuj przepis button. On submit it reads the lifted list's projection and delegates
// to useRecipeGeneration.
export const RecipeGenerationPanel = ({
  sessionId,
  toCorrectedItems,
  initialMealContext,
  initialAllowExtraIngredients,
  onGenerated,
  onBusyChange,
}: RecipeGenerationPanelProps) => {
  const [mealContext, setMealContext] = useState(initialMealContext ?? "");
  const [allowExtraIngredients, setAllowExtraIngredients] = useState(initialAllowExtraIngredients ?? true);
  const { error, isBusy, generate } = useRecipeGeneration(sessionId, onGenerated);

  // Mirror the in-flight state up so the wizard can gate stepper navigation while generating.
  useEffect(() => {
    onBusyChange(isBusy);
  }, [isBusy, onBusyChange]);

  const items = toCorrectedItems();
  const canGenerate = items.length > 0 && !isBusy;

  const handleGenerate = () => {
    generate({ correctedItems: items, mealContext, allowExtraIngredients });
  };

  return (
    <div className="flex flex-col gap-4">
      <RecipeContextEditor mealContext={mealContext} onChange={setMealContext} isBusy={isBusy} />
      <RecipeExtraProducts
        allowExtraIngredients={allowExtraIngredients}
        onChange={setAllowExtraIngredients}
        isBusy={isBusy}
        modeReadOnly={false}
      />

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <Button type="button" onClick={handleGenerate} disabled={!canGenerate} className="self-start">
        Generuj przepis
      </Button>

      <RecipeOverlay isBusy={isBusy} message={GENERATION_LOADER_MESSAGE} />
    </div>
  );
};
