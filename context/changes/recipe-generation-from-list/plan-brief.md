# Recipe Generation from List — Plan Brief

> Full plan: `context/changes/recipe-generation-from-list/plan.md`
> Research: `context/changes/recipe-generation-from-list/research.md`

## What & Why

Implement **S-02: recipe generation** — the core value of Snapchef. After the user reviews and edits the list of products recognized from their photos, they add a free-text meal context, set a toggle for whether the recipe may use ingredients **not** on their list, and generate a recipe. The app generates a cooking recipe (AI name + markdown body) matched to the products they actually have, persists it, and shows it. This turns the app from "a photo gallery with a note" into the product it's meant to be.

## Starting Point

The recognition feature (S-01) already established the full LLM hexagon (port → adapter → UC → route → middleware) and a reusable OpenRouter transport with strict JSON-schema output. Recipe persistence is **already built and unused**: the `Recipe` model, the `recipes` table (one-per-session, RLS, drift-guard), and the `recipe_generated` session state all exist. Recipe generation is the text-only sibling of recognition — mostly additive code on a proven pattern.

## Desired End State

A signed-in user reaches the review screen, types a meal context, leaves the "may use extra ingredients" toggle on (or turns it off), presses **Generuj przepis**, waits behind a spinner (≤~30 s), and reads a rendered Polish recipe with ingredient and step sections. Server-side, the edited list, the context, and the toggle are persisted on the session, a recipe row is upserted (overwrite-safe), and the session advances to `recipe_generated`. Saving the recipe is a later step (S-03).

## Key Decisions Made

| Decision                     | Choice                                                                                                                  | Why (1 sentence)                                                                                 | Source                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------- |
| Off-list ingredients control | A single boolean **toggle** alongside the free-text field                                                               | User-requested; lighter than the PRD-rejected multi-select fields, and complements the free text | Plan (resolves Research OQ#1) |
| Toggle OFF semantics         | **Soft preference** (prefer listed items, model may add what's needed)                                                  | Avoids frequent "can't cook this" dead-ends; no whitelist/escape-hatch complexity                | Plan                          |
| Toggle default               | **ON** (may add extra ingredients)                                                                                      | Matches PRD default ("z listy lub powszechnie dostępne dodatki") and the happy path              | Plan                          |
| Persist inputs + toggle      | **Yes** — additive nullable `allow_extra_ingredients` column + persist correctedItems/mealContext                       | Provenance for the saved session (FR-009); needs one additive migration                          | Plan                          |
| Markdown rendering           | **react-markdown + @tailwindcss/typography**                                                                            | Safe, proper rendering of recipe headings/lists; small well-known deps                           | Plan                          |
| Wizard integration           | **Extend ReviewStep + new `recipe` step** (lift `useEditableItems`)                                                     | Editing and generating on one screen; smallest refactor of the step machine                      | Plan                          |
| Error UX                     | **Generic 500 + Polish retry**                                                                                          | Consistent with recognition's posture; true refusals are rare under soft-preference              | Plan                          |
| Model + structured output    | `openai/gpt-4.1-mini` primary / `gpt-4o-mini` fallback; single-call strict `json_schema`, `temp 0.7`, `max_tokens 2000` | Best Polish prose-per-latency, no reasoning lag for the ~30 s NFR                                | Research §D/§E                |
| Resilience                   | UC `timeout(30s)` + `retry({times:1})`; transport `finish_reason`/`refusal` guard                                       | OpenRouter model-fallback doesn't re-roll a bad decode — the UC retry is load-bearing            | Research §A/§D                |

## Scope

**In scope:** the meal-context textarea + off-list toggle; one generation call; persisting inputs + toggle + the recipe; the `recipe_generated` transition; rendering the recipe in the wizard.

**Out of scope:** save/finalize (S-03), "reject & regenerate" UI and recipe history, streaming, recipe metadata (servings/time/difficulty), structured meal-context fields, a second LLM pre-classification call.

## Architecture / Approach

A vertical slice mirroring recognition. **Server:** additive migration → `RecipeSession` model/converter/update-payload gain the flag → `RecipeFromRow` + `RecipeRepository` (upsert on UNIQUE `session_id`) → parameterized OpenRouter transport (model pair + sampling + truncation guard) shared by recognizer and a new `RecipeGenerator` → `generateRecipe` UC method (persist inputs → generate → upsert → set state) → thin `runApiRoute` route → middleware wiring. **Client:** lift `useEditableItems` into `ReviewStep`, add a generation panel (textarea + `Switch` + button) and a `useRecipeGeneration` hook (one Effect pipe), render with `RecipeDisplay`, extend the wizard to `upload → review → recipe`.

## Phases at a Glance

| Phase                   | What it delivers                                                                                            | Key risk                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1. Persistence & domain | Migration + types + model/converter changes + `RecipeRepository` upsert                                     | Non-destructive migration discipline; `db:types` drift                             |
| 2. LLM generator        | Parameterized transport + truncation guard + recipe prompt + `RecipeGenerator` + first OpenRouter mock test | Prompt obeying the soft toggle; truncation handling; not breaking recognition      |
| 3. UC, route & wiring   | Command/response schemas + `generateRecipe` + route + middleware + UC test                                  | Correct order so a failed generation leaves the session re-runnable                |
| 4. Client wizard        | Switch + markdown deps, lifted editor, generation panel, hook, `RecipeDisplay`, `recipe` step               | `useEditableItems` lift without regressing the editor; mobile markdown readability |

**Prerequisites:** local Supabase stack (Docker) for the migration + `db:types`; `OPENROUTER_API_KEY` for manual generation checks.
**Estimated effort:** ~3–4 implementation sessions, one per phase (server-up).

## Open Risks & Assumptions

- The model honors the **soft-preference** toggle well enough to be perceptible; if it ignores "only my products" too often, tighten the prompt (fast follow, no schema change).
- `react-markdown` + Tailwind 4 typography plugin wire up cleanly (`@plugin` directive in `global.css`).
- Re-verify `gpt-4.1-mini` availability/pricing at implementation time (research table dated 2026-06-16).
- The `useEditableItems` lift is the one non-trivial client refactor; the existing `ProductListEditor.test.tsx` must be updated alongside it.

## Success Criteria (Summary)

- A user can generate and read a cookable, Polish recipe matched to their products in one screen, under ~30 s, with the toggle visibly shaping ingredient usage.
- Inputs + toggle + recipe are persisted; re-generating overwrites rather than duplicating or erroring; a failure shows a clear retry.
- Recognition behavior is unchanged; lint, build, and the new unit/component tests pass.
