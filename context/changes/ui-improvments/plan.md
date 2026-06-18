# Recipe Wizard UI Improvements Implementation Plan

## Overview

Four UI improvements to the "create new recipe" flow (`/recipes/new`, the `RecipeWizard` React island):

1. A top-left **back link** to the recipes list that, when there is unsaved work, shows an in-app confirmation dialog before leaving (no delete).
2. A bottom **Cancel** button (from the moment the session exists) that deletes everything tied to the session and returns to the list.
3. The wizard's final step becomes a **cumulative read-only view**: the previously-entered content (photos, item list, meal context, off-list toggle) stays visible but read-only, with the generated recipe appended below.
4. The generated recipe's **name appears as a heading above** the recipe content.

All four are front-end only. The backend already provides everything needed: `deleteSession` UC + `DELETE /api/recipe-sessions/[id]` (storage cleanup + DB cascade, redirect `/recipes`), `useRecipeFinalize` (`save`/`confirmDelete`, disarms the leave-guard), `RecipeBody`, and the `AlertDialog` primitive. **No DB migrations, no API changes.**

## Current State Analysis

The flow is a 3-state machine in `src/components/recipes/wizard/RecipeWizard.tsx:7` (`"upload" | "review" | "recipe"`) where **each step fully replaces the previous component**:

- **upload** → `UploadStep` — picks photos, then on submit `POST /api/recipe-sessions` creates the session, uploads, and recognizes. The session exists only _after_ this step (its id arrives in `RecognitionResult.session.id`).
- **review** → `ReviewStep` (`ReviewStep.tsx:18`) — read-only `PhotoReviewCard`s + **editable** `ProductListEditor` + `RecipeGenerationPanel` (editable meal-context **`Textarea`** + off-list `Switch` + generate).
- **recipe** → `RecipeDisplay` (`RecipeDisplay.tsx:30`) — recipe **name as `CardTitle`** above the markdown body, footer = Save + "Usuń" (delete).

Leave-guard: `RecipeWizard.tsx:22-40` arms a `beforeunload` handler when `dirty` (photos selected), with a ref-backed `guardArmed` flag and `disarmLeaveGuard()` so the finalize flow can suppress the prompt synchronously before `window.location.assign`.

### Key Discoveries:

- **The saved-recipe detail page is the reference layout for items 3 & 4.** `src/pages/recipes/[id].astro:42-52`: top-left back link (`← Wróć do przepisów`), `<h1>{recipe.name}</h1>` above `<RecipeBody>`, then `RecipeProvenance.astro` (read-only meal context + consolidated item list + photo gallery). The wizard's recipe step should mirror this — but `RecipeProvenance` is `.astro` and cannot run inside the React island, so a React equivalent is needed (`src/components/recipes/detail/RecipeProvenance.astro:13-56`).
- **Item 4 is already satisfied in isolation** (`RecipeDisplay.tsx:36` renders `recipe.name`); it becomes a _layout constraint_ on the new item-3 view.
- **Item 3 needs data that `RecipeView` does not carry.** `RecipeView = Recipe.omit({userId})` = `{id, sessionId, name, contentMd}` (`responses.ts:22`) — no items, no meal context. The submitted `RecipeGenerationCommand {correctedItems, mealContext, allowExtraIngredients}` (`commands.ts`) is known at generate time and held as `lastCommand` in `useRecipeGeneration.ts:23`; it must be lifted up to render the read-only summary.
- **Delete + finalize machinery is ready.** `useRecipeFinalize(sessionId, onBeforeNavigate)` (`useRecipeFinalize.ts:19`) exposes `save` and `confirmDelete`, both disarming the leave-guard before redirect, both surfacing a Polish error on envelope failure and staying on the page. `DeleteRecipeButton.tsx` shows the AlertDialog-confirm pattern.
- **The back link must live inside the island.** It needs the island-owned `dirty` state to decide whether to warn; a static `.astro` link cannot. The heading therefore moves into the island so the back link can sit above it (matching the detail page).
- Existing component tests touched by the refactor: `RecipeDisplay.test.tsx`, `RecipeGenerationPanel.test.tsx` (and `ProductListEditor.test.tsx` is adjacent but unaffected).

## Desired End State

On `/recipes/new`:

- A top-left **back link** is present from the start. With no unsaved work it navigates straight to `/recipes`; with unsaved work it opens a confirm dialog warning about losing content and, on confirm, navigates without deleting the session (matching today's tab-close semantics).
- Once the session exists (review step onward), a **Cancel** button sits at the bottom; clicking it opens a confirm dialog and, on confirm, deletes the session (storage + cascade) and returns to `/recipes`. On server failure the user stays on the page with a Polish error.
- After generation, the step shows, **in order**: read-only photos → read-only item list → read-only meal context → read-only off-list toggle → the recipe **name as a heading** → the recipe markdown body, with a bottom action row of **Cancel + Save** (no "Usuń").

Verify by walking the flow in the running app and by the unit tests listed per phase.

## What We're NOT Doing

- No backend/UC/route/DB changes — `deleteSession`, the DELETE route, and the cascade already exist.
- No change to the upload→review transition (photos already render read-only on the review step; the user confirmed that transition is the reference behavior).
- No "edit after generate" / "regenerate" affordance — generation remains one-way (review content freezes read-only on the recipe step), as today.
- No conversion of the existing `RecipeProvenance.astro` / detail page to React — the wizard gets its own React read-only summary; the detail page is left untouched.
- No E2E in this change (the user chose unit coverage; E2E can follow via `/10x-e2e`).
- The `beforeunload` browser guard stays — the back-link dialog supplements it for in-app back navigation, it does not replace it.

## Implementation Approach

Centralize the wizard "chrome" in `RecipeWizard`: it renders the back link (top), the heading, the active step's content, and the bottom action row. The step components stay focused on their own concern. Item 3's read-only view is built by **lifting the submitted generation snapshot** up to `RecipeWizard` (rather than toggling the editable components into a read-only mode), which keeps the read-only summary a simple presentational component that mirrors the detail page's provenance and reuses `RecipeBody` for the recipe markdown.

Each phase leaves the app fully usable.

## Critical Implementation Details

- **Synchronous guard disarm before navigation.** Any intentional navigation away from the wizard (`back-link confirm`, `Cancel` delete, `Save`) must call `disarmLeaveGuard()` _before_ `window.location.assign`, or the `beforeunload` prompt fires on top of the redirect. `useRecipeFinalize` already does this for save/delete; the new back link must do the same via the same `onBeforeNavigate` callback.
- **Hook placement.** `useRecipeFinalize` requires a session id, which only exists from the review step onward. The action row that uses it must therefore live in a child component rendered only when `result !== null` (hooks cannot be conditional), not directly in `RecipeWizard`'s body.

---

## Phase 1: Back link + leave-guard dialog (item 1)

### Overview

Move the page chrome into the island and add a guarded top-left back link to `/recipes`.

### Changes Required:

#### 1. Page heading moves into the island

**File**: `src/pages/recipes/new.astro`

**Intent**: Make `RecipeWizard` the page's content owner so the back link can render above the heading (matching the detail page). Move the `<h1>` "Nowy przepis" + subtitle out of the page and into the island.

**Contract**: `new.astro` renders `<AppLayout title="Nowy przepis — Snapchef"><RecipeWizard client:load /></AppLayout>` with no inner heading markup; the `flex flex-col gap-6` wrapper and heading text relocate into `RecipeWizard`.

#### 2. Guarded back link component

**File**: `src/components/recipes/wizard/WizardExitLink.tsx` (new)

**Intent**: A top-left back-to-list link that navigates directly when there's no unsaved work, and otherwise opens a confirm dialog warning about losing content; on confirm it disarms the leave-guard and navigates to `/recipes` (no delete).

**Contract**: `interface WizardExitLinkProps { dirty: boolean; onBeforeNavigate: () => void }`. Uses the shadcn `AlertDialog`. Visual style mirrors the detail page's back link (`[id].astro:42` — `← Wróć do przepisów`, muted text). Dialog copy is Polish, e.g. title "Opuścić bez zapisywania?", body explaining the in-progress recipe will be lost. Confirm action: `onBeforeNavigate(); window.location.assign("/recipes")`. When `!dirty`, the trigger navigates directly without opening the dialog.

#### 3. Render chrome in the wizard

**File**: `src/components/recipes/wizard/RecipeWizard.tsx`

**Intent**: Render `WizardExitLink` (top-left) and the relocated heading above the step content, wiring the link to the existing `dirty` state and `disarmLeaveGuard`.

**Contract**: Wrap the existing step-switch return in a `flex flex-col gap-6` container whose first child is `<WizardExitLink dirty={dirty} onBeforeNavigate={disarmLeaveGuard} />`, then the heading block, then the step content. No change to the step-selection logic or the `beforeunload` effect.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm exec tsc --noEmit --ignoreDeprecations 6.0`
- Linting passes: `pnpm lint`
- Unit tests pass: `pnpm test`
- New test for `WizardExitLink` passes: not-dirty → navigates directly; dirty → opens dialog; confirm → calls `onBeforeNavigate` and assigns `/recipes`.

#### Manual Verification:

- The back link appears top-left on `/recipes/new` above the "Nowy przepis" heading.
- With no photos selected, clicking it goes straight to `/recipes`.
- After selecting photos (or later steps), clicking it shows the confirm dialog; "stay" keeps you in the wizard, "leave" returns to the list without the browser's own prompt appearing on top.

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Cancel action + recipe-step action consolidation (item 2)

### Overview

Add a bottom Cancel button (session-deleting) from the review step onward, move Save into the same action row, and drop the standalone "Usuń".

### Changes Required:

#### 1. Shared wizard action row

**File**: `src/components/recipes/wizard/WizardActions.tsx` (new)

**Intent**: Render the wizard's bottom actions using a single `useRecipeFinalize` instance so Cancel (delete) and Save share busy/error state and both disarm the leave-guard. Cancel is always present; Save appears only on the recipe step.

**Contract**: `interface WizardActionsProps { sessionId: string; onBeforeNavigate: () => void; showSave: boolean }`. Cancel is a destructive-styled button behind an `AlertDialog` (Polish copy, e.g. "Anulować tworzenie przepisu?" / "Przesłane zdjęcia i rozpoznane produkty zostaną trwale usunięte.") whose confirm calls `confirmDelete`. Save (when `showSave`) calls `save`. The shared envelope-error message renders inline (reusing `useRecipeFinalize`'s `error`), and buttons disable while `isBusy`. Delete/save failures keep the user on the page (existing hook behavior). Reuse the dialog structure from `DeleteRecipeButton.tsx:28-49`.

#### 2. Render the action row when a session exists

**File**: `src/components/recipes/wizard/RecipeWizard.tsx`

**Intent**: Show `WizardActions` at the bottom whenever `result` exists (review + recipe steps), passing the session id and guard-disarm callback; `showSave` is true only on the recipe step.

**Contract**: Below the step content, render `result && <WizardActions sessionId={result.session.id} onBeforeNavigate={disarmLeaveGuard} showSave={step === "recipe" && !!recipe} />`. The hook lives in `WizardActions`, so it is only constructed when `result` is non-null.

#### 3. Strip the in-card footer from the recipe display

**File**: `src/components/recipes/wizard/RecipeDisplay.tsx`

**Intent**: Remove the Save + "Usuń" footer (and its `useRecipeFinalize` usage / `onBeforeNavigate` prop), leaving `RecipeDisplay` as name + body presentation. The actions now live in `WizardActions`.

**Contract**: `RecipeDisplay` renders the `Card` with `CardTitle = recipe.name` and the markdown body only; drop `CardFooter`, the `AlertDialog`, and the finalize hook. `RecipeWizard` stops passing `onBeforeNavigate` to it. (This component is superseded entirely in Phase 3.)

#### 4. Move finalize coverage to the action row

**File**: `src/components/recipes/wizard/WizardActions.test.tsx` (new); `src/components/recipes/wizard/RecipeDisplay.test.tsx` (update)

**Intent**: Relocate the save/delete assertions (previously in `RecipeDisplay.test.tsx`) to `WizardActions`, and reduce `RecipeDisplay.test.tsx` to name+body presentation.

**Contract**: `WizardActions.test.tsx` mirrors the mock-transport pattern in `RecipeDisplay.test.tsx:10-40` (mock `useApiClient`, record `post`/`del` URLs, `Effect.never` for busy): Cancel→confirm posts `DELETE /api/recipe-sessions/{id}` and assigns the redirect; Save posts `…/save` and assigns; an `{ok:false}` envelope keeps the component mounted with the error text.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm exec tsc --noEmit --ignoreDeprecations 6.0`
- Linting passes: `pnpm lint`
- Unit tests pass: `pnpm test`
- `WizardActions` tests cover cancel→delete→redirect, save→redirect, and failure→stay-with-error.

#### Manual Verification:

- On the review step a Cancel button appears at the bottom; confirming it deletes the session and lands on `/recipes` (the session no longer appears in the list).
- The recipe step shows Cancel + Save and no longer shows a separate "Usuń".
- A simulated server failure on Cancel keeps the user on the page with a Polish error.

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Cumulative read-only recipe view (items 3 & 4)

### Overview

Lift the submitted generation snapshot up and render the recipe step as kept-content-read-only (photos, items, meal context, off-list toggle) followed by the recipe name above its body.

### Changes Required:

#### 1. Surface the submitted command from the generation hook

**File**: `src/components/recipes/wizard/useRecipeGeneration.ts`

**Intent**: Report the command that produced the recipe so the read-only summary can render exactly what the user generated from.

**Contract**: Change the callback type to `onGenerated: (recipe: RecipeView, command: RecipeGenerationCommand) => void`; on the `{ok:true}` branch call `onGenerated(data, command)` (the `command` is already in scope at `useRecipeGeneration.ts:33-39`).

#### 2. Thread the command up through the panel and review step

**File**: `src/components/recipes/wizard/RecipeGenerationPanel.tsx`, `src/components/recipes/wizard/ReviewStep.tsx`

**Intent**: Pass the new `(recipe, command)` callback through unchanged. The review step's meal-context input stays an editable `Textarea` (read-only conversion happens only on the recipe step, in the new view).

**Contract**: Both components' `onGenerated` prop type widens to `(recipe: RecipeView, command: RecipeGenerationCommand) => void` and forwards the second arg. No behavior change on the review step itself.

#### 3. Store the snapshot in the wizard

**File**: `src/components/recipes/wizard/RecipeWizard.tsx`

**Intent**: Keep the generated recipe together with the command snapshot so the recipe step can render the read-only summary.

**Contract**: Replace the `recipe` state with a combined `generated: { recipe: RecipeView; command: RecipeGenerationCommand } | null`; `handleGenerated(recipe, command)` sets it and `setStep("recipe")`. The recipe-step branch renders `<GeneratedRecipeView recipe={generated.recipe} photos={result.photos} command={generated.command} />`.

#### 4. Read-only review summary

**File**: `src/components/recipes/wizard/WizardReviewSummary.tsx` (new)

**Intent**: A presentational, read-only echo of what was entered before generation — the React counterpart of `RecipeProvenance.astro`, plus the off-list toggle state (per the user's choice).

**Contract**: `interface WizardReviewSummaryProps { photos: PhotoView[]; items: RecognizedItem[]; mealContext: string; allowExtraIngredients: boolean }`. Renders sections mirroring `RecipeProvenance.astro:13-56`: a photo gallery (images via `photo.photoUrl`), the consolidated item list (name — quantity), the meal context as `whitespace-pre-line` muted text, and a short read-only line reflecting the off-list toggle (reuse the on/off wording from `RecipeGenerationPanel.tsx:67-69`). Each section renders only when it has content. No inputs, no `Textarea`, no edit controls.

#### 5. Generated-recipe view

**File**: `src/components/recipes/wizard/GeneratedRecipeView.tsx` (new); remove `src/components/recipes/wizard/RecipeDisplay.tsx` + `RecipeDisplay.test.tsx`

**Intent**: Compose the kept read-only content first, then the generated recipe (name heading above body). Replaces `RecipeDisplay`.

**Contract**: `interface GeneratedRecipeViewProps { recipe: RecipeView; photos: PhotoView[]; command: RecipeGenerationCommand }`. Renders `<WizardReviewSummary … />` (fed from `command` + `photos`) followed by the recipe: a name heading styled like the detail page (`[id].astro:48` — `<h1 class="text-3xl font-semibold">`) above `<RecipeBody contentMd={recipe.contentMd} />`. No action buttons (those come from `WizardActions`, rendered by `RecipeWizard` below). Delete the now-unused `RecipeDisplay` and its test.

#### 6. Update the generation-panel test for the new callback

**File**: `src/components/recipes/wizard/RecipeGenerationPanel.test.tsx`

**Intent**: Assert the panel forwards `(recipe, command)` on generate.

**Contract**: Update the `onGenerated` spy expectation to receive the command as the second argument carrying the submitted `{correctedItems, mealContext, allowExtraIngredients}`.

#### 7. Cover the read-only view

**File**: `src/components/recipes/wizard/GeneratedRecipeView.test.tsx` (new)

**Intent**: Verify the read-only summary and ordering.

**Contract**: Renders photos, the item list, the meal context text, and the off-list-toggle line read-only (no textbox/textarea present — assert via `queryByRole("textbox")` being null); the recipe name appears as a heading above the markdown body; kept content precedes the recipe.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm exec tsc --noEmit --ignoreDeprecations 6.0`
- Linting passes: `pnpm lint`
- Unit tests pass: `pnpm test`
- `GeneratedRecipeView` test asserts read-only summary (no `textbox`), name-above-body ordering, and kept-content-first ordering.

#### Manual Verification:

- After generating, the step shows the photos, item list, meal context, and off-list setting as read-only content (the meal context is plain text, not a textarea), followed by the recipe name as a heading above the recipe body, with Cancel + Save at the bottom.
- Save persists and redirects to `/recipes` where the recipe is listed; Cancel deletes and redirects.

**Implementation Note**: After automated verification passes, pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests (Vitest + Testing Library, jsdom):

- `WizardExitLink`: not-dirty navigates directly; dirty opens dialog; confirm disarms guard + assigns `/recipes`.
- `WizardActions`: cancel→confirm→`DELETE` + redirect; save→`/save` + redirect; failure envelope → stays + Polish error; buttons disabled while busy.
- `WizardReviewSummary` / `GeneratedRecipeView`: read-only sections render (no `textbox`); off-list toggle echoed; recipe name heading above body; kept content precedes recipe.
- Update `RecipeGenerationPanel.test.tsx` for the `(recipe, command)` callback; reduce/replace `RecipeDisplay.test.tsx` (finalize assertions move to `WizardActions.test.tsx`).

### Manual Testing Steps:

1. Open `/recipes/new`; click back link with nothing selected → lands on `/recipes`.
2. Select photos → click back link → confirm dialog → "leave" returns to list, session remains in DB (not deleted).
3. Run recognition → on the review step, Cancel → confirm → session deleted, back to `/recipes` (not in list).
4. Generate a recipe → verify read-only summary (photos/items/meal-context-as-text/toggle) then name-above-body; Save → recipe appears in `/recipes`.
5. Force a delete failure (e.g. offline) → Cancel keeps you on the page with an error.

## Performance Considerations

None — purely presentational/navigational changes; the delete path already exists and is unchanged.

## Migration Notes

None — no schema or data changes. The decision that the back link does **not** delete means in-progress (unsaved) sessions can remain in the DB after a back-navigation, identical to today's tab-close behavior; this is intentional and unchanged by this work.

## References

- Reference layout (items 3 & 4): `src/pages/recipes/[id].astro`, `src/components/recipes/detail/RecipeProvenance.astro`, `src/components/recipes/RecipeBody.tsx`
- Delete/finalize machinery: `src/components/recipes/wizard/useRecipeFinalize.ts`, `src/components/recipes/DeleteRecipeButton.tsx`, `src/pages/api/recipe-sessions/[id]/index.ts`
- Current wizard: `src/components/recipes/wizard/RecipeWizard.tsx`, `ReviewStep.tsx`, `RecipeGenerationPanel.tsx`, `RecipeDisplay.tsx`, `useRecipeGeneration.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Back link + leave-guard dialog

#### Automated

- [x] 1.1 Type checking passes: `pnpm exec tsc --noEmit --ignoreDeprecations 6.0` — eaa656bdf
- [x] 1.2 Linting passes: `pnpm lint` — eaa656bdf
- [x] 1.3 Unit tests pass: `pnpm test` — eaa656bdf
- [x] 1.4 `WizardExitLink` test passes (direct nav / dialog / confirm→disarm+assign) — eaa656bdf

#### Manual

- [ ] 1.5 Back link appears top-left above the heading
- [ ] 1.6 No unsaved work → navigates directly; unsaved work → confirm dialog, no double browser prompt

### Phase 2: Cancel action + recipe-step action consolidation

#### Automated

- [x] 2.1 Type checking passes: `pnpm exec tsc --noEmit --ignoreDeprecations 6.0`
- [x] 2.2 Linting passes: `pnpm lint`
- [x] 2.3 Unit tests pass: `pnpm test`
- [x] 2.4 `WizardActions` tests cover cancel→delete→redirect, save→redirect, failure→stay+error

#### Manual

- [ ] 2.5 Review step shows a bottom Cancel; confirm deletes session and returns to `/recipes` (gone from list)
- [ ] 2.6 Recipe step shows Cancel + Save, no standalone "Usuń"
- [ ] 2.7 Simulated delete failure keeps user on page with a Polish error

### Phase 3: Cumulative read-only recipe view

#### Automated

- [ ] 3.1 Type checking passes: `pnpm exec tsc --noEmit --ignoreDeprecations 6.0`
- [ ] 3.2 Linting passes: `pnpm lint`
- [ ] 3.3 Unit tests pass: `pnpm test`
- [ ] 3.4 `GeneratedRecipeView` test asserts read-only summary (no `textbox`), name-above-body, kept-content-first
- [ ] 3.5 `RecipeGenerationPanel.test.tsx` updated for `(recipe, command)` callback

#### Manual

- [ ] 3.6 Recipe step shows read-only photos/items/meal-context-text/off-list toggle, then name heading above body, then Cancel + Save
- [ ] 3.7 Save lists the recipe under `/recipes`; Cancel deletes and redirects
