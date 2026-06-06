<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Photo Upload & Product Recognition (S-01)

- **Plan**: `context/changes/photo-upload-and-recognition/plan.md`
- **Mode**: Deep (user manual-review comments as primary input)
- **Date**: 2026-06-06
- **Verdict**: REVISE → **SOUND after fixes** (all 5 findings fixed in plan)
- **Findings**: 1 critical, 4 warnings, 0 observations

## Verdicts

| Dimension             | Verdict         |
| --------------------- | --------------- |
| End-State Alignment   | PASS            |
| Lean Execution        | PASS            |
| Architectural Fitness | WARNING → fixed |
| Blind Spots           | WARNING → fixed |
| Plan Completeness     | WARNING → fixed |

## Grounding

6/6 paths ✓ (`infrastructure/api/index.ts`, `components/api/http.ts`, `db/types/index.ts`, `astro.config.mjs`, `api/auth/signin.ts`, `hooks/useApiClient.ts`), 2/2 symbols ✓ (`decodeWith`, `ERROR_STATUS`), brief↔plan ✓, Progress↔Phase contract ✓. `photo_paths NOT NULL + CHECK cardinality 1–5` confirmed at `20260530100000_domain_schema_and_storage.sql:14-18`; in-memory mentions confirmed at `ui-architecture.md:29,72-74,163` and `roadmap.md:91`.

## Findings

### F1 — Create-then-upload restructure conflicts with F-01 schema constraints

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — directive settled the tradeoff; wide but mechanical edit
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 (migration), Phase 2 (routes), Phase 4 (wizard)
- **Source**: User comment #2
- **Detail**: `POST /api/recipe-sessions` creating an EMPTY session is blocked by `photo_paths NOT NULL` + `CHECK cardinality BETWEEN 1 AND 5`; planned `state` default `'photos_uploaded'` wrong for a pre-upload row.
- **Fix**: Migration adds `photo_paths DEFAULT '{}'`, replaces CHECK with `<= 5`, `state` default `'created'` (added to enum). Phase 2 split into create (`POST /api/recipe-sessions`) + upload (`POST /api/recipe-sessions/[id]/upload`, state guard `created|photos_uploaded`, re-upload replaces). Wizard chains create→upload→recognize, create fired lazily on first submit.
- **Decision**: FIXED (applied to plan)

### F2 — No uniform session object in API responses

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 boundary schemas, all route payloads
- **Source**: User comment #4
- **Detail**: Plan returned ad-hoc shapes; every endpoint should return the session object so the client always knows the session state.
- **Fix**: `RecipeSession = { sessionId, state }` (zod enum mirrors DB CHECK); create → `RecipeSession`; upload → `UploadResult { session, photos }`; recognition → `RecognitionResult { session, items, photosProcessed, photosFailed }`.
- **Decision**: FIXED (applied to plan)

### F3 — Upload response lacks preview URLs

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Blind Spots
- **Location**: Phase 2 upload route, Phase 4 UploadStep
- **Source**: User comment #5
- **Detail**: Previews rendered only from local object URLs; server-truth previews needed.
- **Fix**: Upload returns `photos: [{ path, previewUrl }]` signed ~15 min (UI TTL, distinct from the 120 s LLM URLs); wizard swaps to `previewUrl` post-upload.
- **Decision**: FIXED (applied to plan)

### F4 — "Resize on server before storage" collides with Workers' lack of image APIs

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — platform constraint; literal directive not implementable as stated
- **Dimension**: Blind Spots
- **Location**: Phase 2 upload route / Phase 4 image-processing
- **Source**: User comment #3
- **Detail**: Cloudflare Workers have no native image decode/resize (no canvas/sharp); server-side resize requires WASM (~1–2 MB bundle, CPU risk) or paid Cloudflare Images.
- **Fix A ⭐ Recommended**: Client canvas-resize remains the mechanism; server VALIDATES each file against `MAX_LLM_IMAGE_BYTES` (~4 MB conservative ceiling) and rejects with `ValidationError`. Strength: zero deps/CPU risk, server still guarantees the invariant. Tradeoff: non-browser client gets an error, not silent fixing. Confidence: HIGH. Blind spot: exact per-provider image limits unverified — ceiling kept conservative.
- **Fix B**: Server-side WASM resize (photon-rs). Strength: literal compliance. Tradeoff: bundle + CPU budget risk. Confidence: MEDIUM.
- **Decision**: FIXED via Fix A (applied to plan)

### F5 — In-memory-session language survives in two foundation docs beyond the planned edit

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Plan Completeness
- **Location**: Phase 1, doc-update change
- **Source**: User comment #1 (verified by grep)
- **Detail**: Plan updated ui-architecture §1.3 only; backend-tracked session state also invalidates ui-architecture §3a (lines 72–74) and §6 (line 163), roadmap.md S-01 outcome (line 91) and S-03 outcome wording.
- **Fix**: Phase 1 doc task enumerates all four edit points (ui-architecture §1.3 + §3a + §6; roadmap S-01 + S-03).
- **Decision**: FIXED (applied to plan)
