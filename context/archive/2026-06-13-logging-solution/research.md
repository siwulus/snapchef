---
date: 2026-06-13T21:40:37+0200
researcher: siwulus
git_commit: 327ebf8a21a8947484b7bb2c4b2e1c0e171e2176
branch: chore/migrate-to-pnpm
repository: snapchef
topic: "Logging solution for the documented tech stack (Cloudflare Workers + Effect-TS)"
tags: [research, logging, effect-ts, cloudflare-workers, observability]
status: complete
last_updated: 2026-06-13
last_updated_by: siwulus
---

# Research: Logging solution for the documented tech stack

**Date**: 2026-06-13T21:40:37+0200
**Researcher**: siwulus
**Git Commit**: 327ebf8a21a8947484b7bb2c4b2e1c0e171e2176
**Branch**: chore/migrate-to-pnpm
**Repository**: snapchef

## Research Question

Based on the documented tech stack, propose the best solution for logging. On the server side we need, at the beginning:

- basic request/response logs + processing time,
- error logs,
- a solution for logging processing results that can be plugged into Effect.js pipelines.

Research the best options for the selected technologies/libraries, present them, and give pros and cons.

**Scoping decisions made before research** (`AskUserQuestion`):

- **No external/SaaS log providers** — not Logpush, Sentry, Axiom, Datadog, Better Stack. The user wants an in-application logging library "like Winston" that emits to console or file.
- **Library/abstraction layer decision is deferred** until this research presents the realistic options.

## Summary

The single load-bearing fact reshapes the whole question: **production runs on Cloudflare `workerd`, which has no durable filesystem.** "Log to a file" works on your laptop (Node/Vite dev) and _silently no-ops in the deployed Worker_ — `node:fs` under `nodejs_compat` writes to a per-request, in-memory buffer that is discarded when the request ends. Cloudflare's supported sink is `console.*`, which it captures into Workers Logs / `wrangler tail`; their explicit best practice is **structured JSON to `console.log`**, which they auto-index by field.

That kills the "Winston with a file transport" framing on the edge and reframes the real question to: _which logging abstraction emits structured JSON to console and plugs into Effect pipelines?_

**Recommendation: use Effect-TS's own built-in logger — no new dependency.** Effect (`effect@^3.21.2`, already a core dep) ships `Logger.json` / `Logger.pretty` / `Logger.structured`, all of which write exclusively through `globalThis.console.*` (no `fs`, no Node streams, no worker threads → workerd-safe by construction). It natively covers all three requirements:

1. **request/response + processing time** → a thin wrapper around `runApiRoute` (the single `Effect.runPromise` exit) using `Effect.withLogSpan` for elapsed time and `Effect.annotateLogs` for request context;
2. **error logs** → `Effect.tapErrorCause` at the same edge (catches typed `SnapchefServerError` _and_ defects), feeding the existing error→HTTP mapper unchanged;
3. **processing-result logging in pipelines** → reusable `Effect.tap`/`tapBoth` combinators (`logStep`/`logResult`) that drop into any `.pipe(...)` chain — the codebase's mandated style.

Every evaluated third-party library is either broken on workerd (Winston file transport, tslog `navigator` crash), a shadow of itself (pino loses transports + its performance story, usable only as `pino/browser`), or adds a dependency to reach an output Effect already emits natively (consola, loglevel). The only situational add is **consola** if you specifically want its pretty dev formatting — but Effect's `Logger.pretty` already covers dev.

## Detailed Findings

### A. The runtime reality (this drives every other decision)

Verified against current (2025–2026) Cloudflare docs by the workerd-assessment agent:

1. **No durable filesystem at request runtime.** With `nodejs_compat` + compat date ≥ `2025-09-01`, `node:fs` exists but is a _virtual, in-memory, per-request_ fs. Cloudflare's docs: files in `/tmp` "will not be available in other concurrent or subsequent requests" and are "not persisted across Worker restarts or deployments." `fs.watch`/glob are unimplemented. → A file transport in a deployed Worker writes to a buffer that is thrown away. It fails _silently_, which is worse than failing loudly.
2. **`console.*` IS the production sink.** Cloudflare captures `console.log`/`console.error` into Workers Logs and `wrangler tail`. Official best practice: _"log in JSON format. Workers Logs automatically extracts the fields and indexes them."_
3. **Dev-vs-prod split is real and a trap.** Local Astro dev runs under Node/Vite where real `fs` works → a file logger _looks_ healthy locally and produces _zero_ durable logs in prod.
4. **Worker-thread transports cannot run.** pino's maintainer (Matteo Collina, workerd discussion #3423): _"pino transports make no sense in workerd because in workerd executions are short lived."_ Same for `pino-pretty` and streaming `winston-transport`s.

