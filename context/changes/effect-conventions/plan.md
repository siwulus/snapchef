# Effect-TS Coding Conventions Implementation Plan

## Overview

Add a new `effect.md` convention domain to the conventions registry at
`docs/reference/conventions/`, establishing **Effect-TS as the first-choice
functional-programming approach** for the application. The doc codifies five
binding rules — Effect-over-Promise, pipe-first composition, wrap-at-boundary /
run-at-edge, typed errors with no `throw`, and keep-zod-and-bridge — each in the
established `## Rule:` + `✓ good` / `✗ bad` + `> **Exceptions:**` format. Then
register the domain (table row + `@`-import) so it propagates into every agent's
context via the `CLAUDE.md → README → effect.md` chain.

## Current State Analysis

- **The registry is a clean extension point.** `docs/reference/conventions/README.md`
  documents the exact two-step add procedure (create `<domain>.md`; register a
  table row + `@./<domain>.md` import). `generic.md` and `zod.md` are the
  structural templates — `## Rule:` heading, one imperative sentence, a fenced
  `✓ good` / `✗ bad` TypeScript pair, optional `> **Exceptions:**` blockquote.
- **`generic.md` already mandates** arrow functions and functional mappings over
  imperative loops. The Effect convention is the FP _vehicle_ that builds on
  this — it must compose with, not contradict, `generic.md`.
- **`zod.md` + CLAUDE.md hard rule** make zod the binding validation tool
  ("Validate API input with `zod`"). The Effect convention must not introduce
  `effect/Schema` as a competing validator.
- **Effect is installed (`effect@^3.21.2`) but used in zero `src/` files**;
  `context/foundation/lessons.md` is empty. This convention is forward-looking —
  it governs new code, not an existing Effect codebase. The codebase is
  Promise-based throughout (Supabase SSR client, Astro endpoint handlers, React
  islands).
- **Stable Effect 3.x API is the anchor.** Some documentation sources show an
  `unstable`/v4 surface (`effect/unstable/http`, `Schema.TaggedErrorClass`). All
  snippets in this convention use the **stable 3.x API**: `Effect.Effect<A, E, R>`,
  `pipe` / `.pipe()`, `Effect.map`/`flatMap`/`tap`/`andThen`/`catchTag`,
  `Effect.tryPromise`, `Effect.runPromise`, and `Data.TaggedError`.

### Key Discoveries:

