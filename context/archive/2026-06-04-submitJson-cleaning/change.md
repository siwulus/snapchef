---
id: submitJson-cleaning
title: Replace submitJson with a browser-oriented HTTP client layer
status: archived
created: 2026-06-04
updated: 2026-06-06
---

# Replace submitJson with a browser-oriented HTTP client layer

`src/lib/submitJson.ts` is obsolete: it lives on the wrong side of the layer
access matrix (a documented "legacy exception"), throws raw `Error`s against
the Effect conventions, and is now typed against a wire envelope
(`ApiResponsePayload<T>`) that the rest of the stack doesn't consistently
emit yet.

This change removes it and replaces it with a fully browser-oriented HTTP
layer under `src/components/api/` — an Effect-based `postJson` core with
zod-validated response envelopes, exposed to React through a generic
`useApiClient` hook (the client-side HTTP layer for all front↔backend
communication) that owns the single `runPromise` edge and resolves to a
normalized result union (never rejects). To converge both sides on the new
envelope, the auth routes (`signin`, `signup`) migrate to Effect pipelines
run through `runApiRoute`, exercising the SnapchefError family end-to-end.

See `plan-brief.md` for the two-pager and `plan.md` for the full plan.
