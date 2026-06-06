# Photo Upload & Product Recognition (S-01) Implementation Plan

## Overview

Deliver roadmap slice S-01: a verified, signed-in user uploads 1–5 photos (≤5 MB each) on `/recipes/new`, the system recognizes products via OpenRouter (multimodal LLM), and the user reviews/edits an unambiguous `[name, quantity]` list — wizard steps 1–2 of the single-route session flow. Covers FR-003, FR-004, FR-005 and US-01 steps 1–3.

## Current State Analysis

- **F-01 landed** (`supabase/migrations/20260530100000_domain_schema_and_storage.sql`): tables `recipe_sessions` / `recipes` with owner-only RLS; private bucket `session-photos` (5 MiB limit, `image/jpeg|png|webp|heic`); storage RLS keyed on first path segment = `auth.uid()`; path convention `{user_id}/{session_id}/{uuid}.{ext}`. Generated types in `src/lib/infrastructure/db/types/index.ts`.
- **F-02 NOT implemented** — decision: **deferred**; S-01 gates on session only (existing middleware already protects `/recipes*`). F-02 remains its own change.
- **Server API machinery ready**: `runApiRoute`, `parseRequestBody`, `decodeWith`, `ERROR_STATUS`, ts-pattern error mapper (`src/lib/infrastructure/api/index.ts`); `ServerSnapchefError` family (`src/lib/core/model/error/index.ts`). Established route pattern: `src/pages/api/auth/signin.ts`.
- **Client transport JSON-only**: `src/components/api/http.ts` (`post/get/putJson/delete_` over `fetchJson`); `useApiClient` / `useZodForm` hooks; form pattern in `src/components/auth/SignInForm.tsx`; sonner wired in both layouts.
- **Zero storage and zero LLM code exists.** `@openrouter/agent@0.7.1` installed but unused; no OpenRouter env vars declared.
- **No test runner configured** — automated verification is lint + build + migration apply.
- Pages: `/recipes/index.astro` exists (placeholder); `/recipes/new` does not. shadcn installed: `button card form input label sonner`.

## Desired End State

A signed-in user on `/recipes/new`:

1. Picks 1–5 photos (jpeg/png/webp); oversized/over-count/wrong-type selections produce readable inline errors (FR-003).
2. Submits → the wizard creates a session (`POST /api/recipe-sessions` → `{ sessionId, state: 'created' }`), client-resizes the photos, and uploads them (`POST /api/recipe-sessions/{id}/upload`) into `session-photos/{user_id}/{session_id}/`; the row transitions to `state = 'photos_uploaded'` and the response carries the session object plus ~15 min signed `previewUrl`s for server-truth previews.
3. Recognition runs (`POST /api/recipe-sessions/{id}/recognition`): server reads `photo_paths` from the session row, fans out one LLM call per photo over short-lived signed URLs, merges results, persists `recognized_items_md` + `state = 'products_recognized'`, returns the session object + structured item list (FR-004 — unambiguous, Polish, free-text quantity).
4. User edits the list: change name/quantity, delete rows, add manual items (FR-005). Recognition failure shows inline error + Retry (re-runs only recognition). Partial failure (some photos unreadable) proceeds with a notice.
5. Session list state stays client-side; the wizard's "Dalej" hand-off to step 3 is stubbed for S-02.

Verify: full manual flow on desktop + mobile viewport with real fridge photos completes in ~30 s (NFR), with continuous loading feedback (NFR > 2 s).

### Key Discoveries:

- Storage RLS authorizes by path prefix — uploading with the **user's session-scoped client** makes ownership enforcement free (`20260530100000_domain_schema_and_storage.sql:138-164`).
- `recipe_sessions.id` can be supplied at insert (uuid PK, no FK dependency), so storage paths and the session row share one client-generated... server-generated `sessionId` (`crypto.randomUUID()` in the route).
- Middleware protects `/recipes*` pages only (`src/middleware.ts`); `/api/**` routes must check `context.locals.user` themselves → fail `BusinessRuleError UNAUTHORIZED`.
- `request.formData()` is native on Cloudflare Workers — no multipart library needed.
- `ValidationError` carries `error: z.ZodError` → validating the uploaded `File[]` **with a zod schema** (via `decodeWith`) yields proper 400s with `fieldErrors` for free.
- zod 4 (`zod@4.4.3`) provides `z.toJSONSchema()` — one schema serves OpenRouter `response_format`, server-side output validation, and the client contract.
- iOS Safari auto-converts HEIC→JPEG when the file input accepts only `image/jpeg,image/png,image/webp` — no HEIC code needed.

## Decision Log (from planning Q&A, 2026-06-06)

| #   | Decision                                                                          | Choice                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | F-02 prerequisite gap                                                             | Defer; session-only gating for S-01                                                                                                                                                                          |
| 2   | Upload path                                                                       | Multipart POST to our API; server validates + uploads to Storage                                                                                                                                             |
| 3   | API shape                                                                         | Three endpoints under `/api/recipe-sessions`: create (empty session), `[id]/upload` (photos), `[id]/recognition`; every response embeds the session object `{ sessionId, state }` (plan-review F1/F2)        |
| 4   | **Session lifecycle (supersedes ui-architecture.md §1.3 "in-memory, no drafts")** | `recipe_sessions` row created at upload; new `state` column tracks progress (`photos_uploaded → products_recognized → recipe_generated → saved`); session id is the referenceable handle for all later steps |
| 5   | Image formats                                                                     | Accept `jpeg/png/webp` only; rely on iOS auto-convert; canvas resize normalizes to JPEG                                                                                                                      |
| 6   | Quantity shape                                                                    | Free-text string ("2 szt", "ok. 500 g")                                                                                                                                                                      |
| 7   | Recognition language                                                              | Polish, fixed in prompt                                                                                                                                                                                      |
| 8   | Orphans (storage files + draft rows)                                              | Accepted in MVP; cleanup parked                                                                                                                                                                              |
| 9   | Photo previews                                                                    | Upload response carries ~15 min signed `previewUrl` per photo for server-truth previews (plan-review F3)                                                                                                     |
| 10  | LLM size guarantee                                                                | Client resizes; server validates a conservative `MAX_LLM_IMAGE_BYTES` ceiling and rejects — Workers cannot resize (plan-review F4, Fix A)                                                                    |

LLM architecture decisions (model, signed-URL transport, fan-out+merge, manual Effect orchestration — **not** the agent SDK) are recorded in `change.md` and are binding here.

## What We're NOT Doing

- F-02 email-verification gating (own change).
- Recipe generation, meal-context input (S-02); persistence of corrected list / save flow (S-03); list/detail/delete (S-04).
- Orphan cleanup (storage or draft rows) — parked, noted in roadmap Parked section update.
- HEIC decoding, in-app camera capture (PRD Non-Goal), drag-and-drop polish beyond the native file input.
- Streaming LLM responses; per-item confidence signaling (PRD: unambiguous list).
- Unit-test infrastructure setup (none exists in repo; out of scope for this slice).
- Writing `corrected_items_md` — user edits stay client-side in S-01; later slices decide when corrections persist.

## Implementation Approach

Vertical slice, server-first. One migration extends `recipe_sessions` for the new lifecycle. Three API routes follow the established `runApiRoute` pattern. The OpenRouter adapter is a thin `fetch`-based infrastructure module (chat completions + structured outputs) — we deliberately bypass `@openrouter/agent`'s agentic surface. The wizard is one React island with local step state; transport gains one `postFormData` helper per the sanctioned `fetchJson` extension point.

## Critical Implementation Details

