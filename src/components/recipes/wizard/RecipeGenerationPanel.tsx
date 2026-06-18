import { GENERATION_LOADER_MESSAGE, useRecipeGeneration } from "@/components/recipes/wizard/useRecipeGeneration";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { RecipeGenerationResult } from "@/lib/core/boundry/recipe";
import type { RecognizedItem } from "@/lib/core/model/recipe";
import { Loader2 } from "lucide-react";
import { useState } from "react";

interface RecipeGenerationPanelProps {
  sessionId: string;
  // Projection of the edited list, owned by the parent (ReviewStep). Read at submit time so the
  // command carries exactly what the user sees.
  toCorrectedItems: () => RecognizedItem[];
  // The backend `{ recipe, session }` bundle is reported up; the final step renders its read-only
  // echo from the returned session (source of truth), not from the submitted command.
  onGenerated: (result: RecipeGenerationResult) => void;
}

const MEAL_CONTEXT_HINT =
  "Napisz, na co masz ochotę: rodzaj dania, okazja, ograniczenia (np. szybko, wegetariańsko, dla dzieci). " +
  "To Ty wpływasz na przepis — im więcej wskazówek, tym lepiej dopasowany wynik.";

// The generation panel below the product list: a free-text meal-context textarea (with a guiding
// hint making the user conscious of their influence), an off-list-ingredients Switch defaulting to
// ON, and the Generuj przepis button. On submit it reads the lifted list's projection and delegates
// to useRecipeGeneration.
export const RecipeGenerationPanel = ({ sessionId, toCorrectedItems, onGenerated }: RecipeGenerationPanelProps) => {
  const [mealContext, setMealContext] = useState("");
  const [allowExtraIngredients, setAllowExtraIngredients] = useState(true);
  const { error, isBusy, generate } = useRecipeGeneration(sessionId, onGenerated);

  const items = toCorrectedItems();
  const canGenerate = items.length > 0 && !isBusy;

  const handleGenerate = () => {
    generate({ correctedItems: items, mealContext, allowExtraIngredients });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="meal-context">Co chcesz ugotować?</Label>
        <Textarea
          id="meal-context"
          value={mealContext}
          onChange={(event) => {
            setMealContext(event.target.value);
          }}
          placeholder="np. szybka kolacja na dwie osoby, najlepiej coś ciepłego…"
          rows={4}
          maxLength={2000}
          disabled={isBusy}
        />
        <p className="text-muted-foreground text-sm">{MEAL_CONTEXT_HINT}</p>
      </div>

      <div className="flex items-start gap-3">
        <Switch
          id="allow-extra-ingredients"
          checked={allowExtraIngredients}
          onCheckedChange={setAllowExtraIngredients}
          disabled={isBusy}
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="allow-extra-ingredients">Mogę użyć produktów spoza listy</Label>
          <p className="text-muted-foreground text-sm">
            {allowExtraIngredients
              ? "Włączone: mogę dodać produkty spoza listy (np. podstawowe przyprawy)."
              : "Wyłączone: trzymaj się moich produktów."}
          </p>
        </div>
      </div>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <Button type="button" onClick={handleGenerate} disabled={!canGenerate} className="self-start">
        Generuj przepis
      </Button>

      {isBusy ? (
        <div
          className="bg-background/70 fixed inset-0 z-50 flex flex-col items-center justify-center gap-3"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="text-foreground size-8 animate-spin" />
          <p className="text-foreground text-sm">{GENERATION_LOADER_MESSAGE}</p>
        </div>
      ) : null}
    </div>
  );
};
