// @vitest-environment jsdom
import { RecipeGenerationPanel } from "@/components/recipes/wizard/RecipeGenerationPanel";
import type { RecognizedItem } from "@/lib/core/model/recipe";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

const items: RecognizedItem[] = [{ name: "jajko", quantity: "4 sztuki", context: "z lodówki" }];

const SESSION_ID = "11111111-2222-3333-4444-555555555555";
const noop = () => undefined;

const generateButton = () => screen.getByRole("button", { name: "Generuj przepis" });

describe("RecipeGenerationPanel", () => {
  it("defaults the off-list toggle to on and flips it off on click", async () => {
    const user = userEvent.setup();
    render(<RecipeGenerationPanel sessionId={SESSION_ID} toCorrectedItems={() => items} onGenerated={noop} />);

    const toggle = screen.getByRole("switch");
    expect(toggle).toBeChecked();

    await user.click(toggle);
    expect(toggle).not.toBeChecked();
  });

  it("enables the generate button when the projected list is non-empty", () => {
    render(<RecipeGenerationPanel sessionId={SESSION_ID} toCorrectedItems={() => items} onGenerated={noop} />);
    expect(generateButton()).toBeEnabled();
  });

  it("disables the generate button when the projected list is empty", () => {
    render(<RecipeGenerationPanel sessionId={SESSION_ID} toCorrectedItems={() => []} onGenerated={noop} />);
    expect(generateButton()).toBeDisabled();
  });

  it("exposes the meal-context textarea", () => {
    render(<RecipeGenerationPanel sessionId={SESSION_ID} toCorrectedItems={() => items} onGenerated={noop} />);
    expect(screen.getByLabelText("Co chcesz ugotować?")).toBeInTheDocument();
  });
});
