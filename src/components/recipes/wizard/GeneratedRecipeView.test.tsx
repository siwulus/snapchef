// @vitest-environment jsdom
import { GeneratedRecipeView } from "@/components/recipes/wizard/GeneratedRecipeView";
import type { PhotoView } from "@/lib/core/boundry/recipe";
import type { Recipe, RecipeSession } from "@/lib/core/model/recipe";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

const recipe: Recipe = {
  id: "99999999-8888-7777-6666-555555555555",
  userId: "11111111-2222-3333-4444-555555555555",
  sessionId: "11111111-2222-3333-4444-555555555555",
  name: "Jajecznica ze szczypiorkiem",
  contentMd: "## Składniki\n\n- 4 jajka\n\n## Przygotowanie\n\n1. Rozgrzej patelnię.",
  createdAt: "2026-06-16T00:00:00.000Z",
};

const photos: PhotoView[] = [
  { id: "aaaaaaaa-1111-2222-3333-444444444444", photoUrl: "https://example.test/a.jpg", recognizedItems: null },
];

// The read-only echo is sourced from the returned session (backend data), not the submitted command.
const session: RecipeSession = {
  id: "11111111-2222-3333-4444-555555555555",
  userId: "11111111-2222-3333-4444-555555555555",
  correctedItems: [{ name: "jajko", quantity: "4 sztuki", context: "z lodówki" }],
  createdAt: "2026-06-16T00:00:00.000Z",
  mealContext: "szybka kolacja na dwie osoby",
  recognizedItems: [{ name: "jajko", quantity: "4 sztuki", context: "z lodówki" }],
  allowExtraIngredients: false,
  state: "recipe_generated",
  updatedAt: "2026-06-16T00:00:00.000Z",
};

const renderView = () => render(<GeneratedRecipeView recipe={recipe} photos={photos} session={session} />);

describe("GeneratedRecipeView", () => {
  it("renders the kept content as read-only — no editable controls", () => {
    renderView();

    expect(screen.getByText("szybka kolacja na dwie osoby")).toBeInTheDocument();
    expect(screen.getByText("jajko")).toBeInTheDocument();
    expect(screen.getByText(/4 sztuki/)).toBeInTheDocument();
    // off-list toggle echoed as read-only text (the disabled "off" wording)
    expect(screen.getByText("Wyłączone: trzymaj się moich produktów.")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://example.test/a.jpg");

    // No inputs: the meal context is plain text now, not a textarea, and the toggle is gone.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("renders the recipe name as a heading above the markdown body", () => {
    renderView();
    expect(screen.getByRole("heading", { name: "Jajecznica ze szczypiorkiem", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Składniki", level: 2 })).toBeInTheDocument();
  });

  it("renders the kept read-only content before the generated recipe", () => {
    const { container } = renderView();
    const text = container.textContent;
    expect(text.indexOf("szybka kolacja na dwie osoby")).toBeLessThan(text.indexOf("Jajecznica ze szczypiorkiem"));
  });
});
