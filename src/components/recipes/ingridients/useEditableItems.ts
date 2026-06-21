import { RecognizedItem } from "@/lib/core/model/recipe";
import { useState } from "react";

// One editable row. `id` is an ephemeral client id used solely as the React key and to target
// updates/removes/autofocus — it is NOT part of RecognizedItem and is dropped by the projection.
// `name`/`quantity` are free strings (may be transiently empty while typing); `context` travels
// read-only and informative.
export interface EditableItem {
  id: string;
  name: string;
  quantity: string;
  context: string;
}

export interface FieldHints {
  name?: string;
  quantity?: string;
}

export interface UseEditableItems {
  items: EditableItem[];
  lastAddedId: string | null;
  addItem: () => void;
  removeItem: (id: string) => void;
  updateField: (id: string, field: "name" | "quantity", value: string) => void;
  toCorrectedItems: () => RecognizedItem[];
}

// The RecognizedItem bounds, mirrored here for the inline hints (name 1–120, quantity 1–60).
const NAME_MAX = 120;
const QUANTITY_MAX = 60;

// Pure per-field validity check backing the inline hints. Kept standalone (and exported) so it can
// be unit-tested directly; it never mutates and returns Polish hint strings for empty / over-length.
export const itemFieldHints = (item: { name: string; quantity: string }): FieldHints => {
  const hints: FieldHints = {};
  // Over-length is measured on the trimmed value to match toCorrectedItems(), which trims before
  // validating — so the hint flags exactly what the projection would reject (no boundary-whitespace
  // disagreement between the inline hint and the server-ready projection).
  if (item.name.trim().length === 0) hints.name = "Nazwa nie może być pusta.";
  else if (item.name.trim().length > NAME_MAX) hints.name = `Nazwa jest za długa (maks. ${NAME_MAX} znaków).`;
  if (item.quantity.trim().length === 0) hints.quantity = "Podaj ilość.";
  else if (item.quantity.trim().length > QUANTITY_MAX)
    hints.quantity = `Ilość jest za długa (maks. ${QUANTITY_MAX} znaków).`;
  return hints;
};

const seedRows = (seed: RecognizedItem[] | null): EditableItem[] =>
  (seed ?? []).map((item) => ({ id: crypto.randomUUID(), ...item }));

// Owns the editable list seeded once from the recognized items, exposes add/delete/update keyed by
// the ephemeral row id, and projects to a clean RecognizedItem[] (the future `correctedItems` shape).
// The original recognized list is never mutated — this state is a separate, editable copy.
export const useEditableItems = (seed: RecognizedItem[] | null): UseEditableItems => {
  const [items, setItems] = useState<EditableItem[]>(() => seedRows(seed));
  // The id of the row added by the latest `addItem`, so the editor can autofocus its name input
  // after the append renders (not synchronously in the click handler).
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);

  const addItem = () => {
    const id = crypto.randomUUID();
    setItems((current) => [...current, { id, name: "", quantity: "", context: "" }]);
    setLastAddedId(id);
  };

  const removeItem = (id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  };

  const updateField = (id: string, field: "name" | "quantity", value: string) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  };

  // Server-ready projection: trim at the boundary and re-validate each row against RecognizedItem,
  // dropping rows that don't satisfy the model (e.g. a blank just-added row). The ephemeral `id` is
  // stripped. Not wired to any upload in this change — it only produces the shape.
  const toCorrectedItems = (): RecognizedItem[] =>
    items.flatMap((item) => {
      const result = RecognizedItem.safeParse({
        name: item.name.trim(),
        quantity: item.quantity.trim(),
        context: item.context,
      });
      return result.success ? [result.data] : [];
    });

  return { items, lastAddedId, addItem, removeItem, updateField, toCorrectedItems };
};
