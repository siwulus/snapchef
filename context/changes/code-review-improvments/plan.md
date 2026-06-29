# Concern-Structured Reviewer — Implementation Plan

## Overview

Restructure the `packages/code-review` reviewer so it stops skimming and silently skipping concern areas, and so its pass/fail verdict is explained. Two coupled changes: (1) rewrite the system prompt around **explicit per-concern sections**, each with a narrow mandate and an explicit "not responsible for" boundary; (2) add a **per-area coverage block** to the review object — one required entry per concern, each with a status + rationale — and **derive the verdict in code** from those statuses. Single structured pass, diff-only; both preserved.

## Current State Analysis

The reviewer is a single generic prompt that returns `summary + findings[] + a model-chosen verdict`. From the frame investigation (`frame.md`):

- **Root cause is the prompt mandate.** `packages/code-review/src/prompt.ts:9–11` tells the model to focus on "correctness bugs, security issues, data loss, broken error handling, and clear maintainability problems." **Tests, API/contract changes, and design-fit are absent** — the model is never asked to examine them, so coverage is shallow on exactly those areas. Prior docs confirm this concern list was never deliberated (incidental MVP).
- **The verdict is opaque, not wrong.** `review.ts:60` has the model emit the verdict; `code-review-ci/src/plan.ts:49` maps `request_changes → failure`, else `success`. Nothing records _which_ concerns were checked, so the verdict is unexplained.
- **Single-pass + diff-only are deliberate, cost-controlled** (`context/changes/package-code-review/plan.md:306`, `…/code-review-in-cicd/plan.md:304`; multi-file fan-out is explicitly out-of-scope). Keep both.
- **The `Review` wire contract is declared twice** — `packages/code-review/src/review.ts` (engine) and re-declared in `packages/code-review-ci/src/plan.ts` (CI), deliberately decoupled (`code-review-reusable-action/plan.md:22`). zod strips unknown keys by default, so a field added engine-side but not mirrored CI-side is _silently dropped_, not an error.
- **The verdict is a surfaced action output** (`packages/code-review-action/action.yml:38–40`) and the CI consumes `verdict` via `parseReview`. Keeping the 3-value enum means `apply.ts`, the gate, the action I/O, and the workflow are untouched.
- **`dependency-cruiser` is not installed**; the design-fit concern cannot cross-check against it.

### Key Discoveries:

- Prompt mandate omits tests/contracts/design-fit — `packages/code-review/src/prompt.ts:6–28`.
- Review schema has no per-area/category/coverage fields; verdict is model-emitted — `packages/code-review/src/review.ts:21–63`.
- Structured-output schema is derived from `Review` and fed to the SDK with `$schema` stripped via `target: "draft-07"` — `packages/code-review/src/engine.ts:27,60`. (A JSON-Schema `required` property _is_ enforced during constrained generation; a zod `.refine()` is **not** — it only runs post-parse.)
- Verdict→gate mapping and the 30-inline cap live in CI — `packages/code-review-ci/src/plan.ts:49,84,131–166`.
- Both packages: `pnpm --filter <name> test` (vitest), `… typecheck` (`tsc --noEmit --ignoreDeprecations 6.0`).

## Desired End State

The reviewer emits, for **every** concern area, a status (`ok | concerns | blocking | not_applicable`) with a one-line rationale — so a PR's sticky comment shows what was examined, not just what was flagged. The verdict is computed from those statuses and provably tracks them. Coverage of all seven concerns is enforced by the output schema (the model cannot omit an area). Verified by: the package's `--json` output contains a complete `areas` object; `deriveVerdict` unit tests pass; a real diff piped through the CLI shows the per-area table; the CI sticky comment renders area coverage; the gate still fails closed on `request_changes`.

## What We're NOT Doing

- **No multi-pass** — one structured prompt with per-concern sections (reverses no cost decision).
- **No per-finding confidence scores** and **no change to the ~30 inline cap** (deferred; targets unobserved noise).
- **Not collapsing the duplicated wire contract** into a shared package — mirror by hand, guard with the boundary parse + fixture (respects the deliberate engine ⊥ orchestration boundary).
- **No new reviewer input** — still diff-only (no PR description, surrounding files, or repo conventions).
- **No snapchef-specific convention checks** baked into the prompt — the package stays platform-agnostic.
- **No changes** to the verdict enum, gate semantics, `apply.ts`, `action.yml` I/O, the CI workflow, or `dependency-cruiser` (absent).

