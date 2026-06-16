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
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useRecipeFinalize } from "@/components/recipes/wizard/useRecipeFinalize";
import type { RecipeView } from "@/lib/core/boundry/recipe";
import { cn } from "@/styles/utils";
import { Loader2, Save, Trash2 } from "lucide-react";
import Markdown from "react-markdown";

interface RecipeDisplayProps {
  recipe: RecipeView;
  // Synchronously disarms the wizard's beforeunload leave-guard before the finalize redirect.
  onBeforeNavigate: () => void;
}

// Renders the generated recipe: the AI-generated name as the heading, and the markdown body
// (`## Składniki` / `## Przygotowanie`) via react-markdown inside a Tailwind `prose` container.
// Beneath it, the final-step actions: save (primary) and delete (destructive, behind a confirm
// dialog). Both disable while a request is in flight; a server error surfaces a Polish message.
export const RecipeDisplay = ({ recipe, onBeforeNavigate }: RecipeDisplayProps) => {
  const { save, confirmDelete, isBusy, error } = useRecipeFinalize(recipe.sessionId, onBeforeNavigate);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{recipe.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={cn("prose prose-sm dark:prose-invert max-w-none")}>
          <Markdown>{recipe.contentMd}</Markdown>
        </div>
      </CardContent>
      <CardFooter className={cn("flex flex-col items-stretch gap-3 sm:flex-row sm:justify-end")}>
        {error ? <p className={cn("text-destructive mr-auto self-center text-sm")}>{error}</p> : null}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={isBusy}>
              <Trash2 />
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
            <AlertDialogFooter>
              <AlertDialogCancel>Anuluj</AlertDialogCancel>
              <AlertDialogAction onClick={confirmDelete}>Usuń</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button onClick={save} disabled={isBusy}>
          {isBusy ? <Loader2 className={cn("animate-spin")} /> : <Save />}
          Zapisz przepis
        </Button>
      </CardFooter>
    </Card>
  );
};
