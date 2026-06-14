import { PhotoReviewCard } from "@/components/recipes/wizard/PhotoReviewCard";
import { ProductListEditor } from "@/components/recipes/wizard/ProductListEditor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RecognitionResult } from "@/lib/core/boundry/recipe";

interface ReviewStepProps {
  result: RecognitionResult;
}

// The review screen: per-photo read-only lists (PhotoReviewCard) plus the merged/consolidated list
// as a structured, per-item editable list (ProductListEditor). The editor is seeded from the merged
// recognized items; edits stay client-side (S-01 scope — no persistence). The result is stable for
// this component's lifetime.
export const ReviewStep = ({ result }: ReviewStepProps) => (
  <div className="flex flex-col gap-4">
    <Card>
      <CardHeader>
        <CardTitle>Rozpoznane produkty na zdjęciach</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {result.photos.map((photo) => (
          <PhotoReviewCard key={photo.id} photo={photo} />
        ))}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Lista zbiorcza</CardTitle>
      </CardHeader>
      <CardContent>
        <ProductListEditor recognizedItems={result.session.recognizedItems} />
      </CardContent>
    </Card>
  </div>
);
