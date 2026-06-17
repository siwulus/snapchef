# Saved Recipes Readback (S-04) Implementation Plan

## Overview

This is the final MVP slice. The user can already create, generate, and save a recipe (S-01–S-03), but there is **no way to read saved recipes back** — `/recipes` is an empty placeholder and `/recipes/[id]` does not exist. This change adds the read-path: a server-rendered **list** of saved recipes at `/recipes` (FR-010), a **detail** page at `/recipes/[id]` showing the recipe plus its provenance (FR-011), and **delete-with-confirm** on both surfaces (FR-012). It also closes the create loop by landing a successful save on the new detail page.

It reuses the established page-edge pattern (`runWithLogging` + `Effect.match` in the `.astro` frontmatter, as `confirm.astro` already does) — these are simply the first pages to use that edge for a domain **read**. Everything else extends the established hexagon (port → adapter → UC) and reuses the S-03 delete plumbing verbatim.

## Current State Analysis

- **No read/list capability exists.** `RecipeRepository` has only `upsert` (`ports.ts:80-84`); `RecipeSessionRepository` has `create/update/find/delete` (`ports.ts:46-55`). Nothing lists a user's recipes or finds a recipe by session. The DB is ready: `recipes_user_id_created_at_idx` on `(user_id, created_at DESC)`, RLS `SELECT` = `auth.uid() = user_id` on `recipes`, `recipe_sessions`, and `photos`; `recipes.session_id` is a UNIQUE FK with `on delete cascade`.
- **`/recipes` is an empty placeholder** (`src/pages/recipes/index.astro`) — header + "Nowy przepis" CTA + a static "No recipes yet" card. It reads only `Astro.locals.user`. No `.astro` page reads domain data via `Astro.locals.recipeSessions` yet — but the page-edge mechanism already exists: `confirm.astro:15-29` runs a UC Effect (`authenticator.confirmEmail`) at the frontmatter edge via `runWithLogging` + `Effect.match`, then branches with `Astro.redirect`. These pages follow that precedent for a domain read.
- **`/recipes/[id]` does not exist.**
- **Delete is fully built** (S-03): `DELETE /api/recipe-sessions/[id]` → `RecipeSessionUC.deleteSession` (best-effort storage cleanup + FK cascade) → returns `RedirectTarget { redirect: "/recipes" }` (`save.ts` sibling). `useApiClient` already exposes `del`; the `AlertDialog` primitive exists; `useRecipeFinalize` (`useRecipeFinalize.ts`) is the reference delete flow (run Effect at the edge → branch on `result.ok` → `window.location.assign(redirect)`).
- **Markdown rendering exists**: `react-markdown` v10, `<Markdown>{contentMd}</Markdown>` inside `prose prose-sm dark:prose-invert` (`RecipeDisplay.tsx:39-41`). react-markdown ignores raw HTML by default (no `rehype-raw`), so it is XSS-safe for LLM-authored `content_md`.
- **The edge runner** is `runWithLogging(effect): Promise<A>` (`logger.ts:48`) — a module-scope `ManagedRuntime` with `LoggerLive`. `runApiRoute` (`api/index.ts:57-65`) and `confirm.astro:15-29` are both built on it; the pages reuse it directly with an `Effect.match` channel-collapse (no new helper).
- **Data shapes** (`model/recipe/index.ts`): `Recipe { id, sessionId, userId, contentMd, createdAt, name }`; `RecipeSession { …, correctedItems: RecognizedItem[] | null, recognizedItems: RecognizedItem[] | null, mealContext: string | null, state, … }`; `RecognizedItem { name, quantity, context }`. At generation, the **edited** list and meal context are persisted on the session (`RecipeSessionUC.ts:80-86`) — so `correctedItems` is the "final list".
- **`RecipeView = Recipe.omit({ userId: true })`** already exists (`responses.ts:22`). `PhotoRepository.listBySession` returns `Photo[]` with signed `photoUrl` (`ports.ts:63-66`).
- **Middleware** protects `/recipes*` (`PROTECTED_ROUTES = ["/recipes"]`) and injects `RecipeSessionUC` onto `context.locals.recipeSessions` — no middleware or `env.d.ts` change is needed (no new UC, no new constructor dependency).

## Desired End State

