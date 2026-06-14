---
change_id: hexagonal-architecture-review
type: architecture-review
status: draft
created: 2026-06-11
reviewed_commit: c641e2606 (chore/conventions-sync-evolved-architecture)
inputs:
  - context/foundation/prd.md (v1)
  - context/foundation/tech-stack.md
  - context/foundation/roadmap.md (v2)
  - context/foundation/ui-architecture.md
  - docs/reference/conventions/ (binding, incl. ports-and-adapters.md)
  - src/** (full read of core, infrastructure, pages/api, components/api, middleware)
---

# Hexagonal Architecture Review — Snapchef

## 1. Purpose & method

This review measures the current Snapchef codebase against the principles of hexagonal architecture (ports & adapters): a framework-free application core, dependencies pointing inward, explicit port contracts on both the driving and driven sides, adapters that are replaceable without touching the core, and a single composition root.

It deliberately calibrates every finding against the project's own constraints, not against textbook purity in a vacuum:

- **Scale & timeline** (PRD): solo author, 3-week after-hours MVP, `target_scale: small/low/small`, `main_goal: speed` (roadmap). Recommendations that cost more than they return at this scale are explicitly rejected in §7.
- **Stack** (tech-stack.md): Astro 6 SSR on Cloudflare Workers, React 19 islands, Supabase (Auth/Postgres+RLS/Storage), Effect 3.x as the FP backbone, zod as the single validator.
- **Domain assumptions** (PRD/roadmap/ui-architecture): per-user privacy is a launch-gating guardrail enforced primarily by **RLS at the data layer** — the hexagon is _not_ the only line of defense; a persisted `recipe_sessions` state machine (`created → photos_uploaded → products_recognized → recipe_generated → saved`) is the domain's central lifecycle; two LLM integrations (product recognition, recipe generation) are imminent (S-01 tail, S-02).
- **Codified target**: the binding conventions in `docs/reference/conventions/` (notably `ports-and-adapters.md`, `use-cases.md`, `effect.md`) already describe the intended hexagonal shape. This review therefore asks two questions: _does the code match its own stated architecture?_ and _is that stated architecture sound hexagonal practice?_

Verdict up front: **the skeleton of the hexagon is genuinely in place and better than typical MVP code** — real ports, a port-injected use case, one composition root, an anti-corruption row mapper, typed errors end-to-end. The weaknesses are concentrated in (a) one use case (`AuthenticatorUC`) that sits inside the core but ignores the port pattern, (b) a `utils/` layer that has become an unprincipled escape hatch through which infrastructure knowledge leaks, (c) several places where error-channel fidelity is destroyed (every failure collapses to "not found" / "auth failed"), and (d) zero tests — meaning the architecture's main payoff, substitutable adapters, is entirely unrealized.

## 2. The hexagon as implemented — current-state map

```
            DRIVING (primary) SIDE                          DRIVEN (secondary) SIDE
┌────────────────────────────┐                       ┌──────────────────────────────────┐
│ src/pages/api/** (routes)  │                       │ src/lib/infrastructure/db/        │
│ src/middleware.ts          │                       │  RecipeSessionRepository.ts       │
│ src/lib/infrastructure/api │   ┌───────────────┐   │  SessionPhotoStorage.ts           │
│  (runApiRoute, parsers,    │──▶│   CORE        │◀──│  supabase.ts (client factory)     │
│   envelope, status mapping)│   │ core/uc       │   │ (ProductRecognizer: port declared,│
└────────────────────────────┘   │ core/model    │   │  no adapter yet — due in S-01/02) │
                                 │ core/boundry  │   └──────────────────────────────────┘
┌────────────────────────────┐   │  (ports, DTOs)│
│ Browser: components/api    │   └───────────────┘   ┌──────────────────────────────────┐
│  http.ts + errors.ts       │          ▲            │ src/lib/utils/   ← PROBLEM AREA  │
│  (client-side transport    │          │            │  effect.ts / supabase.ts /        │
│   adapter, own error union)│   composition root:   │  recipe.ts — sits outside the     │
└────────────────────────────┘   src/middleware.ts   │  hexagon, imported by BOTH sides  │
                                 (injectDependencies)└──────────────────────────────────┘
```

Inventory, hexagonal concept → implementation:

| Hexagonal concept                        | Where it lives                                                                                                                                               | Assessment                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Application core (use cases)             | `core/uc/recipe/RecipeSessionUC.ts`, `core/uc/auth/AuthenticatorUC.ts`                                                                                       | Split: RecipeSessionUC clean; AuthenticatorUC violates core purity (§4, W2) |
| Domain model                             | `core/model/{recipe,auth}` — zod schemas, branded ids (`UserId`, `RecipeSessionId`), `RecipeSessionState` enum                                               | Sound; framework-free                                                       |
| Driven ports                             | `core/boundry/recipe/ports.ts` — `RecipeSessionRepository`, `SessionPhotoStorage`, `ProductRecognizer` interfaces returning `Effect<…, SnapchefServerError>` | Textbook; auth has **no** port (W2)                                         |
| Driving-side contracts                   | `core/boundry/auth` (`RedirectTarget`), `core/boundry/recipe/dto.ts` (upload limits), `core/model/auth` (`UserCredentials`)                                  | Present but mixed concerns (W7)                                             |
| Driven adapters                          | `infrastructure/db/RecipeSessionRepository.ts`, `SessionPhotoStorage.ts` — factories anchored `: <Port>`                                                     | Textbook                                                                    |
| Driving adapters                         | `pages/api/**` (4–18 lines each) + `infrastructure/api/index.ts` (`runApiRoute`, `parseRequestBody`, `parseMultipartFiles`, `validateAuthUser`)              | Thin and uniform; envelope + status mapping centralized                     |
| Anti-corruption layer (DB rows → domain) | `RecipeSessionFromRow` (`.transform().pipe(RecipeSession)`)                                                                                                  | Right pattern, wrong home — lives in `utils/` (W3)                          |
| Composition root                         | `src/middleware.ts` `injectDependencies` → `context.locals`, declared on `App.Locals` (`src/env.d.ts`)                                                       | Single, per-request, fail-fast; correct for stateless Workers               |
| Error model                              | `core/model/error` — `Snapchef…Error` union, numeric HTTP `code` read by `runApiRoute` (`api/index.ts:46`)                                                   | Works, but couples core to HTTP (W5 — accepted trade-off, must be named)    |
| Client-side hexagon analog               | `components/api/http.ts` (3-stage validated transport), `errors.ts` (own `ClientSnapchefError` union), `useApiClient` decorator                              | Clean miniature of the same pattern                                         |
| Tests against fake ports                 | —                                                                                                                                                            | **None exist** (0 test files, no test deps) (W8)                            |

## 3. Strengths

### S1. Real driven ports with honest signatures — `core/boundry/recipe/ports.ts`

The three interfaces are genuine ports, not decorative ones: methods return `Effect.Effect<A, SnapchefServerError>`, absence is modeled as `Option` where absence is legitimate (`find`, `update`) and as a bare value where it isn't (`create`). The contract encodes _semantics_, not just shapes. `ProductRecognizer` being declared before its adapter exists is the right move given S-01/S-02 are next — the LLM integration will land against a frozen contract instead of shaping it.

### S2. `RecipeSessionUC` is a textbook hexagonal use case

`RecipeSessionUC.ts:11-14` injects two ports via constructor, `import type` only; the class never names Supabase, never reads env, never touches a framework type. `attachPhotos` is pure orchestration: fetch session → upload files through the storage port → update through the repository port. This is the pattern the whole core should converge on, and it proves the team can execute it.

### S3. One composition root, per-request, fail-fast — exactly right for the stack

`src/middleware.ts` is the only place adapters meet ports (`new RecipeSessionUC(createRecipeSessionRepository(supabase), createSessionPhotoStorage(supabase))`). Two stack-specific judgments deserve credit:

- **Per-request wiring** (not module-level singletons) is the correct idiom for Cloudflare Workers, where the Supabase client carries per-request cookies/headers and isolates must stay stateless.
- **Fail-soft factory / fail-fast root**: `infrastructure/db/supabase.ts` returns `null` on missing env; `middleware.ts:28` converts that into a hard throw. Every downstream consumer may assume `locals` is populated — declared on `App.Locals` in `src/env.d.ts`, so the assumption is compiler-checked.

### S4. Anti-corruption mapping at the persistence edge

`RecipeSessionFromRow` (snake_case row schema → `.transform` → `.pipe(RecipeSession)`) means adapters never return a raw DB row; the `.pipe(Model)` tail re-validates enums/uuids/nullability so schema drift fails loudly at the boundary instead of leaking a malformed object inward. Write payloads are derived from the domain model (`RecipeSession.pick({...}).partial()`), so the DTO tracks the model automatically. The generated `Database` types (`infrastructure/db/types/`) stay confined to the adapter layer — the core never sees them.

### S5. Typed failure channel across the entire hexagon, mapped to protocol at one point

Every fallible operation is an `Effect` with `SnapchefServerError` in the failure channel; HTTP materialization happens exactly once, in `runApiRoute` (`infrastructure/api/index.ts:46` reads `error.code` as status, `:61` catches defects → 500). Routes are consequently uniform and 4–18 lines long; none builds a `Response` by hand. The same discipline exists client-side with a _separate_ error union (`ClientSnapchefError`) — the review notes approvingly that server error types do **not** leak into browser code; the wire contract (`ApiResponsePayload`) is the only shared artifact, validated with zod on both sides.

### S6. Defense-in-depth privacy honestly layered

The PRD's launch-gating privacy guardrail is enforced where it belongs: RLS policies + storage path convention (`SessionPhotoStorage.ts` builds `{user_id}/{session_id}/…` paths keyed to `auth.uid()`), with the repository additionally scoping every query by `user_id`, and `validateAuthUser` gating routes. The hexagon does not pretend to be the security boundary — correct for a Supabase architecture where the DB is reachable by other paths.

### S7. The architecture is codified and binding

`docs/reference/conventions/` (ports-and-adapters, use-cases, effect, api-server/client) describes the target shape with ✓/✗ examples. For an agent-driven workflow this is a structural strength: the architecture survives contributor turnover (human or AI) because it is written down next to the code and wired into every agent's context.

## 4. Weaknesses

Ordered by severity. Severity weighs _correctness impact_ first, _architectural erosion risk_ second, _purity_ last — per `main_goal: speed`.

### W1 — HIGH (correctness): error-channel fidelity is destroyed at three choke points

The typed error channel (S5) is undermined by blanket `mapError` calls that collapse _every_ upstream failure into one error:

- `RecipeSessionUC.ts:36-37` (`fetchRecipeSession`) and `:57-58` (`updateRecipeSessionWithPhotos`): the `Option` is unwrapped via `Effect.andThen((session) => session)` — `None` becomes a defect-ish `NoSuchElementException` in the failure channel — and then `Effect.mapError(() => new SnapchefNotFoundError(...))` rewrites **all** failures, including `SnapchefDatabaseError` and `SnapchefExternalSystemError` from the repository. A Supabase outage during photo attach is reported to the user as **404 "Session not found"** instead of 500. This misdirects debugging (the real cause is discarded, `wrangler tail` shows nothing useful) and lies to the client.
- `AuthenticatorUC.ts:21,28,41`: same pattern — `Effect.mapError(() => new SnapchefAuthenticationError(...))` converts network failures, schema drift in `AuthUser`, _and_ genuine bad credentials into one 401. An Auth service outage manifests as "Failed to sign in" with the cause dropped (not even forwarded into `cause`), violating the conventions' own rule that wrapped failures carry their cause.

This is the single most important finding: the architecture's central promise — _failure modes visible in the type and preserved through the pipeline_ — is built and then defeated at the last step.

### W2 — HIGH (architecture): `AuthenticatorUC` sits inside the core but breaks core purity twice

- `AuthenticatorUC.ts:7,16` depends directly on the **concrete vendor type** `SupabaseClient` — tolerated by the conventions as the "thin wrapper" exception, but auth is not incidental plumbing here: `SnapchefUser` is a domain model, `getUser()` feeds the route guard, and email verification (F-02, still pending) will add domain rules (verified-only tier per ui-architecture §5). There is no `Authenticator` port, so when F-02 lands, verification logic will accrete onto a Supabase-shaped class.
- Worse, `AuthenticatorUC.ts:6` has a **runtime import** of `tryErrorDataWithSchema` from `@/lib/utils/supabase` — Supabase-flavored infrastructure code executing inside `core/uc`. This directly contradicts the binding rule "adapters enter `core/uc` as types only" and makes the core un-runnable without the Supabase utility module. The hexagon's inward-only dependency rule is broken at this point — the only place in the codebase where it is.

### W3 — MEDIUM-HIGH (erosion): `src/lib/utils/` is an unprincipled layer that both sides import

`utils/` currently holds three files with three different architectural identities, none of which is "generic helper":

| File                                  | What it actually is                                                                                                                                                        | Where it belongs                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `utils/effect.ts` (`decodeWith`)      | zod→Effect bridge; imports `core/model/error`                                                                                                                              | Shared kernel — defensible as-is, or `core/`                               |
| `utils/supabase.ts` (`tryErrorData*`) | Supabase `{data,error}` lifting — infrastructure                                                                                                                           | `infrastructure/db/` (or `infrastructure/supabase/`)                       |
| `utils/recipe.ts`                     | `RecipeSessionFromRow` knows **snake_case DB columns** (persistence mapping) **and** `serializeItemsToMarkdown` (domain serialization rule used for `recognized_items_md`) | Split: row mapper → `infrastructure/db/`; markdown serialization → `core/` |

The danger is not today's three files but the gradient: `utils/` is importable from anywhere, so every future "where does this go?" question has a frictionless wrong answer. `utils/recipe.ts` already demonstrates the failure mode — DB column knowledge and a domain rule cohabiting one file outside the hexagon. The dependency arrows now run `core → utils → core` (AuthenticatorUC → utils/supabase → core/model/error), which defeats any layering lint you might later add.

### W4 — MEDIUM: presentation policy decided inside the core

`AuthenticatorUC.ts:20,27` returns hardcoded browser navigation targets (`{ redirect: "/recipes" }`, `{ redirect: "/auth/confirm-email" }`). Where the browser navigates after sign-in is a driving-adapter (UI/route) decision, not a domain outcome; the ui-architecture doc owns these flows (§3: save → `/recipes/[id]`, discard → `/recipes`). When F-02 introduces the verified-only tier, the post-signin destination becomes conditional — and that conditional logic will be forced into the UC or duplicated. The UC should return a domain outcome (`SnapchefUser`, or a `SignInOutcome`), and the route/boundary should map outcome → `RedirectTarget`.

### W5 — ACCEPTED TRADE-OFF (must stay conscious): HTTP status codes live inside the domain error model

`core/model/error/index.ts` gives every domain error a `readonly code = 401|403|404|409|422|400|500|502`. Strict hexagonal practice keeps protocol numbers in the driving adapter (the core says _what kind_ of failure; the boundary maps kind → status). The current design couples every core failure to the REST delivery mechanism — a queue consumer, cron job, or MCP-style driver consuming the same UCs would inherit meaningless HTTP numbers.

**This review does not recommend reversing it now.** The codebase already migrated _away_ from the string-code + `ERROR_STATUS` + ts-pattern design (commit ed188c77a) precisely because three synchronized artifacts per error was friction without payoff at this scale, and the only driver in the MVP (and roadmap) is HTTP. The cost is bounded and the simplification is real. The requirement is that it stays a _named_ trade-off: it is now documented in `effect.md`; the trigger to revisit is the first non-HTTP driver, not aesthetics.

### W6 — LOW (hygiene): dead/anomalous members in `RecipeSessionUC`

`RecipeSessionUC.ts:17` declares `private _productRecognizer: ProductRecognizer | null = null` — never assigned, never read, and contradicting the constructor-injection convention the same class otherwise models. `recognizeProducts` (`:31`) fails with `SnapchefBusinessRuleViolationError("Not implemented")` — semantically a 422 "your request violated a rule", which is wrong for "feature not built"; it will also be live on the API surface the moment a route exposes it. Delete the field; when S-01's recognition step lands, inject the port via the constructor like the other two.

### W7 — LOW (structure): `core/boundry/` conflates driving and driven contracts

`boundry/recipe/ports.ts` holds driven ports (repository, storage, recognizer) _and_ `RecipeSessionUpdatePayload` (a persistence-update DTO); `boundry/recipe/dto.ts` holds upload limits (driving-side validation policy); `boundry/auth/index.ts` holds `RedirectTarget` (a driving-side response DTO); meanwhile the actual command schema `UserCredentials` lives in `core/model/auth`, not `boundry`. Nothing is _wrong_ enough to break, but the folder no longer has one meaning, and the root `CLAUDE.md` description ("command schemas, e.g. `SignInCommand`") matches none of it. As S-02–S-04 add recipe-generation commands and response DTOs, decide the taxonomy once (e.g. `boundry/<domain>/ports.ts` = driven contracts; `boundry/<domain>/commands.ts` + `responses.ts` = driving contracts) and update `CLAUDE.md`.

### W8 — MEDIUM (unrealized payoff): zero tests means the ports buy nothing yet

There are no test files and no test runner in `package.json`. The dominant _practical_ benefit of this architecture at MVP scale — unit-testing `RecipeSessionUC` state transitions and the imminent S-02 generation logic against in-memory fake ports, with no Supabase, no Docker, no network — is therefore entirely unrealized. The session state machine (`created → … → saved`) is exactly the kind of logic that is cheap to test through ports and expensive to test through the browser. The foundation `test-plan.md` exists but no rollout phase has landed. Until at least one UC test exercises a fake port, port substitutability is an untested claim.

## 5. Scorecard

| Hexagonal principle                       | Grade  | Evidence                                                                                     |
| ----------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| Core free of framework/IO dependencies    | **B−** | RecipeSessionUC clean; AuthenticatorUC runtime-imports Supabase util (W2)                    |
| Dependencies point inward only            | **B**  | One inversion violation (`core → utils/supabase`); `utils/` direction ambiguous (W3)         |
| Explicit driven ports                     | **A−** | Three real interfaces, Effect+Option semantics; auth missing (W2)                            |
| Explicit driving contracts                | **B−** | Envelope + zod schemas shared correctly; `boundry/` taxonomy muddled (W7)                    |
| Adapters replaceable without core changes | **A−** | Factories anchored `: <Port>`; row mapper isolated; (untested — W8)                          |
| Single composition root                   | **A**  | `middleware.ts` only; per-request; fail-fast; compiler-checked locals                        |
| Error semantics preserved core→boundary   | **C**  | Typed channel exists but three choke points erase it (W1); HTTP codes in core (W5, accepted) |
| Core expresses domain, not delivery       | **B−** | Redirect targets in UC (W4); "Not implemented" as business-rule violation (W6)               |
| Architecture verified by tests            | **F**  | Zero tests (W8)                                                                              |
| Architecture documented & enforceable     | **A**  | Binding conventions with ✓/✗ examples; layer-access matrix in `src/lib/CLAUDE.md`            |

## 6. Recommendations

Ordered for execution. Effort: S < ~1h, M = a few hours, L = a day+. R1–R3 are worth doing **before S-02** (recipe generation) because that slice adds the first LLM adapter and the largest new UC logic — it will copy whatever patterns exist when it starts.

### R1 (fixes W1) — Restore error fidelity at the three choke points — **S/M**

In `RecipeSessionUC`, unwrap the `Option` explicitly and map **only** `None` to not-found, letting repository failures pass through:

```ts
private fetchRecipeSession(userId: string, sessionId: string) {
  return this.sessionRepository.find(userId, sessionId).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(new SnapchefNotFoundError({ message: "Session not found" })),
        onSome: Effect.succeed,
      }),
    ),
  );
}
```

In `AuthenticatorUC`, distinguish "Supabase answered with an auth error" (→ `SnapchefAuthenticationError`) from "the call/decoding failed" (→ pass through / `SnapchefExternalSystemError`), and always forward `cause`. Concretely: replace the blanket `Effect.mapError(() => …)` with `Effect.catchTag` on the specific error(s) that genuinely mean bad credentials, or extend `tryErrorDataWithSchema` to emit a distinct error for the `{ error }` branch (it currently folds it into `SnapchefExternalSystemError`, which then gets blanket-rewritten — the two layers fight each other).

### R2 (fixes W2, most of W3) — Give auth a port; move the Supabase bridges into infrastructure — **M**

1. Declare an `Authenticator` (or `AuthGateway`) port in `core/boundry/auth/ports.ts`: `signIn(credentials): Effect<SnapchefUser, …>`, `signUp`, `signOut`, `getUser` — domain types only.
2. Implement it as `infrastructure/auth/SupabaseAuthenticator.ts` (factory `createSupabaseAuthenticator(supabase)`, anchored `: Authenticator`), moving the `tryErrorDataWithSchema` call and the `AuthUser` wire schema there — they are Supabase response details.
3. `AuthenticatorUC` either depends on the port or — given how thin it becomes — dissolves: middleware and routes can consume the port directly via `locals`. Keeping a UC is fine if F-02 verification rules will live there; the point is the **Supabase types and utils leave `core/`**.
4. Relocate `utils/supabase.ts` → `infrastructure/db/supabase-effect.ts` (or `infrastructure/supabase/bridge.ts`). After this, no `core/` file imports `utils/` at runtime except `decodeWith`.

This removes the only inward-dependency violation in the codebase and pre-positions auth for F-02.

### R3 (fixes rest of W3) — Disband `utils/recipe.ts`; rule the `utils/` layer — **S**

- `RecipeSessionFromRow` → `infrastructure/db/` (sibling to the repository that is its only consumer).
- `serializeItemsToMarkdown` → `core/` (it implements the domain's `[name, quantity]` → markdown rule that S-01/S-03 depend on; e.g. `core/model/recipe/markdown.ts`).
- Add one line to `src/lib/CLAUDE.md`'s layer matrix: _`utils/` may contain only modules importable from both `core` and `infrastructure` without violating direction — currently exactly `effect.ts`; anything Supabase-, DB-, or domain-specific is misplaced._

### R4 (fixes W4) — Return domain outcomes from auth, map to redirects at the boundary — **S**

`signIn` returns `SnapchefUser` (or a small `SignInOutcome`); the route composes `Effect.as<RedirectTarget>({ redirect: "/recipes" })`. The redirect literal moves to the file that owns routing context (`pages/api/auth/signin.ts`), where the F-02 verified/unverified branch will naturally live. `RedirectTarget` stays in `boundry/auth` as the shared wire schema.

### R5 (fixes W6) — Delete the dead field; type "not implemented" honestly — **S**

Remove `_productRecognizer`. Either delete `recognizeProducts` until S-01's recognition step lands (preferred — dead API surface invites accidental exposure) or fail with `SnapchefInternalSystemError`. When implementing, inject `ProductRecognizer` as the third constructor parameter; the port contract is already right.

### R6 (fixes W8) — Stand up Vitest with one fake-port UC test before S-02 — **M**

Install `vitest` only (no jsdom, no Playwright — out of scope here; the foundation test-plan owns the full rollout). Write `RecipeSessionUC.test.ts` with in-memory fakes of `RecipeSessionRepository`/`SessionPhotoStorage` (a `Map` + array, ~30 lines) covering: `attachPhotos` happy path sets `photos_uploaded` with returned paths; missing session → `SnapchefNotFoundError`; repository failure → passes through **unmasked** (this test pins R1). S-02's generation UC then starts life with a test harness to copy instead of a reason to skip testing. This is the cheapest moment it will ever be: two ports, one UC, no mocks needed beyond object literals.

### R7 (fixes W7) — Settle the `boundry/` taxonomy in one short change — **S**

Split per domain: `ports.ts` (driven contracts + their payload DTOs like `RecipeSessionUpdatePayload`), `commands.ts`/`responses.ts` (driving-side schemas — move `RedirectTarget`, decide whether `UserCredentials` belongs here rather than `core/model/auth`), `dto.ts` for genuine shared constants (upload limits are fine where they are). Update the stale `core/boundry` description in root `CLAUDE.md` (it references a non-existent `SignInCommand`) and mirror the taxonomy in `docs/reference/conventions/ports-and-adapters.md`. Do it before S-02 doubles the file count in `boundry/recipe/`.

## 7. What NOT to do (anti-recommendations at this scale)

Hexagonal review pressure usually tempts four "improvements" that would be net-negative for a solo 3-week MVP with `main_goal: speed`:

1. **Do not introduce Effect `Layer`/`Context`-based DI.** Per-request constructor wiring in middleware is simpler, fully typed via `App.Locals`, and idiomatic for Workers' stateless isolates. Effect's service pattern earns its complexity with deep dependency graphs and test-time layer swapping — at two UCs and four adapters it's ceremony. Revisit only if the object graph stops fitting in one screen of `injectDependencies`.
2. **Do not strip HTTP codes back out of the error model now** (W5). The previous string-code design was already tried and consciously abandoned. Reversing again costs a refactor and re-introduces three-artifacts-per-error friction, for a benefit that materializes only when a non-HTTP driver exists. Keep the trade-off documented; act on the trigger, not before.
3. **Do not wrap Supabase Auth's session/cookie mechanics behind a hand-rolled port.** The `@supabase/ssr` cookie dance in `infrastructure/db/supabase.ts` is framework-edge glue; abstracting it would mean re-specifying Supabase's session semantics as an interface nobody else will implement. R2's `Authenticator` port covers the _domain-relevant_ operations only — that's the right cut line.
4. **Do not aim for adapter swappability you'll never use.** The ports' value here is _testability_ (R6) and _blast-radius control_ for the LLM integrations — not a fantasy Postgres→Dynamo migration. Resist generalizing port signatures beyond what `RecipeSessionUC` and the S-02 UC actually call.

## 8. Summary

|                                |                                                                                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Overall alignment**          | **Solid B.** The hexagon is real, not aspirational: ports, port-injected core, one composition root, ACL row-mapping, typed errors, thin uniform adapters — with the architecture codified in binding conventions.             |
| **Biggest correctness risk**   | W1 — blanket `mapError` choke points report infrastructure failures as 404/401, discarding causes. Fix is small and mechanical (R1).                                                                                           |
| **Biggest architectural risk** | W2 + W3 — the auth UC's runtime reach into Supabase utils, and a `utils/` layer with no direction rule, are the two cracks through which the core's purity will erode as S-02–S-04 land. Fixes are a few hours total (R2, R3). |
| **Biggest unrealized payoff**  | W8 — zero tests. One Vitest + fake-ports test file (R6) converts the architecture from a style choice into a working asset, at its cheapest-ever moment.                                                                       |
| **Best timing**                | R1–R3 (+R5) before starting S-02; R6 alongside S-02's first UC; R4, R7 opportunistically with F-02 / the next `boundry/` touch.                                                                                                |

The codebase does not need an architectural overhaul; it needs the existing architecture _finished at the seams_ — error fidelity preserved, auth brought inside the same discipline as recipes, the utils escape hatch closed, and one test proving the ports are real.
