import { type Review, SEVERITY_ORDER, type Severity } from "./review.js";

export interface RenderOptions {
  /** When true, emit the raw validated review as pretty JSON instead of text. */
  json: boolean;
}

/** Turn a validated {@link Review} into terminal output. Pure: returns a string. */
export const renderReview = (review: Review, opts: RenderOptions): string =>
  opts.json ? JSON.stringify(review, null, 2) : renderPretty(review);

const severityRank = (severity: Severity): number => SEVERITY_ORDER.indexOf(severity);

const renderPretty = (review: Review): string => {
  const header = [`Verdict: ${review.verdict}`, "", review.summary];

  if (review.findings.length === 0) {
    return [...header, "", "No findings."].join("\n");
  }

  const sorted = [...review.findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  const groups = SEVERITY_ORDER.flatMap((severity) => {
    const inGroup = sorted.filter((finding) => finding.severity === severity);
    if (inGroup.length === 0) return [];
    const items = inGroup.flatMap((finding) => {
      const location = finding.line !== undefined ? `${finding.file}:${finding.line}` : finding.file;
      const lines = [`  • ${location} — ${finding.title}`, `    ${finding.detail}`];
      return finding.suggestion !== undefined ? [...lines, `    suggestion: ${finding.suggestion}`] : lines;
    });
    return ["", `${severity.toUpperCase()} (${inGroup.length})`, ...items];
  });

  return [...header, ...groups].join("\n");
};
