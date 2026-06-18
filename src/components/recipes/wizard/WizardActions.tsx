import { useRecipeFinalize } from "@/components/recipes/wizard/useRecipeFinalize";
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
import { Button } from "@/components/ui/button";
import { cn } from "@/styles/utils";
import { Loader2, Save, X } from "lucide-react";

interface WizardActionsProps {
  sessionId: string;
  // Synchronously disarms the wizard's beforeunload leave-guard before the finalize redirect.
  onBeforeNavigate: () => void;
  // Save appears only once a recipe has been generated (the recipe step); Cancel is always present.
  showSave: boolean;
}

// The wizard's bottom action row, rendered from the review step onward (once a session exists). One
// useRecipeFinalize instance backs both actions, so Cancel (delete) and Save share busy/error state
// and both disarm the leave-guard before redirecting. Cancel deletes the whole session (storage +
// DB cascade) behind a confirm dialog and returns to the list; Save persists the recipe. A server
// failure keeps the user on the page with a Polish error (existing hook behavior).
export const WizardActions = ({ sessionId, onBeforeNavigate, showSave }: WizardActionsProps) => {
  const { save, confirmDelete, isBusy, error } = useRecipeFinalize(sessionId, onBeforeNavigate);

  return (
    <div className={cn("flex flex-col items-stretch gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-end")}>
      {error ? <p className={cn("text-destructive mr-auto self-center text-sm")}>{error}</p> : null}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" disabled={isBusy}>
            <X />
            Anuluj
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Anulować tworzenie przepisu?</AlertDialogTitle>
            <AlertDialogDescription>
              Przesłane zdjęcia i rozpoznane produkty zostaną trwale usunięte.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Wróć</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Usuń</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {showSave ? (
        <Button onClick={save} disabled={isBusy}>
          {isBusy ? <Loader2 className={cn("animate-spin")} /> : <Save />}
          Zapisz przepis
        </Button>
      ) : null}
    </div>
  );
};
