# Recipe Generation from List Implementation Plan

## Overview

Implement **S-02: recipe generation** — after the user reviews and edits the consolidated product list, they write a free-text meal context, set a toggle indicating whether the recipe may use ingredients **not** on their list, and generate a recipe. The server calls OpenRouter (strict JSON-schema structured output), receives `{ name, content }`, persists the recipe (idempotently, one per session), transitions the session to `recipe_generated`, and returns the recipe for display. Saving / finalizing the session is a later use case (S-03) and is out of scope here.

This feature is the **text-only sibling of photo recognition (S-01)** and reuses that hexagon almost verbatim: a port in `core/boundry/recipe`, a factory adapter in `infrastructure/llm`, a UC method on `RecipeSessionUC`, a thin `runApiRoute` route, and middleware wiring.

## Current State Analysis

- **Persistence already exists and is unused.** The `Recipe` domain model (`{ id, sessionId, userId, contentMd, createdAt, name }`, `src/lib/core/model/recipe/index.ts:72-81`) and the `recipes` table (`session_id` **UNIQUE** → one recipe per session, `content_md` CHECK ≤16000, full per-operation RLS + a user-id drift-guard trigger; `supabase/migrations/20260530100000_domain_schema_and_storage.sql:30-39,70-125`) are in place. The `recipe_generated` state already exists in the enum (`model/recipe/index.ts:4-12`) and is set by no code yet.
- **The OpenRouter transport is reusable.** `completeStructured`, `toStrictJsonSchema`, `extractContent`, and the "every model-output failure → `SnapchefExternalSystemError` (500)" posture all live in `src/lib/infrastructure/llm/openrouter.ts:30-92`. Today it **hardcodes** the recognition model pair (`:42`) and sets no `temperature`/`max_tokens` — it must be parameterized to serve a second use case.
- **Inputs are never persisted today.** `correctedItems` and `mealContext` columns exist on `recipe_sessions` and are covered by `RecipeSessionUpdatePayload` (`boundry/recipe/ports.ts:7-12`), but no current code writes them — the edited list in `ProductListEditor` is client-only (`useEditableItems.toCorrectedItems()` produces the shape but is wired to nothing).
- **There is no toggle column.** `recipe_sessions` has no field for the off-list-ingredients flag.
- **Client wizard is a 2-step machine** (`upload | review`, `RecipeWizard.tsx:6-40`). `ReviewStep` shows per-photo cards + `ProductListEditor`, which **owns `useEditableItems` internally** (state not lifted). There is **no markdown renderer dependency** and **no shadcn `switch` primitive** (only `button, card, form, input, label, sonner, textarea`).
- **No OpenRouter mock test exists** — this feature introduces the first; the closest mock pattern is `SupabaseAuthenticator.test.ts`.

## Desired End State

A signed-in user who has reached the review screen can: type a meal context, toggle "may use ingredients beyond my list" (default **on**), press **Generuj przepis**, see a spinner (≤~30 s), and then read a rendered markdown recipe (AI-generated name + `## Składniki` / `## Przygotowanie`). Server-side: `correctedItems`, `mealContext`, and `allow_extra_ingredients` are persisted on the session, a `recipes` row is upserted (overwrite-safe), and the session state is `recipe_generated`. A generation failure shows a Polish retry message and leaves the session re-runnable.

Verify by: running the wizard end-to-end against the dev app; confirming a `recipes` row and the updated session in Supabase; re-running generation for the same session and seeing the row overwritten (not duplicated, not erroring); `pnpm lint`, `pnpm build`, and the new unit/component tests passing.

### Key Discoveries:

- Recognition is the blueprint: route (`src/pages/api/recipe-sessions/[id]/recognition.ts`), UC resilience (`RecipeSessionUC.ts:121-159`), repository adapter (`infrastructure/db/RecipeSessionRepository.ts`), `…FromRow` converters (`infrastructure/db/types/converters.ts`), and the client upload hook (`components/recipes/wizard/useRecipeUpload.ts`) are all direct templates.
- `toRecipeSessionUpdate` (`RecipeSessionRepository.ts:36-46`) filters `value != null`, so a boolean `false` is preserved (only `null`/`undefined` are dropped) — the new flag maps cleanly.
- OpenRouter's `models: [...]` array falls back only on **provider-side** errors; a well-formed response that fails the zod decode (or is truncated) is an HTTP success to OpenRouter. The UC-layer `Effect.retry({ times: 1 })` is the **only** thing that re-rolls a bad generation — load-bearing here.

