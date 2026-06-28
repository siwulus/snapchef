import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCredential } from "./cli.js";

// Mock the engine so the CLI guard paths never reach a real SDK call, and so we
// can assert the engine is not invoked when input validation short-circuits.
const engine = vi.hoisted(() => ({ runReview: vi.fn() }));
vi.mock("./engine.js", () => ({ runReview: engine.runReview }));

const { runCli } = await import("./cli.js");

describe("runCli", () => {
  beforeEach(() => {
    engine.runReview.mockReset();
  });

  it("errors on empty stdin with a clear message and does not call the engine", async () => {
    const result = await runCli({ argv: [], stdin: "   \n  ", credential: "token" });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/no diff/i);
    expect(result.stdout).toBeUndefined();
    expect(engine.runReview).not.toHaveBeenCalled();
  });

  it("errors when no credential is set and does not call the engine", async () => {
    const result = await runCli({ argv: [], stdin: "diff --git a/x b/x", credential: undefined });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/CLAUDE_CODE_OAUTH_TOKEN/);
    expect(engine.runReview).not.toHaveBeenCalled();
  });

  it("rejects unknown flags before doing any work", async () => {
    const result = await runCli({ argv: ["--bogus"], stdin: "diff", credential: "token" });
    expect(result.code).not.toBe(0);
    expect(engine.runReview).not.toHaveBeenCalled();
  });

  it("passes the --model override to the engine and renders the review", async () => {
    engine.runReview.mockResolvedValue({ summary: "ok", findings: [], verdict: "approve" });
    const result = await runCli({
      argv: ["--model", "claude-opus-4-8"],
      stdin: "diff --git a/x b/x",
      credential: "token",
    });
    expect(result.code).toBe(0);
    expect(engine.runReview).toHaveBeenCalledWith("diff --git a/x b/x", { model: "claude-opus-4-8" });
    expect(result.stdout).toContain("approve");
  });

  it("emits JSON when --json is set", async () => {
    engine.runReview.mockResolvedValue({ summary: "ok", findings: [], verdict: "approve" });
    const result = await runCli({ argv: ["--json"], stdin: "diff", credential: "token" });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout ?? "")).toEqual({ summary: "ok", findings: [], verdict: "approve" });
  });
});

describe("resolveCredential", () => {
  it("prefers the subscription OAuth token over the standalone API key", () => {
    expect(resolveCredential({ CLAUDE_CODE_OAUTH_TOKEN: "oauth", ANTHROPIC_API_KEY: "apikey" })).toBe("oauth");
  });

  it("falls back to ANTHROPIC_API_KEY when no OAuth token is set", () => {
    expect(resolveCredential({ ANTHROPIC_API_KEY: "apikey" })).toBe("apikey");
  });

  it("ignores blank values and returns undefined when nothing usable is set", () => {
    expect(resolveCredential({ CLAUDE_CODE_OAUTH_TOKEN: "   " })).toBeUndefined();
    expect(resolveCredential({})).toBeUndefined();
  });
});
