import type { ProductRecognizer } from "@/lib/core/boundry/recipe";
import type { SnapchefServerError } from "@/lib/core/model/error";
import type { RecognizedItem } from "@/lib/core/model/recipe";
import { Effect } from "effect";

// Deterministic, happy-path ProductRecognizer for E2E (selected in src/middleware.ts when
// E2E_FAKE_LLM is on under a dev build). No network, no API key. The canned list is non-empty
// on purpose: an all-empty recognition trips the 500 branch in RecipeSessionUC.resolveItems.
// User-facing strings stay in Polish — these surface in the UI during the flow.
const CANNED_ITEMS: RecognizedItem[] = [
  { name: "Jajka", quantity: "6 sztuk", context: "Atrapa LLM (E2E): rozpoznane na zdjęciu" },
  { name: "Mleko", quantity: "1 litr", context: "Atrapa LLM (E2E): rozpoznane na zdjęciu" },
  { name: "Pomidory", quantity: "3 sztuki", context: "Atrapa LLM (E2E): rozpoznane na zdjęciu" },
];

// Echo + dedupe by name (case-insensitive) so the merge exercises real consolidation semantics
// and a spec can assert that per-photo lists collapsed. Keeps the last occurrence per name.
const dedupeByName = (items: RecognizedItem[]): RecognizedItem[] =>
  Array.from(new Map(items.map((item) => [item.name.toLowerCase(), item])).values());

const recognizePhoto = (_url: string): Effect.Effect<RecognizedItem[], SnapchefServerError> =>
  Effect.succeed(CANNED_ITEMS);

const mergeItems = (lists: RecognizedItem[]): Effect.Effect<RecognizedItem[], SnapchefServerError> =>
  Effect.succeed(dedupeByName(lists));

export const createFakeProductRecognizer = (): ProductRecognizer => ({
  recognizePhoto,
  mergeItems,
});