## What We're NOT Doing

- **No "reject & regenerate" UI / recipe history** — PRD FR-008 scope-down. The persistence is an idempotent **upsert** purely for retry-safety, not a regenerate feature.
- **No save / finalize flow** (FR-009, the `saved` state) — that is S-03.
- **No streaming** — non-streaming generate→persist→return per the change notes; streaming is the documented escape hatch only if the ~30 s NFR is later threatened.
- **No recipe metadata** (servings / time / difficulty) — PRD-deferred to v2.
- **No second LLM call to pre-classify the free text** — the free text + toggle go straight into one generation call.
- **No structured meal-context fields** — one free-text field + one boolean toggle only (PRD FR-006 rejected multi-select fields).

## Implementation Approach

Build server-up: persistence foundation → LLM generator → use case/route/wiring → client. Each layer mirrors the recognition feature so the patterns are already proven. The toggle is a **soft preference** baked into the system prompt (not a hard whitelist), persisted for provenance, and surfaced as a shadcn `Switch` defaulting to on.

## Critical Implementation Details

- **Transport parameterization is a prerequisite, not a rewrite.** `openrouter.ts` currently hardcodes the recognition model pair and omits sampling params. `sendChatRequest` / `completeStructured` must take the model pair and optional `temperature`/`max_tokens` so both `createProductRecognizer` (unchanged behavior: recognition models, no sampling override) and `createRecipeGenerator` (recipe models, `temperature: 0.7`, `max_tokens: 2000`) share one transport. Keep recognition's existing behavior byte-for-byte.
- **Truncation is the deadliest failure and is currently invisible.** A response cut at `max_tokens` mid-JSON is unparseable. `extractContent` (or `completeStructured`) must inspect `result.choices[0]?.finishReason` (camelCase; typed `ChatFinishReasonEnum | null` — the wire `finish_reason` is mapped to `finishReason` by the SDK) and the message `refusal` field, failing with a clear `SnapchefExternalSystemError` **before** `JSON.parse`, so the 1-retry is meaningful and logs are legible.
- **Persist inputs before generating, set state after persisting the recipe.** If generation fails after the input write, the session keeps `products_recognized` (re-runnable) with provenance saved. Order: update `{ correctedItems, mealContext, allowExtraIngredients }` → generate (timeout+retry) → upsert recipe → update `{ state: "recipe_generated" }` → return.
- **Migration must be additive/nullable.** `allow_extra_ingredients boolean` (no `NOT NULL`, no default required) so a Worker rollback is safe and existing rows stay valid; the domain field is therefore `boolean | null`.

---

## Phase 1: Persistence & Domain Foundation

### Overview

Add the toggle column, regenerate DB types, extend the session model/converter/update-payload to carry the flag, add the `RecipeFromRow` decoder, and add a `RecipeRepository` port + upsert adapter. No LLM or client work yet.

### Changes Required:

