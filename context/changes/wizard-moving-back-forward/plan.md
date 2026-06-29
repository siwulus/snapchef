# Move Back and Forward Through the New-Recipe Wizard — Implementation Plan

## Overview

Make the new-recipe wizard bidirectional. Today the wizard is a forward-only, in-memory React stepper: a local `Step` union advances `upload → review → recipe` and never goes back. This plan adds a clickable 3-step indicator, lets the user return to any reached step, retains uploaded photos in memory across step changes (so they can delete/add specific photos without re-selecting the whole set), pre-populates each step's form from the live session, and invalidates stale downstream data client-side when an earlier step is re-run.

**This is a 100% front-end change.** The server-side recipe-session FSM already permits backward navigation (re-firing `upload_photos` / `recognize_products` / `generate_recipe` from a later state is a legal, re-entrant edge that resets state and re-runs the step — `recipe-session-state-machine.ts:17-31`), and the upload route already full-replaces photos on re-upload to an existing session. No new endpoints, no migration, no FSM edits, no persistence-layer changes.

## Current State Analysis

The constraint that makes the wizard forward-only lives entirely in the React layer (confirmed by reading the code and corroborated by two independent investigations in the frame brief + research doc):

- **`RecipeWizard.tsx:20`** holds `useState<Step>("upload")`, decoupled from `session.state`. `setStep` is called only forward — `:53` (`upload → review` on recognition success) and `:59` (`review → recipe` on generation success). There is no back affordance: `WizardExitLink` leaves the page, `WizardActions` "Anuluj" deletes the whole session.
- **`PhotoUploader.tsx:23`** owns the selected-File set via `useObjectUrls()` (local state). When the step changes off `upload`, `PhotoUploader` unmounts and the File set + preview URLs are revoked — so returning to the upload step today would lose the photos.
- **`usePhotoUpload.ts:90`** always `POST /api/recipe-sessions` to mint a **new** session on every submit. A naive back-to-upload + resubmit would orphan the first session's storage + rows.
- **`WizardReviewProducts.tsx:21`** seeds `useEditableItems(session.recognizedItems)` — ignoring `session.correctedItems` (the user's prior edits, persisted on generation).
- **`RecipeGenerationPanel.tsx:25-26`** hard-codes `useState("")` / `useState(true)` for meal context + off-list toggle, ignoring `session.mealContext` / `session.allowExtraIngredients` which are already on the wire.

### Key Discoveries

- The FSM is **re-entrant by design**, not monotonic — "moving back" is domain-equivalent to re-dispatching an earlier event; step-skips are the only illegal transitions, so the saved recipe is always consistent (`recipe-session-state-machine.ts:17-31`, proven by `recipe-session-state-machine.test.ts`). **Do not change the FSM.**
- The signed photo URLs are **already in the wizard's `photos` state** after recognition (`RecognitionResult.photos`, each a `PhotoView` with `photoUrl`) — so a `GET` endpoint is not needed for in-memory back-nav (reload survival is out of scope).
- `attachPhotos` already **full-replaces** photos via `removeExistingPhotos` (`RecipeSessionUC.ts:228-241`), then resets `state` to `photos_uploaded` — exactly the in-memory full-set re-edit semantics, reachable through the existing `POST /api/recipe-sessions/[id]/upload` route.
- The wizard re-mounts each step component when `step` changes (different component per `renderStep` branch), so a freshly-mounted `WizardReviewProducts` naturally re-seeds from its `session` prop. A `key` keyed to `session.updatedAt` makes this re-seed explicit and robust against future refactors.
- `RecipeSession.correctedItems`, `mealContext`, `allowExtraIngredients`, `recognizedItems` are all nullable on the wire and model (`model/recipe/index.ts:30-42`).

## Desired End State

A user creating a recipe sees a 3-step indicator (Zdjęcia · Produkty · Przepis) and can click any step they have already reached to jump back or forward. On the photos step they see their previously uploaded photos and can remove specific ones / add more without re-selecting everything. On the products step they see their last edited list (or the recognized list if unedited); on generation they see their previously entered meal context and off-list toggle. Re-uploading photos or re-generating re-runs the AI work and overwrites downstream data; merely navigating does not. When photos change and recognition re-runs, the previously generated recipe and prior item corrections are invalidated (client-side) so the user is never shown a recipe that doesn't match the current photos.

**Verification:** Generate a recipe, click "Zdjęcia" in the stepper, remove one photo + add another, re-recognize, confirm the products step shows the fresh list (not stale edits), regenerate, confirm a new recipe. At every point the stepper reflects which steps are reachable, and no second session is created in the DB.

## What We're NOT Doing

- **No FSM / transition-graph changes.** `saved` stays terminal; saved recipes cannot be re-edited via back.
- **No new server endpoints, no migration, no persistence-layer changes.** Specifically: no single-photo `DELETE`, no additive (non-wiping) upload path, no `GET /api/recipe-sessions/[id]`, no relaxing the null-dropping `update` filter, no `RecipeRepository.delete`.
- **No eager DB cleanup.** Stale downstream columns on an unsaved draft are left as-is (lazy) — they are never user-visible (client invalidation hides them) and never savable (the FSM forces re-execution before `saved`); a cancelled draft is cascade-deleted.
- **No reload survival.** All wizard state stays in memory; a page refresh starts fresh (no `GET` readback).
- **No meal-context / off-list-toggle invalidation.** These are photo-independent preferences and deliberately persist across re-recognition.
- **No persistence of uncommitted in-progress edits.** Product-list edits (`useEditableItems`) and the meal-context textarea live in local form state until the user clicks "Generuj przepis". Navigating to another step unmounts the form and discards those edits; on return the form re-seeds from the last server-persisted session. This is **by design** — consistent with "re-run only on explicit re-submit"; only committed (generated) state survives navigation. Note for the implementer: this is the one case where navigation is _not_ non-destructive — accepted, not warned.

## Implementation Approach

Build bottom-up in three independently verifiable phases:

1. **Pre-population** — make the two child forms read their initial values from the live session. Independent, lowest-risk, no behavior change to the forward flow.
2. **Photo state lifting + session reuse** — move the selected-File set from `PhotoUploader` up to `RecipeWizard` so it survives step changes, and make the upload hook reuse the existing session instead of minting a new one. This is the foundation that lets back-to-photos retain photos.
3. **Navigation + stepper + staleness invalidation** — add the clickable stepper with a reachability gate, allow `setStep` to any reached step, and invalidate stale recipe + corrected items client-side on recognition.

## Critical Implementation Details

- **The new-session coupling is the sharpest risk.** `usePhotoUpload.submit` (`:84-110`) unconditionally creates a session. Re-upload from a back-navigation must target the _existing_ session id, or it orphans the first session's storage + rows. This is the load-bearing change in Phase 2.
- **`useObjectUrls` revokes object URLs on unmount** (`useObjectUrls.ts:22-29`). When the hook is lifted to `RecipeWizard`, the revoke lifetime correctly becomes the whole wizard session — but `PhotoUploader` must then **not** also own a `useObjectUrls`, or previews will be revoked on each step change. Exactly one owner.
- **Lazy DB + client-side invalidation.** Because the staleness decision is lazy, `handleRecognitionComplete` must do the invalidation in memory: set the in-memory `session.correctedItems` to `null` and `recipe` to `null` so the products step re-seeds from the fresh `recognizedItems` and the recipe step becomes unreachable until regeneration. **Do not** invalidate `mealContext` / `allowExtraIngredients` — they survive intentionally.
- **Re-seed timing relies on remount.** Step components remount on navigation, which re-runs `useEditableItems`' `useState` initializer. Add `key={session.updatedAt}` on the review step so a server write (which bumps `updatedAt`) forces a re-seed even if a future refactor keeps the component mounted. Local edits don't change `updatedAt`, so the editor is never remounted mid-edit.

---

## Phase 1: Form Pre-Population From the Live Session

### Overview

Make `useEditableItems` seed from the user's prior edits when present, and make the generation panel reflect the session's stored meal context + off-list toggle. No change to the forward flow's behavior (on a fresh recognition `correctedItems` is `null`, so the seed falls back to `recognizedItems` exactly as today).

### Changes Required

#### 1. Generation panel reads its initial values from the session

**File**: `src/components/recipes/recipe/RecipeGenerationPanel.tsx`

**Intent**: Replace the hard-coded `useState("")` / `useState(true)` initializers with values seeded from the session, so returning to this step shows what the user last entered.

**Contract**: Add `initialMealContext: string | null` and `initialAllowExtraIngredients: boolean | null` to `RecipeGenerationPanelProps`. Initialize `useState(initialMealContext ?? "")` and `useState(initialAllowExtraIngredients ?? true)`. No other behavior changes.

#### 2. Review step passes session data as seeds

**File**: `src/components/recipes/wizard/WizardReviewProducts.tsx`

**Intent**: Feed the editable list from prior corrections when they exist, and pass the generation panel its session-backed initial values.

**Contract**: Seed `useEditableItems(session.correctedItems ?? session.recognizedItems)`. Pass `initialMealContext={session.mealContext}` and `initialAllowExtraIngredients={session.allowExtraIngredients}` to `<RecipeGenerationPanel />`.

### Success Criteria

#### Automated Verification

- Unit tests pass: `pnpm test`
- `RecipeGenerationPanel.test.tsx` updated to assert the textarea/switch render from the new initial-value props (non-empty context, `false` toggle)
- New `useEditableItems` test asserts `correctedItems` takes precedence over `recognizedItems` when both are present, and falls back to `recognizedItems` when `correctedItems` is `null`
- Lint passes: `pnpm lint`
- Build passes: `pnpm build`

#### Manual Verification

- Forward flow unchanged: a fresh recognition still shows the recognized list and an empty meal context with the toggle ON (no regression)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Lift Photo File-Set to the Wizard + Reuse the Existing Session on Re-Upload

### Overview

Move ownership of the selected-photo File set from `PhotoUploader` up to `RecipeWizard` so it survives step changes, and make `usePhotoUpload.submit` operate on the existing session when one exists. After this phase, re-uploading does not create a second session, and (once navigation lands in Phase 3) returning to the upload step will show the retained photos.

### Changes Required

#### 1. Wizard owns the selected-photo set

**File**: `src/components/recipes/wizard/RecipeWizard.tsx`

**Intent**: Hold the `useObjectUrls()` state at the wizard level so previews persist across step navigation, and pass it down to a now-controlled `PhotoUploader`.

**Contract**: Call `useObjectUrls()` in `RecipeWizard`; thread `photos`, `append`, `removeAt` to `<PhotoUploader />`. The wizard becomes the single owner of the File set (and thus the single site of URL revocation on wizard unmount). Because the wizard now owns `photos`, derive the leave-guard `dirty` in the wizard from `photos.length > 0 || session != null` (replacing today's photo-selection-only signal) and **remove** the `onDirtyChange` prop from `PhotoUploader` — the callback is redundant once the state lives here.

#### 2. PhotoUploader becomes controlled

**File**: `src/components/recipes/photo/PhotoUploader.tsx`

**Intent**: Remove the internal `useObjectUrls()` and accept the selected-photo state + mutators from props, keeping only its local validation/error state and the upload trigger.

**Contract**: Extend `PhotoUploaderProps` with the lifted photo state (`photos: SelectedPhoto[]`) and handlers (`append`, `removeAt`); **drop** the internal `useObjectUrls()` call and the `onDirtyChange` prop (the wizard now derives `dirty` itself — see Change 1). `handleSelect` / `handleRemove` / `handleSubmit` operate on the passed-in state. The `existing`-dedup and `validateFiles` logic are unchanged.

#### 3. Upload hook reuses the existing session

**File**: `src/components/recipes/photo/usePhotoUpload.ts`

**Intent**: Stop minting a new session on every submit; reuse the wizard's session when present so re-upload targets the same session id.

**Contract**: `usePhotoUpload` accepts an `existingSession: RecipeSession | null`. In `submit`, branch: when `existingSession` is non-null, skip the `POST /api/recipe-sessions` create and upload straight to `existingSession.id`; otherwise create as today. The upload + recognition routes (`POST /[id]/upload`, `POST /[id]/recognition`) already operate on an existing session and full-replace photos — no route change. `PhotoUploader` passes `existingSession` through from the wizard's `session`.

### Success Criteria

#### Automated Verification

- Unit tests pass: `pnpm test`
- New/updated test for `usePhotoUpload` asserts that with a non-null `existingSession`, `submit` does **not** call `POST /api/recipe-sessions` and uploads to the existing id; with a null session it still creates one
- Lint passes: `pnpm lint`
- Build passes: `pnpm build`

#### Manual Verification

- First-ever upload still creates a session and recognizes normally (no regression)
- Re-running "Rozpoznaj produkty" on an existing session does not create a second session row in the DB (verify via Supabase studio / a single `recipe_sessions` row for the flow)
- Previews and the leave-guard still behave correctly (no revoked/blank thumbnails)

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Bidirectional Navigation + Stepper + Client-Side Staleness Invalidation

### Overview

Add the clickable 3-step indicator with a reachability gate, allow the wizard to navigate to any reached step, and invalidate stale downstream data client-side when recognition re-runs. This is the user-visible payoff that ties Phases 1–2 together.

### Changes Required

#### 1. Stepper component

**File**: `src/components/recipes/wizard/WizardStepper.tsx` (new)

**Intent**: Render the three steps as a horizontal indicator; reached steps are clickable to navigate, the current step is highlighted, and not-yet-reached steps are disabled. Hand-rolled from buttons + Tailwind/shadcn tokens (shadcn has no stepper primitive).

**Contract**: Props `{ current: Step; canNavigate: (step: Step) => boolean; onNavigate: (step: Step) => void; disabled?: boolean }`. Renders labels Zdjęcia / Produkty / Przepis. A step button is disabled when `!canNavigate(step)` or `disabled` (busy). Uses `lucide-react` icons sized with Tailwind utilities and palette tokens per `src/components/CLAUDE.md`.

#### 2. Wizard navigation + reachability + staleness invalidation

**File**: `src/components/recipes/wizard/RecipeWizard.tsx`

**Intent**: Compute which steps are reachable from the current session/recipe, render the stepper, allow backward and forward `setStep` to reachable steps, and invalidate stale recipe + corrected items in memory when recognition completes.

**Contract**:

- A `canNavigate(step)` predicate built with ts-pattern `match(step).with(...).exhaustive()` (per `generic.md`): `upload` → always; `review` → `session != null && session.recognizedItems != null`; `recipe` → `recipe != null`.
- The wizard holds a `busy` state lifted from the child operations: add an `onBusyChange(busy: boolean)` callback prop to `PhotoUploader` (reflecting `usePhotoUpload.isBusy`) and `RecipeGenerationPanel` (reflecting `useRecipeGeneration.isBusy`), each firing it from a `useEffect` on its `isBusy`. The wizard stores the latest value.
- Render `<WizardStepper current={step} canNavigate={canNavigate} onNavigate={setStep} disabled={busy} />` above the step body. Gating on `busy` blocks navigation during an in-flight upload/recognition/generation — preventing the auto-jump on completion (`handleRecognitionComplete` → `setStep`) and setState-on-unmounted warnings from the fire-and-forget `void Effect.runPromise`. `renderStep` continues to render the body for the selected `step` (keep the existing `|| session === null` upload guard).
- `handleRecognitionComplete` invalidates stale downstream state client-side:

```tsx
const handleRecognitionComplete = (result: RecognitionResult) => {
  // Lazy DB decision: the server keeps stale correctedItems / recipe row; we hide them
  // in memory so the user never sees a list/recipe that doesn't match the new photos.
  // mealContext + allowExtraIngredients are photo-independent and deliberately preserved.
  setSession({ ...result.session, correctedItems: null });
  setPhotos(result.photos);
  setRecipe(null);
  setStep("review");
};
```

- Add `key={session.updatedAt}` to the review step element so a server write forces `useEditableItems` to re-seed.
- Leave-guard: `dirty` is derived in the wizard (`photos.length > 0 || session != null`, established in Phase 2) so it stays armed while navigating between steps with an unsaved session; `WizardActions` save/cancel disarm it as today.

### Success Criteria

#### Automated Verification

- Unit tests pass: `pnpm test`
- New `WizardStepper.test.tsx` asserts: reachable steps are clickable and call `onNavigate`; unreached steps are disabled; the current step is marked current
- Lint passes: `pnpm lint`
- Build passes: `pnpm build`

#### Manual Verification

- From the recipe step, clicking "Produkty" returns to the editable list showing the last edits; clicking "Przepis" returns to the generated recipe without re-running generation
- From the recipe step, clicking "Zdjęcia" shows the previously uploaded photos; removing one + adding one + "Rozpoznaj produkty" produces a fresh list and makes the recipe step unreachable until regeneration
- After such a re-recognition, the products step shows the fresh recognized list (not the stale prior edits); meal context + off-list toggle are still populated from before
- Re-generating overwrites the recipe; the stepper reflects reachable steps at every point; only one session exists in the DB throughout
- The browser leave-prompt still fires when navigating away with unsaved work
- The stepper is disabled (not clickable) while an upload/recognition/generation is in flight

**Implementation Note**: Pause for final manual confirmation.

---

## Testing Strategy

### Unit Tests

- `useEditableItems`: `correctedItems` precedence over `recognizedItems`; fallback when `correctedItems` is null.
- `RecipeGenerationPanel`: renders from `initialMealContext` / `initialAllowExtraIngredients`.
- `usePhotoUpload`: reuses an existing session (no create POST) vs. creates one when none exists.
- `WizardStepper`: reachability gating, current-step marking, navigation callbacks.

### Integration / Component Tests

- Optional `RecipeWizard` test driving recognition-complete and asserting `recipe` + `correctedItems` are invalidated and the recipe step becomes unreachable.

### Manual Testing Steps

1. Full forward flow (no regression): upload → recognize → edit → generate → save.
2. Back to review from recipe; forward again without re-running.
3. Back to photos from recipe; remove + add a photo; re-recognize; confirm fresh list, preserved meal context, recipe step gated until regenerate.
4. Confirm a single `recipe_sessions` row exists throughout (no orphans).
5. Leave-guard still warns on unsaved navigation away.

## Performance Considerations

Backward navigation itself is free (it only changes the viewed step). Re-running recognition (N+1 AI calls) or generation (1 AI call) happens only on explicit re-submit and is covered by the existing loader overlays (`PhotoUploadProgressOverlay`, `RecipeOverlay`, "to może potrwać do 30 s"). Re-uploading re-sends the full photo set's bytes — acceptable under the same-session/in-memory constraint and invisible to the user.

## Migration Notes

None — no schema or server changes.

## References

- Frame brief: `context/changes/wizard-moving-back-forward/frame.md`
- Research: `context/changes/wizard-moving-back-forward/research.md`
- Prior decision (backward edges legal by design; `saved` terminal): `context/changes/recepie-session-state-machine/`
- Key source: `RecipeWizard.tsx:10,20,50-76`; `usePhotoUpload.ts:84-110`; `useObjectUrls.ts:22-29`; `useEditableItems.ts:48-55`; `RecipeGenerationPanel.tsx:24-26`; `WizardReviewProducts.tsx:20-21`; `recipe-session-state-machine.ts:17-31`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Form Pre-Population From the Live Session

#### Automated

- [x] 1.1 Unit tests pass: `pnpm test` — 5bc0503f0
- [x] 1.2 `RecipeGenerationPanel.test.tsx` asserts render from new initial-value props — 5bc0503f0
- [x] 1.3 New `useEditableItems` test asserts `correctedItems` precedence + null fallback — 5bc0503f0
- [x] 1.4 Lint passes: `pnpm lint` — 5bc0503f0
- [x] 1.5 Build passes: `pnpm build` — 5bc0503f0

#### Manual

- [ ] 1.6 Forward flow unchanged (fresh recognition shows recognized list, empty context, toggle ON)

### Phase 2: Lift Photo File-Set to the Wizard + Reuse the Existing Session on Re-Upload

#### Automated

- [x] 2.1 Unit tests pass: `pnpm test`
- [x] 2.2 `usePhotoUpload` test: existing session skips create POST; null session still creates
- [x] 2.3 Lint passes: `pnpm lint`
- [x] 2.4 Build passes: `pnpm build`

#### Manual

- [ ] 2.5 First-ever upload still creates a session and recognizes (no regression)
- [ ] 2.6 Re-recognition on an existing session creates no second session row
- [ ] 2.7 Previews and leave-guard behave correctly (no blank/revoked thumbnails)

### Phase 3: Bidirectional Navigation + Stepper + Client-Side Staleness Invalidation

#### Automated

- [ ] 3.1 Unit tests pass: `pnpm test`
- [ ] 3.2 New `WizardStepper.test.tsx`: reachability gating, current marking, navigation callbacks
- [ ] 3.3 Lint passes: `pnpm lint`
- [ ] 3.4 Build passes: `pnpm build`

#### Manual

- [ ] 3.5 Recipe → Produkty shows last edits; Recipe → Przepis returns without re-generating
- [ ] 3.6 Recipe → Zdjęcia shows prior photos; remove+add+re-recognize yields fresh list, recipe step gated
- [ ] 3.7 After re-recognition: products show fresh list (not stale edits); meal context + toggle preserved
- [ ] 3.8 Re-generating overwrites the recipe; stepper reflects reachable steps; single DB session throughout
- [ ] 3.9 Leave-prompt still fires on unsaved navigation away
- [ ] 3.10 Stepper is disabled while an upload/recognition/generation is in flight
