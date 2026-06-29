// @vitest-environment jsdom
import { WizardReviewProducts } from "@/components/recipes/wizard/WizardReviewProducts";
import type { PhotoView } from "@/lib/core/boundry/recipe";
import type { RecipeSession } from "@/lib/core/model/recipe";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The nested RecipeGenerationPanel reaches the client hook on submit; stub it so mounting the review
// step never touches a real transport. No request is made on render — Effect.never is never run.
vi.mock("@/components/hooks/useApiClient", async () => {
  const { Effect } = await import("effect");
  return {
    useApiClient: () => ({
      post: () => Effect.never,
      del: () => Effect.never,
      postFormData: () => Effect.never,
    }),
  };
});

const baseSession: RecipeSession = {
  id: "11111111-2222-3333-4444-555555555555",
  userId: "22222222-3333-4444-5555-666666666666",
  correctedItems: null,
  createdAt: "2026-06-16T00:00:00.000Z",
  mealContext: null,
  allowExtraIngredients: null,
  recognizedItems: [{ name: "Pomidory", quantity: "3 szt.", context: "ze zdjęcia" }],
  state: "products_recognized",
  updatedAt: "2026-06-16T00:00:00.000Z",
};

const noPhotos: PhotoView[] = [];
const rows = () => screen.getAllByRole("listitem");
const nameInput = (row: HTMLElement) => within(row).getByLabelText("Nazwa produktu");

describe("WizardReviewProducts seeding", () => {
  it("seeds the editor from correctedItems when present — prior edits take precedence", () => {
    const session: RecipeSession = {
      ...baseSession,
      correctedItems: [{ name: "Papryka", quantity: "2 szt.", context: "poprawione" }],
    };
    render(<WizardReviewProducts session={session} photos={noPhotos} onGenerated={() => undefined} />);

    expect(rows()).toHaveLength(1);
    expect(nameInput(rows()[0])).toHaveValue("Papryka");
  });

  it("falls back to recognizedItems when correctedItems is null", () => {
    render(<WizardReviewProducts session={baseSession} photos={noPhotos} onGenerated={() => undefined} />);

    expect(rows()).toHaveLength(1);
    expect(nameInput(rows()[0])).toHaveValue("Pomidory");
  });
});
