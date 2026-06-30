# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-30 (Phase 4 reconciled to `complete` — E2E smoke + CI
> gate landed; local-hook e2e gate dropped by cost × signal. See §8 ledger.)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "<the
   team is worried about X, and the failure would surface somewhere in
   <area>>" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/migrations/`
(30 days, 79 commits; generated DB types, snapshots, and lockfiles excluded).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                                                                                                            | Impact   | Likelihood | Source (evidence — not anchor)                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Recipe session state machine: a transition fires from an illegal prior state, an edit (corrected items / meal context / off-list toggle) is lost across a transition, or save/delete acts on a missing or foreign session (ownership not enforced) | High     | High       | Interview Q1 (top fear) + Q3; hot-spot dir `src/lib/core/uc/recipe/` (25 commits/30d), `RecipeSessionUC` 16 commits/30d; concrete drift found 2026-06-21 (owner-scoped `update` returning None no longer surfaced NotFound in `saveSession`) |
| 2   | The critical end-to-end flow (upload → recognize → edit → generate → save) has no browser-level proof; a wiring/prop break — e.g. after the 2026-06-21 refactor that moved every recipe component — ships unseen                                   | High     | Medium     | Interview Q3 (e2e gap); hot-spot dir `src/components/recipes/` (`wizard` 71 + `recipe` 10 commits/30d); no e2e / Playwright exists today                                                                                                     |
| 3   | Cross-user data leak: user B reads/writes/deletes user A's sessions, recipes, or photos (IDOR / RLS or storage-policy hole) — abuse scenario, still zero integration coverage                                                                      | High     | Medium     | PRD privacy guardrail (launch-gating); roadmap F-01/S-03/S-04 risk notes ("first real test of RLS"); mandatory abuse lens                                                                                                                    |
| 4   | Auth token abuse: a recovery or email-verification token is reused, expired, or type-confused (`type=recovery` ↔ `type=email`), or the callback route does not fail closed — letting the wrong account action through — abuse scenario             | High     | Medium     | `password-reset` impl_reviewed 2026-06-15 (FR-013) + `email-verification-gating` implemented 2026-06-14; shared `token_hash` callback mechanism; hot-spot dir `src/pages/api/auth/` (28 commits/30d); mandatory abuse lens                   |
| 5   | Malformed LLM output (recognition or generation) renders garbage instead of an editable list / usable recipe, or upload limits enforced only client-side let >5 files / >5 MB / non-image reach the server and burn paid LLM calls + storage       | Med-High | Medium     | PRD FR-003/FR-004/FR-005/FR-008 + NFR response time; roadmap S-01/S-02 risk notes; features now built so likelihood is real, but interview Q2 reports no incidents → not top                                                                 |

Considered and deliberately not mapped:

- **API error-envelope contract drift** (old Risk #4) — demoted to
  "verify, don't re-cover": the `SnapchefServerError` family, the
  `runApiRoute` boundary mapper, and the client envelope now carry unit
  tests (`src/lib/core/model/error/`, `src/lib/infrastructure/api/` — both
  churned _with_ tests). §3 Phase 3 research should confirm a round-trip
  contract test exists and add one only if it is missing.
- **"works in `astro dev`, breaks on Cloudflare Workers"** — no incident
  evidence (interview Q2: no real incidents) and no cheap deterministic
  signal; belongs to observability (`wrangler tail`) and the pre-prod
  smoke gate, not a test row.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                                                                                                                        | Must challenge                                                                                               | Context `/10x-research` must ground                                                                                                            | Likely cheapest layer                                        | Anti-pattern to avoid                                                                                                                |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| #1   | Each documented transition only fires from a legal prior state; the persisted edits (corrected items, meal context, off-list toggle) survive each transition; save/delete on a missing or foreign session returns a typed NotFound and performs no write                                           | "`update` succeeded ⇒ the row existed and was owned" — the exact drift just found; absence ≠ success         | The session state enum + legal transition graph; where ownership is enforced (owner-scoped query vs explicit guard); what state persists where | unit/integration on `RecipeSessionUC` with fake ports        | Mocking `update` to always return `Some` (the stale-test trap that hid the NotFound regression); happy-path-only transitions         |
| #2   | The full critical path (upload → recognize → edit → generate → save) completes against a running app driven by role-based locators; a broken prop/route after the refactor fails the smoke deterministically                                                                                       | "Component unit tests passing ⇒ the flow is wired end to end"                                                | Real route URLs + auth precondition; deterministic session/photo seeding; which waits are state-based (no `waitForTimeout`)                    | one Playwright smoke (governed by `/10x-e2e`)                | e2e-ing every branch (use integration); `page.waitForTimeout`; asserting exact LLM output as the oracle                              |
| #3   | With two real users, every read/write/delete on domain tables AND the storage bucket returns only owner-scoped data; cross-user access fails closed at the database layer, not just the API layer                                                                                                  | "RLS enabled = policies correct"; "API-level checks suffice" — PostgREST and the storage API are also doors  | Actual policy definitions; table vs storage-policy parity; two-user fixture strategy against local Supabase (db reset + seeded users)          | integration vs local Supabase (db reset + seeded users)      | Testing isolation only through the app's own API; owner-only happy-path assertions                                                   |
| #4   | A used, expired, or wrong-`type` token is rejected and the callback fails closed; a valid recovery token cannot be replayed; verification and recovery flows are not interchangeable                                                                                                               | "`type=email` and `type=recovery` are interchangeable"; "a 200 from the callback means the right action ran" | The callback route(s); the `token_hash` verification call; what distinguishes the two flows; how the session is (or isn't) established         | integration on the callback route(s)                         | Testing only the happy callback; mocking Supabase auth so deeply the test mirrors the implementation                                 |
| #5   | Unparseable/malformed recognition or generation output fails typed and surfaces a clear error — never a garbage list / partial recipe; the recognized list stays editable (FR-005 valve); the server rejects the 6th file, an oversized file, and a non-image with a typed 400 before any LLM call | "Schema-valid output ⇒ correct output"; "the client already validates"; "final status 200 ⇒ usable recipe"   | Vision + generation call sites, response schemas, error-translation path, fixture strategy; upload endpoint shape + where limits are enforced  | contract/unit with recorded fixtures + integration on upload | Asserting exact model output (flaky oracle); e2e against the live LLM as the primary gate; exercising limits only via the React form |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

(The 2026-06-06 "Bootstrap runner" phase is **done** — Vitest + Testing
Library + jsdom + `src/test/setup.ts` are installed and a ~13-file suite
exists. Its residue is folded into Phase 1.)

(2026-06-30 reconciliation — see §8 ledger. **Phase 1 is `complete`**, but it
shipped under the feature change `recepie-session-state-machine` (status
`impl_reviewed`), not the `testing-…` folder the table originally projected:
that change delivered the FSM reducer + transition aspect + enforcement seal
**and** the proving tests — `recipe-session-state-machine.test.ts`,
`recipe-session-transition.test.ts`, and a hardened `RecipeSessionUC.test.ts`
(18 cases, incl. "surfaces `SnapchefNotFoundError` when the owner-scoped find
matches no row", closing the 2026-06-21 drift). Phase 1's intent is satisfied;
the folder cell points at the real change. **Phase 4 is now `complete`** — its
E2E smoke landed out of band: `e2e/*.spec.ts` (×4: public-access,
recipes-authenticated, recipes-wizard, recipes-wizard-cancel), including the
Risk #2 critical-path test (upload → recognize → edit → generate → save),
`playwright.config.ts`, and a fake-LLM adapter (`mock-openrouter-for-tests-e2e`
→ `FakeLlm`); all pass locally. The **CI gate is wired**: `.github/workflows/ci.yml`
runs the `e2e` job — Playwright with `E2E_FAKE_LLM`, against staging Supabase —
on PRs to `main`. The original goal's **local lefthook hook gate is deliberately
dropped**: running Playwright (spawns a dev server, minutes per run) in
pre-commit violates §1 principle #1 (cost × signal); e2e-on-PR is the correct
gate. The app-layer ownership guard from Phase 1 is proven; the
**database-layer** ownership / cross-user isolation (Risk #1 foreign-session
tail + Risk #3) remains unproven — that is Phase 2's job, the highest-value
remaining gap.)

| #   | Phase name                              | Goal (one line)                                                                                                                         | Risks covered                   | Test types                                | Status      | Change folder                                                                      |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------- | ----------- | ---------------------------------------------------------------------------------- |
| 1   | Recipe session UC + state machine       | Prove `RecipeSessionUC` transitions, ownership, and save/delete idempotency cannot silently regress (close the drift class just found)  | #1                              | unit / integration (fake ports)           | complete    | context/changes/recepie-session-state-machine/                                     |
| 2   | Auth + RLS integration (local Supabase) | Prove two-user isolation on domain tables and the storage bucket, and that reset/verification callbacks fail closed                     | #3, #4                          | integration (local Supabase)              | not started | —                                                                                  |
| 3   | LLM boundary + upload limits            | Confirm malformed model output fails typed at both LLM boundaries and server-side upload limits hold; add only gaps existing tests miss | #5                              | contract/unit with fixtures + integration | not started | —                                                                                  |
| 4   | E2E smoke + quality-gates wiring        | One real-browser pass over the critical flow, gated on CI (PR → `main`); local-hook e2e gate dropped (cost × signal)                    | #2 (+ floor for #1, #3, #4, #5) | e2e (Playwright) + gates                  | complete    | context/changes/mock-openrouter-for-tests-e2e/ (+ e2e specs & CI gate out of band) |

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer                | Tool                                              | Version            | Notes                                                                                                 |
| -------------------- | ------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| unit + component     | Vitest + @testing-library/react + jsdom           | 4.1.8 / 16.3 / 29  | **Installed.** `vitest.config.ts` + `src/test/setup.ts`; ~13 test files across `components/` + `lib/` |
| API/route + UC logic | Vitest with fake ports (hexagonal)                | 4.1.8              | Established pattern: `RecipeSessionUC.test.ts`, `SupabaseAuthenticator.test.ts` inject fakes          |
| integration (DB/RLS) | Vitest + local Supabase stack                     | none yet — Phase 2 | Local Supabase (Docker) already used for migrations; reuse for two-user fixtures                      |
| LLM boundary         | recorded-fixture contract tests                   | partial — Phase 3  | `openrouter.test.ts` exists; deterministic fixtures over live calls; optional dated eval set          |
| e2e                  | Playwright                                        | none yet — Phase 4 | Astro's official e2e recommendation; `/10x-e2e` skill governs generation                              |
| accessibility        | eslint-plugin-jsx-a11y                            | 6.10.2             | Already wired via ESLint; no runtime axe layer planned for MVP                                        |
| (optional) AI-native | chrome-devtools browser MCP — checked: 2026-06-22 | n/a                | Verification aid only; not a CI gate — do not layer over deterministic asserts                        |

**Stack grounding tools (current session):**

- Docs: Context7 MCP available — Astro testing guidance (Vitest + `getViteConfig()`, Playwright e2e) verified 2026-06-06, still current; runner already installed so no re-verify needed this pass; checked: 2026-06-22
- Search: Exa MCP available (deferred); WebSearch fallback — not needed this pass; checked: 2026-06-22
- Runtime/browser: chrome-devtools MCP + Playwright MCP available as an e2e verification/debug layer for Phase 4; not used for this refresh; checked: 2026-06-22
- Provider/platform: Supabase skill + local CLI — relevant to Phase 2 two-user fixtures and future quality gates; not used for this refresh; checked: 2026-06-22

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is planned.

| Gate                                   | Where                                 | Required?                     | Catches                                              |
| -------------------------------------- | ------------------------------------- | ----------------------------- | ---------------------------------------------------- |
| lint + typecheck (type-checked ESLint) | local (Lefthook) + CI                 | required (already wired)      | syntactic / type drift                               |
| unit + component (Vitest)              | local + CI                            | required (runner installed)   | logic and contract regressions                       |
| UC + state-machine coverage            | local + CI                            | required after §3 Phase 1     | recipe-session transition / ownership regressions    |
| RLS isolation suite                    | local + CI                            | required after §3 Phase 2     | cross-user data leaks; reset/verify callback holes   |
| LLM boundary contracts                 | local + CI                            | required after §3 Phase 3     | malformed-output and limit-bypass regressions        |
| e2e on the critical flow               | CI on PR (→ `main`)                   | required (wired — §3 Phase 4) | broken end-to-end user path                          |
| pre-prod smoke                         | between merge + prod (Workers Builds) | optional                      | environment-specific failures (dev-vs-Workers drift) |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase N."

### 6.1 Adding a unit test

- A suite already exists. Exemplars: `src/lib/utils/effect.test.ts`,
  `src/lib/core/model/error/` coverage, `src/lib/infrastructure/db/types/converters.test.ts`.
  The cookbook entry for the recipe state-machine pattern is filled by §3 Phase 1.

### 6.2 Adding a UC / use-case test with fake ports

- Exemplar: `src/lib/core/uc/recipe/RecipeSessionUC.test.ts` (inject fake
  `RecipeSessionRepository` / `PhotoRepository` / ports; assert over the
  Effect via `Effect.either`). §3 Phase 1 hardens the state-machine cases.
  Note the known trap: a fake `update` must honor the "missing/foreign row →
  `None`" contract, or it hides ownership/NotFound regressions.

### 6.3 Adding an integration test for an API route

- TBD — see §3 Phase 2 (envelope round-trip + auth route + callback pattern).

### 6.4 Adding an RLS / privacy isolation test

- TBD — see §3 Phase 2 (two-user fixture pattern against local Supabase, tables + storage).

### 6.5 Adding an LLM boundary contract test

- Partial: `src/lib/infrastructure/llm/openrouter.test.ts` exists.
  §3 Phase 3 fills the malformed-output rejection + server-side limit pattern.

### 6.6 Adding an e2e test

- Shipped (§3 Phase 4). Exemplar: `e2e/recipes-wizard.spec.ts` (the Risk #2
  critical-path smoke: upload → recognize → edit context → generate → save);
  `e2e/recipes-wizard-cancel.spec.ts` for the cancel/delete path. The `/10x-e2e`
  skill governs generation; its hard rules apply:
  - Role-based locators (`getByRole` / `getByLabel` / `getByText`); `getByTestId`
    only when a11y attributes are ambiguous. Never CSS selectors or XPath.
  - Never `page.waitForTimeout` — wait on state (`toBeVisible`, `waitForURL`,
    `waitForResponse`). Wait for island hydration before driving a `client:load`
    component.
  - Authenticated specs reuse the stored session from `e2e/auth.setup.ts`; seed
    deterministically and clean up per-test (unique ids; CSRF-safe verify/cleanup
    via same-origin `page.evaluate(fetch)`, not the `request` fixture — Astro CSRF
    rejects `request` POST/DELETE with no Origin).
  - LLM calls are faked via `E2E_FAKE_LLM` (`mock-openrouter-for-tests-e2e` →
    `FakeLlm`) — never assert exact model output as the oracle.
  - Runs in CI only (`e2e` job in `.github/workflows/ci.yml`, PR → `main`); not a
    local pre-commit gate, by §1 cost × signal.

### 6.7 Per-rollout-phase notes

(Appended by each phase's final sub-phase when something surprising lands.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **shadcn/ui vendored components (`src/components/ui/`)** — upstream code
  regenerated by `npx shadcn add`; not ours to test. Re-evaluate if a
  primitive is forked and hand-edited. (Source: interview Q5.)
- **Supabase client wiring itself** — the SDK's correctness is the SDK's
  job; we test _our_ policies and _our_ error translation, not the client.
  Re-evaluate if a custom transport or retry layer is added. (Source:
  interview Q5.)
- **Generated DB types (`src/lib/infrastructure/db/types/`)** — generator
  output, excluded from lint/format already; the generator is the test.
- **Semantic accuracy of product recognition as a CI gate** — model output
  quality is non-deterministic; the FR-005 edit path is the product-level
  mitigation. An optional dated eval set may exist (§3 Phase 3) but never
  blocks a merge.
- **Static / marketing pages (snapshot or visual tests)** — low blast
  radius, brittle, catch little; not worth the budget. Re-evaluate if a
  marketing page gains interactive logic. (Source: 2026-06-22 refresh, Q4.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-22 (full refresh)
- Stack versions last verified: 2026-06-22
- AI-native tool references last verified: 2026-06-22

**2026-06-30 reconciliation #2 (§3 status sync from disk — no §1/§2 rewrite):**

- Triggered by `/10x-test-plan --refresh` ("check Phase 4 — looks obsolete, E2E
  CI is in place"). Supersedes the Phase 4 bullet in reconciliation #1 below.
- **Phase 4 → `complete`.** Grounding: `e2e/recipes-wizard.spec.ts` is the
  Risk #2 critical-path smoke (upload → recognize → edit → generate → save) and
  passes; the `e2e` job in `.github/workflows/ci.yml` runs Playwright (with
  `E2E_FAKE_LLM`, staging Supabase) on PRs to `main`. Both halves of the phase's
  load-bearing intent — browser proof of the critical flow + a CI gate — are met.
  The E2E specs + Playwright integration + CI gate landed as direct commits out of
  band (no dedicated change folder); the deterministic fake-LLM seam is
  `mock-openrouter-for-tests-e2e`, which the §3 cell now points at.
- **Local-hook e2e gate dropped as a deliberate non-goal**, not deferred work:
  Playwright in pre-commit (spawns a dev server, minutes per run) violates §1
  principle #1 (cost × signal); e2e-on-PR is the correct gate. Phase 4's goal
  text was edited to reflect this; §5 e2e gate row flipped to `required (wired)`.
- **§6.6 cookbook filled** with the shipped e2e pattern (was "TBD — see Phase 4").
- No edits to §1 strategy or §2 risk map / response guidance.

**2026-06-30 reconciliation (§3 status sync from disk — no §1/§2 rewrite):**

- Triggered by a report finding ("rollout partially complete by design;
  Phases 2–4 not started; criterion met by implemented Phase 1 + existing E2E
  specs; RLS two-user suite would close the highest-value remaining risk #3").
- **Phase 1 → `complete`** and its change-folder cell corrected from the
  never-created `testing-recipe-session-state-machine/` to the real
  `recepie-session-state-machine/` (feature change, `impl_reviewed`, that also
  carried the test migration — see §3 note). Risk #1 app-layer
  ownership/NotFound and illegal-transition drift are now test-covered.
- **Phase 2 (RLS + auth callbacks) confirmed genuinely uncovered**: no
  two-user isolation test exists anywhere in `src/`, `e2e/`, or `supabase/`.
  Risk #3 (cross-user leak) is protected only by RLS policies with no automated
  assertion — the highest-value remaining gap. Selected as the next phase.
- **Phase 4 E2E specs noted as pre-built out of band** (`e2e/*.spec.ts`,
  `playwright.config.ts`, `FakeLlm`); status held at `not started` because the
  CI gate was unwired at the time. _(Superseded by reconciliation #2 above: the
  CI gate has since been wired and Phase 4 is now `complete`.)_
- No edits to §1 strategy or §2 risk map / response guidance.

**2026-06-22 refresh (full §1–§4 rewrite, in place by user direction):**

- Test base flipped `none` → meaningful: Vitest 4 + Testing-Library + jsdom
  - `src/test/setup.ts` and a ~13-file suite now exist. The old "Bootstrap
    runner" phase is retired as done.
- Old §3 Phase 1 (`testing-bootstrap-critical-path`) never materialized on
  disk; tests grew ad-hoc. Rollout table reset to reflect reality.
- Risk map reordered: recipe-session **state-machine integrity** elevated to
  Risk #1 (user's top fear, #1 churn file, a real `saveSession` NotFound
  drift found 2026-06-21). E2E smoke (#2) and auth **token abuse** (#4, new
  surface from `password-reset` FR-013) added. Envelope drift demoted to
  "verify, don't re-cover" (now unit-tested).
- Calibration: interview Q2 reports no real incidents → likelihoods kept at
  Medium except Risk #1.

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
