import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseValidLines } from "./diff.js";

describe("parseValidLines", () => {
  it("records added and context lines in a single hunk", () => {
    const diff = [
      "diff --git a/src/foo.ts b/src/foo.ts",
      "index 1111111..2222222 100644",
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "@@ -1,3 +1,4 @@",
      " const a = 1;",
      "-const b = 2;",
      "+const b = 3;",
      "+const c = 4;",
      " export { a, b };",
    ].join("\n");

    const map = parseValidLines(diff);
    expect([...(map.get("src/foo.ts") ?? [])].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it("handles a header with omitted line counts (@@ -5 +5 @@)", () => {
    const diff = ["--- a/x.ts", "+++ b/x.ts", "@@ -5 +5 @@", "-old", "+new"].join("\n");
    expect([...(parseValidLines(diff).get("x.ts") ?? [])]).toEqual([5]);
  });

  it("tracks new-file line numbers across multiple hunks", () => {
    const diff = [
      "--- a/multi.ts",
      "+++ b/multi.ts",
      "@@ -1,2 +1,3 @@",
      " a",
      "+b",
      " c",
      "@@ -10,2 +11,3 @@",
      " x",
      "+y",
      " z",
    ].join("\n");
    expect([...(parseValidLines(diff).get("multi.ts") ?? [])].sort((a, b) => a - b)).toEqual([1, 2, 3, 11, 12, 13]);
  });

  it("keeps separate maps for multiple files", () => {
    const diff = [
      "--- a/one.ts",
      "+++ b/one.ts",
      "@@ -1 +1,2 @@",
      " keep",
      "+added",
      "--- a/two.ts",
      "+++ b/two.ts",
      "@@ -1 +1,2 @@",
      " keep2",
      "+added2",
    ].join("\n");
    const map = parseValidLines(diff);
    expect([...(map.get("one.ts") ?? [])].sort((a, b) => a - b)).toEqual([1, 2]);
    expect([...(map.get("two.ts") ?? [])].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("handles an added file (--- /dev/null)", () => {
    const diff = [
      "diff --git a/new.ts b/new.ts",
      "new file mode 100644",
      "index 0000000..abcdef0",
      "--- /dev/null",
      "+++ b/new.ts",
      "@@ -0,0 +1,2 @@",
      "+line one",
      "+line two",
    ].join("\n");
    expect([...(parseValidLines(diff).get("new.ts") ?? [])].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("yields no entries for a deleted file (+++ /dev/null)", () => {
    const diff = [
      "diff --git a/gone.ts b/gone.ts",
      "deleted file mode 100644",
      "index abcdef0..0000000",
      "--- a/gone.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-line one",
      "-line two",
    ].join("\n");
    const map = parseValidLines(diff);
    expect(map.has("gone.ts")).toBe(false);
    expect(map.size).toBe(0);
  });

  it("maps a renamed file to its new path", () => {
    const diff = [
      "diff --git a/old.ts b/new.ts",
      "similarity index 90%",
      "rename from old.ts",
      "rename to new.ts",
      "index aaaaaaa..bbbbbbb 100644",
      "--- a/old.ts",
      "+++ b/new.ts",
      "@@ -1,2 +1,2 @@",
      " keep",
      "-old line",
      "+new line",
    ].join("\n");
    const map = parseValidLines(diff);
    expect(map.has("old.ts")).toBe(false);
    expect([...(map.get("new.ts") ?? [])].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("does not confuse deleted/added content that looks like diff headers", () => {
    // A deleted line of content `--` renders as `---`; an added `++` as `+++`.
    // Count-tracking keeps these classified as body lines, not file headers.
    const diff = ["--- a/doc.md", "+++ b/doc.md", "@@ -1,3 +1,3 @@", " alpha", "---", "+++", " omega"].join("\n");
    expect([...(parseValidLines(diff).get("doc.md") ?? [])].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("ignores the \\ No newline at end of file marker", () => {
    const diff = [
      "--- a/nn.ts",
      "+++ b/nn.ts",
      "@@ -1,2 +1,2 @@",
      " line one",
      "-line two",
      "\\ No newline at end of file",
      "+line two changed",
      "\\ No newline at end of file",
    ].join("\n");
    expect([...(parseValidLines(diff).get("nn.ts") ?? [])].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("returns an empty map for an empty diff", () => {
    expect(parseValidLines("").size).toBe(0);
  });

  it("parses the multi-file sample fixture", () => {
    const diff = readFileSync(new URL("./__fixtures__/sample.diff", import.meta.url), "utf8");
    const map = parseValidLines(diff);
    expect([...(map.get("src/foo.ts") ?? [])].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect([...(map.get("src/bar.ts") ?? [])].sort((a, b) => a - b)).toEqual([1, 2]);
  });
});
