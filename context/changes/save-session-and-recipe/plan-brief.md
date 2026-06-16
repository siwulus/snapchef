# Save / Delete Session & Recipe — Plan Brief

> Full plan: `context/changes/save-session-and-recipe/plan.md`

## What & Why

The recipe wizard ends at a dead-end: after a recipe is generated and shown, there is no way forward. This change adds the final step — the user **saves** the recipe (the session advances to `saved`) or **deletes** it (the session and all derived data are removed). In both cases the user is redirected to `/recipes`.

## Starting Point

The recipe is **already persisted** when it is generated (`generateRecipe` upserts the `recipes` row and sets the session to `recipe_generated`). The `"saved"` state already exists in the enum and the DB CHECK constraint but is never reached. `RecipeDisplay` renders the recipe with no actions. The hexagon (port → adapter → UC → route → client) is fully established by the recognition/generation slices.

## Desired End State

Beneath a generated recipe, the user sees **Zapisz przepis** and **Usuń**. Save flips the session to `saved` and lands on `/recipes`. Delete asks for confirmation, then hard-deletes the session (cascade removes the recipe + photo rows; the UC clears the storage-bucket files) and lands on `/recipes`. No browser leave-prompt fires during the redirect.

## Key Decisions Made

| Decision            | Choice                                                                   | Why (1 sentence)                                                              | Source |
| ------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------ |
| Meaning of "save"   | Session state transition `recipe_generated → saved` (no recipe write)    | The recipe row already exists from generation; only the session needs to move | Plan   |
| Delete scope        | Hard-delete session (cascade rows) **+** explicit storage-bucket cleanup | No orphaned files; mirrors the existing `removeExistingPhotos` pattern        | Plan   |
| Delete confirmation | shadcn `AlertDialog` before the destructive call                         | Irreversible action; standard destructive-action UX                           | Plan   |
| Redirect contract   | Both routes return `RedirectTarget`; client assigns `window.location`    | Reuses the auth signin pattern — one shared contract, picks up server state   | Plan   |
| Save precondition   | None — idempotent, last-write-wins                                       | UI only exposes save from the recipe step; a state guard adds needless cost   | Plan   |

## Scope

**In scope:** `saveSession` + `deleteSession` UC methods; a `delete` repo method + adapter; `POST .../save` and `DELETE .../[id]` routes; Save/Delete actions in `RecipeDisplay` with an AlertDialog and redirect.

**Out of scope:** the saved-recipes list page and recipe-detail view; soft-delete / "discarded" state; undo/restore; any migration; recognition/generation changes.

## Architecture / Approach

A vertical slice mirroring the existing recipe routes. **Server:** add `delete` to the `RecipeSessionRepository` port + Supabase adapter; `saveSession` (validate → `update` state to `saved`) and `deleteSession` (validate → list photos → `photosStorage.remove(paths)` best-effort → `sessionRepository.delete`, FK cascade drops the recipe + photo rows) on `RecipeSessionUC`; two thin `runApiRoute` routes returning `RedirectTarget`. **Client:** expose `del` on `useApiClient`, add the `alert-dialog` primitive, a `useRecipeFinalize` hook (save/delete → `window.location.assign` on success), and Save/Delete actions on `RecipeDisplay`, disarming the wizard's `beforeunload` guard before navigating.

## Phases at a Glance

| Phase                        | What it delivers                                                            | Key risk                                                           |
| ---------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1. Server — save & delete    | Repo `delete` + adapter, two UC methods, two routes, UC tests               | Delete ordering (clean storage before deleting the row); cascade   |
| 2. Client — finalize actions | `useApiClient.del`, AlertDialog, `useRecipeFinalize`, RecipeDisplay actions | Disarming the `beforeunload` guard synchronously before navigation |

**Prerequisites:** local Supabase stack (Docker) for manual DB/storage verification; an authenticated session that has reached `recipe_generated`.
**Estimated effort:** ~1–2 implementation sessions, one per phase.

## Open Risks & Assumptions

- The `beforeunload` leave-guard must be disarmed **synchronously** before `window.location.assign` — a deferred `setDirty(false)` won't flush in time. This is the one non-trivial client detail.
- Storage cleanup is best-effort: a transient storage failure must not block the delete (the DB rows still go via cascade), accepting a rare orphaned file over a stuck delete.
- Reusing the auth-domain `RedirectTarget` for recipe routes is intentional (it is the generic redirect payload), not a domain leak worth fixing here.

## Success Criteria (Summary)

- A user can save a generated recipe and land on `/recipes`, with the session marked `saved`.
- A user can delete a recipe behind a confirmation and land on `/recipes`, with the session/recipe/photo rows and storage files removed.
- No leave-prompt regression; lint, build, and the new unit/component tests pass.
