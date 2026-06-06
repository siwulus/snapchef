# Replace submitJson with a Browser-Oriented HTTP Client Layer — Implementation Plan

## Overview

Remove the obsolete `src/lib/submitJson.ts` and replace it with a fully browser-oriented HTTP layer under `src/components/api/`: an Effect-based `postJson` core (typed `ClientSnapchefError` failures, zod-validated response envelope) exposed to React through a generic `useApiClient` hook — the client-side HTTP layer for all front↔backend communication — that owns the single sanctioned `runPromise` edge and **never rejects**, resolving to a normalized result union. To converge both sides of the wire on the new `ApiResponsePayload<T>` envelope, the auth routes (`signin.ts`, `signup.ts`) migrate to Effect pipelines run through `runApiRoute`, exercising the `SnapchefError` family end-to-end for the first time.

## Current State Analysis

The working tree is **mid-rework and currently red** (2 lint errors). The uncommitted rework is the intentional starting point of this change and lands with Phase 1:

- `src/lib/infrastructure/api/types/index.ts` — redesigned wire contract: `ApiResponsePayload<T>` = `ApiSuccessResponsePayload<T>` (`{ ok: true; data: T }`) | `ApiErrorResponsePayload` (`{ ok: false; code: ErrorCode; message?; fieldErrors? }`). The old `ApiResult` / `FieldErrors` are gone.
- `src/lib/infrastructure/api/index.ts` (new) — generic `runApiRoute<T>(effect: Effect<T, ServerSnapchefError>): Promise<Response>`: wraps success values into the envelope, maps typed errors via `ts-pattern` (`toErrorApiResponsePayload`) + `ERROR_STATUS`, defects → generic 500. `error-response.ts` (previous home of this logic) is deleted.
- `package.json` — `ts-pattern@^5.9.0` added (no trailing newline — Prettier will restore it on commit).
- `src/pages/api/auth/signin.ts:4` / `signup.ts:4` — **stale**: import a non-existent `ApiResponse` type and hand-craft the OLD wire shape (`{ ok: true, redirect }`, errors without `code`) via local `jsonResponse` + `fieldErrorsFromIssues` helpers.
- `src/components/auth/SignInForm.tsx:29` / `SignUpForm.tsx:42` — the 2 lint errors: forms read `result.redirect`, which no longer exists on the success envelope (`data` carries the payload now).
- `src/lib/submitJson.ts` — the legacy client path: throws raw `Error` on unexpected statuses (against effect.md), lives in `src/lib` against the access matrix (documented legacy exception in `src/lib/CLAUDE.md`), and its generic is wrong (`submitJson<T>(url, data: T): Promise<ApiResponsePayload<T>>` — types the _response_ `data` as the _request_ body type).
- `src/components/api/errors.ts` — `ApiRequestError`, `UnexpectedResponseError`, `ClientSnapchefError` already exist, purpose-built for this replacement (previous change).
- `src/lib/core/model/error/index.ts` — `ErrorCode` is a plain TS literal union (type-only); `decodeWith` provides the zod→Effect bridge. Core already follows the zod same-name convention elsewhere (`SignInCommand`, `UserCredentials`).
- `src/pages/api/auth/signout.ts` — plain `context.redirect` route invoked by an HTML form POST in `Topbar.astro:13`; **not** a `submitJson` consumer.
- No test runner exists; verification is type-checked lint + build + manual flows.

## Desired End State

- `src/lib/submitJson.ts` is deleted; nothing references it.
- `src/components/api/http.ts` exports an Effect-based `postJson` that validates the response envelope with zod and fails only through `ClientSnapchefError`.
- `src/components/hooks/useApiClient.ts` exports the generic `useApiClient` hook — the one place React code touches HTTP and the single `runPromise` site on the client. It resolves to `ClientResult<T>` (envelope ∪ transport-failure variant) and never rejects.
- `signin.ts` / `signup.ts` are Effect pipelines handed to `runApiRoute`, emitting the new envelope with `data: { redirect }`; local `jsonResponse` / `fieldErrorsFromIssues` helpers are gone.
- `ErrorCode` is a zod enum (same-name convention) so the client envelope schema reuses the canonical code list without duplication.
- Both forms branch on the normalized union: success → redirect, `ok: false` → fieldErrors/serverMessage, transport failure → toast.
- Docs match reality: legacy exception removed from `src/lib/CLAUDE.md`, access matrix updated, stale `ApiResult`/`FieldErrors` references in root `CLAUDE.md` corrected.
- `npm run lint` and `npm run build` pass; sign-in / sign-up / sign-out flows work in the browser.

