import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared, hoisted state so the mocked `tool()` can stash the handler and the
// mocked `query()` can drive it. `vi.hoisted` is required because `vi.mock`
// factories are hoisted above normal top-level declarations.
const h = vi.hoisted(() => ({
  state: {
    capturedHandler: undefined as undefined | ((args: unknown, extra: unknown) => Promise<unknown>),
    handlerArgs: undefined as unknown,
    callHandler: true,
    resultMessage: undefined as unknown,
  },
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  tool: (
    _name: string,
    _description: string,
    _shape: unknown,
    handler: (args: unknown, extra: unknown) => Promise<unknown>,
  ) => {
    h.state.capturedHandler = handler;
    return { name: _name };
  },
  createSdkMcpServer: (options: unknown) => options,
  query: (_params: unknown) =>
    (async function* () {
      if (h.state.callHandler && h.state.capturedHandler) {
        await h.state.capturedHandler(h.state.handlerArgs, {});
      }
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
    h.state.capturedHandler = undefined;
    h.state.callHandler = true;
    h.state.handlerArgs = undefined;
    h.state.resultMessage = { type: "result", subtype: "success" };
  });

  it("captures the review tool args and resolves to the validated Review", async () => {
    h.state.handlerArgs = validReview;
    const review = await runReview("some diff", { model: "claude-sonnet-4-6" });
    expect(review).toEqual(validReview);
  });

  it("succeeds even if the run hits maxTurns after the tool was called", async () => {
    h.state.handlerArgs = validReview;
    h.state.resultMessage = { type: "result", subtype: "error_max_turns", errors: [] };
    const review = await runReview("some diff", { model: "claude-sonnet-4-6" });
    expect(review.verdict).toBe("request_changes");
  });

  it("rejects when the model never calls the review tool", async () => {
    h.state.callHandler = false;
    h.state.resultMessage = { type: "result", subtype: "success" };
    await expect(runReview("some diff", { model: "claude-sonnet-4-6" })).rejects.toThrow(
      /did not call the review tool/i,
    );
  });

  it("rejects and surfaces SDK errors when the run fails without a captured review", async () => {
    h.state.callHandler = false;
    h.state.resultMessage = { type: "result", subtype: "error_during_execution", errors: ["boom", "kaboom"] };
    await expect(runReview("some diff", { model: "claude-sonnet-4-6" })).rejects.toThrow(/boom; kaboom/);
  });
});
