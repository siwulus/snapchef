# Accumulate Photos Across Picks Implementation Plan

## Overview

Pre-upload photo selection in the recipe wizard currently **replaces** the whole selection on every file pick instead of **accumulating** it. Adding photos one-by-one therefore leaves only the last photo; only a single multi-file pick works. This plan makes the selection accumulate by adding an `append` operation to the `useObjectUrls` hook and rewiring `UploadStep.handleSelect` to merge each new pick onto the existing list (de-duplicating identical files), then validate the **merged** list against the shared limits.

The bug is entirely client-side and pre-upload — files reach the server only on submit, so no API, route, use-case, DB, or migration work is involved.

## Current State Analysis

- `useObjectUrls` (`src/components/hooks/useObjectUrls.ts`) owns the `SelectedPhoto[]` list and its object-URL lifecycle. Its API is `{ photos, replace, removeAt, clear }` — **there is no `append`**.
  - `replace` (`:32-37`) revokes **every** current preview URL and overwrites state with only the new batch — the root cause when called per pick.
  - URL-leak discipline is otherwise careful: `removeAt` (`:39-42`) revokes only the removed URL; remaining URLs are revoked once on unmount via a `photosRef` (`:14-29`).
- `UploadStep` (`src/components/recipes/wizard/UploadStep.tsx`) is the single consumer.
  - `handleSelect` (`:24-31`) calls `replace(files)` and `validateFiles(files)` — wholesale replace, and it validates **only the new batch**, so a multi-pick can exceed `MAX_PHOTOS` across picks without an error.
  - `handleRemove` (`:33-38`) already demonstrates the correct "operate on the merged list" shape: derive `next` from `photos`, mutate, then re-validate `next`. The fix mirrors this.
- `validateFiles` (`src/components/recipes/image-processing.ts:11-24`) checks count / type / size against the shared boundary constants `MAX_PHOTOS = 5` and `MAX_PHOTO_BYTES = 5 MB` (`src/lib/core/boundry/recipe/dto.ts:1-2`).
- `useObjectUrls` has exactly one call site; `replace` has no other call site. The fix is local.
- **Test infrastructure:** `vitest.config.ts` runs `environment: "node"` and includes only `src/**/*.test.ts`. There is **no jsdom / @testing-library/react / Playwright** — the only tests are pure-logic node tests. Per the agreed decision, this fix is covered by **manual verification only**; no new test infra and no logic-extraction-for-testing.

## Desired End State

In the wizard upload step, picking photos one-by-one accumulates them: each pick adds to the existing previews rather than replacing them. Picking the same file twice across separate picks adds it only once. Re-picking a file that was just removed re-adds it. When the accumulated count exceeds 5 (or a file is the wrong type/size), the existing validation error is shown and the "Rozpoznaj produkty" button stays disabled until the user trims the selection. Selecting multiple files in one pick continues to work. No preview-URL leaks are introduced.

Verify by: opening the wizard, picking photos one at a time, and confirming the preview grid grows with each pick; then exercising the dedup, re-pick, and over-limit edge cases manually (see Manual Verification).

### Key Discoveries:

- **Root cause** — `UploadStep.tsx:27` calls `replace(files)` on every pick; `replace` (`useObjectUrls.ts:32-37`) revokes all URLs and overwrites state.
- **Correct pattern to mirror** — `handleRemove` (`UploadStep.tsx:33-38`) computes the resulting list locally and re-validates it.
- **URL-leak constraint** — an `append` must mint object URLs for the new files **only** and must **never** revoke live previews; the unmount sweep (`useObjectUrls.ts:22-29`) already covers whatever ends up in state.
- **Validation source of truth** — `validateFiles` + `MAX_PHOTOS`/`MAX_PHOTO_BYTES`; validation must run on the **merged** list so the 5-photo limit holds across picks.
- **Browser re-pick gotcha** — a native `<input type="file">` does not fire `change` when the user picks a value identical to the last one; resetting `event.target.value` after each pick is required so re-adding a removed file works.

