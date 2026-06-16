import { SnapchefExternalSystemError, SnapchefValidationError } from "@/lib/core/model/error";
import type { RecognizedItem } from "@/lib/core/model/recipe";
import { Effect, Either } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The OpenRouter client is built at module scope behind an env-gated Effect (not constructor-
// injected), so this test mocks modules rather than passing a fake. `vi.hoisted` makes the shared
// send-mock available inside the hoisted `vi.mock` factory.
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("@openrouter/sdk", () => ({
  OpenRouter: class {
    chat = { send: sendMock };
  },
}));

// Provide an API key (the shared stub leaves it undefined, which short-circuits to "not configured")
// plus the recipe model pair the module imports at module scope.
vi.mock("astro:env/server", () => ({
  OPENROUTER_API_KEY: "test-key",
  OPENROUTER_RECIPE_MODEL: "openai/gpt-4.1-mini",
  OPENROUTER_RECIPE_FALLBACK_MODEL: "openai/gpt-4o-mini",
  OPENROUTER_RECOGNITION_MODEL: "google/gemini-2.5-flash-lite",
  OPENROUTER_RECOGNITION_FALLBACK_MODEL: "openai/gpt-4o-mini",
}));

// Imported after the mocks are declared; vi.mock is hoisted above this import.
import { createRecipeGenerator } from "@/lib/infrastructure/llm/openrouter";

const cannedChoice = (overrides: { content?: string | null; finishReason?: string; refusal?: string | null }) => ({
  choices: [
    {
      finishReason: overrides.finishReason ?? "stop",
      index: 0,
      message: { role: "assistant", content: overrides.content ?? null, refusal: overrides.refusal ?? null },
    },
  ],
});

const ITEMS: RecognizedItem[] = [{ name: "jajko", quantity: "4 sztuki", context: "z kartonu w drzwiach lodówki" }];

const runGenerate = () =>
  Effect.runPromise(
    Effect.either(
      createRecipeGenerator().generate({ items: ITEMS, mealContext: "coś szybkiego", allowExtraIngredients: true }),
    ),
  );

describe("createRecipeGenerator — generate", () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it("decodes a well-formed { name, content } response to { name, contentMd }", async () => {
    sendMock.mockResolvedValue(
      cannedChoice({
        content: JSON.stringify({
          name: "Jajecznica",
          content: "## Składniki\n- 4 jajka\n\n## Przygotowanie\n1. Usmaż.",
        }),
      }),
    );

    const result = await runGenerate();

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.name).toBe("Jajecznica");
      expect(result.right.contentMd).toContain("## Składniki");
    }
  });

  it("fails SnapchefExternalSystemError on a truncated (finishReason 'length') response", async () => {
    sendMock.mockResolvedValue(cannedChoice({ content: '{"name":"Jaje', finishReason: "length" }));

    const result = await runGenerate();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefExternalSystemError);
      expect(result.left.message).toBe("Model output truncated");
    }
  });

  it("fails SnapchefExternalSystemError on a refusal response", async () => {
    sendMock.mockResolvedValue(cannedChoice({ content: null, refusal: "Nie mogę pomóc" }));

    const result = await runGenerate();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefExternalSystemError);
    }
  });

  it("fails SnapchefExternalSystemError (never SnapchefValidationError) on non-JSON content", async () => {
    sendMock.mockResolvedValue(cannedChoice({ content: "to nie jest JSON" }));

    const result = await runGenerate();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefExternalSystemError);
      expect(result.left).not.toBeInstanceOf(SnapchefValidationError);
    }
  });

  it("fails SnapchefExternalSystemError (never SnapchefValidationError) on a schema mismatch", async () => {
    sendMock.mockResolvedValue(cannedChoice({ content: JSON.stringify({ unexpected: "shape" }) }));

    const result = await runGenerate();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(SnapchefExternalSystemError);
      expect(result.left).not.toBeInstanceOf(SnapchefValidationError);
    }
  });
});
