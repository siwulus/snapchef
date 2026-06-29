import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCredential } from "./cli.js";

// Mock the engine so the CLI guard paths never reach a real SDK call, and so we
// can assert the engine is not invoked when input validation short-circuits.
const engine = vi.hoisted(() => ({ runReview: vi.fn() }));
vi.mock("./engine.js", () => ({ runReview: engine.runReview }));

const { runCli } = await import("./cli.js");

// A clean review the mocked engine resolves with. Includes the full per-area
// coverage block the renderer now reads (every concern present).
const okReview = {
  summary: "ok",
  areas: {
    correctness: { status: "ok", rationale: "fine" },
    error_handling: { status: "ok", rationale: "fine" },
    security: { status: "ok", rationale: "fine" },
    tests: { status: "ok", rationale: "fine" },
    api_contract: { status: "ok", rationale: "fine" },
    maintainability: { status: "ok", rationale: "fine" },
    frontend: { status: "not_applicable", rationale: "no UI" },
  },
  findings: [],
  verdict: "approve",
};

describe("runCli", () => {
  beforeEach(() => {
    engine.runReview.mockReset();
  });

  it("errors on empty stdin with a clear message and does not call the engine", async () => {
    const result = await runCli({ argv: [], stdin: "   \n  ", credential: "token", defaultProjectRoot: "/repo" });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/no diff/i);
    expect(result.stdout).toBeUndefined();
    expect(engine.runReview).not.toHaveBeenCalled();
  });

  it("errors when no credential is set and does not call the engine", async () => {
    const result = await runCli({
      argv: [],
      stdin: "diff --git a/x b/x",
      credential: undefined,
      defaultProjectRoot: "/repo",
    });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/CLAUDE_CODE_OAUTH_TOKEN/);
    expect(engine.runReview).not.toHaveBeenCalled();
  });

  it("rejects unknown flags before doing any work", async () => {
    const result = await runCli({ argv: ["--bogus"], stdin: "diff", credential: "token", defaultProjectRoot: "/repo" });
    expect(result.code).not.toBe(0);
    expect(engine.runReview).not.toHaveBeenCalled();
  });

  it("passes the --model override to the engine and stays silent without --verbose", async () => {
    engine.runReview.mockResolvedValue(okReview);
    const log = vi.fn();
    const result = await runCli({
      argv: ["--model", "claude-opus-4-8"],
      stdin: "diff --git a/x b/x",
      credential: "token",
      defaultProjectRoot: "/repo",
      log,
    });
    expect(result.code).toBe(0);
    expect(engine.runReview).toHaveBeenCalledWith("diff --git a/x b/x", {
      model: "claude-opus-4-8",
      projectRoot: "/repo",
      log: undefined,
    });
    expect(result.stdout).toContain("approve");
  });

  it("forwards the log sink to the engine when --verbose is set", async () => {
    engine.runReview.mockResolvedValue(okReview);
    const log = vi.fn();
    await runCli({ argv: ["--verbose"], stdin: "diff --git a/x b/x", credential: "token", log, defaultProjectRoot: "/repo" });
    expect(engine.runReview).toHaveBeenCalledWith("diff --git a/x b/x", {
      model: expect.any(String),
      projectRoot: "/repo",
      log,
    });
  });

  it("accepts the -v short flag for verbose", async () => {
    engine.runReview.mockResolvedValue(okReview);
    const log = vi.fn();
    await runCli({ argv: ["-v"], stdin: "diff", credential: "token", log, defaultProjectRoot: "/repo" });
    expect(engine.runReview).toHaveBeenCalledWith("diff", expect.objectContaining({ log }));
  });

  it("defaults the project root to the injected repo root, and lets --project-root override it", async () => {
    engine.runReview.mockResolvedValue(okReview);
    await runCli({ argv: [], stdin: "diff", credential: "token", defaultProjectRoot: "/repo" });
    expect(engine.runReview).toHaveBeenCalledWith("diff", expect.objectContaining({ projectRoot: "/repo" }));

    engine.runReview.mockClear();
    await runCli({
      argv: ["--project-root", "/custom"],
      stdin: "diff",
      credential: "token",
      defaultProjectRoot: "/repo",
    });
    expect(engine.runReview).toHaveBeenCalledWith("diff", expect.objectContaining({ projectRoot: "/custom" }));
  });

  it("emits JSON when --json is set", async () => {
    engine.runReview.mockResolvedValue(okReview);
    const result = await runCli({ argv: ["--json"], stdin: "diff", credential: "token", defaultProjectRoot: "/repo" });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout ?? "")).toEqual(okReview);
  });

  it("tolerates the leading -- separator that pnpm forwards", async () => {
    engine.runReview.mockResolvedValue(okReview);
    const result = await runCli({ argv: ["--", "--json"], stdin: "diff", credential: "token", defaultProjectRoot: "/repo" });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout ?? "")).toEqual(okReview);
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
