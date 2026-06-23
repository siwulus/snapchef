# Centralized State Machine & Transition Aspect for Recipe Sessions — Implementation Plan

## Overview

`RecipeSession` has a `state` enum but no state machine: every transition in `RecipeSessionUC` is an unguarded side effect that hardcodes the next state via `sessionRepository.update(..., { state })`. This lets the API skip steps (e.g. `created → recipe_generated`, `photos_uploaded → saved`). This plan introduces an event-driven FSM reducer (ts-pattern `match`) and a transition **aspect** that becomes the **sole writer** of `state`, guarding legality before any side effect and removing all hardcoded state writes from the use case.

## Current State Analysis

- **States** (`src/lib/core/model/recipe/index.ts:4`): `created → photos_uploaded → products_recognized → recipe_generated → saved`. DB CHECK constrains the _values_ (`supabase/migrations/20260606120000_add_recipe_session_state.sql:9`) but not ordering.
- **Transitions are unguarded side effects** in `RecipeSessionUC` (`src/lib/core/uc/recipe/RecipeSessionUC.ts`): `markPhotosUploaded` (`:246`) → `photos_uploaded`; `persistRecognizedItems` (`:292`) → `products_recognized`; `generateRecipe` inline (`:116`) → `recipe_generated`; `saveSession` (`:128`) → `saved` (explicitly "no precondition"). Nothing reads `session.state` to decide legality.
- **Deliberate re-runnability**: `recognizeProducts` is documented "any state with photos may re-run" (`:50`); photos can be re-uploaded from later states; generate/save are idempotent. So the legal graph is not linear — it has self-loops and backward re-edit edges.
- **Adapter** (`src/lib/infrastructure/db/RecipeSessionRepository.ts`): `update` maps camelCase→snake_case via a `toRecipeSessionUpdate` helper, then `Effect.transposeMapOption(option, decodeWith(RecipeSessionFromRow))`; `find` uses `.maybeSingle()` → `Option`. `RecipeSessionFromRow` lives in `src/lib/infrastructure/db/types/converters.ts` (the `state` column maps identity, re-validated by `.pipe(RecipeSession)`).
- **Errors**: `SnapchefConflictError` (409) and `SnapchefBusinessRuleViolationError` (422) both exist in `src/lib/core/model/error/index.ts` with `{ message, cause? }`; the boundary mapper reads `code` directly, so no mapper edit is needed for either.
- **Routes are thin** (`src/pages/api/recipe-sessions/[id]/{upload,recognition,recipe-generation,save}.ts`): they call the UC method and either pass the result through `runApiRoute`, re-validate it against a `core/boundry` response schema, or (save) discard it for a redirect. **No route changes are needed** as long as UC return shapes are preserved.
- **Tests** (`src/lib/core/uc/recipe/RecipeSessionUC.test.ts`): hand-rolled fakes implementing the port interfaces; `Effect.runPromise(Effect.either(...))` + `Either.isRight/isLeft`. State is asserted via the `update` payload (`updateCalls.some(c => c.state === …)`). `attachPhotos`/`recognizeProducts` have no unit coverage.

## Desired End State

- A pure `nextState(event)(from)` reducer encodes the agreed legal graph and fails `SnapchefConflictError` (409) on any illegal `(state, event)` pair.
- A `SessionStateManager.run(event, userId, sessionId, action)` aspect is the **only** code that writes `state` (via a new `RecipeSessionRepository.transition`). It loads + owns the session, guards the event _before_ running `action`, runs the business `action`, then writes the derived state as the closing step.
- `RecipeSessionUC` business methods perform data-only writes and never name a state. `RecipeSessionUpdatePayload` no longer contains `state` — a green build proves nothing writes state via `update`.
- Out-of-order calls return 409: `created → save`, `photos_uploaded → generate`, etc. The wizard happy path and all current re-runs still work.

### Key Discoveries:

- `getOrThrowNotFound(message)(option)` fails `SnapchefNotFoundError` on `None` (`src/lib/utils/effect.ts:54`) — the aspect reuses it for both the initial load and the post-transition read.
- `Effect.transposeMapOption(option, decodeWith(RecipeSessionFromRow))` is the adapter's decode pattern (`RecipeSessionRepository.ts` `find`/`update`) — `transition` mirrors it exactly with a `{ state }` patch.
- `RecipeSessionUC`'s constructor argument order is binding and matched in `src/middleware.ts:53` — the manager is **injected** as a new constructor parameter (composed in middleware from the same `sessionRepository` instance), keeping the dependency external and test-substitutable. Middleware and the constructor signature both change; `App.Locals` does not (the manager is internal to the UC).
- `guardHasPhotos` (`RecipeSessionUC.ts:252`) is a _data_ guard (422) and stays — it is complementary to the FSM's _state_ guard.

## What We're NOT Doing

- **No route changes** — all four API routes are preserved; UC return shapes are unchanged.
- **Minimal DI change** — `src/middleware.ts` composes the manager and injects it into `RecipeSessionUC` (the constructor gains one parameter). No `App.Locals` change — the manager is an internal collaborator of the UC, not exposed on `context.locals`.
- **No optimistic-concurrency (CAS)** — `transition(userId, sessionId, to)` has no `from` check (deferred; single-user sessions). Can be added later without an API change.
- **No DB-level transition trigger** — enforcement stays in the app layer per conventions.
- **`deleteSession` is untouched** — a hard delete is a destroy, not a transition.
- **Read methods unchanged** — `getSavedRecipe`/`listSavedRecipes` assert state for visibility; they don't transition.
- **No new migration** — the existing `state` column/CHECK is sufficient.

## Implementation Approach

Build inside-out so every phase ends green: pure reducer (Phase 1) → additive repository `transition` seam (Phase 2) → additive aspect (Phase 3) → UC refactor that finally drops `state` from the write payload (Phase 4). The enforcement seal (dropping the payload field) is the **last** edit, after the UC no longer writes state, so the build never breaks at a phase boundary.

## Critical Implementation Details

- **Ordering — drop `state` last.** Within Phase 4, refactor every UC method off `update({ state })` _before_ removing `state` from `RecipeSessionUpdatePayload`. Doing it in the other order leaves the build red mid-phase (it still compiles green at phase end either way, but drop-last keeps intermediate states buildable).
- **`generateRecipe`'s early write stays inside the action.** Inputs (`correctedItems`, `mealContext`, `allowExtraIngredients`) are persisted via a data-only `update` _inside_ the business action, before generation, so a generation failure leaves the session re-runnable with its inputs saved. This is why the aspect's close is **state-only** (a single combined data+state write would defer the input persistence and lose that property).
- **Guard precedes side effects.** `nextState` runs and may fail 409 _before_ `action` executes; an illegal call must never upload, recognize, or generate. The aspect's test asserts this explicitly.

---

## Phase 1: FSM Reducer (pure)

### Overview

Add the pure, framework-free reducer and its unit test. No dependencies on infrastructure or the UC — fully isolated and table-testable.

### Changes Required:

#### 1. FSM reducer

**File**: `src/lib/core/model/recipe/recipe-session-state-machine.ts` (new)

**Intent**: Define the domain events and a `nextState` reducer that derives the target state for a legal `(state, event)` pair and fails 409 otherwise. The UC will dispatch events, never name target states.

**Contract**: `RecipeSessionEvent = z.enum([...])` (+ inferred type, same-name convention). `nextState(event)(from): Effect.Effect<RecipeSessionState, SnapchefServerError>` — only failure produced is `SnapchefConflictError`. Encodes the 11 legal edges via `P.union` arms + `.otherwise → fail`:

```ts
import { match, P } from "ts-pattern";
import { Effect } from "effect";
import { z } from "zod";
import { SnapchefConflictError, type SnapchefServerError } from "@/lib/core/model/error";
import { RecipeSessionState } from "./index";

export const RecipeSessionEvent = z.enum(["upload_photos", "recognize_products", "generate_recipe", "save"]);
export type RecipeSessionEvent = z.infer<typeof RecipeSessionEvent>;

export const nextState =
  (event: RecipeSessionEvent) =>
  (from: RecipeSessionState): Effect.Effect<RecipeSessionState, SnapchefServerError> =>
    match([from, event] as const)
      .with([P.union("created", "photos_uploaded", "products_recognized", "recipe_generated"), "upload_photos"], () =>
        Effect.succeed<RecipeSessionState>("photos_uploaded"),
      )
      .with([P.union("photos_uploaded", "products_recognized", "recipe_generated"), "recognize_products"], () =>
        Effect.succeed<RecipeSessionState>("products_recognized"),
      )
      .with([P.union("products_recognized", "recipe_generated"), "generate_recipe"], () =>
        Effect.succeed<RecipeSessionState>("recipe_generated"),
      )
      .with([P.union("recipe_generated", "saved"), "save"], () => Effect.succeed<RecipeSessionState>("saved"))
      .otherwise(([s, e]) => Effect.fail(new SnapchefConflictError({ message: `Cannot ${e} from state ${s}` })));
```

