# Use-Case Conventions (`core/uc`)

**`src/lib/core/uc/<domain>/` is the central point for server-side business logic.** A use case (UC) is a class whose methods return `Effect.Effect<A, SnapchefServerError>` pipelines. Routes and middleware stay thin — they parse input, delegate to a UC from `context.locals`, and hand the resulting Effect to the boundary machinery (`runApiRoute`). Dependency injection is wired in exactly one place: `src/middleware.ts`. A UC depends on **ports** (the `interface` contracts in `core/boundry/<domain>/ports.ts`) or, for thin wrappers, directly on an adapter client — see `ports-and-adapters.md` for which to choose.

## Rule: Business logic lives in a `core/uc` use-case class — not in routes or middleware

Put every domain operation (auth, recipes, …) in a use-case class under `src/lib/core/uc/<domain>/`, named `<Domain>UC` with a PascalCase filename matching the class (e.g. `AuthenticatorUC.ts`). Methods take domain commands and return Effects with typed errors. Routes must not call adapters (Supabase, fetch, …) directly.

```ts
// ✓ good — src/lib/core/uc/auth/AuthenticatorUC.ts: the operation is a UC method
export class AuthenticatorUC {
  constructor(private readonly supabase: SupabaseClient) {}

  signIn(credentials: UserCredentials): Effect.Effect<{ redirect: string }, SnapchefServerError> {
    return tryErrorDataWithSchema(AuthUser)(() => this.supabase.auth.signInWithPassword(credentials)).pipe(
      Effect.as({ redirect: "/recipes" }),
      Effect.mapError(() => new SnapchefAuthenticationError({ message: "Failed to sign in" })),
    );
  }
}
```

```ts
// ✗ bad — adapter calls and domain decisions inlined in the route
export const POST: APIRoute = (context) =>
  runApiRoute(
    parseRequestBody(context.request, UserCredentials).pipe(
      Effect.flatMap((credentials) =>
        Effect.tryPromise({
          try: () => createClient(context.request.headers, context.cookies)!.auth.signInWithPassword(credentials),
          catch: (cause) => new SnapchefExternalSystemError({ message: "Authentication service failed", cause }),
        }),
      ),
    ),
  );
```

> **Exceptions:**
>
> - UC classes are a sanctioned use of `class` (alongside `Data.TaggedError`) — the arrow-function rule in `generic.md` targets free-standing functions, not UC methods.

---

## Rule: Inject dependencies through the constructor — prefer ports, type-only

A UC receives its dependencies as constructor parameters typed via `import type`. Never instantiate clients, read env, or import a runtime value from `src/lib/infrastructure/**` inside `core/uc` — `core/` stays free of runtime framework dependencies; only type-level contracts cross the boundary. Two shapes of dependency, in order of preference:

1. **Ports (preferred for domain logic).** Inject the `interface` contracts from `core/boundry/<domain>/ports.ts` (e.g. `RecipeSessionRepository`, `SessionPhotoStorage`). The UC never names Supabase; infrastructure provides the implementation. This is the default for any UC that touches persistence or external systems — see `ports-and-adapters.md`.
2. **A raw adapter client (thin wrappers only).** A UC that is essentially a thin pass-through over one SDK (e.g. `AuthenticatorUC` over Supabase Auth) may take the client type directly. Reach for a port the moment the UC coordinates more than one collaborator or you want it unit-testable without Supabase.

```ts
// ✓ good — RecipeSessionUC depends on ports (interfaces from core/boundry), not Supabase
import type { RecipeSessionRepository, SessionPhotoStorage } from "@/lib/core/boundry/recipe";

export class RecipeSessionUC {
  constructor(
    private readonly sessionRepository: RecipeSessionRepository,
    private readonly photosStorage: SessionPhotoStorage,
  ) {}
}
```

```ts
// ✓ good — a thin Auth wrapper may take the client type directly (type-only import)
import type { SupabaseClient } from "@supabase/supabase-js";

export class AuthenticatorUC {
  constructor(private readonly supabase: SupabaseClient) {}
}
```

```ts
// ✗ bad — the UC builds its own dependency; core now depends on infrastructure + env
import { createClient } from "@/lib/infrastructure/db/supabase";

export class AuthenticatorUC {
  signIn(headers: Headers, cookies: AstroCookies, credentials: UserCredentials) {
    const supabase = createClient(headers, cookies); // runtime infra reach-in
    // ...
  }
}
```

---

## Rule: Middleware composes the object graph — UCs ride on `context.locals`

`src/middleware.ts` is the single composition root: per request, `injectDependencies` builds the Supabase client, wraps it in the **adapter factories** (`createRecipeSessionRepository`, `createSessionPhotoStorage`), and instantiates the UCs onto `context.locals`. This is the one place where a port meets its concrete adapter. Every UC exposed this way is declared on `App.Locals` in `src/env.d.ts`. If a required dependency cannot be built (Supabase env missing), middleware fails fast by throwing `SnapchefExternalSystemError` — downstream code may assume `locals` is fully populated.

```ts
// ✓ good — src/middleware.ts: one composition root; ports meet adapters here
const injectDependencies = (context: APIContext) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (supabase) {
    context.locals.authenticator = new AuthenticatorUC(supabase);
    context.locals.recipeSessions = new RecipeSessionUC(
      createRecipeSessionRepository(supabase),
      createSessionPhotoStorage(supabase),
    );
  } else {
    throw new SnapchefExternalSystemError({ message: "Supabase is not configured" });
  }
};
```

```ts
// ✓ good — src/env.d.ts: every injected UC is declared on App.Locals
declare global {
  namespace App {
    interface Locals {
      authenticator: AuthenticatorUC;
      recipeSessions: RecipeSessionUC;
      user: SnapchefUser | null;
    }
  }
}
```

```ts
// ✗ bad — a second composition site; the route re-derives what middleware already built
export const POST: APIRoute = (context) => {
  const supabase = createClient(context.request.headers, context.cookies); // duplicate wiring
  const authenticator = new AuthenticatorUC(supabase!);
  // ...
};
```

> **Adding a new UC:** create the class under `core/uc/<domain>/`, instantiate it in `injectDependencies` in `src/middleware.ts`, and declare its field on `App.Locals` in `src/env.d.ts` — all three in the same change.

---

## Rule: Routes consume UCs from `context.locals` — never construct them

A route handler destructures the UC from `locals` and composes its Effects into the `runApiRoute` pipeline. The route contributes only boundary concerns: input parsing, UC delegation, payload shaping.

```ts
// ✓ good — src/pages/api/auth/signin.ts: thin route, UC from locals
export const POST: APIRoute = ({ request, locals: { authenticator } }) =>
  runApiRoute(
    parseRequestBody(request, UserCredentials).pipe(Effect.flatMap((credentials) => authenticator.signIn(credentials))),
  );
```

```ts
// ✗ bad — route instantiates the UC, bypassing the middleware composition root
export const POST: APIRoute = (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  const authenticator = new AuthenticatorUC(supabase!); // wiring belongs in middleware
  return runApiRoute(
    parseRequestBody(context.request, UserCredentials).pipe(Effect.flatMap((c) => authenticator.signIn(c))),
  );
};
```