Verify by: lint + build green; `grep -r "submitJson" src` returns nothing; manual auth flows (valid, invalid-field, wrong-credentials, offline) behave as specified.

### Key Discoveries:

- `src/components/api/errors.ts:1-14` — the client error leaves already exist with exactly the right shapes (`ApiRequestError` carries `status?`/`cause?`; `UnexpectedResponseError` carries `cause?`).
- `src/lib/infrastructure/api/index.ts:61-70` — `runApiRoute` is already generic over the success type; routes only need to produce `Effect<{ redirect: string }, ServerSnapchefError>`.
- `src/lib/core/model/error/index.ts:36-44` — `decodeWith` already bridges zod→Effect for command parsing in routes.
- zod v4 enums support `.exclude()` — `BusinessRuleErrorCode` can be derived from the `ErrorCode` enum schema, preserving the same-name convention for both.
- `runApiRoute`'s defect handler emits `{ ok: false, message }` **without** `code` (`infrastructure/api/index.ts:53-59`) — this body intentionally fails client envelope validation, surfacing defects as `UnexpectedResponseError` → toast. No type change needed.
- Effect convention (`effect.md`): React event handlers are framework-edge — the hook's promise-returning methods are the sanctioned wrap-inward/run-once site.

## What We're NOT Doing

- **Not touching `signout`** — it's a plain HTML form POST → server redirect; no fetch involved, nothing to migrate.
- **No GET support in the HTTP layer yet** — only `postJson` is needed today; the module's shape (envelope schema + per-method functions) leaves room for `getJson` later.
- **No TanStack Query** — rejected: heavy dependency for two POST forms, overlaps react-hook-form's `isSubmitting`, sidesteps the Effect conventions.
- **No retry/timeout/abort logic** in the client — out of scope until a real need appears.
- **No RFC 9457**, no changes to the `ErrorCode` vocabulary or HTTP status mapping.
- **No test runner introduction.**

## Implementation Approach

Two phases, server-first, each ending green. Phase 1 lands the uncommitted envelope rework and migrates the routes onto `runApiRoute`, with a minimal two-line form patch (plus a temporary `submitJson` generic fix) so the whole stack speaks the new envelope and auth flows stay verifiable. Phase 2 builds the browser HTTP layer, migrates the forms onto `useApiClient`, deletes `submitJson`, and aligns the docs. Dependency directions stay clean: the client imports the `ErrorCode` zod enum and command/response schemas from core, envelope _types_ from `infrastructure/api/types`, and nothing else from `src/lib`.

## Critical Implementation Details

- **Defects have no `code` on the wire**: `runApiRoute`'s 500 body omits `code`, so it fails the client's envelope schema by design — the client reports it as `UnexpectedResponseError` and the form shows the generic toast. Do not add an `UNEXPECTED` member to `ErrorCode` to "fix" this.
- **`ValidationError` mapping gains `message`**: `toErrorApiResponsePayload` currently emits only `fieldErrors` for `ValidationError`. The invalid-JSON-body case produces a `ValidationError` with an empty `ZodError` (no field errors), so the mapper must also pass `message: error.message` through or that case becomes a silent `{ ok: false, code, fieldErrors: {} }`.
- **Status-code behavior changes are intentional**: wrong credentials move 400→401 (`UNAUTHORIZED`), supabase-unconfigured moves 400→502 (`EXTERNAL_SYSTEM_FAILURE`), signup rejection moves 400→422 (`BUSINESS_RULE_VIOLATED`). Forms branch on the envelope, not the status, so UX is unchanged.
- **Name collision guard**: the client-side envelope _schema builder_ must not be named `ApiResponsePayload` — that name is the infrastructure type. Use a lowercase factory (`apiResponsePayload(dataSchema)`); the zod same-name rule doesn't apply to schema-builder functions.

## Phase 1: Server side on the new envelope

### Overview

