# Logging Solution — Plan Brief

> Full plan: `context/changes/logging-solution/plan.md`
> Research: `context/changes/logging-solution/research.md`

## What & Why

Snapchef has no server-side logging (one stray `Effect.logError` aside). This change adds a first logging layer built on **Effect-TS's native logger** — no new dependency — covering the three requested needs: request/response logs with processing time, error logs, and a result-logging primitive that plugs into Effect pipelines. Output is structured JSON to `console` in production (the only durable sink on Cloudflare `workerd`) and pretty in development.

## Starting Point

Two separate `Effect.runPromise` edges exist: `runApiRoute` (`api/index.ts:56-63`, API routes only) and the imperative `onRequest` middleware (`middleware.ts:15-54`, every request). The middleware is the only seam that sees all routes plus final status and true duration. Runtime is `workerd` (no filesystem → `console` is the sink; Workers Logs auto-indexes JSON). Env flows through `astro:env/server` (`astro.config.mjs`).

## Desired End State

Every request emits one structured access log (method, path, status, duration, `cf-ray` correlation id, userId); API failures emit a structured error log with the rendered `Cause`; a `logResult`/`logStep` combinator lives in `utils/effect.ts` and is wired into the LLM recognition and recipe-session flows. Verbosity (`LOG_LEVEL`) and body logging (`LOG_HTTP_BODIES`) are env-driven. One logger definition, provided at both edges via a shared run helper.

## Key Decisions Made

| Decision                 | Choice                                                      | Why (1 sentence)                                                                   | Source   |
| ------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------- |
| Logging library          | Effect built-in, 0 deps                                     | workerd-safe console JSON, native pipeline fit; Winston/pino/file logging rejected | Research |
| Output format            | JSON (prod) / pretty (dev)                                  | JSON is what Workers Logs indexes; pretty for local DX                             | Research |
| HTTP access-log location | Middleware, all routes                                      | Only seam with final status + true end-to-end duration for pages+API+redirects     | Plan     |
| Middleware shape         | Refactor imperative `onRequest` → Effect pipeline, run once | User directive; folds the two runPromise edges, one place to log/provide logger    | Plan     |
| Correlation id           | Reuse `cf-ray`, fallback `crypto.randomUUID()`              | Ties app logs to Cloudflare's trace for free; fallback covers local dev            | Plan     |
| Log level                | env-driven `LOG_LEVEL` (default Info)                       | Retune verbosity without a code redeploy                                           | Plan     |
| Body logging             | env-driven `LOG_HTTP_BODIES` (default off, JSON-only)       | PII/size risk; opt-in, never multipart                                             | Plan     |
| Result-logging scope     | Helpers + LLM recognition + recipe-session transitions      | Proves the combinator on the slow/failure-prone AI paths                           | Plan     |
| Testing                  | Unit-test combinators + JSON output; manual-verify wiring   | Guards the reusable pieces without over-investing in edge plumbing                 | Plan     |

## Scope

**In scope:** Effect logger module (Layer + run helper), `LOG_LEVEL`/`LOG_HTTP_BODIES` env, `runApiRoute` error-cause logging, middleware refactor + all-routes access log with cf-ray + timing, `logStep`/`logResult` combinators wired into LLM + recipe flows, unit tests for logger + combinators.

**Out of scope:** External/SaaS sinks (Logpush, Sentry, Axiom), file logging, tracing/OTel, metrics/alerting, client-side logging, blanket instrumentation of all UCs/adapters, log retention policy.

## Architecture / Approach

A shared `infrastructure/logging/logger.ts` exports the env-selected logger `Layer` (prod JSON-to-console / dev pretty, composed with `minimumLogLevel` from `LOG_LEVEL`) and a `runWithLogging` helper built once via `ManagedRuntime`. Both edges run through it, so all `Effect.log*` use the one logger. Access logging = `withLogSpan` + `annotateLogs` in the refactored middleware; error logging = `tapErrorCause` in `runApiRoute`; result logging = `tap`/`tapBoth` combinators in `utils/effect.ts` applied at AI call sites. **Load-bearing constraint:** the two `runPromise` edges are separate fibers, so the Layer must be provided at both — the shared module is what prevents a duplicate/drifting logger.

## Phases at a Glance

| Phase                               | What it delivers                                                               | Key risk                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 1. Foundation + error logs          | Env schema, logger module, `runWithLogging`, `runApiRoute` error-cause logging | Getting the prod-JSON Layer + level mapping right                             |
| 2. Middleware refactor + access log | `onRequest` as Effect pipeline; one access log per request w/ cf-ray + timing  | Preserving fail-open auth / redirect / fail-fast behavior through the rewrite |
| 3. Combinators + instrumentation    | `logStep`/`logResult` + LLM/recipe instrumentation                             | Log volume / not flooding at `Info`                                           |

**Prerequisites:** None — additive, no DB/migration. Effect already a dependency.
**Estimated effort:** ~2-3 focused sessions across the 3 phases.

## Open Risks & Assumptions

- "fm.js" in the middleware directive is interpreted as **"refactor to an Effect (fp) pipeline, run once via `runPromise`."** If it meant something else, Phase 2 changes.
- `cf-ray` is assumed present only in deployed/`wrangler` contexts; the UUID fallback path needs explicit testing.
- The middleware refactor must exactly preserve current behavior (anonymous fail-open, protected-route redirect, fail-fast on missing Supabase) — behavior-neutral structural rewrite.
- Astro middleware integration testing is deliberately manual this pass.

## Success Criteria (Summary)

- One structured access log per request (all routes) with method/path/status/duration/cf-ray, JSON in prod / pretty in dev.
- Structured error logs for typed failures and defects, with the existing error→HTTP mapping intact.
- `logResult`/`logStep` reusable and live on the LLM recognition + recipe-session flows; verbosity and body logging tunable via env without a code change.
