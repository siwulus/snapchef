# Saved Recipes Readback (S-04) — Plan Brief

> Full plan: `context/changes/saved-recipes-readback/plan.md`

## What & Why

This is the final MVP slice. Recipes can be created, generated, and saved (S-01–S-03), but there is no way to **read them back** — `/recipes` is an empty placeholder and `/recipes/[id]` doesn't exist. This change adds the read-path: a server-rendered **list** (FR-010), a **detail** page with provenance (FR-011), and **delete-with-confirm** on both (FR-012). It also closes the create loop by landing a successful save on the new detail page. After this, the PRD's primary success criterion (full end-to-end flow) is met.

## Starting Point

The hexagon (port → adapter → UC → route → client) and the **delete** flow are fully built by S-01–S-03: `DELETE /api/recipe-sessions/[id]` does storage cleanup + FK cascade and returns `{ redirect: "/recipes" }`; `useApiClient.del`, `AlertDialog`, `Card`, and `react-markdown` all exist. What's missing is any **read/list** capability — `RecipeRepository` has only `upsert` — and no `.astro` page has ever read domain data server-side via `Astro.locals`.

## Desired End State

`/recipes` shows a newest-first card grid of the user's saved recipes (name + date + meal-context snippet) or an empty-state CTA, each card linking to `/recipes/[id]` with a delete action. The detail page shows the recipe name + markdown body, then a context section — meal description, the final consolidated ingredient list, and a photo gallery (no per-photo recognition) — plus delete. Delete (either surface) hard-deletes after confirmation and lands on `/recipes`. A missing/foreign/unsaved `/recipes/[id]` silently redirects to `/recipes`. Saving in the wizard now lands on `/recipes/[id]`.

## Key Decisions Made

| Decision                   | Choice                                                                      | Why (1 sentence)                                                             | Source  |
| -------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------- |
| Detail provenance scope    | Recipe body + meal context + final item list + photo gallery (no per-photo) | FR-009 stored the full session; surfacing it lets the user see the inputs    | Plan    |
| Data fetch                 | SSR-direct: pages call the UC via `Astro.locals` and render server-side     | Matches the locked "server-rendered" architecture; zero new API routes       | Plan    |
| Page edge                  | Reuse `runWithLogging` + `Effect.match` (the `confirm.astro` pattern)       | An identical, documented page edge already exists; no new helper to maintain | Plan    |
| Delete placement           | List cards **and** detail page                                              | Matches `ui-architecture.md`; delete without opening each recipe             | Frame\* |
| List card                  | Name + date + meal-context snippet, newest first                            | Uses the existing `(user_id, created_at DESC)` index; flat list per PRD      | Plan    |
| List filter                | Only `state = 'saved'`                                                      | FR-010 "saved recipes" — hides abandoned `recipe_generated` sessions         | Plan    |
| Detail not-found / unsaved | Redirect to `/recipes` (modeled as `SnapchefNotFoundError`)                 | No dead-end; one branch covers missing/foreign/unsaved uniformly             | Plan    |
| `/recipes/[id]` handle     | The **session id** (not recipe id)                                          | Delete, provenance, and the 1:1 recipe all key off the session               | Plan    |
| Save redirect              | Land on `/recipes/[id]` (one-line `save.ts` change)                         | Closes the create loop per `ui-architecture.md` §3's original intent         | Plan    |

\* `ui-architecture.md` acts as the locked UI frame for this slice.

## Scope

**In scope:** list read model (`SavedRecipeListItem` + `RecipeRepository.listSaved` + decoder + `listSavedRecipes` UC); detail read model (`SavedRecipeDetail` + `RecipeRepository.findBySession` + `getSavedRecipe` UC composing recipe + session + photos); SSR rendering via the existing `runWithLogging` + `Effect.match` page edge; `/recipes` list page; `/recipes/[id]` detail page; reusable `DeleteRecipeButton` + `useDeleteRecipe`; `RecipeBody`; save-redirect change.

**Out of scope:** filters/search/sorting/pagination; soft-delete/undo; per-photo recognition on detail; any migration; new shadcn primitives or `useApiClient` changes; client-side data fetching; refactoring the wizard's `RecipeDisplay`.

## Architecture / Approach

Two **vertical** slices. Each page's `.astro` frontmatter calls a `RecipeSessionUC` read method from `Astro.locals.recipeSessions` through the existing `runWithLogging` + `Effect.match` page edge (the `confirm.astro` pattern) and renders server-side; the only client islands are the small `DeleteRecipeButton` (confirm dialog → existing `DELETE` route → follow server redirect). The list is one indexed recipe⨝session inner-join filtered to `state='saved'`; the detail composes a new `findBySession` with the existing session `find` and `photos.listBySession` (signed URLs). The markdown body is `react-markdown` SSR'd with no client directive.

## Phases at a Glance

| Phase                     | What it delivers                                                               | Key risk                                                            |
| ------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 1. Saved-recipes list     | List read model + reused page edge + delete island + `/recipes` page           | Embedded-join row decoding; failure-vs-empty rendering on the list  |
| 2. Detail + save redirect | Detail read model + `/recipes/[id]` (body + provenance + delete) + save→detail | `state='saved'` guard as the single redirect branch; gallery layout |

**Prerequisites:** local Supabase stack (Docker) for manual verification; an authenticated account with ≥1 `saved` session and (for the negative test) one `recipe_generated`-only session; a second account for the RLS read-path check.
**Estimated effort:** ~1–2 implementation sessions, one per vertical phase.

## Open Risks & Assumptions

- **Astro-page edge (reused):** the pages run UC reads via `runWithLogging` + `Effect.match` exactly as `confirm.astro:15-29` already does — no new helper. Failures collapse to a value the frontmatter branches on (list → error state, detail → `Astro.redirect`); defects reject to Astro's 500, matching the precedent.
- **Embedded-join typing:** the list query's `recipe_sessions!inner(...)` embed has an approximate supabase-js static type; runtime correctness rests on the `SavedRecipeListItemFromRow` zod decoder (consistent with the codebase's decode-at-the-boundary rule).
- **Save→detail timing:** the save route now redirects to `/recipes/[id]`, which only exists after Phase 2 — so the redirect change ships _with_ the detail page, not before.

## Success Criteria (Summary)

- The user sees their saved recipes at `/recipes`, opens one to view body + provenance, and deletes from either surface — all scoped to their own data (RLS).
- A missing/foreign/unsaved detail id redirects cleanly; saving lands on the recipe's detail page.
- `pnpm test`, `pnpm lint`, `pnpm build` pass.