#### 1. Migration — toggle column

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_add_recipe_session_allow_extra_ingredients.sql`

**Intent**: Add the nullable, additive column that stores the off-list-ingredients toggle for provenance. No RLS change (existing per-row policies already cover the column).

**Contract**: `alter table public.recipe_sessions add column if not exists allow_extra_ingredients boolean;` — nullable, no default, non-destructive (CLAUDE.md hard rule).

#### 2. Regenerate DB types

**File**: `src/lib/infrastructure/db/types/index.ts` (generated) via `pnpm db:types`

**Intent**: Pull the new column into the generated `Database` types so `RecipeSessionRow`/`Update` include `allow_extra_ingredients`.

**Contract**: Run `pnpm db:types` after the migration applies locally; commit the regenerated file (excluded from ESLint/Prettier).

#### 3. Session model + converter + update mapping

**Files**: `src/lib/core/model/recipe/index.ts`, `src/lib/infrastructure/db/types/converters.ts`, `src/lib/infrastructure/db/RecipeSessionRepository.ts`

**Intent**: Surface the flag through the domain. Add `allowExtraIngredients` to `RecipeSession`, map it in `RecipeSessionFromRow`, and add it to the snake_case write mapping. `RecipeSessionUpdatePayload` picks it up automatically once it's on the model (it's a `.pick().partial()`).

**Contract**:

- `RecipeSession` gains `allowExtraIngredients: z.boolean().nullable()`.
- `RecipeSessionFromRow` adds `allowExtraIngredients: row.allow_extra_ingredients`.
- Add `RecipeSession.pick({ … })` in `boundry/recipe/ports.ts` (`RecipeSessionUpdatePayload`) to include `allowExtraIngredients: true`.
- `toRecipeSessionUpdate` adds the tuple `["allow_extra_ingredients", data.allowExtraIngredients]`. (The existing `value != null` filter preserves `false`.)

#### 4. `RecipeFromRow` decoder

**File**: `src/lib/infrastructure/db/types/converters.ts`

**Intent**: Bridge a `recipes` row to the `Recipe` domain model, mirroring `RecipeSessionFromRow`/`PhotoFromRow`.

**Contract**: `RecipeFromRow = RecipeRow.transform(row => ({ id, sessionId: row.session_id, userId: row.user_id, contentMd: row.content_md, createdAt: row.created_at, name: row.name })).pipe(Recipe)`.

#### 5. `RecipeRepository` port + write payload

**File**: `src/lib/core/boundry/recipe/ports.ts`

**Intent**: Declare the persistence contract for a recipe — an idempotent upsert keyed on session, returning the saved `Recipe`. Absence-on-read is not needed for S-02, so no `Option` finder yet.

**Contract**:

- `RecipeWritePayload = Recipe.pick({ sessionId: true, userId: true, name: true, contentMd: true })`.
- `interface RecipeRepository { upsert(payload: RecipeWritePayload): Effect.Effect<Recipe, SnapchefServerError>; }`

#### 6. `RecipeRepository` adapter

**File**: `src/lib/infrastructure/db/RecipeRepository.ts`

**Intent**: Implement the port over Supabase with an overwrite-safe upsert on the UNIQUE `session_id`, decoding the returned row through `RecipeFromRow`. Factory named after the port; `: RecipeRepository` return-type anchor.

**Contract**: `createRecipeRepository(supabase): RecipeRepository`; `upsert` lifts `supabase.from("recipes").upsert({ session_id, user_id, name, content_md }, { onConflict: "session_id" }).select("*").single().then(({error,data}) => ({error,data}))` through `tryErrorDataWithSchema(RecipeFromRow)`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against the local stack: `pnpm exec supabase migration up` (or restart)
- `pnpm db:types` regenerates without diff churn beyond the new column
- Type checking passes: `pnpm lint` (type-checked rules)
- Build passes: `pnpm build`

#### Manual Verification:

- The new migration is additive only (no drop/alter-type/not-null) — a Worker rollback leaves the DB valid
- A row inserted into `recipes` round-trips through `RecipeFromRow` to a valid `Recipe` (spot-check via a scratch query or the Phase 3 UC test)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: LLM Recipe Generator

### Overview

Add recipe model env vars, parameterize the OpenRouter transport (model pair + sampling) and harden it with a `finish_reason`/`refusal` check, author the recipe system prompt + message builder, and add the `RecipeGenerator` port + adapter. Cover with the repo's first OpenRouter mock test.

### Changes Required:

#### 1. Recipe model env vars

**File**: `astro.config.mjs`

**Intent**: Add the recipe model pair, reusing the single `OPENROUTER_API_KEY` secret. Public access, with defaults, matching the recognition vars.

**Contract**: `OPENROUTER_RECIPE_MODEL` (default `openai/gpt-4.1-mini`) and `OPENROUTER_RECIPE_FALLBACK_MODEL` (default `openai/gpt-4o-mini`), both `context: "server", access: "public"`. (Re-verify model availability/pricing at implementation time per research §E.) **Also add both vars to the test env stub `src/test/astro-env-server.stub.ts`** — that file is aliased to `astro:env/server` under Vitest (`vitest.config.ts`) and explicitly mirrors the schema defaults; `openrouter.ts` imports these at module scope, so any test importing it breaks if they're absent.

#### 2. Parameterize the transport + add truncation/refusal guard

**File**: `src/lib/infrastructure/llm/openrouter.ts`

**Intent**: Let one transport serve two use cases. `sendChatRequest` / `completeStructured` take the model pair and optional sampling params; recognition keeps its exact current behavior (recognition models, no sampling). Add a `finish_reason === "length"` and `refusal` check so truncation/refusal surface as a clear `SnapchefExternalSystemError` before `JSON.parse`.

**Contract**:

- `completeStructured` params gain `models: [string, string]` and optional `temperature?: number`, `maxTokens?: number`; `sendChatRequest` threads them into `chatRequest` (`models`, `temperature`, `maxTokens`). Recognition call sites pass `[OPENROUTER_RECOGNITION_MODEL, OPENROUTER_RECOGNITION_FALLBACK_MODEL]` with no sampling.
- Extend `extractContent` (or add a guard step before it) to read `result.choices[0]?.finishReason` (camelCase; `ChatFinishReasonEnum | null`) and `result.choices[0]?.message.refusal`; fail `new SnapchefExternalSystemError({ message: "Model output truncated" })` on the enum's length member (verify its concrete value/spelling against `ChatFinishReasonEnum` at impl time) and a refusal message otherwise. Keep the "model output is an external contract → 500" posture.

#### 3. Recipe prompt + message builder

**File**: `src/lib/infrastructure/llm/prompts.ts`

**Intent**: Author a durable system prompt (the per-request data is the user prompt) encoding: role; **soft-preference branching on the toggle** (on → may add other commonly-available ingredients; off → strongly prefer using only the listed products, adding only what's genuinely needed); treat `quantity` as approximate and never invent brands/weights; **all output in Polish**; and a markdown skeleton (`## Składniki` bullet list, `## Przygotowanie` numbered list). The dish name belongs **only** in the `name` field — `content` must start at `## Składniki` and must **not** repeat the title/name (RecipeDisplay renders `name` as its own heading above the body, so a title inside `content` would show twice). The free text is **quarantined** — fenced and framed as _preferences to satisfy_, never instructions that override the rules. No few-shot example.

