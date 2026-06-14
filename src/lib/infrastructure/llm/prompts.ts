import type { RecognizedItem } from "@/lib/core/model/recipe";
import type { ChatMessages } from "@openrouter/sdk/models";

// FR-004: commit to one product per entry, the single most likely identification —
// never "lemon or lime". Quantity is free-text (Decision #6). Output values are Polish (Decision #7).
// The `context` field is the recognition judgment — the cues + identification reasoning for why this
// product was spotted on this photo. It is PERSISTED with the per-photo list and also fuels the merge.
const RECOGNITION_SYSTEM_PROMPT = [
  "You are a culinary assistant that recognizes food products and kitchen items in a photo (e.g. the inside of a fridge, a countertop, a pantry).",
  "Rules:",
  "- Recognize only food products and kitchen ingredients. Skip dishes, empty packaging, furniture, and other inedible objects.",
  "- Each entry is exactly one product. Do not combine several products into one entry.",
  '- Always choose a single, most likely product name. Never provide alternatives (e.g. do not write "lemon or lime") or question marks.',
  "- IMPORTANT: All output values must be written in Polish. Give product names in Polish, in the nominative singular.",
  '- The quantity field is a short, free-text estimate of the amount, written in Polish (e.g. "1 sztuka", "ok. 500 g", "1 karton", "pęczek"). If the amount cannot be estimated, use "1 sztuka".',
  "- The context field is your recognition judgment: a short Polish note on WHY/HOW you identified this product. Put the most distinguishing cues and your identification reasoning there: packaging type and color, brand or label text, size, position in the photo, and neighboring products.",
  "  This judgment is shown next to the product and is also used in the next step to merge products recognized across different photos — pick the details that best help decide whether two entries are the same physical product or two different ones. If you have no certain cues, briefly describe what you see.",
  "- If there are no recognizable food products in the photo, return an empty list.",
].join("\n");

const RECOGNITION_USER_PROMPT =
  "Recognize all food products visible in this photo and return them as a list of items. Remember: all returned values (product names and quantities) must be in Polish.";

// Text-only merge over the concatenated per-photo lists: semantic dedupe across photos and
// phrasings, sensible quantity summing, re-enforce one entry per product (FR-004). The per-item
// `context` (each photo's recognition judgment) is the key extra signal for the dedupe decision;
// on the merged output the `context` becomes the consolidation judgment (why the item is in the final set).
const MERGE_SYSTEM_PROMPT = [
  "You are a culinary assistant that merges lists of products recognized across several photos into one coherent list.",
  "Each input item has a context field describing how and where the product was identified (packaging, brand, size, position, neighbors).",
  "Rules:",
  "- Use the context field as the primary signal for deduplication: two entries are the same physical product only when their context is consistent (same packaging/brand/size or clearly the same item seen across photos). When the names match but the contexts describe clearly different items, keep them separate.",
  '- Merge duplicates semantically: the same product described with different words (e.g. "mleko 1 karton" and "karton mleka") is one entry.',
  '- Sum quantities sensibly when the same product appears multiple times (e.g. two "1 sztuka" entries → "2 sztuki").',
  "- Each entry is exactly one product; IMPORTANT: product names must be in Polish, in the nominative singular.",
  "- Keep the free-text, short quantity description in Polish in the quantity field.",
  "- For each merged entry, set the context field to your consolidation judgment: a short Polish note on why this item belongs in the final set — which per-photo sources were merged into it and the dedupe rationale.",
  "- Do not add products that were not in the input list. If the input list is empty, return an empty list.",
].join("\n");

const MERGE_USER_PROMPT =
  "Merge the following product list (JSON format) into a single list without duplicates. Remember: all returned values (product names and quantities) must be in Polish:";

export const buildRecognitionMessages = (imageUrl: string): ChatMessages[] => [
  { role: "system", content: RECOGNITION_SYSTEM_PROMPT },
  {
    role: "user",
    content: [
      { type: "text", text: RECOGNITION_USER_PROMPT },
      { type: "image_url", imageUrl: { url: imageUrl } },
    ],
  },
];

export const buildMergeMessages = (items: RecognizedItem[]): ChatMessages[] => [
  { role: "system", content: MERGE_SYSTEM_PROMPT },
  { role: "user", content: `${MERGE_USER_PROMPT}\n\n${JSON.stringify({ items })}` },
];
