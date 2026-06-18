# Recipe Wizard UI Improvements — Plan Brief

> Full plan: `context/changes/ui-improvments/plan.md`

## What & Why

Four front-end improvements to the "create new recipe" wizard (`/recipes/new`): a guarded **back link** to the list, a session-deleting **Cancel** button, a **cumulative read-only** final step that keeps prior content visible, and the recipe **name shown as a heading above** its content. The goal is a clearer, safer creation flow that doesn't silently discard or hide what the user did.

## Starting Point

The wizard is a 3-state React island (`upload → review → recipe`) where each step fully _replaces_ the previous one. The final step (`RecipeDisplay`) shows the recipe name + body with a Save + "Usuń" footer. A `beforeunload` leave-guard already warns on tab-close. Crucially, the backend already supports deletion end-to-end (`deleteSession` UC, `DELETE /api/recipe-sessions/[id]`, storage cleanup + DB cascade) and the saved-recipe **detail page** already demonstrates the exact read-only layout we want.

## Desired End State

On `/recipes/new`: a top-left back link warns (in-app dialog) before leaving with unsaved work; a bottom Cancel button deletes the whole session and returns to the list; and after generation the step shows the photos, item list, meal context, and off-list setting as read-only content, then the recipe name as a heading above its body, with Cancel + Save at the bottom.

## Key Decisions Made

| Decision                | Choice                                              | Why (1 sentence)                                                           | Source |
| ----------------------- | --------------------------------------------------- | -------------------------------------------------------------------------- | ------ |
| Back-link semantics     | Warn + leave, **no delete**                         | Mirrors today's "leave without saving"; Cancel stays the deliberate delete | Plan   |
| Cancel confirmation     | Confirm dialog before delete                        | Deleting photos + session is irreversible                                  | Plan   |
| Recipe-step ordering    | Kept content first, recipe below                    | Literal reading of "keep everything presented before" + append             | Plan   |
| Recipe-step actions     | Cancel + Save (drop "Usuń")                         | Cancel and "Usuń" both delete the session — consolidate the redundancy     | Plan   |
| Read-only summary scope | Photos + items + meal context **+ off-list toggle** | "Everything presented before" the user generated from                      | Plan   |
| Delete-failure handling | Stay on page, show error                            | Matches existing finalize/delete error behavior                            | Plan   |
| Item-3 data approach    | Lift the submitted generation command up            | `RecipeView` lacks items/meal context; the command snapshot has them       | Plan   |
| Test coverage           | Update affected + add for new behavior              | Matches repo's Vitest+RTL component-test style                             | Plan   |

## Scope

**In scope:** back link + in-app dialog; bottom Cancel (delete-session) from review onward; cumulative read-only recipe view; name-above-content; unit tests; minor `new.astro` restructure.

**Out of scope:** any backend/UC/route/DB change; the upload→review transition (already correct); regenerate/edit-after-generate; converting the detail page to React; E2E tests.

## Architecture / Approach

`RecipeWizard` becomes the chrome owner: back link (top) → heading → active step → bottom action row. A new `WizardActions` (one `useRecipeFinalize` instance) owns Cancel + Save and the guard-disarm. The recipe step renders a new `GeneratedRecipeView` = `WizardReviewSummary` (read-only echo of photos/items/meal-context/toggle, mirroring the detail page's provenance) followed by the recipe name heading + reused `RecipeBody`. The read-only data comes from lifting the submitted `RecipeGenerationCommand` up via `onGenerated`.

## Phases at a Glance

| Phase                       | What it delivers                                         | Key risk                                                         |
| --------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| 1. Back link + leave dialog | Guarded top-left back link; chrome moved into the island | Double-prompt if the guard isn't disarmed before navigating      |
| 2. Cancel + action row      | Bottom Cancel (delete-session) + Save; "Usuń" removed    | Hook needs a session id — must render only when session exists   |
| 3. Read-only recipe view    | Cumulative read-only summary + name-above-body           | Snapshot must be lifted up (RecipeView lacks items/meal context) |

**Prerequisites:** none — backend delete path already exists.
**Estimated effort:** ~1–2 sessions across 3 phases; small, well-isolated front-end files.

## Open Risks & Assumptions

- Back link intentionally leaves unsaved sessions in the DB (same as tab-close today) — accepted, not a regression.
- `RecipeProvenance` is duplicated in spirit (Astro for detail page, new React component for the wizard); accepted to avoid touching the working detail page.
- Existing tests (`RecipeDisplay.test.tsx`, `RecipeGenerationPanel.test.tsx`) shift as components are refactored.

## Success Criteria (Summary)

- Back link warns before discarding unsaved work; Cancel deletes the session and returns to the list.
- After generating, the user sees their prior inputs read-only plus the recipe with its name above the content.
- `pnpm lint`, `tsc --noEmit`, and `pnpm test` all pass with updated + new unit tests.