A signed-in user visiting `/recipes` sees a card grid of their saved recipes (name + date + meal-context snippet, newest first), or an empty-state CTA when they have none. Each card links to `/recipes/[id]` and carries a delete action behind a confirm dialog. The detail page shows: the recipe name + markdown body, then a context section — meal description, the final consolidated `[name, quantity]` ingredient list, and a gallery of the session's photos (per-photo recognition is **not** shown) — plus a delete action. Deleting from either surface (after confirmation) hard-deletes the session (cascade + storage cleanup) and lands on `/recipes`. A non-existent, foreign, or not-yet-saved `/recipes/[id]` silently redirects to `/recipes`. After pressing **Zapisz przepis** in the wizard, the user now lands on the new `/recipes/[id]` detail page.

Verify by:

- `/recipes` lists exactly the signed-in user's `saved` sessions, newest first; a second account sees none of them.
- A saved recipe's detail page renders the body, meal context, final items, and photo gallery; an unsaved/foreign/missing id redirects to `/recipes`.
- Delete (from a card and from detail) confirms, then removes the session/recipe/photo rows and storage files, landing on `/recipes`.
- Saving a freshly generated recipe lands on its `/recipes/[id]`.
- `pnpm test`, `pnpm lint`, `pnpm build` pass.

### Key Discoveries:

- Reuse the existing page edge (`confirm.astro:15-29`): `runWithLogging(uc.method(...).pipe(Effect.match({ onFailure, onSuccess })))`. The list collapses to `{ ok, recipes }` (render error vs list/empty); the detail collapses to detail-or-`null` then `return Astro.redirect("/recipes")` on `null`. No new `infrastructure/api` export.
- List query is a recipe⨝session inner join filtered on session state: `recipes` `.select("session_id, name, created_at, recipe_sessions!inner(meal_context, state)")` `.eq("user_id", …)` `.eq("recipe_sessions.state", "saved")` `.order("created_at", { ascending: false })`. Validated at runtime via a hand-written `…FromRow` decoder (the join shape).
- Detail composes existing reads: a new `RecipeRepository.findBySession` (mirrors `RecipeSessionRepository.find`, returns `Option`) + the existing `RecipeSessionRepository.find` + `PhotoRepository.listBySession`.
- Delete reuse: a leaner `useDeleteRecipe` hook (no wizard `beforeunload` to disarm, unlike `useRecipeFinalize.ts:38`) + a `DeleteRecipeButton` island reused on cards and detail. The existing DELETE route already returns `{ redirect: "/recipes" }`, so both surfaces follow the server redirect.
- Save redirect: one-line change in `save.ts` to thread the validated `id` into ``{ redirect: `/recipes/${id}` }``.

## What We're NOT Doing

- **No filters / search / sorting controls** beyond newest-first (PRD Non-Goals; `target_scale: small`).
- **No pagination** — flat list, small scale.
- **No soft-delete / undo** — delete stays a hard delete (S-03).
- **No per-photo recognition breakdown** on detail — only the consolidated final list + the photo gallery (per the answered design).
- **No migration** — schema, indexes, and RLS are already in place.
- **No new shadcn primitive and no `useApiClient` change** — `del`, `AlertDialog`, `Card`, `Button` already exist; reads are server-side so no client `get` is needed.
- **Not refactoring `RecipeDisplay`** to share the markdown renderer — a 3-line duplication is cheaper than risking a wizard regression. (`RecipeBody` is created fresh for detail.)
- **No client-side data fetching** for the pages — reads are SSR-direct (the locked architecture choice).

## Implementation Approach

Two **vertical** slices, each verifiable end-to-end.

**Phase 1 (List):** add the list read model — a `SavedRecipeListItem` response schema, `RecipeRepository.listSaved` (port + adapter + a `SavedRecipeListItemFromRow` decoder), and `RecipeSessionUC.listSavedRecipes`. Render the page through the existing `runWithLogging` + `Effect.match` edge (the `confirm.astro` pattern — no new helper). Build the reusable delete island (`useDeleteRecipe` + `DeleteRecipeButton`). Rewrite `/recipes/index.astro` to SSR-render the card grid (or empty state) with a per-card delete.

**Phase 2 (Detail + save redirect):** add the detail read model — a `SavedRecipeDetail` response, `RecipeRepository.findBySession`, and `RecipeSessionUC.getSavedRecipe` (validate ownership via the existing session `find`, guard `state==='saved'`, compose recipe + final items + photo gallery). Build `/recipes/[id].astro` (markdown body + provenance section + reused delete). Change `save.ts` to redirect to `/recipes/[id]`.

