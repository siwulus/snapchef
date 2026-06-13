# Photo Upload & Product Recognition (S-01) Implementation Plan

> **Revalidated 2026-06-10** against the landed code. Phase 1 + most of Phase 2 are implemented manually with a **ports-and-adapters** architecture that diverges from the original plan (which assumed `RecipeSessionUC(supabase)`). This revision treats the landed code as the canonical pattern set: remaining phases follow the hexagonal shape now in the repo. See the "Established Patterns" section — it is binding for all remaining work.

## Overview

Deliver roadmap slice S-01: a verified, signed-in user uploads 1–5 photos (≤5 MB each) on `/recipes/new`, the system recognizes products via OpenRouter (multimodal LLM), and the user reviews/edits an unambiguous `[name, quantity]` list — wizard steps 1–2 of the single-route session flow. Covers FR-003, FR-004, FR-005 and US-01 steps 1–3.

## Current State Analysis

The codebase now realizes a **hexagonal (ports-and-adapters)** layering for the `recipe` domain. This supersedes the plan's original `RecipeSessionUC(supabase: SupabaseClient)` assumption.

**Landed — Phase 1 (commit `5e1e713ea`), fully verified:**

- Migration `supabase/migrations/20260606120000_add_recipe_session_state.sql`: adds `state text NOT NULL DEFAULT 'created'` with the 5-value CHECK; DROP NOT NULL on `recognized_items_md`/`corrected_items_md`/`meal_context`; `photo_paths DEFAULT '{}'` + `cardinality <= 5`. Additive/backward-compatible.
- Generated types regenerated into `src/lib/infrastructure/db/types/generated.ts`; `types/index.ts` re-exports them plus row aliases (`RecipeSessionRow`/`Insert`/`Update`).
- All three OpenRouter env vars declared in `astro.config.mjs` (`OPENROUTER_API_KEY` secret-optional, `OPENROUTER_RECOGNITION_MODEL`, `OPENROUTER_RECOGNITION_FALLBACK_MODEL`).

**Landed — Phase 2 (commit `8f8f85a53`, "UC conventions, refactor to use services"), with the new architecture:**

- **Domain model** `src/lib/core/model/recipe/index.ts`: `RecipeSession` (camelCase entity — `id`, `userId`, `state`, `correctedItemsMd`/`mealContext`/`photoPaths`/`recognizedItemsMd`, `createdAt`/`updatedAt`), `RecipeSessionState` enum (mirrors the DB CHECK), and `Recipe`. Nullable columns are `.nullable()` (DB returns `null`, never `undefined`); `photoPaths` is non-null.
- **Boundary** `src/lib/core/boundry/recipe/`: barrel `index.ts` re-exports `dto.ts` (constants: `MAX_PHOTOS`, `MAX_PHOTO_BYTES`, `MAX_LLM_IMAGE_BYTES`, `ACCEPTED_IMAGE_TYPES`) and `ports.ts`. `ports.ts` defines the three **domain ports** + `RecipeSessionUpdatePayload` (`RecipeSession.pick({...}).partial()`) and imports `RecognizedItem`. **Note:** `RecognizedItem` is a **domain model** in `core/model/recipe`, not a boundary schema — the ports import it from there.
- **Ports** (`boundry/recipe/ports.ts`):
  - `RecipeSessionRepository` — `create(userId)`, `find(userId, sessionId): Option<RecipeSession>`, `update(userId, sessionId, RecipeSessionUpdatePayload): Option<RecipeSession>`.
  - `SessionPhotoStorage` — `upload(userId, sessionId, file): string`, `createPreviewUrls(paths): { path, previewUrl }[]` (30-min signed URLs).
  - `ProductRecognizer` — `recognizePhoto(url): RecognizedItem[]`, `mergeItems(lists: RecognizedItem[]): RecognizedItem[]` (note: `mergeItems` takes a **flat** concatenated array).
