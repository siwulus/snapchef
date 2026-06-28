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
export const Finding = z.object({
  severity: Severity.describe("How urgent this finding is. It is required. Always return a severity."),
  file: z
    .string()
    .describe(
      "Path of the file the finding refers to, as it appears in the diff. It is required. Always return a file.",
    ),
  line: z
    .number()
    .optional()
    .describe("1-based line number in the new file, when applicable. It is optional. May be empty."),
  title: z.string().describe("A short, one-line summary of the finding. It is required. Always return a title."),
  detail: z
    .string()
    .describe("A clear explanation of the problem and why it matters. It is required. Always return a detail."),
  suggestion: z
    .string()
    .optional()
    .describe("A concrete suggested fix, when one applies. It is optional. May be empty."),
});

export type Finding = z.infer<typeof Finding>;

/**
 * Raw Zod shape for the whole review. It is the single source of truth from which
 * the `Review` object schema below is derived; the engine turns `Review` into the
 * JSON Schema it hands to the SDK's `outputFormat`, and the CLI renders the parsed
 * `Review`.
 */
export const Review = z.object({
  summary: z
    .string()
    .optional()
    .describe("A concise overall summary of the change and the review. It is required. Always return a summary."),
  findings: z
    .array(Finding)
    .describe(
      "All findings, ordered most→least severe. May be empty when nothing is wrong. It is required. Always return a findings array. Always return a non-empty findings array.",
    ),
  verdict: Verdict.describe(
    "The overall judgement: approve, comment, or request_changes. It is required. Always return a verdict.",
  ),
});

export type Review = z.infer<typeof Review>;
