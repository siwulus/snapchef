---
change_id: mock-openrouter-for-tests-e2e
title: Mock OpenRouter in E2E tests with a fake adapter behind the port
status: implemented
created: 2026-06-22
updated: 2026-06-22
archived_at: null
---

## Notes

Goal: make Playwright E2E specs run without ever calling the real (paid) OpenRouter
API, while still exercising the genuine HTTP flow through our own `/api/**` routes.

### Why the obvious approach doesn't work

OpenRouter is called **server-side**. `createProductRecognizer` / `createRecipeGenerator`
are wired into the Astro SSR process in `injectDependencies` (`src/middleware.ts:38-55`),
and `playwright.config.ts` boots that process as a separate server
(`webServer.command = "pnpm dev --port 4321"`). The browser only ever talks to our
`/api/recipe-sessions/...` endpoints; the _server_ then calls `openrouter.ai`.

Therefore Playwright's `page.route("**/openrouter.ai/**", ...)` matches nothing —
`page.route()` intercepts the **browser's** network, not the server's. The mock must
live inside / in front of the server process that Playwright spawns, not in the test's
browser context.

### Chosen approach — fake adapter behind the port (Option 1)

The hexagonal architecture already provides the exact test seam:

- **Ports:** `ProductRecognizer` and `RecipeGenerator` in
  `src/lib/core/boundry/recipe/ports.ts` (`recognizePhoto`, `mergeItems`, `generate` —
  all returning `Effect.Effect<…, SnapchefServerError>`).
- **Real adapters:** `createProductRecognizer` / `createRecipeGenerator` in
  `src/lib/infrastructure/llm/openrouter.ts`.
- **Single composition root:** `injectDependencies` in `src/middleware.ts` — the one
  place a port is bound to an adapter.

Plan in three idiomatic moves:

1. **Fake adapters** under `src/lib/infrastructure/llm/`, typed against the ports
   (e.g. `createFakeProductRecognizer(): ProductRecognizer`,
   `createFakeRecipeGenerator(): RecipeGenerator`). Return deterministic canned domain
   data via `Effect.succeed(...)` — `RecognizedItem[]` for recognition/merge and a
   `{ name, contentMd }` recipe for generation. Annotating the factory return type with
   the port makes the compiler reject any drift from the real contract, and the canned
   values are built from the `RecognizedItem` / recipe schemas so shape can't silently
   diverge from reality. File naming follows the PascalCase-after-the-port convention
   (`FakeProductRecognizer.ts` / `FakeRecipeGenerator.ts`).

2. **Env flag** declared in the `astro.config.mjs` env schema as an
   `envField.boolean({ context: "server", access: "public", default: false })`
   (e.g. `E2E_FAKE_LLM`), read in `src/middleware.ts` via `astro:env/server` — never
   `import.meta.env` / `process.env` (hard rule). At the composition root, select the
   fake when the flag is set:
   `const productRecognizer = E2E_FAKE_LLM ? createFakeProductRecognizer() : createProductRecognizer();`
   (same for the recipe generator). The flag is only ever set in the test server's env,
   so the fake path is unreachable in production.

3. **Wire into Playwright** via `webServer.env` in `playwright.config.ts` so the dev
   server Playwright spawns boots with `E2E_FAKE_LLM=true`.

### Trade-off accepted

E2E will not exercise the real `openrouter.ts` wire path (SDK call, `guardCompletion`,
JSON parse, schema decode) — but that is already covered by `openrouter.test.ts` unit
tests. E2E's job is the user flow with deterministic, free, fast, flake-free AI output;
the adapter internals are a unit-test concern.

### Possible follow-up (out of scope for this change)

If we later want to guard the real adapter's wire contract end-to-end, add a _single_
dedicated spec using the SDK's `serverURL` override (confirmed supported:
`@openrouter/sdk` `config.d.ts:36`) against a tiny local stub server, while the rest of
the suite keeps using the fake. Tracked separately if needed.

### Pointers

- Ports: `src/lib/core/boundry/recipe/ports.ts`
- Real adapters: `src/lib/infrastructure/llm/openrouter.ts`
- Composition root: `src/middleware.ts` (`injectDependencies`)
- Env schema: `astro.config.mjs`; Vitest env stub: `src/test/astro-env-server.stub.ts`
- Playwright: `playwright.config.ts`; specs in `e2e/**/*.spec.ts`
- Follow the project's `/10x-e2e` skill for the E2E workflow itself.
