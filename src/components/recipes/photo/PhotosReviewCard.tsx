import { PhotoReviewCard } from "@/components/recipes/photo/PhotoReviewCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PhotoView } from "@/lib/core/boundry/recipe";

interface PhotosReviewCardProps {
  photos: PhotoView[];
}

// One uploaded photo (rendered via its signed URL) next to its read-only recognized list.
// The list is presentation-only — per-photo items are not editable (only the merged list is).
export const PhotosReviewCard = ({ photos }: PhotosReviewCardProps) => (
  <Card>
    <CardHeader>
      <CardTitle>Rozpoznane produkty na zdjęciach</CardTitle>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      {photos.map((photo) => (
        <PhotoReviewCard key={photo.id} photo={photo} />
      ))}
    </CardContent>
  </Card>
);
