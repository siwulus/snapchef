# Replace submitJson with a Browser-Oriented HTTP Client Layer — Plan Brief

> Full plan: `context/changes/submitJson-cleaning/plan.md`

## What & Why

`src/lib/submitJson.ts` is obsolete: it sits on the wrong side of the layer access matrix (a documented "legacy exception"), throws raw `Error`s against the Effect conventions, and is typed against a wire envelope the routes don't emit yet. We replace it with a fully browser-oriented HTTP layer — an Effect-based fetch core plus a generic `useApiClient` React hook that becomes the client-side HTTP layer for all front↔backend communication.

## Starting Point

The working tree is mid-rework and red: the user redesigned the wire contract (`ApiResponsePayload<T>` with a `data` envelope and mandatory `code` on errors) and rebuilt `runApiRoute` generically, but the auth routes still emit the old shape and the forms read fields that no longer exist. The client error leaves (`ApiRequestError`, `UnexpectedResponseError`) already exist from the previous change.

## Desired End State

Forms talk to the API through `useApiClient().post(url, body, dataSchema)` — a promise that never rejects, resolving to one discriminated union (success / API error / transport failure). Routes are Effect pipelines run through `runApiRoute`, exercising the SnapchefError family end-to-end. `submitJson.ts` is deleted, docs match the architecture, lint + build green.

## Key Decisions Made

| Decision            | Choice                                                    | Why (1 sentence)                                                                               |
| ------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Route scope         | Full Effect migration of signin/signup via `runApiRoute`  | Routes must change anyway for the new envelope; absorbing the follow-up avoids a double touch. |
| Client shape        | Effect `postJson` core + generic `useApiClient` hook      | One generic HTTP layer for the whole app, not a per-form submit helper.                        |
| ok:false channel    | Value — consumers branch on `ok`                          | Validation/business errors are expected outcomes, not exceptions.                              |
| Success payload     | `data: { redirect }` (server-driven)                      | Preserves today's server-as-routing-authority behavior exactly.                                |
| Envelope validation | zod-validate client-side (`ErrorCode` becomes a zod enum) | A generic layer shouldn't trust casts; contract drift fails loudly at the boundary.            |
| Transport failures  | Hook resolves to a normalized union — never rejects       | No try/catch in React code; aligns with Effect's no-throw philosophy.                          |
| Failure UX          | Existing sonner toast (status quo)                        | Transient infra problems aren't tied to a field; UX unchanged.                                 |

## Scope

**In scope:** client HTTP layer (`src/components/api/contract.ts`, `http.ts`), `useApiClient` hook, both auth forms, signin/signup route migration, `ErrorCode` → zod enum, shared `RedirectTarget` schema, `submitJson` deletion, doc alignment (matrix + root CLAUDE.md).

**Out of scope:** `signout` (plain HTML form POST), GET support, TanStack Query, retry/timeout/abort, `ErrorCode` vocabulary changes, test runner.

## Architecture / Approach

Browser: form → `useApiClient.post` (single client `runPromise` edge, catches all `ClientSnapchefError` into a `TransportFailure` variant) → `postJson` Effect (fetch → JSON → zod envelope validation reusing core's `ErrorCode` enum). Server: route handler → Effect pipeline (`decodeWith` command → supabase via `tryPromise` → typed `ServerSnapchefError`s) → `runApiRoute` (envelope + status map + defect→500). Wire: `ApiResponsePayload<T>` is the single contract both sides validate against.

## Phases at a Glance

| Phase                                  | What it delivers                                                             | Key risk                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1. Server side on the new envelope     | Routes as Effect pipelines emitting `data: { redirect }`; tree back to green | Status-code changes (401/422/502) — intentional, forms branch on envelope |
| 2. Browser HTTP layer + form migration | `useApiClient` + forms migrated; `submitJson` deleted; docs aligned          | Union ergonomics in forms (`"transport" in result` discrimination)        |

**Prerequisites:** uncommitted working-tree rework (envelope types, `runApiRoute`, `ts-pattern`) is the Phase 1 starting point — it lands in Phase 1's commit.
**Estimated effort:** ~2 sessions across 2 phases.

## Open Risks & Assumptions

- `runApiRoute`'s defect body has no `code`, so it intentionally fails client envelope validation → surfaces as toast. Don't "fix" by widening `ErrorCode`.
- Supabase auth error mapping (`UNAUTHORIZED` for signin, `BUSINESS_RULE_VIOLATED` for signup) loses supabase's own error granularity — acceptable, message passes through.
- No third-party API consumers assumed — wire shape changes ship atomically in one Worker deploy.

## Success Criteria (Summary)

- Auth flows (sign-in/up/out, field errors, server messages, redirects) behave exactly as today — through the new layer.
- Offline submit shows a toast with no unhandled rejection.
- `grep -r "submitJson" src` is empty; lint + build green.
