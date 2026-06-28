/**
 * Parse a unified diff into the set of comment-able new-file line numbers per path.
 *
 * GitHub's `POST /pulls/{n}/reviews` is atomic: a single `(path, line)` that is
 * not part of a diff hunk rejects the **entire** review with HTTP 422. So before
 * posting any inline comment we validate its line against the map this builds.
 *
 * We allow both **added** (`+`) and **context** (` `) lines on the RIGHT side —
 * both exist in the new file and are valid review-comment targets. (If GitHub
 * 422s on context lines in practice, tighten {@link parseValidLines} to added-only.)
 */

/** Match a hunk header `@@ -a,b +c,d @@`; capture old count, new start, new count. */
const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Extract the new-file path from a `+++ ` header line.
 * Returns `undefined` for `/dev/null` (a deleted file has no new-file lines).
 */
const parseNewPath = (header: string): string | undefined => {
  // Drop the "+++ " prefix and any trailing `\t<timestamp>` some tools append.
  const raw = header.slice(4).split("\t")[0] ?? "";
  // git quotes paths containing spaces/unicode as `"b/some path"`; unquote first.
  const unquoted = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
  if (unquoted === "/dev/null") return undefined;
  // Strip the conventional `b/` source-prefix.
  return unquoted.startsWith("b/") ? unquoted.slice(2) : unquoted;
};

/**
 * Walk a unified diff and return `Map<path, Set<newLineNumber>>` of the lines on
 * which an inline review comment can be posted.
 *
 * Robustness: we track each hunk's remaining old/new line budget from its header,
 * so while inside a hunk body a line starting with `-`/`+` is unambiguously a
 * deletion/addition — never confused with a `---`/`+++` file header (a deleted
 * line of content like `---` would otherwise look like a header).
 */
export const parseValidLines = (diff: string): Map<string, Set<number>> => {
  const result = new Map<string, Set<number>>();
  let currentPath: string | undefined;
  let newLine = 0;
  let oldRemaining = 0;
  let newRemaining = 0;

  for (const line of diff.split("\n")) {
    const inHunk = oldRemaining > 0 || newRemaining > 0;

    if (!inHunk) {
      if (line.startsWith("+++ ")) {
        currentPath = parseNewPath(line);
      } else {
        const match = HUNK_HEADER.exec(line);
        if (match) {
          newLine = Number(match[2]);
          oldRemaining = match[1] !== undefined ? Number(match[1]) : 1;
          newRemaining = match[3] !== undefined ? Number(match[3]) : 1;
        }
      }
      // Everything else outside a hunk (`diff --git`, `index`, `--- `, "new file
      // mode", blank separators) carries no comment-able line — skip it.
      continue;
    }

    // Inside a hunk body. The "\ No newline at end of file" marker consumes no budget.
    if (line.startsWith("\\")) continue;

    const marker = line.charAt(0);
    if (marker === "+") {
      if (currentPath !== undefined) {
        const set = result.get(currentPath) ?? new Set<number>();
        set.add(newLine);
        result.set(currentPath, set);
      }
      newLine += 1;
      newRemaining -= 1;
    } else if (marker === "-") {
      oldRemaining -= 1;
    } else {
      // Context line (leading space) — or a defensively-handled empty line. Exists
      // in both files: record it as a valid RIGHT-side target and advance both.
      if (currentPath !== undefined) {
        const set = result.get(currentPath) ?? new Set<number>();
        set.add(newLine);
        result.set(currentPath, set);
      }
      newLine += 1;
      newRemaining -= 1;
      oldRemaining -= 1;
    }
  }

  return result;
};