- **Use case** `src/lib/core/uc/recipe/RecipeSessionUC.ts`: `class RecipeSessionUC` constructor-injected with `(sessionRepository, photosStorage)` — **ports, not SupabaseClient**. `createSession` + `attachPhotos` implemented (missing rows raised via `Option.match` → `SnapchefNotFoundError`). **Recognition is unbuilt:** there is no `recognizeProducts` method and no `_productRecognizer` placeholder field — both were removed in the architecture refactor's UC-hygiene pass. Phase 3 _adds_ the method and a third constructor param.
- **Adapters** (functional factories, server-only) `src/lib/infrastructure/db/`: `createRecipeSessionRepository(supabase)` and `createSessionPhotoStorage(supabase)` — curried arrow functions returning the port object; map rows↔model via `decodeWith(RecipeSessionFromRow)`.
- **Shared helpers**: `src/lib/utils/effect.ts` (`decodeWith`, `tryErrorData`, `tryErrorDataOption`, `tryErrorDataWithSchema` — the Supabase `{data,error}`→Effect bridge) is the **only** `utils/` module. The row↔model decoder `RecipeSessionFromRow` (zod transform piped into `RecipeSession`) lives in `src/lib/infrastructure/db/types/converters.ts`; the markdown serializer `serializeItemsToMarkdown` lives in `src/lib/core/model/recipe/markdown.ts`. (There is no `src/lib/utils/recipe.ts`; the old `utils/index.ts` was deleted.)
- **API machinery**: `parseMultipartFiles(request, fieldName)` added to `infrastructure/api/index.ts` (validates `File[]` against the boundary constants incl. `MAX_LLM_IMAGE_BYTES` via `decodeWith`). `runApiRoute`/`parseRequestBody`/error-mapper unchanged.
- **Routes**: `POST /api/recipe-sessions` (create) and `POST /api/recipe-sessions/[id]/upload` (multipart) — thin `runApiRoute` delegates returning the domain `RecipeSession`.
- **Wiring**: `injectDependencies` in `src/middleware.ts` composes `new RecipeSessionUC(createRecipeSessionRepository(supabase), createSessionPhotoStorage(supabase))`; `App.Locals` declares `recipeSessions: RecipeSessionUC` in `src/env.d.ts`.

**Accepted deviations from the original plan (confirmed 2026-06-10, NOT remaining work):**

- Routes/UC **return the domain `RecipeSession`** — no slim `{ sessionId, state }` / `UploadResult` / `RecognitionResult` wire DTOs.
- `attachPhotos` has **no state guard** (any state accepted) — accepted.
- Upload **preview URLs are not returned to the client** — accepted; the wizard uses client-side `URL.createObjectURL`. `createPreviewUrls` is retained because recognition reuses it internally (see Phase 3).
- The upload route is **per-error typed** (superseding the earlier "collapsed 422" deviation): `validateAuthUser(user)` → `SnapchefAuthenticationError` (401), `decodeWith(RecipeSessionId)(params.id)` → `SnapchefValidationError` (400), `parseMultipartFiles` → `SnapchefParseError`/`SnapchefValidationError` (400). This matches the create route and the `api-server.md` convention.

**Not yet built:** Phase 2 re-upload replacement; all of Phase 3 (recognition); Phases 4–5 (wizard); the `use-cases.md` convention update.

**Still true from the original analysis:** middleware gates `/recipes*` pages only — `/api/**` routes check `locals.user` themselves. `request.formData()` is native on Workers. No test runner exists (verification = lint + build + `db reset`). shadcn installed: `button card form input label sonner`.

## Established Patterns (binding for all remaining work)

The landed code defines the patterns every remaining phase must follow. Treat these as the house style for this domain:

1. **Hexagonal layering.** Business logic in a `core/uc/<domain>/<Name>UC` class depends only on **domain ports** declared in `core/boundry/<domain>/ports.ts`. Adapters never enter the UC as concrete infra types — they enter as port interfaces. (This generalizes `use-cases.md`, which shows `AuthenticatorUC` taking `SupabaseClient` directly; that becomes a documented exception — see Phase 2 remaining.)
2. **Functional adapter factories.** Infrastructure implements a port as a curried arrow factory `createX(deps) => PortShape`, returning a plain object of arrow methods — not a class. Examples: `createRecipeSessionRepository`, `createSessionPhotoStorage`. The LLM recognizer follows the same shape (`createProductRecognizer`).
3. **Model ≠ DTO ≠ row.** Rich domain entity in `core/model/<domain>`; wire constants/contracts in `core/boundry/<domain>/dto.ts`; DB row aliases in `infrastructure/db/types`; the row↔model mapping is a zod transform in `utils/<domain>.ts` consumed via `decodeWith(...)`.
4. **Supabase→Effect bridge.** Wrap every Supabase call with `tryErrorData` / `tryErrorDataOption` from `utils/effect.ts` (PromiseLike returning `{data,error}`), then `decodeWith(schema)` to validate/map. `find`/`update` return `Option<T>`; the UC unwraps with `Option.match` → `Effect.fail(new SnapchefNotFoundError({...}))` on `None` (see the landed `RecipeSessionUC.fetchRecipeSession`).
5. **Thin routes.** `export const prerender = false`; one `runApiRoute(...)` pipeline; gate auth with `validateAuthUser(user)` (→ `SnapchefAuthenticationError`, 401) and validate the path id with `decodeWith(RecipeSessionId)(params.id)` (→ 400), combined via `Effect.all([...])`; delegate to `locals.recipeSessions.<method>`. Return the domain model. (See the landed `index.ts` / `upload.ts` routes.)
6. **Composition root.** `injectDependencies` in `src/middleware.ts` builds adapters and constructs the UC; `App.Locals` (`src/env.d.ts`) declares it. UC + factory + wiring + `env.d.ts` land together.

## Desired End State

A signed-in user on `/recipes/new`:

1. Picks 1–5 photos (jpeg/png/webp); oversized/over-count/wrong-type selections produce readable inline Polish errors client-side (FR-003).
2. Submits → wizard creates a session (`POST /api/recipe-sessions` → `RecipeSession` `state: 'created'`), client-resizes the photos, and uploads them (`POST /api/recipe-sessions/{id}/upload`) into `session-photos/{user_id}/{session_id}/`; the row transitions to `state = 'photos_uploaded'` and the response carries the updated `RecipeSession`.
3. Recognition runs (`POST /api/recipe-sessions/{id}/recognition`): server reads `photo_paths` from the session row, signs URLs, fans out one LLM call per photo, merges results, persists `recognized_items_md` + `state = 'products_recognized'`, and returns the updated `RecipeSession` (FR-004 — unambiguous, Polish, free-text quantity).
4. The wizard parses `recognizedItemsMd` into an editable list: change name/quantity, delete rows, add manual items (FR-005). Recognition failure shows inline error + Retry (re-runs only recognition). Partial photo failure proceeds silently with whatever succeeded.
5. Edited list stays client-side; the "Dalej" hand-off to step 3 is stubbed for S-02.

Verify: full manual flow on desktop + mobile viewport with real fridge photos completes in ~30 s (NFR), with continuous loading feedback (NFR > 2 s).

### Key Discoveries:

- Storage RLS authorizes by path prefix — the user's session-scoped client makes ownership enforcement free (`20260530100000_domain_schema_and_storage.sql:138-164`); `SessionPhotoStorage.buildPath` already follows `{user_id}/{session_id}/{uuid}.{ext}`.
- The `RecipeSessionRepository`/`SessionPhotoStorage`/`ProductRecognizer` ports already exist (`boundry/recipe/ports.ts`) — Phase 3 implements the recognizer, it does **not** define a new port.
- zod 4 (`zod@4.4.3`) provides `z.toJSONSchema()` — `RecognizedItem` (wrapped as `{ items: RecognizedItem[] }`) serves the OpenRouter `response_format`, server-side output validation (`decodeWith`), and the client editor contract.
- `serializeItemsToMarkdown` lives in `core/model/recipe/markdown.ts`; its inverse (`deserializeRecognizedItems`) is the only new shared helper the wizard needs to reconstruct an editable list from the persisted markdown.
- Recognition can reuse `SessionPhotoStorage.createPreviewUrls` (30-min signed URLs) for the LLM fetch — no separate 120-s signing path needed.
- iOS Safari auto-converts HEIC→JPEG when the file input accepts only `image/jpeg,image/png,image/webp`.

## Decision Log

Rows 1–11 from the original planning Q&A (2026-06-06) remain valid except where superseded below. LLM architecture decisions (model, signed-URL transport, fan-out+merge, **manual Effect orchestration — not the agent SDK**) are recorded in `change.md` and are binding here.