## Critical Implementation Details

- **SSR page edge & redirect-on-failure.** The `.astro` frontmatter runs server-side per request and supports top-level `await`. Each page runs its UC Effect through `runWithLogging` and collapses both channels with `Effect.match` (the `confirm.astro:15-29` pattern) — so a typed failure becomes a value the page branches on, not a throw. The **list** page collapses to `{ ok, recipes }` (failure → error state, success → list/empty — see F2). The **detail** page collapses to detail-or-`null` and does `if (!detail) return Astro.redirect("/recipes")` — the `state!=='saved'` guard's `SnapchefNotFoundError` flows through this same branch. The redirect must be `return`ed from the frontmatter before any markup renders. (Defects are not caught — an unexpected throw rejects to Astro's 500, same as `confirm.astro`.)
- **Detail "not saved" is modeled as NotFound.** `getSavedRecipe` deliberately fails `SnapchefNotFoundError` when the session exists but `state !== "saved"`, so the page's single `!ok → redirect` branch covers missing, foreign, and unsaved ids uniformly (the answered behavior).
- **Embedded-join row shape.** The list query's row is `{ session_id, name, created_at, recipe_sessions: { meal_context, state } }` (to-one embed → object, not array). The `SavedRecipeListItemFromRow` decoder reads `row.recipe_sessions.meal_context`. Decode the array with `tryErrorDataWithSchema(z.array(SavedRecipeListItemFromRow))` — an empty result is `[]` (not null), so no `NotFound` is raised.
- **Delete redirect is server-owned.** Both card and detail delete follow the envelope's `{ redirect: "/recipes" }`; a card delete therefore reloads `/recipes` (the deleted card is gone). No client-side list-state mutation.

---

## Phase 1: Saved-recipes list (`/recipes`)

### Overview

Add the list read model, the SSR page edge, the reusable delete island, and the list page itself. After this phase the user can see and delete saved recipes from `/recipes`.

### Changes Required:

#### 1. List response schema

**File**: `src/lib/core/boundry/recipe/responses.ts`

**Intent**: Define the lean shape each list card needs, so UC, adapter decoder, and page agree on one contract.

**Contract**: Export `SavedRecipeListItem` (zod schema + inferred type, same-name convention) with `{ sessionId: RecipeSessionId, name: z.string(), createdAt: z.string(), mealContext: z.string().nullable() }`. `sessionId` is the handle for the card link (`/recipes/[id]`) and delete.

#### 2. `RecipeRepository.listSaved` — port method

**File**: `src/lib/core/boundry/recipe/ports.ts`

**Intent**: Declare the "list this user's saved recipes" read on the recipe repository.

**Contract**: Add to `RecipeRepository`: `listSaved(userId: UserId): Effect.Effect<SavedRecipeListItem[], SnapchefServerError>`. Import `SavedRecipeListItem` from `./responses` directly (sibling import, not via the barrel).

#### 3. `SavedRecipeListItemFromRow` decoder

**File**: `src/lib/infrastructure/db/types/converters.ts`

**Intent**: Map the joined snake_case row (recipe + embedded session) to `SavedRecipeListItem`, re-validated against the domain schema.

**Contract**: Export `SavedRecipeListItemFromRow`: an unexported row schema `{ session_id, name, created_at, recipe_sessions: { meal_context: string | null } }` → `.transform(row => ({ sessionId: row.session_id, name: row.name, createdAt: row.created_at, mealContext: row.recipe_sessions.meal_context }))` → `.pipe(SavedRecipeListItem)`. Follows the existing `RecipeFromRow` pattern (`converters.ts:16-23`).

#### 4. `RecipeRepository.listSaved` — adapter

**File**: `src/lib/infrastructure/db/RecipeRepository.ts`

**Intent**: Implement the port read with an owner-scoped recipe⨝session inner-join filtered to `state='saved'`, newest first, decoded through the new converter.