## Implementation Approach

Build bottom-up so each phase is independently verifiable: the domain schema + verdict-derivation first (pure, unit-tested), then the prompt + engine wiring that produces it, then terminal rendering, then the CI-side mirror + PR surfacing. The `areas` field is modeled as an **object with one required key per concern** (not an array) so coverage is enforced structurally in the JSON Schema the SDK constrains generation against. The model fills a `ReviewDraft` (no verdict); the engine derives the verdict and assembles the final `Review`, keeping the serialized wire shape backward-compatible (adds `areas` + `findings[].category`, retains `summary`/`findings`/`verdict`).

## Critical Implementation Details

- **Coverage must be a JSON-Schema `required` property, not a zod `.refine()`.** Modeling `areas` as an object with every concern key required makes the SDK enforce presence _during_ generation. A `.refine()` completeness check would only fire in the post-parse `Review.parse`, turning a skipped area into a hard infra failure (fail-closed gate) instead of a re-prompt — worse UX. Use the keyed-object shape.
- **Mirror or silently lose data.** zod strips unknown keys, so the new `areas`/`category` fields added in Phase 1 are dropped by the CI `parseReview` until Phase 4 mirrors them — the Phase 4 sticky-render test is what guards this.

## Phase 1: Domain schema + verdict derivation

### Overview

Add the concern/area vocabulary, the per-area coverage block, the finding `category`, the `ReviewDraft` (model-emitted) vs `Review` (draft + derived verdict) split, and a pure `deriveVerdict`. No model call — fully unit-testable.

### Changes Required:

#### 1. Review domain schema

**File**: `packages/code-review/src/review.ts`

**Intent**: Introduce the concern taxonomy and per-area coverage, attach a concern category to each finding, and separate what the model produces from the final verdict-bearing review. Keep `Severity`/`Verdict` enums and `Finding`'s existing fields unchanged.

**Contract**: New exports `ConcernArea` (enum of the 7 concerns), `CONCERN_ORDER` (display order), `AreaStatus` (`ok|concerns|blocking|not_applicable`), `AreaReview` (`{ status, rationale }`), and `Areas` (object with one **required** key per concern). `Finding` gains `category: ConcernArea`. `ReviewDraft` = `{ summary?, areas: Areas, findings: Finding[] }` (model output). `Review` = `ReviewDraft` + `{ verdict: Verdict }` (serialized wire shape). `deriveVerdict(areas: Areas): Verdict`.

```ts
export const ConcernArea = z.enum([
  "correctness",
  "error_handling",
  "security",
  "tests",
  "api_contract",
  "maintainability",
  "frontend",
]);
export type ConcernArea = z.infer<typeof ConcernArea>;
export const CONCERN_ORDER: readonly ConcernArea[] = [
  "correctness",
  "error_handling",
  "security",
  "tests",
  "api_contract",
  "maintainability",
  "frontend",
];

export const AreaStatus = z.enum(["ok", "concerns", "blocking", "not_applicable"]);
export const AreaReview = z.object({ status: AreaStatus, rationale: z.string() });
// One required key per concern → coverage enforced in the derived JSON Schema.
export const Areas = z.object({
  correctness: AreaReview,
  error_handling: AreaReview,
  security: AreaReview,
  tests: AreaReview,
  api_contract: AreaReview,
  maintainability: AreaReview,
  frontend: AreaReview,
});

export const deriveVerdict = (areas: Areas): Verdict => {
  const statuses = CONCERN_ORDER.map((c) => areas[c].status);
  if (statuses.includes("blocking")) return "request_changes";
  if (statuses.includes("concerns")) return "comment";
  return "approve";
};
```

Each new schema field carries a `.describe(...)` mirroring the existing required/optional phrasing convention in this file.

#### 2. Schema unit tests

**File**: `packages/code-review/src/review.test.ts`

