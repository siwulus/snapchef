# Effect-TS Coding Conventions — Plan Brief

> Full plan: `context/changes/effect-conventions/plan.md`

## What & Why

Add an `effect.md` convention domain to the registry at
`docs/reference/conventions/`, establishing **Effect-TS as the first-choice
functional-programming approach** for the application. The team wants Effect
pipelines to be the preferred way of writing functional code across the whole
app; this doc makes that binding and gives agents concrete `✓`/`✗` rules to obey.

## Starting Point

The conventions registry already exists (`README.md` + `generic.md` + `zod.md`)
with a documented two-step add procedure. `effect@^3.21.2` is installed but used
in zero `src/` files — the codebase is Promise-based (Supabase, Astro handlers,
React). So this convention is forward-looking: it governs new code.

## Desired End State

`docs/reference/conventions/effect.md` exists with five binding rules and is
registered in the registry index, so any agent reading `CLAUDE.md` transitively
loads and can cite the Effect rules. No runtime `src/` code changes.

## Key Decisions Made

| Decision               | Choice                                          | Why (1 sentence)                                                                 | Source |
| ---------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------- | ------ |
| Bindingness            | Strict everywhere + framework-edge carve-outs   | Matches "whole application" intent while respecting React/Astro/Cloudflare edges | Plan   |
| Composition style      | Pipe-first (`pipe`/`.pipe`), `gen` as exception | Literal reading of "Effect pipelines are the preferred way"                      | Plan   |
| Validation             | Keep zod, bridge into Effect                    | Honors the CLAUDE.md hard rule mandating zod; avoids a competing validator       | Plan   |
| Promise boundary       | `Effect.tryPromise` in, `runPromise` at edge    | Keeps logic pure end-to-end with one clear run-point                             | Plan   |
| Error handling         | `Data.TaggedError`, never `throw`               | Typed errors in the signature — the core reason to adopt Effect                  | Plan   |
| Services / Layers / DI | Deferred to a later convention                  | Keeps this first doc focused on pipelines + errors + boundary                    | Plan   |
| API anchor             | Stable Effect 3.x (not `unstable`/v4)           | Snippets must match the installed `effect@3.21.2`                                | Plan   |

## Scope

**In scope:** one new `effect.md` (5 rules); register it in `README.md` (table
row + `@`-import); format with Prettier.

**Out of scope:** Effect Schema / replacing zod; Services/Layers/DI rules;
migrating existing code to Effect; editing `CLAUDE.md` or `zod.md`.

## Architecture / Approach

Mirror the registry's own "create then register" two-step. Phase 1 authors the
standalone doc against the `generic.md`/`zod.md` template (`## Rule:` +
`✓ good`/`✗ bad` + `> **Exceptions:**`). Phase 2 adds the table row and
`@./effect.md` import to `README.md`, which the existing
`CLAUDE.md → README → <domain>.md` chain propagates into every agent's context.

## Phases at a Glance

| Phase                 | What it delivers                                    | Key risk                                                      |
| --------------------- | --------------------------------------------------- | ------------------------------------------------------------- |
| 1. Author `effect.md` | Five binding rules with stable-3.x `✓`/`✗` snippets | Snippets drifting to unstable/v4 API; over-mandating vs edges |
| 2. Register & verify  | Registry row + import; propagation confirmed        | Prettier table misalignment; import line in wrong block       |

**Prerequisites:** none — registry and `effect` dep already in place.
**Estimated effort:** ~1 short session across 2 phases.

## Open Risks & Assumptions

- "Strict everywhere" is ambitious for an Astro/React/Supabase app; the
  framework-edge exceptions are load-bearing — if under-specified, agents will
  either fight the framework or ignore the rule.
- Stable-3.x snippets must be hand-verified; several public Effect examples use
  the `unstable`/v4 surface that won't match `effect@3.21.2`.
- Convention is forward-looking — no existing code exercises it yet, so the first
  real validation comes when Effect code is actually written.

## Success Criteria (Summary)

- `effect.md` exists with five rules, passes `prettier --check`, uses only stable
  Effect 3.x APIs.
- Registered in `README.md` (table row + `@`-import); `npm run lint` unaffected.
- A fresh agent session, asked about async/FP style, cites the Effect pipe-first
  and typed-error rules — proving the propagation chain works.
