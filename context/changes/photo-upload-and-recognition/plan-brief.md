# Photo Upload & Product Recognition (S-01) — Plan Brief

> Full plan: `context/changes/photo-upload-and-recognition/plan.md`
> **Revalidated 2026-06-10** against landed code — Phase 1 + most of Phase 2 are implemented with a ports-and-adapters architecture; this brief reflects that reality.

## What & Why

The wedge feature of Snapchef: a signed-in user uploads 1–5 photos of their fridge/pantry (≤5 MB each), the system recognizes products via a multimodal LLM (OpenRouter), and the user reviews/edits an unambiguous `[name, quantity]` list — wizard steps 1–2 on `/recipes/new`. Without this slice the north-star (S-02 recipe generation) is unreachable. Covers FR-003/004/005, US-01 steps 1–3.

## Starting Point

Phase 1 and most of Phase 2 are **already landed**, but with a **hexagonal (ports-and-adapters)** architecture that diverges from the original plan's `RecipeSessionUC(supabase)` design. The `recipe` domain now has: a rich domain model (`core/model/recipe`), three domain ports (`core/boundry/recipe/ports.ts` — `RecipeSessionRepository`, `SessionPhotoStorage`, `ProductRecognizer`), functional adapter factories (`infrastructure/db/`), an Effect↔Supabase bridge (`utils/effect.ts`), and create + upload routes returning the domain model. Recognition (Phase 3) and the wizard (Phases 4–5) are unbuilt; `recognizeProducts` is a stub.

## Desired End State

On `/recipes/new`, a user picks photos (inline Polish errors for over-limit/wrong type), submits, watches a two-stage loader, and lands on an editable Polish product list — rename, re-quantify, delete, add manual items — ready for the S-02 hand-off ("Dalej", stubbed). Each session is a DB row with a `state` lifecycle, referenceable by id. Whole flow ≈ 30 s with continuous feedback.

## Key Decisions Made

| Decision               | Choice                                                                                               | Why                                                                        | Source     |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------- |
| Model                  | `gemini-3.1-flash-lite` + `gpt-5.4-mini` fallback, env-configurable                                  | Cheap strong-vision tier with structured outputs; graceful outage          | change.md  |
| Image→LLM transport    | 30-min signed URLs (user-scoped client) + `data_collection: deny`                                    | No bytes through Worker memory; RLS proves ownership; privacy NFR          | change.md  |
| Multi-photo pipeline   | Parallel per-photo fan-out → single LLM merge call (skipped for 1 photo)                             | Per-image precision + semantic dedupe; wall-clock ≈ slowest photo          | change.md  |
| Orchestration          | Manual Effect pipeline, **not** `@openrouter/agent`                                                  | Zero decision points; latency, cost, testability, conventions              | change.md  |
| **Architecture**       | **Ports-and-adapters**: UC depends on ports, infra provides functional factories                     | Cleaner hexagonal layering; supersedes `RecipeSessionUC(supabase)`         | Plan (#12) |
| **API response shape** | **Return the domain `RecipeSession`** — no slim/`UploadResult`/`RecognitionResult` DTOs              | Single shape, zero mapping layer (accepted field-leak tradeoff)            | Plan (#13) |
| **Phase-2 remaining**  | Only **re-upload replacement**; state guards / preview URLs / per-error route typing accepted as-is  | Minimal, focused close-out                                                 | Plan (#14) |
| **Item transport**     | Persist to `recognized_items_md`; wizard parses it (`deserializeRecognizedItems`); no `photosFailed` | Markdown is the canonical store; drops the partial-failure notice for S-01 | Plan (#15) |
| Convention doc         | Update `use-cases.md` to bless ports + factories; AuthenticatorUC kept as exception                  | Docs match reality; future agents follow the better pattern                | Plan       |
| Session lifecycle      | DB row from create + `state` column (supersedes "in-memory until S-03")                              | One referenceable session record stepping through the flow                 | Plan       |
| Formats / quantity     | jpeg/png/webp; iOS auto-converts HEIC; canvas resize → JPEG; free-text quantity; Polish              | Zero HEIC code; LLM-natural; matches markdown storage                      | Plan       |
| Orphans                | Accepted MVP debt; re-upload replacement reduces (not eliminates) leftovers                          | main_goal: speed                                                           | Plan       |

## Scope

**In scope (remaining):** Phase 2 re-upload replacement + `use-cases.md` update; Phase 3 OpenRouter `ProductRecognizer` factory + prompts + `recognizeProducts` orchestration + constructor/middleware extension + recognition route; Phase 4 `postFormData` + image-processing util + `/recipes/new` page/wizard/upload step + `deserializeRecognizedItems`; Phase 5 review step + roadmap bookkeeping.

**Out of scope:** F-02, recipe generation (S-02), persistence of corrections/save (S-03), list/detail/delete (S-04), slim wire DTOs, server-truth preview URLs, upload state guards, `photosFailed` notice, orphan cleanup, HEIC decoding, in-app camera, test-runner setup.

## Architecture / Approach

Hexagonal: `RecipeSessionUC` (a class) depends only on domain ports; `infrastructure/**` provides functional factories (`createRecipeSessionRepository`, `createSessionPhotoStorage`, new `createProductRecognizer`); middleware composes them onto `context.locals`. Routes are thin `runApiRoute` delegates returning the domain `RecipeSession`. Recognition: load `photo_paths` → reuse `createPreviewUrls` to sign → `Effect.forEach` one structured-output LLM call per photo (concurrency 5, timeout + 1 retry, per-photo failure → empty) → merge (skipped for one photo) → persist `recognized_items_md` + state. Browser: validate originals → canvas-resize → create session lazily → multipart upload → recognition → parse markdown into an editable list.

## Phases at a Glance

| Phase                            | What it delivers                                                    | Key risk                                                  |
| -------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------- |
| 1. Session lifecycle foundation  | ✅ Landed (migration, types, OpenRouter env)                        | —                                                         |
| 2. Session API (create + upload) | 🟡 Mostly landed; remaining: re-upload replacement + `use-cases.md` | Minimal                                                   |
| 3. Recognition adapter + UC      | OpenRouter `ProductRecognizer`, fan-out/merge, persisted results    | First real LLM integration; 30 s NFR; output-schema drift |
| 4. Wizard step 1 (Upload)        | Page, shell, validation/resize/previews, loaders, `postFormData`    | Canvas resize quirks across mobile browsers               |
| 5. Wizard step 2 (Review)        | Editable list (parsed from markdown) + retry UX                     | Merge quality (dedupe) only verifiable manually           |

**Prerequisites:** F-01 (done); local Supabase via Docker; an `OPENROUTER_API_KEY` for Phase 3+ manual verification.
**Estimated effort:** ~2–3 sessions remaining; Phase 3 is the heavy one.

## Open Risks & Assumptions

- **F-02 deferred** — accounts created before it lands are unverified (accepted, needs later audit).
- **No test runner** — verification is lint/build + a manual matrix; regression safety is thin.
- **Returning the domain model** leaks `userId`/timestamps to the client and makes later field renames breaking API changes (accepted).
- LLM output quality (dedupe, quantity estimates, Polish naming) is prompt-dependent — Phase 3/5 manual checks gate it; model id is env-swappable.
- iOS HEIC auto-convert should be verified on a real device in Phase 4.

## Success Criteria (Summary)

- US-01 steps 1–3 work end-to-end on real photos: upload → recognition → editable unambiguous Polish list, ≈ 30 s with continuous feedback.
- FR-003 limits enforced server-side (already landed in `parseMultipartFiles`), with readable client errors.
- A second account can see none of the first account's sessions or photos.