This project's config already matches the supported path — `wrangler.jsonc`: `"compatibility_flags": ["nodejs_compat"]` and `"observability": { "enabled": true }` (Workers Logs on, capturing `console.*`).

### B. Current code seams — where logging plugs in

The codebase is **logging-dark**: a single statement exists today.

- **`src/middleware.ts:48`** — the only existing log: `Effect.tapError((error) => Effect.logError("getUser failed during setUserInContext", error))`. So Effect's logger is already (implicitly) the house logger.
- **`src/lib/infrastructure/api/index.ts:56-63`** — `runApiRoute`, the single `Effect.runPromise` exit for every API route. This is the seam for request/response logging, timing, and error logging:
  ```ts
  export const runApiRoute = <T>(effect: Effect.Effect<T, SnapchefServerError>): Promise<Response> =>
    effect.pipe(
      Effect.map(toSuccessResponsePayload),
      Effect.flatMap(successPayloadToResponse),
      Effect.catchAll((error) => errorPayloadToResponse(toErrorResponsePayload(error))),
      Effect.catchAllDefect(defectToResponse),
      Effect.runPromise,
    );
  ```
  The error mapper `toErrorResponsePayload` (`index.ts:22-31`) reads `error.code` directly as HTTP status; `defectToResponse` (`index.ts:51-54`) is the `SnapchefUnexpectedError` fallback. A `tapErrorCause` + a logger Layer via `Effect.provide` slot in here without touching the mapper.
- **`src/middleware.ts:15-19`** — `onRequest` (`injectDependencies` → `setUserInContext` → `checkProtectedRoutes`). Candidate seam for whole-request timing and method/path/status logs. `injectDependencies` (`:21-33`) is the composition root where a logger could be injected onto `App.Locals`.
- **`src/env.d.ts:5-13`** — `App.Locals` (`authenticator`, `recipeSessions`, `user`). No logger declared yet; a logger could be added here if request-scoped annotations (requestId/userId) are wanted in UC code — though the simpler path keeps logging at the edge.
- **UC pipeline shapes** the result-logging combinator must fit (pipe-first, `Effect.tap`/`flatMap`/`map`):
  - `src/lib/core/uc/recipe/RecipeSessionUC.ts:29-35` (`attachPhotos`), `:40-50` (`recognizeProducts`), `:98-113` (`recognizeAllPhotos` with `Effect.forEach` `{concurrency:5}`, `Effect.timeout("25 seconds")`, `Effect.retry`).
  - `src/lib/core/uc/auth/AuthenticatorUC.ts:9-23` (thin pass-throughs over the `Authenticator` port).
  - `src/lib/infrastructure/llm/openrouter.ts:72-92` (`completeStructured`) — the highest-value place to log latency + outcome.
- **Shared Effect utils** where a logging helper would naturally live: **`src/lib/utils/effect.ts`** — holds `decodeWith`, `tryErrorData`, `tryErrorDataOption`, `tryErrorDataWithSchema`, `getOrThrowNotFound`. (Note: the conventions docs reference a `supabase-effect.ts`; in the live code these helpers actually live in `utils/effect.ts`.)

### C. Effect-TS native logging (verified against `effect@3.21.2`)

All log combinators return `Effect<void, never, never>` — they never fail, add no requirements, and drop into any pipeline.

**Requirement 1 — request/response + processing time.** `Effect.withLogSpan(label)` records elapsed wall-clock; every log emitted inside the span gets a `label=<ms>ms` annotation automatically (and a `spans: Record<string,number>` field in JSON output). You do _not_ compute elapsed time manually. `Effect.annotateLogs({...})` attaches request context (method, path, requestId, userId) as structured fields.

