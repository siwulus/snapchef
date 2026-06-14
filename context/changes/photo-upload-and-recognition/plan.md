# Photo Upload & Recognition — Domain/Schema Refactor Implementation Plan

## Overview

The original S-01 implementation stored recognition data denormalized on `recipe_sessions`: `photo_paths text[]`, `recognized_items_md text`, `corrected_items_md text`. Per-photo recognition results were computed during the merge and then **discarded** — there was no place to persist "what was recognized on each photo" (PRD FR-004b).

This change normalizes the model:

1. **`photo_paths` → a `photos` table (1:n with `recipe_sessions`)** — each photo row persists its storage path, a stable storage object id, file metadata, and **its own recognized items** (`RecognizedItem[]` as JSON). This is the data backing FR-004b ("prezentacja per zdjęcie").
2. **`recognized_items_md text` → `recognized_items jsonb`** (`RecognizedItem[]`) — the merged/consolidated final list (FR-004c).
3. **`corrected_items_md text` → `corrected_items jsonb`** (`RecognizedItem[]`) — renamed + retyped; remains unused/null this scope (textarea edits stay client-side per S-01; transform-to-items is a future step).
4. **Presentation gains a per-photo review** — after recognition, each photo is shown with its **read-only** recognized list and a **secured signed image URL**; the merged list stays the single **editable textarea**.

A new domain field `Photo.photoUrl` (a signed URL) is **populated by the infrastructure layer on fetch and never persisted**.

## Current State Analysis

