# Application Domain Error Structure (SnapchefError family) — Plan Brief

> Full plan: `context/changes/error-object-structure/plan.md`

## What & Why

Build the application-wide domain error structure on Effect typed errors: a `SnapchefError` family with a server branch (`ServerSnapchefError` — domain errors in the framework-free core) and a client branch (`ClientSnapchefError` — browser transport errors under `src/components/api/`, where the root union also lives). Server errors carry `message` + `code` so the API boundary can derive the HTTP status from the code instead of hard-coding it per call site. This gives every future service, route, and form one typed, matchable error vocabulary — and is the first real Effect code in `src/`, validating the `effect.md` convention.

## Starting Point

`src/lib/core/model/error/index.ts` exists but is empty; `effect@3.21.2` is installed but unused in `src/`. API routes hard-code statuses and ad-hoc `ApiResult` bodies inline (`signin.ts`); the client helper `submitJson.ts` throws raw `Error`s. The binding `effect.md` convention already prescribes `Data.TaggedError`, the zod→Effect bridge, and run-at-the-edge discipline.

## Desired End State

`core/model/error/` exports the server side — `ErrorCode` vocabulary, three server leaves (`ValidationError`, `BusinessRuleError`, `ExternalSystemError`), the `ServerSnapchefError` union, and a generic `decodeWith` zod bridge. `src/components/api/errors.ts` exports the client side — two transport leaves (`ApiRequestError`, `UnexpectedResponseError`), `ClientSnapchefError`, and the root `SnapchefError` union (type-only import of the server branch). `infrastructure/api/` exports the boundary mapper: exhaustive `ErrorCode → status` map, `ZodError → FieldErrors` flattener, `errorToResponse`, and a `runApiRoute` edge runner (typed failures → mapped status, defects → 500). `ApiResult` gains an optional `code`. Both `CLAUDE.md` files document the layer access matrix. No runtime behavior changes yet.

## Key Decisions Made

| Decision            | Choice                                                        | Why (1 sentence)                                                                                                                             | Source      |
| ------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Family shape        | `Data.TaggedError` leaves + union types as branches           | Convention-compliant and idiomatic — `catchTag` discriminates on `_tag`, not instanceof                                                      | Plan        |
| Error codes         | `ErrorCode` literal union in core; status map in infra        | Core stays HTTP-free; the map is compiler-enforced exhaustive                                                                                | Plan        |
| Server taxonomy     | Exactly three leaves; `BusinessRuleError.code` differentiates | Minimal as requested; unexpected crashes stay defects (→ 500), not typed errors                                                              | Plan        |
| Client branch       | Two leaves modeling today's `submitJson` failure modes        | Real, immediately usable members — no speculative taxonomy                                                                                   | Plan        |
| Client branch home  | `src/components/api/errors.ts`, NOT core                      | Transport errors aren't domain errors; core must not know the browser exists (F1)                                                            | Plan review |
| Layer access matrix | Documented in `src/lib/CLAUDE.md`                             | Components → types from `infrastructure/api` + `core/model`, schemas from `core/boundry`; routes → boundry/model/usecase/infrastructure (F2) | Plan review |
| Boundary scope      | Structure + mapper only; **no route migration**               | Smallest safe footprint; auth routes migrate in a follow-up change                                                                           | Plan        |
| ValidationError     | Carries raw `z.ZodError`; flattened at the boundary           | Full fidelity in core; presentation concerns stay at the edge (effect.md bridge)                                                             | Plan        |
| API contract        | `ApiResult` error branch gains optional `code`                | Clients branch on stable codes, backward-compatible                                                                                          | Plan        |

## Scope

**In scope:** `core/model/error/index.ts` (server branch + `decodeWith`); `src/components/api/errors.ts` (client transport branch + root union); `infrastructure/api/error-response.ts` (status map, flattener, `errorToApiResult`/`errorToResponse`, `runApiRoute`); `ApiResult` extension; root CLAUDE.md amendment allowing `effect` in core; `src/lib/CLAUDE.md` rewrite with the layer access matrix.

**Out of scope:** migrating auth routes or `submitJson.ts`; `UnexpectedError` class; RFC 9457; Effect Services/Layers; `effect/Schema`; granular per-case error classes; adding a test runner.

## Architecture / Approach

Two phases along the layer seams. Phase 1 defines the family across its two homes — server branch in `core/model/error/` (imports `effect` + `zod` only), client transport branch + root union in `src/components/api/` (type-only import of the server branch) — and documents the layer access matrix in both `CLAUDE.md` files. Phase 2 builds the HTTP adapter in `infrastructure/api/`, which imports the core types and owns the server-side HTTP knowledge — including `runApiRoute`, the single sanctioned `Effect.runPromise` site future routes will call. Nothing imports the new modules yet; the type-checker (exhaustive map, typed channels) plus lint/build validate the design.

## Phases at a Glance

| Phase                  | What it delivers                                                                                       | Key risk                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 1. Error family        | Server branch + zod bridge in core; client branch + root union in `components/api`; access matrix docs | Drifting to unstable/v4 Effect API; wrong fixed-vs-prop code design |
| 2. API boundary mapper | `ApiResult.code`, status map, response helpers, `runApiRoute`                                          | Shipping unexercised code — design flaws surface only at migration  |

**Prerequisites:** none — `effect` installed, conventions registered, empty target file in place.
**Estimated effort:** ~1 short session across 2 phases.

## Open Risks & Assumptions

- Both modules ship unreferenced by runtime code (deliberate); the real validation comes when the follow-up change migrates the auth routes — the type-level guarantees mitigate but don't eliminate this.
- The seven-member `ErrorCode` set is a starting vocabulary; extending it is cheap (compiler forces the status-map update).
- Assumes `effect` is acceptable in the "framework-free" core layer — the plan amends the CLAUDE.md wording accordingly.
- The access matrix declares `submitJson.ts` a documented legacy exception (components import it from `src/lib`) until the follow-up change relocates it to `src/components/api/`.

## Success Criteria (Summary)

- `npm run lint` and `npm run build` pass with the new modules in place.
- The exported error surface matches the documented contract, and `ERROR_STATUS` exhaustiveness is compiler-enforced.
- Existing auth flows behave exactly as before — proof that the change is purely additive.
