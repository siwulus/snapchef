# Mock OpenRouter in E2E with a Fake Adapter Behind the Port — Implementation Plan

## Overview

Playwright E2E specs currently drive the real Astro dev server, which calls the paid
OpenRouter API server-side. We add a **test seam**: deterministic fake implementations
of the two LLM ports (`ProductRecognizer`, `RecipeGenerator`), selected at the single
middleware composition root, gated by a `E2E_FAKE_LLM` env flag plus a build-context
guard so the fakes can never run in production. Playwright boots its dev server with the
flag set. The result: E2E runs free, fast, deterministic, and offline (no API key
required), while exercising the genuine HTTP flow through our own `/api/**` routes.

This change delivers the **seam only** — it authors no Playwright specs. Writing the
recipe-flow specs that consume this seam is deferred to the project's `/10x-e2e` skill,
the declared source of truth for E2E spec authoring.

## Current State Analysis

- **OpenRouter is server-side.** `createProductRecognizer()` / `createRecipeGenerator()`
  are instantiated in `injectDependencies` (`src/middleware.ts:48-50`), running in the
  Astro SSR process. The browser never calls OpenRouter — so Playwright's `page.route()`
  (browser-network interception) cannot mock it. The mock must live in the server process
  Playwright spawns.
- **The two ports** (`src/lib/core/boundry/recipe/ports.ts:90-115`):
  - `ProductRecognizer.recognizePhoto(url) → Effect<RecognizedItem[]>` and
    `mergeItems(lists) → Effect<RecognizedItem[]>`.
  - `RecipeGenerator.generate({items, mealContext, allowExtraIngredients}) →
Effect<{name, contentMd}>`.
- **Domain shapes** (`src/lib/core/model/recipe/index.ts:17-26`): `RecognizedItem =
{ name (1–120, trimmed), quantity (1–60), context (≤280) }`; the generator returns
  `{ name, contentMd }`.
- **Flow constraint** (`RecipeSessionUC.ts:51-73, 280-290`): `recognizeProducts` fans out
  one `recognizePhoto` per photo (concurrency 5, 25 s timeout, retry 1, per-photo failure
  → `[]`), then calls `mergeItems` when more than one photo yielded items; if **every**
  list is empty it fails `SnapchefExternalSystemError` (500). The fake's `recognizePhoto`
  must therefore return a **non-empty** list. State machine: `created → photos_uploaded →
products_recognized → recipe_generated → saved`.
- **Composition root**: `injectDependencies` (`src/middleware.ts:38-55`) is the one place
  ports meet adapters; both LLM adapters are no-arg factories — trivial to swap.
- **Env**: declared in `astro.config.mjs` `env.schema`, read via `astro:env/server`. There
  is an existing `envField.boolean` precedent (`LOG_HTTP_BODIES`, line 44). Vitest aliases
  `astro:env/server` to `src/test/astro-env-server.stub.ts` (`vitest.config.ts:19`), which
  mirrors the schema defaults.
- **Playwright** (`playwright.config.ts`): `webServer.command = "pnpm dev --port 4321"`
  with **no `env` block**; `reuseExistingServer: !process.env.CI`. The `setup` project
  seeds an authenticated session via the real `/api/auth/signin`. No recipe-flow spec
  exists yet.
- **Scripts** (`package.json`): `pnpm test` (`vitest run`), `pnpm lint` (`eslint .`,
  type-checked), `pnpm build` (`astro build`), `pnpm test:e2e` (`playwright test`).

## Desired End State

With `E2E_FAKE_LLM=true` (and a dev build), the recipe flow (upload → recognize →
generate) completes end-to-end using deterministic canned data, **even with no
`OPENROUTER_API_KEY` set**, and makes zero outbound calls to `openrouter.ai`. With the
flag unset/false (the default, and always the case in the production Worker), the real
OpenRouter adapter is used exactly as today. Playwright's dev server runs with the flag
on. Verify by: running `E2E_FAKE_LLM=true pnpm dev` without an API key and walking the
flow (succeeds via fakes); and confirming the production build ignores the flag.

### Key Discoveries

