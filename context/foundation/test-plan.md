# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-06

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
(30 days, 21 commits; generated DB types and lockfiles excluded).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                                         | Impact | Likelihood | Source (evidence — not anchor)                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Vision step returns wrong/hallucinated products, or a malformed model response renders garbage instead of an editable list — the recipe is built on a bad inventory             | High   | High       | Interview Q1 (user's top fear); PRD FR-004/FR-005; roadmap S-01 risk note                                                         |
| 2   | Auth flow regression: login breaks, wrong-password leaks an untyped 500, or an unverified account can sign in (FR-001 gate still pending)                                       | High   | High       | Hot-spot dirs `src/components/auth/` (32 commits/30d) + `src/pages/api/` (20 commits/30d); roadmap F-02 status `ready`, not built |
| 3   | Cross-user data leak: user B reads/writes/deletes user A's sessions, recipes, or photos (IDOR / RLS or storage-policy hole) — abuse scenario                                    | High   | Medium     | PRD privacy guardrail (launch-gating); roadmap F-01/S-03/S-04 risk notes ("first real test of RLS")                               |
| 4   | API error-envelope contract drift: error→status mapping or envelope shape changes on one side; client-side validation turns every response into an opaque transport error       | Medium | High       | Hot-spot dir `src/lib/` (17 commits/30d); conventions registry — envelope is a binding two-sided contract                         |
| 5   | Recipe generation output misses name/ingredients/steps or breaches the ~30 s NFR; the north-star flow fails opaquely                                                            | High   | Medium     | PRD FR-008 + NFR response time; roadmap S-02 risk note (validation milestone)                                                     |
| 6   | Upload limits enforced only client-side: >5 files / >5 MB / non-image reaches the server, burning paid LLM calls and storage — abuse scenario (resource abuse, untrusted input) | Medium | Medium     | PRD FR-003; roadmap S-01 risk note ("server-side validation, not client-only")                                                    |

Considered and deliberately not mapped: "works in `astro dev`, breaks on
Cloudflare Workers" — no incident evidence (interview Q2) and no cheap
deterministic signal; belongs to observability (`wrangler tail`) and the
pre-prod smoke gate, not a test row.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                                                                                                                                                 | Must challenge                                                                            | Context `/10x-research` must ground                                                                                                | Likely cheapest layer                                   | Anti-pattern to avoid                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| #1   | Unparseable/malformed vision output fails typed and surfaces a clear error — never a garbage list; the recognized list is always editable before generation (the FR-005 safety valve). Semantic _accuracy_ of recognition is an eval problem, not a deterministic gate — a small, dated, fixture-based eval set is optional | "Schema-valid output means correct output" — shape ≠ accuracy                             | Vision call site, response schema, error translation path, fixture strategy for recorded model outputs                             | contract/unit with recorded fixtures                    | Asserting exact model output (flaky oracle); testing only the happy parse          |
| #2   | Signin/signup/signout return the documented envelope for success, validation failure (fieldErrors), and bad credentials; unauthenticated access to protected routes redirects; once email verification lands, an unverified account cannot sign in                                                                          | "Happy-path login implies the gate works"                                                 | Route pipelines, protected-route gating mechanism, how auth-provider errors translate to domain errors                             | integration on API routes + unit on middleware          | Mocking the auth provider so deeply the test mirrors the implementation            |
| #3   | With two real users, every read/write/delete on domain tables AND the storage bucket returns only owner-scoped data; cross-user access fails closed at the database layer, not just the API layer                                                                                                                           | "RLS enabled = policies correct"; "API-level checks suffice" — PostgREST is also a door   | Actual policy definitions, table vs storage-policy parity, two-user fixture strategy against local Supabase                        | integration vs local Supabase (db reset + seeded users) | Testing isolation only through the app's own API; owner-only happy-path assertions |
| #4   | Every server error type maps to its documented HTTP status and envelope shape; the client's envelope schema parses real server output (round-trip), so contract drift fails in CI, not in the browser                                                                                                                       | "The exhaustive match makes tests redundant" — totality is not correctness of the mapping | Error-code→status table, mapper branches, shared boundary schemas used by both sides                                               | unit on mapper + one round-trip contract test           | Copying expected statuses from the mapper under test (oracle problem)              |
| #5   | Generation output missing required recipe fields fails typed and the user sees a clear error, never a partially rendered recipe; latency vs the 30 s NFR is observed (logged/measured), not asserted in a flaky test                                                                                                        | "Final status 200 means the recipe is usable"                                             | Generation call site, recipe output schema, timeout/abort behavior on the edge runtime                                             | contract/unit with recorded fixtures                    | e2e against the live LLM as the primary gate (slow, flaky, paid)                   |
| #6   | The server rejects the 6th file, an oversized file, and a non-image with a typed 400 — regardless of what the client sends; rejected uploads never trigger an LLM call                                                                                                                                                      | "The client already validates"                                                            | Upload endpoint shape once S-01 lands; where limits are declared and enforced; what happens between upload accept and LLM dispatch | integration on the upload route                         | Exercising limits only through the React form                                      |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                         | Goal (one line)                                                                                                                         | Risks covered                   | Test types                                | Status        | Change folder                                    |
| --- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------- | ------------- | ------------------------------------------------ |
| 1   | Bootstrap + critical-path coverage | Stand up the unit/integration runner and prove the auth flow and error-envelope contract cannot silently regress                        | #2, #4                          | unit + integration                        | change opened | context/changes/testing-bootstrap-critical-path/ |
| 2   | Privacy / RLS integration suite    | Prove cross-user isolation on domain tables and the storage bucket with two-user fixtures                                               | #3                              | integration (local Supabase)              | not started   | —                                                |
| 3   | LLM boundary contracts             | Prove malformed model output fails typed at both LLM boundaries and server-side upload limits hold (gated on roadmap S-01/S-02 landing) | #1, #5, #6                      | contract/unit with fixtures + integration | not started   | —                                                |
| 4   | E2E smoke + quality-gates wiring   | One real-browser pass over the critical flow and a test gate wired into the local hook + CI                                             | cross-cutting (floor for #1–#6) | e2e + gates                               | not started   | —                                                |

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

| Layer                | Tool                                              | Version                   | Notes                                                                                    |
| -------------------- | ------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------- |
| unit + integration   | Vitest via Astro's `getViteConfig()`              | none yet — see Phase 1    | Astro's official recommendation (docs checked 2026-06-06); no runner installed today     |
| API/route testing    | Vitest + local Supabase stack                     | none yet — see Phases 1–2 | Local Supabase (Docker) already used for migrations; reuse for integration fixtures      |
| LLM boundary         | recorded-fixture contract tests                   | none yet — see Phase 3    | Deterministic fixtures over live calls; optional dated eval set for recognition accuracy |
| e2e                  | Playwright                                        | none yet — see Phase 4    | Astro's official e2e recommendation; `/10x-e2e` skill governs generation                 |
| accessibility        | eslint-plugin-jsx-a11y                            | 6.10.2                    | Already wired via ESLint; no runtime axe layer planned for MVP                           |
| (optional) AI-native | chrome-devtools browser MCP — checked: 2026-06-06 | n/a                       | Verification aid only; not a CI gate — do not layer over deterministic asserts           |

**Stack grounding tools (current session):**

- Docs: Context7 MCP — verified Astro's official testing guidance (Vitest + `getViteConfig()`, Playwright e2e); checked: 2026-06-06
- Search: Exa MCP present but unauthenticated; WebSearch available as fallback — not needed this pass; checked: 2026-06-06
- Runtime/browser: chrome-devtools MCP — available as a verification layer for e2e debugging; not used for this write; checked: 2026-06-06
- Provider/platform: Supabase skill + local CLI — relevant to Phase 2 fixtures and future quality gates; not used for this write; checked: 2026-06-06

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is planned.

| Gate                                   | Where                                 | Required?                 | Catches                                              |
| -------------------------------------- | ------------------------------------- | ------------------------- | ---------------------------------------------------- |
| lint + typecheck (type-checked ESLint) | local (Lefthook) + CI                 | required (already wired)  | syntactic / type drift                               |
| unit + integration                     | local + CI                            | required after §3 Phase 1 | logic and contract regressions                       |
| RLS isolation suite                    | local + CI                            | required after §3 Phase 2 | cross-user data leaks                                |
| LLM boundary contracts                 | local + CI                            | required after §3 Phase 3 | malformed-output and limit-bypass regressions        |
| e2e on the critical flow               | CI on PR                              | required after §3 Phase 4 | broken end-to-end user path                          |
| pre-prod smoke                         | between merge + prod (Workers Builds) | optional                  | environment-specific failures (dev-vs-Workers drift) |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase N."

### 6.1 Adding a unit test

- TBD — see §3 Phase 1 (error-envelope mapping and auth-flow regression patterns).

### 6.2 Adding an integration test for an API route

- TBD — see §3 Phase 1 (envelope round-trip + auth route pattern).

### 6.3 Adding an RLS / privacy isolation test

- TBD — see §3 Phase 2 (two-user fixture pattern against local Supabase, tables + storage).

### 6.4 Adding an LLM boundary contract test

- TBD — see §3 Phase 3 (recorded-fixture pattern for malformed-output rejection and server-side limit enforcement).

### 6.5 Adding an e2e test

- TBD — see §3 Phase 4 (critical-flow smoke; `/10x-e2e` skill rules apply: role-based locators, no `waitForTimeout`, test independence).

### 6.6 Per-rollout-phase notes

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

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-06 (Phase 1 change opened same day)
- Stack versions last verified: 2026-06-06
- AI-native tool references last verified: 2026-06-06

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
