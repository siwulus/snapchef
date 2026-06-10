# API Client Conventions (Browser HTTP Layer)

These rules govern how browser code (React islands) talks to `src/pages/api/**`. The transport lives in `src/components/api/` (`http.ts`, `errors.ts`); React integration lives in `src/components/hooks/` (`useApiClient`, `useZodForm`). The response envelope contract is `ApiResponsePayload` from `@/lib/infrastructure/api/types` — the only `src/lib/` import the transport layer needs (see `src/lib/CLAUDE.md` for the access matrix).

## Rule: All browser HTTP goes through the `src/components/api/http.ts` helpers

Call the API with `post`, `get`, `putJson`, or `delete_` from `@/components/api/http` — never raw `fetch` in components or hooks. Each helper takes the URL, the request body (for `post`/`putJson`), and the zod schema of the success `data` field, and returns the **full envelope**, not unwrapped data:

```ts
// ✓ good — typed Effect over the shared transport; caller receives the envelope
import { post } from "@/components/api/http";
import { RedirectTarget } from "@/lib/core/boundry/auth";

const result = post("/api/auth/signin", credentials, RedirectTarget);
// Effect.Effect<ApiResponsePayload<RedirectTarget>, ClientSnapchefError>
```

```ts
// ✗ bad — raw fetch in a component: untyped errors, no envelope validation
const response = await fetch("/api/auth/signin", {
  method: "POST",
  body: JSON.stringify(credentials),
});
const result = (await response.json()) as { redirect: string };
```

> **Exceptions:**
>
> - A new HTTP verb or content type (file upload, etc.) extends `fetchJson` in `http.ts` — it does not justify a one-off `fetch` at the call site.

---

## Rule: Validate every response against the envelope contract

Inside the transport, parse the response with `ApiResponsePayload(dataSchema)` — the discriminated union on `ok` covering both the success branch (`{ ok: true, data }`) and the error branch, where the error detail is **nested under `error`**: `{ ok: false, error: { name, code, message, cause?, fieldErrors? } }` (`code` is the numeric HTTP status; `name` is the server error's `_tag`). The pipeline has exactly three stages, each with its own typed error from `@/components/api/errors`:

1. `fetch` fails → `ApiRequestError` (network unreachable)
2. body is not JSON → `UnexpectedResponseError`
3. JSON does not match `ApiResponsePayload(dataSchema)` → `UnexpectedResponseError`

```ts
// ✓ good — the three-stage core of fetchJson (src/components/api/http.ts)
Effect.tryPromise({
  try: () => fetch(params.url, { method: params.method, headers: { "Content-Type": "application/json" }, ... }),
  catch: (cause) => new ApiRequestError({ message: "Network request failed", cause }),
}).pipe(
  Effect.flatMap((response) =>
    Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) => new UnexpectedResponseError({ message: `Response body is not JSON (status ${response.status})`, cause }),
    }),
  ),
  Effect.flatMap((json) =>
    Effect.try({
      try: () => ApiResponsePayload(params.dataSchema).parse(json),
      catch: (cause) => new UnexpectedResponseError({ message: "Response did not match the API contract", cause }),
    }),
  ),
);
```

```ts
// ✗ bad — trusting the wire format; a contract drift becomes a runtime surprise
const json = (await response.json()) as ApiResponsePayload<RedirectTarget>;
```

Note the split: a server-side _error response_ (`ok: false`) is a **successful** transport result — the caller branches on `result.ok`. The Effect failure channel (`ClientSnapchefError`) is reserved for transport breakdowns.

---

## Rule: Components consume HTTP through `useApiClient`

In React components, obtain the transport from `useApiClient()` rather than importing `http.ts` directly. The hook layers cross-cutting concerns (the error toast today) with `Effect.tapError` and still **returns an Effect** — the component decides when to run it; the hook never calls `runPromise`.

```ts
// ✓ good — the hook decorates the transport but stays in the Effect world
export const useApiClient = () =>
  useMemo(
    () => ({
      post: <S extends z.ZodType>(url: string, body: unknown, dataSchema: S) =>
        post(url, body, dataSchema).pipe(Effect.tapError((error) => Effect.sync(() => toast.error(error.message)))),
    }),
    [],
  );
```

```ts
// ✗ bad — the hook runs the Effect and hides the result behind a Promise
export const useApiClient = () => ({
  post: async (url: string, body: unknown) => {
    try {
      return await Effect.runPromise(post(url, body, schema)); // running mid-flow
    } catch (e) {
      toast.error(String(e)); // imperative side effect outside the pipeline
    }
  },
});
```

---

## Rule: Form submission is the sanctioned edge — one pipeline, one `runPromise`

The `onSubmit` handler (an `async` framework-edge callback by react-hook-form's contract) wraps a single Effect pipeline ending in one `Effect.runPromise`. React state mutations (`setServerMessage`, `form.setError`, …) live inside `Effect.sync`. Handle the envelope by branching on `result.ok`: on failure, read the nested `result.error` — map `result.error.fieldErrors` onto `form.setError` and `result.error.message` onto the server-message state.

```tsx
// ✓ good — SignInForm.tsx pattern: edge handler wraps one pipeline
const { post } = useApiClient();

const onSubmit = async (data: SignInFormModel) =>
  Effect.sync(() => {
    setServerMessage(null);
  }).pipe(
    Effect.flatMap(() => post("/api/auth/signin", data, RedirectTarget)),
    Effect.tap(handleSubmitResponse),
    Effect.runPromise,
  );

const handleSubmitResponse = (result: ApiResponsePayload<RedirectTarget>): Effect.Effect<void> =>
  Effect.sync(() => {
    if (result.ok) {
      setPendingRedirect(result.data.redirect);
    } else {
      if (result.error.fieldErrors) {
        Object.entries(result.error.fieldErrors).forEach(([field, message]) => {
          if (message) form.setError(field as keyof SignInFormModel, { message });
        });
      }
      if (result.error.message) {
        setServerMessage(result.error.message);
      }
    }
  });
```

```tsx
// ✗ bad — flat envelope reads (result.message / result.fieldErrors), await/try-catch, multiple runs
const onSubmit = async (data: SignInFormModel) => {
  setServerMessage(null);
  try {
    const result = await Effect.runPromise(post("/api/auth/signin", data, RedirectTarget));
    if (!result.ok) throw new Error(result.message); // wrong: error detail is nested under result.error
    setPendingRedirect(result.data.redirect);
  } catch (e) {
    setServerMessage(String(e));
  }
};
```
