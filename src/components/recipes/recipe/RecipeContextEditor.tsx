import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const MEAL_CONTEXT_HINT =
  "Napisz, na co masz ochotę: rodzaj dania, okazja, ograniczenia (np. szybko, wegetariańsko, dla dzieci). " +
  "To Ty wpływasz na przepis — im więcej wskazówek, tym lepiej dopasowany wynik.";

interface RecipeContextEditorProps {
  mealContext: string;
  isBusy: boolean;
  onChange: (mealContext: string) => void;
}

export const RecipeContextEditor = ({ mealContext, onChange, isBusy }: RecipeContextEditorProps) => {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="meal-context">Co chcesz ugotować?</Label>
      <Textarea
        id="meal-context"
        value={mealContext}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        placeholder="np. szybka kolacja na dwie osoby, najlepiej coś ciepłego…"
        rows={4}
        maxLength={2000}
        disabled={isBusy}
      />
      <p className="text-muted-foreground text-sm">{MEAL_CONTEXT_HINT}</p>
    </div>
  );
};
