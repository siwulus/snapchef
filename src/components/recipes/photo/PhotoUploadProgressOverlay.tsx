import { LOADER_MESSAGE, type Phase } from "@/components/recipes/photo/usePhotoUpload";
import { Loader2 } from "lucide-react";

interface PhotoUploadProgressOverlayProps {
  phase: Exclude<Phase, "idle">;
}

export const PhotoUploadProgressOverlay = ({ phase }: PhotoUploadProgressOverlayProps) => (
  <div
    className="bg-background/70 fixed inset-0 z-50 flex flex-col items-center justify-center gap-3"
    role="status"
    aria-live="polite"
  >
    <Loader2 className="text-foreground size-8 animate-spin" />
    <p className="text-foreground text-sm">{LOADER_MESSAGE[phase]}</p>
  </div>
);
