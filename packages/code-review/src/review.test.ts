import { describe, expect, it } from "vitest";
import { Review } from "./review.js";

const validReview = {
  summary: "Adds a divide helper; one division-by-zero bug.",
  findings: [
    {
      severity: "critical",
      file: "src/math.ts",
      line: 12,
      title: "Division by zero not guarded",
      detail: "divide(a, 0) returns Infinity instead of throwing.",
      suggestion: "Throw a RangeError when the divisor is 0.",
    },
    {
      severity: "nit",
      file: "src/math.ts",
      title: "Missing JSDoc",
      detail: "The exported helper has no doc comment.",
    },
  ],
  verdict: "request_changes",
};

describe("Review schema", () => {
  it("accepts a valid review fixture", () => {
    const parsed = Review.parse(validReview);
    expect(parsed.verdict).toBe("request_changes");
    expect(parsed.findings).toHaveLength(2);
    // optional fields are preserved / absent as given
    expect(parsed.findings[0]?.line).toBe(12);
    expect(parsed.findings[1]?.suggestion).toBeUndefined();
  });

  it("accepts an empty findings list with an approve verdict", () => {
    const parsed = Review.parse({ summary: "All good.", findings: [], verdict: "approve" });
    expect(parsed.findings).toEqual([]);
  });

  it("rejects a missing verdict", () => {
    expect(() => Review.parse({ summary: "x", findings: [] })).toThrow();
  });

  it("rejects an unknown severity", () => {
    const bad = { ...validReview, findings: [{ ...validReview.findings[0], severity: "blocker" }] };
    expect(() => Review.parse(bad)).toThrow();
  });

  it("rejects an unknown verdict value", () => {
    expect(() => Review.parse({ summary: "x", findings: [], verdict: "lgtm" })).toThrow();
  });
});
