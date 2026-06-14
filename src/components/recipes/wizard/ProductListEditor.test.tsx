// @vitest-environment jsdom
import { ProductListEditor } from "@/components/recipes/wizard/ProductListEditor";
import { itemFieldHints, useEditableItems } from "@/components/recipes/wizard/useEditableItems";
import type { RecognizedItem } from "@/lib/core/model/recipe";
import { act, render, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

const sampleItems: RecognizedItem[] = [
  { name: "Pomidory", quantity: "3 szt.", context: "rozpoznane na zdjęciu 1" },
  { name: "Mleko", quantity: "1 l", context: "rozpoznane na zdjęciu 2" },
];

// Locate rows and their fields by role/accessible label — never by DOM structure (repo policy).
const rows = () => screen.getAllByRole("listitem");
const nameInput = (row: HTMLElement) => within(row).getByLabelText("Nazwa produktu");
const quantityInput = (row: HTMLElement) => within(row).getByLabelText("Ilość");
const addButton = () => screen.getByRole("button", { name: "Dodaj produkt" });

describe("ProductListEditor", () => {
  it("seeds one row per recognized item with its name, quantity and context", () => {
    render(<ProductListEditor recognizedItems={sampleItems} />);

    expect(rows()).toHaveLength(2);
    expect(nameInput(rows()[0])).toHaveValue("Pomidory");
    expect(quantityInput(rows()[0])).toHaveValue("3 szt.");
    expect(screen.getByText("rozpoznane na zdjęciu 1")).toBeInTheDocument();
    expect(nameInput(rows()[1])).toHaveValue("Mleko");
    expect(quantityInput(rows()[1])).toHaveValue("1 l");
    expect(screen.getByText("rozpoznane na zdjęciu 2")).toBeInTheDocument();
  });

  it("edits a name and a quantity in place, leaving the other row untouched", async () => {
    const user = userEvent.setup();
    render(<ProductListEditor recognizedItems={sampleItems} />);

    const firstName = nameInput(rows()[0]);
    await user.clear(firstName);
    await user.type(firstName, "Papryka");
    expect(nameInput(rows()[0])).toHaveValue("Papryka");

    const firstQuantity = quantityInput(rows()[0]);
    await user.clear(firstQuantity);
    await user.type(firstQuantity, "5 szt.");
    expect(quantityInput(rows()[0])).toHaveValue("5 szt.");

    expect(nameInput(rows()[1])).toHaveValue("Mleko");
    expect(quantityInput(rows()[1])).toHaveValue("1 l");
  });

  it("adds a blank row at the bottom and focuses its name input", async () => {
    const user = userEvent.setup();
    render(<ProductListEditor recognizedItems={sampleItems} />);

    await user.click(addButton());

    const allRows = rows();
    expect(allRows).toHaveLength(3);
    const newName = nameInput(allRows[2]);
    expect(newName).toHaveValue("");
    expect(newName).toHaveFocus();
  });

  it("deletes the targeted row and leaves the others intact", async () => {
    const user = userEvent.setup();
    render(<ProductListEditor recognizedItems={sampleItems} />);

    await user.click(within(rows()[0]).getByRole("button", { name: "Usuń produkt" }));

    const remaining = rows();
    expect(remaining).toHaveLength(1);
    expect(nameInput(remaining[0])).toHaveValue("Mleko");
    expect(quantityInput(remaining[0])).toHaveValue("1 l");
  });

  it("renders the empty state (hint + add button, zero rows) for both null and []", () => {
    const { unmount } = render(<ProductListEditor recognizedItems={null} />);

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText("Nie rozpoznano żadnych produktów.")).toBeInTheDocument();
    expect(addButton()).toBeInTheDocument();
    unmount();

    render(<ProductListEditor recognizedItems={[]} />);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText("Nie rozpoznano żadnych produktów.")).toBeInTheDocument();
    expect(addButton()).toBeInTheDocument();
  });

  it("surfaces a validation hint when a field is cleared", async () => {
    const user = userEvent.setup();
    render(<ProductListEditor recognizedItems={sampleItems} />);

    await user.clear(nameInput(rows()[0]));
    expect(within(rows()[0]).getByText("Nazwa nie może być pusta.")).toBeInTheDocument();

    await user.clear(quantityInput(rows()[0]));
    expect(within(rows()[0]).getByText("Podaj ilość.")).toBeInTheDocument();
  });
});

describe("itemFieldHints", () => {
  it("flags an empty name and quantity", () => {
    expect(itemFieldHints({ name: "  ", quantity: "" })).toEqual({
      name: "Nazwa nie może być pusta.",
      quantity: "Podaj ilość.",
    });
  });

  it("flags an over-length name and quantity", () => {
    const hints = itemFieldHints({ name: "x".repeat(121), quantity: "y".repeat(61) });
    expect(hints.name).toMatch(/za długa/);
    expect(hints.quantity).toMatch(/za długa/);
  });

  it("measures over-length on the trimmed value, matching the projection's accept boundary", () => {
    // Raw length 122 / 62 but trims to exactly the max (120 / 60) — the projection trims and accepts,
    // so the hint must not flag these as over-length.
    const hints = itemFieldHints({ name: `  ${"x".repeat(120)}`, quantity: ` ${"y".repeat(60)} ` });
    expect(hints.name).toBeUndefined();
    expect(hints.quantity).toBeUndefined();
  });

  it("returns no hints for a valid item", () => {
    expect(itemFieldHints({ name: "Mleko", quantity: "1 l" })).toEqual({});
  });
});

describe("useEditableItems.toCorrectedItems", () => {
  it("projects trimmed valid rows to RecognizedItem[] and drops invalid (blank) rows", () => {
    const { result } = renderHook(() =>
      useEditableItems([{ name: "  Mleko  ", quantity: " 1 l ", context: "z konsolidacji" }]),
    );

    act(() => {
      result.current.addItem(); // a blank row — must be dropped by the projection
    });

    expect(result.current.toCorrectedItems()).toEqual([{ name: "Mleko", quantity: "1 l", context: "z konsolidacji" }]);
  });
});