- **Ownership chain**: every Supabase call (storage upload, insert, select, update, signed URLs) uses the **session-scoped client** from `createClient(headers, cookies)` — never a service-role key. RLS is the authorization layer; the route only adds the `locals.user` presence check.
- **FR-003 + LLM-size validation contract**: the 5 MB limit applies to the **original** files (clear user contract), enforced client-side for UX _and_ server-side (roadmap risk item). Client-side canvas resize is the **resize mechanism** — Cloudflare Workers have no image APIs (no canvas/sharp), so the server cannot resize; instead the upload route **guarantees** the invariant by validating each received file against `MAX_LLM_IMAGE_BYTES` (conservative ceiling, ~4 MB — below every candidate model's per-image limit) and rejecting violations with `ValidationError` (plan-review F4, Fix A).
- **Recognition idempotency / retry**: the recognition endpoint accepts sessions in `photos_uploaded` **or** `products_recognized` state (re-run overwrites `recognized_items_md`). Any other state (incl. `created` — no photos yet) → `BusinessRuleError CONFLICT`. This makes the client Retry button safe.
- **Upload idempotency**: the upload endpoint accepts states `created` | `photos_uploaded`; re-upload replaces `photo_paths` with best-effort removal of prior files. Later states → `CONFLICT`.
- **Two signed-URL lifetimes**: 120 s URLs are minted inside the recognition route for the LLM fetch only; ~15 min URLs are minted by the upload route for UI previews. Never reuse one for the other.
- **Partial failure policy**: per-photo recognition failures (after 1 retry) are tolerated when ≥1 photo succeeds — response carries `photosFailed` for the client notice. All photos failed → `ExternalSystemError` (502).
- **30 s budget**: per-photo LLM call gets `Effect.timeout` ~25 s + `Effect.retry({ times: 1 })` capped so worst-case stays under the NFR; fan-out is concurrent (`Effect.forEach(..., { concurrency: 5 })`); merge call ~5 s; merge is **skipped when only one photo produced results**.
- **Markdown serialization**: `recognized_items_md` stores one canonical format — `- {name} — {quantity}` per line — produced by a single serializer function next to the boundary schema (S-02/S-03 will reuse it).

## Phase 1: Session Lifecycle Foundation

### Overview

Schema + environment groundwork: the `state` column, relaxed NOT NULLs, regenerated types, OpenRouter env vars, and the architecture-doc update reflecting decision #4.

### Changes Required:

#### 1. Migration — session state lifecycle

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_add_recipe_session_state.sql` (new)

**Intent**: Allow a `recipe_sessions` row to exist from the moment photos are uploaded, before recognition/context/recipe exist, and track its progress.

**Contract**: Additive + backward-compatible (hard rule): add `state text NOT NULL DEFAULT 'created'` with `CHECK (state IN ('created','photos_uploaded','products_recognized','recipe_generated','saved'))`; `ALTER COLUMN recognized_items_md / corrected_items_md / meal_context DROP NOT NULL`; `ALTER COLUMN photo_paths SET DEFAULT '{}'` and replace `recipe_sessions_photo_paths_length` with `CHECK (cardinality(photo_paths) <= 5)` — more permissive → backward-compatible; an empty session row must be insertable (plan-review F1). Existing length CHECKs and RLS policies remain untouched (UPDATE policy already covers state transitions). No new table → no new RLS needed.

#### 2. Regenerated DB types

**File**: `src/lib/infrastructure/db/types/index.ts`

**Intent**: Reflect the new column/nullability. **Contract**: `npm run db:types` after `supabase db reset`; file is ESLint/Prettier-excluded.

#### 3. OpenRouter env declaration

**File**: `astro.config.mjs`

**Intent**: Server-only secrets/config for the LLM calls, per the `astro:env` hard rule.

**Contract**: Add to `env.schema`: `OPENROUTER_API_KEY` (`context: "server", access: "secret", optional: true` — fail-soft like Supabase vars), `OPENROUTER_RECOGNITION_MODEL` (server, default `"google/gemini-3.1-flash-lite"`), `OPENROUTER_RECOGNITION_FALLBACK_MODEL` (server, default `"openai/gpt-5.4-mini"`). Also add `OPENROUTER_API_KEY` to `.env` / `.dev.vars` locally (gitignored) and document in README env table if one exists.

#### 4. Architecture doc update

**File**: `context/foundation/ui-architecture.md`, `context/foundation/roadmap.md`

**Intent**: Decision #4 supersedes the in-memory-session model in **four places** (plan-review F5): ui-architecture.md §1.3 (locked decision 3 "In-memory session, no drafts"), §3a lines 72–74 ("State is in-memory… in-memory-until-S-03 model"), §6 line 163 ("wizard island holds … in-memory session state"); roadmap.md S-01 outcome line 91 ("Sesja in-memory — jeszcze nic nie zapisujemy" → session persisted progressively with a backend `state` lifecycle) and the S-03 outcome wording (save becomes finalize/UPDATE of the existing session row, not the first insert). Edits minimal and dated. Wizard UI state (current step, edited list) remains client-side; leave-guard stays (edits are still lost on refresh in S-01).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly on a fresh local stack: `npx supabase db reset`
- Types regenerate without diff noise beyond the new column: `npm run db:types`
- Build passes with new env schema: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification:

- Local insert of a minimal row (`user_id` only — `state`/`photo_paths` from defaults) succeeds with NULL md columns and empty `photo_paths`; CHECK rejects an invalid `state` value and >5 paths.

**Implementation Note**: pause for manual confirmation before Phase 2.

---

## Phase 2: Session API (Create + Upload)

### Overview

Two endpoints: `POST /api/recipe-sessions` creates an empty session and returns the session object; `POST /api/recipe-sessions/[id]/upload` receives multipart photos, validates (FR-003 + LLM ceiling), uploads to storage, transitions state, and returns the session object + preview URLs.

### Changes Required:

#### 1. Boundary schemas — recipe-session domain

**File**: `src/lib/core/boundry/recipe-session/index.ts` (new)

**Intent**: Shared contracts for all API routes and the wizard island (same-name zod convention). Every endpoint's payload embeds the session object (plan-review F2).

**Contract**: `RecipeSessionState = z.enum(['created','photos_uploaded','products_recognized','recipe_generated','saved'])` (mirrors the DB CHECK); `RecipeSession = { sessionId: z.uuid(), state: RecipeSessionState }`; `SessionPhoto = { path: string, previewUrl: z.url() }`; `UploadResult = { session: RecipeSession, photos: SessionPhoto[] }`; `RecognizedItem = { name: string (1..120, trimmed), quantity: string (1..60) }`; `RecognitionResult = { session: RecipeSession, items: RecognizedItem[], photosProcessed: number, photosFailed: number }`. Also export `serializeItemsToMarkdown(items): string` (the `- {name} — {quantity}` canonical form) and photo constraints as constants (`MAX_PHOTOS = 5`, `MAX_PHOTO_BYTES = 5 * 1024 * 1024`, `MAX_LLM_IMAGE_BYTES ≈ 4 * 1024 * 1024`, `ACCEPTED_IMAGE_TYPES`) so client and server validate from one source.

#### 2. Multipart parsing helper

**File**: `src/lib/infrastructure/api/index.ts`

**Intent**: Sibling of `parseRequestBody` for multipart routes: lift `request.formData()` into Effect and validate the extracted `File[]` with zod so failures surface as the existing 400 envelope.

**Contract**: `parseMultipartFiles(request, fieldName): Effect.Effect<File[], ServerSnapchefError>` — `formData()` failure → `ParseJsonError` (reused; message "Invalid request body"); count/size/type violations (incl. the `MAX_LLM_IMAGE_BYTES` ceiling — plan-review F4 Fix A) → `ValidationError` via `decodeWith` over a `z.custom<File>()` array schema built from the boundary constants. No new ErrorCode needed.

#### 3. Create-session route

**File**: `src/pages/api/recipe-sessions/index.ts` (new)

**Intent**: Mint the durable session handle before any photos exist.

**Contract**: `export const prerender = false`; `POST` with no body; single `runApiRoute` pipeline: `locals.user` missing → `BusinessRuleError UNAUTHORIZED` → insert empty `recipe_sessions` row (`user_id`; `state`/`photo_paths` from column defaults) → succeed `RecipeSession` (`state: 'created'`). DB failure → `ExternalSystemError`.

#### 4. Upload route

**File**: `src/pages/api/recipe-sessions/[id]/upload.ts` (new)

**Intent**: Attach validated photos to an existing session, transition its state, return server-truth previews.

**Contract**: `runApiRoute` pipeline: auth check → load session by `context.params.id` with the user client (no row → `BusinessRuleError NOT_FOUND`; RLS hides foreign rows) → state guard (`created` | `photos_uploaded`, else `CONFLICT`; re-upload replaces previous files with best-effort `storage.remove`) → `parseMultipartFiles` → `Effect.forEach(files, upload, { concurrency: 5 })` to `session-photos/{user.id}/{sessionId}/{crypto.randomUUID()}.jpg` (content-type from the file) → update row (`photo_paths`, `state: 'photos_uploaded'`) → `createSignedUrls(photo_paths, ~15 min)` for previews (plan-review F3) → succeed `UploadResult`. Storage/DB failures → `ExternalSystemError` with best-effort cleanup of just-uploaded files (orphan policy tolerates leftovers).

### Success Criteria:

#### Automated Verification:

- `npm run lint` and `npm run build` pass

#### Manual Verification:

- `POST /api/recipe-sessions` with a signed-in cookie → 200 `{ ok: true, data: { sessionId, state: 'created' } }`; empty row visible in local studio (`photo_paths = {}`).
- Upload 2 valid photos to the session → 200 with `session.state = 'photos_uploaded'` + 2 working `previewUrl`s; row + files present under `{user_id}/{sessionId}/`; re-upload replaces files.
- 6 files → 400 with field error; 6 MB file → 400; PDF → 400; no auth cookie → 401; unknown/foreign session id → 404; upload to a `products_recognized` session → 409.
- Second user cannot read the first user's storage folder or session row (RLS spot-check).

**Implementation Note**: pause for manual confirmation before Phase 3.

---

## Phase 3: Recognition API + OpenRouter Adapter

### Overview

`POST /api/recipe-sessions/[id]/recognition` — fan-out per photo over signed URLs, merge, persist, return `RecognitionResult`.

### Changes Required:

#### 1. OpenRouter infrastructure adapter

**File**: `src/lib/infrastructure/llm/openrouter.ts` (new)

**Intent**: Minimal typed chat-completions client over `fetch` (no `@openrouter/agent` agentic loop — see change.md decision #4), with structured outputs and model fallback.

**Contract**: `completeStructured<S extends z.ZodType>(params: { messages; schema: S; schemaName: string }): Effect.Effect<z.output<S>, ExternalSystemError>`. Request body to `https://openrouter.ai/api/v1/chat/completions`:

```jsonc
{
  "models": ["<OPENROUTER_RECOGNITION_MODEL>", "<OPENROUTER_RECOGNITION_FALLBACK_MODEL>"],
  "messages": [...],
  "response_format": { "type": "json_schema", "json_schema": { "name": "...", "strict": true, "schema": /* z.toJSONSchema(schema) */ } },
  "provider": { "data_collection": "deny" }
}
```

Missing `OPENROUTER_API_KEY` → fail-soft `ExternalSystemError` (mirrors the Supabase-not-configured pattern). Non-2xx, non-JSON content, or schema-mismatched model output → `ExternalSystemError` with `cause` (model output mismatch is an external failure, not client `ValidationError`).

#### 2. Recognition prompts

**File**: `src/lib/infrastructure/llm/prompts.ts` (new)

**Intent**: Two prompt builders. Per-photo recognition: Polish output, food/kitchen products only, one product per item, commit to the most likely identification (FR-004 — never alternatives like "cytryna lub limonka"), free-text estimated quantity, empty list when nothing recognizable. Merge: given N per-photo lists, dedupe semantically (same product across photos/languages/phrasings), sum quantities sensibly, re-enforce one-entry-per-product.

**Contract**: Both produce messages for `completeStructured` with the `RecognizedItems`-shaped schema (`{ items: RecognizedItem[] }`).

#### 3. Recognition route

**File**: `src/pages/api/recipe-sessions/[id]/recognition.ts` (new)

**Intent**: Orchestrate the fan-out + merge pipeline and the session state transition.

**Contract**: `runApiRoute` pipeline: auth check → load session by `context.params.id` with the user client (no row → `BusinessRuleError NOT_FOUND`; RLS makes foreign rows invisible) → state guard (`photos_uploaded` | `products_recognized`, else `CONFLICT`) → `storage.createSignedUrls(photo_paths, 120)` → `Effect.forEach(urls, recognizePhoto, { concurrency: 5 })` where each call has `Effect.timeout` + one retry and per-photo failures resolve to a sentinel rather than failing the batch → all failed → `ExternalSystemError`; else merge (skipped for a single successful photo) → update row (`recognized_items_md = serializeItemsToMarkdown(items)`, `state = 'products_recognized'`) → succeed `RecognitionResult` (embedded `RecipeSession` reflecting the new state, `items`, `photosProcessed`/`photosFailed`).

### Success Criteria:

#### Automated Verification:

- `npm run lint` and `npm run build` pass

#### Manual Verification:

- With a real `OPENROUTER_API_KEY` in `.env`: recognition on a 2-photo session returns Polish, unambiguous items with quantities; row shows markdown + `state = 'products_recognized'`; total time ≲ 30 s.
- Re-POST (retry) succeeds and overwrites; session in `created` or a future state returns 409; unknown/foreign session id returns 404; missing API key returns 502 envelope.
- One unreadable photo (e.g. upload a tiny black JPEG) → 200 with `photosFailed = 1`.

**Implementation Note**: pause for manual confirmation before Phase 4.

---

## Phase 4: Wizard Island — Step 1 (Upload)

### Overview

`/recipes/new` page + wizard shell + the upload step: client validation, canvas resize, previews, two-stage blocking loader, transport extension.

### Changes Required:

#### 1. Transport extension

**File**: `src/components/api/http.ts`

**Intent**: `postFormData(url, formData, dataSchema)` — the sanctioned `fetchJson` extension for a new content type.

**Contract**: Same three-stage pipeline and envelope validation as `post`; **omits** the `Content-Type` header (browser sets the multipart boundary). `useApiClient` (`src/components/hooks/useApiClient.ts`) exposes it with the same `tapError` toast decoration.

#### 2. Image preparation util

**File**: `src/components/recipes/image-processing.ts` (new)

**Intent**: Validate originals against the shared boundary constants (count, ≤5 MB, jpeg/png/webp) returning readable Polish error messages, then downscale each to max edge 1568 px via canvas → JPEG (~0.8 quality) `File`.

**Contract**: `validateFiles(files: File[]): string[]` (errors) and `prepareForUpload(file: File): Promise<File>`; hand-rolled (`createImageBitmap` + canvas `toBlob`), no new dependency.

#### 3. Page + wizard shell + upload step

**File**: `src/pages/recipes/new.astro` (new), `src/components/recipes/wizard/RecipeWizard.tsx` (new), `src/components/recipes/wizard/UploadStep.tsx` (new)

**Intent**: Page shell on `AppLayout` mounting `<RecipeWizard client:load />` (route already covered by `PROTECTED_ROUTES`). The wizard owns step state (`'upload' | 'review'`), the session object (`{ sessionId, state }` — updated from every API response), the item list, the photo previews, and a `beforeunload` leave-guard active once files are selected. UploadStep: native multi file input (`accept="image/jpeg,image/png,image/webp"`), thumbnail previews via `URL.createObjectURL` pre-upload (swapped to the server `previewUrl`s after upload) with per-file remove, inline validation errors, submit handler as one Effect pipeline (per api-client.md): resize all → `post('/api/recipe-sessions')` (session created lazily on first submit, not on mount — no orphan rows from bouncing visitors) → `postFormData('/api/recipe-sessions/{id}/upload')` → `post('/api/recipe-sessions/{id}/recognition')` → advance to review with items. Two-stage blocking loader ("Wysyłanie zdjęć…" covering create+upload → "Rozpoznawanie produktów… to może potrwać do 30 s") with a lucide `Loader2` spinner (NFR > 2 s feedback). Recognition failure → inline error + **Spróbuj ponownie** re-running only the recognition call (session + photos already persisted).

**Contract**: One `Effect.runPromise` at the submit edge; React state mutations inside `Effect.sync`; envelope handled by branching on `result.ok` (SignInForm pattern).

### Success Criteria:

#### Automated Verification:

- `npm run lint` and `npm run build` pass

#### Manual Verification:

- `/recipes/new` unauthenticated → redirect to signin; authenticated → upload UI renders, mobile-width single column, no horizontal scroll.
- Selecting 6 files / a 6 MB file / a PDF → inline Polish error, submit blocked; valid photos show previews; remove works.
- Submit shows the two-stage loader; killing the network mid-flight surfaces the error toast + retry; successful flow lands on the review step.
- Refresh attempt with selected files triggers the leave-guard prompt.

**Implementation Note**: pause for manual confirmation before Phase 5.

---

## Phase 5: Wizard Island — Step 2 (Review List)

### Overview

The editable recognized-products list (FR-005) and slice hand-off polish.

### Changes Required:

#### 1. Review step component

**File**: `src/components/recipes/wizard/ReviewStep.tsx` (new)

**Intent**: Render `items` as editable rows — name + quantity `Input`s, per-row delete button, "Dodaj produkt" appending an empty row, all in local wizard state. Continue button ("Dalej") validates rows (non-empty trimmed name; drop empty added rows) and is the S-02 hand-off — rendered disabled with a "wkrótce" hint in this slice. Partial-failure notice when `photosFailed > 0` ("Nie udało się przetworzyć N zdjęć — sprawdź listę i uzupełnij ręcznie"). A back action returns to upload (starts a fresh session — old one becomes an accepted orphan).

**Contract**: Items state lives in `RecipeWizard` (lifted), typed by the boundary `RecognizedItem`; edits do NOT call any API in S-01.

#### 2. Roadmap/parked bookkeeping

**File**: `context/foundation/roadmap.md`

**Intent**: Add the orphan-cleanup parked item ("Czyszczenie osieroconych sesji i zdjęć — accepted MVP debt, decyzja 2026-06-06") to the Parked section.

### Success Criteria:

#### Automated Verification:

- `npm run lint` and `npm run build` pass

#### Manual Verification:

- Full E2E on desktop + mobile viewport: signin → upload 3 real fridge photos → recognition → list shows plausible Polish items → edit a name, change a quantity, delete a row, add "sól" manually — all reflected in state without page reload.
- Same-product-in-two-photos case produces one merged entry (semantic dedupe works).
- Single-photo session works (merge skipped, still correct shape).
- Whole flow ≈ 30 s with continuous feedback; a11y spot-check: inputs labeled, focus visible.

---

## Testing Strategy

No test runner exists in the repo (out of scope to add one — see What We're NOT Doing). Strategy:

### Automated (per phase):

- `npm run lint`, `npm run build` (type-checked rules catch contract drift)
- `npx supabase db reset` proves migration replay

### Manual Testing Steps:

1. Fresh local stack (`mise run db-start`, `npm run dev`), sign in, walk US-01 steps 1–3 with real photos (fridge + pantry).
2. Limit matrix: 0/1/5/6 files; 4.9 MB/5.1 MB file; PDF; HEIC pick from an iPhone (should arrive as JPEG via iOS auto-convert — verify on a real device or BrowserStack).
3. Failure matrix: no `OPENROUTER_API_KEY` (502 + toast), network kill mid-recognition (retry works without re-upload), foreign session id (404), double-submit (idempotent re-recognition).
4. Privacy spot-check: second account cannot fetch the first account's session or photos.

## Performance Considerations

- Client resize (~1568 px JPEG) cuts uploads to ~0.3–0.5 MB/photo → multipart through the Worker is cheap; Worker memory untouched by base64 (signed URLs to the LLM).
- Worst case inside NFR: upload (~2–4 s) + fan-out (slowest photo ≤ 25 s timeout, typical 5–10 s) + merge (~3–5 s). Retry budget capped by per-call timeout so Retry UX stays responsive.
- Signed URL TTLs: 120 s comfortably covers the LLM fetch window; ~15 min preview URLs outlive the review/edit step (re-minted on re-upload).

## Migration Notes

Single additive migration (Phase 1). Backward-compatible with the previous Worker version per the hard rule: old code never reads `state` and always writes the md columns, so DROP NOT NULL + a defaulted new column break nothing on dashboard rollback.

## References

- Decisions: `context/changes/photo-upload-and-recognition/change.md`
- F-01 schema: `supabase/migrations/20260530100000_domain_schema_and_storage.sql`
- Route pattern: `src/pages/api/auth/signin.ts`
- Form pattern: `src/components/auth/SignInForm.tsx`
- Transport: `src/components/api/http.ts`
- UI architecture: `context/foundation/ui-architecture.md` (§2, §3a, §6)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Session Lifecycle Foundation

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset`
- [x] 1.2 Types regenerate: `npm run db:types`
- [x] 1.3 Build passes with new env schema: `npm run build`
- [x] 1.4 Lint passes: `npm run lint`

#### Manual

- [x] 1.5 Minimal row insert (defaults) succeeds with NULL md columns + empty photo_paths; invalid `state` / >5 paths rejected by CHECKs

### Phase 2: Session API (Create + Upload)

#### Automated

- [ ] 2.1 `npm run lint` and `npm run build` pass

#### Manual

- [ ] 2.2 Create → 200 session object `state: 'created'`, empty row in DB
- [ ] 2.3 Valid upload → 200 `state: 'photos_uploaded'` + working previewUrls; files + row correct; re-upload replaces
- [ ] 2.4 Limit violations (6 files / 6 MB / PDF) → 400; no auth → 401; unknown/foreign id → 404; wrong state → 409
- [ ] 2.5 Cross-user storage/session access denied (RLS spot-check)

### Phase 3: Recognition API + OpenRouter Adapter

#### Automated

- [ ] 3.1 `npm run lint` and `npm run build` pass

#### Manual

- [ ] 3.2 2-photo session → Polish unambiguous items, markdown + state persisted, ≲ 30 s
- [ ] 3.3 Retry overwrites; `created`/future state → 409; unknown/foreign id → 404; missing key → 502
- [ ] 3.4 One unreadable photo → 200 with `photosFailed = 1`

### Phase 4: Wizard Island — Step 1 (Upload)

#### Automated

- [ ] 4.1 `npm run lint` and `npm run build` pass

#### Manual

- [ ] 4.2 Auth redirect works; upload UI mobile-clean
- [ ] 4.3 Validation matrix inline errors; previews + remove work
- [ ] 4.4 Two-stage loader; mid-flight failure → error + recognition-only retry; success lands on review
- [ ] 4.5 Leave-guard fires with unsaved selection

### Phase 5: Wizard Island — Step 2 (Review List)

#### Automated

- [ ] 5.1 `npm run lint` and `npm run build` pass

#### Manual

- [ ] 5.2 Full E2E with real photos: edit/delete/add all work in-place
- [ ] 5.3 Cross-photo dedupe produces one entry; single-photo session correct
- [ ] 5.4 ~30 s flow with continuous feedback; a11y spot-check passes
