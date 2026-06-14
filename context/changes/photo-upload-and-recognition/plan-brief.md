# Photo Upload & Recognition — Domain/Schema Refactor — Plan Brief

> Full plan: `context/changes/photo-upload-and-recognition/plan.md`

## What & Why

The original S-01 stored recognition data denormalized on `recipe_sessions` (`photo_paths text[]`, `recognized_items_md`, `corrected_items_md`) and **threw away per-photo recognition results** after merging. PRD FR-004b needs each photo shown with what was recognized on it. This refactor normalizes photos into a `photos` table (1:n), migrates the item columns to JSON (`RecognizedItem[]`), and adds a per-photo read-only review with secured signed image URLs — while keeping the merged list as the single editable textarea.

## Starting Point

A working hexagonal slice: `RecipeSessionUC` orchestrates `RecipeSessionRepository` + `SessionPhotoStorage` + `ProductRecognizer`; recognition fans out one LLM call per photo path, merges, serializes to markdown, and writes `recognized_items_md`. The review UI is a single textarea. `recipes` already uses a direct-`user_id` + drift-guard RLS pattern we mirror for `photos`.

## Desired End State

Upload 1–5 photos → recognize → the review screen shows each photo (rendered via a secured signed URL) next to its **read-only** recognized `[name, quantity]` list, plus the merged/consolidated list in an **editable textarea**. Per-photo items live in `photos.recognized_items`; the merged list in `recipe_sessions.recognized_items`; both `RecognizedItem[]` JSON. `corrected_items` exists (nullable JSON) but is unused this scope. All photo data is owner-private via RLS.

## Key Decisions Made

| Decision               | Choice                                                                                              | Why (1 sentence)                                                                         | Source |
| ---------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------ |
| Per-photo presentation | In scope — read-only per-photo lists + signed image URL; merged list stays the editable textarea    | FR-004b needs per-photo display; data model now backs it                                 | Plan   |
| `Photo.photoUrl`       | Transient field populated by infra on fetch (signed URL); never persisted                           | Images are owner-secured; URL must be generated, not stored                              | Plan   |
| Migration style        | New destructive migration + `supabase db reset`                                                     | Preserves append-only convention; no prod data; overrides additive rule by authorization | Plan   |
| Item shape in JSON     | Full `RecognizedItem` incl. `context` (per-photo = recognition judgment; merged = why-in-final-set) | One schema everywhere, no lossy projection, "metadata full"                              | Plan   |
| Photo persistence      | New `PhotoRepository` port; read path populates `photoUrl`; `SessionPhotoStorage` keeps binary I/O  | Matches "infra populates URL on fetch"; one port per table                               | Plan   |
| Photos RLS             | Direct `user_id` + 4 policies + drift-guard trigger (mirror `recipes`)                              | Proven pattern; index-friendly; storage path already keyed on user_id                    | Plan   |
| Photo metadata         | Typed cols: path, object_id, content_type, size_bytes, original_filename                            | Captures everything cheap at upload; no follow-up migration                              | Plan   |
| Client response        | Lean `PhotoView` = `{ id, photoUrl, recognizedItems }` (not full `Photo`)                           | Keeps storage internals (path, object id, user_id) off the wire                          | Plan   |

## Scope

**In scope:** `photos` table + RLS; reshape `recipe_sessions` to JSON item columns; new `PhotoRepository` port/adapter; `Photo`/`StoredPhoto` models with transient `photoUrl`; UC rewrite (per-photo + merged persistence); recognition response as `RecognitionResult`; prompt context-semantics refresh; per-photo read-only review UI + signed-URL images; merged editable textarea fed from JSON.

**Out of scope:** persisting/transforming corrected items; recipe generation (S-02), `recipes` table, `Recipe`; editing per-photo lists; auth/LLM-model/limits/concurrency changes; automated tests; backward compatibility.

## Architecture / Approach

`RecipeSessionUC` gains a `PhotoRepository` collaborator. **Upload:** drop existing photos (storage + rows) → upload binaries (`SessionPhotoStorage` returns `StoredObject`) → insert one `photos` row per file. **Recognize:** `listBySession` (rows + signed `photoUrl`) → recognize per photo against its URL → persist per-photo `recognized_items` → merge → persist session `recognized_items` → return `{ session, photos }` aggregate, which the route projects to `RecognitionResult`. The client decodes `RecognitionResult` and renders per-photo cards + the merged textarea. `photoUrl` is generated only by `PhotoRepository.listBySession` (signed URL via the shared Supabase client) and never stored.

## Phases at a Glance

| Phase                         | What it delivers                                                                                    | Key risk                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1. Migration & schema truth   | `photos` table + RLS + reshaped `recipe_sessions`; reset + regenerated types                        | RLS/drift-guard misconfig → silent cross-user leak                 |
| 2. Model & boundary contracts | Reshaped `RecipeSession`; `Photo`/`StoredPhoto`; `PhotoRepository` port; `RecognitionResult`        | Breaks all consumers until 3–5 land (expected)                     |
| 3. Infra adapters             | `PhotoRepository` (signed-URL on read), storage/return + update mapping, converters/row schemas, DI | Mixing storage + table calls in one adapter                        |
| 4. UC, routes, prompts        | UC rewrite, recognition→`RecognitionResult`, prompt context semantics                               | Preserving the ~30 s latency budget + resilience policy            |
| 5. Presentation & integration | Per-photo read-only cards (signed images) + merged textarea; decode `RecognitionResult`             | Using server signed URLs (not local object URLs) for review images |

**Prerequisites:** Local Supabase (Docker) running for `db reset`/`db:types`; OpenRouter key for manual recognition.
**Estimated effort:** ~2–3 sessions across 5 phases (one breaking server-side reshape + a UI phase).

## Open Risks & Assumptions

- **Coordinated breaking reshape:** full `pnpm lint`/`build` is green only at Phase 5 (server-side at Phase 4). Intermediate phases verify migration/types/local consistency; transient type errors between Phases 2–4 are expected, not a regression.
- **OQ7 (dedup quantity rule)** remains a non-blocking PRD open question; merge behavior is unchanged by this refactor.
- Assumes supabase-js auto-parses/accepts `jsonb` as JS arrays (no manual `JSON.parse`/`stringify` at call sites).

## Success Criteria (Summary)

- Full upload→recognize→review flow works on the author's data: per-photo read-only lists with secured signed images + merged editable textarea.
- `photos.recognized_items` (per photo) and `recipe_sessions.recognized_items` (merged) hold `RecognizedItem[]` JSON; `corrected_items` is null.
- A second user cannot access another user's photos/rows (RLS holds).
