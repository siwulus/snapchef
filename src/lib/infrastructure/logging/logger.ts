import { LOG_HTTP_BODIES, LOG_LEVEL } from "astro:env/server";
import { Effect, Layer, Logger, LogLevel, ManagedRuntime } from "effect";
import { match } from "ts-pattern";

/**
 * Map the `LOG_LEVEL` env string (an Effect `LogLevel` literal label) to a `LogLevel`.
 * Unknown values fall back to `Info` so a typo never silences logging.
 */
export const levelFromEnv = (label: string): LogLevel.LogLevel =>
  match(label)
    .with("All", () => LogLevel.All)
    .with("Trace", () => LogLevel.Trace)
    .with("Debug", () => LogLevel.Debug)
    .with("Info", () => LogLevel.Info)
    .with("Warning", () => LogLevel.Warning)
    .with("Error", () => LogLevel.Error)
    .with("Fatal", () => LogLevel.Fatal)
    .with("None", () => LogLevel.None)
    .otherwise(() => LogLevel.Info);

/**
 * Production logger: render each entry as a single JSON line via `console.log`.
 * `console.*` is the only durable sink on Cloudflare `workerd`; Workers Logs
 * auto-indexes the JSON fields (message / logLevel / annotations / spans).
 */
export const jsonConsoleLogger = Logger.map(Logger.structuredLogger, (structured) => {
  // console.* is the only durable log sink on Cloudflare workerd
  globalThis.console.log(JSON.stringify(structured));
});

/** Build the logger Layer for a given mode + minimum level. Exported so tests can pin prod output. */
export const makeLoggerLayer = (mode: "production" | "development", level: LogLevel.LogLevel): Layer.Layer<never> =>
  Layer.merge(
    mode === "production" ? Logger.replace(Logger.defaultLogger, jsonConsoleLogger) : Logger.pretty,
    Logger.minimumLogLevel(level),
  );

/** The single logger definition: prod JSON-to-console / dev pretty, level from `LOG_LEVEL`. */
export const LoggerLive: Layer.Layer<never> = makeLoggerLayer(
  import.meta.env.PROD ? "production" : "development",
  levelFromEnv(LOG_LEVEL),
);

/** Built once at module scope so the logger Layer is not rebuilt per request. */
const runtime = ManagedRuntime.make(LoggerLive);

/** Run an Effect to a Promise with `LoggerLive` provided — the shared edge for every `runPromise`. */
export const runWithLogging = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => runtime.runPromise(effect);

/** Whether request/response JSON bodies should be logged (off by default; never for multipart/binary). */
export const shouldLogBodies: boolean = LOG_HTTP_BODIES;
