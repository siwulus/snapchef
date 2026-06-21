import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface RecipeExtraProductsProps {
  allowExtraIngredients: boolean;
  isBusy?: boolean;
  modeReadOnly?: boolean;
  onChange?: (allowExtraIngredients: boolean) => void;
}

export const RecipeExtraProducts = ({
  allowExtraIngredients,
  onChange,
  isBusy,
  modeReadOnly,
}: RecipeExtraProductsProps) => {
  return (
    <div className="flex items-start gap-3">
      <Switch
        id="allow-extra-ingredients"
        checked={allowExtraIngredients}
        onCheckedChange={onChange}
        disabled={isBusy ?? modeReadOnly}
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
  );
};
