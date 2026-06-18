import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/styles/utils";

interface WizardExitLinkProps {
  dirty: boolean;
  // Synchronously disarms the wizard's beforeunload leave-guard before the in-app redirect, so the
  // browser's own leave-prompt does not fire on top of an intentional navigation.
  onBeforeNavigate: () => void;
}

const BACK_LABEL = "← Wróć do przepisów";
// Mirrors the saved-recipe detail page's back link (src/pages/recipes/[id].astro).
const linkClass = "text-muted-foreground hover:text-foreground self-start text-sm transition-colors";

// Top-left back-to-list control for the create-recipe wizard. With no unsaved work it navigates
// straight to /recipes; with unsaved work it opens a confirm dialog warning the in-progress recipe
// will be lost, and on confirm disarms the leave-guard before navigating (no delete — this mirrors
// today's tab-close semantics; the deliberate delete lives in the Cancel action).
export const WizardExitLink = ({ dirty, onBeforeNavigate }: WizardExitLinkProps) => {
  if (!dirty) {
    return (
      <button
        type="button"
        onClick={() => {
          window.location.assign("/recipes");
        }}
        className={cn(linkClass)}
      >
        {BACK_LABEL}
      </button>
    );
  }

  const leave = () => {
    onBeforeNavigate();
    window.location.assign("/recipes");
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button type="button" className={cn(linkClass)}>
          {BACK_LABEL}
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Opuścić bez zapisywania?</AlertDialogTitle>
          <AlertDialogDescription>
            Tworzony przepis nie został zapisany. Jeśli opuścisz tę stronę, wprowadzone dane zostaną utracone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Zostań</AlertDialogCancel>
          <AlertDialogAction onClick={leave}>Opuść</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
