# Save / Delete Session & Recipe (Wizard Final Step) Implementation Plan

## Overview

The recipe wizard currently ends at a dead-end: once a recipe is generated, `RecipeDisplay` renders the name + markdown and there is no way forward. This change adds the final step — the user either **saves** the recipe (the session advances to the `saved` state) or **deletes** it (the session and all its derived data are hard-deleted, including storage-bucket files). In both cases the user is redirected to `/recipes`.

This is a thin vertical slice over the established hexagon (port → adapter → UC → route → client). No new data model, no migration, and no new external systems are introduced.

## Current State Analysis

- **Wizard dead-end.** `RecipeWizard.tsx` runs the step machine `upload → review → recipe`; the `recipe` step renders `RecipeDisplay` (`src/components/recipes/wizard/RecipeDisplay.tsx`) which has **no actions after the recipe** (`RecipeWizard.tsx:46-48`).
- **The recipe is already persisted at generation.** `generateRecipe` upserts the `recipes` row and sets the session to `recipe_generated` (`RecipeSessionUC.ts:103-110`). So **"save" is not a recipe write** — it is solely a session state transition `recipe_generated → saved`.
- **The `"saved"` state already exists** in the domain enum (`src/lib/core/model/recipe/index.ts:4-12`) and in the DB CHECK constraint (`supabase/migrations/20260606120000_add_recipe_session_state.sql`), but **is never reached today**. No migration is required.
- **No delete plumbing exists.** There is no `deleteSession` UC method and no `DELETE` route. The DB has `on delete cascade` from `recipe_sessions` → `recipes` + `photos`, but **storage-bucket objects are not cascade-cleaned**. The exact cleanup pattern to mirror already exists in `RecipeSessionUC.removeExistingPhotos` (`RecipeSessionUC.ts:122-135`): list photos → `photosStorage.remove(paths)` → drop rows.
- **The redirect-success contract already exists.** `RedirectTarget` (`{ redirect: string }`) lives in `src/lib/core/boundry/auth/responses.ts` and is the codebase's established "client assigns `window.location`" payload (used by `SignInForm`). The transport already has a `delete_` verb (`src/components/api/http.ts:76`).
- **The UC is already wired** in `injectDependencies` (`src/middleware.ts:44-51`) with all six collaborators, and declared on `App.Locals`. Adding methods to `RecipeSessionUC` needs **no middleware or `env.d.ts` change**.
- **`useApiClient` exposes only `post` / `postFormData`** (`src/components/hooks/useApiClient.ts`) — it does not yet surface `del`.
- **No `alert-dialog` shadcn primitive is installed** (`src/components/ui/` has button, card, form, input, label, sonner, switch, textarea).
- **Tests exist** for both touch-points: `src/lib/core/uc/recipe/RecipeSessionUC.test.ts` and `src/components/recipes/wizard/RecipeDisplay.test.tsx`.

## Desired End State

A signed-in user who has generated a recipe sees, below the rendered recipe, two actions: **Zapisz przepis** (save) and **Usuń** (delete). Pressing save flips the session to `saved` and lands the user on `/recipes`. Pressing delete opens a confirmation dialog; confirming hard-deletes the session (cascade removes the recipe + photo rows; the UC removes the bucket files) and lands the user on `/recipes`. The browser leave-guard does not prompt during this intentional navigation.

Verify by:

- Generating a recipe, pressing save → redirected to `/recipes`; the `recipe_sessions` row shows `state = 'saved'`; the `recipes` row is intact.
- Generating a recipe, pressing delete → confirm → redirected to `/recipes`; the `recipe_sessions`, `recipes`, and `photos` rows for that session are gone; the storage bucket has no leftover files for that session.
- `pnpm test`, `pnpm lint`, `pnpm build` pass.

### Key Discoveries:

- Storage cleanup pattern to copy: `RecipeSessionUC.removeExistingPhotos` (`RecipeSessionUC.ts:122-135`).
- `photoRepository.listBySession` returns `Photo[]` carrying `storagePath` (`ports.ts:62-65`, used at `RecipeSessionUC.ts:129`) — the source of paths for `photosStorage.remove`.
- Route patterns to mirror: `recipe-generation.ts` (envelope + `validateAuthUser` + `decodeWith(RecipeSessionId)`) and `signin.ts` (`Effect.as<RedirectTarget>`).
- `RecipeView` keeps `sessionId` (`responses.ts` — `Recipe.omit({ userId: true })`), so `RecipeDisplay` already has the session id it needs to call save/delete.

## What We're NOT Doing

- **Not** building the saved-recipes list page or recipe-detail view (explicitly out of scope; `/recipes/index.astro` stays the current placeholder).
- **Not** adding a "discarded" state or soft-delete — delete is a hard delete.
- **Not** enforcing a state-machine guard on save (no "must be `recipe_generated`" precondition) — save is idempotent, last-write-wins. The UI only exposes save from the recipe step.
- **Not** adding undo/restore for deletes.
- **Not** changing recognition, generation, upload, or the migration set.
- **Not** relocating `RedirectTarget` into the recipe domain — the existing generic schema is reused as-is.

## Implementation Approach

Mirror the recognition/generation slice. **Server (Phase 1):** add a `delete` method to the `RecipeSessionRepository` port + Supabase adapter; add two `RecipeSessionUC` methods — `saveSession` (validate ownership via the existing `fetchRecipeSession`, then `update` state to `saved`) and `deleteSession` (validate → list photos → `photosStorage.remove(paths)` best-effort → `sessionRepository.delete`, letting the FK cascade drop the recipe + photo rows). Add two thin routes returning `RedirectTarget`. **Client (Phase 2):** surface `del` on `useApiClient`, add the `alert-dialog` primitive, add a `useRecipeFinalize` hook that calls save/delete and assigns `window.location` on success, and extend `RecipeDisplay` with the two actions (delete behind an `AlertDialog`). The wizard's `beforeunload` leave-guard must be disarmed before the programmatic navigation.

## Critical Implementation Details

