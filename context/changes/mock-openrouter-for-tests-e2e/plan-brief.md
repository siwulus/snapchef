# Mock OpenRouter in E2E with a Fake Adapter Behind the Port — Plan Brief

> Full plan: `context/changes/mock-openrouter-for-tests-e2e/plan.md`

## What & Why

Playwright E2E drives the real Astro server, which calls the **paid** OpenRouter API
server-side. We add a test seam that swaps the two LLM ports for deterministic fakes at the
middleware composition root, gated by an env flag, so E2E runs free, fast, deterministic,
and offline — while still exercising the real HTTP flow through our own `/api/**` routes.

## Starting Point

OpenRouter is called server-side via `createProductRecognizer()` / `createRecipeGenerator()`
wired in `injectDependencies` (`src/middleware.ts:48-50`). Because the call originates in
the server (not the browser), Playwright's `page.route()` cannot intercept it. The app
already has clean hexagonal ports (`ProductRecognizer`, `RecipeGenerator`) and a single
composition root — the ideal seam. No recipe-flow E2E spec exists yet.

## Desired End State

With `E2E_FAKE_LLM=true` under a dev build, the upload → recognize → generate flow completes
from canned data with **no API key and zero `openrouter.ai` traffic**. With the flag unset
(the default, and always so in the prod Worker), the real adapter is used exactly as today.
Playwright boots its dev server with the flag on.

## Key Decisions Made

| Decision             | Choice                                      | Why                                                               | Source |
| -------------------- | ------------------------------------------- | ----------------------------------------------------------------- | ------ |
| Mocking strategy     | Fake adapter behind the port                | Exploits the existing hexagonal seam; no real network             | Change |
| Scope of this change | Seam only (no specs authored)               | Respects `/10x-e2e` as the source of truth for spec authoring     | Plan   |
| Fake output          | Input-derived deterministic                 | Stable _and_ meaningful assertions (inputs propagate)             | Plan   |
| Failure simulation   | Happy-path only                             | Error branches already covered by `openrouter.test.ts`            | Plan   |
| Prod safety          | `E2E_FAKE_LLM && import.meta.env.DEV` guard | Dead-code-eliminated from the prod bundle; fake can't run in prod | Plan   |
| Flag shape           | Single `E2E_FAKE_LLM`                       | One switch; E2E always wants both faked                           | Plan   |
| Flag injection       | Playwright `webServer.env`                  | Native, minimal; CI boots fresh so it's reliable there            | Plan   |

## Scope

**In scope:**

- `FakeProductRecognizer.ts` + `FakeRecipeGenerator.ts` (input-derived, happy-path)
- `E2E_FAKE_LLM` env field + Vitest stub mirror
- Composition-root selection in `src/middleware.ts` behind the prod guard
- Small Vitest test for the fakes
- Playwright `webServer.env` wiring + reuse-caveat doc

**Out of scope:**

- Any Playwright spec (deferred to `/10x-e2e`)
- Mocking Supabase / storage
- Failure-path simulation, per-port / per-scenario control
- Touching the real `openrouter.ts` adapter

## Architecture / Approach

Two new fake factories under `infrastructure/llm/`, typed against the ports so drift is a
compile error. The composition root computes `useFakeLlm = E2E_FAKE_LLM && import.meta.env.DEV`
once and picks fake vs real for both adapters. `mergeItems` dedupes its input and `generate`
builds the recipe from `mealContext` + items, so output is deterministic yet reflects the
user's inputs. Playwright sets the flag via `webServer.env`.

## Phases at a Glance

| Phase                | What it delivers                                        | Key risk                                                             |
| -------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| 1. Seam              | Fakes + flag + stub + composition-root swap + unit test | Empty recognition would 500 — fake must return ≥1 item               |
| 2. Playwright wiring | `webServer.env` flag + docs + E2E verification          | `reuseExistingServer` can serve a stale unflagged dev server locally |

**Prerequisites:** none (additive; no DB/API changes). Optional `E2E_USER_*` for the
authenticated project, which otherwise skips.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- The flag injected via `webServer.env` must actually reach the `astro dev` process's
  `astro:env/server` — verified in Phase 2's manual step (flow works without an API key).
- Locally, a pre-running `pnpm dev` is reused without the flag (CI always boots fresh) —
  documented in `playwright.config.ts`.
- `import.meta.env.DEV` is `true` under `astro dev` and `false` in the prod Worker build —
  the basis of the production guard.

## Success Criteria (Summary)

- With the flag on and no API key, the recipe flow completes from canned data; no OpenRouter traffic.
- With the flag off (default/prod), the real adapter is used unchanged.
- `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm test:e2e` all pass; the seam is ready for `/10x-e2e` to build specs on.
