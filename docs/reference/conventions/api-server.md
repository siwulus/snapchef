# API Server Conventions (Astro Routes)

These rules govern `src/pages/api/**`. The shared machinery lives in `src/lib/infrastructure/api/` (`runApiRoute`, `parseRequestBody`, the `ApiResponsePayload` envelope) and `src/lib/core/model/error/` (the `ServerSnapchefError` family). Layer-access rules (what a route may import) are defined in `src/lib/CLAUDE.md`.

## Rule: Route handlers delegate to `runApiRoute` — never build a `Response` by hand

Express the handler as a single Effect pipeline passed to `runApiRoute` from `@/lib/infrastructure/api`. The effect succeeds with the domain payload; `runApiRoute` owns envelope wrapping (`{ ok: true, data }`), error→HTTP-status mapping, and defect→500 fallback. It is also the route's single `Effect.runPromise` site.

```ts
// ✓ good — the handler is one Effect pipeline; runApiRoute is the only exit
import { runApiRoute, parseRequestBody } from "@/lib/infrastructure/api";
import type { APIRoute } from "astro";
import { Effect } from "effect";

export const prerender = false;

export const POST: APIRoute = (context) =>
  runApiRoute(
    parseRequestBody(context.request, UserCredentials).pipe(
      Effect.flatMap((credentials) => signIn(context, credentials)),
      Effect.map(() => ({ redirect: "/recipes" })),
    ),
  );
```

```ts
// ✗ bad — manual Response construction, try/catch, ad-hoc status codes
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const result = await doSignIn(body);
    return new Response(JSON.stringify(result), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
};
```

> **Exceptions:**
>
> - Routes that produce a non-JSON response by contract (e.g. a redirect-only `signout`) may bypass the envelope — but still keep logic in Effect where it is fallible.

---

## Rule: Parse request bodies with `parseRequestBody(request, schema)`

Lift the request body into Effect with `parseRequestBody` from `@/lib/infrastructure/api`, passing the zod command schema from `core/boundry/` or `core/model/`. Do not call `request.json()` and validate manually — `parseRequestBody` already layers the typed failures: malformed JSON → `ParseJsonError`, schema mismatch → `ValidationError` (via `decodeWith`), and `runApiRoute` turns both into a 400 with `fieldErrors` for validation issues.

```ts
// ✓ good — one call yields a typed, validated command in the Effect channel
const command = parseRequestBody(context.request, UserCredentials);
// Effect.Effect<UserCredentials, ServerSnapchefError>
```

```ts
// ✗ bad — manual parse + validate; failures are untyped and escape the envelope
const body = (await context.request.json()) as UserCredentials;
const parsed = UserCredentials.parse(body); // throws ZodError → uncontrolled 500
```

---

## Rule: Fail with the `ServerSnapchefError` family — pick the error by meaning

Signal failures with the error classes from `@/lib/core/model/error`, chosen by what went wrong, not where:

- `BusinessRuleError` with a `BusinessRuleErrorCode` (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `BUSINESS_RULE_VIOLATED`) — domain outcomes the client should act on.
- `ExternalSystemError` — Supabase / network / third-party failures. Its message is sanitized in the response payload; put the raw failure in `cause`.
- `ParseJsonError` / `ValidationError` — produced by `parseRequestBody`; do not construct them in route logic.

A new `ErrorCode` requires, in the same change: the enum entry in `core/model/error`, a row in `ERROR_STATUS`, and a branch in the ts-pattern `toErrorApiResponsePayload` mapper (both in `infrastructure/api/index.ts` — the `.exhaustive()` match makes the compiler enforce the last one).

```ts
// ✓ good — domain outcome vs. infrastructure failure are distinct, typed errors
Effect.tryPromise({
  try: () => supabase.auth.signInWithPassword(credentials),
  catch: (cause) => new ExternalSystemError({ message: "Authentication service failed", cause }),
}).pipe(
  Effect.flatMap(({ error }) =>
    error
      ? Effect.fail(new BusinessRuleError({ code: "UNAUTHORIZED", message: error.message }))
      : Effect.succeed({ redirect: "/recipes" }),
  ),
);
```

```ts
// ✗ bad — generic errors erase meaning; runApiRoute can only answer 500
Effect.tryPromise({
  try: () => supabase.auth.signInWithPassword(credentials),
  catch: () => new Error("sign-in failed"), // untyped, no code, no status mapping
});
```

---

## Rule: Type success payloads with a `core/boundry` schema

Make the route's success value an exported zod schema from `src/lib/core/boundry/<domain>/` (e.g. `RedirectTarget`), not an ad-hoc object shape. The client validates the response envelope against the same schema (`ApiResponsePayload(RedirectTarget)`), so the contract lives in exactly one place shared by both sides.

```ts
// ✓ good — the payload type is a shared boundary schema
import { type RedirectTarget } from "@/lib/core/boundry/auth";

const result: Effect.Effect<RedirectTarget, ServerSnapchefError> = signIn(credentials).pipe(
  Effect.map(() => ({ redirect: "/recipes" })),
);
```

```ts
// ✗ bad — inline shape the client cannot validate against
const result = signIn(credentials).pipe(Effect.map(() => ({ goto: "/recipes", ok: 1 })));
```