**Contract**: New curried `listSaved = (supabase) => (userId) => Effect<SavedRecipeListItem[], SnapchefServerError>`, added to the `createRecipeRepository` returned object. Use `tryErrorDataWithSchema(z.array(SavedRecipeListItemFromRow))`. Query: `.from("recipes").select("session_id, name, created_at, recipe_sessions!inner(meal_context, state)").eq("user_id", userId).eq("recipe_sessions.state", "saved").order("created_at", { ascending: false }).then(({ error, data }) => ({ error, data }))`. The supabase-js static type for the embedded select is approximate — the zod decoder is the runtime contract (consistent with the codebase's decode-at-the-boundary rule).

#### 5. `RecipeSessionUC.listSavedRecipes`

**File**: `src/lib/core/uc/recipe/RecipeSessionUC.ts`

**Intent**: Expose the list read as a UC method the page calls via `context.locals`.

**Contract**: `listSavedRecipes(userId: string): Effect.Effect<SavedRecipeListItem[], SnapchefServerError>` — `this.recipeRepository.listSaved(userId).pipe(logResult("recipe.listSaved"))`. (`recipeRepository` is already a constructor dependency.)

#### 6. SSR page edge — reuse `runWithLogging` (no new helper)

**File**: none (decision note) — pattern lives in the page frontmatter (§9, and Phase 2 §6).

**Intent**: Run the UC read at the Astro page edge using the **existing** sanctioned pattern rather than adding a parallel one. `confirm.astro:15-29` already does this: `runWithLogging(effect.pipe(Effect.match({ onFailure, onSuccess })))` in the frontmatter, then branch. No `infrastructure/api` change.

**Contract**: Each page imports `runWithLogging` from `@/lib/infrastructure/logging/logger` and `Effect` from `effect`. It runs `runWithLogging(Astro.locals.recipeSessions.<read>(…).pipe(Effect.match({ onFailure: <fallback>, onSuccess: <value> })))` and branches on the collapsed value (list → render error/list/empty; detail → redirect on `null`). Defects are intentionally not caught (reject → Astro 500), matching `confirm.astro`. **Do not** add a `runPageQuery`/`PageResult` export — neither page consumes a preserved error object, so the `Effect.match` collapse is sufficient and keeps one page-edge pattern.

#### 7. `useDeleteRecipe` hook

**File**: `src/components/hooks/useDeleteRecipe.ts` (new)

**Intent**: Own the delete call + post-success navigation for the readback surfaces, without the wizard's leave-guard concern.

**Contract**: `useDeleteRecipe(sessionId: string)` returns `{ confirmDelete, isBusy, error }`. `confirmDelete` runs one Effect pipeline at the edge: `apiClient.del(\`/api/recipe-sessions/${sessionId}\`, RedirectTarget)`→ on`result.ok` `window.location.assign(result.data.redirect)`; on `!result.ok`set a Polish error message; transport errors are already toasted by`useApiClient`. Mirrors `useRecipeFinalize.ts`minus`onBeforeNavigate`. Import `RedirectTarget`from`@/lib/core/boundry/auth`.

#### 8. `DeleteRecipeButton` island

**File**: `src/components/recipes/DeleteRecipeButton.tsx` (new)

**Intent**: A reusable destructive-delete control (button + confirm dialog) for list cards and the detail page.

**Contract**: `interface DeleteRecipeButtonProps { sessionId: string }`. Renders a destructive `Button` (`Trash2` icon) that opens an `AlertDialog` ("Usunąć przepis?" / "Anuluj" + "Usuń"); confirm calls `confirmDelete` from `useDeleteRecipe`; disabled while `isBusy`. Reuse the exact `AlertDialog` markup from `RecipeDisplay.tsx:45-64`. Polish strings. Mounted with `client:visible`.

#### 9. List page (`/recipes`)

**File**: `src/pages/recipes/index.astro`

**Intent**: SSR-render the saved-recipes card grid (or empty state), keeping the existing header + "Nowy przepis" CTA.

**Contract**: In the frontmatter: guard `if (!Astro.locals.user) return Astro.redirect("/auth/signin")`; run the read through the `confirm.astro` edge — `const result = await runWithLogging(Astro.locals.recipeSessions.listSavedRecipes(user.id).pipe(Effect.match({ onFailure: () => ({ ok: false as const }), onSuccess: (recipes) => ({ ok: true as const, recipes }) })))`. Render with a **three-way** branch — failure, empty, and non-empty are distinct: keep the header + CTA always; on `!result.ok` render a distinct **error state** (a short Polish message, e.g. "Nie udało się wczytać przepisów." + a reload link) — **not** the empty-state CTA; on `result.ok && result.recipes.length === 0` show the existing empty-state card; otherwise a responsive card grid (mobile-first, single column → multi-column) where each card is an anchor to `/recipes/${r.sessionId}` showing `r.name`, the formatted `r.createdAt` (`new Date(...).toLocaleDateString("pl-PL")`), and a truncated `r.mealContext` snippet, with `<DeleteRecipeButton sessionId={r.sessionId} client:visible />`. Use `Card`/`buttonVariants` already imported. A factored `src/components/recipes/list/RecipeCard.astro` is optional if the page gets crowded.

#### 10. UC unit test — `listSavedRecipes`

**File**: `src/lib/core/uc/recipe/RecipeSessionUC.test.ts`

**Intent**: Cover the list method with the existing fake-port style.

**Contract**: `listSavedRecipes` delegates to `recipeRepository.listSaved(userId)` and returns its items. Add a `listSaved` stub to the recipe-repository test double.

#### 11. Component test — `DeleteRecipeButton`

**File**: `src/components/recipes/DeleteRecipeButton.test.tsx` (new)

**Intent**: Cover the confirm-gated delete without a real network.

**Contract**: The button opens the dialog; only the confirm action issues the `DELETE`; the button disables while busy. Use the existing component-test transport mock + `getByRole`/`getByText` locators (mirror `RecipeDisplay.test.tsx`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm build`
- Linting passes: `pnpm lint`
- Unit/component tests pass: `pnpm test`

#### Manual Verification:

- `/recipes` lists only the signed-in user's `saved` sessions, newest first; name + date + meal-context snippet render; a session left in `recipe_generated` does **not** appear.
- A second account sees none of the first account's recipes (RLS read path).
- Zero saved recipes shows the empty-state CTA.
- A simulated list read failure renders a distinct error state (with reload), **not** the empty-state CTA.
- A card delete confirms, removes the session/recipe/photo rows + storage files, and reloads `/recipes` without the card.
- Layout is readable on a narrow mobile viewport.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Recipe detail (`/recipes/[id]`) + save redirect

### Overview

Add the detail read model and page (recipe body + provenance + delete), and redirect a successful save to the new detail page. After this phase the full create→save→read→delete loop is closed.

### Changes Required:

#### 1. Detail response schema

**File**: `src/lib/core/boundry/recipe/responses.ts`

**Intent**: One contract for everything the detail page renders.

**Contract**: Export `SavedRecipeDetail` (schema + type) with `{ recipe: RecipeView, mealContext: z.string().nullable(), items: z.array(RecognizedItem), photos: z.array(<gallery item>) }`, where the gallery item is `{ id: PhotoId, photoUrl: z.string() }` (define inline or as a small `RecipeGalleryPhoto` schema — leaner than `PhotoView`, drops `recognizedItems` since per-photo recognition is not shown). `RecipeView` carries name + `contentMd` + ids; `items` is the final consolidated list; `photos` is the gallery.

#### 2. `RecipeRepository.findBySession` — port + adapter

**File**: `src/lib/core/boundry/recipe/ports.ts`, `src/lib/infrastructure/db/RecipeRepository.ts`

**Intent**: Fetch the single recipe belonging to a session (owner-scoped), reporting absence as `Option`.

**Contract**: Port: `findBySession(userId: UserId, sessionId: string): Effect.Effect<Option.Option<Recipe>, SnapchefServerError>`. Adapter: curried `findBySession` using `tryErrorDataOption<RecipeRow>` with `.from("recipes").select("*").eq("user_id", userId).eq("session_id", sessionId).single().then(({ error, data }) => ({ error, data }))`, then `Effect.flatMap(opt => Effect.transposeMapOption(opt, decodeWith(RecipeFromRow)))`. Mirrors `RecipeSessionRepository.find`. Add to the factory's returned object.

#### 3. `RecipeSessionUC.getSavedRecipe`

**File**: `src/lib/core/uc/recipe/RecipeSessionUC.ts`

**Intent**: Compose the detail payload, enforcing that only the owner's **saved** recipe is viewable.

**Contract**: `getSavedRecipe(userId: string, sessionId: string): Effect.Effect<SavedRecipeDetail, SnapchefServerError>` — `fetchRecipeSession(userId, sessionId)` (NotFound if missing/foreign) → guard `session.state === "saved"` via `match`, else fail `SnapchefNotFoundError` ("Recipe not saved") → `recipeRepository.findBySession(userId, sessionId)` then `getOrThrowNotFound` → `photoRepository.listBySession(userId, sessionId)` → assemble `{ recipe: <RecipeView: omit userId>, mealContext: session.mealContext, items: session.correctedItems ?? session.recognizedItems ?? [], photos: photos.map(p => ({ id: p.id, photoUrl: p.photoUrl })) }`. Wrap with `logResult("recipe.getSaved")`. (Use `RecipeView.parse`/`decodeWith` or structural omit to drop `userId`.)

#### 4. Recipe markdown body component

**File**: `src/components/recipes/RecipeBody.tsx` (new)

**Intent**: Presentational markdown renderer reused by the detail page (and available to the wizard later); SSR-rendered with no client directive.

**Contract**: `interface RecipeBodyProps { contentMd: string }` → `<div className={cn("prose prose-sm dark:prose-invert max-w-none")}><Markdown>{contentMd}</Markdown></div>`. Same renderer as `RecipeDisplay.tsx:39-41`. No hooks/state → renders to static HTML when mounted without `client:*`.

#### 5. Provenance section component

**File**: `src/components/recipes/detail/RecipeProvenance.astro` (new)

**Intent**: Render the static context section beneath the recipe in the answered order: meal description → final ingredient list → photo gallery.

**Contract**: Props `{ mealContext: string | null, items: RecognizedItem[], photos: { id: string; photoUrl: string }[] }`. Render (each section omitted when empty): the meal-context text; the final `[name — quantity]` list from `items`; a responsive image grid of `photos` with `<img loading="lazy" alt="Zdjęcie produktów" …>` (mobile-first, no horizontal scroll). Polish section headings. Per-photo recognition is **not** rendered.

#### 6. Detail page (`/recipes/[id]`)

**File**: `src/pages/recipes/[id].astro` (new)

**Intent**: SSR the recipe detail, redirecting away when the id is missing/foreign/unsaved.

**Contract**: Frontmatter: `if (!Astro.locals.user) return Astro.redirect("/auth/signin")`; validate `Astro.params.id` with `RecipeSessionId.safeParse` → on failure `return Astro.redirect("/recipes")`; run through the `confirm.astro` edge — `const detail = await runWithLogging(Astro.locals.recipeSessions.getSavedRecipe(user.id, id).pipe(Effect.match({ onFailure: () => null, onSuccess: (d) => d })))`; `if (!detail) return Astro.redirect("/recipes")`. Body (in `AppLayout`, `title={detail.recipe.name}`): an `<article>` with the name as `<h1>`, then `<RecipeBody contentMd={detail.recipe.contentMd} />` (no client directive → SSR), then `<RecipeProvenance mealContext=… items=… photos=… />`, then `<DeleteRecipeButton sessionId={detail.recipe.sessionId} client:visible />`. A "← back to list" link to `/recipes` is fine.

#### 7. Save redirect → detail page

**File**: `src/pages/api/recipe-sessions/[id]/save.ts`

**Intent**: Land a successful save on the just-saved recipe's detail page (closing the create loop), now that `/recipes/[id]` exists.

**Contract**: Thread the validated `id` into the redirect: in the `Effect.all([...]).pipe(...)`, replace the trailing `Effect.as<RedirectTarget>({ redirect: "/recipes" })` with a `flatMap` that runs `saveSession(authUser.id, id)` and then `Effect.as<RedirectTarget>({ redirect: \`/recipes/${id}\` })`. No other route changes.

#### 8. UC unit tests — `getSavedRecipe`

**File**: `src/lib/core/uc/recipe/RecipeSessionUC.test.ts`

**Intent**: Cover the detail composition and its guards.

**Contract**: A `saved` session returns `{ recipe, mealContext, items, photos }` with `items` taken from `correctedItems` and photos projected to `{ id, photoUrl }`; a session with `state !== "saved"` yields `SnapchefNotFoundError`; a missing/foreign session yields `SnapchefNotFoundError` before any recipe/photo read; a saved session whose recipe row is absent yields `SnapchefNotFoundError`. Add a `findBySession` stub to the recipe-repository test double.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm build`
- Linting passes: `pnpm lint`
- Unit/component tests pass: `pnpm test`

#### Manual Verification:

- Opening a saved recipe shows: name + markdown body, then meal context, then the final ingredient list, then the photo gallery; per-photo recognition is absent.
- `/recipes/[id]` for a missing, foreign, or `recipe_generated`-but-unsaved id redirects to `/recipes`.
- Delete from the detail page confirms, removes the rows + storage files, and lands on `/recipes`.
- Generating then saving a recipe in the wizard now lands on `/recipes/[id]` showing the saved recipe.
- Detail layout (body + gallery) is readable on a narrow mobile viewport.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `RecipeSessionUC.listSavedRecipes`: delegates to `recipeRepository.listSaved`.
- `RecipeSessionUC.getSavedRecipe`: composes recipe + final items + photo gallery for a `saved` session; `NotFound` for non-saved, missing, foreign, or recipe-absent cases.

### Component Tests:

- `DeleteRecipeButton`: confirm-gated DELETE; busy-state disabling.

### Manual Testing Steps:

1. With ≥2 saved recipes, open `/recipes` → cards newest-first, name + date + snippet; verify a `recipe_generated`-only session is absent.
2. Sign in as a second account → none of the first account's recipes appear.
3. Open a recipe → verify body, meal context, final items, photo gallery (no per-photo lists).
4. Visit `/recipes/<random-uuid>` and `/recipes/<not-saved-id>` → both redirect to `/recipes`.
5. Delete from a card and from the detail page → confirm dialog, then `/recipes` without the recipe; check rows + bucket files gone.
6. Generate + save in the wizard → land on `/recipes/[id]`.
7. Repeat key screens on a narrow mobile viewport.

## Performance Considerations

Negligible. The list is one indexed join (`recipes_user_id_created_at_idx`); the detail is three small owner-scoped reads (recipe, session, photos) plus signed-URL generation already used elsewhere. Flat list at `target_scale: small` — no pagination needed.

## Migration Notes

None — `recipes`/`recipe_sessions`/`photos` tables, the `(user_id, created_at DESC)` indexes, and the per-operation RLS policies already exist. No schema change.

## References

- Roadmap slice S-04: `context/foundation/roadmap.md:142-152`
- UI architecture (routes, SSR split, delete-on-both): `context/foundation/ui-architecture.md` §2–3, §6, §8
- Predecessor (delete plumbing, redirect contract): `context/changes/save-session-and-recipe/plan.md`
- Edge runner: `src/lib/infrastructure/logging/logger.ts:48`; route edge: `src/lib/infrastructure/api/index.ts:57-65`
- Delete reference flow: `src/components/recipes/wizard/useRecipeFinalize.ts`, `RecipeDisplay.tsx:45-64`
- Markdown rendering: `src/components/recipes/wizard/RecipeDisplay.tsx:39-41`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Saved-recipes list (`/recipes`)

#### Automated

- [x] 1.1 Type checking passes: `pnpm build`
- [x] 1.2 Linting passes: `pnpm lint`
- [x] 1.3 Unit/component tests pass: `pnpm test`

#### Manual

- [ ] 1.4 `/recipes` lists only the user's `saved` sessions, newest first (name + date + snippet); `recipe_generated`-only sessions absent
- [ ] 1.5 A second account sees none of the first account's recipes (RLS read path)
- [ ] 1.6 Zero saved recipes shows the empty-state CTA
- [ ] 1.7 List read failure renders a distinct error state (with reload), not the empty-state CTA
- [ ] 1.8 Card delete confirms, removes rows + storage files, reloads `/recipes` without the card
- [ ] 1.9 List readable on a narrow mobile viewport

### Phase 2: Recipe detail (`/recipes/[id]`) + save redirect

#### Automated

- [ ] 2.1 Type checking passes: `pnpm build`
- [ ] 2.2 Linting passes: `pnpm lint`
- [ ] 2.3 Unit/component tests pass: `pnpm test`

#### Manual

- [ ] 2.4 Detail shows name + body, then meal context, final items, photo gallery; no per-photo recognition
- [ ] 2.5 Missing / foreign / not-saved id redirects to `/recipes`
- [ ] 2.6 Delete from detail confirms, removes rows + storage files, lands on `/recipes`
- [ ] 2.7 Wizard save now lands on `/recipes/[id]` showing the saved recipe
- [ ] 2.8 Detail readable on a narrow mobile viewport
