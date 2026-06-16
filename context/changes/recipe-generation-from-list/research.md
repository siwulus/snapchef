---
date: 2026-06-16T07:53:56Z
researcher: siwulus
git_commit: 64de913f7cb468b3b72f69a6401125691fc8d3d3
branch: main
repository: snapchef
topic: "Best LLM strategy for generating a recipe from a corrected ingredient list + free-text description (OpenAI via OpenRouter), within the Snapchef stack"
tags: [research, codebase, recipe-generation, llm, openrouter, structured-output, s-02]
status: complete
last_updated: 2026-06-16
last_updated_by: siwulus
---

# Research: LLM strategy for recipe generation from list (S-02)

**Date**: 2026-06-16T07:53:56Z
**Researcher**: siwulus
**Git Commit**: 64de913f7cb468b3b72f69a6401125691fc8d3d3
**Branch**: main
**Repository**: snapchef

## Research Question

What is the best strategy for generating a cooking recipe with an LLM, given (a) a corrected list of recognized ingredients and (b) a free-text user description of expectations for the recipe? Which OpenAI model (via OpenRouter) and which prompting / structured-output approach yield the best results — and how does this map onto the already-chosen tech stack? Delivery is **non-streaming: generate → persist → return**.

Per the change notes (`change.md`): below the corrected ingredient list there is a **textarea** for free text where the customer states wishes (e.g. "only my products" vs "you may add others"), with a guiding hint. The edited items + description go to the server, the recipe (AI-generated **name** + markdown **content**) is generated and **saved before returning**; finalizing the session is a later use case (S-03).

## Summary

**The feature is mostly additive code on top of an integration pattern that already exists.** The product-recognition feature (S-01) already speaks to OpenRouter with strict JSON-schema structured output, server-side model fallback, and a clean Effect/zod transport (`completeStructured`). The recipe-generation feature should mirror it almost verbatim — text-only instead of multimodal.

Headline findings:

1. **Persistence is already in place.** The `Recipe` domain model (`name` + `contentMd`) and the `recipes` table (`name`, `content_md ≤16000`, `session_id` UNIQUE, full RLS + a user-id drift-guard trigger) already exist, and the session-state enum already includes `recipe_generated`. **No new table, no new state, and (for the minimal scope) no new migration are required** — only new code wired to what's there. ([model/recipe/index.ts:72-81](src/lib/core/model/recipe/index.ts), migration `20260530100000_domain_schema_and_storage.sql:30-39`)
2. **Reuse the recognition transport verbatim.** `completeStructured`, `toStrictJsonSchema`, `extractContent`, and the "all model-output failures → `SnapchefExternalSystemError` (500)" posture are directly reusable. ([infrastructure/llm/openrouter.ts:72-92](src/lib/infrastructure/llm/openrouter.ts))
3. **Recommended model: `openai/gpt-4.1-mini` (primary) + `openai/gpt-4o-mini` (fallback).** Best quality-per-latency for grounded, creative **Polish** prose with reliable instruction-following and strict structured output, no reasoning-model latency — important for a non-streaming "spinner" UX. ~**$0.002 / recipe**. Runner-up `openai/gpt-5-mini` (reasoning) only if A/B shows a quality gap. (Live OpenRouter data, 2026-06-16 — re-verify pricing at implementation time.)
4. **Keep single-call strict `json_schema` for `{ name, content }`.** Reliable even with a long markdown string field; the real risks are **truncation** (`finish_reason: "length"`) and **refusal** — both detectable. Set `max_tokens: 2000`, `temperature: 0.7`. Add a `finish_reason` check to the transport.
5. **The "only listed vs may add staples" constraint is the highest-risk instruction.** The change notes favor a single free-text field + a guiding hint (not a separate toggle). That is workable if the prompt makes the model infer the constraint from the free text and **defaults to "may add common staples"** (which matches the PRD business-logic line "z listy lub powszechnie dostępne dodatki"). For robustness, optionally back the free text with an explicit UI signal — flagged as an open decision below.
6. **A model-output retry is load-bearing here.** OpenRouter's `models:[primary,fallback]` array only falls back on provider-side errors (rate-limit, downtime, moderation), **not** on a post-parse zod/truncation failure — that arrives as an HTTP success. So the UC-layer `Effect.retry({ times: 1 })` (already the recognition pattern) is what re-rolls a malformed-but-well-formed generation.