- `page.route()` won't intercept OpenRouter — the call is server-side (`src/middleware.ts:48-50`).
- `recognizePhoto` must return a non-empty list or the flow 500s (`RecipeSessionUC.ts:283-288`).
- `import.meta.env.DEV` is a Vite build constant — `true` under `astro dev` (what Playwright
  boots), `false` in the Cloudflare Worker prod build — so it is a reliable production guard.
- The Vitest env stub must gain the new field, or any future test importing a module that
  reads `E2E_FAKE_LLM` from `astro:env/server` would get `undefined` (`vitest.config.ts:19`).

## What We're NOT Doing

- **Not authoring any Playwright spec** (`e2e/**/*.spec.ts`). The recipe-flow spec that
  consumes this seam is a separate `/10x-e2e` task.
- **Not mocking Supabase / storage.** The E2E flow still uses the configured (staging)
  Supabase; that is a pre-existing concern, out of scope here.
- **Not adding failure-path simulation** (timeout/refusal/500 from the fake). Those branches
  remain covered by `openrouter.test.ts`. The fakes are happy-path only.
- **Not adding per-port or per-scenario control.** A single flag toggles both fakes; output
  is fixed/derived, not request-varying.
- **Not changing the real `openrouter.ts` adapter** or its tests.

## Implementation Approach

Exploit the existing hexagonal seam. Add two fake factory adapters under
`infrastructure/llm/`, typed against the ports so the compiler rejects any drift. Declare a
single `E2E_FAKE_LLM` boolean in the env schema (and the Vitest stub). At the composition
root, compute `useFakeLlm = E2E_FAKE_LLM && import.meta.env.DEV` once and select fake vs
real for both adapters. Wire the flag into Playwright via `webServer.env`. Output is
input-derived where it's meaningful (`mergeItems` dedupes its input; `generate` builds the
recipe from `mealContext` + items) so specs can later assert that inputs propagated.

## Critical Implementation Details

- **Production guard placement.** The guard must be `E2E_FAKE_LLM && import.meta.env.DEV`,
  evaluated at the swap site in `src/middleware.ts`. `import.meta.env.DEV` is replaced at
  build time by Vite, so the fake branch is dead-code-eliminated from the production Worker
  bundle regardless of env. Do not gate on `astro:env` alone.
- **`reuseExistingServer` footgun.** Locally, if a `pnpm dev` is already running _without_
  the flag, Playwright reuses it and the real adapter stays active (silently). CI always
  boots fresh (`reuseExistingServer: !CI`), so CI is unaffected. This caveat must be
  documented in `playwright.config.ts` next to `webServer.env`.
- **Non-empty recognition.** `FakeProductRecognizer.recognizePhoto` must return ≥1 item;
  an empty list would trip the all-photos-failed 500 branch (`RecipeSessionUC.ts:283-288`).

## Phase 1: Fake LLM adapters, env flag, and composition-root selection

### Overview

Create the two fake adapters, declare and stub the flag, swap at the composition root
behind the production guard, and add a small Vitest test proving the fakes emit
schema-valid output.

### Changes Required:

#### 1. Fake product recognizer

**File**: `src/lib/infrastructure/llm/FakeProductRecognizer.ts` (new)

**Intent**: A deterministic, happy-path `ProductRecognizer` for E2E. `recognizePhoto`
returns a small fixed non-empty list of canned `RecognizedItem`s; `mergeItems` dedupes its
input by `name` (case-insensitive) and returns it — exercising real merge semantics so a
later spec can assert consolidation. No network, no API key.

**Contract**: `export const createFakeProductRecognizer = (): ProductRecognizer => ({ … })`.
Both methods return `Effect.succeed(...)`. Items must satisfy `RecognizedItem`
(`name` 1–120 trimmed, `quantity` 1–60, `context` ≤280). File is PascalCase after the port
(per `generic.md`). Type-only imports from `core`; `Effect` from `effect`.

#### 2. Fake recipe generator

**File**: `src/lib/infrastructure/llm/FakeRecipeGenerator.ts` (new)

