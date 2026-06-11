# Hexagonal Architecture Seam Fixes — Implementation Plan

## Overview

Implement the fixes recommended by the Hexagonal Architecture Review (`context/changes/hexagonal-architecture-review/hexagonal-architecture-review.md`), covering recommendations **R1–R5 and R7**. The review's verdict: the hexagon is real but unfinished at the seams — error fidelity is destroyed at three choke points, auth ignores the port discipline the rest of the core follows, `utils/` is an unprincipled escape hatch, and `boundry/` has no settled taxonomy. This plan finishes those seams before S-02 (recipe generation) copies the broken patterns.

## Current State Analysis

All review findings verified against HEAD (`196c99f25`, identical to reviewed commit `c641e2606` for the affected files):

- **W1 (HIGH, correctness)** — `RecipeSessionUC.ts:36-37` and `:57-58` unwrap `Option` via `Effect.andThen` then blanket-`mapError` everything to `SnapchefNotFoundError`; `AuthenticatorUC.ts:21,28,41` blanket-`mapError` everything to `SnapchefAuthenticationError` without forwarding `cause`. Infrastructure failures report as 404/401 with the real cause discarded.
- **W2 (HIGH, architecture)** — `AuthenticatorUC.ts:6` runtime-imports `tryErrorDataWithSchema` from `@/lib/utils/supabase` (the only inward-dependency violation in the codebase); `:7,16` depends on concrete `SupabaseClient` with no port; the `AuthUser` wire schema (`:12-14`) lives in core.
- **W3 (MEDIUM-HIGH, erosion)** — `utils/supabase.ts` is infrastructure code; `utils/recipe.ts` mixes DB column knowledge (`RecipeSessionFromRow`) with a domain rule (`serializeItemsToMarkdown`); dependency arrows run `core → utils → core`.
- **W4 (MEDIUM)** — `AuthenticatorUC.ts:20,27` hardcodes browser redirect targets (presentation policy) inside the core.
- **W5 — accepted trade-off, NO ACTION** — HTTP codes stay in the domain error model per review §7.2.
- **W6 (LOW)** — `RecipeSessionUC.ts:17` dead `_productRecognizer` field; `:30-32` `recognizeProducts` fails with a semantically wrong 422 and has **no route consumer** (verified — safe to delete).
- **W7 (LOW)** — `boundry/` conflates driving and driven contracts; the command schema `UserCredentials` lives in `core/model/auth` instead; root `CLAUDE.md` references a non-existent `SignInCommand`.
- **W8 — deferred** — tests (R6) are explicitly out of scope per user decision; the foundation `test-plan.md` rollout owns them.

Importer map for everything that moves (verified by grep):

| Moving symbol              | Current home              | Consumers                                                                                         |
| -------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------- |
| `tryErrorData*` helpers    | `utils/supabase.ts`       | `RecipeSessionRepository.ts`, `SessionPhotoStorage.ts`, `AuthenticatorUC.ts` (removed in Phase 2) |
| `RecipeSessionFromRow`     | `utils/recipe.ts`         | `RecipeSessionRepository.ts` only                                                                 |
| `serializeItemsToMarkdown` | `utils/recipe.ts`         | none yet (S-01/S-03 will consume)                                                                 |
| `RecognizedItem`           | `boundry/recipe/ports.ts` | `utils/recipe.ts`, `ProductRecognizer` port                                                       |
| `UserCredentials`          | `core/model/auth`         | `signin.ts`, `signup.ts`, `AuthenticatorUC.ts`                                                    |
| `RedirectTarget`           | `boundry/auth/index.ts`   | `SignInForm.tsx`, `SignUpForm.tsx` (via boundry barrel — unaffected if barrel keeps the export)   |

## Desired End State