#### 2. Reducer unit test

**File**: `src/lib/core/model/recipe/recipe-session-state-machine.test.ts` (new)

**Intent**: Table-test every legal edge maps to its expected target, and that representative illegal pairs (`created`→generate, `photos_uploaded`→save, any event from `saved` except save, etc.) fail with `SnapchefConflictError`.

**Contract**: vitest, mirroring the `Effect.runPromise(Effect.either(...))` + `Either.isRight/isLeft` assertion style of `RecipeSessionUC.test.ts`. Assert `error instanceof SnapchefConflictError` and `error.code === 409` on the failure branch.

### Success Criteria:

#### Automated Verification:

- Lint passes: `pnpm lint`
- Reducer unit test passes: `pnpm test`

#### Manual Verification:

- The 11 legal edges in the reducer match the agreed graph (upload from all non-`saved`; recognize from photos_uploaded/products_recognized/recipe_generated; generate from products_recognized/recipe_generated; save from recipe_generated/saved).

**Implementation Note**: After automated verification passes, pause for human confirmation before proceeding.

---

## Phase 2: Repository `transition` Seam

### Overview

Add `transition` to the port and adapter (additive — the build stays green; `RecipeSessionUpdatePayload` keeps `state` for now). Add `transition` to the test fakes so the existing suite still compiles.

### Changes Required:

#### 1. Port: add `transition`

**File**: `src/lib/core/boundry/recipe/ports.ts`

**Intent**: Declare `transition` as the dedicated state-writer on `RecipeSessionRepository`. (Do **not** drop `state` from `RecipeSessionUpdatePayload` yet — that is Phase 4.)

**Contract**: `transition(userId: UserId, sessionId: string, to: RecipeSessionState): Effect.Effect<Option.Option<RecipeSession>, SnapchefServerError>`. Requires importing `RecipeSessionState` (type) from `@/lib/core/model/recipe`.

#### 2. Adapter: implement `transition`

**File**: `src/lib/infrastructure/db/RecipeSessionRepository.ts`

**Intent**: Implement `transition` as an owner-scoped `update({ state: to })`, decoded via the same `transposeMapOption(decodeWith(RecipeSessionFromRow))` pattern as `update`. Add it to the returned factory object.

**Contract**: Curried `(supabase) => (userId, sessionId, to) => Effect<Option<RecipeSession>, …>`, scoped by `.eq("user_id", userId).eq("id", sessionId)`, writing the `state` column (reuse the snake_case mapping). No `from`-state predicate (CAS deferred).

#### 3. Test fakes: add `transition`

**File**: `src/lib/core/uc/recipe/RecipeSessionUC.test.ts`

**Intent**: Add a `transition` method to every fake `RecipeSessionRepository` (recording into a `transitionCalls: RecipeSessionState[]` array, returning `Effect.succeed(Option.some({ ...session, state: to }))`) so the suite compiles against the widened interface. Assertions are not migrated yet (Phase 4).

**Contract**: Fake `transition` mirrors the existing fake `update` recorder shape.

### Success Criteria:

#### Automated Verification:

- Lint passes: `pnpm lint`
- Existing suite still passes (no behavior change yet): `pnpm test`

#### Manual Verification:

- `transition` is wired into the adapter factory object alongside `create`/`update`/`find`/`remove`.

**Implementation Note**: After automated verification passes, pause for human confirmation before proceeding.

---

## Phase 3: Transition Aspect

### Overview

Add the `SessionStateManager` aspect and its unit test. Additive — it consumes the Phase 1 reducer and the Phase 2 `transition`; nothing calls it yet.

### Changes Required:

#### 1. The aspect

**File**: `src/lib/core/uc/recipe/recipe-session-transition.ts` (new)

