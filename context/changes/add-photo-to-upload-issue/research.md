---
date: 2026-06-14T15:42:25+0200
researcher: tomasz.worsztynowicz
git_commit: b7914f4c2f178c58ee347ce0bef03abc45b27cab
branch: main
repository: snapchef
topic: "Adding photos one-by-one before upload replaces the previous photo instead of accumulating"
tags: [research, codebase, photo-upload, recipe-wizard, useObjectUrls, react-state]
status: complete
last_updated: 2026-06-14
last_updated_by: tomasz.worsztynowicz
---

# Research: Adding photos one-by-one before upload replaces the previous photo

**Date**: 2026-06-14T15:42:25+0200
**Researcher**: tomasz.worsztynowicz
**Git Commit**: b7914f4c2f178c58ee347ce0bef03abc45b27cab
**Branch**: main
**Repository**: snapchef

## Research Question

On the front end there is an issue in the functionality of adding new photos _before_ uploading them
to the server. Every time you add a new photo, it removes the previously added one — so adding photos
one-by-one leaves you with only the last. Adding multiple photos in a single pick works correctly.
Find the root cause of this behavior.

## Summary

**Root cause (confirmed):** the file-picker change handler replaces the entire selection on every
pick instead of appending to it.

`UploadStep.handleSelect` calls `replace(files)` ([UploadStep.tsx:27](https://github.com/siwulus/snapchef/blob/b7914f4c2f178c58ee347ce0bef03abc45b27cab/src/components/recipes/wizard/UploadStep.tsx#L27)),
and `replace` in `useObjectUrls` revokes **all** existing preview URLs and sets state to **only** the
newly-picked batch ([useObjectUrls.ts:32-37](https://github.com/siwulus/snapchef/blob/b7914f4c2f178c58ee347ce0bef03abc45b27cab/src/components/hooks/useObjectUrls.ts#L32-L37)).
The hook offers no "append/add" operation at all — only `replace`, `removeAt`, `clear`.

This is **not** a race, stale closure, or React-batching bug. It is intentional "wholesale replace"
semantics (the hook comment even states the assumption: _"The file input replaces the selection
wholesale"_ — [useObjectUrls.ts:31](https://github.com/siwulus/snapchef/blob/b7914f4c2f178c58ee347ce0bef03abc45b27cab/src/components/hooks/useObjectUrls.ts#L31))
that contradicts the desired "accumulate across picks" UX.

**Why the symptom matches exactly:**

- **Multiple at once** → one `change` event whose `event.target.files` holds all N files →
  `replace([f1…fN])` → all N shown. _Works._
- **One at a time** → a separate `change` event per pick → `replace([f1])`, then `replace([f2])`
  (revokes f1's URL, state becomes `[f2]`), then `replace([f3])` … → only the last survives.
  _Broken — exactly as reported._

## Detailed Findings

### The change handler (entry point of the bug)

`src/components/recipes/wizard/UploadStep.tsx` — the wizard step where files are chosen before upload.

- The hidden `<input type="file" multiple>` ([:55-63](https://github.com/siwulus/snapchef/blob/b7914f4c2f178c58ee347ce0bef03abc45b27cab/src/components/recipes/wizard/UploadStep.tsx#L55-L63))
  fires `handleSelect` on every selection.
- `handleSelect` ([:24-31](https://github.com/siwulus/snapchef/blob/b7914f4c2f178c58ee347ce0bef03abc45b27cab/src/components/recipes/wizard/UploadStep.tsx#L24-L31)):
  ```ts
  const handleSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    replace(files); // ← root cause: wholesale replace, not append
    setErrors(validateFiles(files)); // ← validates only the new batch, not the merged list
    clearRecognitionError();
    onDirtyChange(true);
  };
  ```
- `handleRemove` ([:33-38](https://github.com/siwulus/snapchef/blob/b7914f4c2f178c58ee347ce0bef03abc45b27cab/src/components/recipes/wizard/UploadStep.tsx#L33-L38))
  already shows the correct shape for working over the _combined_ list: it derives `next` from the
  current `photos`, calls `removeAt(index)`, then re-validates `next`. The fix for `handleSelect`
  should mirror that "operate on the merged list" approach.

### The state hook (where the replace happens)

`src/components/hooks/useObjectUrls.ts` — owns the `SelectedPhoto[]` list and its object-URL lifecycle.

- Exposed API: `{ photos, replace, removeAt, clear }` — **no append** ([:51](https://github.com/siwulus/snapchef/blob/b7914f4c2f178c58ee347ce0bef03abc45b27cab/src/components/hooks/useObjectUrls.ts#L51)).
- `replace` ([:32-37](https://github.com/siwulus/snapchef/blob/b7914f4c2f178c58ee347ce0bef03abc45b27cab/src/components/hooks/useObjectUrls.ts#L32-L37))
  revokes every current URL, then `setPhotos(files.map(...))` — discarding the prior selection.
- URL-leak handling is otherwise careful: `removeAt` revokes only the removed URL ([:39-42](https://github.com/siwulus/snapchef/blob/b7914f4c2f178c58ee347ce0bef03abc45b27cab/src/components/hooks/useObjectUrls.ts#L39-L42));
  remaining URLs are revoked once on unmount via a `photosRef` ([:14-29](https://github.com/siwulus/snapchef/blob/b7914f4c2f178c58ee347ce0bef03abc45b27cab/src/components/hooks/useObjectUrls.ts#L14-L29)).
  An `append` must mint URLs **only for the new files** and must **not** revoke the existing ones.

### Preview rendering (not the cause — renders whatever state holds)

`src/components/recipes/wizard/PhotoPreviewGrid.tsx` is a pure render of `photos`, keyed by
`photo.url` ([:10-28](https://github.com/siwulus/snapchef/blob/b7914f4c2f178c58ee347ce0bef03abc45b27cab/src/components/recipes/wizard/PhotoPreviewGrid.tsx#L10-L28)).
It faithfully shows the (already-truncated) list — it neither causes nor masks the bug.

### Validation contract & limits (affects how the fix is shaped)

`src/components/recipes/image-processing.ts` → `validateFiles` ([:11-24](https://github.com/siwulus/snapchef/blob/b7914f4c2f178c58ee347ce0bef03abc45b27cab/src/components/recipes/image-processing.ts#L11-L24))
checks count, type, and per-file size against the shared boundary constants in
`src/lib/core/boundry/recipe/dto.ts`:

- `MAX_PHOTOS = 5` ([dto.ts:1](https://github.com/siwulus/snapchef/blob/b7914f4c2f178c58ee347ce0bef03abc45b27cab/src/lib/core/boundry/recipe/dto.ts#L1))
- `MAX_PHOTO_BYTES = 5 MB` ([dto.ts:2](https://github.com/siwulus/snapchef/blob/b7914f4c2f178c58ee347ce0bef03abc45b27cab/src/lib/core/boundry/recipe/dto.ts#L2))

Implication for the fix: once picks accumulate, validation must run on the **merged** list
(`[...existing, ...new]`), otherwise the `> MAX_PHOTOS` guard is evaluated only against the latest
batch and a user could exceed 5 photos across multiple picks without an error.

### Call-site audit (scope of the fix)

`useObjectUrls` is used in exactly **one** place — `UploadStep.tsx:18`. `replace` has no other
call site (the other `grep` hits are `String.replace`, `Logger.replace`, and `formData.append` in
`useRecipeUpload.ts:46`, all unrelated). So the fix is local: add `append` to the hook and switch
`handleSelect` to use it; `replace`/`clear` can remain as primitives.

## Code References

- `src/components/recipes/wizard/UploadStep.tsx:27` — **root cause**: `replace(files)` on every pick → [permalink](https://github.com/siwulus/snapchef/blob/b7914f4c2f178c58ee347ce0bef03abc45b27cab/src/components/recipes/wizard/UploadStep.tsx#L27)
- `src/components/recipes/wizard/UploadStep.tsx:24-31` — `handleSelect`; also validates only the new batch → [permalink](https://github.com/siwulus/snapchef/blob/b7914f4c2f178c58ee347ce0bef03abc45b27cab/src/components/recipes/wizard/UploadStep.tsx#L24-L31)
- `src/components/recipes/wizard/UploadStep.tsx:33-38` — `handleRemove`; the correct "operate on merged list" pattern to mirror → [permalink](https://github.com/siwulus/snapchef/blob/b7914f4c2f178c58ee347ce0bef03abc45b27cab/src/components/recipes/wizard/UploadStep.tsx#L33-L38)
- `src/components/hooks/useObjectUrls.ts:32-37` — `replace` revokes all URLs + overwrites state → [permalink](https://github.com/siwulus/snapchef/blob/b7914f4c2f178c58ee347ce0bef03abc45b27cab/src/components/hooks/useObjectUrls.ts#L32-L37)
- `src/components/hooks/useObjectUrls.ts:51` — hook API has no `append` → [permalink](https://github.com/siwulus/snapchef/blob/b7914f4c2f178c58ee347ce0bef03abc45b27cab/src/components/hooks/useObjectUrls.ts#L51)
- `src/components/recipes/image-processing.ts:11-24` — `validateFiles` (count/type/size) → [permalink](https://github.com/siwulus/snapchef/blob/b7914f4c2f178c58ee347ce0bef03abc45b27cab/src/components/recipes/image-processing.ts#L11-L24)
- `src/lib/core/boundry/recipe/dto.ts:1-2` — `MAX_PHOTOS = 5`, `MAX_PHOTO_BYTES = 5 MB` → [permalink](https://github.com/siwulus/snapchef/blob/b7914f4c2f178c58ee347ce0bef03abc45b27cab/src/lib/core/boundry/recipe/dto.ts#L1-L2)

## Architecture Insights

- The photo selection is **client-only local state** held in `useObjectUrls`; files reach the server
  only on submit via `useRecipeUpload` (`formData.append("photos", file)` —
  [useRecipeUpload.ts:46](https://github.com/siwulus/snapchef/blob/b7914f4c2f178c58ee347ce0bef03abc45b27cab/src/components/recipes/wizard/useRecipeUpload.ts#L46)).
  The bug is purely in the pre-upload accumulation, never reaching the API.
- The hook is conscientious about object-URL leaks (per-removal revoke + unmount sweep via ref). Any
  `append` must preserve that discipline: create URLs for new files only, never revoke live previews.
- Validation is centralized on shared boundary constants (`MAX_PHOTOS`, `MAX_PHOTO_BYTES`), so the fix
  has a single, correct source of truth to validate the merged list against.

## Likely Fix (for the planning step — not yet implemented)

1. **Add `append(files)` to `useObjectUrls`** — `setPhotos(current => [...current, ...newOnes])`
   (functional updater, matching `removeAt`'s style), minting URLs for the new files only and revoking
   nothing existing.
2. **Switch `handleSelect` to `append`** and validate the **merged** list
   (`validateFiles([...photos.map(p => p.file), ...files])`), mirroring `handleRemove`.
3. **Reset the input value** after handling (`event.target.value = ""`) so re-picking the _same_ file
   (e.g. after removing it) still fires `change` — otherwise an identical-value selection is silently
   ignored by the browser. (Secondary, but a real follow-on gap once append is in place.)
4. **Optional: de-duplicate** on append (by `name`+`size`+`lastModified`) to avoid double-adding the
   same file across picks.

## Historical Context (from prior changes)

- `context/changes/photo-upload-and-recognition/` — the originating feature change (recent commits
  `c8b383dc8` "per-photo review UI + wizard orchestrator", `2cc99fa62`, `bbbbb57c5`). The
  `useObjectUrls` "wholesale replace" assumption was introduced here; this bug is its direct
  consequence in the one-by-one flow.

## Related Research

- None yet. This is the first research artifact for `add-photo-to-upload-issue`.

## Open Questions

- **Desired UX on re-pick of a removed file:** is silent dedup acceptable, or should re-adding a
  removed file be allowed? Drives whether step 3 (input reset) and step 4 (dedup) coexist.
- **Over-limit feedback:** when a pick pushes the merged list past `MAX_PHOTOS = 5`, should the UI
  reject the extra files at pick time, or accept-then-show the validation error (current style)? The
  fix should pick one deliberately.
