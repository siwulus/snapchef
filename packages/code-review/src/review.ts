import { z } from "zod";

/**
 * Severity of a single review finding, ordered most→least urgent.
 * The renderer groups and sorts findings by this rank.
 */
export const Severity = z.enum(["critical", "major", "minor", "nit"]);
export type Severity = z.infer<typeof Severity>;

/** Display order for severities (index = rank; lower = more urgent). */
export const SEVERITY_ORDER: readonly Severity[] = ["critical", "major", "minor", "nit"];

/**
 * The overall judgement on the diff. NOT emitted by the model — the engine derives it
 * in code from the per-area statuses (see {@link deriveVerdict}) so it provably tracks them.
 */
export const Verdict = z.enum(["approve", "comment", "request_changes"]);
export type Verdict = z.infer<typeof Verdict>;

/**
 * The concern areas a review covers. Each is examined as a focused, diff-answerable pass;
 * the reviewer reports a status for every one (see {@link Areas}) so coverage is explicit.
 */
export const ConcernArea = z.enum([
  "correctness",
  "error_handling",
  "security",
  "tests",
  "api_contract",
  "maintainability",
  "frontend",
]);
export type ConcernArea = z.infer<typeof ConcernArea>;

/** Display / iteration order for concern areas. */
export const CONCERN_ORDER: readonly ConcernArea[] = [
  "correctness",
  "error_handling",
  "security",
  "tests",
  "api_contract",
  "maintainability",
  "frontend",
];

/** Per-area coverage status. `not_applicable` is for a concern the diff doesn't touch. */
export const AreaStatus = z.enum(["ok", "concerns", "blocking", "not_applicable"]);
export type AreaStatus = z.infer<typeof AreaStatus>;

/** The reviewer's verdict on one concern area: a status plus a one-line rationale. */
export const AreaReview = z.object({
  status: AreaStatus.describe(
    "Coverage status for this concern: ok, concerns, blocking, or not_applicable. It is required.",
  ),
  rationale: z
    .string()
    .describe("One line explaining the status for this concern. It is required. Always return a rationale."),
});
export type AreaReview = z.infer<typeof AreaReview>;

/**
 * Coverage of every concern area — one required entry per concern. Modeling this as an
 * object with required keys (not an array) makes the derived JSON Schema force the model
 * to report each concern, so coverage cannot be silently skipped during generation.
 */
export const Areas = z.object({
  correctness: AreaReview,
  error_handling: AreaReview,
  security: AreaReview,
  tests: AreaReview,
  api_contract: AreaReview,
  maintainability: AreaReview,
  frontend: AreaReview,
});
export type Areas = z.infer<typeof Areas>;

/** A single review finding, tied to the concern area it belongs to. */
export const Finding = z.object({
  severity: Severity.describe("How urgent this finding is. It is required. Always return a severity."),
  category: ConcernArea.describe(
    "The concern area this finding belongs to. It is required. Always return a category.",
  ),
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
 * What the model emits: a concise summary, per-area coverage, and the findings. The verdict
 * is intentionally absent — the engine derives it from `areas` (see {@link deriveVerdict})
 * and assembles the final {@link Review}. The engine's structured-output JSON Schema is built
 * from this shape, so every concern key being required is what forces coverage at generation time.
 */
export const ReviewDraft = z.object({
  summary: z
    .string()
    .optional()
    .describe("A concise overall summary of the change and the review. It is required. Always return a summary."),
  areas: Areas.describe(
    "Coverage status for every concern area. It is required. Always return a status for every concern.",
  ),
  findings: z
    .array(Finding)
    .describe("All findings, ordered most→least severe. May be empty when nothing is wrong. It is required."),
});
export type ReviewDraft = z.infer<typeof ReviewDraft>;

/**
 * The full review: a {@link ReviewDraft} plus the code-derived verdict. This is the wire shape
 * the CLI renders and serializes (`--json`), and the contract the CI layer re-declares.
 */
export const Review = ReviewDraft.extend({
  verdict: Verdict.describe("The overall judgement, derived from the per-area statuses."),
});
export type Review = z.infer<typeof Review>;

/**
 * Derive the verdict from per-area coverage: any `blocking` area blocks the merge; otherwise
 * any `concerns` area is advisory (`comment`); otherwise the change is approved.
 */
export const deriveVerdict = (areas: Areas): Verdict => {
  const statuses = CONCERN_ORDER.map((concern) => areas[concern].status);
  if (statuses.includes("blocking")) return "request_changes";
  if (statuses.includes("concerns")) return "comment";
  return "approve";
};