## Detailed Findings

### A. Existing OpenRouter LLM integration — the template to mirror

The recognition feature is the blueprint; recipe generation is its text-only sibling.

- **Transport core** `completeStructured<S>` ([openrouter.ts:72-92](src/lib/infrastructure/llm/openrouter.ts)): `client(key check)` → `Effect.tryPromise(sendChatRequest)` → `extractContent` → `Effect.try(JSON.parse)` → `decodeWith(schema)`. Generic over the zod schema; only `messages`/`schema`/`schemaName` vary.
- **Request shape** ([openrouter.ts:36-51](src/lib/infrastructure/llm/openrouter.ts)): `@openrouter/sdk` `client.chat.send({ chatRequest: { models: [primary, fallback], messages, responseFormat: { type: "json_schema", jsonSchema: { name, strict: true, schema } }, provider: { dataCollection: "deny" }, stream: false } })`. No `temperature`/`max_tokens` set today.
- **Strict JSON-schema helper** `toStrictJsonSchema` ([openrouter.ts:30-34](src/lib/infrastructure/llm/openrouter.ts)): `z.toJSONSchema(schema)` with the top-level `$schema` key stripped (strict providers reject unknown root members). **Reuse verbatim.**
- **Error posture** ([openrouter.ts:67-92](src/lib/infrastructure/llm/openrouter.ts)): every failure mode — missing key, transport, no content, non-JSON, schema mismatch — maps to `SnapchefExternalSystemError` (500) via `asExternal` ([openrouter.ts:21](src/lib/infrastructure/llm/openrouter.ts)), **never** `SnapchefValidationError`. Rationale: "model output is an external contract, not user input." `decodeWith`'s native 400 is explicitly remapped to 500 at `:88`.
- **Model fallback** is purely OpenRouter's `models: [...]` array ([openrouter.ts:42](src/lib/infrastructure/llm/openrouter.ts)) — no app-side fallback code. Env defaults in `astro.config.mjs:22-31`.
- **Prompts** live in [infrastructure/llm/prompts.ts](src/lib/infrastructure/llm/prompts.ts): string-array `.join("\n")` constants + `buildRecognitionMessages` (multimodal) / `buildMergeMessages` (text-only). Recipe gen is **text-only → model it on `buildMergeMessages` (`:55-58`)**.
- **Resilience belongs in the UC, not the adapter** ([RecipeSessionUC.ts:121-138](src/lib/core/uc/recipe/RecipeSessionUC.ts)): `recognizeEachPhoto` wraps each call in `Effect.timeout("25 seconds")` + `Effect.retry({ times: 1 })` + `Effect.catchAll`. The SDK is built with `retryConfig: { strategy: "none" }` ([openrouter.ts:24-27](src/lib/infrastructure/llm/openrouter.ts)) so there's no hidden double-retry.
- **Wiring** ([middleware.ts:43-48](src/middleware.ts)): `createProductRecognizer()` (no args; reads env at module scope) is passed to the `RecipeSessionUC` constructor.
- **Tests**: there is **no existing LLM-adapter test** — the closest mock pattern is [SupabaseAuthenticator.test.ts](src/lib/infrastructure/auth/SupabaseAuthenticator.test.ts). A recipe-generator test would be the first OpenRouter mock in the repo.

### B. Domain model, state machine & recipe persistence

