# Logging Solution Implementation Plan

## Overview

Introduce a first server-side logging layer for Snapchef built entirely on **Effect-TS's native logger** (zero new dependencies). It delivers the three requirements requested: (1) basic request/response logs with processing time, (2) error logs, and (3) a reusable result-logging primitive that plugs into Effect pipelines. Output is **structured JSON to `console`** in production (the only durable sink on Cloudflare `workerd`, auto-indexed by Workers Logs) and **pretty/colorized** in development. Verbosity and request/response body logging are env-driven.

## Current State Analysis

- The codebase is **logging-dark**: the only existing log statement is `Effect.logError(...)` at `src/middleware.ts:48`. No `console.*`, no custom logger, no `Logger` layer, no `annotateLogs`/`withLogSpan`.
- **Two `Effect.runPromise` edges exist**, and they are separate fibers:
  - `runApiRoute` (`src/lib/infrastructure/api/index.ts:56-63`) — the single exit for every API route; an Effect pipeline that maps success → envelope, `catchAll` → error response (reads `error.code` as HTTP status), `catchAllDefect` → `SnapchefUnexpectedError`.
  - `setUserInContext` (`src/middleware.ts:35-54`) — runs for every request inside the imperative `onRequest`.
- `onRequest` (`src/middleware.ts:15-19`) is **imperative `async/await`** (`injectDependencies` → `await setUserInContext` → `checkProtectedRoutes`) and is the only seam that wraps **all** routes (pages + API + redirects) and can observe the final `Response` (status) and true end-to-end duration.
- Runtime is Cloudflare `workerd` (`wrangler.jsonc`: `nodejs_compat`, `observability.enabled: true`). **No durable filesystem** — file logging silently no-ops in production; `console.*` is the supported sink. Effect's built-in loggers write only via `globalThis.console.*` → workerd-safe.
- Env access goes through `astro:env/server`; the schema is in `astro.config.mjs:17-33` (server fields: `SUPABASE_*`, `OPENROUTER_*`). This is where `LOG_LEVEL` / `LOG_HTTP_BODIES` belong.
- `src/lib/utils/effect.ts` is the one module importable by both `core` and `infrastructure` (`src/lib/CLAUDE.md` "Layer Access Matrix") — the correct home for pipeline combinators (`logStep`/`logResult`).
- Effect is pinned at `effect@^3.21.2`. Verified API: `Logger.replace`/`Logger.add`/`Logger.minimumLogLevel`/`Logger.json`/`Logger.pretty` are **Layers** (install via `Effect.provide`); `Logger.structuredLogger` exposes `{ logLevel, message, annotations, spans, … }`; `Effect.withLogSpan(label)` auto-annotates `label=<ms>ms`; `Effect.tapErrorCause` catches typed failures **and** defects.

## Desired End State

After this plan:

- Every HTTP request emits **one structured access log** (method, path, status, duration-ms, `cf-ray` correlation id, userId when present) from middleware, covering all routes. Verified by `wrangler tail` / dev console.
- API failures (typed `SnapchefServerError` and unexpected defects) emit a **structured error log** with the rendered `Cause`, without altering the existing error→HTTP mapping.
- A reusable `logResult`/`logStep` combinator exists in `utils/effect.ts` and is wired into the LLM recognition flow and `RecipeSessionUC` stage transitions, so the slow/failure-prone AI paths are observable.
- Log verbosity is controlled by `LOG_LEVEL`, and request/response body logging by `LOG_HTTP_BODIES` — both via `astro:env/server`, no code change to retune.
- In production logs are single-line JSON (`console.log`); in development they are pretty/colorized. Selection is automatic by mode.
- There is exactly **one** logger definition, provided at both `runPromise` edges via a shared run helper.

### Key Discoveries:

- Single API edge to instrument: `src/lib/infrastructure/api/index.ts:56-63` (`runApiRoute`).
- All-routes edge with final status + duration: `src/middleware.ts:15-19` (`onRequest`) — currently imperative, to be refactored to an Effect pipeline.
- Combinator home (core+infra importable): `src/lib/utils/effect.ts`.
- Env schema location: `astro.config.mjs:17-33` (`astro:env/server`).
- Highest-value pipeline sites: `src/lib/infrastructure/llm/openrouter.ts:72-92` (`completeStructured`) and `src/lib/core/uc/recipe/RecipeSessionUC.ts:29-50,98-113`.
- Two separate fibers ⇒ the logger Layer must be provided at both `runApiRoute` and the refactored middleware; a shared module prevents drift.

## What We're NOT Doing

