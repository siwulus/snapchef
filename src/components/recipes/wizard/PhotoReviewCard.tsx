import type { PhotoView } from "@/lib/core/boundry/recipe";

interface PhotoReviewCardProps {
  photo: PhotoView;
}

// One uploaded photo (rendered via its signed URL) next to its read-only recognized list.
// The list is presentation-only — per-photo items are not editable (only the merged list is).
export const PhotoReviewCard = ({ photo }: PhotoReviewCardProps) => (
  <div className="border-border flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:gap-4">
    <img
      src={photo.photoUrl}
      alt="Przesłane zdjęcie produktów"
      className="aspect-square w-full rounded-md object-cover sm:w-40"
    />
    {photo.recognizedItems && photo.recognizedItems.length > 0 ? (
      <ul className="flex-1 list-disc space-y-1 pl-5 text-sm">
        {photo.recognizedItems.map((item, index) => (
          <li key={index}>
            {item.name} — {item.quantity}
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-muted-foreground flex-1 text-sm">Nie rozpoznano produktów na tym zdjęciu.</p>
    )}
  </div>
);
