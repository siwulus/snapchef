---
id: effect-conventions
title: Effect-TS Coding Conventions (Pipe-First Functional Programming)
status: archived
created: 2026-05-31
updated: 2026-06-06
---

# Effect-TS Coding Conventions (Pipe-First Functional Programming)

Add an `effect.md` convention domain to the registry under
`docs/reference/conventions/`, establishing Effect-TS as the first-choice
functional-programming approach for the application: pipe-first pipelines as
the preferred composition style, typed errors via `Data.TaggedError` (never
`throw`), and a strict "wrap Promises in, run Effects at the edge" boundary
discipline. zod remains the validation tool (per CLAUDE.md hard rule) and is
bridged into Effect. Effect Services/Layers are intentionally deferred to a
later convention. Register the new domain via the documented two-step
mechanism so it propagates through `CLAUDE.md → README → effect.md`.

See `plan-brief.md` for the two-pager and `plan.md` for the full plan.
