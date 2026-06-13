# Effect-TS Conventions

**Effect is the first-choice approach for functional programming in this application.** Reach for Effect whenever logic is asynchronous, fallible, or effectful (I/O, DB, network, randomness). Model such work as `Effect.Effect<A, E, R>` and compose it with **pipelines** — `pipe()` / `.pipe()` — as the preferred style. These rules apply across the whole application; the only sanctioned escape hatch is the framework edge (React render bodies, Astro/Cloudflare handler signatures), where you wrap inward and run once.

These snippets target the **stable Effect 3.x API** (`effect@^3`). Do not import from `effect/unstable/*`.

## Rule: Reach for Effect, not raw Promises or `throw`

Express asynchronous or fallible operations as a function returning `Effect.Effect<A, E, R>` so the failure mode is visible in the type. Do not write `async` functions that `throw`.

```ts
// ✓ good — fallible work is an Effect; the error type is part of the signature
import { Effect } from "effect";

const parseAge = (raw: string): Effect.Effect<number, InvalidAge> => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? Effect.succeed(n) : Effect.fail(new InvalidAge({ raw }));
};
```

```ts
// ✗ bad — Promise + throw hides the failure mode from the type system
const parseAge = async (raw: string): Promise<number> => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`bad age: ${raw}`);
  return n;
};
```

> **Exceptions:**
>
> - Framework-edge callbacks the runtime invokes directly (React event handlers, Astro/Cloudflare request handlers) are Promise/imperative by contract — wrap inward (see "Wrap Promises at the boundary") rather than fighting the signature.

---

## Rule: Compose with pipelines — prefer `pipe` over `Effect.gen`

Build Effect logic by piping values through combinators (`Effect.map`, `Effect.flatMap`, `Effect.tap`, `Effect.andThen`) with `pipe()` or the `.pipe()` method. The pipeline is the house style; reserve `Effect.gen` for the documented exception.

```ts
// ✓ good — a pipeline reads top-to-bottom; data flows through combinators
import { Effect } from "effect";

const greetUser = (id: string): Effect.Effect<string, UserNotFound> =>
  findUser(id).pipe(
    Effect.tap((user) => Effect.log(`found ${user.id}`)),
    Effect.map((user) => user.name),
    Effect.map((name) => `Hello, ${name}`),
  );
```

```ts
// ✗ bad — Effect.gen for a plain transformation chain; pipe is the house style
const greetUser = (id: string): Effect.Effect<string, UserNotFound> =>
  Effect.gen(function* () {
    const user = yield* findUser(id);
    yield* Effect.log(`found ${user.id}`);
    return `Hello, ${user.name}`;
  });
```

> **Exceptions:**
>
> - `Effect.gen` is permitted only when many sequential steps each depend on several earlier bindings, so a `pipe` chain would nest unreadably. Prefer `pipe` whenever the data flows linearly.

---

## Rule: Wrap Promises at the boundary, run Effects at the edge

Lift Promise-returning APIs (Supabase, `fetch`) into Effect with `Effect.tryPromise`, attaching a typed error. Keep all logic as Effect, and call `Effect.runPromise` (or `Effect.runSync`) exactly once, at the outermost edge. Never interleave `await` inside Effect logic.

```ts
// ✓ good — lift the Promise into Effect with a typed error...
import { Effect } from "effect";
import type { APIRoute } from "astro";

const insertRecipe = (input: RecipeInput): Effect.Effect<Recipe, DbError> =>
  Effect.tryPromise({
    try: () => supabase.from("recipes").insert(input).select().single(),
    catch: (cause) => new DbError({ cause }),
  }).pipe(
    Effect.flatMap(({ data, error }) => (error ? Effect.fail(new DbError({ cause: error })) : Effect.succeed(data))),
  );

// ...then run it once, at the outermost edge (the Astro endpoint handler)
export const POST: APIRoute = async ({ request }) => {
  const input = (await request.json()) as RecipeInput;
  return Effect.runPromise(
    insertRecipe(input).pipe(
      Effect.match({
        onFailure: () => new Response("Could not save recipe", { status: 500 }),
        onSuccess: (recipe) => new Response(JSON.stringify(recipe), { status: 201 }),
      }),
    ),
  );
};
```

```ts
// ✗ bad — await interleaved inside the logic; the two paradigms bleed together
const insertRecipe = async (input: RecipeInput) => {
  const validated = await Effect.runPromise(validate(input)); // running mid-flow
  const { data, error } = await supabase.from("recipes").insert(validated);
  if (error) throw error;
  return data;
};
```

