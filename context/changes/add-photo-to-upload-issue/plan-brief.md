# Accumulate Photos Across Picks — Plan Brief

> Full plan: `context/changes/add-photo-to-upload-issue/plan.md`
> Research: `context/changes/add-photo-to-upload-issue/research.md`

## What & Why

Adding photos one-by-one in the recipe wizard before upload replaces the previous photo instead of accumulating, so the user ends up with only the last one (a single multi-file pick works). Root cause: the picker handler calls `replace()` on every pick, which revokes all preview URLs and overwrites state. We add an `append` operation and rewire the handler to accumulate, de-dup, and validate the merged list.

## Starting Point

`useObjectUrls` exposes `{ photos, replace, removeAt, clear }` — no `append`. `UploadStep.handleSelect` calls `replace(files)` and validates only the new batch. The bug is purely client-side and pre-upload; files reach the server only on submit. The repo has vitest (node-only) with no DOM-test tooling.

## Desired End State

Picking photos one at a time grows the preview grid; multi-file picks still work; picking the same file twice adds it once; re-picking a just-removed file re-adds it; exceeding 5 photos (or a bad type/size) shows the existing error and keeps submit disabled. No object-URL leaks.

## Key Decisions Made

| Decision                     | Choice                                   | Why (1 sentence)                                                              | Source   |
| ---------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------- | -------- |
| Where the fix lives          | `append` in hook + rewire `handleSelect` | Local to one hook + one component; mirrors the existing `handleRemove` shape  | Research |
| Over-limit (>5 photos)       | Accept then show error                   | Reuses the existing accept-then-validate path; submit already gates on errors | Plan     |
| Duplicate files across picks | De-dup silently + reset `input.value`    | Prevents accidental double-adds while still allowing re-add after removal     | Plan     |
| Selection policy location    | In `UploadStep`, hook stays generic      | Hook owns URL lifecycle; component owns dedup/limits/validation               | Plan     |
| Testing                      | Manual verification only                 | No DOM-test infra exists; adding it is out of scope for this small bug        | Plan     |

## Scope

**In scope:**

- Add `append(files)` to `useObjectUrls` (mint URLs for new files only, revoke nothing).
- Rewire `UploadStep.handleSelect`: reset input value, dedup-merge picks, validate the merged list.

**Out of scope:**

- Any server/API/use-case/DB/migration change (bug never reaches the server).
- New test infrastructure (RTL/jsdom/Playwright) or logic extraction for testing.
- Pick-time rejection of over-limit files; changes to `PhotoPreviewGrid`/`useRecipeUpload`.

## Architecture / Approach

`useObjectUrls.append` is a generic, leak-safe append: object URLs are minted in the event-handler call and only spread inside the `setPhotos` updater (never minted in the updater — avoids StrictMode/React-compiler double-mint), revoking nothing existing. Selection policy stays in `UploadStep.handleSelect`: compute existing files, filter picks by file identity (`name`+`size`+`lastModified`), `append` the new ones, and `validateFiles([...existing, ...toAdd])` so the 5-photo limit holds across picks — mirroring `handleRemove`.

## Phases at a Glance

| Phase                             | What it delivers                                                                  | Key risk                                                    |
| --------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1. Accumulate photos across picks | `append` hook op + rewired `handleSelect` (dedup, merged validation, input reset) | Object-URL leak if URLs are minted inside the state updater |

**Prerequisites:** None — local dev environment only.
**Estimated effort:** ~1 short session, single phase.

## Open Risks & Assumptions

- File identity by `name`+`size`+`lastModified` is assumed sufficient to detect duplicate picks for product photos (two genuinely-distinct files with identical metadata are treated as one — an accepted edge case).
- Manual verification is the only regression guard; the exact bug could recur unguarded by an automated test.

## Success Criteria (Summary)

- One-by-one picking accumulates photos (the reported bug is gone) and multi-file picks still work.
- Duplicates are de-duped, removed files can be re-picked, and exceeding 5 photos shows the error with submit disabled.
- `tsc`, `pnpm lint`, `pnpm test`, and `pnpm build` all pass; no object-URL leak warnings.
