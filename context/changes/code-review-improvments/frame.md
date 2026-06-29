# Frame Brief: Rethinking the code-review reviewer (`packages/code-review`)

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed.

## Reported Observation

The reviewer in `packages/code-review` is a single generic _"review this diff"_
prompt that returns `summary` + a flat `findings[]` + a **model-chosen** `verdict`.
On real PRs it reads shallow — it skims and **skips whole concern areas** (tests,
API/contract changes, design-fit) — and its pass/fail verdict is a single opaque
token with no per-area breakdown explaining it. (The shallow-coverage symptom is
observed, not theoretical — confirmed in Step 1.5.)

## Initial Framing (preserved)

- **User's stated cause or approach**: A single mega-prompt produces shallow,
  scattershot, noisy reviews; quality and adoption come from decomposing into
  per-concern passes, adding per-finding confidence + a top-N cap, and grounding the verdict.
- **User's proposed direction**: Restructure the prompt into focused per-concern
  passes (each told what it is _not_ responsible for); reshape the review object to
  add per-area validation scored 1–10 + per-finding confidence + a comment cap;
  **derive** the pass/fail verdict from the per-area scores.
- **Pre-dispatch narrowing**: Lead concern = **shallow coverage** (seen on real PRs).
  Reviewer's view = **keep diff-only** (don't feed it more context). Verdict problem =
  **opaque** (no per-area breakdown), _not_ wrong/contradictory.

## Dimension Map

The observation could originate at any of these dimensions:

1. **Prompt mandate** — `prompt.ts:9–11` enumerates only correctness / security /
   data-loss / error-handling / maintainability. Tests, API/contract, and design-fit
   are absent, so the model is never asked to examine them. ← **root**
2. **Output schema** — `review.ts:21–63`: findings carry no `category`, no `confidence`,
   no per-area score; verdict is a bare enum; nothing records _which_ concerns were
   checked. ← initial framing (per-area 1–10) + the "opaque verdict" lands here
3. **Noise / volume control** — no confidence field, no finding cap in the schema.
4. **Verdict derivation** — model emits the verdict (`review.ts:60`); `plan.ts:49`
   maps `request_changes`→fail. No deterministic link between findings and verdict.
5. **Execution shape** — `engine.ts:46` is one `query()`. Multi-pass buys depth at N× cost.
6. **Reviewer input scope** — `action.yml` pipes only the diff; the prompt says
   _"do not assume code outside the diff."_
7. **Wire-contract duplication** — `Review`/`Finding`/`Verdict` declared in `review.ts`
   **and** re-declared in `code-review-ci/plan.ts`; a schema change touches both.

## Hypothesis Investigation

| Hypothesis                                                             | Evidence                                                                                                                                                                                           | Verdict                                                                                 |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Dim 1 — narrow, incidental prompt mandate causes shallow coverage**  | `prompt.ts:9–11` names only 5 concerns; tests/API/design-fit absent. Prior docs show the concern list was **never deliberated** (incidental MVP, not intentional omission).                        | **STRONG**                                                                              |
| **Dim 2 — schema can't express per-concern coverage → opaque verdict** | `review.ts:21–63` has no category/area/confidence; verdict is a bare enum; nothing records coverage.                                                                                               | **STRONG**                                                                              |
| Dim 3 — missing confidence/cap causes noise (initial framing)          | No confidence field; but `plan.ts:84` **already caps inline at 30** (deliberate — `code-review-in-cicd/plan.md:285`). User did **not** report noise.                                               | **WEAK** — real gap, but not the observed problem; suppression pulls _against_ coverage |
| Dim 4 — model-emitted verdict not grounded in findings                 | `review.ts:60` / `plan.ts:49`. User reports "opaque," not "contradictory."                                                                                                                         | **MEDIUM** — transparency gap, not a correctness bug                                    |
| Dim 5 — single-pass execution limits depth                             | `engine.ts:46` one call; single-pass is a **deliberate cost decision** (`plan.md:306`, `:304`); multi-file fan-out **explicitly out-of-scope**. Observed problem is coverage (mandate), not depth. | **WEAK as cause** — reversing it is costly _and_ unneeded                               |
| Dim 6 — diff-only input limits answerable concerns                     | `action.yml` diff-only; **deliberate** (`research.md:13`, `plan.md:49`). User chose to keep it.                                                                                                    | **CONFIRMED CONSTRAINT** (caveat, not cause)                                            |
| Dim 7 — duplicated wire contract taxes schema changes                  | `review.ts` + `plan.ts` re-declare the contract; architectural necessity (engine ⊥ orchestration).                                                                                                 | **STRONG** (implementation cost, not cause)                                             |

