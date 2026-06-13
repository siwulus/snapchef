import { Effect, LogLevel } from "effect";
import { describe, expect, it, vi } from "vitest";
import { levelFromEnv, makeLoggerLayer } from "./logger";

describe("levelFromEnv", () => {
  it("maps known labels to their LogLevel", () => {
    expect(levelFromEnv("Debug")).toBe(LogLevel.Debug);
    expect(levelFromEnv("Warning")).toBe(LogLevel.Warning);
    expect(levelFromEnv("Fatal")).toBe(LogLevel.Fatal);
  });

  it("falls back to Info for unknown values", () => {
    expect(levelFromEnv("nonsense")).toBe(LogLevel.Info);
    expect(levelFromEnv("")).toBe(LogLevel.Info);
  });
});

describe("production logger output", () => {
  it("emits a single JSON line carrying message, logLevel, annotations and spans", async () => {
    const spy = vi.spyOn(globalThis.console, "log").mockImplementation(() => undefined);
    try {
      await Effect.runPromise(
        Effect.logInfo("api.error", { detail: 1 }).pipe(
          Effect.annotateLogs({ userId: "u1" }),
          Effect.withLogSpan("http"),
          Effect.provide(makeLoggerLayer("production", LogLevel.All)),
        ),
      );

      expect(spy).toHaveBeenCalledTimes(1);
      const line: unknown = spy.mock.calls[0]?.[0];
      expect(typeof line).toBe("string");

      const parsed = JSON.parse(line as string) as Record<string, unknown>;
      expect(parsed).toHaveProperty("message");
      expect(parsed).toHaveProperty("logLevel", "INFO");
      expect(parsed.annotations).toMatchObject({ userId: "u1" });
      expect(parsed.spans).toHaveProperty("http");
    } finally {
      spy.mockRestore();
    }
  });
});