## What We're NOT Doing

- No server, API route, use-case, port/adapter, DB, or migration changes — the bug never reaches the server.
- No new test infrastructure (RTL / jsdom / Playwright) and no pure-logic extraction purely to enable a unit test — **manual verification only**, per decision.
- No partial-accept / pick-time rejection of over-limit files — we **accept then show the error** (the existing accept-then-validate style).
- No changes to `replace` or `clear` in `useObjectUrls` — they remain as primitives (now simply unused by the sole caller).
- No changes to `PhotoPreviewGrid`, `useRecipeUpload`, `prepareForUpload`, or the upload/recognition flow.

## Implementation Approach

Add a generic `append` to `useObjectUrls` whose only responsibility is appending pre-formed previews to state while preserving URL-leak discipline (mint in the event handler, spread inside the state updater, revoke nothing). Keep **selection policy** — de-duplication, the merged list, validation — in `UploadStep.handleSelect`, mirroring how `handleRemove` already owns its list math. This keeps the hook a generic URL-lifecycle manager and the component the owner of selection rules, matching the existing separation.

## Critical Implementation Details

**Object-URL lifecycle (the one real gotcha):** create the object URLs in the `append` call (an event-handler context), not inside the `setPhotos` updater. A `setState` updater must be pure; minting URLs inside it would double-create (and leak) under React StrictMode / the React compiler. The updater only spreads already-minted preview objects. `append` must not touch existing URLs; the existing unmount sweep revokes whatever remains in state.

## Phase 1: Accumulate photos across picks

### Overview

Add `append` to `useObjectUrls`, then rewire `UploadStep.handleSelect` to reset the input, de-dup-merge each pick onto the existing list, append the genuinely-new files, and validate the merged list.

### Changes Required:

#### 1. `useObjectUrls` — add an `append` operation

**File**: `src/components/hooks/useObjectUrls.ts`

**Intent**: Provide an append operation so the file picker can accumulate selections instead of replacing them, without leaking object URLs or revoking live previews.

**Contract**: New method `append(files: File[]): void` added to the returned API (`{ photos, replace, append, removeAt, clear }`). It mints one object URL per passed file and appends the resulting `SelectedPhoto[]` to state via a functional updater; it revokes nothing. URLs are created in the call body, not inside the updater (see Critical Implementation Details). The existing unmount cleanup already covers the appended URLs. `replace`/`clear` are unchanged.

```ts
const append = (files: File[]) => {
  const additions = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
  setPhotos((current) => [...current, ...additions]);
};
```

#### 2. `UploadStep` — accumulate, de-dup, reset input, validate merged list

**File**: `src/components/recipes/wizard/UploadStep.tsx`

**Intent**: Make each pick add to the existing selection (de-duplicating identical files), allow re-picking a removed file, and validate the combined list so the 5-photo limit and per-file rules apply across picks — mirroring the existing `handleRemove` "operate on the merged list" shape.

**Contract**:

- Destructure `append` from `useObjectUrls()` (replacing `replace` in the destructure; `replace` stays exported but unused).
- In `handleSelect`: after reading `event.target.files`, set `event.target.value = ""` so re-picking the same/previously-removed file fires `change` again. Return early when nothing was picked.
- Compute the existing files (`photos.map((p) => p.file)`), filter the picked files to those **not already present** using a file-identity check (`name` + `size` + `lastModified`) → the files to add. Call `append(toAdd)`.
- Validate the **merged** list — `validateFiles([...existing, ...toAdd])` — and `setErrors(...)` with the result, so the `> MAX_PHOTOS` error surfaces across picks. Keep `clearRecognitionError()` and `onDirtyChange(true)`.
- Over-limit needs no extra branch: `validateFiles` returns the "maksymalnie 5 zdjęć" error and `canSubmit` already gates on `errors.length === 0`, so submit stays disabled until the user removes photos.

