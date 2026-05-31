<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Migration to React Form (react-hook-form + Zod)

- **Plan**: context/changes/migration-to-react-form/plan.md
- **Mode**: Deep
- **Date**: 2026-05-30
- **Verdict**: REVISE → SOUND (all 6 findings fixed in plan)
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts

| Dimension             | Verdict              |
| --------------------- | -------------------- |
| End-State Alignment   | PASS                 |
| Lean Execution        | PASS                 |
| Architectural Fitness | PASS                 |
| Blind Spots           | WARNING (F1, F2, F3) |
| Plan Completeness     | WARNING (F4, F5, F6) |

## Grounding

7/8 paths ✓ (src/types.ts absent — see F6); blast ✓ (auth endpoints called only by the 2 forms + signout in Topbar); brief↔plan ✓.

## Findings

### F1 — sonner Toaster is not mounted on the auth pages

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 #1/#2; Success Criteria 3.7; Desired End State
- **Detail**: `<Toaster client:load />` is mounted only in `src/layouts/AppLayout.astro:26`. The auth pages render under `PublicLayout.astro`, which has no Toaster, so transport-fault toasts silently no-op — the exact failure SC 3.7 guards against.
- **Fix**: Add a Phase 3 step to mount `<Toaster client:load />` in `PublicLayout.astro` + an SC confirming the toast is visible.
- **Decision**: FIXED (added Phase 3 #4 "Mount Toaster on auth pages"; Current State note; SC 3.8 + manual checklist update)

### F2 — `shadcn add form` may emit the new non-RHF Field primitive

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 #2
- **Detail**: The plan assumes `add form` yields the classic RHF-coupled Form/FormField. shadcn v4 also ships a non-RHF Field/FieldError system; this project is on `shadcn@^4.8.3` with `style: radix-lyra` where the wrong variant could land. SC 1.2 detects a mismatch but the plan had no recovery path.
- **Fix**: Add a verify-and-fallback guard to Phase 1 #2.
- **Decision**: FIXED (added "Variant guard" paragraph to Phase 1 #2)

### F3 — Auth-cookie persistence via fetch + window.location is unverified

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 #2/#3; Phase 3 #1
- **Detail**: Switching from a 302 (Set-Cookie applied on redirect) to a 200 JSON fetch + `window.location` requires the Supabase auth cookie to be emitted on the JSON Response and persisted by the browser before navigation. If not, login silently bounces back via middleware. Unverified on Cloudflare Workers.
- **Fix**: Add an implementation note + manual SC for authenticated landing.
- **Decision**: FIXED (added cookie note to Critical Implementation Details; manual SC + Progress 3.6)

### F4 — Zod v4 `z.string().email()` is deprecated

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 #1
- **Detail**: Plan adopts zod@4 but specifies the deprecated `z.string().email()`; v4 prefers top-level `z.email()`. Type-checked eslint may warn.
- **Fix**: Use `z.email()`.
- **Decision**: FIXED (signInSchema contract updated)

### F5 — Server fieldErrors shape vs. zod flatten (string[] vs string)

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 #3 + Phase 2 #2
- **Detail**: `FieldErrors` is field→string but `flatten().fieldErrors` is field→string[]; the route must reduce arrays to a single message.
- **Fix**: Document the `[0]` reduction in the route contract.
- **Decision**: FIXED (added "fieldErrors shape" note to Phase 2 #2)

### F6 — Minor grounding gaps: src/types.ts absent; guide location unresolved

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 #3; Phase 3 #4(→#5)
- **Detail**: Plan said `src/types.ts` is "empty (0 bytes)" but it doesn't exist; guide path was a soft TBD with no `docs/` dir present.
- **Fix**: State types.ts is created; fix guide path to `docs/reference/forms.md`.
- **Decision**: FIXED (Current State note corrected; guide is now #5 with explicit new-file path)
