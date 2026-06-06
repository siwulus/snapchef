---
change_id: photo-upload-and-recognition
title: Uphoto upload and recognition
status: implementing
created: 2026-06-06
updated: 2026-06-06
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Decisions — LLM recognition architecture (2026-06-06)

OpenRouter is the communication layer to the multimodal LLM. Three decisions, based on live OpenRouter model data + roadmap constraints (NFR ~30 s, FR-004 unambiguity, privacy NFR launch-gating):

**1. Model selection**

- Primary: `google/gemini-3.1-flash-lite` ($0.25/M input, $1.50/M output; vision + `structured_outputs`).
- Fallback via OpenRouter `models` routing array: `["google/gemini-3.1-flash-lite", "openai/gpt-5.4-mini"]` — provider outage degrades gracefully instead of failing S-01.
- Model ID is env-configurable from day one (S-02 risk note anticipates model swap if the 30 s NFR is blown).
- FR-004 (one product per item, no "lemon or lime" alternatives) is enforced in the prompt — the schema cannot express it.
- Client-side resize before upload (canvas, max edge ~1568 px) — vision models downscale anyway; cuts storage, upload time, and LLM latency.

**2. Image transport to the LLM (private Supabase Storage bucket)**

- Short-lived **signed URLs** (~120 s TTL) passed as `image_url` — OpenRouter infra fetches directly from Supabase CDN; the Worker never proxies image bytes (5 × 5 MB as base64 ≈ 33 MB in Worker memory — rejected).
- Signed URLs are created with the **user's session-scoped Supabase client** (`context.locals`) so RLS proves ownership; never the service-role client.
- OpenRouter provider preference `provider: { data_collection: "deny" }` — covers the retention/training part of the privacy NFR that signed URLs don't.

**3. Multi-photo pipeline (1–5 photos) — fan-out + merge**

- Stage 1 (parallel, vision): one OpenRouter call per photo → structured output `{ items: [{ name, quantity, unit }] }`. `Effect.forEach(urls, recognizeImage, { concurrency: 5 })` with `Effect.timeout` + one retry, typed `ExternalSystemError` on failure. Wall-clock ≈ slowest image, not 5×.
- Stage 2 (single, text-only): cheap merge call to the same flash-tier model — semantic dedupe ("mleko 1 karton" ≡ "milk carton"), quantity summing, re-enforces FR-004. Code-level string matching rejected: merging is semantic.
- Single-request-with-5-images rejected: per-image attention degrades, one bad image poisons the response, latency serializes.
- Partial failure policy: if 1 of 5 images fails after retry, proceed with the rest + surface a notice (user edits the list anyway per FR-005); fail only when all images fail.
- One zod schema in `core/boundry/recognition/` (same-name convention) serves three roles: OpenRouter `response_format` JSON Schema (`z.toJSONSchema`), wire validation of model output (`safeParse` bridged into Effect), and the React list-editor contract.
- Expected total latency ~8–13 s — inside the 30 s NFR with loader-UX headroom.

**4. Orchestration: manual Effect pipeline, not agentic (2026-06-06)**

- **Decision:** orchestrate the fan-out + merge manually in deterministic Effect code; the LLM is used as two _workers_ (recognize, merge), never as the _orchestrator_. The OpenRouter Agent SDK loop (`callModel` + `tool()` + `stopWhen` from `@openrouter/agent`) was considered and **rejected** for this slice.
- **Deciding test:** use an agent when control flow is unknown at write-time; use code when it's static. This pipeline has zero decision points — always recognize all N photos in parallel, always merge once. An orchestrator LLM would spend tokens deciding the already-decided.
- Rejection rationale:
  - **Latency (30 s NFR):** each agent turn = orchestrator inference → tool calls → results back → orchestrator inference; parallel tool emission is model-dependent, not guaranteed — worst case serializes 5 vision calls (~40–60 s). `Effect.forEach(..., { concurrency: 5 })` is parallel by construction.
  - **Orchestrator token tax:** every turn re-sends system prompt + tool schemas + accumulated tool results through the orchestrator; per-image item lists round-trip through the LLM with no information gain.
  - **Policy vs non-determinism:** the partial-failure policy (≥1 image OK → proceed with notice; all fail → error) is product policy and must be code, not an agent's choice. Encoding it agentically smears it across prompt + `stopWhen` + tool error formats — the same orchestration logic in its least testable form.
  - **House conventions:** the agent loop is an opaque Promise — one `Effect.tryPromise` around the whole loop loses per-stage typed errors (`ExternalSystemError` per image vs merge). The manual pipeline fits `runApiRoute` + `Data.TaggedError` + single-`runPromise` conventions exactly.
  - **Testability:** deterministic pipeline unit-tests with a mocked transport; an agent loop needs an LLM in the test loop and takes varying paths for identical input.
  - **"Less code" is illusory:** schemas, recognition call, merge prompt, signed URLs, error mapping must be written either way; the agent only replaces ~10 lines of Effect sequencing — with non-determinism.
  - `@openrouter/agent` is beta.
- **Transport choice:** use `@openrouter/sdk` `chat.send` or plain `fetch` to `/chat/completions` wrapped in `Effect.tryPromise` — gives direct access to the `models` fallback array, `response_format`, and `provider.data_collection`. The agentic surface of `@openrouter/agent` (already in `package.json`) is not needed for S-01.
- **Revisit trigger:** the parked v2 feature "iteracyjna pętla feedbacku przy generacji przepisu" _is_ genuinely agentic (unknown turn count, user-driven control flow) — that is where `callModel` + tools + `stopWhen` would earn its keep.

**5. Session lifecycle: persisted from upload (2026-06-06, planning Q&A)**

- **Supersedes** ui-architecture.md locked decision §1.3 ("in-memory session, no drafts"): a `recipe_sessions` row is created at photo upload with a new `state` column (`photos_uploaded → products_recognized → recipe_generated → saved`); the session id is the durable handle every later step references.
- Upload endpoint returns `{ sessionId }`; recognition reads `photo_paths` from the session row (not from the client). Requires an additive migration: add `state`, DROP NOT NULL on `recognized_items_md` / `corrected_items_md` / `meal_context`.
- Wizard UI state (current step, edited list) remains client-side; abandoned drafts join the accepted-orphans policy.
- Full decision log from planning (F-02 deferral, multipart upload path, two-endpoint API, jpeg/png/webp-only formats, free-text quantity, Polish output, orphan policy) lives in `plan.md` → Decision Log.
