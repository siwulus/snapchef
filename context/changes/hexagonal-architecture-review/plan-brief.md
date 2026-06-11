# Hexagonal Architecture Seam Fixes — Plan Brief

> Full plan: `context/changes/hexagonal-architecture-review/plan.md`
> Review (research input): `context/changes/hexagonal-architecture-review/hexagonal-architecture-review.md`

## What & Why

The architecture review graded the codebase a "solid B": the hexagon is real — ports, port-injected core, one composition root, typed errors — but unfinished at the seams. Three blanket `mapError` choke points report infrastructure outages as 404/401 with causes discarded; the auth use case runtime-imports Supabase utilities inside `core/` (the only inward-dependency violation); `utils/` has become an escape hatch importable from anywhere; and `boundry/` has no settled taxonomy. This plan finishes those seams **before S-02 (recipe generation) copies the broken patterns**.

## Starting Point

`RecipeSessionUC` already models the target pattern (port-injected, Supabase-free); `AuthenticatorUC` does not (concrete `SupabaseClient`, runtime `utils/supabase` import, hardcoded redirect targets). `utils/` holds an infrastructure bridge and a file mixing DB column knowledge with a domain rule. There are zero tests and no test runner.

## Desired End State

An infrastructure failure surfaces as 500 with its cause preserved; only genuine absence is 404 and only genuine auth rejection is 401. `core/` has zero runtime imports from `utils/`/`infrastructure/` and never names Supabase. Auth follows the same port discipline as recipes (`Authenticator` port → `SupabaseAuthenticator` adapter → thin UC). `utils/` holds exactly `effect.ts` under a written direction rule, and every `boundry/` domain follows one documented taxonomy: `ports.ts` / `commands.ts` / `responses.ts` / `dto.ts`.

## Key Decisions Made

| Decision                  | Choice                                                                                                                             | Why (1 sentence)                                                                                  | Source        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------- |
| Scope                     | All of R1–R5 + R7; W5 untouched                                                                                                    | Finish every seam in one pass before S-02; W5 is a documented accepted trade-off                  | Review + Plan |
| Tests (R6)                | **Deferred** to the test-plan rollout                                                                                              | User decision — this change stays a pure refactor; noted that R1 lands unpinned                   | Plan (user)   |
| Auth UC shape             | Keep `AuthenticatorUC` as a thin wrapper over the new `Authenticator` port                                                         | F-02's verification rules get a domain home; `env.d.ts`, middleware, and routes keep their shape  | Plan (user)   |
| Boundry taxonomy          | `ports.ts`/`commands.ts`/`responses.ts`/`dto.ts`, applied to **all** domains; `UserCredentials` → `boundry/auth/commands.ts`       | Matches root CLAUDE.md's stated intent and gives S-02 an unambiguous template                     | Plan (user)   |
| Auth error classification | `isAuthApiError && status < 500` → 401 with cause; everything else (incl. `AuthUser` decode drift) → `SnapchefExternalSystemError` | Wire-schema drift on the driven side must not blame the client with a 400                         | Plan          |
| `RecognizedItem` home     | Moves to `core/model/recipe`                                                                                                       | `serializeItemsToMarkdown` (moving to core/model) consumes it; model must not import from boundry | Plan          |
| Bridge location           | `utils/supabase.ts` → `infrastructure/db/supabase-effect.ts`                                                                       | Review's primary suggestion; sibling to its main consumers                                        | Review        |
| Docs sync                 | Conventions updated in the same phase as the code they describe                                                                    | Binding conventions must never teach the pre-fix pattern to the next agent                        | Plan          |

## Scope

**In scope:** R1 (error fidelity at all three choke points), R2 (auth port + adapter), R3 (disband `utils/`), R4 (redirects to routes), R5 (delete dead members), R7 (boundry taxonomy), conventions-doc sync.

**Out of scope:** R6/tests (deferred), W5 reversal, Effect Layer/Context DI, porting `@supabase/ssr` cookie mechanics, speculative port generalization, recipe-side `commands.ts`/`responses.ts` (S-02 creates them), renaming the `boundry` folder.

## Architecture / Approach

Auth is brought into the existing hexagonal shape rather than a new one: `core/boundry/auth/ports.ts` declares `Authenticator`; `infrastructure/auth/SupabaseAuthenticator.ts` implements it (owning the `AuthUser` wire schema and cause-preserving error classification); `middleware.ts` stays the single composition root; routes own redirect policy. Structure moves (`utils/` disband, boundry taxonomy) follow dependency direction strictly: DB knowledge → `infrastructure/db/`, domain rules → `core/model/`, driving/driven contracts split inside `boundry/`.

## Phases at a Glance

| Phase                              | What it delivers                                                              | Key risk                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1. Recipe error fidelity + hygiene | Repository failures pass through unmasked; dead members deleted               | Low — two private methods, no consumers of deleted API                          |
| 2. Auth port + adapter + outcomes  | Core Supabase-free; 401 only for real rejections; redirects at routes         | Mis-classifying "no session" would break anonymous page loads (guarded in plan) |
| 3. Disband `utils/`                | Bridge → infrastructure; row mapper/domain rule split; direction rule written | Stale import paths (grep-gated)                                                 |
| 4. Boundry taxonomy                | One documented pattern across domains; `UserCredentials` in `commands.ts`     | Circular import via own barrel (guarded in plan)                                |

**Prerequisites:** local Supabase via Docker (`mise run db-start`) for manual verification; nothing else.
**Estimated effort:** ~1–2 sessions; each phase lands independently behind `npm run lint` + `npm run build` + a manual smoke check.

## Open Risks & Assumptions

- R1's fix lands **without a pinning test** (R6 deferred) — a future blanket `mapError` could regress silently until the test-plan rollout covers it.
- Assumes `isAuthApiError` from `@supabase/supabase-js` reliably distinguishes auth rejections from outages in the installed v2 client (verify at implementation; fallback is status-code branching on the error object).
- Conventions docs are binding agent context — the plan syncs them per-phase; skipping that step would actively teach future agents the old pattern.

## Success Criteria (Summary)

- Stopping Supabase mid-flow yields 500-family envelopes with causes — never 404 "Session not found" or 401 "Failed to sign in".
- `grep -rn "@supabase\|utils/supabase" src/lib/core` is empty; `ls src/lib/utils/` shows exactly `effect.ts`.
- Sign-in/sign-up/sign-out and photo upload behave identically on the wire; forms unchanged.
