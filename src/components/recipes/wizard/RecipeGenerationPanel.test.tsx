// @vitest-environment jsdom
import { RecipeGenerationPanel } from "@/components/recipes/wizard/RecipeGenerationPanel";
import type { RecipeGenerationCommand } from "@/lib/core/boundry/recipe";
import type { Recipe, RecognizedItem } from "@/lib/core/model/recipe";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The recipe the mocked transport returns on a successful generate. Read by the success branch of
// useRecipeGeneration, which then forwards (recipe, command) to onGenerated.
const mocks = vi.hoisted(() => ({
  recipe: {
    id: "99999999-8888-7777-6666-555555555555",
    sessionId: "11111111-2222-3333-4444-555555555555",
    userId: "22222222-3333-4444-5555-666666666666",
    name: "Jajecznica",
    contentMd: "## Składniki\n\n- 4 jajka",
    createdAt: "2026-06-16T00:00:00.000Z",
  },
}));

// Mock the client hook so no real fetch runs; the generate POST resolves to a success envelope.
vi.mock("@/components/hooks/useApiClient", async () => {
  const { Effect } = await import("effect");
  return {
    useApiClient: () => ({
      post: () => Effect.succeed({ ok: true, data: mocks.recipe }),
      del: () => Effect.succeed({ ok: true, data: { redirect: "/recipes" } }),
      postFormData: () => Effect.succeed({ ok: true, data: mocks.recipe }),
    }),
  };
});

const items: RecognizedItem[] = [{ name: "jajko", quantity: "4 sztuki", context: "z lodówki" }];

const SESSION_ID = "11111111-2222-3333-4444-555555555555";
const noop = () => undefined;

const generateButton = () => screen.getByRole("button", { name: "Generuj przepis" });

beforeEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { assign: vi.fn() },
  });
});

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

  it("forwards the generated recipe and the submitted command to onGenerated", async () => {
    const user = userEvent.setup();
    const onGenerated = vi.fn<(recipe: Recipe, command: RecipeGenerationCommand) => void>();
    render(<RecipeGenerationPanel sessionId={SESSION_ID} toCorrectedItems={() => items} onGenerated={onGenerated} />);

    await user.type(screen.getByLabelText("Co chcesz ugotować?"), "szybka kolacja");
    await user.click(screen.getByRole("switch")); // turn the off-list toggle off
    await user.click(generateButton());

    await waitFor(() => {
      expect(onGenerated).toHaveBeenCalledTimes(1);
    });
    expect(onGenerated).toHaveBeenCalledWith(mocks.recipe, {
      correctedItems: items,
      mealContext: "szybka kolacja",
      allowExtraIngredients: false,
    });
  });
});