- **`RecipeSession`** ([model/recipe/index.ts:30-41](src/lib/core/model/recipe/index.ts)): `id, userId, correctedItems: RecognizedItem[] | null, createdAt, mealContext: string | null, recognizedItems: RecognizedItem[] | null, state, updatedAt`. Items are **structured JSON** (`RecognizedItem = { name, quantity, context }`, `:17-28`), not markdown — the `*_md` columns were dropped in migration `20260614111147`.
- **State enum** ([model/recipe/index.ts:4-12](src/lib/core/model/recipe/index.ts)): `created → photos_uploaded → products_recognized → recipe_generated → saved`. **`recipe_generated` already exists** and is set by no code yet — it's exactly this feature's target transition. DB CHECK matches (`20260606120000_add_recipe_session_state.sql:10`).
- **`Recipe` model** ([model/recipe/index.ts:72-81](src/lib/core/model/recipe/index.ts)): `{ id: RecipeId, sessionId, userId, contentMd, createdAt, name }` — **already defined, currently unused.**
- **`recipes` table** (migration `20260530100000_domain_schema_and_storage.sql:30-39`): `id` PK, `session_id` UNIQUE FK→recipe_sessions (ON DELETE CASCADE — **one recipe per session**), `user_id` FK→auth.users, `name` text NOT NULL, `content_md` text NOT NULL CHECK ≤16000, `created_at`. RLS: 4 per-operation policies on `auth.uid() = user_id` (`:70-85`) + a trigger guaranteeing `recipes.user_id` matches the session's (`:106-125`).
- **Update payload** ([boundry/recipe/ports.ts:7-14](src/lib/core/boundry/recipe/ports.ts)): `RecipeSession.pick({ correctedItems, mealContext, recognizedItems, state }).partial()` — already supports writing `correctedItems`, `mealContext`, and `state: "recipe_generated"`.
- **Gap**: `correctedItems` and `mealContext` are **never written by any current code** (the editable list in `ReviewStep` is client-side only). The generation flow must persist them (or pass them through) when it runs.

**What's missing (all additive):** a `RecipeRepository` port + adapter + `RecipeFromRow` decoder; a `RecipeGenerator` LLM port + adapter (extend `openrouter.ts`); a `generateRecipe` method on `RecipeSessionUC`; `commands.ts` (generation input) + `responses.ts` (recipe view) schemas; a `POST /api/recipe-sessions/[id]/recipe-generation` route; middleware wiring; `pnpm db:types` regen. A migration is needed **only** if extra columns are wanted (e.g. persisting the free-text description used, or a model/`generated_at` audit field) — and it must be additive/nullable per CLAUDE.md. Note `session_id` is UNIQUE → re-generation must **upsert/overwrite**, not insert a second row.

### C. Recommended prompting strategy

