import { RecipeSessionFromRow } from "@/lib/infrastructure/db/types/converters";
import { describe, expect, it } from "vitest";

// A complete recipe_sessions row as Supabase returns it, minus allow_extra_ingredients (which the
// caller can omit to model a DB that has not yet had migration 20260616120000 applied).
const baseRow = {
  id: "0a8d6f3e-1b2c-4d5e-8f90-1a2b3c4d5e6f",
  user_id: "5838d7ca-5e55-4924-9f8e-e230946fe24a",
  corrected_items: null,
  created_at: "2026-06-16T00:00:00.000Z",
  meal_context: null,
  recognized_items: null,
  allow_extra_ingredients: null,
  state: "created",
  updated_at: "2026-06-16T00:00:00.000Z",
};

describe("RecipeSessionFromRow — allow_extra_ingredients backward-compat", () => {
  it("decodes a row missing allow_extra_ingredients (column absent) to null", () => {
    // No allow_extra_ingredients key at all — the row a not-yet-migrated DB returns.
    const result = RecipeSessionFromRow.safeParse(baseRow);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.allowExtraIngredients).toBeNull();
    }
  });

  it("decodes a null allow_extra_ingredients to null", () => {
    const result = RecipeSessionFromRow.safeParse({ ...baseRow, allow_extra_ingredients: null });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.allowExtraIngredients).toBeNull();
    }
  });

  it("round-trips an explicit boolean", () => {
    const result = RecipeSessionFromRow.safeParse({ ...baseRow, allow_extra_ingredients: true });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.allowExtraIngredients).toBe(true);
    }
  });
});