**Contract**: `buildRecipeMessages(input: { items: RecognizedItem[]; mealContext: string; allowExtraIngredients: boolean }): ChatMessages[]` — `system` = the recipe contract; `user` = `JSON.stringify({ items })` + a fenced free-text block + an explicit line stating whether off-list ingredients are allowed. Model the structure on `buildMergeMessages` (`prompts.ts:55-58`).

#### 4. `RecipeGenerator` port + adapter

**Files**: `src/lib/core/boundry/recipe/ports.ts`, `src/lib/infrastructure/llm/openrouter.ts`

**Intent**: Declare the generation contract and implement it as a second factory over the shared transport. The model returns `{ name, content }`; the adapter maps `content → contentMd` so the port speaks the domain's vocabulary.

**Contract**:

- Port: `interface RecipeGenerator { generate(input: { items: RecognizedItem[]; mealContext: string; allowExtraIngredients: boolean }): Effect.Effect<{ name: string; contentMd: string }, SnapchefServerError>; }`
- Adapter: a module-scoped `RecipeResult = z.object({ name: z.string().min(1).max(200), content: z.string().min(1).max(16000) })`; `createRecipeGenerator(): RecipeGenerator` calling `completeStructured({ messages: buildRecipeMessages(input), schema: RecipeResult, schemaName: "generated_recipe", models: [OPENROUTER_RECIPE_MODEL, OPENROUTER_RECIPE_FALLBACK_MODEL], temperature: 0.7, maxTokens: 2000 })`, mapping `{ name, content }` → `{ name, contentMd: content }`, with `logResult("llm.recipe")`.

#### 5. OpenRouter generator test (first of its kind)

**File**: `src/lib/infrastructure/llm/openrouter.test.ts`

**Intent**: Assert that `createRecipeGenerator().generate(...)`: decodes a well-formed `{ name, content }` to `{ name, contentMd }`; fails with the truncation error on a `finishReason: "length"` response; and fails as `SnapchefExternalSystemError` (never `SnapchefValidationError`) on a non-JSON / schema-mismatch response.

**Contract**: This adapter is **not** constructor-injected — unlike `SupabaseAuthenticator` (which takes a fakeable client arg), the OpenRouter client is built at module scope behind an env-gated Effect (`const client = Effect.fromNullable(OPENROUTER_API_KEY)…new OpenRouter(...)`). The test therefore needs **module mocking**, not a fake object:

- **API key present**: the shared stub sets `OPENROUTER_API_KEY = undefined`, which short-circuits `completeStructured` to "not configured" before the SDK is touched. Supply a key for the happy path via a test-local `vi.mock("astro:env/server", () => ({ …, OPENROUTER_API_KEY: "test-key", OPENROUTER_RECIPE_MODEL: "…", OPENROUTER_RECIPE_FALLBACK_MODEL: "…" }))`.
- **SDK stubbed**: `vi.mock("@openrouter/sdk")` so the `OpenRouter` class's `chat.send` returns canned `ChatResult`s (well-formed, `finishReason: "length"`, non-JSON) per case.
- Run the returned Effect (`Effect.runPromise` / `runPromiseExit`) and assert the success value and the failure `_tag`. Note the module-scope `client` is evaluated on import — set up `vi.mock` before importing `openrouter.ts` (hoisted mocks or dynamic `import()` per test).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm lint`
- New transport test passes: `pnpm test` (or `pnpm exec vitest run src/lib/infrastructure/llm`)
- Recognition behavior unchanged (existing tests/build green): `pnpm build`

#### Manual Verification:

- A real generation call (dev, with `OPENROUTER_API_KEY`) returns a Polish recipe with both `## Składniki` and `## Przygotowanie` sections
- Toggling the flag visibly changes whether off-list ingredients appear (smoke check)
- A deliberately tiny `max_tokens` reproduces the truncation error path as a clean 500 (optional spot-check)

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Use Case, Route & Wiring

### Overview

Add the generation command + recipe-view response schemas, the `generateRecipe` UC method (with two new constructor deps and timeout+retry), the API route, and the middleware wiring. Cover the UC with a fake-port unit test.

### Changes Required:

#### 1. Generation command schema

**File**: `src/lib/core/boundry/recipe/commands.ts` (new)

**Intent**: The driving-side input shared by the React form and the API route. Carries the edited list, the free text, and the toggle.

**Contract**: `RecipeGenerationCommand = z.object({ correctedItems: z.array(RecognizedItem).min(1), mealContext: z.string().max(2000), allowExtraIngredients: z.boolean() })` (+ inferred type, same name). Re-export from `boundry/recipe/index.ts`.

#### 2. Recipe-view response schema

**File**: `src/lib/core/boundry/recipe/responses.ts`

**Intent**: The success payload the client validates against — a lean recipe view (no `userId`).

**Contract**: `RecipeView = Recipe.omit({ userId: true })` (id, sessionId, name, contentMd, createdAt) (+ inferred type). Re-export via the barrel.

#### 3. `generateRecipe` UC method

**File**: `src/lib/core/uc/recipe/RecipeSessionUC.ts`

**Intent**: Orchestrate the flow: fetch session → persist inputs (provenance) → generate (resilient) → upsert recipe → mark `recipe_generated` → return the recipe. Add `recipeRepository: RecipeRepository` and `recipeGenerator: RecipeGenerator` constructor deps. Wrap the generate call in `Effect.timeout("30 seconds")` + `Effect.retry({ times: 1 })`, mirroring `recognizeEachPhoto` (`:121-138`).

**Contract**: `generateRecipe(userId: string, sessionId: string, command: RecipeGenerationCommand): Effect.Effect<Recipe, SnapchefServerError>`. Steps:

1. `fetchRecipeSession(userId, sessionId)` (reuse private helper).
2. `sessionRepository.update(userId, sessionId, { correctedItems, mealContext, allowExtraIngredients })` → `getOrThrowNotFound`.
3. `recipeGenerator.generate({ items: command.correctedItems, mealContext: command.mealContext, allowExtraIngredients: command.allowExtraIngredients })` with timeout + 1 retry.
4. `recipeRepository.upsert({ sessionId, userId, name, contentMd })`.
5. `sessionRepository.update(userId, sessionId, { state: "recipe_generated" })` → `getOrThrowNotFound`.
6. Return the `Recipe`; `logResult("recipe.generate")`.

#### 4. API route

**File**: `src/pages/api/recipe-sessions/[id]/recipe-generation.ts` (new)

**Intent**: Thin `runApiRoute` route mirroring `recognition.ts` — auth + id + body, delegate to the UC, shape the response as `RecipeView`.

**Contract**: `export const prerender = false;` `POST` = `runApiRoute(Effect.all([validateAuthUser(user), decodeWith(RecipeSessionId)(params.id), parseRequestBody(request, RecipeGenerationCommand)]).pipe(Effect.flatMap(([u, id, cmd]) => recipeSessions.generateRecipe(u.id, id, cmd)), Effect.flatMap(decodeWith(RecipeView))))`.