> **Exceptions:**
>
> - The outermost framework handler is the one sanctioned `runPromise` / `runSync` site. Everything it calls stays in the Effect world. In this app that edge is `runApiRoute` (api routes) and `injectDependencies`/`setUserInContext` (`src/middleware.ts`).
> - The hand-rolled `tryPromise` + `flatMap(({ error }) => …)` shown above is the underlying mechanism, not the call-site pattern: for Supabase `{ data, error }` calls use the shared `tryError…` helpers instead (see "Bridge Supabase calls through the shared `tryError…` helpers" below).

---

## Rule: Fail with typed errors — never `throw`

Define domain errors as `Data.TaggedError` subclasses, signal failure with `Effect.fail`, and recover with `Effect.catchTag` / `Effect.catchAll`. Do not `throw` inside Effect code — a thrown value escapes the typed failure channel.

```ts
// ✓ good — domain errors are data; the failure channel is typed and matchable
import { Data, Effect } from "effect";

class UserNotFound extends Data.TaggedError("UserNotFound")<{
  readonly id: string;
}> {}

const recovered = (id: string): Effect.Effect<string> =>
  findUser(id).pipe(
    Effect.map((user) => user.name),
    Effect.catchTag("UserNotFound", (e) => Effect.succeed(`no such user: ${e.id}`)),
  );
```

```ts
// ✗ bad — throwing escapes the type system; callers can't see or match the error
const findUser = (id: string): Effect.Effect<User> =>
  Effect.sync(() => {
    const row = lookup(id);
    if (!row) throw new Error("not found"); // invisible failure
    return row;
  });
```

---

## Rule: Structure domain errors — `Snapchef…Error` class, numeric `code`, one `SnapchefServerError` union

Server-side domain errors live in `src/lib/core/model/error/index.ts`. Each is a `Data.TaggedError` whose **tag equals the class name** (PascalCase, prefixed `Snapchef`), carrying:

- `readonly message: string` — always.
- `readonly cause?: unknown` — the wrapped failure, when one exists.
- `readonly code = <number> as const` — the **HTTP status** this error maps to. The boundary mapper reads `error.code` _directly_ as the response status (see api-server.md), so the number is the single source of truth — there is **no `ErrorCode` string enum, no `ERROR_STATUS` lookup table, and no ts-pattern mapper**.

Validation errors additionally carry `readonly zodError: z.ZodError` (the mapper derives `fieldErrors` from it). Every class is a member of the exported `SnapchefServerError` union — adding a class means adding it to that union, nothing else.

The current family (extend it; do not invent parallel error types):

| Class                                | `code` | Meaning                              |
| ------------------------------------ | ------ | ------------------------------------ |
| `SnapchefAuthenticationError`        | 401    | Not authenticated / sign-in failed   |
| `SnapchefAuthorizationError`         | 403    | Authenticated but not permitted      |
| `SnapchefNotFoundError`              | 404    | Resource / row absent                |
| `SnapchefConflictError`              | 409    | State conflict                       |
| `SnapchefBusinessRuleViolationError` | 422    | Domain rule rejected the request     |
| `SnapchefParseError`                 | 400    | Malformed body / form data           |
| `SnapchefValidationError`            | 400    | zod decode failed (`zodError` field) |
| `SnapchefDatabaseError`              | 500    | Supabase / Postgres failure          |
| `SnapchefExternalSystemError`        | 500    | Third-party / network failure        |
| `SnapchefInternalSystemError`        | 502    | Internal dependency failure          |
| `SnapchefUnexpectedError`            | 500    | Defect fallback (`runApiRoute` only) |

```ts
// ✓ good — src/lib/core/model/error: tag === class name, numeric code, member of the union
import { Data } from "effect";
import { z } from "zod";

export class SnapchefNotFoundError extends Data.TaggedError("SnapchefNotFoundError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  readonly code = 404 as const;
}

export class SnapchefValidationError extends Data.TaggedError("SnapchefValidationError")<{
  readonly message: string;
  readonly zodError: z.ZodError;
  readonly cause?: unknown;
}> {
  readonly code = 400 as const;
}

export type SnapchefServerError = SnapchefNotFoundError | SnapchefValidationError; /* | …the rest */
```

```ts
// ✗ bad — tag drifts from class name; string code; a parallel error type outside the union
class DbFailure extends Data.TaggedError("DatabaseError")<{ msg: string }> {} // tag ≠ class

export class MyError extends Data.TaggedError("MyError")<{ message: string }> {
  readonly code = "NOT_FOUND" as const; // string code — the mapper expects a number
}
```

> **Adding a new server error:** declare the `Snapchef…Error` class with a numeric `code` and add it to the `SnapchefServerError` union — that is the entire change. The boundary mapper is generic over `code`, so no mapper edit is needed.
>
> **Client side:** transport errors in `src/components/api/errors.ts` (`ApiRequestError`, `UnexpectedResponseError`, union `ClientSnapchefError`) follow the same tag-equals-class shape but carry **no `code`** — they never reach the HTTP-status mapper.

