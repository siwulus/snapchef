# Ports & Adapters Conventions (Hexagonal)

The app separates **what** the domain needs (ports) from **how** it is fulfilled (adapters). A port is a TypeScript `interface` living in `core/boundry/<domain>/ports.ts`; an adapter is a factory function under `src/lib/infrastructure/**` that returns an object implementing that interface. Use cases depend on ports only; `src/middleware.ts` is the single place where a port is bound to its adapter. This keeps `core/` free of Supabase/IO and makes UCs testable with a fake port.

## Rule: Declare ports as `interface`s in `core/boundry/<domain>/ports.ts`

A port is an `interface` whose methods return `Effect.Effect<A, SnapchefServerError>`. It imports `Effect`/`Option` and the error union **as types only** and references domain models from `core/model/**`. It never imports from `infrastructure/**`.

```ts
// ✓ good — src/lib/core/boundry/recipe/ports.ts: the contract the domain depends on
import type { Effect, Option } from "effect";
import type { SnapchefServerError } from "@/lib/core/model/error";
import { RecipeSession } from "@/lib/core/model/recipe";
import type { UserId } from "@/lib/core/model/auth";

export interface RecipeSessionRepository {
  create(userId: UserId): Effect.Effect<RecipeSession, SnapchefServerError>;
  find(userId: UserId, sessionId: string): Effect.Effect<Option.Option<RecipeSession>, SnapchefServerError>;
  update(
    userId: UserId,
    sessionId: string,
    data: RecipeSessionUpdatePayload,
  ): Effect.Effect<Option.Option<RecipeSession>, SnapchefServerError>;
}
```

```ts
// ✗ bad — a port that reaches into infrastructure or returns raw Promises
import type { SupabaseClient } from "@supabase/supabase-js"; // infra type leaks into the contract

export interface RecipeSessionRepository {
  create(userId: string): Promise<RecipeSession>; // Promise, not Effect — failure mode invisible
}
```

> **Why `boundry`, not `uc`:** ports are shared between the UC that consumes them and the adapter that implements them; `core/boundry/<domain>/` is the neutral contract location both sides import. (The folder is spelled `boundry` in this repo — keep it.)

---

## Rule: A "find / maybe-missing" port returns `Option`; a "must-exist" port returns the value

Model legitimate absence as `Effect<Option.Option<A>, …>` — do not fold "row missing" into `SnapchefNotFoundError` inside the adapter. The UC decides whether a missing row is an error and maps the `Option` accordingly (e.g. `Effect.andThen` to unwrap, then `mapError` to `SnapchefNotFoundError`). Operations where absence is impossible (a freshly created row) return the value directly.

```ts
// ✓ good — adapter reports absence as Option; the UC turns None into NotFound when it matters
find(userId, sessionId): Effect.Effect<Option.Option<RecipeSession>, SnapchefServerError>;
create(userId): Effect.Effect<RecipeSession, SnapchefServerError>;
```

---

## Rule: Adapters are factory functions under `infrastructure/**`, named after the port

Implement a port with a `create<PortName>(client) => <PortName>` factory. Build each method as a curried function (`const find = (supabase) => (userId, id) => …`) lifted through the shared Supabase helpers (`tryErrorData`, `tryErrorDataOption`, `tryErrorDataWithSchema` — see `effect.md`), then assemble them into the returned object. The **file is `PascalCase.ts` mirroring the port interface name** (e.g. `RecipeSessionRepository.ts`), even though its exports are factory functions — see `generic.md`.

```ts
// ✓ good — src/lib/infrastructure/db/RecipeSessionRepository.ts
import type { RecipeSessionRepository } from "@/lib/core/boundry/recipe";
import { tryErrorDataOption } from "@/lib/infrastructure/db/supabase-effect";
import { decodeWith } from "@/lib/utils/effect";
import { RecipeSessionFromRow } from "./recipe-session-row";

const find =
  (supabase: SupabaseClient<Database>) =>
  (userId: UserId, sessionId: string): Effect.Effect<Option.Option<RecipeSession>, SnapchefServerError> =>
    tryErrorDataOption<RecipeSessionRow>(() =>
      supabase
        .from("recipe_sessions")
        .select("*")
        .eq("id", sessionId)
        .eq("user_id", userId)
        .single()
        .then(({ error, data }) => ({ error, data })),
    ).pipe(Effect.flatMap((option) => Effect.transposeMapOption(option, decodeWith(RecipeSessionFromRow))));

export const createRecipeSessionRepository = (supabase: SupabaseClient<Database>): RecipeSessionRepository => ({
  create: create(supabase),
  update: update(supabase),
  find: find(supabase),
});
```

```ts
// ✗ bad — adapter exported as a class, or not typed against the port (drift goes uncaught)
export class RecipeSessionRepositoryImpl {
  // no `: RecipeSessionRepository` return-type anchor — methods can silently diverge from the port
}
```

> **Why the explicit `: RecipeSessionRepository` return type:** it anchors the factory to the port so the compiler rejects any drift between contract and implementation. Always annotate the factory's return type with the port.

---

## Rule: Cross the snake_case ⇄ domain boundary in a `…FromRow` decoder

Supabase rows are snake_case; domain models are camelCase. Map between them with a zod `.transform(...).pipe(Model)` decoder (e.g. `RecipeSessionFromRow` in `infrastructure/db/recipe-session-row.ts`), run through `decodeWith`. The adapter never returns a raw DB row — it returns a validated domain model. Derive write payloads from the model with `Model.pick({...}).partial()` (see `zod.md`).

```ts
// ✓ good — src/lib/infrastructure/db/recipe-session-row.ts: row schema (unexported) → transform → domain model
const RecipeSessionRowSchema = z.object({ id: z.string(), user_id: z.string() /* … */ });

export const RecipeSessionFromRow = RecipeSessionRowSchema.transform((row) => ({
  id: row.id,
  userId: row.user_id,
  // …camelCase the rest
})).pipe(RecipeSession);
```

> **Composition:** the port type lives in `core/boundry`, the adapter in `infrastructure`, and `injectDependencies` in `src/middleware.ts` wires `create<Port>(supabase)` into the UC constructor — see `use-cases.md`.