#### 5. Middleware wiring

**File**: `src/middleware.ts`

**Intent**: Bind the two new adapters to the `RecipeSessionUC` constructor in the single composition root. No `env.d.ts` change — `recipeSessions` is already declared on `App.Locals`.

**Contract**: Import `createRecipeRepository` and `createRecipeGenerator`; extend the `new RecipeSessionUC(...)` call (`:43-48`) with `createRecipeRepository(supabase)` and `createRecipeGenerator()`.

#### 6. UC unit test

**File**: `src/lib/core/uc/recipe/RecipeSessionUC.test.ts` (new or extend)

**Intent**: With fake ports, assert `generateRecipe` persists inputs, calls the generator, upserts the recipe, transitions state, and returns the recipe — and that a generator failure leaves state untouched (no `recipe_generated`, no recipe write) and surfaces the error.

**Contract**: Vitest test injecting in-memory fakes for `RecipeSessionRepository`, `RecipeGenerator`, `RecipeRepository` (others stubbed); assert call order/state and the failure path.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm lint`
- UC + transport tests pass: `pnpm test`
- Build passes: `pnpm build`

#### Manual Verification:

- `curl`/REST call to `POST /api/recipe-sessions/{id}/recipe-generation` with a valid body returns `{ ok: true, data: <RecipeView> }`; the session row shows persisted inputs + `recipe_generated`; a `recipes` row exists
- Re-posting for the same session overwrites the recipe row (no duplicate, no UNIQUE error)
- Posting with an empty `correctedItems` returns a 400 validation envelope

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Client Wizard

### Overview

Add the shadcn `switch` primitive and markdown rendering deps, lift `useEditableItems` into `ReviewStep`, build the generation panel (textarea + toggle + button) and the `useRecipeGeneration` hook, render the recipe with `RecipeDisplay`, and extend the wizard step machine to `upload → review → recipe`.

### Changes Required:

#### 1. Dependencies & primitives

**Files**: `package.json`, `src/styles/global.css`, `src/components/ui/switch.tsx` (generated)

**Intent**: Add markdown rendering and the toggle primitive. `react-markdown` renders the content inside a Tailwind `prose` container; `@tailwindcss/typography` provides `prose` (Tailwind 4 → register via `@plugin "@tailwindcss/typography";` in `global.css`). The shadcn `Switch` is the toggle.

**Contract**: `pnpm add react-markdown @tailwindcss/typography`; add `@plugin "@tailwindcss/typography";` to `global.css`; `pnpm dlx shadcn@latest add switch`.

#### 2. Lift `useEditableItems` into `ReviewStep`; make `ProductListEditor` controlled

**Files**: `src/components/recipes/wizard/ReviewStep.tsx`, `src/components/recipes/wizard/ProductListEditor.tsx`, `src/components/recipes/wizard/ProductListEditor.test.tsx`

**Intent**: The generate action needs the edited list's `toCorrectedItems()` projection, so the hook must live in the parent. `ReviewStep` calls `useEditableItems(result.session.recognizedItems)` and passes the `UseEditableItems` object to `ProductListEditor` as props; the editor stops calling the hook itself. Behavior is unchanged — this is a state-lift refactor.

**Contract**: `ProductListEditor` prop becomes the `UseEditableItems` instance (or its fields) instead of `recognizedItems`. Update `ProductListEditor.test.tsx` to drive the lifted hook (or render through a small harness). No change to `useEditableItems` itself.

#### 3. Generation panel

**File**: `src/components/recipes/wizard/RecipeGenerationPanel.tsx` (new), rendered inside `ReviewStep`

**Intent**: Below the product list: a `mealContext` textarea with a Polish guiding hint making the user conscious of their influence; a `Switch` labelled for off-list ingredients, **default on**; and a **Generuj przepis** button. On submit it reads `toCorrectedItems()` from the lifted hook and calls `useRecipeGeneration`.

**Contract**: Props include the session id (`result.session.id`), the `toCorrectedItems` getter, and an `onGenerated(recipe: RecipeView)` callback. Toggle state defaults to `true`. Textarea uses the existing `ui/textarea` + `ui/label`. The hint text explains: on = "mogę dodać produkty spoza listy", off = "trzymaj się moich produktów".

#### 4. `useRecipeGeneration` hook

**File**: `src/components/recipes/wizard/useRecipeGeneration.ts` (new)

**Intent**: Own the generate workflow + UI state, mirroring `useRecipeUpload`. One pipe-first Effect chain, one `runPromise`, branch on `result.ok`; success → `onGenerated`; failure → a generic Polish retry message (transport errors already toasted by `useApiClient`). Phase drives a spinner; expose a `retry`.

**Contract**: `useRecipeGeneration(sessionId, onGenerated)` returns `{ phase, error, isBusy, generate(command), retry, clearError }`. `generate` posts `RecipeGenerationCommand` to `/api/recipe-sessions/${sessionId}/recipe-generation` with the `RecipeView` schema via `useApiClient().post`. Loader copy: "Generowanie przepisu… to może potrwać do 30 s" (mirror `useRecipeUpload.LOADER_MESSAGE`).

#### 5. `RecipeDisplay`

**File**: `src/components/recipes/wizard/RecipeDisplay.tsx` (new)

**Intent**: Render the generated recipe — the AI name as a heading and `contentMd` via `react-markdown` inside a `prose` container.

**Contract**: `RecipeDisplay({ recipe: RecipeView })`; markdown wrapped in `<div className="prose ...">` (merge classes with `cn()`).

#### 6. Wizard step machine

**File**: `src/components/recipes/wizard/RecipeWizard.tsx`

**Intent**: Add a `recipe` step. Hold the generated recipe in state; `ReviewStep`'s `onGenerated` sets it and advances `step` to `recipe`, which renders `RecipeDisplay`. Keep the existing leave-guard.

**Contract**: `type Step = "upload" | "review" | "recipe"`; new `recipe: RecipeView | null` state; render `RecipeDisplay` when `step === "recipe"`. `ReviewStep` gains an `onGenerated` prop.

#### 7. Component tests

**Files**: `RecipeDisplay.test.tsx` (new), `RecipeGenerationPanel.test.tsx` (new), updated `ProductListEditor.test.tsx`

**Intent**: Assert the markdown renders headings/lists (not literal `##`), the toggle defaults on and flips, the generate button is disabled when the list projects to empty, and the lifted-state editor still adds/removes/edits rows. Use the established Vitest 4 + RTL/jsdom setup.

