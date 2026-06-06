# Photo Upload & Product Recognition (S-01) — Plan Brief

> Full plan: `context/changes/photo-upload-and-recognition/plan.md`

## What & Why

The wedge feature of Snapchef: a signed-in user uploads 1–5 photos of their fridge/pantry (≤5 MB each), the system recognizes products via a multimodal LLM (OpenRouter), and the user reviews/edits an unambiguous `[name, quantity]` list — wizard steps 1–2 on `/recipes/new`. Without this slice the north-star (S-02 recipe generation) is unreachable. Covers FR-003/004/005, US-01 steps 1–3.

## Starting Point

F-01 is fully landed: private `session-photos` bucket (5 MiB, jpeg/png/webp/heic), path-prefix storage RLS, `recipe_sessions`/`recipes` tables with owner-only policies, generated types. The server Effect/zod API machinery (`runApiRoute`, error family, envelope) and the client transport/form patterns exist. There is **zero** storage and **zero** LLM code yet — S-01 is the first consumer of both. F-02 (email verification) turned out to be unimplemented.

## Desired End State

On `/recipes/new`, a user picks photos (inline errors for over-limit/wrong type), submits, watches a two-stage loader, and lands on an editable Polish product list — rename, re-quantify, delete, add manual items — ready for the S-02 hand-off ("Dalej", stubbed). Each session is a DB row with a `state` lifecycle, referenceable by id for all later steps. Whole flow ≈ 30 s with continuous feedback.

## Key Decisions Made

| Decision              | Choice                                                                                                                                                     | Why                                                                                                                                                                      | Source        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| Model                 | `gemini-3.1-flash-lite` + `gpt-5.4-mini` fallback array, env-configurable                                                                                  | Cheapest strong-vision tier with structured outputs; graceful provider outage                                                                                            | change.md     |
| Image→LLM transport   | 120 s signed URLs (user-scoped client) + `data_collection: deny`                                                                                           | No image bytes through Worker memory; RLS proves ownership; privacy NFR                                                                                                  | change.md     |
| Multi-photo pipeline  | Parallel per-photo fan-out → single LLM merge call                                                                                                         | Per-image precision + semantic dedupe; wall-clock ≈ slowest photo                                                                                                        | change.md     |
| Orchestration         | Manual Effect pipeline, **not** `@openrouter/agent` loop                                                                                                   | Zero decision points in the flow; latency, cost, testability, conventions                                                                                                | change.md     |
| F-02 gap              | Defer; session-only gating                                                                                                                                 | Keeps S-01 unblocked; acceptable at author+friends scale                                                                                                                 | Plan          |
| Upload path           | Multipart POST to our API, server validates + uploads                                                                                                      | Single transport pipeline; server-side FR-003 + `MAX_LLM_IMAGE_BYTES` enforcement (Workers can't resize — client resizes, server guarantees); small post-resize payloads | Plan + review |
| API shape             | Three endpoints: create empty session → upload photos → recognize; every response embeds `{ sessionId, state }`; upload also returns ~15 min `previewUrl`s | Uniform session object as the durable handle; retry re-runs only recognition; server-truth previews                                                                      | Plan + review |
| **Session lifecycle** | **DB row from upload + `state` column** (supersedes "in-memory until S-03")                                                                                | One referenceable session record stepping through the flow                                                                                                               | Plan          |
| Formats               | jpeg/png/webp only; iOS auto-converts HEIC; canvas resize → JPEG 1568 px                                                                                   | Zero HEIC code; every byte LLM-safe for fallback models                                                                                                                  | Plan          |
| Quantity / language   | Free-text string; Polish, fixed                                                                                                                            | LLM-natural, matches markdown storage and the persona                                                                                                                    | Plan          |
| Orphans               | Accepted MVP debt (storage + draft rows); cleanup parked                                                                                                   | main_goal: speed; centigrosze at this scale                                                                                                                              | Plan          |

## Scope

**In scope:** migration (`state` with `created` default + nullable md columns + relaxed `photo_paths`), OpenRouter env + fetch-based adapter (structured outputs), `POST /api/recipe-sessions` (create), `POST /api/recipe-sessions/[id]/upload` (multipart + previews), `POST /api/recipe-sessions/[id]/recognition` (fan-out + merge), `postFormData` transport extension, `/recipes/new` page + wizard island steps 1–2, ui-architecture/roadmap doc updates (4 edit points).

**Out of scope:** F-02, recipe generation (S-02), persistence of corrections/save (S-03), list/detail/delete (S-04), orphan cleanup, HEIC decoding, in-app camera, test-runner setup.

## Architecture / Approach

Browser: validate originals (5 MB/5 files/types) → canvas-resize to ~1568 px JPEG → create session (lazily on first submit) → multipart upload → recognition. Server: user-scoped Supabase client everywhere (RLS = authorization); upload validates the `MAX_LLM_IMAGE_BYTES` ceiling (Workers can't resize — server validates, client resizes), stores photos, returns the session object + ~15 min preview URLs; recognition loads `photo_paths` from the session row, signs URLs (120 s), fans out one structured-output LLM call per photo (`Effect.forEach`, concurrency 5, timeout + 1 retry), merges via one cheap text call (skipped for single photo), persists `recognized_items_md` + state, returns the session object + structured items. All routes are single `runApiRoute` Effect pipelines with the typed error family; the session `state` machine (`created → photos_uploaded → products_recognized → …`) gates every transition.

## Phases at a Glance

| Phase                            | What it delivers                                                                             | Key risk                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1. Session lifecycle foundation  | Migration (state machine, relaxed constraints) + types + OpenRouter env + 4-point doc update | Backward-compat of constraint relaxations (verified additive) |
| 2. Session API (create + upload) | Create-empty-session + multipart upload endpoints, previews, state transitions               | Multipart edge cases on Workers runtime                       |
| 3. Recognition API + adapter     | Fan-out/merge pipeline, persisted results                                                    | First real LLM integration; 30 s NFR; output-schema drift     |
| 4. Wizard step 1 (Upload)        | Page, shell, validation/resize/previews, loaders                                             | Canvas resize quirks across mobile browsers                   |
| 5. Wizard step 2 (Review)        | Editable list + retry/partial-failure UX                                                     | Merge quality (dedupe) only verifiable manually               |

**Prerequisites:** F-01 (done); local Supabase via Docker; an `OPENROUTER_API_KEY` for Phase 3+ manual verification.
**Estimated effort:** ~3–5 sessions across 5 phases; Phases 2–3 are the heavy ones.

## Open Risks & Assumptions

- **F-02 deferred** — roadmap listed it as an S-01 prerequisite; accounts created before it lands are unverified (accepted, needs later audit).
- **No test runner** — verification is lint/build + a manual matrix; regression safety is thin until a test slice lands.
- iOS HEIC auto-convert assumption should be verified on a real device early in Phase 4.
- LLM output quality (dedupe, quantity estimates, Polish naming) is prompt-dependent — Phase 3/5 manual checks gate it; model id is env-swappable if it underperforms.

## Success Criteria (Summary)

- US-01 steps 1–3 work end-to-end on the author's real photos: upload → recognition → editable unambiguous Polish list, ≈ 30 s with continuous feedback.
- FR-003 limits enforced server-side (not just client), with readable errors.
- A second account can see none of the first account's sessions or photos.
