import { describe, expect, it } from "vitest";
import { CliOptions, DEFAULT_MODEL } from "./options.js";

describe("CliOptions schema", () => {
  it("applies documented defaults when nothing is supplied", () => {
    const parsed = CliOptions.parse({});
    expect(parsed).toEqual({ json: false, model: DEFAULT_MODEL, verbose: false });
    expect(DEFAULT_MODEL).toBe("claude-sonnet-4-6");
  });

  it("honors explicit values", () => {
    const parsed = CliOptions.parse({ json: true, model: "claude-opus-4-8", verbose: true });
    expect(parsed).toEqual({ json: true, model: "claude-opus-4-8", verbose: true });
  });

  it("rejects an empty model string", () => {
    expect(() => CliOptions.parse({ model: "" })).toThrow();
  });
});