**Contract**: RTL tests using `getByRole`/`getByLabelText`/`getByText`; no CSS/structure selectors.

### Success Criteria:

#### Automated Verification:

- Type checking + lint passes: `pnpm lint`
- All component tests pass: `pnpm test`
- Build passes: `pnpm build`

#### Manual Verification:

- Full wizard works end-to-end in the dev app: upload → recognize → edit list → type context → toggle → generate → see rendered recipe
- The spinner shows during generation and a failure shows the Polish retry message with a working retry
- Markdown renders cleanly (headings + ingredient/step lists) and is readable on a mobile viewport
- Toggling off vs on produces visibly different ingredient usage in the generated recipe

**Implementation Note**: Final phase — confirm the end-to-end manual flow before closing the change.

---

## Testing Strategy

### Unit Tests:

- **OpenRouter generator** (`openrouter.test.ts`): happy path decode, truncation (`finish_reason: "length"`), refusal, non-JSON, schema mismatch → all `SnapchefExternalSystemError`.
- **`generateRecipe` UC** (`RecipeSessionUC.test.ts`): success orchestration + state transition; generator-failure leaves state/recipe untouched.
- **`RecipeFromRow`**: a valid row decodes; a malformed row fails (covered via the UC/adapter test).

### Integration Tests:

- Manual REST exercise of `POST .../recipe-generation` (success, re-generate overwrite, empty-list 400) — see Phase 3 manual criteria.

### Manual Testing Steps:

1. Run the wizard end-to-end against the dev app (`pnpm dev`, real `OPENROUTER_API_KEY`).
2. Generate with the toggle **on**, confirm a cookable recipe that may include off-list staples.
3. Re-open/re-run generation for the same session; confirm the `recipes` row is overwritten, not duplicated.
4. Generate with the toggle **off**; confirm the recipe stays close to the listed products.
5. Force a failure (e.g. invalid key) and confirm the Polish retry message + retry.

## Performance Considerations

