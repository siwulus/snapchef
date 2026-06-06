---
id: error-object-structure
title: Application Domain Error Structure (SnapchefError family)
status: archived
created: 2026-06-04
updated: 2026-06-06
---

# Application Domain Error Structure (SnapchefError family)

Build the application-wide domain error structure on Effect typed errors:
a `SnapchefError` family split into a server branch (`ServerSnapchefError`)
— domain errors in the framework-free core at `src/lib/core/model/error/` —
and a client branch (`ClientSnapchefError`) — browser transport errors at
`src/components/api/errors.ts`, where the root `SnapchefError` union also
lives (type-only import of the server branch). Concrete errors are
`Data.TaggedError` leaves (per the binding `effect.md` convention); the
family and its branches are expressed as union types. Server errors carry
`message` + `code` (an `ErrorCode` literal union) so the API boundary can
map them to HTTP statuses via an exhaustive `Record<ErrorCode, number>` map
in `src/lib/infrastructure/api/`. Both CLAUDE.md files gain the layer access
matrix. Existing auth routes are NOT migrated in this change — explicit
follow-up.

See `plan-brief.md` for the two-pager, `plan.md` for the full plan, and
`reviews/plan-review.md` for the review that relocated the client branch
out of core (F1) and added the access-matrix documentation (F2).
