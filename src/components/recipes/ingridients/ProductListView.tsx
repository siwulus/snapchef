import type { RecognizedItem } from "@/lib/core/model/recipe";

interface ProductListViewProps {
  items: RecognizedItem[];
}

export const ProductListView = ({ items }: ProductListViewProps) => (
  <>
    {items.length > 0 ? (
      <div className="flex flex-col gap-2">
        <h2 className="text-foreground text-lg font-semibold">Finalna lista produktów rozpoznanych ze zdjęć</h2>
        <ul className="text-muted-foreground flex flex-col gap-1 text-sm">
          {items.map((item, index) => (
            <li key={index}>
              <span className="text-foreground font-medium">{item.name}</span>
              {item.quantity ? <span> — {item.quantity}</span> : null}
            </li>
          ))}
        </ul>
      </div>
    ) : null}
  </>
);