Land the uncommitted envelope/`runApiRoute` rework, convert `ErrorCode` to a zod enum, introduce the shared `RedirectTarget` response schema, migrate `signin.ts`/`signup.ts` to Effect pipelines, and patch the forms minimally so the phase ends green with working auth flows.

### Changes Required:

#### 1. ErrorCode as zod enum (core)

**File**: `src/lib/core/model/error/index.ts`

**Intent**: Make the canonical error-code list available as a runtime zod schema so the Phase 2 client envelope schema can reuse it without duplicating the literal list. Pure refactor — every exported name keeps working in type positions.

**Contract**: `ErrorCode` becomes `z.enum([...same seven literals...])` + same-name inferred type; `BusinessRuleErrorCode` becomes `ErrorCode.exclude(["VALIDATION_FAILED", "EXTERNAL_SYSTEM_FAILURE"])` + same-name type. All other exports (`ValidationError`, `BusinessRuleError`, `ExternalSystemError`, `ServerSnapchefError`, `decodeWith`) unchanged. `ERROR_STATUS: Record<ErrorCode, number>` in `infrastructure/api/index.ts` keeps compiling exhaustively against the inferred type.

#### 2. Shared redirect response schema (core boundary)

**File**: `src/lib/core/boundry/auth/index.ts`

**Intent**: The auth success payload (`{ redirect: string }`) is a wire contract shared by routes (producers) and the client (validator) — `core/boundry` is its designated home, like the command schemas.

**Contract**: Export `RedirectTarget = z.object({ redirect: z.string() })` + same-name inferred type.

#### 3. ValidationError mapping gains message (infrastructure)

**File**: `src/lib/infrastructure/api/index.ts`

**Intent**: Pass `message` through for `ValidationError` payloads so non-field validation failures (invalid JSON body) aren't silent.

**Contract**: The `ValidationError` branch of `toErrorApiResponsePayload` emits `{ ok: false, code, message: error.message, fieldErrors }`. No other changes to this file (it lands as the user reworked it).

#### 4. Auth routes as Effect pipelines

**Files**: `src/pages/api/auth/signin.ts`, `src/pages/api/auth/signup.ts`

**Intent**: Replace the hand-crafted old-shape responses with Effect pipelines handed to `runApiRoute` — deleting the local `jsonResponse` / `fieldErrorsFromIssues` helpers and exercising the error family end-to-end.

**Contract**: Each `POST` handler builds `Effect.Effect<RedirectTarget, ServerSnapchefError>` and returns `runApiRoute(pipeline)`. Pipeline steps (pipe-first, per effect.md):

- Body parse: `Effect.tryPromise` around `context.request.json()`, failing with `ValidationError({ message: "Invalid request body", error: new z.ZodError([]) })`.
- Command decode: `decodeWith(SignInCommand)` / `decodeWith(UserCredentials)`.
- Supabase client: `createClient(...)` returning `null` → `ExternalSystemError({ message: "Supabase is not configured", cause: null })`.
- Auth call: `Effect.tryPromise` around `signInWithPassword` / `signUp`, rejection → `ExternalSystemError`; resolved `{ error }` → `BusinessRuleError` with the supabase message — `code: "UNAUTHORIZED"` for signin, `code: "BUSINESS_RULE_VIOLATED"` for signup.
- Success value: `{ redirect: "/recipes" }` (signin) / `{ redirect: "/auth/confirm-email" }` (signup).

`export const prerender = false` stays.

#### 5. Minimal form + submitJson patch (temporary, dies in Phase 2)

**Files**: `src/components/auth/SignInForm.tsx`, `src/components/auth/SignUpForm.tsx`, `src/lib/submitJson.ts`

**Intent**: Two-line fix so the phase ends lint-green and auth flows are manually verifiable against the new envelope. `submitJson` survives one more phase.

**Contract**: `submitJson` generic flips to the response side: `submitJson = async <TRes>(url: string, data: unknown): Promise<ApiResponsePayload<TRes>>`. Forms call `submitJson<RedirectTarget>(...)` and read `result.data.redirect` (drop the `?? fallback` — `data.redirect` is now always present). Error branches (`fieldErrors`, `message`) already match `ApiErrorResponsePayload`.

### Success Criteria:

#### Automated Verification:

