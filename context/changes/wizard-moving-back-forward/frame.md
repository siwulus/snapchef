# Frame Brief: Move back and forward through the new-recipe wizard

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed.

## Reported Observation

The new-recipe wizard moves only _forward_ (first → last step). We want users to move **back and forward** within a recipe-creation session — to correct a prior decision, change the recipe description, modify recognized items, and delete/update photos. When prior data exists, the form should pre-populate so the user can reuse it as-is or modify and resend.

## Initial Framing (preserved)

- **User's stated cause or approach**: Moving back "from a business point of view means moving to the previous state and re-execution of the steps which are next." The existing recipe-session state machine (with its "valid session" guard) is framed as the relevant machinery.
- **User's proposed direction**: Add back/forward navigation; on a backward move, re-run the consequent steps; pre-populate forms from prior iterations (reuse-or-modify-and-resend).
- **Pre-dispatch narrowing** (Step 1.5 answers): (a) **Same session only** — must work within one in-memory browser session; no page-reload survival needed. (b) **Draft only** — applies to in-progress drafts, never to an already-saved recipe. (c) **Manage photos individually** — on the photos step, delete specific uploaded photos / add more / keep the rest (not just re-select the whole set).

## Dimension Map

The gap between "forward-only today" and "back/forward desired" could originate at any of these:

1. **Server state machine / transitions** — _would_ be the locus if the FSM were monotonic and rejected backward moves. ← **initial framing lands here**
2. **UI navigation layer** — `RecipeWizard`'s local `Step` union + forward-only `setStep`, decoupled from `session.state`.
3. **Form pre-population** — earlier-step forms re-initializing from prior session data.
4. **Downstream data hygiene** — what happens to now-stale recognized/corrected items + the generated recipe row on a backward jump.
5. **Photo re-edit model** — individual photo management vs. whole-set replace.
6. **Reload readback** — a `GET` session endpoint to rehydrate after refresh. _(Resolved OUT by "same session only".)_

## Hypothesis Investigation

Evidence from `/10x-research` (4 agents) plus an independent pressure-test agent run _blind to the hypothesis_, which independently concluded the constraint is in the React layer.

| Hypothesis                                                   | Evidence                                                                                                                                                                                                                                                                                                                                                                        | Verdict                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **1. State machine blocks backward moves** (initial framing) | `recipe-session-state-machine.ts:17-31` — `upload_photos` is legal from _every_ non-`saved` state, `recognize_products`/`generate_recipe` legal from later states; re-firing is idempotent. `saved` is terminal, which _matches_ the "draft only" constraint. UC methods documented re-runnable (`RecipeSessionUC.ts:46,58`). Backward re-edit was a deliberate prior decision. | **NONE** — the framing's premise (state-machine work) does not hold |
| **2. UI navigation is forward-only**                         | `RecipeWizard.tsx:10,20` (local `Step` union, not driven by `session.state`); `setStep` called only forward at `:53,:59`; no back affordance (exit/cancel only)                                                                                                                                                                                                                 | **STRONG** — this is where forward-only actually lives              |
| **3. Forms don't re-populate from prior data**               | `RecipeGenerationPanel.tsx:25-26` hard-codes `mealContext=""`, `allowExtraIngredients=true`; `useEditableItems.ts:55` seeds once from `recognizedItems`, never re-seeds, ignores `correctedItems`                                                                                                                                                                               | **STRONG**                                                          |
| **4. Stale downstream data can't be cleared**                | `RecipeSessionRepository.ts:40-50` `update` filters out null values (cannot reset a column); `RecipeRepository` has no `delete` (recipe row removable only via whole-session cascade). Lazy overwrite on re-run works, but "re-recognize then abandon" leaves stale `correctedItems` + recipe row                                                                               | **STRONG** (real constraint)                                        |
| **5. Per-photo management missing**                          | `attachPhotos` full-replaces via `removeExistingPhotos` (`RecipeSessionUC.ts:228-241`); no single-photo DELETE route/repo method; no GET to rehydrate photos; `PhotoUploader` is local-`File`-only (`useObjectUrls`)                                                                                                                                                            | **STRONG** (genuinely new server + UI work)                         |
| **6. Reload readback (`GET` endpoint)**                      | No GET route under `recipe-sessions/**`                                                                                                                                                                                                                                                                                                                                         | **RESOLVED OUT** by "same session only"                             |