---

## Rule: Validate with zod through the shared `decodeWith` bridge

zod remains the validation tool (a CLAUDE.md hard rule: "Validate API input with `zod`"). Do not introduce `effect/Schema` as a second validator, and **do not hand-roll `safeParse` + `Effect.fail` bridges** — the one canonical bridge is `decodeWith` from `@/lib/utils/effect`. It runs `schema.safeParse` and fails with `SnapchefValidationError` (carrying the `z.ZodError`) on mismatch.

```ts
// ✓ good — the single bridge: schema in, Effect<output, SnapchefValidationError> out
import { decodeWith } from "@/lib/utils/effect";

// `SignIn` is the zod schema + inferred type (see zod.md — same-name convention)
const decoded = decodeWith(SignIn)(input); // Effect.Effect<SignIn, SnapchefValidationError>
```

```ts
// ✓ good — decodeWith is curried, so it drops straight into a pipe
someEffect.pipe(Effect.flatMap(decodeWith(RecognizedItem)));
```

```ts
// ✗ bad — a second hand-rolled safeParse bridge, or effect/Schema as a rival validator
const decodeSignIn = (input: unknown) => {
  const r = SignIn.safeParse(input);
  return r.success ? Effect.succeed(r.data) : Effect.fail(new SomeOtherError()); // duplicate of decodeWith
};
import { Schema } from "effect"; // competing validator — forbidden
```

> **Exceptions:**
>
> - None. Validation stays in zod, behind `decodeWith`. The only `decodeWith` definition lives in `utils/effect.ts`.

---

## Rule: Bridge Supabase calls through the shared `tryError…` helpers

Every Supabase call returns `{ data, error }` and must be lifted into Effect through the helpers in `@/lib/infrastructure/db/supabase-effect` — never re-roll `Effect.tryPromise` + `flatMap(({ error }) => …)` at each call site. Pass a thunk that resolves to `{ data, error }` (use `.then(({ error, data }) => ({ error, data }))` on the Supabase builder so the types line up). The helpers map a thrown rejection or a non-null `error` to `SnapchefExternalSystemError`:

- `tryErrorData(fn)` → `Effect<T, …>` — fails `SnapchefNotFoundError` when `data` is null. Use when a row must exist.
- `tryErrorDataOption(fn)` → `Effect<Option<T>, …>` — null `data` becomes `Option.none()`. Use for "find" queries that may legitimately miss.
- `tryErrorDataWithSchema(schema)(fn)` → `Effect<output, …>` — like `tryErrorData` then `decodeWith(schema)`.

```ts
// ✓ good — adapter lifts the Supabase call through the shared helper, then decodes
import { tryErrorDataOption } from "@/lib/infrastructure/db/supabase-effect";

const find = (sessionId: string): Effect.Effect<Option.Option<RecipeSession>, SnapchefServerError> =>
  tryErrorDataOption<RecipeSessionRow>(() =>
    supabase
      .from("recipe_sessions")
      .select("*")
      .eq("id", sessionId)
      .single()
      .then(({ error, data }) => ({ error, data })),
  ).pipe(Effect.flatMap((option) => Effect.transposeMapOption(option, decodeWith(RecipeSessionFromRow))));
```

```ts
// ✗ bad — re-rolling the tryPromise + error-branch bridge inline at the call site
Effect.tryPromise({
  try: () => supabase.from("recipe_sessions").select("*").single(),
  catch: (cause) => new SnapchefExternalSystemError({ message: "…", cause }),
}).pipe(Effect.flatMap(({ data, error }) => (error ? Effect.fail(/* … */) : Effect.succeed(data))));
```

> **Exceptions:**
>
> - Supabase Auth calls (`auth.signOut()` etc.) that return only `{ error }` with no meaningful `data` may use a bare `Effect.tryPromise` with an explicit `SnapchefExternalSystemError` catch — there is nothing for the `tryError…` helpers to decode (see `SupabaseAuthenticator.signOut`).
> - Supabase **Auth** calls that _do_ return a user (`signInWithPassword`, `signUp`, `getUser`) need their failure **classified**, not folded: a 4xx `AuthApiError` is a genuine auth rejection (→ `SnapchefAuthenticationError`, 401) while a 5xx / network / thrown failure is infrastructure (→ `SnapchefExternalSystemError`, 500). The generic `tryError…` helpers fold every `{ error }` into `SnapchefExternalSystemError`, which would erase that distinction — so the auth adapter (`infrastructure/auth/SupabaseAuthenticator.ts`) lifts these calls with its own helper that branches on `isAuthApiError(error)` before constructing the typed failure, always forwarding `cause`. A wire-schema decode failure here is a driven-side contract drift → `SnapchefExternalSystemError` (500), never a `SnapchefValidationError` (400).
