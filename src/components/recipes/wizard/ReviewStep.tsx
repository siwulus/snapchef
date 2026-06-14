import { itemsToText } from "@/components/recipes/item-format";
import { PhotoReviewCard } from "@/components/recipes/wizard/PhotoReviewCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { RecognitionResult } from "@/lib/core/boundry/recipe";
import { useState } from "react";

interface ReviewStepProps {
  result: RecognitionResult;
}

// The review screen: per-photo read-only lists (PhotoReviewCard) plus the merged/consolidated
// list in an editable textarea. The textarea is seeded once from the merged items; edits stay
// client-side (S-01 scope — no persistence). The result is stable for this component's lifetime.
export const ReviewStep = ({ result }: ReviewStepProps) => {
  const [mergedItemsText, setMergedItemsText] = useState(() => itemsToText(result.session.recognizedItems ?? []));

  return (
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
        <CardContent className="flex flex-col gap-2">
          <Label htmlFor="recognized-items">Sprawdź i popraw listę produktów</Label>
          <Textarea
            id="recognized-items"
            value={mergedItemsText}
            onChange={(event) => {
              setMergedItemsText(event.target.value);
            }}
            rows={Math.max(6, mergedItemsText.split("\n").length + 1)}
            placeholder="Nie rozpoznano żadnych produktów."
          />
        </CardContent>
      </Card>
    </div>
  );
};
