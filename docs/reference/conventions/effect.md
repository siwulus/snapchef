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
> - The outermost framework handler is the one sanctioned `runPromise` / `runSync` site. Everything it calls stays in the Effect world.

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

## Rule: Structure domain errors — tag matches class name, `code` field, layered unions

Name the `Data.TaggedError` tag exactly after the class (PascalCase), carry domain metadata in the fields (`cause: unknown` for wrapped failures, `error: z.ZodError` for validation), and group each layer's errors into a named union. Server-side errors (`src/lib/core/model/error/`) additionally declare `readonly code: ErrorCode` — the key `runApiRoute` uses to map the error to an HTTP status and the API envelope. Client-side transport errors (`src/components/api/errors.ts`) follow the same shape without a `code`.

```ts
// ✓ good — src/lib/core/model/error: tag === class name, code field, named union
import { Data } from "effect";

export class BusinessRuleError extends Data.TaggedError("BusinessRuleError")<{
  readonly message: string;
  readonly code: BusinessRuleErrorCode;
}> {}

export class ExternalSystemError extends Data.TaggedError("ExternalSystemError")<{
  readonly message: string;
  readonly cause: unknown;
}> {
  readonly code = "EXTERNAL_SYSTEM_FAILURE" as const;
}

export type ServerSnapchefError = ParseJsonError | ValidationError | BusinessRuleError | ExternalSystemError;
```

```ts
// ✗ bad — tag drifts from the class name; stringly-typed plain Error; no union
class DbFailure extends Data.TaggedError("DatabaseError")<{ msg: string }> {} // tag ≠ class

const fail = () => Effect.fail(new Error("EXTERNAL_SYSTEM_FAILURE: db down")); // code buried in a string
```

> **Why the `code` field:** the boundary mapper in `src/lib/infrastructure/api/index.ts` resolves HTTP status via `ERROR_STATUS[payload.code]` and matches errors exhaustively by `_tag` with ts-pattern. A new `ErrorCode` lands together with its `ERROR_STATUS` row and mapper branch (see api-server.md).

---

## Rule: Keep zod for validation — bridge it into Effect

zod remains the validation tool (a CLAUDE.md hard rule: "Validate API input with `zod`"). Do not introduce `effect/Schema` as a second validator. Cross into Effect by wrapping `safeParse` and mapping a failure to a `Data.TaggedError`.

```ts
// ✓ good — zod validates; a thin bridge maps its failure into Effect's channel
import { Data, Effect } from "effect";
import { z } from "zod";

// `SignIn` is the zod schema + inferred type (see zod.md — same-name convention)
class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly error: z.ZodError;
}> {}

const decodeSignIn = (input: unknown): Effect.Effect<SignIn, ValidationError> => {
  const result = SignIn.safeParse(input);
  return result.success ? Effect.succeed(result.data) : Effect.fail(new ValidationError({ error: result.error }));
};
```

```ts
// ✗ bad — effect/Schema as a competing validator; conflicts with the zod hard rule
import { Schema } from "effect";

const SignIn = Schema.Struct({
  email: Schema.String,
  password: Schema.String,
});
const decodeSignIn = Schema.decodeUnknown(SignIn);
```

> **Exceptions:**
>
> - None. Validation stays in zod; only the bridge into Effect lives here.
