import { ProductRow } from "@/components/recipes/wizard/ProductRow";
import { itemFieldHints, type UseEditableItems } from "@/components/recipes/wizard/useEditableItems";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface ProductListEditorProps {
  editor: UseEditableItems;
}

// The consolidated ("Lista zbiorcza") editor: one editable ProductRow per item (keyed by the
// ephemeral row id), an "add product" action that appends a blank row and focuses its name input,
// and an empty state (muted hint + add button, zero rows) when nothing was recognized. The editable
// state is owned by the parent (ReviewStep) and passed in, so the generate action can read the
// list's `toCorrectedItems()` projection.
export const ProductListEditor = ({ editor }: ProductListEditorProps) => {
  const { items, lastAddedId, addItem, removeItem, updateField } = editor;

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nie rozpoznano żadnych produktów.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id}>
              <ProductRow
                item={item}
                autoFocus={item.id === lastAddedId}
                hints={itemFieldHints(item)}
                onChange={(field, value) => {
                  updateField(item.id, field, value);
                }}
                onRemove={() => {
                  removeItem(item.id);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <Button type="button" variant="outline" size="sm" className="self-start" onClick={addItem}>
        <Plus className="size-4" />
        Dodaj produkt
      </Button>
    </div>
  );
};