**Sharp coupling risk (beyond the dimension map):** `usePhotoUpload.submit()` _always_ `POST /api/recipe-sessions` to mint a **new** session (`usePhotoUpload.ts:90`). Naive backward nav to the upload step + resubmit would create a second session and orphan the first's storage + rows. Any back-to-photos design must make the uploader operate on the _existing_ session.

## Narrowing Signals

- **"Same session only"** → dimension 6 (GET/readback, reload persistence) is out of scope.
- **"Draft only"** → `saved` stays terminal; no new FSM edges (dimension 1 stays unchanged, confirming it's not the locus).
- **"Manage photos individually"** → dimension 5 is firmly in and is the largest _new server_ surface (single-photo delete + additive upload + photo rehydrate).
- **Independent (blind) agent** reached the same verdict — "forward-only lives in the React navigation layer; no state-machine change needed" — raising confidence the reframe isn't an artifact of how the first investigation was prompted.

## Cross-System Convention

The `recepie-session-state-machine` change (`context/changes/recepie-session-state-machine/`) _deliberately_ made backward re-edit edges legal ("re-edit freely until `saved`; `saved` is terminal") and tightened `saveSession`. The backend was designed to tolerate exactly this feature's re-edits; the UI simply never exposed them. The leading hypothesis matches the established, intentional convention.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: the wizard's forward-only React navigation layer — there is no backward `setStep`, child forms are seeded once and ignore live session data, and the upload hook mints a new session on every submit — plus three missing server seams for _individual_ photo management and stale-downstream cleanup. It is **not** a state-machine problem.

The user's _business model_ ("move to the previous state and re-execute downstream steps") is **correct and already enforced** by the FSM: because step-skips are illegal, you cannot reach `saved` again without re-running recognition + generation. What needs correcting is the framing's _implication_ that this is state-machine work. Addressing the real locus — bidirectional UI navigation, re-seeding forms from the persisted session, and the photo/cleanup server seams — delivers the feature without touching the transition graph.

## Confidence

**HIGH** — strong, file-referenced evidence across two independent investigations; matches the deliberate prior design decision; the user's three scope answers decisively bound the problem (reload + saved-editing out, per-photo management in). No reproduction step needed before planning.

## What Changes for /10x-plan

Plan **bidirectional wizard navigation + supporting seams**, not state-machine changes:

1. **React navigation** — backward step affordances; re-seed `WizardReviewProducts`/`useEditableItems` and `RecipeGenerationPanel` from the live `session` (e.g. a `key` or sync effect; read `session.correctedItems ?? recognizedItems`, `session.mealContext`, `session.allowExtraIngredients`); and make `usePhotoUpload` edit the **existing** session instead of creating a new one.
2. **Per-photo server seams** — a single-photo `DELETE` endpoint + `PhotoRepository.delete`, an additive (non-wiping) upload path, and a `GET` to rehydrate already-uploaded photos into the uploader UI (which today is local-`File`-only).
3. **Downstream-staleness decision** — the one genuine technical fork: keep _lazy_ overwrite (cheap; safe for the happy path, but a "re-recognize then abandon" leaves a stale recipe row that today cannot be cleared) **or** add _eager_ cleanup (nullable-aware `update` and/or `RecipeRepository.deleteBySession`). The plan must pick one and justify it.
4. Leave the FSM and `saved`-terminal rule **as-is**.

## References

- Source: `src/components/recipes/wizard/RecipeWizard.tsx:10,20,50-76`; `src/components/recipes/recipe/RecipeGenerationPanel.tsx:25-26`; `src/components/recipes/ingridients/useEditableItems.ts:55`; `src/components/recipes/photo/usePhotoUpload.ts:30,90`; `src/components/recipes/photo/PhotoUploader.tsx:23`; `src/lib/core/model/recipe/recipe-session-state-machine.ts:17-31`; `src/lib/core/uc/recipe/RecipeSessionUC.ts:43-150,228-262`; `src/lib/infrastructure/db/RecipeSessionRepository.ts:40-50`; `src/lib/infrastructure/db/RecipeRepository.ts:15-33`; `src/pages/api/recipe-sessions/**`.
- Related research: `context/changes/wizard-moving-back-forward/research.md`
- Prior decision: `context/changes/recepie-session-state-machine/` (backward edges legal by design; `saved` terminal)
- Investigation: 4 `/10x-research` sub-agents + 1 independent blind pressure-test agent (this skill).
