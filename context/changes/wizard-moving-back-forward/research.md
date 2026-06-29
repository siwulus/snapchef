---
date: 2026-06-29T17:50:45+0200
researcher: siwulus
git_commit: 540c62c8114cbe5564e43df03f6d3ef2923ec66e
branch: main
repository: snapchef
topic: "Move back and forward through the new-recipe wizard"
tags: [research, codebase, recipe-wizard, state-machine, recipe-sessions, ui-navigation]
status: complete
last_updated: 2026-06-29
last_updated_by: siwulus
---

# Research: Move back and forward through the new-recipe wizard

**Date**: 2026-06-29T17:50:45+0200
**Researcher**: siwulus
**Git Commit**: 540c62c8114cbe5564e43df03f6d3ef2923ec66e
**Branch**: main
**Repository**: snapchef

## Research Question

The new-recipe wizard currently only moves forward (first → last step). We want to let the user move **back and forward** during a session to: correct a prior decision, change the recipe description, modify the recognized items, and delete/update photos. Moving back means _returning to the previous state and re-executing all downstream steps_; when prior data exists it should **pre-populate** the form, and the user may either reuse it as-is or modify and resend.

This research analyzes the codebase to determine **what is already done, what can be reused, and what is missing**, so the change can be planned with confidence.

## Summary

**This is overwhelmingly a front-end / data-hygiene change, not a state-machine change.** The headline finding is that the server-side recipe-session FSM **already permits backward navigation**: re-firing `upload_photos`, `recognize_products`, or `generate_recipe` from a later state is a legal, deliberately re-entrant edge that resets the session to the earlier state and re-runs the work. This was an _explicit design decision_ in the `recepie-session-state-machine` change ("Re-edit freely until `saved`; `saved` is terminal"), already implemented and tested. The "valid session" guard the change note refers to is the FSM legality guard in the transition aspect — there is no function literally named `validSession`.

The user's business rule ("moving back re-executes all downstream steps") is **naturally enforced by the existing FSM**: because step-skips are illegal, once you move back to photos you _must_ pass through recognition and generation again to reach `saved`. No new transition is needed for that.

What is genuinely missing splits into three buckets:

1. **UI back-navigation (the bulk of the work).** The wizard is a forward-only, in-memory React stepper (`RecipeWizard.tsx`) with a local 3-value `Step` union that is **not** driven by `session.state`. `setStep` is only ever called forward; there is no back affordance.
2. **Form pre-population.** The data needed to pre-fill earlier steps (`recognizedItems`, `correctedItems`, `mealContext`, `allowExtraIngredients`) is already on the wire in the session, but two components ignore it: the generation panel hard-codes defaults, and the editable-items hook seeds once and never re-seeds.
3. **Downstream data-staleness on a backward jump.** The FSM resets `state`, but the UC methods do **not** clear now-orphaned downstream data (a re-uploaded session keeps the old merged items, corrected items, meal context, and the previously generated recipe row). Two persistence-layer constraints block a clean reset today: `update` silently drops `null` values (so columns can't be nulled), and there is no way to delete the `recipes` row short of deleting the whole session.

Two boundary decisions for planning: **`saved` is terminal** (no back-edit without new FSM edges), and **nothing survives a page reload** (there is no `GET /api/recipe-sessions/[id]` endpoint; all wizard state is in memory).

## Detailed Findings

### A. Server-side state machine — backward edges already exist

- **States** (`src/lib/core/model/recipe/index.ts:4-12`): `created → photos_uploaded → products_recognized → recipe_generated → saved`. Mirrored by a DB CHECK constraint (membership only, no ordering) in `supabase/migrations/20260606120000_add_recipe_session_state.sql:8-10`, default `'created'`.
- **Event-driven, not target-driven.** Events `RecipeSessionEvent` (`recipe-session-state-machine.ts:9`): `upload_photos | recognize_products | generate_recipe | save`. The pure reducer `nextState(event)(from)` (`recipe-session-state-machine.ts:17-31`) derives the target state or fails `SnapchefConflictError` (409). The UC never names a target state.
- **The "valid session" guard = the FSM legality guard**, enforced inside `SessionStateManager.run` (`src/lib/core/uc/recipe/recipe-session-transition.ts:31-50`) as a fixed 4-step envelope: (1) load + own (404 on miss/foreign), (2) **guard** `nextState(event)(state)` (409 before any side effect), (3) run the data-only business action, (4) `transition(to)` — the **sole** state write. There is **no** function literally named `validSession`/`isValidSession`; "valid session" is the change author's label.
- **The 11 legal edges are re-entrant (this is the crux):**

  | From                                                               | Event                | To                  |
  | ------------------------------------------------------------------ | -------------------- | ------------------- |
  | created / photos_uploaded / products_recognized / recipe_generated | `upload_photos`      | photos_uploaded     |
  | photos_uploaded / products_recognized / recipe_generated           | `recognize_products` | products_recognized |
  | products_recognized / recipe_generated                             | `generate_recipe`    | recipe_generated    |
  | recipe_generated / saved                                           | `save`               | saved               |

  `upload_photos` is legal from **every non-`saved` state**; `recognize_products` and `generate_recipe` are legal from later states. So "go back to photos" is just `upload_photos` fired from `recipe_generated`, which the FSM already accepts and which already resets `state` to `photos_uploaded`. Illegal transitions are **only** step-skips (e.g. `created → generate_recipe`) and any re-edit event on a `saved` session. Proven by the full edge matrix in `recipe-session-state-machine.test.ts:10-35` and guard-ordering tests in `recipe-session-transition.test.ts:64-109`.

### B. RecipeSessionUC — methods and re-execution behavior

`src/lib/core/uc/recipe/RecipeSessionUC.ts` (constructor `:26-37` injects repos, photo storage, the two LLM ports, and the `SessionStateManager` aspect).

| Method                                                  | file:line  | Event → state                                | Notes                                                                                                                                                                                                       |
| ------------------------------------------------------- | ---------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createSession(userId)`                                 | `:39-41`   | none; starts `created`                       | direct `repository.create`, no aspect                                                                                                                                                                       |
| `attachPhotos(userId, id, files)`                       | `:43-55`   | `upload_photos` → `photos_uploaded`          | **drops existing photos first** via `removeExistingPhotos` (`:228-241`), then uploads + persists the new set; full replace, no append                                                                       |
| `recognizeProducts(userId, id)`                         | `:60-86`   | `recognize_products` → `products_recognized` | `guardHasPhotos` (422 if none); **N+1 AI calls** (one per photo + a merge); overwrites session `recognizedItems` and per-photo items                                                                        |
| `generateRecipe(userId, id, cmd)`                       | `:98-136`  | `generate_recipe` → `recipe_generated`       | persists `correctedItems`/`mealContext`/`allowExtraIngredients` **before** the AI call (so a failure leaves inputs saved); **1 AI call** (30s timeout, 1 retry); `recipeRepository.upsert` (overwrite-safe) |
| `saveSession(userId, id)`                               | `:143-150` | `save` → `saved`                             | business action is a no-op                                                                                                                                                                                  |
| `deleteSession` / `listSavedRecipes` / `getSavedRecipe` | `:156-195` | reads / hard delete                          | not wrapped in the FSM aspect                                                                                                                                                                               |

**Critical re-execution gap:** these methods re-run their own step but do **not** clear _later-stage_ data. Re-uploading photos resets `state` to `photos_uploaded` yet leaves the old session `recognizedItems`, `correctedItems`, `mealContext`, `allowExtraIngredients`, and the generated `recipes` row intact — so the session can be `photos_uploaded` while still carrying a full recipe. The FSM forces re-recognition/re-generation before `saved` is reachable again (so the _final_ output stays consistent), but intermediate persisted state is stale until overwritten.

### C. Domain model & update payload

- `RecipeSession` (`src/lib/core/model/recipe/index.ts:30-42`): `id, userId, correctedItems, createdAt, mealContext, allowExtraIngredients, recognizedItems, state, updatedAt`. `RecognizedItem = { name, quantity, context }` (`:17-28`).
- The **generated recipe is NOT on the session** — it's a separate `Recipe` model (`:73-82`, `name` + `contentMd`) persisted one-per-session via `RecipeRepository.upsert`. Photos are separate `Photo` rows, each carrying its own `recognizedItems`.
- **All the data the pre-population feature needs already lives on the session / photos** — `recognizedItems`, `correctedItems`, `mealContext`, `allowExtraIngredients` on the session; photos (with signed URLs) via `PhotoRepository.listBySession`.
- `RecipeSessionUpdatePayload = RecipeSession.pick({ correctedItems, mealContext, recognizedItems, allowExtraIngredients }).partial()` (`src/lib/core/boundry/recipe/ports.ts:19-26`). **`state` is deliberately excluded** — only `transition(userId, sessionId, to)` (`ports.ts:72-78`) writes state.

### D. Persistence & API layer

- **API routes** (`src/pages/api/recipe-sessions/**`, all `prerender = false`, all auth-gated): `POST /` (create), `POST /[id]/upload`, `POST /[id]/recognition`, `POST /[id]/recipe-generation`, `POST /[id]/save`, `DELETE /[id]`. **There is no `GET` route for a session, and no `PUT`/`PATCH` anywhere.**
- **Repository** `src/lib/infrastructure/db/RecipeSessionRepository.ts`: `create` (`:11-21`), `find` (`:23-38`), `update` (`:52-68`), `transition` (`:74-90`, sole state writer), `remove` (`:96-106`, owner-scoped hard delete relying on DB `on delete cascade`).
- **Two blocking constraints for "reset downstream on back":**
  1. `update` **filters out null/undefined values** (`toRecipeSessionUpdate`, `RecipeSessionRepository.ts:40-50`, `.filter(([, value]) => value != null)`). Passing `{ recognizedItems: null }` is silently dropped — **you cannot null a column through `update` today.**
  2. `RecipeRepository` exposes only `upsert / list / findBySession` (`RecipeRepository.ts:67-71`) — **no `delete`**. The only way to remove a recipe row is deleting the whole session (`remove` + cascade).

  All item/context columns are **nullable at the DB level** (migrations below), so the blocker is purely the application-layer null-filter, not the schema.

### E. Photo handling — delete already exists

- **Storage bucket** `SessionPhotoStorage` (`src/lib/infrastructure/db/SessionPhotoStorage.ts`): `upload` (`:19-29`), `createPreviewUrls` (`:31-45`), `remove(paths)` (`:47-55`, deletes from the `session-photos` bucket).
- **Photo rows** `PhotoRepository` (`src/lib/infrastructure/db/PhotoRepository.ts`): `create`, `listBySession` (signs URLs), `updateRecognizedItems`, `deleteBySession` (`:100-110`, deletes all photo rows for a session).
- **The "going back to photos" cleanup already exists** as `RecipeSessionUC.removeExistingPhotos` (`:228-241`): list → `photosStorage.remove` → `photoRepository.deleteBySession`, all best-effort. But there is **no single-photo delete API and no incremental upload** — re-upload always replaces the entire set, and the user must re-select files locally.

### F. Front-end wizard — forward-only, in-memory

- **Single client island.** `src/pages/recipes/new.astro:1-9` mounts `<RecipeWizard client:load />`; one URL for the whole flow.
- **Local step state, not server-driven.** `RecipeWizard.tsx:10` `type Step = "upload" | "review" | "recipe"`; `:20` `useState<Step>("upload")`. The client `Step` and the server `RecipeSessionState` are **independent ladders** — the UI never reads `session.state`.
- **Forward-only navigation.** `setStep` is called in exactly two places, both forward: `upload → review` (`:50-54`, on recognition success) and `review → recipe` (`:56-60`, on generation success). Render switch at `:62-76`. **No back affordance**: `WizardExitLink.tsx` leaves the page (`window.location.assign("/recipes")`), and `WizardActions.tsx:36-55` "Anuluj" deletes the whole session.
- **Per-step forms (none use react-hook-form / `useZodForm`):**
  - _Upload_ — `PhotoUploader.tsx:22-101`: hidden multi-file input, preview grid with per-photo delete (`PhotoPreviewGrid.tsx:10-29`), client validation via `validateFiles`. Starts **blank**.
  - _Review_ — `WizardReviewProducts.tsx:20-50`: editable list `ProductListEditor.tsx` / `ProductRow.tsx` (name + quantity editable, `context` read-only) backed by `useEditableItems.ts:54-88`; plus `RecipeGenerationPanel.tsx:24-59` (meal-context textarea + `allowExtraIngredients` switch).
  - _Recipe_ — `GeneratedRecipeView.tsx:21-30`: read-only echo of everything + the generated recipe.
- **Pre-population gaps (both must be fixed for the feature):**
  1. `RecipeGenerationPanel.tsx:25-26` hard-initialises `mealContext = ""` and `allowExtraIngredients = true`, **ignoring** `session.mealContext` / `session.allowExtraIngredients` which are present on the wire.
  2. `useEditableItems.ts:55` seeds via `useState(() => seedRows(seed))` from `session.recognizedItems` **once** — it never re-seeds on prop change and never reads `session.correctedItems` (the user's prior edits).
- **No reload survival.** All state is in-memory threaded from POST responses; a refresh starts blank because there is no `GET` session endpoint and `new.astro` fetches nothing.
- **API calls** go through `useApiClient()` → `src/components/api/http.ts` helpers, run at each hook's single `runPromise` edge (`usePhotoUpload.ts`, `useRecipeGeneration.ts`, `useRecipeFinalize.ts`).

## Code References

- `src/lib/core/model/recipe/recipe-session-state-machine.ts:17-31` — the FSM reducer `nextState`; backward edges live here.
- `src/lib/core/uc/recipe/recipe-session-transition.ts:31-50` — the "valid session" guard / 4-step transition envelope.
- `src/lib/core/uc/recipe/RecipeSessionUC.ts:43-150` — `attachPhotos` / `recognizeProducts` / `generateRecipe` / `saveSession` and their re-execution behavior; `:228-241` `removeExistingPhotos`.
- `src/lib/core/model/recipe/index.ts:30-42` — `RecipeSession` model; `:73-82` separate `Recipe` model.
- `src/lib/core/boundry/recipe/ports.ts:19-26` (update payload, no `state`), `:72-78` (`transition` port).
- `src/lib/infrastructure/db/RecipeSessionRepository.ts:40-50` — the **null-dropping** `toRecipeSessionUpdate` filter (blocks column reset).
- `src/lib/infrastructure/db/RecipeRepository.ts:67-71` — `upsert/list/findBySession`, **no delete**.
- `src/lib/infrastructure/db/SessionPhotoStorage.ts:47-55` & `PhotoRepository.ts:100-110` — existing photo delete paths.
- `src/components/recipes/wizard/RecipeWizard.tsx:10,20,50-76` — local `Step` union, forward-only `setStep`, render switch.
- `src/components/recipes/recipe/RecipeGenerationPanel.tsx:25-26` — hard-coded form defaults (pre-fill gap #1).
- `src/components/recipes/ingridients/useEditableItems.ts:55` — seed-once-from-recognizedItems (pre-fill gap #2).
- `src/pages/api/recipe-sessions/**` — only POST + DELETE; no GET.
- `supabase/migrations/20260606120000_add_recipe_session_state.sql`, `20260614111147_photos_table_and_json_items.sql`, `20260616120000_..._allow_extra_ingredients.sql` — current `recipe_sessions` columns (all item/context columns nullable).

## Architecture Insights

- **The FSM is re-entrant by design, not monotonic.** "Moving back" is domain-equivalent to "re-dispatch an earlier event." The user's "re-execute all downstream steps" requirement is already enforced for free, because step-skips are the only illegal forward transitions — you cannot reach `saved` again without re-running recognition + generation.
- **The client step ladder and the server state ladder are decoupled.** This is the root reason the UI is forward-only despite a backward-capable backend. The cleanest design lever is to _derive_ the wizard step from `session.state` (or at least allow backward `setStep`), turning a UI-only constraint into a UI-only fix.
- **State writes are funnelled through one path** (`transition`), and data writes through another (`update`) that _cannot null columns_. Any "reset stale downstream data on back" feature collides with this filter and with the missing `Recipe` delete — a deliberate persistence-layer decision that must be revisited (filter change / dedicated reset method / recipe-row delete) if the plan chooses eager invalidation over lazy overwrite.
- **Lazy vs. eager invalidation is the central design fork.** Lazy (do nothing; rely on the FSM forcing re-execution before `saved`) is cheap and matches today's behavior but leaves intermediate stale columns. Eager (clear downstream data on every backward jump) is consistent but needs new persistence capabilities and incurs the re-execution AI cost up front.

## Historical Context (from prior changes)

- `context/changes/recepie-session-state-machine/` — **the most relevant prior work.** Backward re-edit edges were an **explicit, implemented decision**, not a deferral: _"Backward navigation: re-edit freely until `saved`; `saved` is terminal"_ (`plan-brief.md:25`), resolving the open question in `change.md:58`. The full legal-edge matrix is proven by `recipe-session-transition.test.ts`. `saveSession` was **tightened** to be legal only from `recipe_generated`/`saved` (intentional fix). Concurrency/compare-and-swap and DB-level transition triggers were explicitly deferred. **Implication: do not change the FSM for back/forward; leverage it.**
- `context/changes/editable-product-list/` — `RecognizedItem` name/quantity editable, `context` read-only; the review editor works on `recognizedItems` / `correctedItems`; persisting corrected items server-side was scoped as a separate concern.
- `context/changes/photo-upload-and-recognition/` — re-upload removes old photos and clears per-photo items; per-photo `recognized_items` persisted; merged list on the session. Re-upload = full replace is expected behavior.
- `context/changes/recipe-generation-from-list/` — generation persists `correctedItems`/`mealContext`/`allowExtraIngredients` _before_ the AI call so inputs survive a generation failure; recipe upserted on UNIQUE `session_id`.
- `context/changes/save-session-and-recipe/`, `add-photo-to-upload-issue/` — session lifecycle and photo-upload edge cases (supporting context).

## Related Research

- No prior `research.md` exists for the wizard navigation topic. Closest siblings are the planning artifacts in `context/changes/recepie-session-state-machine/` and `context/changes/editable-product-list/`.

## Open Questions

These are the decisions a plan must resolve (good candidates for `/10x-frame` before `/10x-plan`):

1. **Lazy vs. eager downstream invalidation.** On a backward jump, do we (a) leave stale columns and rely on the FSM forcing re-execution before `saved` (cheap, matches today), or (b) eagerly clear `recognizedItems`/`correctedItems`/`mealContext`/`allowExtraIngredients` and delete the `recipes` row (consistent, but needs the `update` null-filter relaxed + a `Recipe` delete + pays AI re-cost up front)?
2. **Should the wizard step be derived from `session.state`** (single source of truth, robust) or stay a decoupled local `Step` with new backward `setStep` handlers (smaller change)?
3. **Photos on "back to upload".** Should previously uploaded photos be re-loaded into the uploader (via `listBySession` signed URLs) so the user can delete/keep/add individually, or does going back to photos mean a blank re-selection (full replace, as the UC does today)? The note says "delete or update the photos" — incremental photo management is **not** currently supported (no single-photo delete API, no incremental upload).
4. **Reload persistence.** Must "back" survive a page refresh? If yes, a `GET /api/recipe-sessions/[id]` endpoint + initial-data fetch in `new.astro`/the wizard is new work; if no, in-memory threading suffices.
5. **`saved` is terminal.** Confirm that an already-saved recipe cannot be re-edited via back (the FSM forbids it). If editing saved recipes is in scope, new FSM edges out of `saved` are required — a larger change explicitly out of the current design.
6. **Re-execution cost / UX.** Moving back to photos implies up to N+1 recognition AI calls + 1 generation AI call again. Is that acceptable, and how is it surfaced to the user (cost, latency, confirmation)?