- **Domain** (`src/lib/core/model/recipe/index.ts`): `RecipeSession` carries `photoPaths: string[]`, `recognizedItemsMd: string | null`, `correctedItemsMd: string | null`. `RecognizedItem` = `{ name, quantity, context }` where `context` is documented as a transient merge cue that is **not persisted**.
- **Boundary** (`src/lib/core/boundry/recipe/`): `ports.ts` declares `RecipeSessionRepository`, `SessionPhotoStorage` (`upload` returns a bare `string` path, discarding Supabase's `{ id, fullPath }`), `ProductRecognizer`. `RecipeSessionUpdatePayload` is `RecipeSession.pick({ correctedItemsMd, mealContext, recognizedItemsMd, state, photoPaths }).partial()`. `dto.ts` holds upload limits. No `responses.ts`.
- **Use case** (`src/lib/core/uc/recipe/RecipeSessionUC.ts`): `attachPhotos` uploads files and writes `photo_paths` + `state`; `recognizeProducts` fans out one LLM call per `photoPaths` entry (concurrency 5, 25 s timeout, 1 retry, per-photo failure → `[]`), merges non-empty lists, `serializeItemsToMarkdown` → writes `recognized_items_md`. **Per-photo results are never persisted.**
- **Infra**: `RecipeSessionRepository.ts` (`toRecipeSessionUpdate` maps camelCase→snake_case incl. `photo_paths`), `SessionPhotoStorage.ts` (bucket `session-photos`, `buildPath` = `{userId}/{sessionId}/{uuid}.{ext}`, `createPreviewUrls` already does signed-URL generation, `remove`), `types/index.ts` (hand-written `RecipeSessionRow` zod + generated table types), `types/converters.ts` (`RecipeSessionFromRow`).
- **DI** (`src/middleware.ts:42`): `new RecipeSessionUC(createRecipeSessionRepository(supabase), createSessionPhotoStorage(supabase), createProductRecognizer())`.
- **Routes** (`src/pages/api/recipe-sessions/**`): `index.ts` (create → `RecipeSession`), `[id]/upload.ts` (→ `RecipeSession`), `[id]/recognition.ts` (→ `RecipeSession`). All thin, delegate to `runApiRoute`.
- **Presentation**: `RecipeWizard.tsx` two-step (`upload`→`review`); review shows a single `<textarea>` seeded from `recognizedItemsMd`. `UploadStep.tsx` chains create→upload→recognize, reads only `result.data.recognizedItemsMd`, ignores `photoPaths`. `image-processing.ts` validates + downscales client-side.
- **Migrations**: `20260530100000_domain_schema_and_storage.sql` (tables + RLS + bucket + drift-guard for `recipes`), `20260606120000_add_recipe_session_state.sql` (state column + relaxed NOT NULLs). `recipes` table uses the **direct `user_id` + drift-guard trigger** ownership pattern we will mirror for `photos`.
- **Tests**: only `logger.test.ts` + `effect.test.ts`. No domain/E2E tests for this flow — verification leans on typecheck/lint/build + manual.

### Key Discoveries:

- `RecognizedItem.context` (`core/model/recipe/index.ts:37`) is currently required and explicitly _not persisted_. After this change it **is** persisted in JSON: per-photo `context` = the recognition judgment; merged `context` = the judgment of why an item is in the final consolidated set. The model doc + the two LLM prompts (`infrastructure/llm/prompts.ts`) must be updated to reflect this.
- `SessionPhotoStorage.createPreviewUrls` (`SessionPhotoStorage.ts:31`) already generates batch signed URLs — the `photoUrl` population mechanism exists; the new `PhotoRepository` read path reuses this Supabase capability.
- The client (`UploadStep.tsx`) never reads `photoPaths`, so dropping it from responses is safe; the only client read to migrate is `recognizedItemsMd`.
- `recipes_assert_user_id_matches_session` (`20260530100000_*.sql:108`) is the drift-guard template to copy for `photos`.
- `db:types` (`package.json`) runs against the **local** Supabase (Docker required) and overwrites `generated.ts` (excluded from ESLint/Prettier).

## Desired End State

A logged-in user uploads 1–5 photos, the system recognizes products per photo, and the review screen shows: (a) each uploaded photo via a **secured signed URL** alongside its **read-only** recognized `[name, quantity]` list, and (b) the merged/consolidated list in an **editable textarea**. Per-photo recognized items live in `photos.recognized_items`, the merged list in `recipe_sessions.recognized_items`, both as `RecognizedItem[]` JSON. `corrected_items` exists as nullable JSON but is unused (client-side edits only). All photo data is owner-private via RLS.

**Verification of end state:** `pnpm lint` + `pnpm build` pass; the full upload→recognize→review flow works manually on the author's data; a second user cannot read another user's photos/rows (RLS); `photos` rows carry per-photo items and the session carries the merged list.

## What We're NOT Doing

- **Not** persisting corrected items or transforming the textarea back into `RecognizedItem[]` (explicitly out of scope — future step).
- **Not** changing recipe generation (S-02), the `recipes` table, or the `Recipe` model.
- **Not** preserving backward compatibility or migrating existing data — the migration is intentionally destructive and the DB is reset (no production data). This **overrides** the CLAUDE.md additive-only migration rule for this change, by explicit authorization in the change brief.
- **Not** adding editing/removal/add-product affordances to the per-photo lists (they are read-only); the merged list remains the only editable surface (and its edits stay client-side).
- **Not** changing auth, the LLM transport/model selection, the recognition concurrency/timeout/retry policy, or upload limits.
- **Not** adding automated tests (none exist for this flow; manual verification per S-01).

## Implementation Approach

Work in dependency order: **schema → model/contracts → adapters → use case/routes → presentation**. Because reshaping `RecipeSession` is a breaking change touched by every layer (including the client island that imports the model), the codebase only returns to a fully green `pnpm lint`/`build` at **Phase 5**; server-side compiles at the end of **Phase 4**. Each phase below lists the verification that is genuinely runnable at that point — the implementer should expect transient type errors between Phases 2–4 and resist "fixing" them out of phase order.

Ownership/security choices (locked during planning):

- `photos` RLS mirrors `recipes`: a **direct `user_id` column** + 4 per-operation policies (`auth.uid() = user_id`) + a **drift-guard trigger** asserting `user_id` matches the parent session.
- `photos` captures **typed metadata columns**: `storage_path`, `storage_object_id`, `content_type`, `size_bytes`, `original_filename`, plus `recognized_items jsonb`.
- `Photo` persistence is a **new `PhotoRepository` port**; its read path (`listBySession`) populates the transient `photoUrl` signed URL via the shared Supabase client. `SessionPhotoStorage` keeps binary upload/remove.
- Persisted items keep the **full `RecognizedItem`** (incl. `context`).
- Client responses use a **lean projection** (`PhotoView` = `{ id, photoUrl, recognizedItems }`) so storage internals (`storage_path`, `user_id`, object id) never reach the browser.

## Critical Implementation Details

- **`photoUrl` decoder boundary.** `PhotoFromRow` decodes the DB row into the **persisted** shape `StoredPhoto` (no `photoUrl`). The read adapter then batch-generates signed URLs and assembles `Photo = StoredPhoto + photoUrl`, validated against the `Photo` schema. Do not try to pipe a URL-less row into the full `Photo` schema — `photoUrl` is required there and absent from the row.
- **No re-fetch after recognition.** `recognizeProducts` reads photos once via `listBySession` (which carries `photoUrl`), recognizes against `photo.photoUrl`, persists per-photo items via `updateRecognizedItems`, then builds the response photos in-memory by zipping the already-URL'd photos with the items just produced — avoiding a second signed-URL round trip.
- **jsonb round-trips as parsed JS.** supabase-js returns `jsonb` columns already parsed (arrays/objects), and accepts JS arrays on write — no `JSON.parse`/`stringify` at the call site. The `…FromRow` `.pipe(Model)` re-validates the array against `RecognizedItem`, so a drifted row fails at the boundary.
- **Signed-URL TTL.** Reuse the existing 30-min TTL (`PREVIEW_URL_TTL_SECONDS`) for `photoUrl`; it must outlast a review session but is intentionally short-lived.

---

## Phase 1: DB Migration & Schema Truth

### Overview

Create the `photos` table with RLS, reshape `recipe_sessions`, reset the local DB, and regenerate types. No application code changes here — this phase establishes the new schema as ground truth.

### Changes Required:

#### 1. New migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_photos_table_and_json_items.sql` (new)

**Intent**: Normalize photo storage into a child table and retype the item columns to JSON. Intentionally destructive — full reset, no data preservation. Header comment must state it overrides the additive-only convention by change-brief authorization.

**Contract**:

- `create table public.photos` with columns: `id uuid pk default gen_random_uuid()`; `session_id uuid not null references public.recipe_sessions(id) on delete cascade`; `user_id uuid not null references auth.users(id) on delete cascade`; `storage_path text not null`; `storage_object_id text`; `content_type text`; `size_bytes bigint`; `original_filename text`; `recognized_items jsonb`; `created_at timestamptz not null default now()`; `updated_at timestamptz not null default now()`.
- Indexes: `(session_id)` and `(user_id)`.
- `alter table public.photos enable row level security` + 4 policies (`select`/`insert`/`update`/`delete`) for `authenticated`, each keyed on `auth.uid() = user_id` (insert/update via `with check`, mirroring `recipes_*` policies).
- Drift-guard: a `photos_assert_user_id_matches_session()` trigger function + `before insert or update` trigger, copied from `recipes_assert_user_id_matches_session`.
- `updated_at` trigger reusing the existing `public.set_updated_at()` function.
- `recipe_sessions` reshape: `drop column photo_paths`; drop `recognized_items_md` + add `recognized_items jsonb`; drop `corrected_items_md` + add `corrected_items jsonb`; `drop constraint` for the two md-length checks and the `photo_paths_length` check.

> The bucket `session-photos` and its storage RLS policies already exist (migration `20260530100000`) and are unchanged — the path convention `{user_id}/{session_id}/{uuid}.{ext}` continues to back storage RLS.

#### 2. Reset + regenerate types

**File**: `src/lib/infrastructure/db/types/generated.ts` (regenerated artifact)

**Intent**: Apply the migration to the local stack and regenerate DB types so the new `photos` table + reshaped `recipe_sessions` are reflected.

**Contract**: Run `pnpm exec supabase db reset` (or `mise run db-start` first if the stack is down), then `pnpm db:types`. After this, `generated.ts` has a `photos` table type and `recipe_sessions` no longer has `photo_paths`/`*_md` columns.

### Success Criteria:

#### Automated Verification:

- `pnpm exec supabase db reset` applies all migrations with no error.
- `pnpm db:types` regenerates `generated.ts` and a `photos` table appears in it; `photo_paths` no longer appears.

#### Manual Verification:

- With two users (A, B), inserting a `photos` row as A and selecting as B returns zero rows (RLS isolation).
- Inserting a `photos` row whose `user_id` differs from its session's `user_id` raises the drift-guard exception.
- `recipe_sessions` rows can be created/updated with `recognized_items`/`corrected_items` set to a JSON array.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation of the RLS/drift-guard checks before proceeding.

---

## Phase 2: Domain Model & Boundary Contracts

### Overview

Reshape the domain model and the boundary contracts. This is the source-of-truth layer the adapters/UC/client will conform to. Expect downstream type errors until Phases 3–5 land.

### Changes Required:

#### 1. Recipe domain model

**File**: `src/lib/core/model/recipe/index.ts`

**Intent**: Reshape `RecipeSession` to the normalized model and introduce the `Photo` aggregate-member models. Update `RecognizedItem`'s doc to reflect that `context` is now persisted with the new judgment semantics.

**Contract**:

- `RecipeSession`: remove `photoPaths`; replace `recognizedItemsMd: z.string().nullable()` with `recognizedItems: z.array(RecognizedItem).nullable()`; replace `correctedItemsMd` with `correctedItems: z.array(RecognizedItem).nullable()`. Keep `id`, `userId`, `mealContext`, `state`, `createdAt`, `updatedAt`.
- Add `PhotoId = z.uuid()` (+ type).
- Add `StoredPhoto` (persisted shape): `{ id: PhotoId, sessionId: RecipeSessionId, userId: UserId, storagePath: z.string(), storageObjectId: z.string().nullable(), contentType: z.string().nullable(), sizeBytes: z.number().nullable(), originalFilename: z.string().nullable(), recognizedItems: z.array(RecognizedItem).nullable(), createdAt: z.string(), updatedAt: z.string() }` (+ type).
- Add `Photo = StoredPhoto.extend({ photoUrl: z.string() })` (+ type) — the fetched shape carrying the transient signed URL.
- `RecognizedItem`: keep `{ name, quantity, context }`; rewrite the `context` comment — per-photo it holds the recognition judgment, on the merged list it holds the consolidation judgment; it **is** persisted now.

> Follow the same-name zod convention (`zod.md`): each `const` + `type` shares its name. `StoredPhoto`/`Photo` use the base-schema-then-`.extend()` exception (only the final exported pair must match names).

#### 2. Ports + write payloads

**File**: `src/lib/core/boundry/recipe/ports.ts`

**Intent**: Update the session update payload, add the `PhotoRepository` port + its create payload, and widen `SessionPhotoStorage.upload`'s return so the UC can persist storage metadata.

**Contract**:

- `RecipeSessionUpdatePayload`: re-derive as `RecipeSession.pick({ correctedItems, mealContext, recognizedItems, state }).partial()` (drop `photoPaths`, rename md fields).
- `StoredObject` (new payload type, returned by storage upload): `{ path: string, objectId: string | null, fullPath: string }`. Change `SessionPhotoStorage.upload` to return `Effect.Effect<StoredObject, SnapchefServerError>`.
- `PhotoCreatePayload` (new): `StoredPhoto.pick({ sessionId, userId, storagePath, storageObjectId, contentType, sizeBytes, originalFilename })` (recognizedItems omitted — null at creation).
- New `PhotoRepository` interface:
  - `create(payload: PhotoCreatePayload): Effect.Effect<StoredPhoto, SnapchefServerError>`
  - `listBySession(userId: UserId, sessionId: string): Effect.Effect<Photo[], SnapchefServerError>` — **populates `photoUrl`**.
  - `updateRecognizedItems(userId: UserId, photoId: string, items: RecognizedItem[]): Effect.Effect<StoredPhoto, SnapchefServerError>`
  - `deleteBySession(userId: UserId, sessionId: string): Effect.Effect<void, SnapchefServerError>`
- Keep `RecipeSessionRepository` and `ProductRecognizer` unchanged.

#### 3. Driving-side response contracts

**File**: `src/lib/core/boundry/recipe/responses.ts` (new)

**Intent**: Define the client-facing response schema for recognition — a lean projection that excludes storage internals.

**Contract**:

- `PhotoView = z.object({ id: PhotoId, photoUrl: z.string(), recognizedItems: z.array(RecognizedItem).nullable() })` (+ type).
- `RecognitionResult = z.object({ session: RecipeSession, photos: z.array(PhotoView) })` (+ type).

#### 4. Boundary barrel

**File**: `src/lib/core/boundry/recipe/index.ts`

**Intent**: Re-export the new `responses.ts` alongside existing `dto`/`ports`.

**Contract**: Add `export * from "./responses";` (pure barrel — keep it a re-export only).

### Success Criteria:

#### Automated Verification:

- `pnpm exec tsc --noEmit` reports errors **only** in known downstream consumers (adapters, UC, routes, client) — the model/boundary files themselves type-check internally. (Full green is deferred to Phase 5.)

#### Manual Verification:

- The new schemas read correctly: `Photo` = `StoredPhoto` + `photoUrl`; `RecipeSessionUpdatePayload` no longer references `photoPaths`/md fields; `RecognitionResult` projects only `{ id, photoUrl, recognizedItems }` per photo.

---

## Phase 3: Infrastructure Adapters

### Overview

Implement the `PhotoRepository` adapter (including signed-URL population), widen `SessionPhotoStorage.upload`, update the session update mapping, and bridge the new rows with `…FromRow` decoders + row zod schemas. Wire the new adapter into DI.

### Changes Required:

#### 1. Row zod schemas + generated type aliases

**File**: `src/lib/infrastructure/db/types/index.ts`

**Intent**: Reshape `RecipeSessionRow` and add a `PhotoRow` to match the new schema; export the generated `photos` table aliases.

**Contract**:

- `RecipeSessionRow` zod: drop `photo_paths`; replace `recognized_items_md`/`corrected_items_md` with `recognized_items`/`corrected_items` typed `z.array(RecognizedItem).nullable()` (import `RecognizedItem` from `core/model/recipe` — infra→core/model is permitted).
- Add `PhotoRow` zod matching the `photos` row (snake_case columns from Phase 1; `recognized_items: z.array(RecognizedItem).nullable()`).
- Add generated aliases: `PhotoRow`/`PhotoInsert`/`PhotoUpdate` from `Database["public"]["Tables"]["photos"]`.

#### 2. Row→model converters

**File**: `src/lib/infrastructure/db/types/converters.ts`

**Intent**: Update `RecipeSessionFromRow` for the new columns; add `PhotoFromRow` decoding to the **persisted** `StoredPhoto` (no `photoUrl`).

**Contract**:

- `RecipeSessionFromRow`: map `recognized_items`→`recognizedItems`, `corrected_items`→`correctedItems`; drop `photoPaths`; `.pipe(RecipeSession)`.
- `PhotoFromRow`: `PhotoRow.transform(row => …camelCase…).pipe(StoredPhoto)`.

#### 3. PhotoRepository adapter

**File**: `src/lib/infrastructure/db/PhotoRepository.ts` (new, PascalCase after the port)

**Intent**: Implement `PhotoRepository`. Reads populate `photoUrl` by batch-generating signed URLs from the shared Supabase storage client; writes go to the `photos` table.

**Contract**: `createPhotoRepository(supabase): PhotoRepository` (explicit return-type anchor), curried methods lifted via the shared `tryError…` helpers + `decodeWith`:

- `create` → insert `PhotoCreatePayload` (camelCase→snake_case), `select().single()`, decode `PhotoFromRow`.
- `listBySession` → select `photos` by `user_id` + `session_id` ordered by `created_at`; decode each via `PhotoFromRow` → `StoredPhoto[]`; call `supabase.storage.from("session-photos").createSignedUrls(paths, PREVIEW_URL_TTL_SECONDS)`; zip URLs by path and produce `Photo[]` (validate `Photo`). A photo whose signed URL is missing should still surface (decide: empty string or skip — default to keeping the row with an empty `photoUrl` so the UI can render a fallback). Reuse the bucket/TTL constants (extract a small shared module or re-declare; do not import the storage adapter).
- `updateRecognizedItems` → update `recognized_items` for `id` + `user_id`, return decoded `StoredPhoto`.
- `deleteBySession` → delete `photos` where `session_id` + `user_id`.

> The signed-URL generation here is the literal realization of "Photo.photoUrl populated during fetching from the infrastructure layer."

#### 4. SessionPhotoStorage upload return

**File**: `src/lib/infrastructure/db/SessionPhotoStorage.ts`

**Intent**: Return the full storage metadata instead of just the path, so the UC can persist `storage_path` + `storage_object_id`.

**Contract**: `upload` maps the Supabase `{ id, path, fullPath }` result to `StoredObject` (`{ path, objectId: id, fullPath }`). `createPreviewUrls`/`remove` unchanged.

#### 5. RecipeSessionRepository update mapping

**File**: `src/lib/infrastructure/db/RecipeSessionRepository.ts`

**Intent**: Update `toRecipeSessionUpdate` for the reshaped payload (jsonb item columns, no `photo_paths`).

**Contract**: Map `correctedItems`→`corrected_items`, `recognizedItems`→`recognized_items` (JS arrays passed directly to jsonb), `meal_context`, `state`; drop the `photo_paths` entry. Keep the `value != null` filter (partial-update semantics).

#### 6. DI wiring

**File**: `src/middleware.ts`

**Intent**: Construct `PhotoRepository` and inject it into `RecipeSessionUC`.

**Contract**: Import `createPhotoRepository`; pass it as a new constructor arg to `new RecipeSessionUC(...)`. (Constructor arg order finalized in Phase 4.)

### Success Criteria:

#### Automated Verification:

- `pnpm exec tsc --noEmit` errors are now confined to `RecipeSessionUC`, the recognition route, and the client (the Phase 4–5 surfaces); adapters + converters + types type-check.
- `pnpm lint` reports no errors in the changed infra files (modulo the known cross-file type errors above).

#### Manual Verification:

- A manual insert + `listBySession` (e.g. via a scratch script or REPL against local Supabase) returns photos carrying a non-empty `photoUrl`.

---

## Phase 4: Use Case, Routes & Prompts

### Overview

Rewrite `RecipeSessionUC` for the normalized model, map the recognition route to `RecognitionResult`, and refine the LLM prompts for the new `context` semantics. After this phase the **server-side compiles green**.

### Changes Required:

#### 1. RecipeSessionUC rewrite

**File**: `src/lib/core/uc/recipe/RecipeSessionUC.ts`

**Intent**: Replace `photoPaths`-based flows with `PhotoRepository`-backed flows and persist per-photo + merged items as JSON. Inject `PhotoRepository`.

**Contract**:

- Constructor: add `private readonly photoRepository: PhotoRepository` (settle arg order; update `middleware.ts` accordingly).
- `attachPhotos(userId, sessionId, files)`:
  - fetch session → `removeExistingPhotos` (now: `listBySession` → if non-empty, `photosStorage.remove(paths)` + `photoRepository.deleteBySession`, best-effort `catchAll`) → upload each file (`StoredObject`) → `photoRepository.create` one row per file (metadata from `StoredObject` + `File.type/size/name`) → update session `state: "photos_uploaded"`. Return `RecipeSession` (response shape unchanged for upload).
- `recognizeProducts(userId, sessionId)`:
  - fetch session → `listBySession` (photos with `photoUrl`) → guard non-empty (`SnapchefBusinessRuleViolationError` "No photos to recognize") → for each photo (concurrency 5, 25 s timeout, 1 retry, failure → `[]`): `recognizePhoto(photo.photoUrl)` → `updateRecognizedItems(photo.id, items)` → keep `items` keyed by `photo.id` → `resolveItems` (all empty → `SnapchefExternalSystemError`; else `mergeItems` over non-empty flattened) → persist `recipe_sessions.recognizedItems = merged` + `state: "products_recognized"` → build `{ session, photos: photos.map(p => ({ ...p, recognizedItems: itemsById[p.id] ?? [] })) }` (a `RecipeSession` + `Photo[]` aggregate).
- Remove `serializeItemsToMarkdown` and the `photoPaths` references.
- Return type of `recognizeProducts` becomes the domain aggregate (e.g. `{ session: RecipeSession; photos: Photo[] }`); the route projects it to `RecognitionResult`.

> Preserve the existing recognition resilience policy (concurrency/timeout/retry, per-photo failure → empty, all-empty → 500) — only the data plumbing changes.

#### 2. Recognition route → RecognitionResult

**File**: `src/pages/api/recipe-sessions/[id]/recognition.ts`

**Intent**: Map the UC aggregate to the lean `RecognitionResult` view.

**Contract**: After `recognizeProducts`, `Effect.map` the aggregate to `RecognitionResult` (project each `Photo` → `PhotoView` = `{ id, photoUrl, recognizedItems }`). `upload.ts` and `index.ts` keep returning `RecipeSession` (no code change beyond the reshaped model).

#### 3. Prompt refinement

**File**: `src/lib/infrastructure/llm/prompts.ts`

**Intent**: Re-frame the `context` field so its persisted meaning is explicit — recognition judgment per photo, consolidation judgment on merge.

**Contract**: Update `RECOGNITION_SYSTEM_PROMPT` so `context` is described as the short judgment of _why/how_ this product was recognized (cues + identification reasoning); update `MERGE_SYSTEM_PROMPT` so each merged item's `context` becomes the short judgment of _why it is in the final consolidated set_ (which sources merged, dedupe rationale). No structural/message-shape change.

### Success Criteria:

#### Automated Verification:

- `pnpm exec tsc --noEmit` passes for all server code (`src/lib/**`, `src/pages/**`, `src/middleware.ts`) — only `src/components/**` may still error (Phase 5).
- `pnpm lint` passes for the server surfaces.

#### Manual Verification:

- Hitting `POST /api/recipe-sessions/:id/recognition` (via curl/REST client with a valid session) returns `{ ok: true, data: { session, photos: [{ id, photoUrl, recognizedItems }] } }` and `photos` rows in the DB now carry per-photo `recognized_items`.

---

## Phase 5: Presentation & Integration

### Overview

Update the client island to decode `RecognitionResult`, render per-photo read-only cards (signed-URL image + its recognized list), and keep the merged list as the editable textarea. After this phase the whole app is green.

### Changes Required:

#### 1. Item→text helper

**File**: `src/components/recipes/item-format.ts` (new)

**Intent**: Serialize `RecognizedItem[]` to the textarea's plain-bullet text (replacing the server-side markdown serialization).

**Contract**: `itemsToText(items: RecognizedItem[]): string` → `items.map(i => `- ${i.name} - ${i.quantity}`).join("\n")`.

#### 2. UploadStep — decode RecognitionResult

**File**: `src/components/recipes/wizard/UploadStep.tsx`

**Intent**: Recognition now returns `RecognitionResult`; pass it to `onComplete`. Create/upload still return `RecipeSession`.

**Contract**:

- `recognize`: `post(`/api/recipe-sessions/${session.id}/recognition`, {}, RecognitionResult)`; on success call `onComplete(result.data)` (the whole `RecognitionResult`).
- `onComplete` prop type → `(result: RecognitionResult) => void`.
- The `unwrap` helper for create/upload stays on `RecipeSession`.

#### 3. RecipeWizard — per-photo review + merged textarea

**File**: `src/components/recipes/wizard/RecipeWizard.tsx`

**Intent**: Render the per-photo read-only section and seed the editable textarea from the merged list.

**Contract**:

- State holds the `RecognitionResult` (photos + session). `handleComplete(result)` sets it and advances to `review`.
- Review renders: a list of photo cards — each `<img src={photo.photoUrl} … >` + a **read-only** `<ul>` of its `recognizedItems` (`name — quantity`), with a Polish empty-state ("Nie rozpoznano produktów na tym zdjęciu.") when the list is empty; **below**, the existing editable `<textarea>` seeded via `itemsToText(session.recognizedItems ?? [])`. Keep the leave-guard.
- Drop the `recognizedItemsMd` string state; the textarea value is local edit state seeded from the merged items.

> Per the components layer matrix, importing `RecognitionResult`/`PhotoView` from `core/boundry/recipe` and `RecognizedItem`/`RecipeSession` from `core/model/recipe` is permitted. Signed `photoUrl`s come from the server response — do **not** use local object URLs for the review images.

### Success Criteria:

#### Automated Verification:

- `pnpm exec tsc --noEmit` passes for the entire project.
- `pnpm lint` passes with no errors.
- `pnpm build` succeeds.

#### Manual Verification:

- Full flow on the author's data: select 1–5 photos → "Rozpoznaj produkty" → loader → review shows each photo (rendered via signed URL, not a broken image) with its read-only recognized list **and** the merged editable textarea.
- Editing the textarea works; per-photo lists are not editable.
- Re-uploading a new photo set drops the previous photos (storage + rows) before recognizing the new set.
- A photo that recognizes nothing shows the empty-state copy; if every photo fails, the recognition error + "Spróbuj ponownie" retry appears.
- Sign in as a second user — the first user's photos are not accessible.

**Implementation Note**: After automated verification passes, pause for manual confirmation of the full-flow + RLS checks before considering the change complete.

---

## Testing Strategy

### Unit Tests:

- None added (the flow has no existing unit/domain tests; S-01 verification is manual per the roadmap). If desired later, the highest-value targets are `PhotoFromRow`/`RecipeSessionFromRow` decoders and `RecipeSessionUC.recognizeProducts` item-keying — but these are out of scope here.

### Integration Tests:

- Manual end-to-end against local Supabase + the live OpenRouter recognition model (no automated integration harness exists).

### Manual Testing Steps:

1. `mise run db-start` (or `supabase start`), `pnpm exec supabase db reset`, `pnpm db:types`, `pnpm dev`.
2. Sign in; go to `/recipes/new`; select 2–3 photos (mix of overlapping products to exercise merge).
3. Submit; confirm loader, then per-photo cards (each image visibly loads via signed URL) with read-only lists + a merged editable textarea.
4. Edit the textarea — confirm it's editable and per-photo lists are not.
5. Re-select a different photo set and submit again — confirm old photos are replaced (check `photos` rows + storage bucket).
6. In the DB, confirm `photos.recognized_items` (per photo) and `recipe_sessions.recognized_items` (merged) hold `RecognizedItem[]` JSON, and `corrected_items` is null.
7. Sign in as a second user and confirm no access to the first user's photos/rows.

## Performance Considerations

- Recognition latency budget (NFR ~30 s) is unchanged: still one LLM call per photo, concurrency 5, 25 s per-photo timeout + 1 retry. The added per-photo `updateRecognizedItems` writes are cheap and run within the existing per-photo pipeline. `listBySession` adds one batch `createSignedUrls` call per recognition (and per review fetch) — negligible.
- jsonb columns are small (a handful of items); no indexing needed for MVP scale (`target_scale: small`).

## Migration Notes

- The migration is **destructive and incompatible by design** — it drops `photo_paths` and both `*_md` columns. There is no production data; the local/CI DB is fully reset (`supabase db reset`). This explicitly overrides the CLAUDE.md additive-only rule for this one change (authorized in the change brief); the migration header states so.
- A Worker rollback would **not** restore the old columns — acceptable because there is no prod data and no deployed dependency on the old shape. Deploy the Worker and the migration together (CI runs migrations on the reset DB).

## References

- Roadmap slice: `context/foundation/roadmap.md` → S-01 (`photo-upload-and-recognition`), FR-004 multi-stage recognition.
- PRD: `context/foundation/prd.md` → FR-003/FR-004 (a/b/c)/FR-005, NFR privacy.
- Original implementation (archived): `context/archive/2026-06-06-photo-upload-and-recognition/plan.md` + `plan-brief.md`.
- Ownership pattern to mirror: `supabase/migrations/20260530100000_domain_schema_and_storage.sql:108` (`recipes` drift-guard).
- Conventions: `docs/reference/conventions/{ports-and-adapters,use-cases,zod,effect,api-server,api-client}.md`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: DB Migration & Schema Truth

#### Automated

- [x] 1.1 `supabase db reset` applies all migrations with no error — 1d5173fd6
- [x] 1.2 `pnpm db:types` regenerates `generated.ts` with a `photos` table and no `photo_paths` — 1d5173fd6

#### Manual

- [x] 1.3 Two-user RLS isolation: user B cannot select user A's `photos` row — 1d5173fd6
- [x] 1.4 Drift-guard fires when `photos.user_id` ≠ session's `user_id` — 1d5173fd6
- [x] 1.5 `recipe_sessions` accepts JSON arrays in `recognized_items`/`corrected_items` — 1d5173fd6

### Phase 2: Domain Model & Boundary Contracts

#### Automated

- [x] 2.1 `tsc --noEmit` errors confined to known downstream consumers; model/boundary files internally type-check — bbbbb57c5

#### Manual

- [x] 2.2 Schemas correct: `Photo` = `StoredPhoto` + `photoUrl`; payload drops `photoPaths`/md; `RecognitionResult` projects `{ id, photoUrl, recognizedItems }` — bbbbb57c5

### Phase 3: Infrastructure Adapters

#### Automated

- [x] 3.1 `tsc --noEmit` errors confined to UC + recognition route + client; adapters/converters/types type-check — 2cc99fa62
- [x] 3.2 `pnpm lint` clean on changed infra files (modulo known cross-file type errors) — 2cc99fa62

#### Manual

- [x] 3.3 `listBySession` returns photos with a non-empty `photoUrl` — 2cc99fa62

### Phase 4: Use Case, Routes & Prompts

#### Automated

- [x] 4.1 `tsc --noEmit` passes for all server code (`src/lib/**`, `src/pages/**`, `src/middleware.ts`) — 2cc99fa62
- [x] 4.2 `pnpm lint` passes for server surfaces — 2cc99fa62

#### Manual

- [x] 4.3 `POST /recipe-sessions/:id/recognition` returns `{ ok, data: { session, photos: [{ id, photoUrl, recognizedItems }] } }`; `photos` rows carry per-photo `recognized_items` — 2cc99fa62

### Phase 5: Presentation & Integration

#### Automated

- [x] 5.1 `tsc --noEmit` passes for the entire project — c8b383dc8
- [x] 5.2 `pnpm lint` passes with no errors — c8b383dc8
- [x] 5.3 `pnpm build` succeeds — c8b383dc8

#### Manual

- [x] 5.4 Full flow: per-photo cards (images via signed URL) + read-only lists + merged editable textarea — c8b383dc8
- [x] 5.5 Textarea editable; per-photo lists not editable — c8b383dc8
- [x] 5.6 Re-upload replaces previous photos (storage + rows) — c8b383dc8
- [x] 5.7 Empty/failed recognition shows correct empty-state / retry — c8b383dc8
- [x] 5.8 Second user cannot access the first user's photos — c8b383dc8
