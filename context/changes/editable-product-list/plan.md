# Editable Product List Implementation Plan

## Overview

The recipe wizard's recognition-review screen currently shows the consolidated ("Lista zbiorcza") recognized items as a **single editable textarea** of markdown-ish bullet text. The server already keeps these items as a **structured `RecognizedItem[]`** (jsonb), so the textarea is a lossy, free-text mirror of structured data. This change refactors that section into a **structured, per-item editable list**: each row has a separate **product name** input and **quantity** input, the item's **context** rendered as small, read-only informative text, and controls to **delete a row** or **add a new one**. The editable list is held in client state shaped as the future `correctedItems` (seeded from `recognizedItems`, original kept intact) so a later change can send it to the server. It also introduces React component test infrastructure (RTL + jsdom) and covers the editing behaviors.

This is a **frontend-only** change — no server, API route, use-case, port/adapter, DB, or migration work. Uploading the corrected items is explicitly out of scope.

## Current State Analysis

- **`RecognizedItem`** (`src/lib/core/model/recipe/index.ts:17-28`): `{ name: string(1–120, trimmed), quantity: string(1–60), context: string(≤280) }`. Persisted as `jsonb` (`recipe_sessions.recognized_items`, `photos.recognized_items`); the old `_md` columns were dropped. No `id` field on the item.
- **`RecipeSession`** (`:30-41`) carries `recognizedItems: RecognizedItem[] | null`, **`correctedItems: RecognizedItem[] | null`** (already present, currently unused), and `mealContext: string | null` (not shown in review).
- **API response** `RecognitionResult = { session, photos[] }` (`src/lib/core/boundry/recipe/responses.ts:14-19`); the client receives the structured merged list directly as `session.recognizedItems`.
- **`ReviewStep.tsx`** (`src/components/recipes/wizard/ReviewStep.tsx`): renders per-photo read-only cards (`PhotoReviewCard`) **plus** the consolidated list as one `<Textarea>` (`:38-46`), seeded once via `itemsToText(...)` and edited client-only.
- **`item-format.ts`** → `itemsToText` is used **only** by `ReviewStep` (`grep` confirmed) → becomes dead after the refactor.
- **`PhotoReviewCard.tsx`** per-photo lists are a separate read-only section — out of scope per the task ("only the consolidated final list").
- **shadcn primitives available**: `input.tsx`, `button.tsx`, `card.tsx`, `label.tsx`, `textarea.tsx` (so name/quantity use `Input`, controls use `Button`; no new primitive needed).
- **Test infra**: `vitest.config.ts` runs `environment: "node"`, `include: ["src/**/*.test.ts"]`, with an `astro:env/server` alias stub (`src/test/astro-env-server.stub.ts`). Vitest `^4.1.8`, React `^19.2.6`. There is **no** `@testing-library/react` / `jsdom` yet — this change adds them.

## Desired End State

On the review screen, the "Lista zbiorcza" section is a structured editable list. Each recognized item is a row with an editable **name** field and an editable **quantity** field, with the item's **context** shown beside it (right on desktop, below on mobile) as smaller muted text. The user can **delete** any row and **add** a new blank row (appended at the bottom, with its name field focused). When nothing was recognized, the section shows a muted "nothing recognized" hint and an add button. Edits update a client-side list of items keyed by an ephemeral row id; a pure projection turns that list into a clean `RecognizedItem[]` (the `correctedItems` shape) ready for a future upload, with inline hints flagging empty/over-length fields. The per-photo read-only cards are unchanged. React component tests (RTL + jsdom) exercise seeding, editing, add, delete, empty state, and validation hints, and run in the same `pnpm test` invocation as the existing node tests.

Verify by: opening the wizard, recognizing photos, and editing/adding/deleting items in the consolidated list; and by `pnpm test` running both the existing node suite and the new jsdom component tests green.

### Key Discoveries:

- **Server data is already structured** — the refactor only changes the UI's representation; no markdown round-trip and no backend work.
- **`correctedItems` already exists** (`recipe/index.ts:33`) — the natural target shape for the edited list; the upload itself is a separate future change.
- **No `id` on `RecognizedItem`** — the editable list needs an **ephemeral client-side row id** for React keys (index and editable name are both unsafe); the id is stripped in the projection.
- **`itemsToText` is dead after the swap** — single call site is `ReviewStep`.
- **Vitest 4 deprecated `environmentMatchGlobs`** — component tests opt into jsdom via a per-file `// @vitest-environment jsdom` docblock (or `test.projects`), keeping `node` the default so the existing tests and the `astro:env/server` stub are untouched.

## What We're NOT Doing

- No server, API route, use-case, port/adapter, DB, or migration changes. The corrected list is **not** uploaded/persisted in this change.
- No changes to the per-photo `PhotoReviewCard` read-only lists (kept as-is).
- No `mealContext` UI — "context" here is the per-item `RecognizedItem.context`, shown read-only; `mealContext` stays out.
- The per-item `context` is **not** editable — name and quantity are the only editable fields.
- No new shadcn component library or hand-rolled interactive primitives — reuse existing `Input`/`Button`.

## Implementation Approach

Build a small, self-contained editable-list feature under `src/components/recipes/wizard/`: a `useEditableItems` hook owns the list state and the pure projection/validation, a `ProductRow` renders one editable row, and a `ProductListEditor` composes the rows + add button + empty state. `ReviewStep` swaps its consolidated textarea for `<ProductListEditor>` and the dead `itemsToText` is removed. Keep selection/edit logic in the hook (mirroring how `useRecipeUpload`/`useObjectUrls` localize state) so the component stays presentational. Add RTL + jsdom as a prerequisite phase so the editing behaviors can be tested in `pnpm test` without disturbing the node-only suite, then cover the behaviors with component tests.

## Critical Implementation Details

**Vitest 4 environment selection.** `environmentMatchGlobs` is deprecated in Vitest 4. Keep `environment: "node"` as the default and have each component test file declare `// @vitest-environment jsdom` at the top (or use `test.projects`). Add `src/**/*.test.tsx` to `include` and register a `setupFiles` entry for `@testing-library/jest-dom` matchers + RTL cleanup. The existing `@` and `astro:env/server` aliases must remain so node tests are unaffected.

**Row identity.** Each editable row carries an ephemeral client id (e.g. `crypto.randomUUID()`) used solely as the React key and for targeting updates/removes/autofocus; it is **not** part of `RecognizedItem` and is dropped by the projection. Do not key rows by array index (breaks on delete/reorder) or by name (mutable while typing).

**Autofocus on add.** Focus the newly-added row's name input **after** the append renders (an effect keyed on the last-added id), not synchronously in the click handler.

**Accessible labels.** Give the name/quantity inputs and the delete/add controls accessible names (Polish `aria-label`/`<Label>`), so the RTL tests (and any future E2E) locate them by role/label rather than by DOM structure — matching the repo's locator policy.

## Phase 1: React component test infrastructure

### Overview

Add and configure `@testing-library/react` + `@testing-library/jest-dom` + `jsdom` so React components can be rendered and asserted under Vitest, without affecting the existing node-only tests. Prove it with a minimal smoke test.

### Changes Required:

#### 1. Test dependencies

**File**: `package.json`

**Intent**: Add the libraries needed to render and assert React components under Vitest.

**Contract**: New `devDependencies` — `@testing-library/react` (v16+, React-19 compatible), `@testing-library/jest-dom` (v6+), `jsdom`, and `@testing-library/user-event` (for realistic interactions). Installed with `pnpm add -D`. No runtime deps change.

#### 2. Vitest configuration

**File**: `vitest.config.ts`

**Intent**: Run `*.test.tsx` under jsdom while existing `*.test.ts` stay on node, and load the test setup.

**Contract**: Extend `test.include` with `src/**/*.test.tsx`; keep `environment: "node"` as default; add `test.setupFiles: ["src/test/setup.ts"]`. Component test files select jsdom per-file (`// @vitest-environment jsdom`). The `@` and `astro:env/server` aliases are preserved. (See Critical Implementation Details — do not use the deprecated `environmentMatchGlobs`.)

