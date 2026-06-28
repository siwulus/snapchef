import { z } from "zod";

/**
 * Local re-declaration of the `packages/code-review` wire contract. This module
 * is a **separate** workspace member that deliberately does not import the
 * package (the plan keeps the package's source/CLI untouched and independent).
 * It validates the package's `--json` output (`JSON.stringify(review)`) at the
 * boundary in {@link parseReview} so a contract drift fails loudly here.
 */
export const Severity = z.enum(["critical", "major", "minor", "nit"]);
export type Severity = z.infer<typeof Severity>;

/** Display order for severities (index = rank; lower = more urgent). */
export const SEVERITY_ORDER: readonly Severity[] = ["critical", "major", "minor", "nit"];

export const Verdict = z.enum(["approve", "comment", "request_changes"]);
export type Verdict = z.infer<typeof Verdict>;

export const Finding = z.object({
  severity: Severity,
  file: z.string(),
  line: z.number().optional(),
  title: z.string(),
  detail: z.string(),
  suggestion: z.string().optional(),
});
export type Finding = z.infer<typeof Finding>;

export const Review = z.object({
  summary: z.string().optional(),
  findings: z.array(Finding),
  verdict: Verdict,
});
export type Review = z.infer<typeof Review>;

/** Parse + validate the package's `--json` output. Throws on contract drift. */
export const parseReview = (json: string): Review => Review.parse(JSON.parse(json));

/** The gate outcome: the commit-status state and its mirror label. */
export interface Gate {
  state: "success" | "failure";
  label: "cr:pass" | "cr:fail";
}

/**
 * Map a verdict to the merge gate. Only `request_changes` blocks; advisory
 * `comment` and `approve` both pass (treating `comment` as mergeable advice).
 */
export const verdictToGate = (verdict: Verdict): Gate =>
  verdict === "request_changes" ? { state: "failure", label: "cr:fail" } : { state: "success", label: "cr:pass" };

/** A single inline review comment, ready for `POST /pulls/{n}/reviews`. */
export interface InlineComment {
  path: string;
  line: number;
  side: "RIGHT";
  body: string;
}

/** The complete plan the workflow's github-script step applies to the PR. */
export interface PostPlan {
  state: "success" | "failure";
  label: "cr:pass" | "cr:fail";
  /** Top-level body of the one PR Review (event: COMMENT). Always non-empty. */
  reviewBody: string;
  /** Diff-validated inline comments (capped). */
  comments: InlineComment[];
  /** The sticky issue-comment body (verdict + summary + roll-up). */
  stickyBody: string;
}

export interface BuildOptions {
  /** Max inline comments before overflow rolls into the sticky summary. */
  maxInline?: number;
}

/** HTML marker that identifies the bot's sticky issue comment for upsert/dedup. */
export const STICKY_MARKER = "<!-- code-review-bot -->";
/** Per-comment marker that identifies the bot's inline comments for dedup on re-run. */
export const INLINE_MARKER = "<!-- crb-inline -->";

const DEFAULT_MAX_INLINE = 30;

const severityRank = (severity: Severity): number => SEVERITY_ORDER.indexOf(severity);

const bySeverity = (a: Finding, b: Finding): number => severityRank(a.severity) - severityRank(b.severity);

const location = (finding: Finding): string =>
  finding.line !== undefined ? `${finding.file}:${finding.line}` : finding.file;

/** Body of a single inline review comment (carries the dedup marker). */
const renderInlineBody = (finding: Finding): string => {
  const lines = [`**[${finding.severity.toUpperCase()}] ${finding.title}**`, "", finding.detail];
  if (finding.suggestion !== undefined) lines.push("", `**Suggestion:** ${finding.suggestion}`);
  lines.push("", INLINE_MARKER);
  return lines.join("\n");
};

/** One bullet for a finding rolled into the sticky summary. */
const renderSummaryItem = (finding: Finding): string => {
  const head = `- **[${finding.severity.toUpperCase()}]** \`${location(finding)}\` — ${finding.title}`;
  const detail = `  ${finding.detail}`;
  return finding.suggestion !== undefined ? [head, detail, `  _Suggestion:_ ${finding.suggestion}`].join("\n") : [head, detail].join("\n");
};

const renderStickyBody = (review: Review, summaryFindings: Finding[], inlineCount: number): string => {
  const parts = [STICKY_MARKER, "## Code review summary", "", `**Verdict:** \`${review.verdict}\``];
  if (review.summary !== undefined && review.summary.trim().length > 0) {
    parts.push("", review.summary.trim());
  }
  if (summaryFindings.length > 0) {
    parts.push("", "### Additional findings", "", ...summaryFindings.map(renderSummaryItem));
  } else if (inlineCount > 0) {
    parts.push("", `_All ${inlineCount} finding(s) posted as inline comments._`);
  } else {
    parts.push("", "_No findings._");
  }
  return parts.join("\n");
};

/**
 * Turn a validated `Review` + the diff's valid-line map into the GitHub post plan.
 *
 * A finding is **inline** iff it has a `line` present in `validLines.get(file)`.
 * Inline-eligible findings are ordered by severity and capped at `maxInline`;
 * everything non-inline (line-less, out-of-diff, or beyond the cap) rolls into
 * the sticky summary so nothing is silently dropped.
 */
export const buildPostPlan = (
  review: Review,
  validLines: Map<string, Set<number>>,
  opts: BuildOptions = {},
): PostPlan => {
  const maxInline = opts.maxInline ?? DEFAULT_MAX_INLINE;
  const gate = verdictToGate(review.verdict);

  const inlineEligible = review.findings
    .filter((finding) => finding.line !== undefined && (validLines.get(finding.file)?.has(finding.line) ?? false))
    .sort(bySeverity);
  const inline = inlineEligible.slice(0, maxInline);
  const inlineSet = new Set(inline);

  // Non-inline = line-less + out-of-diff + overflow beyond the cap.
  const summaryFindings = review.findings.filter((finding) => !inlineSet.has(finding)).sort(bySeverity);

  const comments: InlineComment[] = inline.map((finding) => ({
    path: finding.file,
    // line is guaranteed defined: inlineEligible filtered on it.
    line: finding.line as number,
    side: "RIGHT",
    body: renderInlineBody(finding),
  }));

  const reviewBody = `Automated code review — verdict: \`${review.verdict}\`. ${comments.length} inline comment(s); see the summary comment for the full overview.`;

  return {
    state: gate.state,
    label: gate.label,
    reviewBody,
    comments,
    stickyBody: renderStickyBody(review, summaryFindings, comments.length),
  };
};
