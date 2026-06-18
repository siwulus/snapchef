import type { PhotoView } from "@/lib/core/boundry/recipe";
import type { RecognizedItem } from "@/lib/core/model/recipe";

interface WizardReviewSummaryProps {
  photos: PhotoView[];
  items: RecognizedItem[];
  mealContext: string;
  allowExtraIngredients: boolean;
}

// Read-only echo of everything the user entered before generating: the consolidated item list, the
// meal context, the off-list-ingredients choice, and the uploaded photos. The React counterpart of
// RecipeProvenance.astro (saved-recipe detail page), shown above the generated recipe on the
// wizard's final step. Purely presentational — no inputs, no edit controls. Content sections render
// only when populated; the off-list line always renders (the toggle always carries a value).
export const WizardReviewSummary = ({
  photos,
  items,
  mealContext,
  allowExtraIngredients,
}: WizardReviewSummaryProps) => {
  const trimmedMealContext = mealContext.trim();

  return (
    <section className="flex flex-col gap-8">
      {trimmedMealContext.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-foreground text-lg font-semibold">Kontekst posiłku</h2>
          <p className="text-muted-foreground text-sm whitespace-pre-line">{trimmedMealContext}</p>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-foreground text-lg font-semibold">Lista produktów</h2>
          <ul className="text-muted-foreground flex flex-col gap-1 text-sm">
            {items.map((item, index) => (
              <li key={index}>
                <span className="text-foreground font-medium">{item.name}</span>
                {item.quantity ? <span> — {item.quantity}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <h2 className="text-foreground text-lg font-semibold">Produkty spoza listy</h2>
        <p className="text-muted-foreground text-sm">
          {allowExtraIngredients
            ? "Włączone: mogę dodać produkty spoza listy (np. podstawowe przyprawy)."
            : "Wyłączone: trzymaj się moich produktów."}
        </p>
      </div>

      {photos.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-foreground text-lg font-semibold">Zdjęcia</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((photo) => (
              <img
                key={photo.id}
                src={photo.photoUrl}
                alt="Zdjęcie produktów"
                loading="lazy"
                className="ring-foreground/10 aspect-square w-full rounded-none object-cover ring-1"
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
};