**Intent**: Cover the new contract — a valid `ReviewDraft` fixture (all 7 areas), rejection when an area key is missing, finding `category` validation, and `deriveVerdict`'s three branches plus the all-`not_applicable` → `approve` edge.

**Contract**: New `describe` blocks for `Areas`/`ReviewDraft` parsing and `deriveVerdict`. Update the existing `validReview` fixture to include `areas` + per-finding `category`.

### Success Criteria:

#### Automated Verification:

- [ ] Unit tests pass: `pnpm --filter code-review test`
- [ ] Type checking passes: `pnpm --filter code-review typecheck`
- [ ] Linting passes: `pnpm lint`

#### Manual Verification:

- [ ] `deriveVerdict` precedence reads correctly (blocking > concerns > approve) and `not_applicable` never blocks.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Concern-structured prompt + engine wiring

### Overview

Rewrite the system prompt into explicit per-concern sections and wire the engine to emit a `ReviewDraft`, derive the verdict, and return a `Review`.

### Changes Required:

#### 1. System prompt

**File**: `packages/code-review/src/prompt.ts`

**Intent**: Replace the single narrow mandate with one section per concern area, each stating _what to look for_ (as diff-answerable questions) and _what it is NOT responsible for_ (so sections don't pile onto the same issue). Instruct the model to return a status + one-line rationale for **every** concern (using `not_applicable` when the diff doesn't touch it — e.g. `frontend` on a backend-only diff), to tag every finding with its `category`, and to keep reviewing only what the diff shows. Remove all verdict-selection instructions (the engine derives it).

**Contract**: `SYSTEM_PROMPT` rewritten. Section set, in `CONCERN_ORDER`:

- `correctness` — does it do what it claims; edge/null/empty, error paths, off-by-one, concurrency. _Not_ responsible for style or test quality.
- `error_handling` — failure modes, swallowed errors, half-written state. _Not_ responsible for business-logic correctness (that's `correctness`).
- `security` — input trust boundaries, authz checks, secrets/sensitive data in logs or responses. _Not_ responsible for performance.
- `tests` — do tests assert real behavior, cover new edge cases, fail if the logic broke. _Not_ responsible for the code's own correctness.
- `api_contract` — breaking changes, backwards-compat, migration safety. _Not_ responsible for internal naming.
- `maintainability` — abstraction level, responsibility placement, module-boundary smell **visible in the diff**. _Not_ responsible for whole-architecture judgments (diff-only limit).
- `frontend` — avoidable re-renders, work in render, a11y, bundle-size of new deps, design-system drift; `not_applicable` unless the diff touches UI. _Not_ responsible for backend concerns.

Keep `buildUserPrompt` unchanged. Keep the diff-only and "empty findings ⇒ all-`ok`/`not_applicable`" guidance.

#### 2. Engine: schema source + verdict derivation

**File**: `packages/code-review/src/engine.ts`

**Intent**: Constrain generation to the model-emitted shape and assemble the verdict-bearing review.

**Contract**: `REVIEW_SCHEMA` derives from `ReviewDraft` (was `Review`), keeping `z.toJSONSchema(…, { target: "draft-07" })` and the `$schema`-stripping rationale comment. On a successful result, parse `structured_output` with `ReviewDraft`, then `return Review.parse({ ...draft, verdict: deriveVerdict(draft.areas) })`. Imports updated (`ReviewDraft`, `deriveVerdict`).

#### 3. Engine test

**File**: `packages/code-review/src/engine.test.ts`

**Intent**: Assert `REVIEW_SCHEMA` reflects the draft shape (every concern key required, no `verdict` property) so a regression in the schema source is caught.

**Contract**: Update/extend assertions against `REVIEW_SCHEMA`'s `required`/`properties`.

### Success Criteria:

#### Automated Verification:

- [ ] Unit tests pass: `pnpm --filter code-review test`
- [ ] Type checking passes: `pnpm --filter code-review typecheck`
- [ ] Linting passes: `pnpm lint`

#### Manual Verification:

- [ ] Pipe a real diff (touching backend only) through `pnpm --filter code-review review --json` (or `--verbose`): output contains all 7 `areas`, `frontend` is `not_applicable`, every finding has a `category`, and the derived `verdict` matches the statuses.
- [ ] Repeat on a UI-touching diff: `frontend` is no longer `not_applicable`.

**Implementation Note**: Pause for manual confirmation before proceeding — this is the phase a model credential is exercised.

---

## Phase 3: Terminal rendering of coverage

### Overview

Surface the per-area coverage in the CLI's pretty output and tie findings to their concern.

### Changes Required:

#### 1. Renderer

**File**: `packages/code-review/src/render.ts`

**Intent**: Add an "Area coverage" block (each concern in `CONCERN_ORDER` with its status + rationale) to the pretty output, ahead of the severity-grouped findings, and include each finding's `category` in its line. JSON output stays the raw validated `Review` (now richer) — no change to the `--json` branch.

**Contract**: `renderPretty` gains an area-coverage section iterating `CONCERN_ORDER`; finding lines include `category`. Pure function signature unchanged.

#### 2. Renderer test

**File**: `packages/code-review/src/render.test.ts`

**Intent**: Assert the area block renders all concerns in order (including `not_applicable`) and that a finding's category appears.

**Contract**: Update the fixture to the new `Review` shape; add assertions for the area block.

### Success Criteria:

#### Automated Verification:

- [ ] Unit tests pass: `pnpm --filter code-review test`
- [ ] Type checking passes: `pnpm --filter code-review typecheck`
- [ ] Linting passes: `pnpm lint`

#### Manual Verification:

- [ ] CLI pretty output (no `--json`) shows the area-coverage table legibly and findings show their concern.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: CI contract mirror + PR coverage surfacing

### Overview

Mirror the new fields in the CI-side re-declared contract and render area coverage in the PR sticky comment, keeping the gate and inline cap intact.

### Changes Required:

#### 1. CI wire contract + sticky rendering

**File**: `packages/code-review-ci/src/plan.ts`

**Intent**: Mirror `ConcernArea`/`AreaStatus`/`AreaReview`/`Areas` and add `areas` to `Review` + `category` to `Finding` so `parseReview` no longer drops them. Add an "Area coverage" section to the sticky body (status per concern, in `CONCERN_ORDER`); optionally prefix inline/summary finding bodies with the concern. Leave `verdictToGate`, the 30-inline cap, and `buildPostPlan`'s inline/summary partitioning unchanged.

**Contract**: Re-declared schemas extended to match the engine wire shape; new `CONCERN_ORDER` + a `renderAreaCoverage` helper folded into `renderStickyBody`. `verdictToGate(review.verdict)` consumes the (now derived) verdict exactly as before.

#### 2. CI tests + fixture

**Files**: `packages/code-review-ci/src/plan.test.ts`, `packages/code-review-ci/src/__fixtures__/sample-review.json`

**Intent**: Update the fixture to the new wire shape (with `areas` + `category`); assert the sticky body contains the area-coverage section and that `verdictToGate` still maps a derived `request_changes` → `failure` and `approve`/`comment` → `success`.

**Contract**: Fixture gains `areas` + per-finding `category`; new sticky-render assertions; gate-mapping assertions retained.

#### 3. Documentation touch-ups

**Files**: `packages/code-review/README.md`, `packages/code-review-action/README.md`

**Intent**: Document the new review-object shape (concern areas + derived verdict) and that the verdict is computed from area statuses. Brief — reflect the contract, don't restate the plan.

**Contract**: Prose edits to the schema/output sections.

### Success Criteria:

#### Automated Verification:

- [ ] CI package tests pass: `pnpm --filter @snapchef/code-review-ci test`
- [ ] Reviewer tests still pass: `pnpm --filter code-review test`
- [ ] Type checking passes: `pnpm --filter @snapchef/code-review-ci typecheck`
- [ ] Linting passes: `pnpm lint`

#### Manual Verification:

- [ ] End-to-end dry run: pipe a diff → `review.json` (Phase 2 CLI) → `code-review-ci` `index.ts` → inspect `cr-output.json`: `stickyBody` shows the area-coverage section, `state`/`label` match the derived verdict, inline comments ≤ cap.
- [ ] (Optional, on a throwaway PR) the sticky comment renders the area table and the `code-review/gate` status posts as before.

**Implementation Note**: Final phase — confirm the gate still fails closed on `request_changes` before closing the change.

---

## Testing Strategy

### Unit Tests:

- `deriveVerdict`: blocking→`request_changes`, concerns→`comment`, all ok/na→`approve`, all `not_applicable`→`approve`.
- `Areas` parsing: rejects a missing concern key; accepts a full set; `Finding.category` validated.
- `REVIEW_SCHEMA`: every concern key required; no `verdict` property (it's derived).
- Renderers (CLI + sticky): area block present, ordered, includes `not_applicable`; findings show category.
- `verdictToGate`: unchanged mapping holds on the derived verdict.

### Integration Tests:

- CLI → CI `index.ts` over a fixture diff + review.json: `cr-output.json` carries the area coverage and the correct gate state.

### Manual Testing Steps:

1. Pipe a backend-only diff through the CLI (`--json`); confirm 7 areas, `frontend: not_applicable`, categories present, derived verdict consistent.
2. Pipe a UI-touching diff; confirm `frontend` activates.
3. Run the CI step over the produced `review.json`; confirm the sticky shows area coverage and the gate state matches.

## Migration Notes

The serialized review is **additive** (`summary`/`findings`/`verdict` retained; `areas` + `findings[].category` added). The engine and CI deploy together via the same action/workspace, so there is no mixed-version wire window. No persisted data.

## References

- Frame brief: `context/changes/code-review-improvments/frame.md`
- Prompt / schema / engine: `packages/code-review/src/{prompt.ts,review.ts,engine.ts,render.ts}`
- CI contract + gate: `packages/code-review-ci/src/plan.ts:49,84,131–166`
- Action I/O: `packages/code-review-action/action.yml:37–43`
- Prior decisions (single-pass, diff-only, duplication): `context/changes/package-code-review/plan.md:306`, `context/changes/code-review-in-cicd/plan.md:304`, `context/changes/code-review-reusable-action/plan.md:22`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Domain schema + verdict derivation

#### Automated

- [x] 1.1 Unit tests pass: `pnpm --filter code-review test` — 25ee44955
- [x] 1.2 Type checking passes: `pnpm --filter code-review typecheck` — 25ee44955
- [x] 1.3 Linting passes: `pnpm lint` — 25ee44955

#### Manual

- [x] 1.4 `deriveVerdict` precedence reads correctly and `not_applicable` never blocks — 25ee44955

### Phase 2: Concern-structured prompt + engine wiring

#### Automated

- [x] 2.1 Unit tests pass: `pnpm --filter code-review test` — 2ff95980b
- [x] 2.2 Type checking passes: `pnpm --filter code-review typecheck` — 2ff95980b
- [x] 2.3 Linting passes: `pnpm lint` — 2ff95980b

#### Manual

- [x] 2.4 Real backend-only diff via CLI: all 7 areas, `frontend` not_applicable, findings categorized, derived verdict consistent — 2ff95980b
- [x] 2.5 UI-touching diff: `frontend` activates — 2ff95980b

### Phase 3: Terminal rendering of coverage

#### Automated

- [x] 3.1 Unit tests pass: `pnpm --filter code-review test` — 713162bd3
- [x] 3.2 Type checking passes: `pnpm --filter code-review typecheck` — 713162bd3
- [x] 3.3 Linting passes: `pnpm lint` — 713162bd3

#### Manual

- [x] 3.4 CLI pretty output shows the area-coverage table and per-finding concern — 713162bd3

### Phase 4: CI contract mirror + PR coverage surfacing

#### Automated

- [x] 4.1 CI package tests pass: `pnpm --filter @snapchef/code-review-ci test`
- [x] 4.2 Reviewer tests still pass: `pnpm --filter code-review test`
- [x] 4.3 Type checking passes: `pnpm --filter @snapchef/code-review-ci typecheck`
- [x] 4.4 Linting passes: `pnpm lint`

#### Manual

- [x] 4.5 End-to-end dry run: `cr-output.json` shows area coverage, gate state matches derived verdict, inline ≤ cap
- [x] 4.6 Gate still fails closed on `request_changes`