#### 3. Test setup file

**File**: `src/test/setup.ts` (new)

**Intent**: Register jest-dom matchers and ensure RTL cleanup between tests.

**Contract**: Imports `@testing-library/jest-dom/vitest`; ensures RTL `cleanup()` runs after each test (via Vitest globals or an explicit `afterEach`). If globals aren't enabled in config, either enable `test.globals: true` or import the matchers/cleanup explicitly — pick one and keep it consistent.

#### 4. Smoke test (temporary)

**File**: `src/test/smoke.test.tsx` (new, removed in Phase 3)

**Intent**: Prove the jsdom + RTL + jest-dom pipeline works end-to-end.

**Contract**: A `// @vitest-environment jsdom` file that renders a trivial element with RTL and asserts `toBeInTheDocument()`. Exists only to validate the environment; Phase 3 removes it once real component tests cover the env.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm exec tsc --noEmit --ignoreDeprecations 6.0`
- Linting passes: `pnpm lint`
- `pnpm test` runs both suites green — the new jsdom smoke `*.test.tsx` and the existing node `*.test.ts` (7 prior tests) in one invocation
- Production build still succeeds: `pnpm build`

#### Manual Verification:

- Temporarily break the smoke test's assertion and confirm it fails under jsdom (proving the env is real, not skipped), then restore it.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Editable consolidated list (UI + client state)

### Overview

Replace the consolidated textarea with a structured editable list: a `useEditableItems` hook owns the state + projection, `ProductRow` renders one row, `ProductListEditor` composes rows + add button + empty state, and `ReviewStep` is rewired. Remove the dead `itemsToText`.

### Changes Required:

#### 1. `useEditableItems` hook

**File**: `src/components/recipes/wizard/useEditableItems.ts` (new)

**Intent**: Own the editable list seeded from the recognized items, expose add/delete/update operations keyed by an ephemeral row id, and provide a pure projection to a clean `RecognizedItem[]` (the `correctedItems` shape) plus per-field validity hints — leaving the original `recognizedItems` untouched.

**Contract**: An internal editable-row type and a hook API roughly as below. `name`/`quantity` are free strings (may be transiently empty); `context` travels read-only; `id` is ephemeral and stripped by the projection. `addItem` appends a blank row and surfaces its id for autofocus. `toCorrectedItems()` trims/validates at the boundary and returns the clean list (used by a future upload — not called for persistence here).

```ts
interface EditableItem {
  id: string; // ephemeral client id — React key only, not persisted
  name: string;
  quantity: string;
  context: string; // read-only, informative
}