```ts
// Wrap the route effect once, at runApiRoute
effect.pipe(
  Effect.tap((data) => Effect.logInfo("request.ok")),
  Effect.tapErrorCause((cause) => Effect.logError("request.fail", cause)),
  Effect.withLogSpan("http"), // -> http=<ms>ms on every line
  Effect.annotateLogs({ method, path, requestId }), // -> structured fields
);
```

**Requirement 2 — error logs.** `Effect.tapErrorCause` logs the full `Cause` (typed `SnapchefServerError` failures _and_ unexpected defects) while passing the failure through untouched, so `runApiRoute`'s existing error→HTTP mapper still receives the typed error. `tapError` alone misses defects; `tapDefect` isolates bugs for `logFatal`.

**Requirement 3 — result logging in pipelines.** Reusable, typed, pipe-ready combinators (the requested "pluggable into Effect pipelines" piece):

```ts
const logStep =
  (label: string) =>
  <A, E, R>(eff: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    eff.pipe(Effect.tap((a) => Effect.logInfo(label, a)));

const logResult =
  (label: string) =>
  <A, E, R>(eff: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    eff.pipe(
      Effect.tapBoth({
        onSuccess: (a) => Effect.logInfo(`${label}.ok`, a),
        onFailure: (e) => Effect.logError(`${label}.fail`, e),
      }),
      Effect.withLogSpan(label), // adds `label=<ms>ms`
    );

// usage, drops straight into an existing pipeline:
recipeSessions.recognizeProducts(userId, id).pipe(logResult("recognize"));
```

**Custom JSON-to-console logger + dev/prod switch** (the production transport):

```ts
import { Effect, Logger, LogLevel, Config, Layer } from "effect";

// prod: structured object -> one JSON line to console (workerd-safe, Workers-Logs-indexable)
const jsonConsoleLogger = Logger.map(Logger.structuredLogger, (s) => globalThis.console.log(JSON.stringify(s)));
const ProdLoggerLive = Logger.replace(Logger.defaultLogger, jsonConsoleLogger);
// dev: colorized human output
const DevLoggerLive = Logger.pretty;

export const LoggerLive = (env: "production" | "development") =>
  env === "production" ? ProdLoggerLive : DevLoggerLive;

// minimum level from env, as a Layer
const LogLevelLive = Config.logLevel("LOG_LEVEL").pipe(Effect.map(Logger.minimumLogLevel), Layer.unwrapEffect);
```

