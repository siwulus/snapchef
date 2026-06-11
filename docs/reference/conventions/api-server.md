# API Server Conventions (Astro Routes)

These rules govern `src/pages/api/**`. The shared machinery lives in `src/lib/infrastructure/api/` (`runApiRoute`, `parseRequestBody`, `parseMultipartFiles`, `validateAuthUser`, the `ApiResponsePayload` envelope) and `src/lib/core/model/error/` (the `SnapchefServerError` family). Business logic lives in `src/lib/core/uc/` use-case classes injected via `context.locals` — see `use-cases.md`. Layer-access rules (what a route may import) are defined in `src/lib/CLAUDE.md`.

## Rule: Route handlers delegate to `runApiRoute` — never build a `Response` by hand

Express the handler as a single Effect pipeline passed to `runApiRoute` from `@/lib/infrastructure/api`. The effect succeeds with the domain payload; `runApiRoute` owns envelope wrapping (`{ ok: true, data }`), error→HTTP-status mapping (it reads the failed error's numeric `code` field _directly_ as the response status — see "Fail with the `SnapchefServerError` family" below), and a defect→500 fallback (`SnapchefUnexpectedError`). It is also the route's single `Effect.runPromise` site. The domain step is a method call on a use case from `context.locals` (see `use-cases.md`).

```ts
// ✓ good — the handler is one Effect pipeline; runApiRoute is the only exit
import { runApiRoute, parseRequestBody } from "@/lib/infrastructure/api";
import type { APIRoute } from "astro";
import { Effect } from "effect";

export const prerender = false;

export const POST: APIRoute = ({ request, locals: { authenticator } }) =>
  runApiRoute(
    parseRequestBody(request, UserCredentials).pipe(Effect.flatMap((credentials) => authenticator.signIn(credentials))),
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

Lift the request body into Effect with `parseRequestBody` from `@/lib/infrastructure/api`, passing the zod command schema from `core/boundry/` or `core/model/`. Do not call `request.json()` and validate manually — `parseRequestBody` already layers the typed failures: malformed JSON → `SnapchefParseError` (400), schema mismatch → `SnapchefValidationError` (400, via `decodeWith`), and `runApiRoute` turns the latter into a 400 with `fieldErrors` derived from the `zodError`.

```ts
// ✓ good — one call yields a typed, validated command in the Effect channel
const command = parseRequestBody(context.request, UserCredentials);
// Effect.Effect<UserCredentials, SnapchefServerError>
```

```ts
// ✗ bad — manual parse + validate; failures are untyped and escape the envelope
const body = (await context.request.json()) as UserCredentials;
const parsed = UserCredentials.parse(body); // throws ZodError → uncontrolled 500
```

---

## Rule: Use the matching parser for multipart, and `validateAuthUser` to gate on the session user

The boundary layer provides a parser per input shape; pick the one that matches the request, and combine several with `Effect.all([...])` when a route needs more than one. All live in `@/lib/infrastructure/api`:

- `parseRequestBody(request, schema)` — JSON body.
- `parseMultipartFiles(request, fieldName)` — file uploads; validates count/type/size against the `core/boundry/recipe` limits and fails `SnapchefParseError` / `SnapchefValidationError`.
- `validateAuthUser(locals.user)` — decode the middleware-populated `locals.user` into a `SnapchefUser`, failing `SnapchefAuthenticationError` (401) when absent/invalid. This is how a route requires authentication; do not read `locals.user` ad hoc.
- `decodeWith(schema)(params.id)` — validate a path param (e.g. `RecipeSessionId`).

```ts
// ✓ good — src/pages/api/recipe-sessions/[id]/upload.ts: combine parsers, then delegate
export const POST: APIRoute = ({ request, params, locals: { user, recipeSessions } }) =>
  runApiRoute(
    Effect.all([
      validateAuthUser(user),
      decodeWith(RecipeSessionId)(params.id),
      parseMultipartFiles(request, "photos"),
    ]).pipe(Effect.flatMap(([authUser, id, files]) => recipeSessions.attachPhotos(authUser.id, id, files))),
  );
```

```ts
// ✗ bad — ad-hoc auth/file handling: untyped, no envelope, wrong status on missing user
const user = context.locals.user;
if (!user) return new Response("unauthorized", { status: 401 });
const form = await context.request.formData(); // no size/type validation
```

---

## Rule: Fail with the `SnapchefServerError` family — pick the error by meaning

Signal failures with the `Snapchef…Error` classes from `@/lib/core/model/error`, chosen by what went wrong, not where. Each class carries a numeric `code` that **is** the HTTP status `runApiRoute` returns — there is no `ErrorCode` enum, no `ERROR_STATUS` table, and no ts-pattern mapper to touch. Common choices (full table in `effect.md`):

- `SnapchefAuthenticationError` (401) / `SnapchefAuthorizationError` (403) — not authenticated / not permitted.
- `SnapchefNotFoundError` (404), `SnapchefConflictError` (409), `SnapchefBusinessRuleViolationError` (422) — domain outcomes the client should act on.
- `SnapchefExternalSystemError` / `SnapchefDatabaseError` (500), `SnapchefInternalSystemError` (502) — infrastructure failures. The `message` is surfaced as-is; put the raw failure in `cause`.
- `SnapchefParseError` / `SnapchefValidationError` (400) — produced by the parsers and `decodeWith`; do not construct them in route logic.

Adding a new failure mode means adding a `Snapchef…Error` class (with its numeric `code`) to the union in `core/model/error` — nothing in `infrastructure/api/index.ts` changes, because the mapper is generic over `code`.

Failure construction lives inside a `core/uc` use-case method (e.g. `AuthenticatorUC.signIn`), not in the route — the route only relays the typed failures the UC produces.

```ts
// ✓ good — inside a UC method: Supabase lifted via the shared helper, mapped to a meaningful error
tryErrorDataWithSchema(AuthUser)(() => supabase.auth.signInWithPassword(credentials)).pipe(
  Effect.as({ redirect: "/recipes" }),
  Effect.mapError(() => new SnapchefAuthenticationError({ message: "Failed to sign in" })),
);
```

```ts
// ✗ bad — generic error erases meaning + string code; runApiRoute cannot derive a status
Effect.fail(new Error("sign-in failed")); // untyped, no numeric code → defect → 500
```

---

## Rule: Type success payloads with a `core/boundry` schema

Make the route's success value an exported zod schema from `src/lib/core/boundry/<domain>/` (e.g. `RedirectTarget`), not an ad-hoc object shape. The client validates the response envelope against the same schema (`ApiResponsePayload(RedirectTarget)`), so the contract lives in exactly one place shared by both sides.

```ts
// ✓ good — the payload type is a shared boundary schema
import { type RedirectTarget } from "@/lib/core/boundry/auth";

const result: Effect.Effect<RedirectTarget, SnapchefServerError> = authenticator.signIn(credentials);
```

```ts
// ✗ bad — inline shape the client cannot validate against
const result = authenticator.signIn(credentials).pipe(Effect.map(() => ({ goto: "/recipes", ok: 1 })));
```
