import type { EditableItem, FieldHints } from "@/components/recipes/wizard/useEditableItems";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";

interface ProductRowProps {
  item: EditableItem;
  onChange: (field: "name" | "quantity", value: string) => void;
  onRemove: () => void;
  autoFocus?: boolean;
  hints?: FieldHints;
}

// One editable item: a name Input, a quantity Input, the item's read-only `context` shown as smaller
// muted text always below the inputs, and a delete control aligned with the inputs row. On sm+ the
// layout is two columns (inputs + context | delete); on mobile it stacks into one column. Fields carry
// Polish accessible labels so tests/E2E locate them by role/label rather than DOM structure.
export const ProductRow = ({ item, onChange, onRemove, autoFocus, hints }: ProductRowProps) => {
  const nameRef = useRef<HTMLInputElement>(null);

  // Focus the name input once the row has rendered (drives autofocus-on-add). Keyed on `autoFocus`
  // so only the freshly-added row grabs focus; seeded rows render with autoFocus=false and stay put.
  useEffect(() => {
    if (autoFocus) nameRef.current?.focus();
  }, [autoFocus]);

  return (
    <div className="border-border flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex flex-1 flex-col gap-1">
            <Input
              ref={nameRef}
              aria-label="Nazwa produktu"
              placeholder="Nazwa produktu"
              value={item.name}
              aria-invalid={hints?.name ? true : undefined}
              onChange={(event) => {
                onChange("name", event.target.value);
              }}
            />
            {hints?.name ? <p className="text-destructive text-xs">{hints.name}</p> : null}
          </div>
          <div className="flex flex-col gap-1 sm:w-28">
            <Input
              aria-label="Ilość"
              placeholder="Ilość"
              value={item.quantity}
              aria-invalid={hints?.quantity ? true : undefined}
              onChange={(event) => {
                onChange("quantity", event.target.value);
              }}
            />
            {hints?.quantity ? <p className="text-destructive text-xs">{hints.quantity}</p> : null}
          </div>
        </div>

        {item.context ? <p className="text-muted-foreground text-xs">{item.context}</p> : null}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Usuń produkt"
        className="self-end sm:self-start"
        onClick={onRemove}
      >
        <Trash2 />
      </Button>
    </div>
  );
};