interface UseEditableItems {
  items: EditableItem[];
  lastAddedId: string | null; // drives autofocus-on-add
  addItem: () => void;
  removeItem: (id: string) => void;
  updateField: (id: string, field: "name" | "quantity", value: string) => void;
  toCorrectedItems: () => RecognizedItem[]; // server-ready projection (no upload here)
}
```

A pure validity helper (empty / over-length against the `RecognizedItem` bounds: name 1–120, quantity 1–60) backs the inline hints; keep it pure so it could be unit-tested directly even though the chosen coverage is component-level.

#### 2. `ProductRow` component

**File**: `src/components/recipes/wizard/ProductRow.tsx` (new)

**Intent**: Render one editable item — name `Input`, quantity `Input`, the item's `context` as smaller muted read-only text (to the right on `sm+`, below on mobile), and a delete control.

**Contract**: Props `{ item: EditableItem; onChange: (field: "name" | "quantity", value: string) => void; onRemove: () => void; autoFocus?: boolean; hints?: { name?: string; quantity?: string } }`. Uses shadcn `Input` + `Button` (lucide icon for delete), Polish accessible labels (`aria-label`/`Label`). Responsive layout via Tailwind (`flex-col` on mobile → `sm:flex-row` with context on the right). Inline hint text shown (muted/destructive, small) when a field hint is present. When `autoFocus`, focus the name input on mount.

#### 3. `ProductListEditor` component

**File**: `src/components/recipes/wizard/ProductListEditor.tsx` (new)

**Intent**: Compose the editable rows, the "add product" action, and the empty state; own the `useEditableItems` hook and the autofocus-on-add wiring.

**Contract**: Props `{ recognizedItems: RecognizedItem[] | null }`. Seeds the hook from the prop; renders a `ProductRow` per item (keyed by `item.id`), an "Dodaj produkt" `Button` that appends a blank row and focuses its name input, and — when the list is empty — a muted "Nie rozpoznano żadnych produktów." hint plus the add button (zero rows). Passes per-row hints down from the hook.

#### 4. `ReviewStep` rewire

**File**: `src/components/recipes/wizard/ReviewStep.tsx`

**Intent**: Swap the consolidated textarea for `<ProductListEditor>`; keep the per-photo cards and the "Lista zbiorcza" card shell.

**Contract**: Replace the second card's `CardContent` body (the `Label` + `Textarea`, `:36-47`) with `<ProductListEditor recognizedItems={result.session.recognizedItems} />`. Remove the now-unused `useState`, `itemsToText`, `Textarea`, and `Label` imports. The per-photo `Card` (`:21-30`) is unchanged.

#### 5. Remove dead `itemsToText`

**File**: `src/components/recipes/item-format.ts` (delete)

**Intent**: Remove the helper that no longer has a caller after the rewire.

**Contract**: Delete the file. Confirm no remaining importers (`ReviewStep` was the only one).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm exec tsc --noEmit --ignoreDeprecations 6.0`
- Linting passes: `pnpm lint`
- Existing tests still pass: `pnpm test`
- Production build succeeds: `pnpm build`

#### Manual Verification:

- After recognition, the "Lista zbiorcza" shows one row per item with editable **name** and **quantity** inputs (no textarea).
- The item **context** appears as smaller muted text — to the right on desktop, below the inputs on mobile.
- **Add product** appends a blank row at the bottom and focuses its name input.
- **Delete** removes the intended row only; remaining rows keep their values (no key/identity glitch).
- Clearing a name or quantity shows an inline hint; over-length input is flagged.
- Empty recognition (no items) shows the muted hint + add button, zero rows.
- The per-photo read-only cards are visually unchanged; no regressions elsewhere in the wizard.

**Implementation Note**: Pause for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Component tests

### Overview

Cover the editable-list behaviors with React Testing Library, running under jsdom in the same `pnpm test` invocation.

### Changes Required:

#### 1. `ProductListEditor` component tests

**File**: `src/components/recipes/wizard/ProductListEditor.test.tsx` (new)

**Intent**: Lock the editing behaviors against regression via RTL.

**Contract**: A `// @vitest-environment jsdom` file using RTL + `user-event`, locating elements by role/label (not DOM structure), with no `waitForTimeout`. Covers: seeds rows from `recognizedItems` (name/quantity values present, context text rendered); editing a name and a quantity updates that row; **add** appends a blank row at the bottom and the new name input is focused; **delete** removes the targeted row and leaves the others intact; empty state (`null`/`[]`) renders the hint + add button with zero rows; clearing a field surfaces a validation hint. If the `toCorrectedItems` projection is awkward to assert through the component, cover it with a focused unit test of the pure helper.

#### 2. Remove the temporary smoke test

**File**: `src/test/smoke.test.tsx` (delete)

**Intent**: The real component tests now prove the jsdom env; the scaffold is no longer needed.

**Contract**: Delete the file; `pnpm test` still discovers and runs the jsdom component tests.

### Success Criteria:

#### Automated Verification:

- New component tests pass: `pnpm test`
- Type checking passes: `pnpm exec tsc --noEmit --ignoreDeprecations 6.0`
- Linting passes: `pnpm lint`

#### Manual Verification:

- Review the tests: they use `getByRole`/`getByLabelText`/`getByText` locators, no `waitForTimeout`, and assert on rendered outcomes (values, presence/absence of rows, focus) rather than internals.
- The smoke test is gone and the suite still runs green.

**Implementation Note**: Pause for manual confirmation; this is the final phase.

---

## Testing Strategy

### Component Tests (RTL + jsdom):

- Seed-from-recognized, edit name/quantity, add (append + autofocus), delete, empty state, validation hints — see Phase 3.

### Manual Testing Steps:

1. `pnpm dev`, sign in, open the recipe wizard, upload photos, run recognition.
2. In "Lista zbiorcza", confirm structured rows with editable name + quantity and context as small text (right on desktop, below on mobile).
3. Edit a name and a quantity; add a row (confirm bottom-append + name focus); delete a row.
4. Clear a field — confirm the inline hint; check empty-recognition state.
5. Resize to mobile width — confirm context moves below the inputs.
6. Confirm the per-photo cards are unchanged.

## Performance Considerations

Negligible — a small client list (≤ a handful of items) with local state; no network or heavy computation.

## Migration Notes

None — no persisted state, schema, or API contract changes. `correctedItems` already exists in the model; this change only produces the client-side shape, it does not write it.

## References

- Task: refactor the consolidated recognized-items textarea into a structured editable list (frontend only; upload out of scope).
- Current UI: `src/components/recipes/wizard/ReviewStep.tsx:38-46`; serializer `src/components/recipes/item-format.ts`.
- Model: `src/lib/core/model/recipe/index.ts:17-41` (`RecognizedItem`, `RecipeSession.correctedItems`).
- Response: `src/lib/core/boundry/recipe/responses.ts:14-19` (`RecognitionResult`).
- Per-photo (unchanged): `src/components/recipes/wizard/PhotoReviewCard.tsx`.
- Test config: `vitest.config.ts`; env stub `src/test/astro-env-server.stub.ts`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: React component test infrastructure

#### Automated

- [x] 1.1 Type checking passes (`tsc --noEmit`) — 1fb75c6d3
- [x] 1.2 Linting passes (`pnpm lint`) — 1fb75c6d3
- [x] 1.3 `pnpm test` runs jsdom smoke + existing node tests green — 1fb75c6d3
- [x] 1.4 Production build succeeds (`pnpm build`) — 1fb75c6d3

#### Manual

- [x] 1.5 Smoke test genuinely runs under jsdom (break-then-restore check) — 1fb75c6d3

### Phase 2: Editable consolidated list (UI + client state)

#### Automated

- [x] 2.1 Type checking passes (`tsc --noEmit`) — 1524187c2
- [x] 2.2 Linting passes (`pnpm lint`) — 1524187c2
- [x] 2.3 Existing tests pass (`pnpm test`) — 1524187c2
- [x] 2.4 Production build succeeds (`pnpm build`) — 1524187c2

#### Manual

- [x] 2.5 Structured rows with editable name + quantity (no textarea) — 1524187c2
- [x] 2.6 Context shown as small text — right on desktop, below on mobile — 1524187c2
- [x] 2.7 Add product appends a blank row at the bottom and focuses its name input — 1524187c2
- [x] 2.8 Delete removes only the targeted row; others keep their values — 1524187c2
- [x] 2.9 Empty/over-length fields show inline hints — 1524187c2
- [x] 2.10 Empty recognition shows hint + add button (zero rows) — 1524187c2
- [x] 2.11 Per-photo cards unchanged; no wizard regressions — 1524187c2

### Phase 3: Component tests

#### Automated

- [x] 3.1 New component tests pass (`pnpm test`) — 1ce4dc89e
- [x] 3.2 Type checking passes (`tsc --noEmit`) — 1ce4dc89e
- [x] 3.3 Linting passes (`pnpm lint`) — 1ce4dc89e

#### Manual

- [x] 3.4 Tests use role/label locators, no waitForTimeout, assert outcomes — 1ce4dc89e
- [x] 3.5 Temporary smoke test removed; suite still green — 1ce4dc89e
