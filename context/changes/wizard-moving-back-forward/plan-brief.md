# Move Back and Forward Through the New-Recipe Wizard — Plan Brief

> Full plan: `context/changes/wizard-moving-back-forward/plan.md`
> Frame brief: `context/changes/wizard-moving-back-forward/frame.md`
> Research: `context/changes/wizard-moving-back-forward/research.md`

## What & Why

Let users move **back and forward** within a recipe-creation session — to correct a prior decision, change the recipe description, modify recognized items, and delete/update photos — with forms that pre-populate from prior data so the user can reuse it as-is or modify and resend. The wizard only moves forward today; the backend already supports backward re-edits, the UI simply never exposed them.

## Starting Point

The new-recipe wizard is a forward-only, in-memory React stepper. `RecipeWizard.tsx` holds a local `Step` union decoupled from `session.state`, `setStep` is only ever called forward, and there's no back affordance. The upload hook mints a **new** session on every submit, child forms ignore the session data already on the wire, and the photo File set lives inside `PhotoUploader` (lost when the step changes).

## Desired End State

A clickable 3-step indicator (Zdjęcia · Produkty · Przepis) lets the user jump to any reached step. Returning to photos shows the previously uploaded photos (remove/add specific ones, no whole-set re-select); returning to products shows the last edited list; the generation form shows the last meal context + toggle. Re-running an earlier step re-runs the AI work and invalidates stale downstream data; merely navigating does not — and the user is never shown a recipe that doesn't match the current photos.

## Key Decisions Made

| Decision                                | Choice                                      | Why (1 sentence)                                                                                                                                | Source |
| --------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Locus of the change                     | React navigation layer, not the FSM         | Two independent investigations confirmed the FSM already permits backward re-edits; forward-only lives only in the UI                           | Frame  |
| Downstream staleness on a backward jump | Lazy overwrite (+ client-side invalidation) | No new persistence code; the FSM guarantees a consistent saved recipe, and client-side nulling hides stale data the user would otherwise see    | Plan   |
| Wizard step model                       | Local step + reachability gate              | Viewing-position ≠ furthest-progress, so a pure derivation from `session.state` can't express "at recipe_generated but viewing review"          | Plan   |
| Photo re-edit model                     | In-memory full-set re-edit                  | Satisfies "keep the rest, don't re-select" client-side; per-photo server seams save nothing because re-recognition runs on the whole set anyway | Plan   |
| Re-execution UX                         | Free nav; re-run only on explicit re-submit | Cheapest and least surprising; existing loader overlays already cover the AI latency                                                            | Plan   |
| Back/forward affordance                 | Clickable step indicator (stepper)          | Communicates the whole flow and supports back AND forward in one affordance, matching the feature's framing                                     | Plan   |

## Scope

**In scope:** clickable stepper with reachability gate; bidirectional `setStep`; pre-populate the products + generation forms from the live session; retain photos in memory across navigation; reuse the existing session on re-upload; client-side invalidation of stale recipe + corrected items on re-recognition.

**Out of scope:** FSM / transition-graph changes; editing `saved` recipes; new server endpoints, migration, or persistence changes (no single-photo DELETE, additive upload, GET readback, null-filter relaxation, or `Recipe.delete`); reload survival; invalidating meal context / off-list toggle (they persist intentionally).

## Architecture / Approach

100% front-end. `RecipeWizard` becomes the single owner of the selected-photo File set (lifted out of `PhotoUploader`) and of the step state, gated by a `canNavigate(step)` predicate derived from `session.state` + recipe presence. `usePhotoUpload` reuses the wizard's session instead of creating one. The two child forms read their seeds from the live `session`. On recognition-complete, the wizard nulls `correctedItems` and `recipe` in memory (lazy DB, tidy client) so the products step re-seeds fresh and the recipe step is gated until regeneration. No server, no DB.

## Phases at a Glance

| Phase                                  | What it delivers                                                         | Key risk                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| 1. Form pre-population                 | Products + generation forms seed from the live session                   | Low — fallback to recognized list means no forward-flow regression                                |
| 2. Photo lifting + session reuse       | Photos survive step changes; re-upload reuses the existing session       | Orphaning a session if the reuse branch is wrong; URL double-revoke if two `useObjectUrls` owners |
| 3. Navigation + stepper + invalidation | Clickable stepper, reachability gate, client-side staleness invalidation | Reachability/invalidation edge cases (showing a recipe that doesn't match current photos)         |

**Prerequisites:** none — no access, schema, or prior work needed; the backend already supports re-edits.
**Estimated effort:** ~1–2 sessions across 3 phases (front-end only).

## Open Risks & Assumptions

- Re-uploading re-sends the full photo set's bytes (invisible to the user) — accepted under the same-session/in-memory constraint.
- The re-seed relies on step components remounting on navigation; a `key={session.updatedAt}` on the review step is the defensive guard against future refactors that keep it mounted.
- Lazy leaves a stale recipe row on an abandoned draft — never user-visible (client invalidation) or savable (FSM), and cascade-deleted on cancel.

## Success Criteria (Summary)

- The user can jump to any reached step via the stepper and return without re-running AI work.
- Returning to a step shows the user's prior input (photos, edited list, meal context); changing photos + re-recognizing yields a fresh list and gates the recipe step until regeneration.
- Exactly one `recipe_sessions` row exists throughout the flow — no orphaned sessions.