| #      | Decision                                                               | Choice                                                                                                                                                                                                                                                                                                                                                                                             |
| ------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | F-02 prerequisite gap                                                  | Defer; session-only gating for S-01                                                                                                                                                                                                                                                                                                                                                                |
| 2      | Upload path                                                            | Multipart POST to our API; server validates + uploads to Storage                                                                                                                                                                                                                                                                                                                                   |
| 4      | Session lifecycle                                                      | `recipe_sessions` row created at create; `state` column tracks progress; session id is the durable handle (supersedes ui-architecture §1.3 in-memory model)                                                                                                                                                                                                                                        |
| 5      | Image formats                                                          | Accept `jpeg/png/webp`; iOS auto-convert; canvas resize → JPEG                                                                                                                                                                                                                                                                                                                                     |
| 6      | Quantity shape                                                         | Free-text string                                                                                                                                                                                                                                                                                                                                                                                   |
| 7      | Recognition language                                                   | Polish, fixed in prompt                                                                                                                                                                                                                                                                                                                                                                            |
| 8      | Orphans                                                                | Accepted in MVP; cleanup parked                                                                                                                                                                                                                                                                                                                                                                    |
| 11     | Business-logic placement                                               | All session/recognition logic in `RecipeSessionUC` (`core/uc/recipe/`)                                                                                                                                                                                                                                                                                                                             |
| **12** | **Architecture: ports-and-adapters** (2026-06-10)                      | UC depends on `RecipeSessionRepository`/`SessionPhotoStorage`/`ProductRecognizer` ports (`boundry/recipe/ports.ts`); infra provides functional factories; **supersedes** the original `RecipeSessionUC(supabase)` shape and Decision #3's wire-DTO design                                                                                                                                          |
| **13** | **API response shape** (2026-06-10)                                    | Routes/UC return the **domain `RecipeSession`** — no slim/`UploadResult`/`RecognitionResult` DTOs (supersedes original #3 "embed `{sessionId,state}`" and #9 preview-URL response)                                                                                                                                                                                                                 |
| **14** | **Phase-2 remaining scope** (2026-06-10; partly superseded 2026-06-13) | Only **re-upload replacement** is remaining; no state guard, no client preview URLs. The "no per-error route typing" clause is **superseded** — the `hexagonal-architecture-review` refactor gave the upload route per-error typing (`validateAuthUser` 401 / `decodeWith(RecipeSessionId)` 400 / `parseMultipartFiles` 400). The `use-cases.md` task (Phase 2 #2) also **landed** in `c641e2606`. |
| **15** | **Recognition item transport** (2026-06-10)                            | Recognized items persist to `recognized_items_md`; the wizard reconstructs the editable list by parsing it (`deserializeRecognizedItems`). No `photosFailed` count in the response → no partial-failure notice in S-01                                                                                                                                                                             |

## What We're NOT Doing

- F-02 email-verification gating (own change).
- Recipe generation, meal-context input (S-02); persistence of corrected list / save flow (S-03); list/detail/delete (S-04).
- Slim wire DTOs (`UploadResult`/`RecognitionResult`/`{sessionId,state}`) — routes return the domain model (Decision #13).
- Server-truth preview URLs in the upload response, upload state guards, and per-error-type upload-route status codes — accepted as-is (Decision #14).
- A `photosFailed` count / explicit partial-failure notice in the UI (Decision #15).
- Orphan cleanup (storage or draft rows) — parked.
- HEIC decoding, in-app camera capture, drag-and-drop polish beyond the native file input.
- Streaming LLM responses; per-item confidence signaling.
- Unit-test infrastructure setup.
- Writing `corrected_items_md` — user edits stay client-side in S-01.

## Implementation Approach

Continue the vertical slice on the **established hexagonal patterns** (see "Established Patterns"). Phase 2 needs one small remaining change (re-upload replacement); the `use-cases.md` convention update already landed (`c641e2606`). Phase 3 implements the existing `ProductRecognizer` port with a `fetch`-based OpenRouter factory (chat completions + structured outputs, fan-out+merge orchestrated in the UC), extends the UC constructor + middleware to inject it, and wires the recognition route. Phases 4–5 build the wizard island consuming the three endpoints, parsing `recognizedItemsMd` into an editable list, with a `postFormData` transport extension.

## Critical Implementation Details

- **Ports, not infra types, enter the UC.** The `ProductRecognizer` capability is injected as the existing port; `core/uc/recipe` must never import `infrastructure/llm`. The recognizer factory is constructed in middleware and passed to the UC constructor (replacing the current `_productRecognizer` placeholder).
- **Ownership chain.** Every Supabase call uses the session-scoped client from `createClient(headers, cookies)` — never service-role. RLS is the authorization layer; routes add only the `locals.user` presence check.
- **Single signed-URL lifetime.** Recognition reuses `SessionPhotoStorage.createPreviewUrls` (30-min signed URLs) to feed the LLM. This collapses the original two-TTL (120 s + 15 min) design into one lifetime — acceptable given the private bucket + `provider.data_collection: "deny"`.
- **30 s budget.** Per-photo LLM call gets `Effect.timeout` (~25 s) + `Effect.retry({ times: 1 })`; fan-out is concurrent (`Effect.forEach(urls, this.recognizer.recognizePhoto, { concurrency: 5 })`); per-photo failure resolves to an empty list (catch) so one bad photo never fails the batch; **all photos failed → `SnapchefExternalSystemError`** (500). Merge call (~5 s) is **skipped when only one photo produced items**.
- **Markdown is the canonical item store.** `recognized_items_md` holds `- {name} — {quantity}` per line via `serializeItemsToMarkdown` (`core/model/recipe/markdown.ts`). The wizard reconstructs items with the inverse `deserializeRecognizedItems` (new, added to that same module). No structured items field on the wire.
- **Model output failures are external, not validation.** Schema-mismatched LLM output → `SnapchefExternalSystemError` (with `cause`), never `SnapchefValidationError`.

## Phase 1: Session Lifecycle Foundation — ✅ LANDED (`5e1e713ea`)

Migration, regenerated types, OpenRouter env vars all landed and verified. No remaining work. (Architecture-doc edits from the original Phase 1 #4 are folded into the `use-cases.md` update in Phase 2 remaining and the roadmap bookkeeping in Phase 5.)

---

## Phase 2: Session API (Create + Upload) — 🟡 MOSTLY LANDED

Create + upload routes, `RecipeSessionUC.createSession`/`attachPhotos`, both DB adapters, `parseMultipartFiles`, middleware/`App.Locals` wiring — all landed (`8f8f85a53`). Remaining work below.

### Changes Required:

#### 1. Re-upload replacement (best-effort)

**File**: `src/lib/core/uc/recipe/RecipeSessionUC.ts`, `src/lib/infrastructure/db/SessionPhotoStorage.ts`, `src/lib/core/boundry/recipe/ports.ts`

**Intent**: When photos are uploaded to a session that already has `photo_paths`, replace them rather than accumulate orphans. Honors Decision #8 (orphans accepted) by reducing — not eliminating — leftovers.

**Contract**: Add `remove(paths: string[]): Effect.Effect<void, SnapchefServerError>` to the `SessionPhotoStorage` port and implement it in `createSessionPhotoStorage` (wrap `supabase.storage.from(STORAGE_BUCKET).remove(paths)` with `tryErrorData`). In `attachPhotos`, before uploading the new files, read the session's existing `photoPaths` and, when non-empty, call `remove` best-effort (`Effect.catchAll(() => Effect.void)` — a failed cleanup must not fail the upload). Then proceed with the existing upload→update flow. No new error class needed (the existing `SnapchefServerError` union covers it).

#### 2. `use-cases.md` convention update — ✅ LANDED (`c641e2606`)

**File**: `docs/reference/conventions/use-cases.md`

`use-cases.md` already documents the ports-and-adapters shape as the **preferred** UC dependency pattern (the "Inject dependencies through the constructor — prefer ports" rule), with `RecipeSessionUC` + `createRecipeSessionRepository`/`createSessionPhotoStorage` as the canonical example. **Important correction:** `AuthenticatorUC` was **migrated to the `Authenticator` port** (`core/boundry/auth/ports.ts`, commit `77bffdd08`) — it is _not_ kept as a `SupabaseClient` exception; the doc records this. No further edit is required.

### Success Criteria:

#### Automated Verification:

- `pnpm lint` and `pnpm build` pass.

#### Manual Verification:

- Re-uploading to a session that already has photos replaces the files: old objects gone (or best-effort gone) under `{user_id}/{sessionId}/`, `photo_paths` reflects only the new set.
- `use-cases.md` documents the ports-and-adapters pattern — ✅ already landed (`c641e2606`); no action.

**Implementation Note**: pause for manual confirmation before Phase 3.

---

## Phase 3: Recognition — ProductRecognizer Adapter + UC Orchestration

### Overview

Implement the existing `ProductRecognizer` port with a `fetch`-based OpenRouter factory, fill in `RecipeSessionUC.recognizeProducts`, extend the UC constructor + middleware to inject the recognizer, and add the thin recognition route.

### Changes Required:

#### 1. OpenRouter recognizer factory

**File**: `src/lib/infrastructure/llm/openrouter.ts` (new)

**Intent**: Implement `ProductRecognizer` over a minimal typed chat-completions `fetch` client (no `@openrouter/agent` loop — change.md decision #4), with structured outputs and model fallback. Follows the functional-factory pattern (Established Pattern #2).

**Contract**: `export const createProductRecognizer = (): ProductRecognizer` returning `{ recognizePhoto, mergeItems }`. Reads `OPENROUTER_API_KEY` / `OPENROUTER_RECOGNITION_MODEL` / `OPENROUTER_RECOGNITION_FALLBACK_MODEL` from `astro:env/server`. Internal `completeStructured<S extends z.ZodType>({ messages, schema, schemaName }): Effect.Effect<z.output<S>, SnapchefExternalSystemError>` wraps the POST to `https://openrouter.ai/api/v1/chat/completions` with `tryErrorData`-style handling and `decodeWith(schema)` on the model output. Request body:

```jsonc
{
  "models": ["<RECOGNITION_MODEL>", "<RECOGNITION_FALLBACK_MODEL>"],
  "messages": [...],
  "response_format": { "type": "json_schema", "json_schema": { "name": "...", "strict": true, "schema": /* z.toJSONSchema(...) */ } },
  "provider": { "data_collection": "deny" }
}
```

Both port methods target a `{ items: RecognizedItem[] }` schema (`RecognizedItem` from `@/lib/core/model/recipe`). Missing `OPENROUTER_API_KEY` → methods fail soft with `SnapchefExternalSystemError` (500) at call time (mirrors `createClient` returning null, but resolved per-call so middleware can construct unconditionally). Non-2xx / non-JSON / schema-mismatch → `SnapchefExternalSystemError` with `cause`.

#### 2. Recognition prompts

**File**: `src/lib/infrastructure/llm/prompts.ts` (new)

**Intent**: Two prompt builders kept beside the adapter (the port is domain-shaped; prompt wiring is an adapter detail). Per-photo recognition: Polish, food/kitchen products only, one product per item, commit to the most likely identification (FR-004 — never "cytryna lub limonka"), free-text estimated quantity, empty list when nothing recognizable. Merge: given the concatenated item list, dedupe semantically across photos/phrasings, sum quantities sensibly, re-enforce one entry per product.

**Contract**: Each builder returns the `messages` array `completeStructured` consumes; per-photo recognition embeds the signed URL as an `image_url` content part.

#### 3. UC orchestration + constructor/middleware extension

**File**: `src/lib/core/uc/recipe/RecipeSessionUC.ts`, `src/middleware.ts`

**Intent**: Add `recognizeProducts` (the fan-out+merge pipeline) to the UC and add `productRecognizer` as a real constructor dependency. (No stub or `_productRecognizer` placeholder exists — see Current State Analysis; the UC currently takes two ports.)

**Contract**: Constructor becomes `(sessionRepository, photosStorage, productRecognizer: ProductRecognizer)` — **add** the third param (nothing to remove; the current constructor is two-arg). Middleware passes `createProductRecognizer()` as the third arg. `recognizeProducts(userId, sessionId): Effect.Effect<RecipeSession, SnapchefServerError>`:

- `fetchRecipeSession(userId, sessionId)` (reuse the existing private helper → `Option.match` None → `SnapchefNotFoundError`).
- Guard: `photoPaths` non-empty, else `SnapchefBusinessRuleViolationError` (422, "no photos to recognize"). (Retry-safe: any state with photos may re-run.)
- `photosStorage.createPreviewUrls(session.photoPaths)` → signed URLs.
- `Effect.forEach(urls, (u) => this.productRecognizer.recognizePhoto(u).pipe(Effect.timeout(...), Effect.retry({ times: 1 }), Effect.catchAll(() => Effect.succeed([]))), { concurrency: 5 })` → `RecognizedItem[][]`.
- If every list is empty → `SnapchefExternalSystemError`. Else flatten; if more than one non-empty list, `this.productRecognizer.mergeItems(flat)`, otherwise use the single list.
- `sessionRepository.update(userId, sessionId, { recognizedItemsMd: serializeItemsToMarkdown(items), state: "products_recognized" })` → unwrap Option via `Option.match` → `SnapchefNotFoundError` on `None` → succeed the updated `RecipeSession`.

#### 4. Recognition route

**File**: `src/pages/api/recipe-sessions/[id]/recognition.ts` (new)

**Intent**: Boundary only — thin delegate matching the create/upload route shape (Established Pattern #5).

**Contract**: `export const prerender = false`; `runApiRoute` pipeline: `Effect.all([validateAuthUser(user), decodeWith(RecipeSessionId)(params.id)])` → `Effect.flatMap(([user, id]) => recipeSessions.recognizeProducts(user.id, id))`. Mirrors the landed `upload.ts`: `validateAuthUser` → `SnapchefAuthenticationError` (401), `decodeWith(RecipeSessionId)` → `SnapchefValidationError` (400).

### Success Criteria:

#### Automated Verification:

- `pnpm lint` and `pnpm build` pass.

#### Manual Verification:

- With a real `OPENROUTER_API_KEY`: recognition on a 2-photo session returns a `RecipeSession` with Polish, unambiguous `recognizedItemsMd` and `state = 'products_recognized'`; total time ≲ 30 s.
- Re-POST (retry) overwrites; a session with no photos → 422; unknown/foreign session id → 404; invalid (non-uuid) id → 400; missing API key → 500 envelope (`SnapchefExternalSystemError`).
- One unreadable photo (tiny black JPEG) still yields a 200 with the other photo's items (partial failure tolerated, no client notice).

**Implementation Note**: pause for manual confirmation before Phase 4.

---

## Phase 4: Wizard Island — Step 1 (Upload)

### Overview

`/recipes/new` page + wizard shell + upload step: client validation, canvas resize, previews (client-side object URLs), two-stage blocking loader, transport extension.

### Changes Required:

#### 1. Transport extension

**File**: `src/components/api/http.ts`, `src/components/hooks/useApiClient.ts`

**Intent**: `postFormData(url, formData, dataSchema)` — the sanctioned `fetchJson` extension for multipart.

**Contract**: Same three-stage pipeline and envelope validation as `post`; **omits** the `Content-Type` header (browser sets the multipart boundary). `useApiClient` exposes it with the same `tapError` toast decoration. Response `dataSchema` is `RecipeSession` from `@/lib/core/model/recipe` (components may import `core/model` per the layer matrix).

#### 2. Image preparation util

**File**: `src/components/recipes/image-processing.ts` (new)

**Intent**: Validate originals against the shared boundary constants (count, ≤5 MB, jpeg/png/webp) returning readable Polish error messages, then downscale each to max edge 1568 px via canvas → JPEG (~0.8 quality) `File`.

**Contract**: `validateFiles(files: File[]): string[]` and `prepareForUpload(file: File): Promise<File>`; hand-rolled (`createImageBitmap` + canvas `toBlob`), no new dependency. Imports constants from `@/lib/core/boundry/recipe`.

#### 3. Page + wizard shell + upload step

**File**: `src/pages/recipes/new.astro` (new), `src/components/recipes/wizard/RecipeWizard.tsx` (new), `src/components/recipes/wizard/UploadStep.tsx` (new)

**Intent**: Page shell on `AppLayout` mounting `<RecipeWizard client:load />` (route already in `PROTECTED_ROUTES`). The wizard owns step state (`'upload' | 'review'`), the current `RecipeSession` (updated from every API response), the item list, photo previews, and a `beforeunload` leave-guard active once files are selected. UploadStep: native multi file input (`accept="image/jpeg,image/png,image/webp"`), `URL.createObjectURL` thumbnails with per-file remove, inline validation errors, submit as one Effect pipeline (api-client.md): resize all → `post('/api/recipe-sessions')` (session created lazily on first submit) → `postFormData('/api/recipe-sessions/{id}/upload')` → `post('/api/recipe-sessions/{id}/recognition')` → parse `recognizedItemsMd` into items → advance to review. Two-stage blocking loader ("Wysyłanie zdjęć…" → "Rozpoznawanie produktów… to może potrwać do 30 s") with a lucide `Loader2`. Recognition failure → inline error + **Spróbuj ponownie** re-running only the recognition call.

**Contract**: One `Effect.runPromise` at the submit edge; React state mutations inside `Effect.sync`; envelope handled by branching on `result.ok` (SignInForm pattern). The recognition response schema is `RecipeSession`; items are derived client-side via `deserializeRecognizedItems`.

#### 4. Markdown→items deserializer

**File**: `src/lib/core/model/recipe/markdown.ts` (same module as `serializeItemsToMarkdown`)

**Intent**: Inverse of `serializeItemsToMarkdown` so the wizard can rebuild an editable list from the persisted markdown (Decision #15). Markdown serialization is a domain rule, so it lives in `core/model/**` (per `src/lib/CLAUDE.md`), not `utils/`.

**Contract**: `deserializeRecognizedItems(md: string | null): RecognizedItem[]` — parse `- {name} — {quantity}` lines, tolerate blank/`null` (→ `[]`), typed by `RecognizedItem` from `@/lib/core/model/recipe`. Pure function, no Effect.

### Success Criteria:

#### Automated Verification:

- `pnpm lint` and `pnpm build` pass.

#### Manual Verification:

- `/recipes/new` unauthenticated → redirect to signin; authenticated → upload UI renders, mobile-width single column, no horizontal scroll.
- Selecting 6 files / a 6 MB file / a PDF → inline Polish error, submit blocked; valid photos show previews; remove works.
- Submit shows the two-stage loader; killing the network mid-flight surfaces the error toast + retry; successful flow lands on the review step with a parsed item list.
- Refresh attempt with selected files triggers the leave-guard prompt.

**Implementation Note**: pause for manual confirmation before Phase 5.

---

## Phase 5: Wizard Island — Step 2 (Review List)

### Overview

The editable recognized-products list (FR-005) and slice hand-off polish.

### Changes Required:

#### 1. Review step component

**File**: `src/components/recipes/wizard/ReviewStep.tsx` (new)

**Intent**: Render the items (parsed from `recognizedItemsMd`) as editable rows — name + quantity `Input`s, per-row delete, "Dodaj produkt" appending an empty row, all in local wizard state. "Dalej" validates rows (non-empty trimmed name; drop empty added rows) and is the S-02 hand-off — rendered disabled with a "wkrótce" hint. A back action returns to upload (starts a fresh session — old one becomes an accepted orphan). No partial-failure notice (Decision #15).

**Contract**: Items state lives in `RecipeWizard` (lifted), typed by `RecognizedItem` from `@/lib/core/model/recipe`; edits do NOT call any API in S-01.

#### 2. Roadmap/parked bookkeeping

**File**: `context/foundation/roadmap.md`

**Intent**: Add the orphan-cleanup parked item ("Czyszczenie osieroconych sesji i zdjęć — accepted MVP debt, decyzja 2026-06-06") to the Parked section; update the S-01 outcome line to the persisted-session-with-`state` model and the S-03 outcome to "finalize/UPDATE of the existing row".

### Success Criteria:

#### Automated Verification:

- `pnpm lint` and `pnpm build` pass.

#### Manual Verification:

- Full E2E on desktop + mobile viewport: signin → upload 3 real fridge photos → recognition → list shows plausible Polish items → edit a name, change a quantity, delete a row, add "sól" manually — all reflected in state without page reload.
- Same-product-in-two-photos case produces one merged entry (semantic dedupe works).
- Single-photo session works (merge skipped, still correct shape).
- Whole flow ≈ 30 s with continuous feedback; a11y spot-check: inputs labeled, focus visible.

---

## Testing Strategy

No test runner exists in the repo (out of scope to add one). Strategy:

### Automated (per phase):

- `pnpm lint`, `pnpm build` (type-checked rules catch contract drift)
- `pnpm exec supabase db reset` proves migration replay (Phase 1, already verified)

### Manual Testing Steps:

1. Fresh local stack (`mise run db-start`, `pnpm dev`), sign in, walk US-01 steps 1–3 with real photos.
2. Limit matrix: 0/1/5/6 files; 4.9 MB/5.1 MB file; PDF; HEIC pick from an iPhone (should arrive as JPEG via iOS auto-convert).
3. Failure matrix: no `OPENROUTER_API_KEY` (500 + toast), network kill mid-recognition (retry works without re-upload), foreign session id (404), re-upload replaces files.
4. Privacy spot-check: second account cannot fetch the first account's session or photos.

## Performance Considerations

- Client resize (~1568 px JPEG) cuts uploads to ~0.3–0.5 MB/photo; Worker memory untouched by base64 (signed URLs to the LLM).
- Worst case inside NFR: upload (~2–4 s) + fan-out (slowest photo ≤ 25 s timeout, typical 5–10 s) + merge (~3–5 s).
- One 30-min signed-URL lifetime comfortably covers both the LLM fetch and any UI use.

## Migration Notes

Single additive migration (Phase 1, landed). Backward-compatible per the hard rule: old code never reads `state` and always writes the md columns.

## References

- Decisions: `context/changes/photo-upload-and-recognition/change.md`
- F-01 schema: `supabase/migrations/20260530100000_domain_schema_and_storage.sql`
- State migration: `supabase/migrations/20260606120000_add_recipe_session_state.sql`
- Route pattern: `src/pages/api/recipe-sessions/index.ts`, `src/pages/api/recipe-sessions/[id]/upload.ts`
- UC + ports pattern: `src/lib/core/uc/recipe/RecipeSessionUC.ts`, `src/lib/core/boundry/recipe/ports.ts`, `docs/reference/conventions/use-cases.md`
- Adapter factories: `src/lib/infrastructure/db/RecipeSessionRepository.ts`, `src/lib/infrastructure/db/SessionPhotoStorage.ts`
- Effect/Supabase bridge: `src/lib/utils/effect.ts`; row↔model map: `src/lib/infrastructure/db/types/converters.ts`; markdown serializer: `src/lib/core/model/recipe/markdown.ts`
- Form/transport pattern: `src/components/auth/SignInForm.tsx`, `src/components/api/http.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Session Lifecycle Foundation — ✅ landed

#### Automated

- [x] 1.1 Migration applies cleanly: `pnpm exec supabase db reset` — 5e1e713ea
- [x] 1.2 Types regenerate: `pnpm db:types` — 5e1e713ea
- [x] 1.3 Build passes with new env schema: `pnpm build` — 5e1e713ea
- [x] 1.4 Lint passes: `pnpm lint` — 5e1e713ea

#### Manual

- [x] 1.5 Minimal row insert (defaults) succeeds with NULL md columns + empty photo_paths; invalid `state` / >5 paths rejected by CHECKs — 5e1e713ea

### Phase 2: Session API (Create + Upload) — 🟡 mostly landed

#### Landed (accepted as-is)

- [x] 2.0 Create + upload routes, UC `createSession`/`attachPhotos`, repo + storage factories, `parseMultipartFiles`, middleware/`App.Locals` wiring — 8f8f85a53

#### Remaining — Automated

- [x] 2.1 `pnpm lint` and `pnpm build` pass

#### Remaining — Manual

- [ ] 2.2 Re-upload replaces prior files; `photo_paths` reflects only the new set
- [x] 2.3 `use-cases.md` documents the ports-and-adapters pattern; conventions README updated — c641e2606

### Phase 3: Recognition — ProductRecognizer Adapter + UC Orchestration

#### Automated

- [ ] 3.1 `pnpm lint` and `pnpm build` pass

#### Manual

- [ ] 3.2 2-photo session → Polish unambiguous `recognizedItemsMd`, state persisted, ≲ 30 s
- [ ] 3.3 Retry overwrites; no-photos session → 422; unknown/foreign id → 404; invalid id → 400; missing key → 500
- [ ] 3.4 One unreadable photo → 200 with the other photo's items (partial failure tolerated)

### Phase 4: Wizard Island — Step 1 (Upload)

#### Automated

- [ ] 4.1 `pnpm lint` and `pnpm build` pass

#### Manual

- [ ] 4.2 Auth redirect works; upload UI mobile-clean
- [ ] 4.3 Validation matrix inline errors; previews + remove work
- [ ] 4.4 Two-stage loader; mid-flight failure → error + recognition-only retry; success lands on review with parsed items
- [ ] 4.5 Leave-guard fires with unsaved selection

### Phase 5: Wizard Island — Step 2 (Review List)

#### Automated

- [ ] 5.1 `pnpm lint` and `pnpm build` pass

#### Manual

- [ ] 5.2 Full E2E with real photos: edit/delete/add all work in-place
- [ ] 5.3 Cross-photo dedupe produces one entry; single-photo session correct
- [ ] 5.4 ~30 s flow with continuous feedback; a11y spot-check passes
