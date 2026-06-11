import type { RecognizedItem } from "@/lib/core/model/recipe";

export const serializeItemsToMarkdown = (items: RecognizedItem[]): string =>
  items.map((item) => `- ${item.name} — ${item.quantity}`).join("\n");
