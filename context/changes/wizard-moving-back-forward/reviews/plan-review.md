<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Move Back and Forward Through the New-Recipe Wizard

- **Plan**: `context/changes/wizard-moving-back-forward/plan.md`
- **Mode**: Deep
- **Date**: 2026-06-29
- **Verdict**: REVISE → SOUND (after triage; all findings fixed)
- **Findings**: 1 critical, 3 warnings, 1 observation

## Verdicts

| Dimension             | Verdict (pre-triage) | After fixes |
| --------------------- | -------------------- | ----------- |
| End-State Alignment   | PASS                 | PASS        |
| Lean Execution        | PASS (1 obs)         | PASS        |
| Architectural Fitness | PASS                 | PASS        |
| Blind Spots           | WARNING              | PASS        |
| Plan Completeness     | FAIL                 | PASS        |

## Grounding

7/7 paths ✓ (WizardStepper correctly absent — new file), signature blast radius contained ✓ (PhotoUploader/usePhotoUpload/RecipeGenerationPanel/useEditableItems/useObjectUrls imported only by named files), no existing stepper/breadcrumb component ✓ (hand-rolled WizardStepper justified), brief↔plan ✓. No `contract-surfaces.md` / `lessons.md` present (skipped).

## Findings

### F1 — Phase Success-Criteria blocks use `- [ ]` checkboxes

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1/2/3 Success Criteria
- **Detail**: Phase-body Success Criteria used `- [ ]`, violating the Progress-format contract (phase blocks carry plain `- ` bullets; only `## Progress` holds `[ ]`/`[x]`). The parsing contract ("first `- [ ]` in document order"; "count([x])/count([ ]+[x])") would match the phase-body copies first, breaking next-step detection and doubling the completion denominator for `/10x-implement` and `/10x-status`.
- **Fix**: Converted every phase-body Success Criteria `- [ ]` to plain `- ` across all three phases; left `## Progress` untouched.
- **Decision**: FIXED (Fix in plan)

### F2 — Navigating away silently discards unsaved in-progress edits

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 — free navigation
- **Detail**: Product-list edits (`useEditableItems`) and the meal-context textarea live in local component state until "Generuj przepis"; navigating to another stepper step unmounts the form and discards them, contradicting the "free nav destroys nothing" rationale for uncommitted edits.
- **Fix**: Added a "What We're NOT Doing" bullet documenting that uncommitted in-progress edits are ephemeral and lost on navigation by design (accepted, not warned).
- **Decision**: FIXED (Fix A — accept + document)

### F3 — Stepper `disabled={/* busy */}` has no busy signal at the wizard

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — Wizard navigation
- **Detail**: `disabled={/* busy */}` was an unfilled placeholder; busy state lives in child hooks (`usePhotoUpload.isBusy`, `useRecipeGeneration.isBusy`) not lifted to the wizard, so the stepper was clickable mid-operation → auto-jump on completion + setState-on-unmounted warnings.
- **Fix**: Specified lifting busy via an `onBusyChange` callback from `PhotoUploader` and `RecipeGenerationPanel`; stepper `disabled={busy}`. Added verification 3.10 + Progress entry.
- **Decision**: FIXED (Fix in plan)

### F4 — Leave-guard `dirty` rewiring under-specified across Phase 2→3

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 (lift photos) + Phase 3
- **Detail**: `dirty` was driven solely by PhotoUploader's `onDirtyChange`; once the File set moves up the callback is redundant, but the rewiring wasn't called out.
- **Fix**: Specified the wizard derives `dirty` from `photos.length > 0 || session != null` and removes the `onDirtyChange` prop from `PhotoUploader` (Phase 2 Changes 1 & 2; Phase 3 leave-guard line references it).
- **Decision**: FIXED (Fix in plan)

### F5 — Dead threading of `replace`/`clear` to PhotoUploader

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 2 — Change 1
- **Detail**: Phase 2 threaded `photos, append, removeAt, replace, clear` to PhotoUploader, but it only uses `append` + `removeAt`.
- **Fix**: The F4 edit rewrote the line to thread only `photos, append, removeAt`.
- **Decision**: FIXED (resolved via F4)
