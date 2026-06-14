import { Effect, Either, Layer, Logger, LogLevel } from "effect";
import { describe, expect, it } from "vitest";
import { logResult, logStep } from "./effect";

interface StructuredLog {
  message: unknown;
  logLevel: string;
  spans: Record<string, number>;
}

const labelOf = (log: StructuredLog): unknown => (Array.isArray(log.message) ? log.message[0] : log.message);

// Run an effect under a capturing structured logger, returning both the Either result
// (so failures don't reject) and the structured log entries emitted during the run.
const runWithCapture = <A, E>(
  eff: Effect.Effect<A, E>,
): Promise<{ result: Either.Either<A, E>; logs: StructuredLog[] }> => {
  const logs: StructuredLog[] = [];
  const layer = Layer.merge(
    Logger.replace(
      Logger.defaultLogger,
      Logger.map(Logger.structuredLogger, (structured) => {
        logs.push(structured);
      }),
    ),
    Logger.minimumLogLevel(LogLevel.All),
  );
  return Effect.runPromise(
    Effect.either(eff).pipe(
      Effect.provide(layer),
      Effect.map((result) => ({ result, logs })),
    ),
  );
};

describe("logStep", () => {
  it("passes the success value through unchanged and emits the label", async () => {
    const { result, logs } = await runWithCapture(Effect.succeed(42).pipe(logStep("step")));
    expect(Either.isRight(result) && result.right).toBe(42);
    expect(logs.map(labelOf)).toContain("step");
  });

  it("propagates failures unchanged", async () => {
    const { result } = await runWithCapture(Effect.fail("boom").pipe(logStep("step")));
    expect(Either.isLeft(result) && result.left).toBe("boom");
  });
});

describe("logResult", () => {
  it("passes success through, logs label.ok and records a span for the label", async () => {
    const { result, logs } = await runWithCapture(Effect.succeed("value").pipe(logResult("res")));
    expect(Either.isRight(result) && result.right).toBe("value");

    const okLog = logs.find((log) => labelOf(log) === "res.ok");
    expect(okLog).toBeDefined();
    expect(okLog?.spans).toHaveProperty("res");
  });

  it("propagates failure unchanged and logs label.fail", async () => {
    const { result, logs } = await runWithCapture(Effect.fail("nope").pipe(logResult("res")));
    expect(Either.isLeft(result) && result.left).toBe("nope");

    const failLog = logs.find((log) => labelOf(log) === "res.fail");
    expect(failLog).toBeDefined();
    expect(failLog?.logLevel).toBe("ERROR");
  });
});
