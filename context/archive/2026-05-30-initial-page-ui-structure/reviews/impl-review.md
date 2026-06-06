<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Initial Page UI Structure

- **Plan**: `context/changes/initial-page-ui-structure/plan.md`
- **Scope**: All phases (1–3 of 3)
- **Date**: 2026-05-30
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical 4 warnings 2 observations

## Verdicts

| Dimension           | Verdict     |
| ------------------- | ----------- |
| Plan Adherence      | WARNING     |
| Scope Discipline    | WARNING     |
| Safety & Quality    | WARNING     |
| Architecture        | WARNING     |
| Pattern Consistency | OBSERVATION |
| Success Criteria    | PASS        |

## Findings

### F1 — Topbar Sign out uses plain `<button>`, not shadcn Button

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/components/Topbar.astro:13`
- **Detail**: The plan's Phase 1 contract is explicit: "Use … the shadcn Button for Sign out." The actual implementation uses a raw `<button>` with inline Tailwind classes. The Button component is never imported. Functionally it works, but the drift means the Topbar is the only place in the app that bypasses the shadcn Button abstraction.
- **Fix**: Import the shadcn Button and replace the raw `<button>` with it.
  - Strength: One-line import + element swap; makes Topbar consistent with every other interactive element in the UI and matches the documented contract.
  - Tradeoff: Trivial — the existing classes may need minor adjustment to use Button variant props.
  - Confidence: HIGH — Button is already used in every other interactive context (auth forms, landing CTAs).
  - Blind spot: None significant.
- **Decision**: FIXED — imported shadcn Button (variant="ghost" size="sm") and replaced raw `<button>`.

### F2 — Static lucide icons in landing page hydrated as client islands

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/index.astro:30, :37, :44`
- **Detail**: Camera, ListChecks, and ChefHat each carry `client:load`. These icons are purely decorative with no interactivity — each `client:load` creates a separate hydration island and ships unnecessary JS to the browser. `Card` and `Button` on the same page correctly have no `client:*` directive.
- **Fix**: Remove `client:load` from the three icon usages.
  - Strength: Icons are children of Astro markup so they will server-render to their SVG output with no directive needed; zero JS shipped for static decorative icons.
  - Tradeoff: None — these icons have no client-side behaviour.
  - Confidence: HIGH — confirmed by Astro island semantics.
  - Blind spot: None significant.
- **Decision**: FIXED — removed `client:load` from Camera, ListChecks, and ChefHat in src/pages/index.astro.

### F3 — `next-themes` dead dependency in package.json

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `package.json:34`
- **Detail**: `next-themes` is present as a runtime dependency but has zero imports across all of `src/`. It was pulled in by `npx shadcn add sonner` then neutered — `sonner.tsx` was correctly hardcoded to `theme="light"` per the plan's "No theme toggle" guardrail, but the dependency itself was not pruned. Ships dead code to the Cloudflare Worker bundle.
- **Fix**: Remove `next-themes` from `package.json` and run `npm install` to prune the lockfile. Consistent with how `@phosphor-icons/react` was pruned in Phase 2.
  - Strength: Zero consumers; safe to remove immediately.
  - Tradeoff: None.
  - Confidence: HIGH — confirmed with rg across all of src/.
  - Blind spot: None significant.
- **Decision**: FIXED — removed `next-themes` from package.json and ran npm install.

### F4 — `export const prerender = false` missing from API routes

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: `src/pages/api/auth/signin.ts`, `signout.ts`, `signup.ts`
- **Detail**: CLAUDE.md states: "API routes must `export const prerender = false`." None of the three API routes have this export. This was a pre-existing gap (signup.ts already lacked it before this change). Under `output: "server"` the app is currently correct, but the rule exists as a defensive measure against a future shift to `output: "hybrid"`.
- **Fix**: Add `export const prerender = false;` as the first export in signin.ts, signout.ts, and signup.ts.
  - Strength: Three one-liners; fully satisfies the documented rule; future-proofs against hybrid-mode migration.
  - Tradeoff: None.
  - Confidence: HIGH — rule is verbatim in CLAUDE.md.
  - Blind spot: signup.ts predates this change; include it to clear the full gap.
- **Decision**: FIXED — added `export const prerender = false;` to signin.ts, signout.ts, signup.ts.

### F5 — `src/components/toast.ts` is dead code with no active consumers

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/toast.ts:1`
- **Detail**: Single-line re-export barrel (`export { toast } from "sonner"`). Zero consumers in src/. The plan defers actual toast usage to feature slices S-01–S-04. File is harmless but adds indirection without current value and conflicts with the project's no-barrel convention.
- **Fix**: Leave as-is until a feature slice consumes it. No action needed now.
- **Decision**: SKIPPED — will be consumed by future feature slices S-01–S-04.

### F6 — Supabase SDK error messages surfaced verbatim to users

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/auth/signin.ts:16`, `src/pages/api/auth/signup.ts:13`
- **Detail**: Raw `error.message` from the Supabase SDK is encoded into the redirect URL and displayed via `ServerError`. Pre-existing pattern (not introduced by this change). Supabase messages are generally safe strings but are third-party output — not user-friendly, not localised. Not an XSS risk (JSX text node rendering).
- **Fix**: Add user-facing message mapping in a follow-up change. No urgent action needed now.
- **Decision**: SKIPPED — pre-existing pattern; address with a user-facing message map in a follow-up change.
