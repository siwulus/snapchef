import { ProductListView } from "@/components/recipes/ingridients/ProductListView";
import { PhotosReviewCard } from "@/components/recipes/photo/PhotosReviewCard";
import { RecipeView } from "@/components/recipes/recipe/RecipeView";
import { RecipeContextView } from "@/components/recipes/recipe/RecipeContextView";
import { RecipeExtraProducts } from "@/components/recipes/recipe/RecipeExtraProducts";
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
    <PhotosReviewCard photos={photos} />
    <ProductListView items={session.correctedItems ?? []} />
    <RecipeContextView mealContext={session.mealContext ?? ""} />
    <RecipeExtraProducts allowExtraIngredients={session.allowExtraIngredients ?? false} modeReadOnly={true} />

    <RecipeView name={recipe.name} contentMd={recipe.contentMd} />
  </div>
);
