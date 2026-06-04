# Application Domain Error Structure (SnapchefError family) Implementation Plan

## Overview

Build the application-wide domain error structure on Effect typed errors: a `SnapchefError` family split into a **server branch** (`ServerSnapchefError`) — domain errors living in the framework-free core at `src/lib/core/model/error/` — and a **client branch** (`ClientSnapchefError`) — browser transport errors living client-side at `src/components/api/errors.ts`, together with the root `SnapchefError` union (which imports the server branch type-only). Concrete errors are `Data.TaggedError` leaves per the binding `effect.md` convention; the family and its branches are expressed as **union types** (mirroring the zod same-name convention's spirit: one name, used in type positions). Server errors carry `message` + `code` (an `ErrorCode` literal union) so the API boundary can map them to HTTP statuses via an exhaustive `Record<ErrorCode, number>` map living in `src/lib/infrastructure/api/`.

> Revised after plan review (F1): client transport errors are NOT domain errors — they describe the browser↔server transport, so they live under `src/components/`, not core. Core knows nothing about the browser.

This is the first real Effect code in `src/` — it puts the `docs/reference/conventions/effect.md` rules (typed errors via `Data.TaggedError`, zod bridge, run-at-the-edge) into practice.

## Current State Analysis

- `src/lib/core/model/error/index.ts` **exists and is empty (0 lines)** — created during the project restructuring (`1d126e358`) as the designated home for the error domain model.
- `effect@^3.21.2` is installed; **zero `src/` files import it**. The `effect.md` convention (binding) prescribes `Data.TaggedError` for domain errors, `Effect.fail` over `throw`, zod→Effect bridging via `safeParse`, and a single `runPromise` at the framework edge.
- The API boundary is ad-hoc today: `src/pages/api/auth/signin.ts:8-12` defines a local `jsonResponse` helper, `signin.ts:14-18` flattens `z.ZodError` issues inline, and statuses `200`/`400` are hard-coded per call site. `signup.ts` mirrors this; `signout.ts` is a 12-line variant.
- `src/lib/infrastructure/api/types/index.ts` defines the wire contract: `ApiResult<T>` (`{ ok: true; redirect? } | { ok: false; message?; fieldErrors? }`) and `FieldErrors<T>`.
- `src/lib/submitJson.ts:12` is the only client-side failure path today — it `throw`s a raw `Error` on unexpected statuses.
- Root `CLAUDE.md` describes `src/lib/core/` as "framework-free domain layer (imports `zod` only, no Astro/Supabase)". Effect must be added to that allowance for the server branch to live in core.
- The cross-layer import topology is already established: `SignInForm.tsx`/`SignUpForm.tsx` import `submitJson` (value) from `src/lib`, command schemas (values) from `core/boundry/auth`, the `UserCredentials` type from `core/model/auth`, and `submitJson.ts` imports the `ApiResult` type from `infrastructure/api/types` — so `infrastructure/api` types and `core` types/schemas are de-facto client-shared today.
- `src/lib/CLAUDE.md` is stale: it still asserts "Server-only by default… never import from `src/lib/` into a React component" and "No barrel `index.ts`" — both already broken by the restructuring (see previous bullet). Left as-is, it gives implementing agents binding rules that forbid what this plan builds.
- No test runner exists in the project (`package.json` scripts: `dev`, `build`, `preview`, `lint`, `lint:fix`, `format`). Verification is type-checked ESLint + build.

## Desired End State

- `src/lib/core/model/error/index.ts` exports the server side of the family: `ErrorCode`, three server leaves (`ValidationError`, `BusinessRuleError`, `ExternalSystemError`), the branch union `ServerSnapchefError`, and a generic zod→Effect decode helper. Nothing browser- or transport-related lives here.
- `src/components/api/errors.ts` exports the client side: two transport leaves (`ApiRequestError`, `UnexpectedResponseError`), the branch union `ClientSnapchefError`, and the root union `SnapchefError` (type-only import of the server branch).
- `src/lib/infrastructure/api/` exports the boundary mapper: an exhaustive `ErrorCode → HTTP status` map, a `z.ZodError → FieldErrors` flattener, `errorToApiResult` / `errorToResponse`, and a `runApiRoute` edge runner that maps typed failures to mapped statuses and defects to a generic 500.
- `ApiResult`'s error branch carries an optional `code: ErrorCode` (backward-compatible).
- Root `CLAUDE.md` and `src/lib/CLAUDE.md` document the layer access matrix (what components and API routes may import) so the rules agents read match what the code does.
- `npm run lint` and `npm run build` pass. No runtime behavior changes — existing routes and `submitJson` are untouched.

Verify by: lint + build green; reviewing that every exported name above exists and the `ERROR_STATUS` map is compiler-enforced exhaustive over `ErrorCode`.

### Key Discoveries:

- `effect.md` "Keep zod for validation" rule shows the exact `ValidationError` + `safeParse` bridge pattern this plan adopts — follow it verbatim.
- `effect.md` "Wrap Promises at the boundary" rule sanctions exactly one `runPromise` site per handler — `runApiRoute` is that site, packaged for reuse.
- `signin.ts:14-18` (`fieldErrorsFromIssues`) is the proven flattening logic (first issue per top-level field) — Phase 2 lifts this shape into the shared mapper; the inline copy in `signin.ts` stays until route migration.
- `Effect.catchTag` discriminates on the `_tag` field at runtime, so union-type branches (not `instanceof`) are fully sufficient for granular recovery.
- Per-domain `index.ts` files are the established core layout (`core/boundry/auth/index.ts`, `core/model/auth/index.ts`) — `core/model/error/index.ts` follows it. (`src/lib/CLAUDE.md`'s "no barrel index.ts" rule predates the restructuring; root `CLAUDE.md`'s structure section governs — Phase 1 change #3 fixes the stale doc.)
- Plan-review finding F1 (confirmed): `ApiRequestError` carries an HTTP `status` and models fetch transport failures — placing it in core would contradict both the layer rule and Phase 2's own "infrastructure owns HTTP knowledge" principle. Hence the client branch lives under `src/components/api/`.

## What We're NOT Doing

- **Not migrating the auth routes** (`signin.ts`, `signup.ts`, `signout.ts`) to Effect pipelines or to the new mapper — explicit follow-up change.
- **Not refactoring `submitJson.ts`** to fail with the new client leaves — the leaves are defined; wiring them in (and relocating `submitJson` under `src/components/api/`, where the access matrix says client adapters belong) is the route-migration follow-up.
- No `UnexpectedError` leaf — unexpected crashes are Effect **defects**, handled by `runApiRoute` as a generic 500, never part of the typed channel.
- No RFC 9457 problem+json; `ApiResult` is only extended with optional `code`.
- No Effect Services/Layers/DI (deferred per the effect-conventions change).
- No `effect/Schema` — zod remains the sole validator (hard rule).
- No granular per-case error classes (`NotFoundError`, `ConflictError`, …) — `BusinessRuleError`'s `code` field differentiates cases.
- No test runner introduction — out of scope for this change.

## Implementation Approach

Two phases along the architectural seams the restructuring established. Phase 1 defines the error family across its two homes — the server branch and zod bridge in `core/model/error/` (framework-free domain), the client transport branch plus root union in `src/components/api/` (browser) — and updates both `CLAUDE.md` files: the root allowance for `effect` in core, and the `src/lib/CLAUDE.md` layer access matrix. Phase 2 builds the boundary mapper in `infrastructure/api/`, which imports the core types and owns the server-side HTTP knowledge (status map, response serialization, the single `runPromise` edge). Dependency directions stay clean: components → core (types/schemas only) and components → infrastructure/api (types only); core imports nothing inward; server code never imports `src/components`. Nothing imports the new modules yet; the design is validated by the type-checker (exhaustive map, typed channels) and by lint/build.

## Critical Implementation Details

- **Effect import surface**: use only stable `effect@3.x` API — `Data.TaggedError`, `Effect.fail/succeed`, `Effect.catchAll`, `Effect.catchAllDefect`, `Effect.runPromise`. Do not import from `effect/unstable/*` (binding convention; several public examples online use the v4/unstable surface).
- **Exhaustiveness**: declare the status map as `Record<ErrorCode, number>` (or `satisfies Record<ErrorCode, number>`) so adding an `ErrorCode` member without a mapping is a compile error — this two-file contract is intentional (decision: codes in core, statuses in infrastructure).
- **Fixed-code leaves**: `ValidationError` and `ExternalSystemError` have intrinsic codes; declare `code` as a class-body `readonly` literal field, not a constructor prop, so call sites can't supply a wrong code. Only `BusinessRuleError` takes `code` as a constructor prop, typed to the business subset of `ErrorCode`.
- **Root union is type-only across the seam**: `src/components/api/errors.ts` must import `ServerSnapchefError` with `import type` — server error classes are runtime values that must never enter the client bundle; only their shape crosses over.

## Phase 1: Error family (server branch in core, client branch in components)

### Overview

Define the SnapchefError family across its two homes: the `ErrorCode` vocabulary, server leaves, `ServerSnapchefError` union, and the generic zod→Effect decode helper in `src/lib/core/model/error/index.ts`; the client transport leaves, `ClientSnapchefError` union, and root `SnapchefError` union in `src/components/api/errors.ts`. Update both `CLAUDE.md` files so the documented rules match the architecture.

### Changes Required:

#### 1. Server error family module (core)

**File**: `src/lib/core/model/error/index.ts` (exists, empty)

**Intent**: The domain-error contract every future service and route depends on: the `ErrorCode` vocabulary, three server leaves, the server branch union, and a generic zod→Effect bridge. Nothing browser- or transport-related belongs here.

**Contract**: Imports from `effect` (`Data`, `Effect`) and `zod` only. The exported surface (other phases and future changes depend on these exact shapes):

```ts
export type ErrorCode =
  | "VALIDATION_FAILED" // 400
  | "UNAUTHORIZED" // 401
  | "FORBIDDEN" // 403
  | "NOT_FOUND" // 404
  | "CONFLICT" // 409
  | "BUSINESS_RULE_VIOLATED" // 422
  | "EXTERNAL_SYSTEM_FAILURE"; // 502

export type BusinessRuleErrorCode = Exclude<ErrorCode, "VALIDATION_FAILED" | "EXTERNAL_SYSTEM_FAILURE">;

// Server branch — every leaf exposes `message: string` and `code: ErrorCode`
export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string;
  readonly error: z.ZodError; // full fidelity; flattening happens at the boundary
}> {
  readonly code = "VALIDATION_FAILED";
}

export class BusinessRuleError extends Data.TaggedError("BusinessRuleError")<{
  readonly message: string;
  readonly code: BusinessRuleErrorCode; // differentiates NOT_FOUND / CONFLICT / …
}> {}

export class ExternalSystemError extends Data.TaggedError("ExternalSystemError")<{
  readonly message: string;
  readonly cause: unknown; // the wrapped Supabase/fetch failure
}> {
  readonly code = "EXTERNAL_SYSTEM_FAILURE";
}

// Server branch — a union TYPE; catchTag discriminates on _tag
export type ServerSnapchefError = ValidationError | BusinessRuleError | ExternalSystemError;

// Generic zod → Effect bridge (per effect.md "Keep zod for validation")
export const decodeWith: <Schema extends z.ZodType>(
  schema: Schema,
) => (input: unknown) => Effect.Effect<z.output<Schema>, ValidationError>;
```

`decodeWith` wraps `schema.safeParse(input)` and fails with `new ValidationError({ message: "Validation failed", error: result.error })` — the effect.md bridge pattern, generalized. Arrow functions, pipe-first, no `throw` (binding conventions).

#### 2. Client error module (browser)

**File**: `src/components/api/errors.ts` (new file, new directory)

**Intent**: Browser-side transport errors — today's real failure modes of the `submitJson` fetch path — plus the client branch union and the root union of the whole family. Lives under `src/components/` because these errors describe the browser↔server transport, which the framework-free core must not know about. `src/components/api/` is the designated home for client-side API plumbing (the follow-up change moves `submitJson` here).

**Contract**: Imports `Data` from `effect` and — `import type` only — `ServerSnapchefError` from `@/lib/core/model/error` (allowed by the access matrix: components may import core types). The exported surface:

```ts
export class ApiRequestError extends Data.TaggedError("ApiRequestError")<{
  readonly message: string;
  readonly status?: number;
  readonly cause?: unknown;
}> {}

export class UnexpectedResponseError extends Data.TaggedError("UnexpectedResponseError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type ClientSnapchefError = ApiRequestError | UnexpectedResponseError;

// Root of the whole family — client-only context (server code never imports src/components)
export type SnapchefError = ServerSnapchefError | ClientSnapchefError;
```

#### 3. Documentation: core import allowance + layer access matrix

**File**: `CLAUDE.md` (repo root)

**Intent**: The core layer description currently reads "imports `zod` only, no Astro/Supabase", which would forbid `effect` in core. Effect is the sanctioned app-wide FP foundation (per `docs/reference/conventions/effect.md`), not a framework/IO dependency.

**Contract**: In the Project Structure section, change the `src/lib/core/` line to read "imports `zod` and `effect` only, no Astro/Supabase". One-line edit; no other root CLAUDE.md content changes.

**File**: `src/lib/CLAUDE.md`

**Intent**: Replace the stale "server-only / never import into React" Local Rules with the layer access matrix, so the binding rules agents read match the architecture this plan (and the existing forms) implement.

**Contract**: The Local Rules section documents these access rules (wording up to the implementer, rules are fixed):

- `src/components/**` (browser) may import from `src/lib` only: **types** from `infrastructure/api/types` (e.g. `ApiResult`, `FieldErrors`), **types** from `core/model/**` (domain model), and **command schemas** from `core/boundry/**` (zod schemas shared with React forms, per root CLAUDE.md). Every other `src/lib` reference from components is forbidden. `submitJson.ts` is a documented legacy exception until the follow-up relocates it to `src/components/api/`.
- `src/pages/api/**` (Astro API routes) may import: `core/boundry` (commands in), `core/model`, `core/usecase` (use cases — how business logic is exposed by the API; directory is created when the first use case lands), and `infrastructure/**` (adapters).
- `infrastructure/db/**` is strictly server-only — never reachable from client code.
- Align the "No barrel `index.ts`" rule with the per-domain `index.ts` convention `core/*` already uses.

### Success Criteria:

#### Automated Verification:

- Type-checked lint passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- Review: exported surfaces of both modules match the contracts above (tags, fixed vs constructor-prop codes, branch unions, `decodeWith` signature, `import type`-only for the server branch in the client module); only stable `effect@3.x` imports used
- Review: `src/lib/CLAUDE.md` access matrix matches the agreed layer rules (components → types from `infrastructure/api/types` + `core/model`, schemas from `core/boundry`; API routes → `core/boundry`/`core/model`/`core/usecase`/`infrastructure`)
- Dev server still starts and existing auth flows behave unchanged (`npm run dev` — no runtime path touches this code yet)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual review was successful before proceeding to the next phase.

---

## Phase 2: API boundary mapper

### Overview

Build the infrastructure-side adapter: extend `ApiResult` with the optional `code`, and create the error-response module owning the `ErrorCode → status` map, the `ZodError → FieldErrors` flattener, serialization to `ApiResult`/`Response`, and the `runApiRoute` edge runner.

### Changes Required:

#### 1. ApiResult contract extension

**File**: `src/lib/infrastructure/api/types/index.ts`

**Intent**: Expose the error code on the wire so clients can branch on a stable code instead of parsing messages. Backward-compatible — the field is optional and existing routes/forms are unaffected.

**Contract**: The `ok: false` branch of `ApiResult<T>` gains `code?: ErrorCode` (imported as a type from `@/lib/core/model/error`). No change to the `ok: true` branch or `FieldErrors`.

#### 2. Error-response mapper module

**File**: `src/lib/infrastructure/api/error-response.ts` (new)

**Intent**: One module owning all HTTP knowledge about server errors, so future routes contain zero inline status decisions. Future API routes build their logic as `Effect.Effect<Response, ServerSnapchefError>` and hand it to `runApiRoute` — the single sanctioned `runPromise` site per the effect.md edge rule.

**Contract**: Exports (future route migration depends on these):

- `ERROR_STATUS` — exhaustive `ErrorCode → number` map (`VALIDATION_FAILED: 400`, `UNAUTHORIZED: 401`, `FORBIDDEN: 403`, `NOT_FOUND: 404`, `CONFLICT: 409`, `BUSINESS_RULE_VIOLATED: 422`, `EXTERNAL_SYSTEM_FAILURE: 502`), typed so a new `ErrorCode` member without an entry fails compilation.
- `fieldErrorsFromZodError(error: z.ZodError): FieldErrors` — same flattening shape as `signin.ts:14-18` (first issue per top-level string path key). The inline copy in `signin.ts` stays untouched until route migration.
- `errorToApiResult(error: ServerSnapchefError): ApiResult` — `ValidationError` → `{ ok: false, code, fieldErrors }`; `BusinessRuleError`/`ExternalSystemError` → `{ ok: false, code, message }`. For `ExternalSystemError` the body message is a generic user-safe string, not `cause` details.
- `errorToResponse(error: ServerSnapchefError): Response` — JSON `Response` of `errorToApiResult` with status `ERROR_STATUS[error.code]`.
- `runApiRoute(effect: Effect.Effect<Response, ServerSnapchefError>): Promise<Response>` — pipe-first: `Effect.catchAll` → `errorToResponse`; `Effect.catchAllDefect` → generic 500 JSON (`{ ok: false, message: "Unexpected server error" }`); then the single `Effect.runPromise`.

### Success Criteria:

#### Automated Verification:

- Type-checked lint passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- Review: `ERROR_STATUS` exhaustiveness is compiler-enforced (temporarily add a fake `ErrorCode` member and confirm the map errors, then revert)
- Review: `runApiRoute` is the only `runPromise` call; defects map to 500 and never leak `cause` details into the body
- Dev server starts; auth flows (sign-in, sign-up, sign-out) behave exactly as before — no route was modified

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual review was successful.

---

## Testing Strategy

### Unit Tests:

- None — the project has no test runner (out of scope to add one). The compensating controls are TypeScript strict type-checked lint (typed error channels, exhaustive map) and the build.

### Integration Tests:

- None in this change; the first end-to-end exercise of the family is the follow-up route-migration change.

### Manual Testing Steps:

1. `npm run lint` and `npm run build` — both green.
2. `npm run dev`; sign in, sign up, sign out — identical behavior to before (proves no accidental runtime coupling).
3. Exhaustiveness probe: add `| "PROBE"` to `ErrorCode`, observe the `ERROR_STATUS` compile error, revert.

## Performance Considerations

None — pure type/class definitions and a small mapper; no runtime path executes them yet.

## Migration Notes

- No data or behavior migration. Both new modules are unreferenced by runtime code until the follow-up change migrates the auth routes (and `submitJson.ts`) onto them.
- `ApiResult.code` is optional, so existing serialized responses remain valid.

## References

- Binding conventions: `docs/reference/conventions/effect.md` (TaggedError, pipe-first, zod bridge, run-at-the-edge), `docs/reference/conventions/zod.md`, `docs/reference/conventions/generic.md`
- Prior change establishing the conventions: `context/changes/effect-conventions/plan.md`
- Current boundary pattern to be replaced later: `src/pages/api/auth/signin.ts:8-45`
- Wire contract: `src/lib/infrastructure/api/types/index.ts`
- Client failure path the client leaves model: `src/lib/submitJson.ts:11-13`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Error family (server branch in core, client branch in components)

#### Automated

- [x] 1.1 Type-checked lint passes: `npm run lint` — 451c09496
- [x] 1.2 Production build passes: `npm run build` — 451c09496

#### Manual

- [x] 1.3 Review: exported surfaces of both modules match the contracts (tags, codes, unions, `decodeWith`, type-only server-branch import); stable effect 3.x imports only — 451c09496
- [x] 1.4 Review: `src/lib/CLAUDE.md` access matrix matches the agreed layer rules — 451c09496
- [x] 1.5 Dev server starts; existing auth flows behave unchanged — 451c09496

### Phase 2: API boundary mapper

#### Automated

- [x] 2.1 Type-checked lint passes: `npm run lint` — 2b0c9ed8e
- [x] 2.2 Production build passes: `npm run build` — 2b0c9ed8e

#### Manual

- [x] 2.3 Review: `ERROR_STATUS` exhaustiveness compiler-enforced (probe + revert) — 2b0c9ed8e
- [x] 2.4 Review: `runApiRoute` is the only `runPromise`; defects → generic 500, no `cause` leakage — 2b0c9ed8e
- [x] 2.5 Dev server starts; sign-in/sign-up/sign-out behave exactly as before — 2b0c9ed8e