## Narrowing Signals

Decisive observations that narrowed the hypothesis space:

- User has seen shallow coverage on **real** PRs (not theoretical) → rules Dim 1 in as the live problem.
- User wants **diff-only kept** → rules out a "feed it more context" reframe; every fix must be diff-internal.
- User calls the verdict **"opaque," not "wrong"** → Dim 4 is about _explainability_, not correctness.
- User did **not** select "noise" → Dim 3 (confidence/caps) is speculative here and de-prioritized.
- Prior docs: the concern-list omission was **undeliberated** (cheap to fix); single-pass + diff-only are **deliberate, cost-controlled** (don't reverse).

## Cross-System Convention

The codebase deliberately separates a **simple, platform-agnostic engine**
(diff→JSON, single-pass) from a **thin CI orchestration layer**; per-run cost is
controlled by run-once-on-open + `cr:revalidate` label-gating + per-SHA staleness,
**not** by architectural decomposition. The high-value fix (an explicit concern
mandate + a per-area coverage contract) lives **entirely inside the engine's prompt +
schema** and respects that boundary. Multi-pass / fan-out is explicitly listed as
out-of-scope in the prior plans, so the leading hypothesis matches the convention and
the cheaper fix is also the more convention-aligned one.

## Reframed Problem Statement

> **The actual problem to plan around is**: the reviewer reads shallow **not because
> it is "one prompt"** but because its prompt's concern mandate is _incidental and
> silent_ — it names only five concern areas and records no per-area coverage, so the
> model examines an arbitrary subset and emits a verdict that never reveals what it checked.

The lever is therefore to make the concern mandate **explicit and exhaustive** and to
make **per-area coverage a first-class field** of the review object, then derive/explain
the verdict from it. Done this way the change targets the observed symptom directly
(coverage + opacity) and reverses no deliberate decision. The user's _mechanisms_ are
mostly right but **mis-weighted**: per-concern structure + per-area scoring + a grounded
verdict are the on-target core; multi-pass and confidence/extra-caps address a different
problem (depth and noise) that was not observed — and a deliberate cost decision and an
existing 30-comment cap already bear on them.

## Confidence

**HIGH** — strong, citable evidence that the root is an incidental prompt mandate;
the inverse holds (a 5-concern prompt predicts shallow coverage on exactly the areas
observed); the user's answers fixed the two key forks (diff-only, opaque-not-wrong);
and the cheaper fix matches the codebase's deliberate engine/orchestration boundary.

## What Changes for /10x-plan

Plan a change to the **engine's prompt + review schema** (single structured pass,
diff-only — both preserved), not the execution shape:

1. Rewrite `prompt.ts` so the concern areas are an **explicit checklist** (correctness,
   design-fit, security, tests, API/contract — plus any others), each phrased as a
   **diff-answerable** question and each told what it is _not_ responsible for.
2. Extend the `Review` schema with a **per-area coverage block** (the 1–10 score /
   status per concern) and a `category` on each finding.
3. **Derive/surface the verdict from the area block** so pass/fail is explained.
4. Thread the schema change through the **duplicated wire contract** (`review.ts` →
   `code-review-ci/plan.ts`), `render.ts`, and `action.yml`'s `verdict` output.

Explicitly **out of the core** (separate, lower-priority, optional): multi-pass calls
(reverses a deliberate cost decision; forced sections likely suffice), and per-finding
confidence + extra caps (target unobserved noise; a 30-comment cap already exists, and
suppression must never hide a concern area's coverage). **Caveat:** diff-only means
"design-fit vs. existing architecture" and "matches the description / backwards-compat"
are only _partially_ answerable — scope each concern to what the diff reveals.

## References

- Source files: `packages/code-review/src/prompt.ts:6–36`, `…/review.ts:21–65`,
  `…/engine.ts:42–82`, `packages/code-review-ci/src/plan.ts:10–50,84,131–166`,
  `packages/code-review-action/action.yml` (diff computation + `verdict` output)
- Prior decisions: `context/changes/package-code-review/plan.md:44–51,306`;
  `context/changes/code-review-in-cicd/{research.md:13,254–260; plan.md:285,304}`
- Investigation: 1 Explore sub-agent — prior-art on reviewer design choices
