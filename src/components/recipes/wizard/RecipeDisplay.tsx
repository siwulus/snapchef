import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Recipe } from "@/lib/core/model/recipe";
import { cn } from "@/styles/utils";
import Markdown from "react-markdown";

interface RecipeDisplayProps {
  recipe: Recipe;
}

// Renders the generated recipe: the AI-generated name as the heading, and the markdown body
// (`## Składniki` / `## Przygotowanie`) via react-markdown inside a Tailwind `prose` container.
// The final-step actions (Cancel / Save) live in WizardActions, rendered by RecipeWizard below.
export const RecipeDisplay = ({ recipe }: RecipeDisplayProps) => (
  <Card>
    <CardHeader>
      <CardTitle>{recipe.name}</CardTitle>
    </CardHeader>
    <CardContent>
      <div className={cn("prose prose-sm dark:prose-invert max-w-none")}>
        <Markdown>{recipe.contentMd}</Markdown>
      </div>
    </CardContent>
  </Card>
);
