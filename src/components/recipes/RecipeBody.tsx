import { cn } from "@/styles/utils";
import Markdown from "react-markdown";

interface RecipeBodyProps {
  contentMd: string;
}

// Presentational markdown renderer for a recipe body (`## Składniki` / `## Przygotowanie`). Pure —
// no hooks or browser state — so it renders to static HTML when mounted without a `client:*`
// directive (the detail page SSRs it). react-markdown ignores raw HTML by default, so it is
// XSS-safe for LLM-authored content.
export const RecipeBody = ({ contentMd }: RecipeBodyProps) => (
  <div className={cn("prose prose-sm dark:prose-invert max-w-none")}>
    <Markdown>{contentMd}</Markdown>
  </div>
);
