// @vitest-environment jsdom
import { RecipeDisplay } from "@/components/recipes/wizard/RecipeDisplay";
import type { RecipeView } from "@/lib/core/boundry/recipe";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

const recipe: RecipeView = {
  id: "99999999-8888-7777-6666-555555555555",
  sessionId: "11111111-2222-3333-4444-555555555555",
  name: "Jajecznica ze szczypiorkiem",
  contentMd:
    "## Składniki\n\n- 4 jajka\n- masło\n- szczypiorek\n\n## Przygotowanie\n\n1. Rozgrzej patelnię.\n2. Wbij jajka i mieszaj.",
  createdAt: "2026-06-16T00:00:00.000Z",
};

describe("RecipeDisplay", () => {
  it("renders the AI name as the recipe title", () => {
    render(<RecipeDisplay recipe={recipe} />);
    expect(screen.getByText("Jajecznica ze szczypiorkiem")).toBeInTheDocument();
  });

  it("renders markdown section headings (not literal '##')", () => {
    render(<RecipeDisplay recipe={recipe} />);
    expect(screen.getByRole("heading", { name: "Składniki", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Przygotowanie", level: 2 })).toBeInTheDocument();
    expect(screen.queryByText(/##/)).toBeNull();
  });

  it("renders the ingredient list items and preparation steps", () => {
    render(<RecipeDisplay recipe={recipe} />);
    expect(screen.getByText("4 jajka")).toBeInTheDocument();
    expect(screen.getByText("szczypiorek")).toBeInTheDocument();
    expect(screen.getByText("Rozgrzej patelnię.")).toBeInTheDocument();
  });
});