- Non-streaming, `max_tokens: 2000` on a non-reasoning model → typically a few seconds on the **happy path**, which is what the ~30 s NFR targets ("przy normalnych warunkach sieci", roadmap S-02 risk). Cloudflare Workers impose no wall-clock limit while the client is connected and don't count `fetch` wait as CPU time — client-perceived latency is the only real budget.
- **Retry-path caveat:** `Effect.timeout("30 seconds")` + `Effect.retry({ times: 1 })` means a timed-out attempt is retried for another window → **worst case ≈ 2× the per-attempt timeout (~60 s)** on the failure path. This is the abnormal path (the NFR governs normal conditions) and matches the recognition pattern (25 s + 1 retry ≈ 50 s), but the spinner copy "do 30 s" under-promises here — acceptable for an MVP, revisit if retries prove common. The SDK's `retryConfig: { strategy: "none" }` prevents a hidden double-retry on top.

## Migration Notes

- Single additive/nullable column (`allow_extra_ingredients boolean`) — backward-compatible for a Worker rollback (CLAUDE.md hard rule). No data backfill; existing rows read as `null` → domain `null`.
- Production deploys are owned by Cloudflare Workers Builds on push to `main`; do not `wrangler deploy`.

## References

- Related research: `context/changes/recipe-generation-from-list/research.md`
- Recognition blueprint (route/UC/adapter): `src/pages/api/recipe-sessions/[id]/recognition.ts`, `src/lib/core/uc/recipe/RecipeSessionUC.ts:121-159`, `src/lib/infrastructure/db/RecipeSessionRepository.ts`
- Transport to extend: `src/lib/infrastructure/llm/openrouter.ts:30-117`, prompts: `src/lib/infrastructure/llm/prompts.ts:55-58`
- Client upload hook template: `src/components/recipes/wizard/useRecipeUpload.ts`
- PRD: `context/foundation/prd.md:80-87,109-117` (FR-006/007/008 + business logic)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Persistence & Domain Foundation

#### Automated

- [x] 1.1 Migration applies cleanly against the local stack (`pnpm exec supabase migration up`)
- [x] 1.2 `pnpm db:types` regenerates with only the new column added
- [x] 1.3 Type checking passes (`pnpm lint`)
- [x] 1.4 Build passes (`pnpm build`)

#### Manual

- [ ] 1.5 New migration is additive only — Worker rollback leaves the DB valid
- [ ] 1.6 A `recipes` row round-trips through `RecipeFromRow` to a valid `Recipe`

### Phase 2: LLM Recipe Generator

#### Automated

- [ ] 2.1 Type checking passes (`pnpm lint`)
- [ ] 2.2 New transport test passes (`pnpm exec vitest run src/lib/infrastructure/llm`)
- [ ] 2.3 Recognition behavior unchanged; build passes (`pnpm build`)

#### Manual

- [ ] 2.4 A real generation call returns a Polish recipe with `## Składniki` and `## Przygotowanie`
- [ ] 2.5 Toggling the flag visibly changes off-list ingredient usage (smoke check)
- [ ] 2.6 Truncation path reproduces as a clean 500 (optional spot-check)

### Phase 3: Use Case, Route & Wiring

#### Automated

- [ ] 3.1 Type checking passes (`pnpm lint`)
- [ ] 3.2 UC + transport tests pass (`pnpm test`)
- [ ] 3.3 Build passes (`pnpm build`)

#### Manual

- [ ] 3.4 `POST .../recipe-generation` returns `{ ok: true, data: RecipeView }`; session shows persisted inputs + `recipe_generated`; recipe row exists
- [ ] 3.5 Re-posting overwrites the recipe row (no duplicate, no UNIQUE error)
- [ ] 3.6 Empty `correctedItems` returns a 400 validation envelope

### Phase 4: Client Wizard

#### Automated

- [ ] 4.1 Type checking + lint passes (`pnpm lint`)
- [ ] 4.2 All component tests pass (`pnpm test`)
- [ ] 4.3 Build passes (`pnpm build`)

#### Manual

- [ ] 4.4 Full wizard works end-to-end (upload → recognize → edit → context → toggle → generate → rendered recipe)
- [ ] 4.5 Spinner shows during generation; failure shows the Polish retry message with working retry
- [ ] 4.6 Markdown renders cleanly and is readable on a mobile viewport
- [ ] 4.7 Toggle off vs on produces visibly different ingredient usage
