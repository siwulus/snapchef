import { describe, expect, it } from "vitest";
import {
  buildPostPlan,
  INLINE_MARKER,
  parseReview,
  type Finding,
  type Review,
  STICKY_MARKER,
  verdictToGate,
} from "./plan.js";

const finding = (over: Partial<Finding> = {}): Finding => ({
  severity: "major",
  category: "correctness",
  file: "src/foo.ts",
  line: 1,
  title: "title",
  detail: "detail",
  ...over,
});

const okAreas = {
  correctness: { status: "ok", rationale: "fine" },
  error_handling: { status: "ok", rationale: "fine" },
  security: { status: "ok", rationale: "fine" },
  tests: { status: "ok", rationale: "fine" },
  api_contract: { status: "ok", rationale: "fine" },
  maintainability: { status: "ok", rationale: "fine" },
  frontend: { status: "not_applicable", rationale: "no UI" },
} as const;

const review = (over: Partial<Review> = {}): Review => ({
  summary: "a summary",
  areas: okAreas,
  findings: [],
  verdict: "comment",
  ...over,
});

const validLines = (entries: Record<string, number[]>): Map<string, Set<number>> =>
  new Map(Object.entries(entries).map(([path, lines]) => [path, new Set(lines)]));

describe("verdictToGate", () => {
  it("blocks on request_changes", () => {
    expect(verdictToGate("request_changes")).toEqual({ state: "failure", label: "cr:fail" });
  });
  it("passes on approve", () => {
    expect(verdictToGate("approve")).toEqual({ state: "success", label: "cr:pass" });
  });
  it("passes on comment (advisory)", () => {
    expect(verdictToGate("comment")).toEqual({ state: "success", label: "cr:pass" });
  });
});

describe("buildPostPlan", () => {
  it("posts an in-diff finding as an inline comment", () => {
    const plan = buildPostPlan(review({ findings: [finding({ file: "src/foo.ts", line: 2 })] }), validLines({ "src/foo.ts": [1, 2, 3] }));
    expect(plan.comments).toHaveLength(1);
    expect(plan.comments[0]).toMatchObject({ path: "src/foo.ts", line: 2, side: "RIGHT" });
    expect(plan.comments[0]?.body).toContain(INLINE_MARKER);
  });

  it("routes an out-of-diff line to the summary, not inline", () => {
    const plan = buildPostPlan(review({ findings: [finding({ file: "src/foo.ts", line: 99 })] }), validLines({ "src/foo.ts": [1, 2, 3] }));
    expect(plan.comments).toHaveLength(0);
    expect(plan.stickyBody).toContain("src/foo.ts:99");
  });

  it("routes a line-less finding to the summary", () => {
    const plan = buildPostPlan(review({ findings: [finding({ file: "src/baz.ts", line: undefined, title: "no line" })] }), validLines({}));
    expect(plan.comments).toHaveLength(0);
    expect(plan.stickyBody).toContain("no line");
    expect(plan.stickyBody).toContain("`src/baz.ts`");
  });

  it("never emits an inline comment for an unknown file", () => {
    const plan = buildPostPlan(review({ findings: [finding({ file: "src/unknown.ts", line: 1 })] }), validLines({ "src/foo.ts": [1] }));
    expect(plan.comments).toHaveLength(0);
  });

  it("caps inline comments by severity and overflows the rest into the summary", () => {
    const minors = Array.from({ length: 30 }, (_, i) => finding({ severity: "minor", file: "src/foo.ts", line: i + 1, title: `minor ${i + 1}` }));
    const critical = finding({ severity: "critical", file: "src/foo.ts", line: 31, title: "the critical" });
    const lines = Array.from({ length: 31 }, (_, i) => i + 1);

    const plan = buildPostPlan(review({ findings: [...minors, critical], verdict: "request_changes" }), validLines({ "src/foo.ts": lines }));

    expect(plan.comments).toHaveLength(30);
    // Highest severity is ordered first into the inline set.
    expect(plan.comments[0]).toMatchObject({ line: 31 });
    expect(plan.comments[0]?.body).toContain("the critical");
    // Exactly one minor overflows to the summary: the last by stable order (line 30).
    expect(plan.stickyBody).toContain("### Additional findings");
    expect(plan.stickyBody).toContain("src/foo.ts:30");
  });

  it("respects a custom maxInline", () => {
    const findings = [finding({ line: 1 }), finding({ line: 2 }), finding({ line: 3 })];
    const plan = buildPostPlan(review({ findings }), validLines({ "src/foo.ts": [1, 2, 3] }), { maxInline: 2 });
    expect(plan.comments).toHaveLength(2);
    expect(plan.stickyBody).toContain("### Additional findings");
  });

  it.each([
    ["approve", "success", "cr:pass"],
    ["comment", "success", "cr:pass"],
    ["request_changes", "failure", "cr:fail"],
  ] as const)("maps verdict %s → %s/%s", (verdict, state, label) => {
    const plan = buildPostPlan(review({ verdict }), new Map());
    expect(plan.state).toBe(state);
    expect(plan.label).toBe(label);
  });

  it("composes the sticky body with marker, verdict, and summary", () => {
    const plan = buildPostPlan(review({ summary: "the overall summary", verdict: "approve", findings: [] }), new Map());
    expect(plan.stickyBody.startsWith(STICKY_MARKER)).toBe(true);
    expect(plan.stickyBody).toContain("`approve`");
    expect(plan.stickyBody).toContain("the overall summary");
    expect(plan.stickyBody).toContain("_No findings._");
  });

  it("renders an area-coverage section in the sticky body", () => {
    const plan = buildPostPlan(
      review({ areas: { ...okAreas, security: { status: "blocking", rationale: "secret leaked" } }, verdict: "request_changes" }),
      new Map(),
    );
    expect(plan.stickyBody).toContain("### Area coverage");
    expect(plan.stickyBody).toContain("**security**");
    expect(plan.stickyBody).toContain("BLOCKING");
  });

  it("notes when all findings landed inline", () => {
    const plan = buildPostPlan(review({ findings: [finding({ line: 1 })] }), validLines({ "src/foo.ts": [1] }));
    expect(plan.stickyBody).toContain("posted as inline comments");
  });

  it("always produces a non-empty review body (valid COMMENT review with zero comments)", () => {
    const plan = buildPostPlan(review({ findings: [] }), new Map());
    expect(plan.reviewBody.length).toBeGreaterThan(0);
    expect(plan.comments).toHaveLength(0);
  });

  it("carries the review verdict onto the plan (for the action's verdict output)", () => {
    expect(buildPostPlan(review({ verdict: "request_changes" }), new Map()).verdict).toBe("request_changes");
    expect(buildPostPlan(review({ verdict: "approve" }), new Map()).verdict).toBe("approve");
  });
});

describe("parseReview", () => {
  it("parses valid package --json output", () => {
    const json = JSON.stringify(review({ findings: [finding()] }));
    expect(parseReview(json).verdict).toBe("comment");
  });
  it("throws on a contract drift (bad verdict)", () => {
    expect(() => parseReview(JSON.stringify({ areas: okAreas, findings: [], verdict: "lgtm" }))).toThrow();
  });
  it("throws when the per-area coverage block is missing", () => {
    expect(() => parseReview(JSON.stringify({ findings: [], verdict: "approve" }))).toThrow();
  });
});
