import { RecipeBody } from "@/components/recipes/RecipeBody";
import { WizardReviewSummary } from "@/components/recipes/wizard/WizardReviewSummary";
import type { PhotoView, RecipeGenerationCommand } from "@/lib/core/boundry/recipe";
import type { Recipe } from "@/lib/core/model/recipe";

interface GeneratedRecipeViewProps {
  recipe: Recipe;
  photos: PhotoView[];
  command: RecipeGenerationCommand;
}

// The wizard's final step: a cumulative read-only view. First it echoes everything the user entered
// before generating (WizardReviewSummary, fed from the submitted command + uploaded photos), then
// the generated recipe — its AI name as a heading above the markdown body, styled like the saved-
// recipe detail page. The Cancel / Save actions are rendered separately by RecipeWizard below.
export const GeneratedRecipeView = ({ recipe, photos, command }: GeneratedRecipeViewProps) => (
  <div className="flex flex-col gap-8">
    <WizardReviewSummary
      photos={photos}
      items={command.correctedItems}
      mealContext={command.mealContext}
      allowExtraIngredients={command.allowExtraIngredients}
    />

    <article className="flex flex-col gap-6">
      <h1 className="text-foreground text-3xl font-semibold">{recipe.name}</h1>
      <RecipeBody contentMd={recipe.contentMd} />
    </article>
  </div>
);