(`Logger.json` is the built-in shortcut if you don't need the custom transform.)

**Installing at the per-invocation edge** — these are **Layers**, provided via `Effect.provide` inside `runApiRoute`:

```ts
effect.pipe(
  Effect.provide(LoggerLive("production")),
  Effect.provide(Logger.minimumLogLevel(LogLevel.Info)),
  /* ...existing runApiRoute pipeline... */
  Effect.runPromise,
);
```

**workerd suitability — confirmed safe.** Every built-in logger (`json`, `logFmt`, `pretty`, `structured`, `stringLogger`) writes only through `globalThis.console.*`; `R = never` on all log combinators and Layers, so nothing pulls in `@effect/platform-node` or a filesystem. Avoid only `prettyLogger({ stderr: true })` / `mode: "tty"` (assume a TTY) — use `mode: "browser"`/`"auto"`, and prefer `Logger.json` in prod anyway.

**API-drift flags (3.21 vs older tutorials):**

- `Logger.withMinimumLogLevel` (pipeable operator) is on `Logger`, _not_ `Effect`; the Layer form is `Logger.minimumLogLevel` (no `with`).
- Layer is `Logger.logFmt` (capital F); the logger _value_ is `Logger.logfmtLogger` (lowercase).
- `Logger.replace`/`add`/`minimumLogLevel`/`json`/`pretty`/`structured` are all **Layers** → install with `Effect.provide`, never positionally to `runPromise`.
- `Logger.make`'s callback takes a single `Options` record (`{ logLevel, message, annotations, spans, date, cause, fiberId, context }`).

### D. Third-party libraries vs workerd — honest verdicts

| Library                           | workerd PROD?                                                  | Local dev file logging?         | Structured JSON?              | Bundle               | Verdict                              |
| --------------------------------- | -------------------------------------------------------------- | ------------------------------- | ----------------------------- | -------------------- | ------------------------------------ |
| **Winston**                       | ❌ file transport = ephemeral no-op; console-only is pointless | ✅ (Node only)                  | ✅                            | ❌ ~38 KB (heaviest) | ❌ Don't use on edge                 |
| **pino**                          | ⚠️ `pino/browser` only; **transports broken** (worker_threads) | ✅ (Node only)                  | ✅                            | ✅ ~3.3 KB           | ⚠️ Loses its whole point on the edge |
| **consola**                       | ✅ isomorphic console reporter                                 | ✅ (Node only)                  | ⚠️ needs JSON reporter config | ✅ light             | ✅ Works; nice DX                    |
| **loglevel**                      | ✅ pure console wrapper                                        | ❌ (no transports)              | ❌ no formatting              | ✅ ~1.4 KB           | ✅ Works but too minimal             |
| **tslog**                         | ⚠️/❌ `navigator` crash (#221), brittle runtime detection      | ✅ (Node only)                  | ✅                            | medium               | ⚠️ Risky on workerd                  |
| **Effect built-in `Logger.json`** | ✅ writes via `console`                                        | ❌ (no file in prod, by design) | ✅ native                     | ✅ already a dep     | ✅ **Best fit**                      |

- **Winston (❌):** built on `winston-transport` + Node streams + `fs`. File transport writes to discarded memory in prod; console-only Winston is 38 KB to reproduce `console.log`. No upside on the edge.
- **pino (⚠️):** the fast Node build leans on internals + transports that don't run on workerd; maintainer points to `pino/browser` (a `console.*` shim). Usable as a JSON console emitter, but you lose the serializer/transport performance that is the reason to pick pino. Open issue pinojs/pino#2035 on browser-build quirks.
- **consola (✅):** unjs, isomorphic; falls back to a console reporter on workerd. Default output is pretty/human — needs a reporter to emit JSON for Workers Logs indexing. Good DX; one light dependency.
- **loglevel (✅ but minimal):** 1.4 KB console-level filter, zero structured output. Doesn't meet the JSON requirement without you writing the serialization.
- **tslog (⚠️):** GitHub #221 — reads `globalThis.navigator.userAgent` unconditionally → historically a hard crash on workerd (mitigated on recent compat dates that add `navigator`, but its Node-branch stack parsing / `node:util` inspect stay brittle). Avoid unless pinned and tested.

**Coexistence with Effect:** any viable lib (consola / pino-browser / loglevel) integrates by wrapping it behind a custom `Logger.make((opts) => lib.log(...))` Layer so all `Effect.log*` route through it. But on workerd each is reduced to a `console.*` shim anyway, and Effect's `Logger.json` already emits indexable JSON with native annotations/spans — so wrapping an external logger adds a dependency + translation layer for ~zero gain (except consola's pretty dev output, which `Logger.pretty` already matches).

## Code References

- `src/lib/infrastructure/api/index.ts:56-63` — `runApiRoute`, the single `Effect.runPromise` edge; primary seam for request/response, timing, error logging + logger-Layer `Effect.provide`.
- `src/lib/infrastructure/api/index.ts:22-31` — `toErrorResponsePayload`; error→HTTP mapper that must stay unchanged (logging hooks before it).
- `src/lib/infrastructure/api/index.ts:51-54` — `defectToResponse`; the `SnapchefUnexpectedError` defect fallback (pair with `tapDefect`/`logFatal`).
- `src/middleware.ts:15-19` — `onRequest`; whole-request boundary for method/path/status + timing.
- `src/middleware.ts:48` — the only existing log statement (`Effect.logError`) — Effect's logger is already the de facto house logger.
- `src/middleware.ts:21-33` — `injectDependencies`; composition root if a request-scoped logger is injected onto `App.Locals`.
- `src/env.d.ts:5-13` — `App.Locals`; where a logger field would be declared if injected.
- `src/lib/utils/effect.ts` — `decodeWith` + `tryError*` bridges; natural home for `logStep`/`logResult` combinators.
- `src/lib/core/uc/recipe/RecipeSessionUC.ts:29-35,40-50,98-113` — representative pipelines for result logging.
- `src/lib/infrastructure/llm/openrouter.ts:72-92` — highest-value latency/outcome logging site.
- `wrangler.jsonc` — `nodejs_compat` + `observability.enabled: true` (Workers Logs capturing `console.*`).

## Architecture Insights

- **The codebase already commits to Effect as the logging layer** (`middleware.ts:48` uses `Effect.logError`). Adopting Effect's logger is continuity, not a new direction — and it honors the conventions' pipe-first mandate (`docs/reference/conventions/effect.md`).
- **One edge, one logger install.** `runApiRoute` and `setUserInContext` are the only `Effect.runPromise` sites. Providing the logger Layer there (not per-call-site) keeps logging cross-cutting and config-driven, mirroring how DI is centralized in `src/middleware.ts`.
- **Structured JSON to `console.log` is both the workerd-supported sink and the Effect-native output** — the platform constraint and the framework's default happen to point at the same answer.
- **File logging is a dev-only convenience, never a prod strategy on Workers.** If file output is ever wanted locally, gate it behind the dev branch of `LoggerLive` — never ship it as the production transport.
- **The error-logging hook must be `tapErrorCause`, not `tapError`** — to catch defects (`SnapchefUnexpectedError` path) as well as typed failures, matching `runApiRoute`'s existing `catchAll` + `catchAllDefect` split.

## Historical Context (from prior changes)

- `context/foundation/infrastructure.md:55-56,76,84-85` — already flagged the observability gap: "Workers Logs retention is short on the $5 tier… wire Logpush to R2 or external sink if longer retention matters," and the pre-mortem's "intermittent 500 took a week to reproduce because no external sink was wired." This research deliberately scopes _out_ the retention/sink question (user excluded external providers); the in-app logger here is the prerequisite layer that _produces_ the structured logs such a sink would later ship. The Logpush→R2 decision remains a separate, future change.
- `context/foundation/tech-stack.md` + `infrastructure.md:7-11` — confirm the runtime: Astro 6 SSR on `@astrojs/cloudflare` → `workerd`, the constraint that invalidates file-based logging.

## Related Research

- None found under `context/changes/**/research.md` or `context/archive/**/`. This is the first logging-focused research artifact.

## Open Questions

1. **Library layer decision — RESOLVED (2026-06-13):** use **Effect's built-in logger with zero new dependencies** (`Logger.json`/custom `jsonConsoleLogger` in prod, `Logger.pretty` in dev). consola was declined — `Logger.pretty` already covers dev output. The plan builds on Effect-native logging only.
2. **Request-scoped context:** inject a logger/requestId onto `App.Locals` so UC code can annotate logs with userId/sessionId, or keep all annotation at the `runApiRoute` edge (simpler, no `env.d.ts` change)? Recommendation: start at the edge; add request-scoped annotation only if UC-level correlation becomes necessary.
3. **Log level source:** wire `Config.logLevel("LOG_LEVEL")` as a Layer (env-driven, per `astro:env/server` conventions) vs a hardcoded `Info` minimum for the MVP.
4. **Out of scope (future change):** long-term retention via Logpush→R2 / external sink — explicitly excluded here per the scoping answer, but pre-registered by `infrastructure.md`.

## Recommendation ranking (for: structured JSON to console in prod, pretty in dev, minimal deps, native Effect integration)

1. **Effect built-in logger (no new dependency)** — `Logger.json`/custom `jsonConsoleLogger` in prod, `Logger.pretty` in dev, selected by env in one Layer provided at `runApiRoute`/`middleware`. Workerd-safe, native pipeline integration, structured annotations + spans. **The correct answer for this codebase.**
2. **consola behind a `Logger.make` layer** — only if you want consola's pretty dev output specifically; one light isomorphic dependency, JSON reporter for prod.
3. **pino (`pino/browser`) behind `Logger.make`** — works as a console JSON emitter but loses pino's reason to exist on the edge.
4. **loglevel** — level filter only; fails the JSON requirement.
5. **tslog** — avoid unless pinned + verified on the compat date (#221).
6. **Winston** — do not use on the edge; file transports are dead weight, console-only is 38 KB of nothing.
