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

export const UploadStep = ({ onComplete, onDirtyChange }: UploadStepProps) => {
  const { photos, replace, removeAt } = useObjectUrls();
  const { phase, recognitionError, isBusy, canRetry, submit, retry, clearRecognitionError } =
    useRecipeUpload(onComplete);
  const [errors, setErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    replace(files);
    setErrors(validateFiles(files));
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