- **System prompt = durable app-authored contract** (role, ingredient rules, anti-hallucination, Polish-output guarantee, markdown skeleton). **User prompt = per-request data**: the structured ingredient list as `JSON.stringify({ items })` + the user's free text, each in a clearly labeled, fenced block.
- **Pass the free text verbatim, quarantined** — do not pre-parse intent with a second LLM call (adds latency/cost/failure modes; an LLM reads nuanced Polish wishes better than a classifier). Defend against prompt-injection by **framing not parsing**: fence the free text (`<<< >>>`) and instruct the system prompt that its content is _preferences to satisfy_, never _instructions that override the rules_. Low-stakes (worst case: a weird recipe).
- **The "only listed vs may add staples" constraint** is the hardest instruction to enforce. Make the allowed-additions set **closed** when extras are permitted (e.g. _"you may additionally use only: sól, pieprz, woda, olej/oliwa, cukier, mąka, podstawowe przyprawy — nothing else"_) and **absolute** when restricted (_"use ONLY the listed products; do not add anything, not even salt/water, unless listed; if they can't form a sensible dish, say so honestly rather than invent"_). **Default when the user says nothing = may add common staples**, matching PRD business logic ("z listy lub powszechnie dostępne dodatki", prd.md:110-117). See Open Questions for the free-text-vs-toggle decision.
- **Anti-hallucination**: reference products only by the Polish names given; treat `quantity` as approximate; forbid invented brands/weights/unavailable items; give an explicit honest-escape under "only listed".
- **Polish guarantee**: emphatic system rule ("ALL output — name and content — in Polish") + Polish input anchoring; optional cheap post-parse diacritics heuristic. No language-detection LLM pass.
- **Sampling**: `temperature: 0.7` (creative-but-coherent; do **not** copy recognition's ~0.0), `top_p: 1.0` (tune one, not both), `max_tokens: 2000` (a name + full recipe ≈ 600–1200 output tokens; headroom prevents mid-JSON truncation and stays well under the 16000-char column).
- **Few-shot: no.** Describe a markdown skeleton in words ("`## Składniki` bullet list, then `## Przygotowanie` numbered list") instead of paying ~300–600 input tokens per call for an example. Add one example only if format drift appears in testing.

### D. Structured output recommendation

- **Keep the existing single-call strict `json_schema` pattern.** A long markdown string inside one JSON field is well within structured-output capability (the constrained decoder enforces the JSON envelope at the token level; markdown newlines/`#`/`*` are simply JSON-escaped). OpenAI reports <0.1% schema-failure across 500k calls, dominated by refusals, not malformed JSON.
- Schema mirrors `RecognizedItemsResult`:
  ```ts
  const RecipeResult = z.object({
    name: z.string().min(1).max(200),
    content: z.string().min(1).max(16000), // matches content_md column cap
  });
  ```
  Strict mode may not enforce zod `.min()/.max()` as hard provider constraints → keep the zod bounds for **post-parse** validation.
- **Failure modes**: (1) **truncation** at `max_tokens` mid-JSON is the deadliest (unparseable, unrepairable in strict mode) — detect via `finish_reason === "length"` and the existing `JSON.parse` failure; **add a `finish_reason` check to `extractContent`** so truncation surfaces as a clear `SnapchefExternalSystemError("Model output truncated")` and the 1-retry becomes meaningful. (2) **Refusal** — OpenAI exposes a `refusal` field; map to 500 (or a 422 "couldn't generate" if you'd rather tell the user). (3) **Post-parse validation** — non-empty `name`, `content ≤ 16000`, ideally contains the two `##` headings; treat misses as model-contract failures (500-class), consistent with the existing posture.
- **Rejected alternatives**: `json_object`/no-schema (strictly worse), tool-calling (older, no advantage for one fixed shape), 2-call generate-then-structure (doubles latency/cost). Plain-markdown + separate name is the only runner-up, worth it only if escaping pathologies appear (they won't at this scale).
- **Fallback ≠ schema retry** (verified): OpenRouter's `models[]` fallback triggers on provider-side errors only; a well-formed response that fails your zod decode is a _success_ to OpenRouter. The **UC-layer `Effect.retry({ times: 1 })` is the only thing that re-rolls a bad generation** — keep it; it's load-bearing here in a way it isn't for recognition.

### E. Model selection (OpenAI via OpenRouter)

Live OpenRouter data, 2026-06-16 (pricing per 1M tokens USD; **re-verify at implementation time**):

| Model (OpenRouter id)     | In $/M   | Out $/M  | Context   | Reasoning? | Note                         |
| ------------------------- | -------- | -------- | --------- | ---------- | ---------------------------- |
| `openai/gpt-4o-mini`      | 0.15     | 0.60     | 128k      | no         | current recognition fallback |
| `openai/gpt-4.1-nano`     | 0.10     | 0.40     | 1.05M     | no         | fast, weaker prose           |
| **`openai/gpt-4.1-mini`** | **0.40** | **1.60** | **1.05M** | **no**     | **recommended primary**      |
| `openai/gpt-5-nano`       | 0.05     | 0.40     | 400k      | yes        | reasoning latency            |
| `openai/gpt-5-mini`       | 0.25     | 2.00     | 400k      | yes        | runner-up; reasoning         |
| `openai/gpt-4o`           | 2.50     | 10.00    | 128k      | no         | overkill/expensive           |
| `openai/gpt-5`            | 1.25     | 10.00    | 400k      | yes        | flagship; unnecessary        |

- **PRIMARY: `openai/gpt-4.1-mini`** — strong multilingual instruction-following + natural Polish prose, mature strict `json_schema`, **no reasoning latency** (matters for non-streaming "wait for whole recipe"), cheap. Best at honoring the only-listed/staples constraint.
- **FALLBACK: `openai/gpt-4o-mini`** — proven in recognition, cheapest tier, same structured-output support, keeps env/config consistent.
- **Runner-up primary: `openai/gpt-5-mini`** with `reasoning: { effort: "low" }` — current-gen quality but reasoning adds latency/hidden-token cost against a single-shot recipe; pick only if blind A/B shows 4.1-mini's Polish is noticeably weaker.
- **Not o-series / gpt-5 flagship**: recipe gen is creative-writing + constraint-following, not hard reasoning — reasoning models add seconds and 2–10× output cost for imperceptible gain.
- **Cost estimate** (gpt-4.1-mini, ~700 in / ~1000 out): **≈ $0.0019/recipe**. Fallback gpt-4o-mini ≈ $0.0007. Cost is not the deciding factor; latency + prose quality are.
- Add `OPENROUTER_RECIPE_MODEL` (default `openai/gpt-4.1-mini`) and `OPENROUTER_RECIPE_FALLBACK_MODEL` (default `openai/gpt-4o-mini`) to `astro.config.mjs` env schema, `access: "public"`, reusing the single `OPENROUTER_API_KEY` secret.

### F. Cloudflare Workers / latency

- **No wall-clock duration limit** on HTTP-triggered Workers while the client is connected, and **no per-`fetch` subrequest timeout**; CPU time (default 30s, max 5min) counts **active compute only** — waiting on the OpenRouter `fetch` does not count. The Worker burns negligible CPU (JSON parse + zod decode). The platform is not the constraint; **client-perceived latency** is.
- The roadmap calls out a **~30s NFR** as the make-or-break for this slice (roadmap.md S-02 risk). Non-streaming for ~1–2k output tokens on a non-reasoning model is typically a few seconds — another reason to favor `gpt-4.1-mini` over a reasoning model.
- **Mitigations**: app-level `Effect.timeout(~30s)` + `Effect.retry({ times: 1 })` in the UC method (mirror recognition); cap `max_tokens: 2000`; keep `stream: false`. If the ~30s NFR is ever threatened, streaming is the documented escape hatch (out of MVP scope).

### G. Client wizard integration

Current flow ([RecipeWizard.tsx:11-42](src/components/recipes/wizard/RecipeWizard.tsx)) is a two-step machine `"upload" | "review"`:

- **UploadStep** → `useRecipeUpload` chains `POST /api/recipe-sessions` → `.../upload` → `.../recognition`.
- **ReviewStep** ([ReviewStep.tsx:14-36](src/components/recipes/wizard/ReviewStep.tsx)) → per-photo read-only cards + `ProductListEditor` (editable consolidated list via `useEditableItems`, **client-side only, no persistence**).

**S-02 adds a third step** (or extends ReviewStep): a **`mealContext` textarea** with a Polish guiding hint (per the change notes — make the user conscious of how the text influences the recipe, e.g. "tylko z moich produktów" vs "mogę dodać podstawowe produkty"), a "Generuj przepis" action, a new `useRecipeGeneration` hook posting `{ correctedItems, mealContext }` to `POST /api/recipe-sessions/[id]/recipe-generation`, and a `RecipeDisplay` rendering the returned `{ name, contentMd }`. Save/reject is S-03. Follow the api-client form-edge pattern (one Effect pipeline, one `runPromise`, branch on `result.ok`).

## Code References

- `src/lib/infrastructure/llm/openrouter.ts:24-92` — client construction, request shape, `completeStructured`, `toStrictJsonSchema`, `extractContent`, error posture (reuse verbatim)
- `src/lib/infrastructure/llm/prompts.ts:28-58` — prompt constants + `buildMergeMessages` (text-only template for recipe messages)
- `src/lib/core/uc/recipe/RecipeSessionUC.ts:121-159` — UC resilience (timeout + 1 retry) + `persistRecognizedItems` (template for `persistGeneratedRecipe`)
- `src/lib/core/model/recipe/index.ts:4-12,30-41,72-81` — state enum, `RecipeSession`, `Recipe` model (already present)
- `src/lib/core/boundry/recipe/ports.ts:7-44` — `RecipeSessionUpdatePayload`, `RecipeSessionRepository`, `ProductRecognizer` (port template)
- `src/lib/infrastructure/db/RecipeSessionRepository.ts:11-64` — repository adapter pattern (template for `RecipeRepository`)
- `src/lib/infrastructure/db/types/converters.ts:4-13` — `RecipeSessionFromRow` (template for `RecipeFromRow`)
- `supabase/migrations/20260530100000_domain_schema_and_storage.sql:30-39,70-125` — `recipes` table, RLS, user-id drift-guard trigger
- `src/pages/api/recipe-sessions/[id]/recognition.ts` — thin route template (`runApiRoute`, `validateAuthUser`, `decodeWith(RecipeSessionId)`)
- `src/middleware.ts:43-48` — DI composition root (extend the `RecipeSessionUC` constructor here)
- `astro.config.mjs:21-31` — OpenRouter env schema (add recipe model vars)
- `src/components/recipes/wizard/RecipeWizard.tsx:11-42`, `ReviewStep.tsx:14-36` — wizard step machine + review step (attach the generate step)
- `context/foundation/prd.md:82-87,110-117` — FR-006/007/008 + business-logic line
- `context/foundation/roadmap.md` (S-02 entry) — north-star outcome, ~30s NFR risk

## Architecture Insights

- **Two LLM use cases, one transport.** Recipe generation is the text-only sibling of photo recognition; the hexagon (port in `core/boundry/recipe`, factory adapter in `infrastructure/llm`, UC method, thin route, middleware wiring) is already proven. Favor extending `openrouter.ts` with a second factory (`createRecipeGenerator`) and a shared `completeStructured` over duplicating the transport.
- **Model output is an external contract, not user input.** Every malformed-output path → `SnapchefExternalSystemError` (500); only the user's `mealContext`/`correctedItems` are validated as user input (`SnapchefValidationError` 400 via `parseRequestBody`/`decodeWith`).
- **Retry vs fallback are different layers.** OpenRouter `models[]` covers provider outages; the UC `Effect.retry` covers bad generations. Recipe gen needs both.
- **The persistence already encodes the lifecycle.** `recipe_generated` state + the UNIQUE `recipes.session_id` mean: generate → upsert recipe → set state `recipe_generated` → return; "saved/done" is a separate state owned by S-03.

## Historical Context (from prior changes)

- `context/archive/2026-05-27-domain-schema-and-storage/` — F-01: defined the `recipes`/`recipe_sessions` tables, per-user RLS, the drift-guard trigger, and the `session-photos` bucket. This is why recipe persistence already exists.
- `context/archive/2026-06-06-photo-upload-and-recognition/plan.md` — S-01: established the hexagonal LLM integration, the `ProductRecognizer` port, the session state enum (incl. `recipe_generated`), `RecognizedItem`, and the route/UC conventions to mirror.
- `context/changes/photo-upload-and-recognition/plan.md` — normalized items to JSON (`recognizedItems`/`correctedItems`), dropped the `*_md` columns, added the `photos` child table.
- `context/changes/editable-product-list/` — moved the consolidated list to a structured editable UI (`useEditableItems` → projects to clean `RecognizedItem[]`); this projection feeds the generation request's `correctedItems`. Established the Vitest 4 + RTL/jsdom component-test setup.

## Related Research

- None prior for this change. Sibling implementation references: `context/archive/2026-06-06-photo-upload-and-recognition/` (recognition LLM) and `context/changes/editable-product-list/` (the list the user edits before generating).

## Open Questions

1. **Free-text-only vs an explicit constraint signal (the load-bearing UX/prompt decision).** The change notes favor a single `mealContext` textarea + a guiding hint, letting the model infer "only my products" vs "may add staples" from the prose, defaulting to _may add staples_ (matches PRD). Research recommends this is workable but notes robustness is higher with an explicit signal (a UI toggle, or app-derived flag) feeding a closed staples whitelist into the prompt. **Decision for `/10x-plan`:** free-text-only (honor the design) vs free-text + optional toggle. Recommendation: ship free-text-only for MVP with a strong system-prompt rule + default-to-staples, and treat a toggle as a fast follow if testing shows the model disobeys.
2. **Persist the `correctedItems`/`mealContext` on generation?** They're currently never written. The generation request should at least pass them; persisting them (via the existing update payload) gives provenance for the saved recipe and a re-generate path. Confirm in planning.
3. **Re-generation semantics.** `recipes.session_id` is UNIQUE → a second generation for the same session must upsert/overwrite. Confirm the product wants overwrite (vs. keeping history — would need a schema change).
4. **Optional audit columns.** Persisting the description used, the model id, or `generated_at` would need an additive/nullable migration. Out of minimal scope unless wanted.
5. **Refusal UX.** If the model refuses (rare for recipes), is that a 500 ("generation failed, try again") or a friendlier 422 ("couldn't generate from these inputs")? Lean 500 to match the existing posture unless product wants a tailored message.
6. **Live model/pricing re-check.** The model table is live as of 2026-06-16 via the OpenRouter models API; per-provider latency percentiles were **not** verified (needed an API key). Re-confirm `gpt-4.1-mini` availability, pricing, and latency at implementation time, e.g. sort OpenRouter endpoints by latency.