- A failed Supabase call during photo attach surfaces as 500 `SnapchefExternalSystemError` (cause preserved), not 404; a Supabase Auth outage surfaces as 500, not 401; only genuine absence → 404 and genuine auth rejection → 401.
- `src/lib/core/**` has **zero** runtime imports from `utils/` or `infrastructure/` and never names a Supabase type. Auth follows the same port discipline as recipes: `Authenticator` port in `core/boundry/auth/ports.ts`, `SupabaseAuthenticator` adapter in `infrastructure/auth/`, wired in `middleware.ts`.
- `src/lib/utils/` contains exactly `effect.ts`, with a written direction rule in `src/lib/CLAUDE.md`.
- `core/boundry/<domain>/` follows one taxonomy: `ports.ts` (driven contracts + their payload DTOs), `commands.ts` (driving-side input schemas), `responses.ts` (driving-side response schemas), `dto.ts` (genuine shared constants). Root `CLAUDE.md` and `docs/reference/conventions/` describe it accurately.

### Key Discoveries:

- `recognizeProducts` has no route consumer — deletion (review's preferred R5 option) breaks nothing.
- `serializeItemsToMarkdown` consumes `RecognizedItem`; moving the serializer to `core/model/recipe` therefore requires `RecognizedItem` to move there too, or `core/model` would import from `core/boundry` (reversed arrow within core).
- `tryErrorDataWithSchema` (`utils/supabase.ts:13-17`) already folds Supabase's `{error}` branch into `SnapchefExternalSystemError`, which `AuthenticatorUC` then blanket-rewrites to 401 — the review's "two layers fight each other". The auth adapter must classify the Supabase error _itself_; it cannot reuse `tryErrorDataWithSchema` unchanged.
- `middleware.ts:32-43` (`setUserInContext`) relies on `getUser()` **failing** (not defecting) when no session exists — `Effect.catchAll` maps it to `user: null`. The new adapter must keep "no session" in the typed failure channel.
- Forms (`SignInForm.tsx:8`, `SignUpForm.tsx:8`) import `RedirectTarget` from the `boundry/auth` barrel — keeping the barrel re-export makes Phase 4 invisible to components.
- Conventions docs cite the code being moved: `effect.md` names `@/lib/utils/supabase`; `zod.md` and `ports-and-adapters.md` name `utils/recipe.ts`; `use-cases.md` shows `AuthenticatorUC` taking `SupabaseClient` directly as the ✓ "thin wrapper" example. Each phase syncs the affected doc, or the binding conventions will teach the next agent the pre-fix pattern.

## What We're NOT Doing

- **R6 / W8 (tests, Vitest)** — explicitly deferred to the foundation test-plan rollout (user decision). Consequence to note: the R1 fix lands without a pinning regression test.
- **W5** — HTTP status codes stay in `core/model/error`; revisit trigger is the first non-HTTP driver (review §7.2).
- **No Effect `Layer`/`Context` DI** (review §7.1) — constructor wiring in middleware stays.
- **No port over `@supabase/ssr` cookie mechanics** (review §7.3) — `infrastructure/db/supabase.ts` client factory is untouched.
- **No new port methods or generalized signatures** beyond what existing callers use (review §7.4).
- **No recipe-side `commands.ts`/`responses.ts` files yet** — the taxonomy is established and documented; S-02 creates them when it has content for them.
- **No renaming of the `boundry` folder** (the spelling is a documented repo convention).

## Implementation Approach

Four phases ordered by review severity, each leaving the repo compiling, linting, and behaviorally verified. Phases 1–2 are the review's "do before S-02" set. Phase 2 creates `boundry/auth/ports.ts` already conforming to the Phase 4 taxonomy, so nothing is moved twice. Convention docs are updated in the same phase as the code they describe.

## Critical Implementation Details

**Auth error classification (Phase 2).** Supabase Auth returns `{ data, error }` where a _rejection_ (bad credentials, missing session, unconfirmed email) is an `AuthApiError` with a 4xx `status`, while outages/network failures throw or carry 5xx. The adapter classifies with `isAuthApiError(error)` (exported by `@supabase/supabase-js`): `isAuthApiError(error) && error.status < 500` → `SnapchefAuthenticationError` with `cause: error`; everything else (thrown rejection, non-auth error, 5xx) → `SnapchefExternalSystemError` with `cause`. A decode failure of the `AuthUser` wire schema means _Supabase's response shape drifted_ — map it to `SnapchefExternalSystemError` (cause: the `SnapchefValidationError`), **not** a 400, because 400 would blame the client for a driven-side contract break.

**`getUser()` lifecycle (Phase 2).** `setUserInContext` in `middleware.ts` calls `getUser()` on every request, including anonymous ones; "no session" arrives as an `AuthApiError` and must classify as `SnapchefAuthenticationError` (typed failure), which `Effect.catchAll` already maps to `user: null`. Do not let it become a defect or an `ExternalSystemError`, or anonymous page loads would mis-classify.

**Intra-boundry imports (Phase 4).** `boundry/auth/ports.ts` references `UserCredentials` from `commands.ts` — import via the relative sibling (`./commands`), never via the domain's own `index.ts` barrel (circular import).

## Phase 1: Recipe-Side Error Fidelity + UC Hygiene (R1-recipe, R5 / W1, W6)

### Overview

Stop `RecipeSessionUC` from rewriting repository failures as 404, and remove the dead/anomalous members.

### Changes Required:

#### 1. RecipeSessionUC — explicit `Option` unwrap, pass-through failures

**File**: `src/lib/core/uc/recipe/RecipeSessionUC.ts`

**Intent**: In `fetchRecipeSession` and `updateRecipeSessionWithPhotos`, map **only** `Option.none()` to `SnapchefNotFoundError`; let `SnapchefDatabaseError`/`SnapchefExternalSystemError` from the repository pass through untouched. Replace the `Effect.andThen((session) => session)` + blanket `Effect.mapError` pairs.

**Contract**: Both private methods keep their signatures (`Effect.Effect<RecipeSession, SnapchefServerError>`). The unwrap pattern (from review R1 — this exact shape is the contract):

```ts
this.sessionRepository.find(userId, sessionId).pipe(
  Effect.flatMap(
    Option.match({
      onNone: () => Effect.fail(new SnapchefNotFoundError({ message: "Session not found" })),
      onSome: Effect.succeed,
    }),
  ),
);
```

`Option` becomes a runtime import from `effect` (allowed in core).

#### 2. RecipeSessionUC — delete dead members

**File**: `src/lib/core/uc/recipe/RecipeSessionUC.ts`

**Intent**: Delete the never-assigned `_productRecognizer` field (line 17) and the unexposed `recognizeProducts` method (lines 30–32); drop the now-unused `ProductRecognizer` and `SnapchefBusinessRuleViolationError` imports. When S-01's recognition step lands, `ProductRecognizer` enters as the third constructor parameter like the other two ports.

**Contract**: Public surface shrinks by one method; no route or component references it (verified).

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`
- No blanket rewrite remains: `grep -n "andThen((session) => session)" src/lib/core/uc/recipe/RecipeSessionUC.ts` returns nothing
- Dead members gone: `grep -rn "recognizeProducts\|_productRecognizer" src` returns nothing

#### Manual Verification:

- Photo upload to an existing session still succeeds end-to-end (session reaches `photos_uploaded` with paths).
- `POST /api/recipe-sessions/{random-uuid}/upload` (authenticated) returns **404** with "Session not found".
- With local Supabase stopped mid-flow (`mise run db-stop`), the upload endpoint returns a **500-family** error envelope (`SnapchefExternalSystemError`), not 404.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Auth Port + Supabase Adapter, Auth Error Fidelity, Domain Outcomes (R2, R1-auth, R4 / W1, W2, W4)

### Overview

Give auth the same hexagonal shape as recipes: a domain port, an infrastructure adapter that owns all Supabase knowledge (wire schema, error classification, causes), a thin port-injected UC returning domain outcomes, and redirect decisions at the route boundary.

### Changes Required:

#### 1. Declare the `Authenticator` port

**File**: `src/lib/core/boundry/auth/ports.ts` (new)

**Contract**: This interface is the contract Phases 2–4 and F-02 depend on:

```ts
export interface Authenticator {
  signIn(credentials: UserCredentials): Effect.Effect<SnapchefUser, SnapchefServerError>;
  signUp(credentials: UserCredentials): Effect.Effect<SnapchefUser, SnapchefServerError>;
  signOut(): Effect.Effect<void, SnapchefServerError>;
  getUser(): Effect.Effect<SnapchefUser, SnapchefServerError>;
}
```

`Effect` and `SnapchefServerError` enter as `import type`; `UserCredentials`/`SnapchefUser` from `core/model/auth` (until Phase 4 moves `UserCredentials`). Re-export from the `boundry/auth` barrel.

#### 2. Implement the Supabase adapter

**File**: `src/lib/infrastructure/auth/SupabaseAuthenticator.ts` (new)

**Intent**: Factory `createSupabaseAuthenticator(supabase: SupabaseClient): Authenticator` (curried per-method functions, explicit port return-type anchor — same shape as `createRecipeSessionRepository`). The `AuthUser` wire schema (`z.object({ user: SnapchefUser })`) moves here from `AuthenticatorUC` — it is a Supabase response detail. Each method lifts the Supabase Auth call and applies the error classification from Critical Implementation Details: auth rejection → `SnapchefAuthenticationError` (with per-operation message and `cause`), transport/5xx/thrown → `SnapchefExternalSystemError` (with `cause`), `AuthUser` decode failure → `SnapchefExternalSystemError`. `signIn`/`signUp`/`getUser` return the decoded `SnapchefUser`; `signOut` keeps the bare `Effect.tryPromise` shape (sanctioned exception — `{ error }`-only response).

**Contract**: The adapter cannot reuse `tryErrorDataWithSchema` as-is (it folds the `{error}` branch before classification is possible). Build a small adapter-internal lifting helper that branches on `isAuthApiError(error)` before constructing the typed failure. Always forward `cause`.

#### 3. Refactor `AuthenticatorUC` to a thin port wrapper

**File**: `src/lib/core/uc/auth/AuthenticatorUC.ts`

**Intent**: Constructor takes `private readonly authenticator: Authenticator` (`import type` from `core/boundry/auth`). Methods delegate 1:1 and return domain outcomes: `signIn`/`signUp` return `Effect.Effect<SnapchefUser, SnapchefServerError>` (no more `{ redirect }`), `signOut`/`getUser` unchanged in shape. All Supabase imports, the `AuthUser` schema, `zod`, and the `utils/supabase` import disappear — this removes the codebase's only inward-dependency violation. The UC is intentionally near-pass-through; F-02's verification rules land here.

**Contract**: File keeps its name/path; `App.Locals` typing in `src/env.d.ts` is unchanged.

#### 4. Move redirect decisions to the routes

**Files**: `src/pages/api/auth/signin.ts`, `src/pages/api/auth/signup.ts`

**Intent**: Each route maps the domain outcome to the wire response: signin pipes `Effect.as<RedirectTarget>({ redirect: "/recipes" })`, signup pipes `{ redirect: "/auth/confirm-email" }`. The redirect literal now lives in the file that owns routing context — where F-02's verified/unverified branch will naturally go. `signout.ts` is unchanged.

**Contract**: Wire contract is identical — clients still receive `{ ok: true, data: { redirect } }` validated against `RedirectTarget`; no component changes.

#### 5. Wire the adapter in the composition root

**File**: `src/middleware.ts`

**Intent**: `injectDependencies` builds `new AuthenticatorUC(createSupabaseAuthenticator(supabase))`. `setUserInContext` and `checkProtectedRoutes` are untouched.

**Contract**: Per-request wiring, fail-fast on missing Supabase — unchanged semantics.

#### 6. Sync the conventions docs that show the old auth shape

**Files**: `docs/reference/conventions/use-cases.md`, `docs/reference/conventions/effect.md`

**Intent**: `use-cases.md` currently presents `AuthenticatorUC(SupabaseClient)` as the ✓ "thin wrapper" example — replace with the port-injected shape (the "raw adapter client" escape hatch may stay documented as an option, but the live example must match the code). `effect.md`'s exception list for the `tryError…` helpers gains the auth-adapter case: semantic classification of Supabase Auth errors happens in `infrastructure/auth/` with `isAuthApiError`, before the generic fold.

**Contract**: Docs-only; the binding conventions must not teach the pre-fix pattern.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Core is Supabase-free: `grep -rn "@supabase" src/lib/core` returns nothing
- Core has no runtime `utils/supabase` import: `grep -rn "utils/supabase" src/lib/core` returns nothing

#### Manual Verification:

- Sign-in with valid credentials → redirected to `/recipes`; sign-up → `/auth/confirm-email`; sign-out → `/`.
- Sign-in with wrong password → **401** envelope with the auth message (and `cause` present in the payload).
- Sign-in with local Supabase stopped → **500-family** envelope (`SnapchefExternalSystemError`), not 401.
- Anonymous visit to `/recipes` still redirects to `/auth/signin` (the `getUser` → `user: null` path survived).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Disband the `utils/` Escape Hatch (R3 / W3)

### Overview

Relocate the two misplaced `utils/` modules to their architectural homes, leaving `utils/` with exactly `effect.ts` plus a written direction rule.

### Changes Required:

#### 1. Move the Supabase Effect bridge into infrastructure

**File**: `src/lib/utils/supabase.ts` → `src/lib/infrastructure/db/supabase-effect.ts`

**Intent**: Move the file wholesale (`tryErrorData`, `tryErrorDataOption`, `tryErrorDataWithSchema`); convert its relative imports (`../core/model/error`, `./effect`) to `@/lib/...` aliases. Update importers: `RecipeSessionRepository.ts`, `SessionPhotoStorage.ts`. Kebab-case name is correct — it's a grab-bag helper module, not a port implementation.

**Contract**: Function signatures unchanged; only the import path moves.

#### 2. Split `utils/recipe.ts` along the hexagon boundary

**Files**: `src/lib/utils/recipe.ts` (deleted) → `src/lib/infrastructure/db/recipe-session-row.ts` (new) + `src/lib/core/model/recipe/markdown.ts` (new)

**Intent**: `RecipeSessionRowSchema` + `RecipeSessionFromRow` (DB column knowledge) move to `infrastructure/db/recipe-session-row.ts`, sibling to their only consumer (`RecipeSessionRepository.ts` — update its import). `serializeItemsToMarkdown` (the domain's `[name, quantity]` → markdown rule that S-01/S-03 depend on) moves to `core/model/recipe/markdown.ts`, re-exported from the `core/model/recipe` barrel.

**Contract**: No logic changes; pure relocation.

#### 3. Move `RecognizedItem` from boundry to the domain model

**Files**: `src/lib/core/boundry/recipe/ports.ts`, `src/lib/core/model/recipe/index.ts`

**Intent**: `RecognizedItem` (schema + type) moves to `core/model/recipe` — it is a domain concept, and `markdown.ts` (core/model) must not import from `core/boundry` (reversed arrow within core). `ports.ts` imports it from the model like it already imports `RecipeSession`.

**Contract**: `ProductRecognizer`'s method signatures are unchanged; only the schema's home moves. Keep a re-export from the `boundry/recipe` barrel only if a non-core consumer needs it (currently none — prefer no re-export).

#### 4. Write the `utils/` direction rule

**File**: `src/lib/CLAUDE.md`

**Intent**: Add one line to the layer rules: _`utils/` may contain only modules importable from both `core` and `infrastructure` without violating dependency direction — currently exactly `effect.ts`; anything Supabase-, DB-, or domain-specific is misplaced._

#### 5. Sync doc references to the moved files

**Files**: `docs/reference/conventions/effect.md`, `docs/reference/conventions/zod.md`, `docs/reference/conventions/ports-and-adapters.md`, root `CLAUDE.md`

**Intent**: Update every `@/lib/utils/supabase` reference to `@/lib/infrastructure/db/supabase-effect`, and every `utils/recipe.ts` / `src/lib/utils/recipe.ts` reference to the new locations. Root `CLAUDE.md`'s `src/lib/utils/` description becomes the direction rule summary.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Old modules gone: `test ! -f src/lib/utils/supabase.ts && test ! -f src/lib/utils/recipe.ts`
- No stale imports: `grep -rn "utils/supabase\|utils/recipe" src docs CLAUDE.md` returns nothing
- `utils/` contains only the shared kernel: `ls src/lib/utils/` shows exactly `effect.ts`

#### Manual Verification:

- Sign-in, session create, and photo upload all still work end-to-end (pure-relocation smoke test).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: Settle the `boundry/` Taxonomy (R7 / W7)

### Overview

One taxonomy across all boundry domains — `ports.ts` (driven contracts + their payload DTOs), `commands.ts` (driving-side input schemas), `responses.ts` (driving-side response schemas), `dto.ts` (genuine shared constants) — applied to `auth` and `recipe`, and documented where agents will read it.

### Changes Required:

#### 1. Restructure `boundry/auth/`

**Files**: `src/lib/core/boundry/auth/commands.ts` (new), `src/lib/core/boundry/auth/responses.ts` (new), `src/lib/core/boundry/auth/index.ts`, `src/lib/core/boundry/auth/ports.ts`

**Intent**: `UserCredentials` moves from `core/model/auth` to `commands.ts` (it is the sign-in/sign-up command shared by React forms and API routes — exactly what root `CLAUDE.md` says `boundry` holds). `RedirectTarget` moves from `index.ts` to `responses.ts`. `index.ts` becomes a pure barrel re-exporting `./ports`, `./commands`, `./responses` — so `SignInForm.tsx`/`SignUpForm.tsx` (which import `RedirectTarget` from the barrel) need no changes. `ports.ts` updates its `UserCredentials` import to `./commands` (relative sibling, not the barrel — circularity).

**Contract**: `core/model/auth` keeps `UserId` and `SnapchefUser` (pure domain models). Importers of `UserCredentials` update: `signin.ts`, `signup.ts` (→ `@/lib/core/boundry/auth`).

#### 2. Align `boundry/recipe/` with the same taxonomy

**Files**: `src/lib/core/boundry/recipe/ports.ts`, `src/lib/core/boundry/recipe/dto.ts`, `src/lib/core/boundry/recipe/index.ts`

**Intent**: Mostly already conformant after Phase 3: `ports.ts` holds the three driven ports plus `RecipeSessionUpdatePayload` (a driven-side payload DTO — stays with its ports per review R7); `dto.ts` holds the upload-limit constants (genuine shared constants — stays). No `commands.ts`/`responses.ts` are created empty; S-02 adds them when it has content. Verify the barrel re-exports match.

**Contract**: No symbol moves in this step beyond what Phase 3 already did; this is the conformance check + any barrel tidy-up.

#### 3. Document the taxonomy where agents read it

**Files**: root `CLAUDE.md`, `docs/reference/conventions/ports-and-adapters.md`, `src/lib/CLAUDE.md`

**Intent**: Root `CLAUDE.md`'s `core/boundry` description drops the stale `SignInCommand` example and states the taxonomy (`ports.ts` driven / `commands.ts` + `responses.ts` driving / `dto.ts` shared constants), citing `UserCredentials` as the live example. `ports-and-adapters.md` gains the taxonomy as a rule (with ✓/✗ per house style). `src/lib/CLAUDE.md`'s component-access entry stays accurate ("command and response schemas from `core/boundry/**`" — now literally true).

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run build`
- `UserCredentials` left the model: `grep -n "UserCredentials" src/lib/core/model/auth/index.ts` returns nothing
- Taxonomy files exist: `ls src/lib/core/boundry/auth/` shows `commands.ts`, `index.ts`, `ports.ts`, `responses.ts`
- No stale doc reference: `grep -rn "SignInCommand" CLAUDE.md docs` returns nothing

#### Manual Verification:

- Sign-in and sign-up forms still validate and submit successfully (the command schema move is invisible on the wire).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- None in this change — R6 (Vitest + fake-port `RecipeSessionUC` test) is deferred to the foundation test-plan rollout by explicit decision. When it lands, its first test should pin Phase 1's unmasked pass-through (repository failure ≠ 404).

### Integration Tests:

- None automated; the manual steps below cover the behavioral surface.

### Manual Testing Steps:

1. `mise run db-start` + `npm run dev`; sign up a fresh user (unique email) → lands on `/auth/confirm-email` message flow.
2. Sign in with valid credentials → redirected to `/recipes`.
3. Sign in with a wrong password → 401 envelope, auth message shown in the form, `cause` populated.
4. Create a session, upload 1–2 photos → session state `photos_uploaded`, paths persisted.
5. `POST /api/recipe-sessions/{random-uuid}/upload` with a valid auth cookie → 404 "Session not found".
6. `mise run db-stop`, then attempt sign-in and upload → both return 500-family `SnapchefExternalSystemError` envelopes (not 401/404); `npx wrangler tail`-style dev logs show the preserved `cause`.
7. Visit `/recipes` signed out → redirected to `/auth/signin`.

## Performance Considerations

None — all changes are structural; no new I/O, no added request-path work. The error classification adds a constant-time `instanceof`-style check per auth call.

## Migration Notes

No DB migrations, no wire-contract changes (`ApiResponsePayload` envelope and `RedirectTarget` payloads are byte-identical). Deploys via Workers Builds on `main` as usual; no coordination needed.

## References

- Review (source of all findings): `context/changes/hexagonal-architecture-review/hexagonal-architecture-review.md`
- Pattern to copy for the auth adapter: `src/lib/infrastructure/db/RecipeSessionRepository.ts:68-72` (factory anchored to port)
- Pattern to copy for the port: `src/lib/core/boundry/recipe/ports.ts:17-30`
- Composition root: `src/middleware.ts:19-30`
- Conventions affected: `docs/reference/conventions/{use-cases,effect,zod,ports-and-adapters}.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Recipe-Side Error Fidelity + UC Hygiene

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — ada43ac63
- [x] 1.2 Build passes: `npm run build` — ada43ac63
- [x] 1.3 No blanket rewrite remains (`andThen((session) => session)` grep empty) — ada43ac63
- [x] 1.4 Dead members gone (`recognizeProducts`/`_productRecognizer` grep empty) — ada43ac63

#### Manual

- [x] 1.5 Photo upload to existing session succeeds end-to-end — ada43ac63
- [x] 1.6 Upload to random session id returns 404 "Session not found" — ada43ac63
- [x] 1.7 Upload with Supabase stopped returns 500-family error, not 404 — ada43ac63

### Phase 2: Auth Port + Supabase Adapter, Auth Error Fidelity, Domain Outcomes

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — 77bffdd08
- [x] 2.2 Build passes: `npm run build` — 77bffdd08
- [x] 2.3 Core is Supabase-free (`@supabase` grep in `src/lib/core` empty) — 77bffdd08
- [x] 2.4 Core has no `utils/supabase` import (grep empty) — 77bffdd08

#### Manual

- [x] 2.5 Sign-in → `/recipes`; sign-up → `/auth/confirm-email`; sign-out → `/` — 77bffdd08
- [x] 2.6 Wrong password → 401 with auth message and `cause` — 77bffdd08
- [x] 2.7 Supabase stopped → sign-in returns 500-family, not 401 — 77bffdd08
- [x] 2.8 Anonymous `/recipes` visit redirects to `/auth/signin` — 77bffdd08

### Phase 3: Disband the `utils/` Escape Hatch

#### Automated

- [x] 3.1 Lint passes: `npm run lint` — 503fce6ba
- [x] 3.2 Build passes: `npm run build` — 503fce6ba
- [x] 3.3 Old `utils/supabase.ts` and `utils/recipe.ts` deleted — 503fce6ba
- [x] 3.4 No stale `utils/supabase`/`utils/recipe` references in `src`, `docs`, `CLAUDE.md` — 503fce6ba
- [x] 3.5 `src/lib/utils/` contains exactly `effect.ts` — 503fce6ba

#### Manual

- [x] 3.6 Sign-in, session create, photo upload smoke test passes — 503fce6ba

### Phase 4: Settle the `boundry/` Taxonomy

#### Automated

- [x] 4.1 Lint passes: `npm run lint`
- [x] 4.2 Build passes: `npm run build`
- [x] 4.3 `UserCredentials` removed from `core/model/auth`
- [x] 4.4 `boundry/auth/` contains `commands.ts`, `index.ts`, `ports.ts`, `responses.ts`
- [x] 4.5 No stale `SignInCommand` reference in `CLAUDE.md`/`docs`

#### Manual

- [x] 4.6 Sign-in and sign-up forms validate and submit successfully