- Type-checked lint passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- Sign-in: valid credentials redirect to `/recipes`; bad email shows field error; wrong credentials show the supabase message inline
- Sign-up: validation errors per field; success redirects to `/auth/confirm-email`
- Sign-out from the topbar still works (untouched path)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 2: Browser HTTP layer + form migration

### Overview

Build the browser-oriented HTTP layer (`postJson` Effect core + envelope validation + `useApiClient` hook), migrate both forms, delete `submitJson.ts`, and align the three documentation files.

### Changes Required:

#### 1. Envelope schema + client result union

**File**: `src/components/api/contract.ts` (new)

**Intent**: Client-owned runtime validation of the wire envelope, reusing the canonical `ErrorCode` enum from core, plus the normalized result type the hook resolves to.

**Contract**: Exports (Phase 2's other files and all future client consumers depend on these):

```ts
// builder — validates the full envelope for a given data schema
export const apiResponsePayload = <S extends z.ZodType>(
  data: S,
): z.ZodType<ApiResponsePayload<z.output<S>>>;
// discriminatedUnion on `ok`: { ok: true, data } | { ok: false, code: ErrorCode (zod enum from core), message?, fieldErrors? (record) }

// what useApiClient resolves to — the wire envelope widened with a transport-failure variant
export type TransportFailure = { ok: false; transport: ClientSnapchefError };
export type ClientResult<T> = ApiResponsePayload<T> | TransportFailure;
```

Consumers discriminate: `result.ok` → success; `"transport" in result` → transport failure; otherwise API error payload.

#### 2. Effect-based HTTP core

**File**: `src/components/api/http.ts` (new)

**Intent**: The single fetch wrapper for the browser — all failure modes typed as `ClientSnapchefError`, response envelope zod-validated before anything reaches React code.

**Contract**: `postJson = <S extends z.ZodType>(url: string, body: unknown, dataSchema: S): Effect.Effect<ApiResponsePayload<z.output<S>>, ClientSnapchefError>`. Pipe-first pipeline: `fetch` (POST, JSON headers, `credentials: "same-origin"`) via `Effect.tryPromise` → `ApiRequestError({ message, cause })` on network failure; `response.json()` via `Effect.tryPromise` → `UnexpectedResponseError` (carry `response.status` context); envelope `safeParse` with `apiResponsePayload(dataSchema)` → mismatch fails with `UnexpectedResponseError({ cause: zodError })`. No status-code gating — the envelope discriminates; non-conforming bodies (e.g. `runApiRoute`'s code-less 500 defect body) land in `UnexpectedResponseError` by design.

#### 3. useApiClient hook — the client-side HTTP layer

**File**: `src/components/hooks/useApiClient.ts` (new)

**Intent**: The generic hook React components use for all front↔backend communication. Owns the client's single `runPromise` edge; future cross-cutting concerns (auth headers, base URL, telemetry) get one home.

**Contract**: `useApiClient()` returns a stable object with `post: <S extends z.ZodType>(url: string, body: unknown, dataSchema: S) => Promise<ClientResult<z.output<S>>>`. Implementation: pipe `postJson(...)` through `Effect.catchAll` mapping every `ClientSnapchefError` to a succeeded `TransportFailure`, then one `Effect.runPromise` — the promise **never rejects**. Memoize the returned object so it's referentially stable across renders.

#### 4. Form migration

**Files**: `src/components/auth/SignInForm.tsx`, `src/components/auth/SignUpForm.tsx`

**Intent**: Forms drop `submitJson` and the `try/catch`, consuming the normalized union from `useApiClient`.

**Contract**: `const { post } = useApiClient()`; `onSubmit` awaits `post("/api/auth/signin", data, RedirectTarget)` and branches three ways: `ok` → `setPendingRedirect(result.data.redirect)`; transport variant → existing sonner toast ("Something went wrong. Please try again."); API error payload → existing `fieldErrors`/`serverMessage` mapping. No `try/catch` remains in either form.

#### 5. Delete submitJson

**File**: `src/lib/submitJson.ts` (delete)

**Intent**: The legacy path is unreferenced after change #4 — remove it.

**Contract**: File deleted; `grep -r "submitJson" src` returns nothing.

#### 6. Documentation alignment

**File**: `src/lib/CLAUDE.md`

**Intent**: The legacy exception is resolved; the matrix must also sanction the client's value-level imports of the `ErrorCode` enum (core/model) introduced in Phase 1.

**Contract**: Remove the `submitJson.ts` legacy-exception blockquote. Amend the components row: types **and zod schemas** from `core/model/**` (e.g. the `ErrorCode` enum), keeping schemas from `core/boundry/**` as-is.

**File**: `CLAUDE.md` (repo root)

**Intent**: The structure line still names the dead `ApiResult` / `FieldErrors` contracts.

**Contract**: Update the `infrastructure/api/types/` mention to `ApiResponsePayload` and add `src/components/api/` (client HTTP layer + transport errors) to the components line. Two surgical edits, nothing else.

### Success Criteria:

#### Automated Verification:

- Type-checked lint passes: `npm run lint`
- Production build passes: `npm run build`
- No references remain: `grep -r "submitJson" src` exits empty

#### Manual Verification:

- Sign-in and sign-up flows behave as in Phase 1 (field errors, server messages, redirects) — now through `useApiClient`
- Transport failure path: with DevTools offline (or dev server stopped), submitting shows the toast — no unhandled rejection in console
- Review: docs (`src/lib/CLAUDE.md` matrix, root `CLAUDE.md`) match the implemented layering

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human.

---

## Testing Strategy

### Unit Tests:

- None — no test runner (out of scope). Compensating controls: TypeScript strict type-checked lint (typed failure channels, discriminated unions, exhaustive `ts-pattern` match) and the build.

### Integration Tests:

- None automated; the manual flows below are the integration check.

### Manual Testing Steps:

1. `npm run dev`; sign in with valid credentials → redirected to `/recipes`.
2. Sign in with a malformed email → inline field error; with wrong credentials → supabase message in the `ServerError` slot.
3. Sign up with mismatched passwords → `confirmPassword` field error; with a valid new account → redirect to `/auth/confirm-email`.
4. Toggle DevTools network to offline, submit sign-in → toast appears, console shows no unhandled promise rejection.
5. Sign out from the topbar → redirected to `/`.

## Performance Considerations

None material — same fetch count as today; envelope `safeParse` on small JSON bodies is negligible. The memoized hook object avoids re-render churn.

## Migration Notes

- The wire contract changes shape (`data` envelope, `code` on errors, new statuses 401/422/502). Client and server ship in the same Worker deploy, so no compatibility window is needed — there are no third-party API consumers.
- The uncommitted working-tree rework (envelope types, `runApiRoute`, `ts-pattern`, deleted `error-response.ts`) is absorbed into Phase 1's commit.

## References

- Change identity: `context/changes/submitJson-cleaning/change.md`
- Prior change (error family): `context/changes/error-object-structure/plan.md`
- Binding conventions: `docs/reference/conventions/effect.md`, `docs/reference/conventions/zod.md`, `docs/reference/conventions/generic.md`
- Layer access matrix: `src/lib/CLAUDE.md`
- Edge runner: `src/lib/infrastructure/api/index.ts:61-70`
- Client error leaves: `src/components/api/errors.ts:1-14`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Server side on the new envelope

#### Automated

- [x] 1.1 Type-checked lint passes: `npm run lint` — 77bec1cfc
- [x] 1.2 Production build passes: `npm run build` — 77bec1cfc

#### Manual

- [x] 1.3 Sign-in: valid → `/recipes`; bad email → field error; wrong credentials → supabase message inline — 77bec1cfc
- [x] 1.4 Sign-up: per-field validation errors; success → `/auth/confirm-email` — 77bec1cfc
- [x] 1.5 Sign-out from the topbar still works — 77bec1cfc

### Phase 2: Browser HTTP layer + form migration

#### Automated

- [x] 2.1 Type-checked lint passes: `npm run lint` — f43ed5537
- [x] 2.2 Production build passes: `npm run build` — f43ed5537
- [x] 2.3 No references remain: `grep -r "submitJson" src` exits empty — f43ed5537

#### Manual

- [x] 2.4 Sign-in / sign-up flows behave as in Phase 1 — now through `useApiClient` — f43ed5537
- [x] 2.5 Offline submit shows toast; no unhandled rejection in console — f43ed5537
- [x] 2.6 Review: `src/lib/CLAUDE.md` matrix + root `CLAUDE.md` match implemented layering — f43ed5537
