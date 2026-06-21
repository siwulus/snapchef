interface RecipeContextViewProps {
  mealContext: string;
}

export const RecipeContextView = ({ mealContext }: RecipeContextViewProps) => {
  return mealContext.length > 0 ? (
    <div className="flex flex-col gap-2">
      <h2 className="text-foreground text-lg font-semibold">Kontekst posiłku</h2>
      <p className="text-muted-foreground text-sm whitespace-pre-line">{mealContext}</p>
    </div>
  ) : null;
};