- **No external/SaaS log providers or shippers** — no Logpush→R2, Sentry, Axiom, Datadog, Better Stack. (Pre-registered as a future change in `infrastructure.md`; explicitly out of scope per the research scoping.)
- **No file-based logging** — not viable on `workerd`; dev-only file output is not added either.
- **No new logging dependency** — Effect built-in only (consola/pino/winston explicitly rejected in research).
- **No tracing / OpenTelemetry** (`@effect/opentelemetry`), no metrics/alerting.
- **No client/browser logging** — server-side only.
- **No blanket instrumentation** of every UC method and DB adapter — only the two high-value flows in Phase 3.
- **No log retention/rotation policy** — handled by Cloudflare Workers Logs defaults.

## Implementation Approach

Build a small shared logging module under `src/lib/infrastructure/` that exports (a) the env-selected logger **Layer** (prod JSON-to-console / dev pretty) composed with `Logger.minimumLogLevel(LOG_LEVEL)`, and (b) a `runWithLogging` helper (built once via `ManagedRuntime` so the Layer isn't rebuilt per request) that runs an Effect as a `Promise` with that Layer provided. Both edges — `runApiRoute` and the refactored `onRequest` — run through this helper, so `Effect.log*` everywhere routes through the one logger. HTTP access logging and error-cause logging are added at the edges via `Effect.withLogSpan` + `Effect.annotateLogs` + `Effect.tapErrorCause`. Pipeline result logging is a thin `Effect.tap`/`tapBoth` combinator in `utils/effect.ts`, applied at the AI call sites.

## Critical Implementation Details

- **Two fibers, one logger.** Providing the logger Layer inside `onRequest` does **not** propagate into the API route's own `runApiRoute` `runPromise` (separate fiber/runtime). Both must run through the shared `runWithLogging`/runtime. This is the load-bearing constraint of the whole change.
- **Middleware must return a `Response`.** The refactored `onRequest` pipeline wraps `next()` (a `Promise<Response>`); the access-log duration brackets the `next()` call, and the status comes from the resolved/redirect `Response`. A thrown `injectDependencies` failure (`SnapchefExternalSystemError` when Supabase env is missing) must still surface — fail fast, but log it first.
- **`cf-ray` absent locally.** Cloudflare sets the `cf-ray` request header in production; in plain local dev it is missing. Fall back to `crypto.randomUUID()` (available in `workerd` and Node 24) so correlation works in both. Test the fallback path.
- **Body logging is sensitive.** `LOG_HTTP_BODIES` defaults to **off**. Bodies can carry PII and are large (multipart photo uploads); never log multipart/binary bodies — gate to JSON content-types only, and only when the flag is on.
- **Order in middleware.** `injectDependencies` (may throw) → `setUserInContext` (sets `locals.user`, used for the access-log `userId` annotation) → protected-route check / `next()` → emit access log on the way out. Annotate `userId` only after `setUserInContext` resolves.

---

## Phase 1: Logger Foundation + Error Logs

### Overview

Stand up the env schema, the shared logger module (Layer + run helper), and integrate it into `runApiRoute` with error-cause logging. After this phase, API routes emit structured JSON error logs in prod / pretty in dev, with verbosity controlled by `LOG_LEVEL`.

### Changes Required:

#### 1. Env schema

**File**: `astro.config.mjs`

**Intent**: Declare the two logging env vars so they're read through `astro:env/server` like the existing secrets.

**Contract**: Add to the `env.schema` block — `LOG_LEVEL` (`envField.string`, `context: "server"`, `access: "public"`, `default: "Info"`) and `LOG_HTTP_BODIES` (`envField.boolean`, `context: "server"`, `access: "public"`, `default: false`). String values for `LOG_LEVEL` must map to Effect `LogLevel` labels (`All|Trace|Debug|Info|Warning|Error|Fatal|None`).

#### 2. Shared logger module

**File**: `src/lib/infrastructure/logging/logger.ts` (new; kebab-case per `src/lib/CLAUDE.md`)

**Intent**: One place that defines the logger and how Effects are run with it. Exports the env-selected logger Layer and a `runWithLogging` helper used by every edge, so there is a single logger definition and the Layer is built once.

**Contract**:

- `LoggerLive: Layer.Layer<never>` — in production, `Logger.replace(Logger.defaultLogger, jsonConsoleLogger)` where `jsonConsoleLogger = Logger.map(Logger.structuredLogger, (s) => globalThis.console.log(JSON.stringify(s)))`; in development, `Logger.pretty`. Mode chosen via `import.meta.env.PROD`/`DEV`. Composed with `Logger.minimumLogLevel(levelFromEnv(LOG_LEVEL))`.
- `runWithLogging: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>` — runs the effect with `LoggerLive` provided. Build once via `ManagedRuntime.make(LoggerLive)` at module scope and expose `runtime.runPromise`.
- `LOG_HTTP_BODIES` re-exported (or a `shouldLogBodies` boolean) for the middleware to consume.
- `LOG_LEVEL` string → `LogLevel` mapping uses ts-pattern `match(...).with(...).exhaustive()` over the known labels (per `generic.md`), defaulting unknown values to `Info`.

#### 3. Integrate logger + error logging into `runApiRoute`

**File**: `src/lib/infrastructure/api/index.ts`

**Intent**: Route every API-route Effect through the shared logger and emit a structured error log for both typed failures and defects, without changing the existing success/error envelope behavior.

**Contract**: In `runApiRoute` (lines 56-63), add `Effect.tapErrorCause((cause) => Effect.logError("api.error", cause))` **before** the existing `catchAll`/`catchAllDefect` (so the mapper still receives the typed error), and replace the trailing `Effect.runPromise` with the shared `runWithLogging`. The function signature and return type (`Promise<Response>`) are unchanged.

#### 4. Logger module unit test

**File**: `src/lib/infrastructure/logging/logger.test.ts` (new)

**Intent**: Lock the production JSON output shape and the level mapping.

**Contract**: Using a capturing logger (`Logger.replace` with a test logger that pushes to an array, or spying `console.log`), assert that an `Effect.logInfo`/`logError` run through `LoggerLive` (prod mode) produces a single JSON line containing `message`, `logLevel`, `annotations`, and `spans`. Assert `levelFromEnv("Debug")`→`LogLevel.Debug` and an unknown string→`LogLevel.Info`.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `pnpm lint` (type-checked ESLint)
- [ ] Logger unit tests pass (JSON shape + level mapping)
- [ ] Build succeeds: `pnpm build`

#### Manual Verification:

- [ ] Triggering a failing API route (e.g. invalid sign-in) prints a structured `api.error` log with the rendered cause in the dev console
- [ ] Setting `LOG_LEVEL=Warning` suppresses info-level logs; `LOG_LEVEL=Debug` shows them
- [ ] Production build emits single-line JSON (verified via `pnpm build` + `wrangler dev` or `wrangler tail`)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Middleware Refactor + HTTP Access Log

### Overview

Refactor `onRequest` from imperative `async/await` into a single Effect pipeline run via `runWithLogging`, and emit one structured access log per request (all routes) with timing and `cf-ray` correlation. Body logging is gated by `LOG_HTTP_BODIES`.

### Changes Required:

#### 1. Refactor `onRequest` to an Effect pipeline

**File**: `src/middleware.ts`

**Intent**: Express the middleware as a pipe-first Effect (per `effect.md`) that injects dependencies, resolves the user, applies the protected-route check, wraps `next()`, times the whole request, and emits the access log — all run once via the shared run helper. This replaces today's two imperative `runPromise`/`async` steps with one edge.

**Contract**:

- `onRequest` still returns `Promise<Response>` (Astro contract) and still calls `defineMiddleware`.
- Pipeline shape: lift `injectDependencies` into `Effect` (it may fail with `SnapchefExternalSystemError` — log then re-fail/fail-fast); `flatMap` into the existing `setUserInContext` logic (folded into the pipeline, keeping its `catchTag`/`catchAll` fail-open semantics and the existing `getUser failed` log); `flatMap` into protected-route resolution that yields either a redirect `Response` or the result of wrapping `next()` (`Effect.tryPromise`); `Effect.tap` to emit the access log; run via `runWithLogging`.
- Access log: `Effect.logInfo("http.request", …)` annotated via `Effect.annotateLogs({ method, path, status, cfRay, userId })` and wrapped in `Effect.withLogSpan("http")` so duration surfaces as `http=<ms>ms`. `cfRay = request.headers.get("cf-ray") ?? crypto.randomUUID()`.
- Body logging: only when `LOG_HTTP_BODIES` is true **and** content-type is JSON — annotate request/response body; never for multipart/binary. Off by default.
- `setUserInContext` and `checkProtectedRoutes` may be inlined or kept as helper functions returning Effects; `PROTECTED_ROUTES` unchanged.

#### 2. Reconcile `runApiRoute` edge (no double logger build)

**File**: `src/lib/infrastructure/api/index.ts` (verify only)

**Intent**: Ensure the API-route edge and the middleware edge share the same logger runtime from Phase 1 (no second `ManagedRuntime`).

**Contract**: `runApiRoute` continues to use `runWithLogging`; no logger Layer is constructed in `middleware.ts` directly — both import from `infrastructure/logging/logger.ts`.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `pnpm lint`
- [ ] Build succeeds: `pnpm build`
- [ ] Existing tests still pass: `pnpm test` (auth/recipe flows unaffected by the middleware refactor)

#### Manual Verification:

- [ ] Every request (page load, API call, redirect) emits exactly one `http.request` access log with method, path, status, and `http=<ms>ms`
- [ ] Protected-route redirect to `/auth/signin` for an anonymous user still works and is logged with status 302
- [ ] `cf-ray` is used as the correlation id under `wrangler dev`/deploy; `crypto.randomUUID()` fallback appears in plain `pnpm dev`
- [ ] `LOG_HTTP_BODIES=true` logs JSON request bodies but never multipart photo uploads; default (unset) logs no bodies
- [ ] Supabase-misconfigured case still fails fast (and now logs the failure)

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Result-Logging Combinators + Instrumentation

### Overview

Add the reusable pipeline result-logging combinators and wire them into the two highest-value flows (LLM recognition and recipe-session stage transitions).

### Changes Required:

#### 1. `logStep` / `logResult` combinators

**File**: `src/lib/utils/effect.ts`

**Intent**: Provide pipe-ready combinators that log a pipeline's success (and optionally failure) value and timing without altering the channel — the "pluggable into Effect pipelines" requirement.

**Contract**:

- `logStep(label): <A,E,R>(eff) => Effect.Effect<A,E,R>` — `Effect.tap((a) => Effect.logInfo(label, a))`, identity on value/error/requirement channels.
- `logResult(label): <A,E,R>(eff) => Effect.Effect<A,E,R>` — `Effect.tapBoth({ onSuccess: a => Effect.logInfo(`${label}.ok`, a), onFailure: e => Effect.logError(`${label}.fail`, e) })` then `Effect.withLogSpan(label)` (adds `label=<ms>ms`).
- Both preserve the exact input/output types; no new error or requirement is introduced.

#### 2. Instrument LLM recognition

**File**: `src/lib/infrastructure/llm/openrouter.ts`

**Intent**: Make the slow/failure-prone vision calls observable (latency + outcome), the path `infrastructure.md` flagged for intermittent 500s.

**Contract**: Apply `logResult("llm.recognize")` (or `withLogSpan` + `tap`) to the `completeStructured` pipeline (lines 72-92) and/or the per-photo recognition call, so each model call logs duration and success/failure. No behavior change to retries/timeouts.

#### 3. Instrument recipe-session stage transitions

**File**: `src/lib/core/uc/recipe/RecipeSessionUC.ts`

**Intent**: Log the meaningful state transitions (photos attached, recognition complete) to trace a session through the wizard.

**Contract**: Apply `logStep`/`logResult` at the stage boundaries in `attachPhotos` (lines 29-35) and `recognizeProducts` (lines 40-50) — e.g. `logResult("recipe.attachPhotos")`, `logResult("recipe.recognize")`. Pure `Effect.tap` additions; pipeline results unchanged.

#### 4. Combinator unit tests

**File**: `src/lib/utils/effect.test.ts` (new or extend existing)

**Intent**: Guard the reusable combinators other code will depend on.

**Contract**: With a capturing test logger, assert `logStep`/`logResult` (a) pass the success value through unchanged, (b) propagate failures unchanged, (c) emit the expected `label`/`label.ok`/`label.fail` log entries, and (d) `logResult` records a span for `label`.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `pnpm lint`
- [ ] Combinator unit tests pass
- [ ] Full test suite passes: `pnpm test`
- [ ] Build succeeds: `pnpm build`

#### Manual Verification:

- [ ] Running a recognition flow emits `llm.recognize` logs with per-call duration
- [ ] A recipe session walked through upload→recognize emits `recipe.attachPhotos` and `recipe.recognize` result logs with timing
- [ ] Log volume is reasonable (no per-item flood at default `LOG_LEVEL=Info`)

**Implementation Note**: Final phase — confirm the three original requirements (request/response+timing, error logs, pipeline result logging) are all observable end-to-end.

---

## Testing Strategy

### Unit Tests:

- Logger module: prod JSON output shape (`message`/`logLevel`/`annotations`/`spans`), `LOG_LEVEL`→`LogLevel` mapping incl. unknown→`Info`.
- Combinators: `logStep`/`logResult` value/error pass-through, emitted entries, span presence.
- Use a capturing logger (`Logger.replace` with an array-push test logger) rather than asserting on real `console`.

### Integration Tests:

- Out of scope for this pass (Astro middleware integration testing is fiddly) — middleware wiring is verified manually. Noted as a possible follow-up.

### Manual Testing Steps:

1. `pnpm dev`, load a page → confirm one pretty `http.request` line with `http=<ms>ms`, correlation id present (UUID fallback).
2. Hit a failing API route → confirm `api.error` with rendered cause.
3. Set `LOG_LEVEL=Warning` → confirm info logs suppressed; `Debug` → confirm shown.
4. Set `LOG_HTTP_BODIES=true` → confirm JSON bodies logged, multipart upload body NOT logged; unset → no bodies.
5. `pnpm build` then `wrangler dev`/`wrangler tail` → confirm single-line JSON output and `cf-ray` correlation in a deployed/preview context.
6. Run a full upload→recognize flow → confirm `llm.recognize` + `recipe.*` logs with timing.

## Performance Considerations

- `ManagedRuntime` built once at module scope avoids rebuilding the logger Layer per request.
- JSON serialization per log line is negligible vs the LLM calls; keep default level at `Info` to avoid debug-log flood (relevant to the `workerd` CPU budget noted in `infrastructure.md`).
- Never serialize/log multipart photo bodies (size + CPU).

## Migration Notes

- Additive only; no DB or schema changes. `LOG_LEVEL`/`LOG_HTTP_BODIES` have safe defaults, so existing `.env`/`.dev.vars`/Worker secrets need no immediate change. Document the two new vars in `README.md` env section as a follow-up note.
- The middleware refactor preserves existing behavior (fail-open auth, protected-route redirect, fail-fast on missing Supabase) — it is a structural rewrite, not a behavior change.

## References

- Related research: `context/changes/logging-solution/research.md`
- Infra constraints: `context/foundation/infrastructure.md` (workerd logs, retention gap)
- Conventions: `docs/reference/conventions/effect.md`, `docs/reference/conventions/generic.md`, `src/lib/CLAUDE.md` (layer access)
- API edge: `src/lib/infrastructure/api/index.ts:56-63`
- Middleware edge: `src/middleware.ts:15-54`
- Combinator home: `src/lib/utils/effect.ts`
- High-value sites: `src/lib/infrastructure/llm/openrouter.ts:72-92`, `src/lib/core/uc/recipe/RecipeSessionUC.ts:29-50`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Logger Foundation + Error Logs

#### Automated

- [x] 1.1 Type checking passes: `pnpm lint` — 7200edb4b
- [x] 1.2 Logger unit tests pass (JSON shape + level mapping) — 7200edb4b
- [x] 1.3 Build succeeds: `pnpm build` — 7200edb4b

#### Manual

- [x] 1.4 Failing API route prints structured `api.error` log with rendered cause — 7200edb4b
- [x] 1.5 `LOG_LEVEL` toggles info-level visibility (Warning suppresses, Debug shows) — 7200edb4b
- [x] 1.6 Production build emits single-line JSON — 7200edb4b

### Phase 2: Middleware Refactor + HTTP Access Log

#### Automated

- [x] 2.1 Type checking passes: `pnpm lint`
- [x] 2.2 Build succeeds: `pnpm build`
- [x] 2.3 Existing tests still pass: `pnpm test`

#### Manual

- [x] 2.4 Every request emits one `http.request` access log with method/path/status/`http=<ms>ms`
- [x] 2.5 Protected-route redirect still works and is logged with status 302
- [x] 2.6 `cf-ray` used as correlation id; `crypto.randomUUID()` fallback in plain dev
- [x] 2.7 `LOG_HTTP_BODIES=true` logs JSON bodies, never multipart; default logs no bodies
- [x] 2.8 Supabase-misconfigured case still fails fast and logs the failure

### Phase 3: Result-Logging Combinators + Instrumentation

#### Automated

- [ ] 3.1 Type checking passes: `pnpm lint`
- [ ] 3.2 Combinator unit tests pass
- [ ] 3.3 Full test suite passes: `pnpm test`
- [ ] 3.4 Build succeeds: `pnpm build`

#### Manual

- [ ] 3.5 Recognition flow emits `llm.recognize` logs with per-call duration
- [ ] 3.6 Upload→recognize emits `recipe.attachPhotos` and `recipe.recognize` result logs with timing
- [ ] 3.7 Log volume reasonable at default `LOG_LEVEL=Info`
