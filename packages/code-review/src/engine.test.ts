import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONCERN_ORDER } from "./review.js";

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

const { REVIEW_SCHEMA, runReview } = await import("./engine.js");

// What the model emits: a ReviewDraft (per-area coverage + findings, no verdict).
const validDraft = {
  summary: "One off-by-one in the loop bound.",
  areas: {
    correctness: { status: "blocking", rationale: "off-by-one in the loop bound" },
    error_handling: { status: "ok", rationale: "no error paths touched" },
    security: { status: "ok", rationale: "no trust boundaries touched" },
    tests: { status: "ok", rationale: "covered" },
    api_contract: { status: "ok", rationale: "no contract change" },
    maintainability: { status: "ok", rationale: "fine" },
    frontend: { status: "not_applicable", rationale: "no UI in diff" },
  },
  findings: [
    {
      severity: "major",
      category: "correctness",
      file: "src/loop.ts",
      line: 4,
      title: "Off-by-one",
      detail: "`<=` should be `<`.",
      suggestion: "Use `<`.",
    },
  ],
};

// What runReview returns: the draft plus the code-derived verdict.
const expectedReview = { ...validDraft, verdict: "request_changes" };

describe("runReview", () => {
  beforeEach(() => {
    h.state.resultMessage = { type: "result", subtype: "success", structured_output: validDraft };
  });

  it("returns the draft plus a derived verdict", async () => {
    const review = await runReview("some diff", { model: "claude-sonnet-4-6" });
    expect(review).toEqual(expectedReview);
  });

  it("derives the verdict from the area statuses", async () => {
    const allClear = {
      ...validDraft,
      areas: { ...validDraft.areas, correctness: { status: "ok", rationale: "fine" } },
    };
    h.state.resultMessage = { type: "result", subtype: "success", structured_output: allClear };
    const review = await runReview("some diff", { model: "claude-sonnet-4-6" });
    expect(review.verdict).toBe("approve");
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

describe("REVIEW_SCHEMA", () => {
  it("constrains the model to the draft shape with no verdict", () => {
    const schema = REVIEW_SCHEMA as unknown as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(["areas", "findings"]));
    expect(Object.keys(schema.properties)).not.toContain("verdict");
  });

  it("requires every concern area so coverage cannot be skipped", () => {
    const areas = (
      REVIEW_SCHEMA as unknown as {
        properties: { areas: { properties: Record<string, unknown>; required: string[] } };
      }
    ).properties.areas;
    expect(Object.keys(areas.properties).sort()).toEqual([...CONCERN_ORDER].sort());
    expect([...areas.required].sort()).toEqual([...CONCERN_ORDER].sort());
  });
});
