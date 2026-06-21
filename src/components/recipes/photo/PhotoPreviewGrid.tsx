import type { SelectedPhoto } from "@/components/hooks/useObjectUrls";
import { X } from "lucide-react";

interface PhotoPreviewGridProps {
  photos: SelectedPhoto[];
  disabled: boolean;
  onRemove: (index: number) => void;
}

export const PhotoPreviewGrid = ({ photos, disabled, onRemove }: PhotoPreviewGridProps) => (
  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
    {photos.map((photo, index) => (
      <li key={photo.url} className="border-border bg-muted relative aspect-square overflow-hidden rounded-md border">
        <img src={photo.url} alt={photo.file.name} className="h-full w-full object-contain" />
        <button
          type="button"
          onClick={() => {
            onRemove(index);
          }}
          disabled={disabled}
          aria-label={`Usuń ${photo.file.name}`}
          className="bg-background/80 text-foreground absolute top-1 right-1 rounded-full p-1"
        >
          <X className="size-4" />
        </button>
      </li>
    ))}
  </ul>
);
