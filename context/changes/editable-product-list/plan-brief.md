# Editable Product List — Plan Brief

> Full plan: `context/changes/editable-product-list/plan.md`

## What & Why

The recipe wizard shows the consolidated recognized items as a single editable textarea, but the server already stores them as a structured `RecognizedItem[]`. This refactors the consolidated list into a structured, per-item editable UI — separate **name** and **quantity** inputs per row, **context** as informative text, and **add/delete** rows — with client state shaped for a future server upload.

## Starting Point

`ReviewStep.tsx` renders a `<Textarea>` seeded once from `itemsToText(session.recognizedItems)`; edits stay client-side and lossy. The model already has `RecognizedItem { name, quantity, context }` and an unused `RecipeSession.correctedItems`. The repo's Vitest is node-only (no RTL/jsdom). Per-photo lists (`PhotoReviewCard`) are a separate read-only section.

## Desired End State

The "Lista zbiorcza" is a list of rows, each with editable name + quantity inputs and the item's context as smaller muted text (right on desktop, below on mobile). Users add a blank row (appended + autofocused) and delete rows; an empty list shows a hint + add button. A pure projection yields a clean `RecognizedItem[]` (the `correctedItems` shape) ready for a later upload. RTL + jsdom component tests cover the behaviors and run alongside the existing node tests.

## Key Decisions Made

| Decision                  | Choice                                                          | Why (1 sentence)                                                     | Source |
| ------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- | ------ |
| "Context" meaning/display | Per-item `context`, read-only, smaller text (right/below)       | Matches the item-centric task wording; gives devs the AI's reasoning | Plan   |
| Validation                | Hold strings, inline hints, validate at projection boundary     | Fluid editing while staying server-ready against the model's bounds  | Plan   |
| Data shape                | Edited list = future `correctedItems`, seeded from recognized   | Aligns with the existing model field + future upload; keeps original | Plan   |
| Add/empty-state UX        | Append at bottom + autofocus; empty = button + hint             | Conventional, predictable list-editor behavior                       | Plan   |
| Testing                   | Add RTL + jsdom, test the component                             | Real regression guard for the editing UX (user's choice)             | Plan   |
| Scope                     | Consolidated list only; per-photo read-only; drop `itemsToText` | Tightest scope matching the task                                     | Plan   |

## Scope

**In scope:**

- React component test infra (RTL + jest-dom + jsdom) configured to coexist with the node suite.
- `useEditableItems` hook + `ProductRow` + `ProductListEditor`; rewire `ReviewStep`; delete `item-format.ts`.
- Component tests for seed/edit/add/delete/empty/validation.

**Out of scope:**

- Server/API/use-case/DB/migration changes; uploading or persisting `correctedItems`.
- `mealContext` UI; editing per-item context; changes to per-photo cards.

## Architecture / Approach

A self-contained feature under `src/components/recipes/wizard/`: `useEditableItems` owns list state (rows keyed by an ephemeral client id, stripped in the projection), add/delete/update, and a pure `toCorrectedItems()` projection + validity hints; `ProductRow` is presentational (name/quantity `Input`s, context text, delete `Button`); `ProductListEditor` composes rows + add button + empty state and wires autofocus-on-add. `ReviewStep` swaps its textarea for `<ProductListEditor>`. Vitest keeps `node` as default; component tests opt into jsdom per-file.

## Phases at a Glance

| Phase                                    | What it delivers                                           | Key risk                                                 |
| ---------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| 1. React component test infrastructure   | RTL + jsdom wired into Vitest, proven by a smoke test      | Vitest 4 env config (deprecated `environmentMatchGlobs`) |
| 2. Editable consolidated list (UI+state) | Editable rows, add/delete, projection; `ReviewStep` rewire | Row-identity/key bugs on delete; autofocus timing        |
| 3. Component tests                       | RTL coverage of the editing behaviors                      | Locating elements without stable accessible labels       |

**Prerequisites:** None — local dev only.
**Estimated effort:** ~1–2 sessions across 3 phases.

## Open Risks & Assumptions

- "Context" is the per-item `RecognizedItem.context` (not session `mealContext`) — confirmed during questioning.
- A clean `correctedItems` projection exists this change, but nothing sends it yet (upload is a separate future change).
- New rows have empty `context` (`RecognizedItem.context` allows `""`), so they remain valid items.

## Success Criteria (Summary)

- The consolidated list is per-item editable (name + quantity inputs, context as text), with working add/delete and a sensible empty state.
- Editing produces a clean, server-ready `RecognizedItem[]`; the original recognized list is untouched.
- `pnpm test` runs the new jsdom component tests and the existing node tests green; `tsc`/`lint`/`build` pass.