- **Leave-guard disarm ordering (client).** `RecipeWizard` arms a `beforeunload` handler whenever `dirty` is true (`RecipeWizard.tsx:19-30`). A programmatic `window.location.assign(redirect)` will still trigger the browser leave-prompt while the guard is armed. The finalize flow must **synchronously disarm the guard before navigating** — a React `setDirty(false)` will not have flushed before `assign` runs. Pass a synchronous disarm down (e.g. a ref-backed "armed" flag the handler reads, or remove the listener in the same tick) and call it immediately before `window.location.assign`.
- **Delete ordering & cascade.** Remove bucket files **before** deleting the session row (after the row is gone you can no longer list its photos). The DB `on delete cascade` removes the `recipes` and `photos` rows when the session row is deleted, so the UC must NOT also delete them by hand — it only needs `listBySession` (for the storage paths) → `photosStorage.remove` → `sessionRepository.delete`. Storage cleanup is best-effort (mirror `removeExistingPhotos`'s `catchAll`) so a transient storage hiccup never blocks the delete.

---

## Phase 1: Server — save & delete

### Overview

Add the repository `delete` capability, the two UC methods, and the two routes. After this phase the API can be exercised directly (curl / REST client) end-to-end without any UI.

### Changes Required:

#### 1. `RecipeSessionRepository` port — add `delete`

**File**: `src/lib/core/boundry/recipe/ports.ts`

**Intent**: Declare a hard-delete capability on the session repository so the UC can remove a session (and trigger the DB cascade) without naming Supabase.

**Contract**: Add to the `RecipeSessionRepository` interface (alongside `create` / `update` / `find`):
`delete(userId: UserId, sessionId: string): Effect.Effect<void, SnapchefServerError>`.

#### 2. `RecipeSessionRepository` adapter — implement `delete`

**File**: `src/lib/infrastructure/db/RecipeSessionRepository.ts`

**Intent**: Implement the port's `delete` by deleting the row scoped to `id` + `user_id` (RLS-safe, owner-scoped), lifted through the shared Supabase→Effect bridge.

**Contract**: New curried `delete = (supabase) => (userId, sessionId) => Effect<void, SnapchefServerError>`, added to the `createRecipeSessionRepository` returned object. Use the `@/lib/utils/effect` helpers (the same module `tryErrorDataOption` / `decodeWith` come from). A delete returns no domain row, so run the `{ error }`-bearing builder through `tryErrorDataOption` (with `.then(({ error }) => ({ error, data: null }))`) and map the result to `Effect.void` / `Effect.asVoid`. Owner existence is already validated upstream by `fetchRecipeSession`, so a no-match delete need not fail.

#### 3. `RecipeSessionUC` — `saveSession` and `deleteSession`

**File**: `src/lib/core/uc/recipe/RecipeSessionUC.ts`

**Intent**: Two public methods. `saveSession` validates ownership then advances the session to `saved`. `deleteSession` validates ownership, cleans up the storage-bucket files for the session's photos, then hard-deletes the session row (cascade removes recipe + photo rows).

**Contract**:

- `saveSession(userId: string, sessionId: string): Effect.Effect<RecipeSession, SnapchefServerError>` — `fetchRecipeSession(userId, sessionId)` → `sessionRepository.update(userId, sessionId, { state: "saved" })` → `getOrThrowNotFound`. Wrap with `logResult("recipe.save")`.
- `deleteSession(userId: string, sessionId: string): Effect.Effect<void, SnapchefServerError>` — `fetchRecipeSession(userId, sessionId)` (NotFound if absent/not owned) → `photoRepository.listBySession` → `photosStorage.remove(photos.map(p => p.storagePath))` (best-effort, `catchAll(() => Effect.void)`, mirroring `removeExistingPhotos` at `RecipeSessionUC.ts:122-135`) → `sessionRepository.delete(userId, sessionId)`. Wrap with `logResult("recipe.delete")`. Returns `void`.

#### 4. Save route

**File**: `src/pages/api/recipe-sessions/[id]/save.ts` (new)

**Intent**: Thin route that flips the session to `saved` and hands the client a redirect to `/recipes`.

**Contract**: `export const prerender = false;` + `export const POST: APIRoute`. Mirror `recipe-generation.ts:10-20` minus the body parse: `runApiRoute(Effect.all([validateAuthUser(user), decodeWith(RecipeSessionId)(params.id)]).pipe(Effect.flatMap(([authUser, id]) => recipeSessions.saveSession(authUser.id, id)), Effect.as<RedirectTarget>({ redirect: "/recipes" })))`. Import `RedirectTarget` from `@/lib/core/boundry/auth`.

#### 5. Delete route

**File**: `src/pages/api/recipe-sessions/[id]/index.ts` (new — maps to `DELETE /api/recipe-sessions/:id`)

**Intent**: Thin route that hard-deletes the session and hands the client a redirect to `/recipes`.

**Contract**: `export const prerender = false;` + `export const DELETE: APIRoute`. `runApiRoute(Effect.all([validateAuthUser(user), decodeWith(RecipeSessionId)(params.id)]).pipe(Effect.flatMap(([authUser, id]) => recipeSessions.deleteSession(authUser.id, id)), Effect.as<RedirectTarget>({ redirect: "/recipes" })))`.

#### 6. UC unit tests

**File**: `src/lib/core/uc/recipe/RecipeSessionUC.test.ts`

**Intent**: Cover both methods with the existing fake-port test style.

**Contract**: `saveSession` issues an `update` with `{ state: "saved" }` and surfaces `SnapchefNotFoundError` when the session is missing. `deleteSession` calls `photosStorage.remove` with the listed photos' storage paths and then `sessionRepository.delete`; a storage-remove failure does not abort the delete; a missing session yields `SnapchefNotFoundError` before any deletion. Add a `delete` stub to the session-repository test double.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm build` (Astro/`tsc`)
- Linting passes: `pnpm lint`
- Unit tests pass: `pnpm test`

#### Manual Verification:

- `POST /api/recipe-sessions/{id}/save` for an owned session in `recipe_generated` returns `{ ok: true, data: { redirect: "/recipes" } }`; the row's `state` becomes `saved`.
- `DELETE /api/recipe-sessions/{id}` for an owned session returns the same envelope; the `recipe_sessions`, `recipes`, and `photos` rows are gone and the session's files are removed from the storage bucket.
- Save/delete against a session owned by another user (or a non-existent id) returns a 404 envelope, not a 500.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Client — finalize actions

### Overview

Surface the two server actions in the UI: Save and Delete (delete behind a confirmation dialog), with a redirect to `/recipes` on success and the leave-guard correctly disarmed.

### Changes Required:

#### 1. `useApiClient` — expose `del`

**File**: `src/components/hooks/useApiClient.ts`

**Intent**: Add a `del` method so components can issue DELETEs through the shared, toast-decorated transport (components must not import `http.ts` directly, per `api-client.md`).

**Contract**: Add `del: <S>(url, dataSchema) => delete_(url, dataSchema).pipe(Effect.tapError(toast))`, mirroring the existing `post` wrapper. Returns `Effect.Effect<ApiResponsePayload<z.output<S>>, SnapchefClientError>`.

#### 2. AlertDialog primitive

**File**: `src/components/ui/alert-dialog.tsx` (generated)

**Intent**: Install the shadcn confirmation-dialog primitive for the destructive delete action.

**Contract**: Run `pnpm dlx shadcn@latest add alert-dialog`. Vendored file kept as-generated (lowercase, exempt from the file-naming and arrow-function conventions).

#### 3. `useRecipeFinalize` hook

**File**: `src/components/recipes/wizard/useRecipeFinalize.ts` (new)

**Intent**: Own the save/delete calls and the post-success navigation, keeping `RecipeDisplay` declarative. One Effect pipeline per action, run at the edge — mirroring `useRecipeGeneration`'s shape.

**Contract**: `useRecipeFinalize(sessionId: string, onBeforeNavigate: () => void)` returns `{ save, confirmDelete, isBusy, error }` (a small `phase`/busy flag is fine). `save` → `apiClient.post(\`/api/recipe-sessions/${sessionId}/save\`, {}, RedirectTarget)`; `confirmDelete` → `apiClient.del(\`/api/recipe-sessions/${sessionId}\`, RedirectTarget)`. On a successful envelope (`result.ok`), call `onBeforeNavigate()`(disarms the leave-guard) then`window.location.assign(result.data.redirect)`; on `!result.ok`, surface `result.error.message`. Transport errors are already toasted by `useApiClient`. Import `RedirectTarget`from`@/lib/core/boundry/auth`.

#### 4. `RecipeDisplay` — Save + Delete actions

**File**: `src/components/recipes/wizard/RecipeDisplay.tsx`

**Intent**: Render the two actions beneath the recipe; wire save directly and delete through an `AlertDialog` confirmation; show busy/disabled state while a request is in flight.

**Contract**: Add a `CardFooter` (or equivalent) with **Zapisz przepis** (primary) and **Usuń** (destructive). The destructive button opens an `AlertDialog` ("Usunąć przepis?" / cancel + confirm); confirm triggers `confirmDelete`. Both buttons disabled while `isBusy`. New prop `onBeforeNavigate: () => void` passed through to the hook. Polish user-facing strings (matches the existing wizard copy). Icons from `lucide-react` if used.

#### 5. `RecipeWizard` — supply the disarm callback

**File**: `src/components/recipes/wizard/RecipeWizard.tsx`

**Intent**: Give `RecipeDisplay` a synchronous way to disarm the `beforeunload` leave-guard before the finalize navigation.

**Contract**: Pass `onBeforeNavigate` to `<RecipeDisplay>` that synchronously disarms the guard (see Critical Implementation Details — a ref-backed armed flag read by the `beforeunload` handler, not a deferred `setDirty(false)`). The handler at `RecipeWizard.tsx:19-30` is adjusted to honor the synchronous flag.

#### 6. `RecipeDisplay` component test

**File**: `src/components/recipes/wizard/RecipeDisplay.test.tsx`

**Intent**: Cover the new actions without a real network.

**Contract**: Save button is present and triggers a POST to the save URL; Delete opens the confirmation dialog and only the confirm action fires the DELETE; buttons disable while busy. Use the existing test harness's transport mock + `getByRole`/`getByText` locators.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm build`
- Linting passes: `pnpm lint`
- Unit/component tests pass: `pnpm test`

#### Manual Verification:

- After generating a recipe, **Zapisz przepis** redirects to `/recipes`; the session is `saved` in the DB.
- **Usuń** opens a confirmation dialog; cancel keeps the user on the recipe; confirm redirects to `/recipes` and the session/recipe/photos are gone.
- No browser "leave site?" prompt appears during the save/delete redirect.
- Buttons are disabled while the request is in flight; a server error surfaces a Polish message and leaves the user on the recipe.
- Layout is readable on mobile.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `RecipeSessionUC.saveSession`: updates state to `saved`; NotFound when session missing.
- `RecipeSessionUC.deleteSession`: removes storage paths then deletes the session row; best-effort storage cleanup (failure still deletes); NotFound before any deletion when session missing.

### Component Tests:

- `RecipeDisplay`: save action POSTs; delete is gated behind the AlertDialog confirm; busy-state disabling.

### Manual Testing Steps:

1. Generate a recipe → press **Zapisz przepis** → land on `/recipes`; confirm `state = 'saved'` in Supabase.
2. Generate another → press **Usuń** → cancel (stays) → press again → confirm → land on `/recipes`; confirm session/recipe/photo rows gone and bucket files removed.
3. Trigger a server failure (e.g. offline) on save → Polish error toast/message; user stays on the recipe; no leave-prompt regression.
4. Repeat on a narrow mobile viewport for layout.

## Performance Considerations

Negligible — two lightweight DB operations and one storage-list+remove per delete. No new hot paths.

## Migration Notes

None — the `saved` state and its CHECK constraint already exist; no schema change.

## References

- Preceding feature: `context/changes/recipe-generation-from-list/plan.md`
- Storage cleanup pattern: `src/lib/core/uc/recipe/RecipeSessionUC.ts:122-135`
- Route + redirect patterns: `src/pages/api/recipe-sessions/[id]/recipe-generation.ts`, `src/pages/api/auth/signin.ts`
- Redirect success schema: `src/lib/core/boundry/auth/responses.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Server — save & delete

#### Automated

- [x] 1.1 Type checking passes: `pnpm build` — f0eb6b6ee
- [x] 1.2 Linting passes: `pnpm lint` — f0eb6b6ee
- [x] 1.3 Unit tests pass: `pnpm test` — f0eb6b6ee

#### Manual

- [ ] 1.4 `POST .../save` returns the redirect envelope and sets `state = 'saved'`
- [ ] 1.5 `DELETE .../{id}` removes session/recipe/photo rows and storage files
- [ ] 1.6 Save/delete on a foreign or missing session returns 404, not 500

### Phase 2: Client — finalize actions

#### Automated

- [x] 2.1 Type checking passes: `pnpm build` — 5ab0e7943
- [x] 2.2 Linting passes: `pnpm lint` — 5ab0e7943
- [x] 2.3 Unit/component tests pass: `pnpm test` — 5ab0e7943

#### Manual

- [ ] 2.4 Save redirects to `/recipes`; session is `saved`
- [ ] 2.5 Delete confirmation gates the destructive call; confirm redirects and removes data
- [ ] 2.6 No "leave site?" prompt during save/delete redirect
- [ ] 2.7 Busy-state disabling + Polish server-error message
- [ ] 2.8 Readable on mobile
