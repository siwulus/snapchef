import { LOADER_MESSAGE, type Phase } from "@/components/recipes/wizard/useRecipeUpload";
import { Loader2 } from "lucide-react";

interface UploadProgressOverlayProps {
  phase: Exclude<Phase, "idle">;
}

export const UploadProgressOverlay = ({ phase }: UploadProgressOverlayProps) => (
  <div
    className="bg-background/70 fixed inset-0 z-50 flex flex-col items-center justify-center gap-3"
    role="status"
    aria-live="polite"
  >
    <Loader2 className="text-foreground size-8 animate-spin" />
    <p className="text-foreground text-sm">{LOADER_MESSAGE[phase]}</p>
  </div>
);