A small file-identity helper (`name`+`size`+`lastModified`) is the dedup predicate; keep it local to `UploadStep` (or alongside `validateFiles` in `image-processing.ts` if a shared home reads cleaner). User-facing strings stay Polish; no new strings are needed.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm exec tsc --noEmit --ignoreDeprecations 6.0`
- Linting passes: `pnpm lint`
- Existing unit tests pass: `pnpm test`
- Production build succeeds: `pnpm build`

#### Manual Verification:

- Picking photos **one at a time** accumulates them — the preview grid grows with each pick (the reported bug is gone).
- Selecting **multiple photos in a single pick** still works (no regression).
- Picking the **same file again** across separate picks does not duplicate it in the grid.
- **Removing** a photo and then **re-picking** that same file re-adds it (input-value reset works).
- Accumulating **past 5 photos** shows the "maksymalnie 5 zdjęć" error and disables "Rozpoznaj produkty" until photos are removed.
- A **wrong-type or oversized** file in any pick shows its per-file error and blocks submit.
- No console warnings about leaked/revoked object URLs; previews render correctly throughout (remove a photo, confirm others still display).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation from the human that the manual testing above succeeded before considering the change complete.

---

## Testing Strategy

### Unit Tests:

- None added. Per the agreed decision, the fix is covered by manual verification only; the repo has no DOM-test infrastructure and adding it is out of scope for this bug.

### Manual Testing Steps:

1. Start the app (`pnpm dev`), sign in, and open the recipe wizard upload step.
2. Pick one photo, confirm it appears. Pick a second (separate pick), confirm **both** appear. Repeat to 3–4 photos.
3. Pick two photos in a single selection — confirm both append to the existing set.
4. Re-pick a file already in the grid — confirm it is not added twice.
5. Remove a photo, then pick that same file again — confirm it re-appears.
6. Add photos until the list would exceed 5 — confirm the limit error shows and submit is disabled; remove one and confirm submit re-enables.
7. Pick a `.gif` (or a >5 MB image) — confirm the per-file error shows and submit is blocked.

## Performance Considerations

Negligible. Object URLs are minted per added file and revoked on removal/unmount exactly as today; the dedup filter is O(existing × picked) over a list capped near `MAX_PHOTOS`.

## Migration Notes

None — no persisted state, schema, or API contract changes.

## References

- Research: `context/changes/add-photo-to-upload-issue/research.md`
- Root cause: `src/components/recipes/wizard/UploadStep.tsx:27`, `src/components/hooks/useObjectUrls.ts:32-37`
- Pattern to mirror: `src/components/recipes/wizard/UploadStep.tsx:33-38` (`handleRemove`)
- Limits: `src/lib/core/boundry/recipe/dto.ts:1-2`; validation `src/components/recipes/image-processing.ts:11-24`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Accumulate photos across picks

#### Automated

- [x] 1.1 Type checking passes (`tsc --noEmit`) — f01b66a93
- [x] 1.2 Linting passes (`pnpm lint`) — f01b66a93
- [x] 1.3 Existing unit tests pass (`pnpm test`) — f01b66a93
- [x] 1.4 Production build succeeds (`pnpm build`) — f01b66a93

#### Manual

- [x] 1.5 One-at-a-time picks accumulate (bug fixed) — f01b66a93
- [x] 1.6 Single multi-file pick still works (no regression) — f01b66a93
- [x] 1.7 Same file across picks is de-duplicated — f01b66a93
- [x] 1.8 Remove-then-re-pick re-adds the file (input reset) — f01b66a93
- [x] 1.9 Over-limit (>5) shows error and disables submit — f01b66a93
- [x] 1.10 Wrong-type / oversized file shows per-file error and blocks submit — f01b66a93
- [x] 1.11 No object-URL leak/revoke warnings; previews render throughout — f01b66a93
