import { Button } from "@/components/ui/button";

interface PhotoRecognitionErrorAlertProps {
  message: string;
  canRetry: boolean;
  onRetry: () => void;
}

export const PhotoRecognitionErrorAlert = ({ message, canRetry, onRetry }: PhotoRecognitionErrorAlertProps) => (
  <div className="text-destructive flex flex-col gap-2 text-sm" role="alert">
    <p>{message}</p>
    {canRetry ? (
      <Button type="button" variant="outline" onClick={onRetry} className="self-start">
        Spróbuj ponownie
      </Button>
    ) : null}
  </div>
);
