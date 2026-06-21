import { Loader2 } from "lucide-react";

interface RecipeOverlayProps {
  isBusy: boolean;
  message: string;
}

export const RecipeOverlay = ({ isBusy, message }: RecipeOverlayProps) => {
  return (
    <>
      {isBusy ? (
        <div
          className="bg-background/70 fixed inset-0 z-50 flex flex-col items-center justify-center gap-3"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="text-foreground size-8 animate-spin" />
          <p className="text-foreground text-sm">{message}</p>
        </div>
      ) : null}
    </>
  );
};
