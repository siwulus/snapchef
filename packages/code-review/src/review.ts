import { z } from "zod";

/**
 * Severity of a single review finding, ordered most→least urgent.
 * The renderer groups and sorts findings by this rank.
 */
export const Severity = z.enum(["critical", "major", "minor", "nit"]);
export type Severity = z.infer<typeof Severity>;

/** Display order for severities (index = rank; lower = more urgent). */
export const SEVERITY_ORDER: readonly Severity[] = ["critical", "major", "minor", "nit"];

/** The model's overall judgement on the diff. */
export const Verdict = z.enum(["approve", "comment", "request_changes"]);
export type Verdict = z.infer<typeof Verdict>;

/**
 * Raw Zod shape for a single finding. Exported as a shape (not a wrapped
 * `z.object`) so it can be reused; the `Finding` object schema is derived below.
 */
export const FindingShape = {
  severity: Severity.describe("How urgent this finding is."),
  file: z.string().describe("Path of the file the finding refers to, as it appears in the diff."),
  line: z.number().int().positive().optional().describe("1-based line number in the new file, when applicable."),
  title: z.string().describe("A short, one-line summary of the finding."),
  detail: z.string().describe("A clear explanation of the problem and why it matters."),
  suggestion: z.string().optional().describe("A concrete suggested fix, when one applies."),
};

export const Finding = z.object(FindingShape);
export type Finding = z.infer<typeof Finding>;

/**
 * Raw Zod shape for the whole review. This is the object passed to the SDK
 * `tool()` helper (which takes a raw shape, not a wrapped `z.object`), so it is
 * the single source of truth shared by the engine's `review` tool and the
 * `Review` object schema the CLI renders.
 */
export const ReviewShape = {
  summary: z.string().describe("A concise overall summary of the change and the review."),
  findings: z.array(Finding).describe("All findings, ordered most→least severe. May be empty when nothing is wrong."),
  verdict: Verdict.describe("The overall judgement: approve, comment, or request_changes."),
};

export const Review = z.object(ReviewShape);
export type Review = z.infer<typeof Review>;
