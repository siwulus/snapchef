import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared, hoisted state so the mocked `query()` can yield a configurable result
// message. `vi.hoisted` is required because `vi.mock` factories are hoisted above
// normal top-level declarations.
const h = vi.hoisted(() => ({
  state: {
    resultMessage: undefined as unknown,
  },
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (_params: unknown) =>
    (async function* () {
      yield h.state.resultMessage;
    })(),
}));

const { runReview } = await import("./engine.js");

const validReview = {
  summary: "One off-by-one in the loop bound.",
  findings: [
    {
      severity: "major",
      file: "src/loop.ts",
      line: 4,
      title: "Off-by-one",
      detail: "`<=` should be `<`.",
      suggestion: "Use `<`.",
    },
  ],
  verdict: "request_changes",
};

describe("runReview", () => {
  beforeEach(() => {
    h.state.resultMessage = { type: "result", subtype: "success", structured_output: validReview };
  });

  it("returns the validated Review from the structured output", async () => {
    const review = await runReview("some diff", { model: "claude-sonnet-4-6" });
    expect(review).toEqual(validReview);
  });

  it("rejects when the run succeeds without structured output", async () => {
    h.state.resultMessage = { type: "result", subtype: "success" };
    await expect(runReview("some diff", { model: "claude-sonnet-4-6" })).rejects.toThrow(
      /did not produce a structured review/i,
    );
  });

  it("rejects and surfaces SDK errors when the run fails", async () => {
    h.state.resultMessage = { type: "result", subtype: "error_during_execution", errors: ["boom", "kaboom"] };
    await expect(runReview("some diff", { model: "claude-sonnet-4-6" })).rejects.toThrow(/boom; kaboom/);
  });

  it("rejects when structured-output retries are exhausted", async () => {
    h.state.resultMessage = { type: "result", subtype: "error_max_structured_output_retries", errors: [] };
    await expect(runReview("some diff", { model: "claude-sonnet-4-6" })).rejects.toThrow(/Code review failed/);
  });
});
