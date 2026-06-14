<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Editable Product List

- **Plan**: context/changes/editable-product-list/plan.md
- **Scope**: Full plan (Phases 1–3 of 3)
- **Date**: 2026-06-14
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Success criteria verified fresh: `tsc --noEmit` = 0, `pnpm lint` = 0, `pnpm test` = 18/18 (after F1 fix), `pnpm build` green at p2/p3 with unchanged build inputs. Drift detection: all 10 planned items MATCH; every "What We're NOT Doing" guardrail respected (no server/API/DB touch; `toCorrectedItems` produced but never wired to an upload; `PhotoReviewCard` untouched; per-item context read-only; shadcn primitives reused).

## Findings

### F1 — Over-length hint measures raw length; projection measures trimmed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/recipes/wizard/useEditableItems.ts:38,40
- **Detail**: `itemFieldHints` flagged over-length on raw `.length`, while `toCorrectedItems` trims before validating. A value whose trailing/leading whitespace pushed raw length past the bound but trimmed to within it showed an over-length hint the projection would accept. Empty checks already used `.trim()`. (The agent's related "no context hint" concern is moot: `context` is read-only, seeded from already-validated server data or "" for new rows, so it can never exceed max(280) in this UI.)
- **Fix**: Measure trimmed length in both over-length checks (`item.name.trim().length`, `item.quantity.trim().length`) so the hint matches the projection's accept/reject boundary; added an `itemFieldHints` test for the whitespace-boundary case.
  - Strength: Hint and server-ready projection now agree on exactly one length basis (trimmed).
  - Tradeoff: None — pure narrowing of a cosmetic edge case.
  - Confidence: HIGH — covered by a new unit test; full suite green.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix now — commit 502d2dddd

### F2 — crypto.randomUUID() on a render path

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/recipes/wizard/useEditableItems.ts:45,57
- **Detail**: Row ids are minted with `crypto.randomUUID()` in a `useState` lazy initializer (`seedRows`) and in `addItem`. Available in jsdom 29 (tests green), Cloudflare Workers, and Node SSR; the review step renders client-side only (after upload completion), so SSR never hits it.
- **Fix**: None needed — safe by design.
- **Decision**: ACCEPTED (no action)

### F3 — No test covers the hint/projection whitespace edge

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/components/recipes/wizard/ProductListEditor.test.tsx
- **Detail**: The suite covered seed/edit/add/delete/empty/validation and the pure helper + projection, but no case exercised the F1 boundary (trailing whitespace at the length limit).
- **Fix**: Add an `itemFieldHints` case once F1's length basis is settled.
- **Decision**: FIXED — the F1 fix added exactly this boundary test (commit 502d2dddd)
