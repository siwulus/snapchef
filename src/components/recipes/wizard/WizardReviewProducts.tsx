import { PhotosReviewCard } from "@/components/recipes/photo/PhotosReviewCard";
import { ProductListEditor } from "@/components/recipes/ingridients/ProductListEditor";
import { RecipeGenerationPanel } from "@/components/recipes/recipe/RecipeGenerationPanel";
import { useEditableItems } from "@/components/recipes/ingridients/useEditableItems";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PhotoView, RecipeGenerationResult } from "@/lib/core/boundry/recipe";
import type { RecipeSession } from "@/lib/core/model/recipe";

interface WizardReviewProductsProps {
  session: RecipeSession;
  photos: PhotoView[];
  onGenerated: (result: RecipeGenerationResult) => void;
}

// The review screen: per-photo read-only lists (PhotoReviewCard) plus the merged/consolidated list
// as a structured, per-item editable list (ProductListEditor). The editable state is OWNED here
// (lifted from the editor) so the generation panel can read its `toCorrectedItems()` projection.
// Below the list, the generation panel collects the meal context + off-list toggle and triggers
// generation; the generated `{ recipe, session }` bundle is reported up via `onGenerated`.
export const WizardReviewProducts = ({ session, photos, onGenerated }: WizardReviewProductsProps) => {
  const editor = useEditableItems(session.recognizedItems);

  return (
    <div className="flex flex-col gap-4">
      <PhotosReviewCard photos={photos} />

      <Card>
        <CardHeader>
          <CardTitle>Lista zbiorcza</CardTitle>
        </CardHeader>
        <CardContent>
          <ProductListEditor editor={editor} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Wygeneruj przepis</CardTitle>
        </CardHeader>
        <CardContent>
          <RecipeGenerationPanel
            sessionId={session.id}
            toCorrectedItems={editor.toCorrectedItems}
            onGenerated={onGenerated}
          />
        </CardContent>
      </Card>
    </div>
  );
};