- Registration mechanism: `docs/reference/conventions/README.md:18-30` ("How to
  Add a New Convention Domain").
- Template to match: `docs/reference/conventions/generic.md`,
  `docs/reference/conventions/zod.md`.
- Active Domains table + `@`-import block to extend: `README.md:5-14`.
- Prettier formats markdown (`npm run format`) — the new doc and edited README
  must pass `prettier --check`.

## Desired End State

A new file `docs/reference/conventions/effect.md` exists with five binding
rules, registered in `README.md` (one table row + one `@`-import line). Running
`npx prettier --check docs/reference/conventions/effect.md docs/reference/conventions/README.md`
passes. An agent reading `CLAUDE.md` transitively loads `effect.md` and can cite
its rules. The doc reads consistently with `generic.md`/`zod.md` in tone and
structure, and every snippet uses the stable Effect 3.x API.

## What We're NOT Doing

- **Not** adopting `effect/Schema` for validation — zod stays the validator
  (CLAUDE.md hard rule honored). No edits to `zod.md` or existing zod schemas.
- **Not** writing Effect Services / Layers / dependency-injection rules — that is
  deferred to a future `effect-services.md` convention. This doc covers
  pipelines, errors, and the Promise boundary only.
- **Not** migrating any existing `src/` code to Effect. No runtime code changes.
- **Not** mandating `Effect.gen` — the house style is pipe-first (see Phase 1,
  Rule 2). `Effect.gen` appears only as a narrow documented exception.
- **Not** modifying `CLAUDE.md` — the `@`-import chain already pulls README's
  imports into context; adding the import to README is sufficient.

## Implementation Approach

Two phases mirroring the registry's own "create then register" two-step. Phase 1
authors the standalone doc; Phase 2 wires it in and verifies propagation. Keep
the doc tight and example-driven — the rules below are the agreed content.

**The five rules (binding unless an Exception applies):**

1. **Effect over Promise + `throw`** — model async / fallible work as
   `Effect.Effect<A, E, R>`, not `Promise` + `throw`.
2. **Pipe-first composition** — compose with `pipe()` / `.pipe()` and
   `Effect.map`/`flatMap`/`tap`/`andThen`. `Effect.gen` is the documented
   exception, allowed only when deeply dependent sequential logic nests badly.
3. **Wrap at the boundary, run at the edge** — lift Promise APIs with
   `Effect.tryPromise` (typed error); call `Effect.runPromise` only at the
   outermost edge (Astro endpoint handler, React island event handler). Never
   mix `await` with Effect mid-pipeline.
4. **Typed errors, never `throw`** — domain errors as `Data.TaggedError`
   subclasses; signal with `Effect.fail`; recover with `catchTag` / `catchAll`.
5. **Keep zod, bridge into Effect** — zod stays the validator; cross into Effect
   by wrapping `parse`/`safeParse` and mapping the zod failure to a
   `Data.TaggedError`. Do not introduce `effect/Schema`.

**Framework-edge exceptions** (apply across rules 1–3): React render bodies,
Astro/Cloudflare handler signatures, and other framework callbacks that the
runtime invokes directly are the sanctioned Promise/imperative boundary — wrap
inward and run at that edge rather than fighting the framework's contract.

## Phase 1: Author `effect.md`

### Overview

Create `docs/reference/conventions/effect.md` containing the five rules above,
each following the registry's rule structure, with stable-Effect-3.x
`✓ good` / `✗ bad` snippets and `> **Exceptions:**` blockquotes where relevant.

### Changes Required:

#### 1. New convention domain file

**File**: `docs/reference/conventions/effect.md`

**Intent**: Establish Effect-TS as the first-choice FP approach with five binding
rules. Open with a one-paragraph preamble (Effect is the default for async /
fallible / effectful logic; pipelines are the preferred style) then the five
`## Rule:` sections. Match the voice and formatting of `generic.md`/`zod.md`.

**Contract**: Five `## Rule:` headings, in order:

- `## Rule: Reach for Effect, not raw Promises or throw` — imperative sentence;
  `✓` an `Effect.Effect<User, UserNotFound>` returning function vs `✗` an
  `async` function that `throw`s. Exception: framework-edge callbacks.
- `## Rule: Compose with pipelines — prefer pipe over Effect.gen` — `✓` a
  `.pipe(Effect.flatMap(...), Effect.map(...), Effect.tap(...))` chain vs `✗` the
  same logic written imperatively / with nested generators. Exception blockquote:
  `Effect.gen` permitted for deeply dependent sequential steps where pipe nests
  unreadably.
- `## Rule: Wrap Promises at the boundary, run Effects at the edge` — `✓`
  `Effect.tryPromise({ try: () => supabase…, catch: (e) => new DbError({…}) })`
  with a single `Effect.runPromise` in the Astro `POST` handler vs `✗` `await`
  interleaved inside an Effect pipeline. Exception: the outermost handler is the
  one sanctioned `runPromise` site.
- `## Rule: Fail with typed errors — never throw` — `✓` a
  `class UserNotFound extends Data.TaggedError("UserNotFound")<{ id: string }>{}`
  - `Effect.fail` + `Effect.catchTag("UserNotFound", …)` vs `✗` `throw new Error()`
    inside Effect code.
- `## Rule: Keep zod for validation — bridge it into Effect` — `✓` wrapping
  `SignIn.safeParse(input)` and mapping `!success` to a `ValidationError`
  TaggedError inside an Effect vs `✗` introducing `Schema.decode` from
  `effect/Schema`. Note: honors the CLAUDE.md zod hard rule and the `zod.md`
  same-name convention (referenced, not restated).

A code snippet is warranted in this file by nature (it is a conventions doc); use
the stable 3.x API only. No snippet should import from `effect/unstable/*`.

### Success Criteria:

#### Automated Verification:

- File exists: `test -f docs/reference/conventions/effect.md`
- Prettier check passes: `npx prettier --check docs/reference/conventions/effect.md`
- Contains five rule headings: `grep -c '^## Rule:' docs/reference/conventions/effect.md` returns `5`
- No unstable-API imports: `! grep -q 'effect/unstable' docs/reference/conventions/effect.md`

#### Manual Verification:

- Each rule has a coherent `✓ good` / `✗ bad` TypeScript pair that compiles
  conceptually against stable Effect 3.x.
- Tone and structure match `generic.md` / `zod.md`.
- Pipe-first intent is unmistakable; `Effect.gen` appears only as the documented
  exception, not as a recommended default.
- zod rule does not contradict the CLAUDE.md hard rule or `zod.md`.

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation that the doc content is
correct and idiomatic before proceeding to Phase 2.

---

## Phase 2: Register & Verify Propagation

### Overview

Wire the new domain into the registry index and confirm the `@`-import
propagation chain, then format the touched files.

### Changes Required:

#### 1. Register the domain in the registry index

**File**: `docs/reference/conventions/README.md`

**Intent**: Make `effect.md` discoverable and auto-loaded by following the
registry's documented two-step add procedure.

**Contract**: Two edits:

- Add a row to the **Active Domains** table (after the `Zod naming` row):
  `| Effect-TS | ./effect.md | First-choice FP approach: pipe-first pipelines, typed errors, wrap Promises at the edge |`
- Append `@./effect.md` to the `@`-import block, after the `@./zod.md` line.

### Success Criteria:

#### Automated Verification:

- Table row present: `grep -q 'effect.md' docs/reference/conventions/README.md`
- Import present: `grep -q '@./effect.md' docs/reference/conventions/README.md`
- Prettier check passes: `npx prettier --check docs/reference/conventions/README.md`
- Lint unaffected: `npm run lint`

#### Manual Verification:

- The `CLAUDE.md → README → effect.md` chain loads: confirm `CLAUDE.md` imports
  `README.md` (it does, via `@docs/reference/conventions/README.md`) and that
  README now imports `effect.md`.
- Active Domains table renders correctly (4 rows, aligned).
- A fresh agent session can cite an `effect.md` rule when asked about FP style.

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation before considering the change
complete.

---

## Testing Strategy

### Manual Testing Steps:

1. Open `docs/reference/conventions/effect.md` and read all five rules — verify
   each snippet is valid stable Effect 3.x and the `✓`/`✗` contrast is clear.
2. Run `npx prettier --check docs/reference/conventions/*.md` — all pass.
3. Run `npm run lint` — no new errors.
4. In a fresh Claude Code session, ask "what's the convention for async logic in
   this project?" and confirm the agent cites the Effect pipe-first / typed-error
   rules — proves the propagation chain works.

## References

- Registry add procedure: `docs/reference/conventions/README.md:18-30`
- Template files: `docs/reference/conventions/generic.md`, `docs/reference/conventions/zod.md`
- Prior registry change: `context/changes/coding-convention-frame/plan.md`
- Effect docs (Context7): `/effect-ts/effect`, `/kitlangton/effect-solutions`
- Effect repo: https://github.com/Effect-TS/effect

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Author `effect.md`

#### Automated

- [x] 1.1 File exists: `test -f docs/reference/conventions/effect.md`
- [x] 1.2 Prettier check passes on `effect.md`
- [x] 1.3 Contains five `## Rule:` headings
- [x] 1.4 No `effect/unstable` imports in snippets

#### Manual

- [x] 1.5 Each rule has a coherent `✓ good` / `✗ bad` stable-3.x pair
- [x] 1.6 Tone and structure match `generic.md` / `zod.md`
- [x] 1.7 Pipe-first intent unmistakable; `Effect.gen` only as documented exception
- [x] 1.8 zod rule consistent with CLAUDE.md hard rule and `zod.md`

### Phase 2: Register & Verify Propagation

#### Automated

- [ ] 2.1 Active Domains table row for `effect.md` present
- [ ] 2.2 `@./effect.md` import present in README
- [ ] 2.3 Prettier check passes on `README.md`
- [ ] 2.4 `npm run lint` unaffected

#### Manual

- [ ] 2.5 `CLAUDE.md → README → effect.md` propagation chain confirmed
- [ ] 2.6 Active Domains table renders correctly
- [ ] 2.7 Fresh agent session cites an `effect.md` rule when asked about FP style
