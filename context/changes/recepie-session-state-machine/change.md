---
change_id: recepie-session-state-machine
title: Centralized state machine and transition aspect for recipe sessions
status: implementing
created: 2026-06-23
updated: 2026-06-23
archived_at: null
---

## Notes

### Problem

`RecipeSession` has a `state` enum (`created → photos_uploaded → products_recognized → recipe_generated → saved`, `core/model/recipe/index.ts`) but **no state machine**. Every transition in `RecipeSessionUC` is an unguarded side effect: each method does its work, then hardcodes the next state via `sessionRepository.update(..., { state })`. Nothing reads `session.state` to decide whether the action is legal, so the API permits **step-skips** — e.g. `created → recipe_generated` or `photos_uploaded → saved`. The only existing guard (`guardHasPhotos`) checks data, not state.

A complication: several steps are deliberately **re-runnable** — `recognizeProducts` ("any state with photos may re-run"), re-uploading photos from later states, idempotent generate/save. The real legal graph is therefore not linear; it has self-loops and backward re-edit edges. Illegal = skipping a step.

### Decision

- **Guard legality with Approach B** — an event-driven `ts-pattern` `match` reducer.
- **Centralize the mechanics in a transition "aspect"** — a higher-order Effect that wraps every mutating operation with one envelope: load → guard → run business effect → close by writing the new state. Business logic in the UC stops touching `state` entirely (enforced at compile time).

### Components

1. **FSM reducer** — `core/model/recipe/recipe-session-state-machine.ts` (pure; zod + effect only).
   - `RecipeSessionEvent = z.enum(["upload_photos","recognize_products","generate_recipe","save"])`
   - `nextState(event)(from): Effect<RecipeSessionState, SnapchefConflictError>` — derives the target state or fails 409. Encodes forward steps + per-step self-loops + legal backward re-edits; the UC never names a target state, only an event.

2. **Port changes** — `core/boundry/recipe/ports.ts` (this is what _enforces_ the rule):
   - **Drop `state`** from `RecipeSessionUpdatePayload` → business code can no longer set it (every current `{ state: ... }` write stops compiling = the migration signal).
   - Add `transition(userId, sessionId, to): Effect<Option<RecipeSession>, SnapchefServerError>` — the **sole** state writer (adapter: owner-scoped `update({ state: to })` decoded via `RecipeSessionFromRow`).

3. **The aspect** — `core/uc/recipe/recipe-session-transition.ts` (factory, mirrors the adapter idiom):

   ```
   createSessionStateManager(repository): SessionStateManager
     run<A>(event, userId, sessionId, action: (session) => Effect<A, …>): Effect<{ result: A; session }, …>
       1. repository.find → getOrThrowNotFound        (load + ownership)
       2. nextState(event)(session.state) → to        (GUARD — fails 409 before any side effect)
       3. action(session) → result                    (WORK — business effect; data writes only)
       4. repository.transition(userId, sessionId, to) (CLOSE — the one state write)
       5. ► { result, session: <post-transition> }
   ```

4. **UC refactor** — `RecipeSessionUC` receives the manager as an injected constructor dependency (composed in `src/middleware.ts` from the same `sessionRepository` instance — kept external for test substitution). `attachPhotos`, `recognizeProducts`, `generateRecipe`, `saveSession` route through `sessions.run(event, …)`. Removed: `markPhotosUploaded`, the state half of `persistRecognizedItems`, the inline `{ state: "recipe_generated" }` write, and `saveSession`'s state write. Business actions keep their **data-only** writes (e.g. `recognizedItems`; `generateRecipe`'s early provenance write must stay _inside_ the action so it survives a generation failure → hence the aspect's close is **state-only**, not a combined data+state write).

### Guarantees this buys

- Single writer of `state` (only the aspect, via `transition`); compile-enforced.
- Guard runs before side effects — an illegal call never uploads/recognizes/generates.
- State advances only on business-action success.
- Self-loops / re-runs come free from the reducer.

### Open decisions to confirm during planning