**Intent**: A deterministic, happy-path `RecipeGenerator` for E2E. `generate` derives a
non-empty `name` and a markdown `contentMd` from the incoming `mealContext` and `items`
(and reflects `allowExtraIngredients`) so the output proves the user's inputs flowed
through. No network, no API key.

**Contract**: `export const createFakeRecipeGenerator = (): RecipeGenerator => ({ generate })`,
`generate` returns `Effect.succeed({ name, contentMd })` with both fields non-empty
(downstream `recipeRepository.upsert` + `RecipeGenerationResult` decode require strings).

#### 3. Declare the env flag

**File**: `astro.config.mjs`

**Intent**: Add a single server-side boolean flag that enables the fakes, defaulting to
false (off in prod).

**Contract**: New `env.schema` entry
`E2E_FAKE_LLM: envField.boolean({ context: "server", access: "public", default: false })`,
mirroring the existing `LOG_HTTP_BODIES` field.

#### 4. Mirror the flag in the Vitest env stub

**File**: `src/test/astro-env-server.stub.ts`

**Intent**: Keep the stub a faithful mirror of the schema so any test resolving
`astro:env/server` sees the new field.

**Contract**: Add `export const E2E_FAKE_LLM = false;`.

#### 5. Select fake vs real at the composition root

**File**: `src/middleware.ts`

**Intent**: In `injectDependencies`, choose the fake adapters when the flag is on **and**
the build is a dev build; otherwise use the real OpenRouter adapters. This is the one and
only selection site.

**Contract**: Import `E2E_FAKE_LLM` from `astro:env/server` and the two fake factories.
Compute `const useFakeLlm = E2E_FAKE_LLM && import.meta.env.DEV;` then pass
`useFakeLlm ? createFakeProductRecognizer() : createProductRecognizer()` and
`useFakeLlm ? createFakeRecipeGenerator() : createRecipeGenerator()` into the
`RecipeSessionUC` constructor (positions 4 and 6, per `RecipeSessionUC.ts:25-33`). The
`&& import.meta.env.DEV` guard is load-bearing — see Critical Implementation Details.

#### 6. Unit test for the fakes

**File**: `src/lib/infrastructure/llm/FakeLlm.test.ts` (new)

**Intent**: Lightweight Vitest coverage (not a Playwright spec) asserting the fakes return
schema-valid, non-empty output, so shape can't silently drift from the domain models.

**Contract**: Run each fake method via `Effect.runPromise` and assert: `recognizePhoto`
yields a non-empty `RecognizedItem[]` that decodes against `z.array(RecognizedItem)`;
`mergeItems` dedupes; `generate` yields non-empty `name`/`contentMd`. Follows the style of
`openrouter.test.ts`.

### Success Criteria:

#### Automated Verification:

- Type-checked lint passes: `pnpm lint`
- Unit tests pass (incl. new fake test): `pnpm test`
- Production build succeeds: `pnpm build`
- Formatting clean: `pnpm format` (no diff)

#### Manual Verification:

- With `E2E_FAKE_LLM=true pnpm dev` and **no `OPENROUTER_API_KEY`**, the upload → recognize
  → generate flow completes and produces a recipe from canned data (the real adapter would
  500 without a key — success proves the fake is engaged).
- With the flag unset (default), the flow uses the real adapter (e.g. requires the key /
  hits OpenRouter) — confirming the seam is off by default.

**Implementation Note**: After Phase 1's automated verification passes, pause for manual
confirmation before Phase 2. Phase blocks use plain bullets; the `## Progress` section owns
the checkboxes.

---

## Phase 2: Playwright wiring and end-to-end verification

### Overview

Make Playwright boot its dev server with the flag on, document the reuse caveat, and verify
the seam holds under an actual `pnpm test:e2e` run.

### Changes Required:

#### 1. Inject the flag into the Playwright dev server

**File**: `playwright.config.ts`

**Intent**: Ensure the dev server Playwright spawns runs with the fakes enabled, and record
the local `reuseExistingServer` caveat so a stale unflagged server doesn't confuse a dev.

