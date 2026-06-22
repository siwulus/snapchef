import { RecognizedItem } from "@/lib/core/model/recipe";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFakeProductRecognizer } from "@/lib/infrastructure/llm/FakeProductRecognizer";
import { createFakeRecipeGenerator } from "@/lib/infrastructure/llm/FakeRecipeGenerator";

// The fakes are the E2E test seam (see src/middleware.ts). These checks guard their contract:
// the output must stay schema-valid and non-empty so the recipe flow never trips the
// all-empty-recognition 500 branch and the recipe row persists a real name/body.

describe("createFakeProductRecognizer", () => {
  it("recognizePhoto returns a non-empty, schema-valid RecognizedItem[]", async () => {
    const items = await Effect.runPromise(createFakeProductRecognizer().recognizePhoto("https://example.test/photo"));

    expect(items.length).toBeGreaterThan(0);
    expect(() => z.array(RecognizedItem).parse(items)).not.toThrow();
  });

  it("mergeItems dedupes by name (case-insensitive)", async () => {
    const recognizer = createFakeProductRecognizer();
    const input: RecognizedItem[] = [
      { name: "Jajka", quantity: "6 sztuk", context: "a" },
      { name: "jajka", quantity: "12 sztuk", context: "b" },
      { name: "Mleko", quantity: "1 litr", context: "c" },
    ];

    const merged = await Effect.runPromise(recognizer.mergeItems(input));

    expect(merged).toHaveLength(2);
    expect(() => z.array(RecognizedItem).parse(merged)).not.toThrow();
  });
});

describe("createFakeRecipeGenerator", () => {
  it("generate returns non-empty name/contentMd derived from the inputs", async () => {
    const result = await Effect.runPromise(
      createFakeRecipeGenerator().generate({
        items: [{ name: "Pomidory", quantity: "3 sztuki", context: "x" }],
        mealContext: "kolacja",
        allowExtraIngredients: true,
      }),
    );

    expect(result.name.length).toBeGreaterThan(0);
    expect(result.contentMd.length).toBeGreaterThan(0);
    // Inputs flowed through: the meal context shapes the name, the item appears in the body.
    expect(result.name).toContain("kolacja");
    expect(result.contentMd).toContain("Pomidory");
  });
});