- **`saveSession` tightening:** today it's unguarded (last-write-wins); routed through `"save"` it now rejects saving from `created`/`photos_uploaded`. Intended fix — confirm.
- **Error mapping:** `SnapchefConflictError` (409) for illegal transitions, vs the 422 `BusinessRuleViolation` the data guards use. Confirm.
- **Backward re-edit edges:** keep them open (re-photo/re-recognize after generate) or lock once `recipe_generated`?
- **Concurrency (optional):** compare-and-swap `transition(userId, sessionId, from, to)` (`...update().eq("state", from)`) → 409 on a lost race. Skip if single-user sessions make it moot.

### Out of scope / unchanged

- `deleteSession` stays outside the aspect — a hard row delete is a destroy, not a transition (no `deleted` state).
- Read methods (`getSavedRecipe`, `listSavedRecipes`) are not wrapped — they assert state for visibility, they don't transition.
- No DB-level transition trigger — enforcement stays in the app layer per conventions (business logic in `core/uc`/`core/model`; a Worker rollback wouldn't roll back a trigger).

## More Details from conversation

Approach B — Event-driven reducer FSM (runtime, behavior-level)

The UC dispatches a domain event; the machine derives the next state (or rejects). ts-pattern tuple matching is the natural fit — this is its strength.

// core/model/recipe/recipe-session-state-machine.ts
import { match } from "ts-pattern";
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
.with(["created", "upload_photos"], () => Effect.succeed<RecipeSessionState>("photos_uploaded"))
.with(["photos_uploaded", "upload_photos"], () => Effect.succeed<RecipeSessionState>("photos_uploaded"))
.with(["photos_uploaded", "recognize_products"], () => Effect.succeed<RecipeSessionState>("products_recognized"))
.with(["products_recognized", "recognize_products"], () => Effect.succeed<RecipeSessionState>("products_recognized"))
.with(["products_recognized", "generate_recipe"], () => Effect.succeed<RecipeSessionState>("recipe_generated"))
.with(["recipe_generated", "generate_recipe"], () => Effect.succeed<RecipeSessionState>("recipe_generated"))
.with([P.union("recipe_generated", "saved"), "save"], () => Effect.succeed<RecipeSessionState>("saved"))
// …plus the legal backward re-edit edges…
.otherwise(([s, e]) =>
Effect.fail(new SnapchefConflictError({ message: `Event "${e}" not allowed in state "${s}"` })),
);

- - Transition and next-state computation centralized in one place; the UC no longer hardcodes the target string (kills the skip bug structurally). Events are first-class and zod-validatable; the natural home for data-dependent guards later. Matches the repo's "branch over values with match" rule directly.
- − ~12–20 .with arms; .exhaustive() would require enumerating every (state × event) pair, so the pragmatic choice is .otherwise → fail (loses compile-time totality on the matrix). More machinery than A.

1. FSM reducer — core/model/recipe/recipe-session-state-machine.ts (pure, from B)

Unchanged from what you approved: nextState(event)(from): Effect<RecipeSessionState, SnapchefConflictError>. The aspect calls it; nobody else does.

2. Port changes — core/boundry/recipe/ports.ts (this is what enforces the rule)

Two edits make "business logic can't write state" a compile error, not a guideline:

// (a) DROP `state` from the data payload — business code can no longer set it.
export const RecipeSessionUpdatePayload = RecipeSession.pick({
correctedItems: true,
mealContext: true,
recognizedItems: true,
allowExtraIngredients: true,
// state: true, ← removed
}).partial();

export interface RecipeSessionRepository {
create(userId: UserId): Effect.Effect<RecipeSession, SnapchefServerError>;
update(userId: UserId, sessionId: string, data: RecipeSessionUpdatePayload): Effect.Effect<Option.Option<RecipeSession>, SnapchefServerError>;
find(userId: UserId, sessionId: string): Effect.Effect<Option.Option<RecipeSession>, SnapchefServerError>;
remove(userId: UserId, sessionId: string): Effect.Effect<void, SnapchefServerError>;
// (b) the SOLE state writer — only the aspect calls this.
transition(userId: UserId, sessionId: string, to: RecipeSessionState): Effect.Effect<Option.Option<RecipeSession>, SnapchefServerError>;
}

The adapter's transition is a one-liner: an owner-scoped update({ state: to }) decoded back through RecipeSessionFromRow (same machinery as the existing update).

After this edit, every current { state: ... } write in the UC (markPhotosUploaded, persistRecognizedItems, the inline { state: "recipe_generated" }, saveSession) stops compiling — which is precisely the migration signal.

3. The aspect — core/uc/recipe/recipe-session-transition.ts (factory, mirrors the adapter idiom)

import { Effect } from "effect";
import type { SnapchefServerError } from "@/lib/core/model/error";
import type { RecipeSession } from "@/lib/core/model/recipe";
import type { UserId } from "@/lib/core/model/auth";
import type { RecipeSessionRepository } from "@/lib/core/boundry/recipe";
import { type RecipeSessionEvent, nextState } from "@/lib/core/model/recipe/recipe-session-state-machine";
import { getOrThrowNotFound } from "@/lib/utils/effect";

export interface TransitionOutcome<A> {
result: A; // whatever the business action produced
session: RecipeSession; // authoritative post-transition session
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
Effect.flatMap(getOrThrowNotFound("Session not found")), // load + ownership
Effect.flatMap((session) =>
nextState(event)(session.state).pipe( // GUARD — fails Conflict(409), no side effects yet
Effect.flatMap((to) =>
action(session).pipe( // WORK — business Effect runs only if legal
Effect.flatMap((result) =>
repository.transition(userId, sessionId, to).pipe( // CLOSE — the one state write
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

It's pure composition over an already-injected port, so no new DI: the UC builds it in its constructor (alternative: inject from middleware.ts if you want to fake the whole aspect in tests — but you'd normally fake the repo instead).

4. UC — business methods become state-free

export class RecipeSessionUC {
private readonly sessions: SessionStateManager;

constructor(
private readonly sessionRepository: RecipeSessionRepository,
/_ …the other 5 deps… _/
) {
this.sessions = createSessionStateManager(sessionRepository); // derived from the injected port
}

attachPhotos(userId, sessionId, files): Effect.Effect<RecipeSession, SnapchefServerError> {
return this.sessions
.run("upload_photos", userId, sessionId, (session) =>
this.removeExistingPhotos(session).pipe(Effect.flatMap(() => this.uploadAndPersistPhotos(session, files))),
)
.pipe(Effect.map(({ session }) => session), logResult("recipe.attachPhotos"));
// markPhotosUploaded() is GONE — the aspect writes photos_uploaded.
}

recognizeProducts(userId, sessionId) {
return this.sessions
.run("recognize_products", userId, sessionId, (session) =>
this.photoRepository.listBySession(session.userId, session.id).pipe(
Effect.tap((photos) => this.guardHasPhotos(photos)),
Effect.flatMap((photos) => this.recognizeEachPhoto(session.userId, photos)),
Effect.flatMap((recognized) =>
this.resolveItems(recognized.map((e) => e.items)).pipe(
// DATA-only write (no state — wouldn't compile anyway):
Effect.tap((merged) => this.sessionRepository.update(session.userId, session.id, { recognizedItems: merged })),
Effect.map(() => recognized.map((e) => ({ ...e.photo, recognizedItems: e.items }))),
),
),
),
)
.pipe(Effect.map(({ result, session }) => ({ session, photos: result })), logResult("recipe.recognize"));
}

generateRecipe(userId, sessionId, command): Effect.Effect<RecipeGenerationResult, SnapchefServerError> {
return this.sessions
.run("generate_recipe", userId, sessionId, () =>
// early provenance write stays INSIDE the action (survives a generation failure) — data only:
this.sessionRepository
.update(userId, sessionId, { correctedItems: command.correctedItems, mealContext: command.mealContext, allowExtraIngredients: command.allowExtraIngredients })
.pipe(
Effect.flatMap(() => this.recipeGenerator.generate({ /_ … _/ }).pipe(/_ timeout + retry _/)),
Effect.flatMap((generated) => this.recipeRepository.upsert({ sessionId, userId, name: generated.name, contentMd: generated.contentMd })),
),
)
.pipe(Effect.map(({ result: recipe, session }) => ({ recipe, session })), logResult("recipe.generate"));
}

saveSession(userId, sessionId): Effect.Effect<RecipeSession, SnapchefServerError> {
// No-op business action: the aspect loads, guards (save legal only from recipe_generated|saved), transitions.
return this.sessions
.run("save", userId, sessionId, () => Effect.void)
.pipe(Effect.map(({ session }) => session), logResult("recipe.save"));
}
}
