import { describe, expect, it } from "vitest";
import { Areas, type AreaStatus, type ConcernArea, CONCERN_ORDER, deriveVerdict, Review, ReviewDraft } from "./review.js";

/** Build a full areas object with every concern set to the same status. */
const allAreas = (status: AreaStatus): Record<ConcernArea, { status: AreaStatus; rationale: string }> =>
  Object.fromEntries(CONCERN_ORDER.map((concern) => [concern, { status, rationale: `${concern}: ${status}` }])) as Record<
    ConcernArea,
    { status: AreaStatus; rationale: string }
  >;

const validReview = {
  summary: "Adds a divide helper; one division-by-zero bug.",
  areas: { ...allAreas("ok"), correctness: { status: "blocking", rationale: "division by zero unguarded" } },
  findings: [
    {
      severity: "critical",
      category: "correctness",
      file: "src/math.ts",
      line: 12,
      title: "Division by zero not guarded",
      detail: "divide(a, 0) returns Infinity instead of throwing.",
      suggestion: "Throw a RangeError when the divisor is 0.",
    },
    {
      severity: "nit",
      category: "maintainability",
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
    expect(parsed.findings[0]?.line).toBe(12);
    expect(parsed.findings[0]?.category).toBe("correctness");
    expect(parsed.findings[1]?.suggestion).toBeUndefined();
    expect(parsed.areas.frontend.status).toBe("ok");
    expect(parsed.areas.correctness.status).toBe("blocking");
  });

  it("accepts an empty findings list with an approve verdict", () => {
    const parsed = Review.parse({ summary: "All good.", areas: allAreas("ok"), findings: [], verdict: "approve" });
    expect(parsed.findings).toEqual([]);
  });

  it("rejects a missing verdict", () => {
    expect(() => Review.parse({ summary: "x", areas: allAreas("ok"), findings: [] })).toThrow();
  });

  it("rejects an unknown severity", () => {
    const bad = { ...validReview, findings: [{ ...validReview.findings[0], severity: "blocker" }] };
    expect(() => Review.parse(bad)).toThrow();
  });

  it("rejects an unknown verdict value", () => {
    expect(() => Review.parse({ summary: "x", areas: allAreas("ok"), findings: [], verdict: "lgtm" })).toThrow();
  });
});

describe("Areas / ReviewDraft coverage", () => {
  it("accepts a full draft and exposes every concern", () => {
    const draft = ReviewDraft.parse({ summary: "s", areas: allAreas("ok"), findings: [] });
    expect(Object.keys(draft.areas).sort()).toEqual([...CONCERN_ORDER].sort());
  });

  it("rejects a draft missing a concern key", () => {
    const incomplete = Object.fromEntries(
      CONCERN_ORDER.filter((concern) => concern !== "frontend").map((concern) => [
        concern,
        { status: "ok", rationale: "x" },
      ]),
    );
    expect(() => ReviewDraft.parse({ areas: incomplete, findings: [] })).toThrow();
  });

  it("rejects an unknown area status", () => {
    const areas = { ...allAreas("ok"), tests: { status: "skipped", rationale: "x" } };
    expect(() => ReviewDraft.parse({ areas, findings: [] })).toThrow();
  });

  it("rejects a finding with an unknown category", () => {
    const bad = {
      areas: allAreas("ok"),
      findings: [{ severity: "minor", category: "perf", file: "a.ts", title: "t", detail: "d" }],
    };
    expect(() => ReviewDraft.parse(bad)).toThrow();
  });
});

describe("deriveVerdict", () => {
  it("approves when every area is ok", () => {
    expect(deriveVerdict(Areas.parse(allAreas("ok")))).toBe("approve");
  });

  it("approves when every area is not_applicable", () => {
    expect(deriveVerdict(Areas.parse(allAreas("not_applicable")))).toBe("approve");
  });

  it("comments when any area has concerns", () => {
    const areas = Areas.parse({ ...allAreas("ok"), tests: { status: "concerns", rationale: "weak coverage" } });
    expect(deriveVerdict(areas)).toBe("comment");
  });

  it("requests changes when any area is blocking", () => {
    const areas = Areas.parse({ ...allAreas("ok"), security: { status: "blocking", rationale: "secret leaked" } });
    expect(deriveVerdict(areas)).toBe("request_changes");
  });

  it("lets blocking take precedence over concerns", () => {
    const areas = Areas.parse({ ...allAreas("concerns"), security: { status: "blocking", rationale: "x" } });
    expect(deriveVerdict(areas)).toBe("request_changes");
  });
});
