import { RecipeBody } from "@/components/recipes/RecipeBody";
import { WizardReviewSummary } from "@/components/recipes/wizard/WizardReviewSummary";
import type { PhotoView } from "@/lib/core/boundry/recipe";
import type { Recipe, RecipeSession } from "@/lib/core/model/recipe";

interface GeneratedRecipeViewProps {
  recipe: Recipe;
  photos: PhotoView[];
  session: RecipeSession;
}

// The wizard's final step: a cumulative read-only view. First it echoes everything the user entered
// before generating (WizardReviewSummary, fed from the returned session + uploaded photos — backend
// data, the source of truth), then the generated recipe — its AI name as a heading above the
// markdown body, styled like the saved-recipe detail page. The session's provenance fields are
// guaranteed populated post-generation; the `??` only satisfies their nullable model types. The
// Cancel / Save actions are rendered separately by RecipeWizard below.
export const GeneratedRecipeView = ({ recipe, photos, session }: GeneratedRecipeViewProps) => (
  <div className="flex flex-col gap-8">
    <WizardReviewSummary
      photos={photos}
      items={session.correctedItems ?? []}
      mealContext={session.mealContext ?? ""}
      allowExtraIngredients={session.allowExtraIngredients ?? false}
    />

    <article className="flex flex-col gap-6">
      <h1 className="text-foreground text-3xl font-semibold">{recipe.name}</h1>
      <RecipeBody contentMd={recipe.contentMd} />
    </article>
  </div>
);
