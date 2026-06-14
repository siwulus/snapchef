import { useObjectUrls } from "@/components/hooks/useObjectUrls";
import { validateFiles } from "@/components/recipes/image-processing";
import { PhotoPreviewGrid } from "@/components/recipes/wizard/PhotoPreviewGrid";
import { RecognitionErrorAlert } from "@/components/recipes/wizard/RecognitionErrorAlert";
import { UploadProgressOverlay } from "@/components/recipes/wizard/UploadProgressOverlay";
import { useRecipeUpload } from "@/components/recipes/wizard/useRecipeUpload";
import { Button } from "@/components/ui/button";
import type { RecognitionResult } from "@/lib/core/boundry/recipe";
import { ImagePlus } from "lucide-react";
import { useRef, useState } from "react";

interface UploadStepProps {
  onComplete: (result: RecognitionResult) => void;
  onDirtyChange: (dirty: boolean) => void;
}

// Treat two picks as the same file when name, size, and last-modified all match — enough to skip a
// re-pick of an already-selected (or just-removed-then-re-added) photo without blocking distinct files.
const isSameFile = (a: File, b: File): boolean =>
  a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

export const UploadStep = ({ onComplete, onDirtyChange }: UploadStepProps) => {
  const { photos, append, removeAt } = useObjectUrls();
  const { phase, recognitionError, isBusy, canRetry, submit, retry, clearRecognitionError } =
    useRecipeUpload(onComplete);
  const [errors, setErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    // Reset so re-picking the same file (e.g. one just removed) fires `change` again.
    event.target.value = "";
    if (picked.length === 0) return;
    const existing = photos.map((photo) => photo.file);
    const toAdd = picked.filter((file) => !existing.some((current) => isSameFile(current, file)));
    append(toAdd);
    // Validate the merged list so the MAX_PHOTOS / per-file limits apply across picks, not per batch.
    setErrors(validateFiles([...existing, ...toAdd]));
    clearRecognitionError();
    onDirtyChange(true);
  };

  const handleRemove = (index: number) => {
    const next = photos.filter((_, i) => i !== index);
    removeAt(index);
    setErrors(validateFiles(next.map((photo) => photo.file)));
    onDirtyChange(next.length > 0);
  };

  const handleSubmit = () => {
    const files = photos.map((photo) => photo.file);
    const validationErrors = validateFiles(files);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors([]);
    submit(files);
  };

  const canSubmit = photos.length > 0 && errors.length === 0 && !isBusy;

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        aria-label="Wybierz zdjęcia produktów"
        onChange={handleSelect}
      />

      <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={isBusy}>
        <ImagePlus className="size-4" />
        Wybierz zdjęcia
      </Button>

      {errors.length > 0 ? (
        <ul className="text-destructive space-y-1 text-sm" role="alert">
          {errors.map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      ) : null}

      {photos.length > 0 ? <PhotoPreviewGrid photos={photos} disabled={isBusy} onRemove={handleRemove} /> : null}

      {recognitionError ? (
        <RecognitionErrorAlert message={recognitionError} canRetry={canRetry} onRetry={retry} />
      ) : null}

      <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
        Rozpoznaj produkty
      </Button>

      {phase !== "idle" ? <UploadProgressOverlay phase={phase} /> : null}
    </div>
  );
};
