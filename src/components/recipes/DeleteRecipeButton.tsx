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
import { useDeleteRecipe } from "@/components/hooks/useDeleteRecipe";
import { cn } from "@/styles/utils";
import { Loader2, Trash2 } from "lucide-react";

interface DeleteRecipeButtonProps {
  sessionId: string;
}

// Reusable destructive-delete control for the saved-recipes list cards and the detail page:
// a destructive button that opens a confirm dialog; confirm hard-deletes the session (storage
// cleanup + DB cascade, server-side) and follows the server redirect to /recipes. Disabled while
// the request is in flight; a server-envelope failure surfaces a Polish message inside the dialog.
const DeleteRecipeButton = ({ sessionId }: DeleteRecipeButtonProps) => {
  const { confirmDelete, isBusy, error } = useDeleteRecipe(sessionId);

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" disabled={isBusy}>
          {isBusy ? <Loader2 className={cn("animate-spin")} /> : <Trash2 />}
          Usuń
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Usunąć przepis?</AlertDialogTitle>
          <AlertDialogDescription>
            Tej operacji nie można cofnąć. Przepis i powiązane zdjęcia zostaną trwale usunięte.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p className={cn("text-destructive text-sm")}>{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Anuluj</AlertDialogCancel>
          <AlertDialogAction onClick={confirmDelete}>Usuń</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DeleteRecipeButton;
