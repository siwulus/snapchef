import { cn } from "@/styles/utils";
import Markdown from "react-markdown";

interface RecipeViewProps {
  name: string;
  contentMd: string;
}

// Presentational markdown renderer for a recipe body (`## Składniki` / `## Przygotowanie`). Pure —
// no hooks or browser state — so it renders to static HTML when mounted without a `client:*`
// directive (the detail page SSRs it). react-markdown ignores raw HTML by default, so it is
// XSS-safe for LLM-authored content.
export const RecipeView = ({ name, contentMd }: RecipeViewProps) => (
  <article className="flex flex-col gap-6">
    <h1 className="text-foreground text-3xl font-semibold">{name}</h1>
    <div className={cn("prose prose-sm dark:prose-invert max-w-none")}>
      <Markdown>{contentMd}</Markdown>
    </div>
  </article>
);
