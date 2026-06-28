import { readFileSync, writeFileSync } from "node:fs";
import { parseValidLines } from "./diff.js";
import { buildPostPlan, parseReview } from "./plan.js";

/**
 * Thin CLI the workflow invokes between the reviewer package and the GitHub I/O
 * step. Reads the PR diff + the package's `review.json`, writes the `PostPlan` as
 * JSON. Pure I/O over the pure functions — no network, no GitHub.
 *
 *   tsx src/index.ts <pr.diff> <review.json> <out.json> [maxInline]
 */
const main = (): void => {
  const [diffPath, reviewPath, outPath, maxInlineArg] = process.argv.slice(2);
  if (diffPath === undefined || reviewPath === undefined || outPath === undefined) {
    process.stderr.write("Usage: tsx src/index.ts <pr.diff> <review.json> <out.json> [maxInline]\n");
    process.exitCode = 2;
    return;
  }

  const diff = readFileSync(diffPath, "utf8");
  const review = parseReview(readFileSync(reviewPath, "utf8"));
  const validLines = parseValidLines(diff);

  const maxInline = maxInlineArg !== undefined ? Number(maxInlineArg) : undefined;
  const plan = buildPostPlan(review, validLines, maxInline !== undefined ? { maxInline } : {});

  writeFileSync(outPath, JSON.stringify(plan, null, 2));
};

main();
