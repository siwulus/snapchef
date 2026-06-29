import { describe, expect, it } from "vitest";
import { renderReview } from "./render.js";
import { Review } from "./review.js";

/** All concerns ok / not-applicable — spread and override per fixture. */
const areasAllOk = {
  correctness: { status: "ok", rationale: "n/a" },
  error_handling: { status: "ok", rationale: "n/a" },
  security: { status: "ok", rationale: "n/a" },
  tests: { status: "ok", rationale: "n/a" },
  api_contract: { status: "ok", rationale: "n/a" },
  maintainability: { status: "ok", rationale: "n/a" },
  frontend: { status: "not_applicable", rationale: "no UI" },
} as const;

const fixture = Review.parse({
  summary: "Adds a divide helper; one division-by-zero bug and a nit.",
  areas: { ...areasAllOk, correctness: { status: "blocking", rationale: "division by zero unguarded" } },
  findings: [
    {
      severity: "nit",
      category: "maintainability",
      file: "src/math.ts",
      title: "Missing JSDoc",
      detail: "The exported helper has no doc comment.",
    },
    {
      severity: "critical",
      category: "correctness",
      file: "src/math.ts",
      line: 12,
      title: "Division by zero not guarded",
      detail: "divide(a, 0) returns Infinity instead of throwing.",
      suggestion: "Throw a RangeError when the divisor is 0.",
    },
  ],
  verdict: "request_changes",
});

describe("renderReview", () => {
  it("emits JSON that round-trips back to the review", () => {
    const out = renderReview(fixture, { json: true });
    expect(JSON.parse(out)).toEqual(fixture);
  });

  it("pretty output contains the verdict, summary, and each finding's file and title", () => {
    const out = renderReview(fixture, { json: false });
    expect(out).toContain("request_changes");
    expect(out).toContain(fixture.summary);
    fixture.findings.forEach((finding) => {
      expect(out).toContain(finding.file);
      expect(out).toContain(finding.title);
    });
  });

  it("orders findings most-severe first in the pretty output", () => {
    const out = renderReview(fixture, { json: false });
    expect(out.indexOf("CRITICAL")).toBeLessThan(out.indexOf("NIT"));
  });

  it("renders an explicit no-findings line when the review is clean", () => {
    const clean = Review.parse({ summary: "All good.", areas: areasAllOk, findings: [], verdict: "approve" });
    const out = renderReview(clean, { json: false });
    expect(out).toContain("approve");
    expect(out).toContain("No findings.");
  });
});
