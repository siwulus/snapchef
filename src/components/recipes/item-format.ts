import type { RecognizedItem } from "@/lib/core/model/recipe";

// Serialize the merged recognized items into the editable textarea's plain-bullet text
// (replacing the former server-side markdown serialization). Edits stay client-side (S-01 scope).
export const itemsToText = (items: RecognizedItem[]): string =>
  items.map((item) => `- ${item.name}, ${item.quantity} / ${item.context}`).join("\n");