**Intent**: A factory `createSessionStateManager(repository)` returning `{ run }`. `run` loads + owns the session, guards the event via `nextState`, runs the business `action`, then writes the derived state via `repository.transition` as the closing step, returning `{ result, session }`.

**Contract**: load → guard → work → close pipeline (other phases depend on this exact signature):

```ts
export interface TransitionOutcome<A> {
  result: A;
  session: RecipeSession;
}
export interface SessionStateManager {
  run<A>(
    event: RecipeSessionEvent,
    userId: UserId,
    sessionId: string,
    action: (session: RecipeSession) => Effect.Effect<A, SnapchefServerError>,
  ): Effect.Effect<TransitionOutcome<A>, SnapchefServerError>;
}

export const createSessionStateManager = (repository: RecipeSessionRepository): SessionStateManager => ({
  run: (event, userId, sessionId, action) =>
    repository.find(userId, sessionId).pipe(
      Effect.flatMap(getOrThrowNotFound("Session not found")),
      Effect.flatMap((session) =>
        nextState(event)(session.state).pipe(
          Effect.flatMap((to) =>
            action(session).pipe(
              Effect.flatMap((result) =>
                repository.transition(userId, sessionId, to).pipe(
                  Effect.flatMap(getOrThrowNotFound("Session not found")),
                  Effect.map((session) => ({ result, session })),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
});
```

#### 2. Aspect unit test

**File**: `src/lib/core/uc/recipe/recipe-session-transition.test.ts` (new)

**Intent**: Prove the three guarantees with a fake repository + a recording `action`.

**Contract**: (a) legal event → `action` runs once and `transition` is called with the derived state; (b) illegal event → fails `SnapchefConflictError` and the `action` recorder stayed empty (guard precedes side effects); (c) `action` failure → error surfaces and `transition` was **not** called (state not advanced); (d) missing session (`find` → None) → `SnapchefNotFoundError` before the guard.

### Success Criteria:

#### Automated Verification:

- Lint passes: `pnpm lint`
- Aspect + reducer tests pass: `pnpm test`

#### Manual Verification:

- Aspect test (b) asserts the `action` side-effect recorder is empty on an illegal event.

**Implementation Note**: After automated verification passes, pause for human confirmation before proceeding.

---

## Phase 4: UC Refactor + Enforcement Seal + Test Migration

### Overview

Route the four mutating methods through the aspect, delete all hardcoded state writes, drop `state` from `RecipeSessionUpdatePayload` (last), and migrate/extend the UC tests. End state: nothing writes `state` except the aspect, proven by a green build.

### Changes Required:

#### 1. UC: inject the manager + refactor the four methods

**File**: `src/lib/core/uc/recipe/RecipeSessionUC.ts`

**Intent**: Add a constructor-injected `private readonly sessions: SessionStateManager` parameter (appended after `recipeGenerator`) — do **not** build it inside the constructor. Rewrite the four methods to dispatch events through `this.sessions.run`, with business `action`s doing data-only writes:

- `attachPhotos` → `run("upload_photos", …, (session) => removeExistingPhotos(session) ⟶ uploadAndPersistPhotos(session, files))`; map outcome to `session`. **Delete `markPhotosUploaded`.**
- `recognizeProducts` → `run("recognize_products", …, (session) => listBySession ⟶ guardHasPhotos ⟶ recognizeEachPhoto ⟶ resolveItems ⟶ update({ recognizedItems }))`; map outcome to `{ session, photos: result }`. **Replace `persistRecognizedItems`'s state write with a data-only `update`.**
- `generateRecipe` → `run("generate_recipe", …, () => update({ correctedItems, mealContext, allowExtraIngredients }) ⟶ generate ⟶ recipeRepository.upsert)`; map outcome to `{ recipe: result, session }`. **Remove the inline `{ state: "recipe_generated" }` write.**
- `saveSession` → `run("save", …, () => Effect.void)`; map outcome to `session`. **Remove the `update({ state: "saved" })` write** (the aspect's `find`+`getOrThrowNotFound` preserves the ownership/not-found behavior).

**Contract**: Preserve every public return type exactly — `attachPhotos`/`saveSession` → `RecipeSession`; `recognizeProducts` → `{ session, photos }`; `generateRecipe` → `RecipeGenerationResult` (`{ recipe, session }`). The constructor gains a 7th parameter `sessions: SessionStateManager` (wired in step 2). Keep `guardHasPhotos`, `fetchRecipeSession` (still used by `deleteSession`/reads), and `logResult` labels. `createSession`/`deleteSession`/read methods unchanged.

#### 2. Middleware: compose and inject the manager

**File**: `src/middleware.ts`

**Intent**: In `injectDependencies`, extract the session repository into a local, then build `createSessionStateManager(sessionRepository)` and pass it as the new last argument to `new RecipeSessionUC(...)`. This is the single composition root where the port meets the aspect.

**Contract**: Reuse one `sessionRepository` instance for both the 1st constructor arg and the manager: `const sessionRepository = createRecipeSessionRepository(supabase); … new RecipeSessionUC(sessionRepository, …, createSessionStateManager(sessionRepository))`. Import `createSessionStateManager` from `@/lib/core/uc/recipe/recipe-session-transition`. `App.Locals` / `env.d.ts` unchanged.

#### 3. Enforcement seal: drop `state` from the write payload

**File**: `src/lib/core/boundry/recipe/ports.ts`

**Intent**: Remove `state: true` from `RecipeSessionUpdatePayload.pick({...})` so business code can no longer write state via `update`. Do this **after** step 1 compiles.

**Contract**: `RecipeSessionUpdatePayload = RecipeSession.pick({ correctedItems, mealContext, recognizedItems, allowExtraIngredients }).partial()`. In the same step, **remove the `["state", data.state]` entry from `toRecipeSessionUpdate` (`RecipeSessionRepository.ts:40-51`)** — once `state` leaves the payload type, `data.state` no longer typechecks there. `transition` becomes the only state writer.

#### 4. Migrate + extend UC tests

**File**: `src/lib/core/uc/recipe/RecipeSessionUC.test.ts`

**Intent**: Wire the **real** manager into every `new RecipeSessionUC(...)` via `createSessionStateManager(fakeSessionRepo)`, so UC tests double as UC+aspect+reducer integration tests. Each test's fake `find` must return a `from`-state from which the dispatched event is legal — in particular the `saveSession` tests must use a `recipe_generated` (or `saved`) session, **not** `baseSession` (state `products_recognized` at `:31`, illegal for `save` → would now 409). Build the pipeline fakes the new coverage needs (`photoRepository.listBySession` returning photos, a `productRecognizer` whose `recognizePhoto`/`mergeItems` return items, a `photosStorage`). Move state assertions from `updateCalls.some(c => c.state === …)` to the `transitionCalls` recorder added in Phase 2. Add coverage for the new guarantees.

**Contract**:

- `generateRecipe` success: inputs in `updateCalls`, final state via `transitionCalls` includes `recipe_generated`. Failure: inputs still in `updateCalls`, `transitionCalls` does **not** include `recipe_generated`.
- `saveSession`: `transitionCalls` includes `saved`; missing/foreign session → `SnapchefNotFoundError`; **new** — `save` from `created`/`photos_uploaded` → `SnapchefConflictError` (409).
- **New** coverage for `attachPhotos` (→ `photos_uploaded`) and `recognizeProducts` (→ `products_recognized`) state transitions and a representative illegal call.
- **Fixtures**: `generateRecipe` tests keep `baseSession` (`products_recognized`, legal for `generate_recipe`); `saveSession` tests switch to a `recipe_generated`/`saved` fixture; `attachPhotos`/`recognizeProducts` tests replace the `{} as PhotoRepository`/`{} as SessionPhotoStorage` stubs with working pipeline fakes.

### Success Criteria:

#### Automated Verification:

- Lint passes: `pnpm lint`
- All unit tests pass (migrated + new): `pnpm test`
- Production build (type-checks the whole app) passes: `pnpm build`
- E2E smoke passes (happy path unaffected): `pnpm test:e2e` (fake-LLM flag)

#### Manual Verification:

- Wizard happy path works end-to-end: upload → recognize → generate → save.
- An out-of-order call returns 409: e.g. POST `save` before generation, or `generate` from `photos_uploaded`.
- Re-runs still work: re-upload from a later state; re-recognize (self-loop); re-generate; re-save (idempotent).
- A `saved` session rejects re-upload/re-recognize/re-generate with 409 (terminal).
- The session manager is injected via `src/middleware.ts` (not constructed inside the UC).

**Implementation Note**: After automated verification passes, pause for human confirmation before considering the change complete.

---

## Testing Strategy

### Unit Tests:

- **Reducer**: all 11 legal edges → expected target; representative illegal pairs → `SnapchefConflictError` (409).
- **Aspect**: guard-before-side-effects (illegal event leaves `action` un-run), state-advances-only-on-success (action failure → no `transition`), not-found before guard, happy path calls `transition` with the derived state.
- **UC**: migrated state assertions via `transitionCalls`; new illegal-transition (409) and save-tightening cases; new `attachPhotos`/`recognizeProducts` transition coverage.

### Integration Tests:

- Existing E2E smoke (`critical recipe flow`, `wizard cancel/delete`) must stay green — the happy path is fully legal under the FSM.

### Manual Testing Steps:

1. Run the wizard end-to-end (upload → recognize → generate → save) and confirm success + redirect.
2. POST `save` on a freshly created session → expect 409.
3. POST `recipe-generation` on a `photos_uploaded` session → expect 409.
4. Re-run recognize on a `products_recognized` session → expect success (self-loop).
5. Re-upload photos on a `recipe_generated` session → expect success → state back to `photos_uploaded`.

## Migration Notes

No DB migration. The change is code-only; the existing `state` column/CHECK is sufficient. Backward-compatible with a Worker rollback (the reducer/aspect simply disappear; `transition` writes the same column `update` did).

**Behavior delta:** out-of-order recipe-session calls now uniformly return **409** (`SnapchefConflictError`) — previously some returned 422 (`recognizeProducts` from `created` via `guardHasPhotos`) or silently succeeded (`saveSession` from any state). Clients surface `error.message` regardless of status (`useApiClient` toast), and the in-order wizard never hits these paths, so UX is unaffected. `guardHasPhotos` (422) still fires for the legal-but-empty case (recognize from `photos_uploaded` with zero photos).

## References

- Change doc: `context/changes/recepie-session-state-machine/change.md`
- Reducer pattern precedent: ts-pattern `match` rule in `docs/reference/conventions/generic.md`
- Adapter decode pattern: `src/lib/infrastructure/db/RecipeSessionRepository.ts` (`find`/`update`)
- Error family: `src/lib/core/model/error/index.ts` (`SnapchefConflictError` :32)
- Test style precedent: `src/lib/core/uc/recipe/RecipeSessionUC.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: FSM Reducer (pure)

#### Automated

- [x] 1.1 Lint passes: `pnpm lint` — 577289b8a
- [x] 1.2 Reducer unit test passes: `pnpm test` — 577289b8a

#### Manual

- [x] 1.3 The 11 legal edges match the agreed graph — 577289b8a

### Phase 2: Repository `transition` Seam

#### Automated

- [x] 2.1 Lint passes: `pnpm lint` — bd2f8c36b
- [x] 2.2 Existing suite still passes: `pnpm test` — bd2f8c36b

#### Manual

- [x] 2.3 `transition` wired into the adapter factory object — bd2f8c36b

### Phase 3: Transition Aspect

#### Automated

- [x] 3.1 Lint passes: `pnpm lint` — 0cc51e8af
- [x] 3.2 Aspect + reducer tests pass: `pnpm test` — 0cc51e8af

#### Manual

- [x] 3.3 Aspect test asserts `action` recorder empty on illegal event — 0cc51e8af

### Phase 4: UC Refactor + Enforcement Seal + Test Migration

#### Automated

- [x] 4.1 Lint passes: `pnpm lint` — 7d2f232da
- [x] 4.2 All unit tests pass (migrated + new): `pnpm test` — 7d2f232da
- [x] 4.3 Production build passes: `pnpm build` — 7d2f232da
- [x] 4.4 E2E smoke passes: `pnpm test:e2e` (fake-LLM) — 7d2f232da

#### Manual

- [x] 4.5 Wizard happy path works end-to-end — 7d2f232da
- [x] 4.6 An out-of-order call returns 409 — 7d2f232da
- [x] 4.7 Re-runs still work (re-upload / re-recognize / re-generate / re-save) — 7d2f232da
- [x] 4.8 A `saved` session rejects re-edit events with 409 — 7d2f232da
- [x] 4.9 Session manager injected via middleware, not constructed inside the UC — 7d2f232da