**Contract**: Add `env: { E2E_FAKE_LLM: "true" }` to the `webServer` block (Astro's
`envField.boolean` coerces the `"true"` string). Update the file's top comment to state
that E2E runs against the fake LLM, and add a short note that a pre-running local
`pnpm dev` is reused as-is (CI always boots fresh).

### Success Criteria:

#### Automated Verification:

- Type-checked lint passes: `pnpm lint`
- The E2E suite runs against a flagged server: `pnpm test:e2e` passes (existing
  `public-access` + `recipes-authenticated` specs; the `authenticated` project still skips
  gracefully if `E2E_USER_*` are absent).

#### Manual Verification:

- During a fresh `pnpm test:e2e` run (no reused server), confirm the booted dev server has
  the fake active — e.g. the recipe flow works without `OPENROUTER_API_KEY`, or via a
  temporary log at the selection site.
- Confirm the production deploy is unaffected: the flag is absent from the Workers Builds
  env and `import.meta.env.DEV` is false there, so the real adapter is used.

**Implementation Note**: After Phase 2's automated verification passes, pause for manual
confirmation. Then the seam is ready for `/10x-e2e` to author recipe-flow specs on top of it.

---

## Testing Strategy

### Unit Tests:

- `FakeLlm.test.ts`: fakes return schema-valid, non-empty output; `mergeItems` dedupes;
  `generate` reflects its inputs.
- No changes to `openrouter.test.ts` (real adapter untouched).

### Integration / E2E Tests:

- No new Playwright specs in this change (deferred to `/10x-e2e`). Existing specs must keep
  passing under the flagged dev server.

### Manual Testing Steps:

1. `E2E_FAKE_LLM=true pnpm dev` with `OPENROUTER_API_KEY` unset → walk upload → recognize →
   generate → a recipe appears from canned data; no `openrouter.ai` traffic.
2. `pnpm dev` (flag unset) → confirm the real adapter path is taken.
3. `pnpm test:e2e` from a clean state (no reused dev server) → suite passes against the
   fake-enabled server.

## Migration Notes

None — additive only. New env field defaults to false; no DB, no schema, no API contract
changes. Backward compatible by construction.

## References

- Change identity: `context/changes/mock-openrouter-for-tests-e2e/change.md`
- Ports: `src/lib/core/boundry/recipe/ports.ts:90-115`
- Domain models: `src/lib/core/model/recipe/index.ts:17-82`
- Flow / constraints: `src/lib/core/uc/recipe/RecipeSessionUC.ts:51-123, 280-290`
- Composition root: `src/middleware.ts:38-55`
- Real adapter (pattern to mirror): `src/lib/infrastructure/llm/openrouter.ts:148-179`
- Env schema: `astro.config.mjs:17-46`; Vitest stub: `src/test/astro-env-server.stub.ts`
- Playwright: `playwright.config.ts`
- Conventions: `docs/reference/conventions/ports-and-adapters.md`, `generic.md`, `effect.md`
- E2E spec authoring (next step, out of scope here): the `/10x-e2e` skill

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Fake LLM adapters, env flag, and composition-root selection

#### Automated

- [x] 1.1 Type-checked lint passes: `pnpm lint` — 1db486b11
- [x] 1.2 Unit tests pass (incl. new fake test): `pnpm test` — 1db486b11
- [x] 1.3 Production build succeeds: `pnpm build` — 1db486b11
- [x] 1.4 Formatting clean: `pnpm format` (no diff) — 1db486b11

#### Manual

- [ ] 1.5 With `E2E_FAKE_LLM=true pnpm dev` and no `OPENROUTER_API_KEY`, the upload → recognize → generate flow completes from canned data
- [ ] 1.6 With the flag unset (default), the flow uses the real adapter

### Phase 2: Playwright wiring and end-to-end verification

#### Automated

- [x] 2.1 Type-checked lint passes: `pnpm lint`
- [x] 2.2 E2E suite runs against a flagged server: `pnpm test:e2e` passes

#### Manual

- [ ] 2.3 On a fresh `pnpm test:e2e` run, the booted dev server has the fake active
- [ ] 2.4 Production deploy unaffected: flag absent and `import.meta.env.DEV` false → real adapter used
