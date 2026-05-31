# Migration to React Form (react-hook-form + Zod) — Plan Brief

> Full plan: `context/changes/migration-to-react-form/plan.md`

## What & Why

Snapchef's two auth forms are hand-rolled React (`useState` + bespoke `validate()` + native POST + zero server validation). This change makes **react-hook-form + Zod + the shadcn `form` primitive** the single standard for all current and future forms, with **Zod schemas shared between client and server** as the one source of validation truth. Auth forms are migrated as the reference implementation. The driver is the roadmap: S-01 (photo upload + editable items list) and S-02 (meal-context textarea) need a real form foundation, not more hand-rolled logic.

## Starting Point

`SignInForm`/`SignUpForm` validate client-side by hand and POST natively to API routes that cast `formData` to strings without validation and redirect with `?error=`. No `react-hook-form`, `@hookform/resolvers`, or `zod` installed; shadcn `form` primitive not yet added; `src/types.ts` is empty. `sonner` (toast) is already wired.

## Desired End State

A new form is "define a Zod schema + render `FormField`s + call the submit helper." Schemas live in `src/lib/validation/` and are imported by both the RHF `zodResolver` (client) and the API route `safeParse` (server). API routes return structured JSON (`{ ok, redirect }` or `{ ok:false, fieldErrors, message }`); forms render field errors inline, toast on transport faults, and navigate on success. A short guide documents the pattern and shows how file-upload and dynamic-array forms fit.

## Key Decisions Made

| Decision              | Choice                                              | Why (1 sentence)                                                           | Source |
| --------------------- | --------------------------------------------------- | -------------------------------------------------------------------------- | ------ |
| Submission model      | Client `fetch` + JSON API                           | Full RHF idiom, inline server-field errors, scales to upload/array forms.  | Plan   |
| Schema location       | Shared schemas in `src/lib/validation/`             | One source of truth; client/server can't drift; respects import boundary.  | Plan   |
| Form abstraction      | shadcn `form` primitive + thin `useZodForm` wrapper | Canonical RHF+shadcn, accessible by default, matches "extend shadcn" rule. | Plan   |
| Server validation     | `safeParse` + structured field errors               | Server is the real authority; per-field errors surface inline.             | Plan   |
| Scope                 | Foundation + migrate the 2 auth forms               | Proves the pattern end-to-end without waiting on S-01/S-02.                | Plan   |
| Future-form readiness | Design for file/array forms, don't build them       | De-risks S-01/S-02 without speculative code.                               | Plan   |
| Feedback UX           | Inline field errors + `sonner` toast for faults     | Precise per-field UX; toast only for non-field/network faults.             | Plan   |
| Verification          | Lint + typecheck + build + manual checklist         | Matches current infra (no test runner); avoids scope creep.                | Plan   |

## Scope

**In scope:** add deps + shadcn `form`; `useZodForm` + `submitJson` helpers; shared auth Zod schemas; `ApiResult`/`FieldErrors` types; rewrite signin/signup API routes to JSON; migrate `SignInForm`/`SignUpForm`; "how to add a new form" guide.

**Out of scope:** S-01/S-02 forms; generic `FileField`/`ArrayField` components; no-JS fallback; a test runner; `signout.ts`; Supabase/middleware/email-verification changes.

## Architecture / Approach

Island form → RHF `useZodForm(schema)` validates client-side → `handleSubmit` posts JSON via `submitJson` → API route `safeParse`s the **same** schema → returns `ApiResult`. Client maps `fieldErrors` onto RHF fields (`setError`), shows a form-level message or `sonner` toast for non-field faults, and `window.location` navigates on `{ ok:true, redirect }`. Schemas in `src/lib/validation/` stay pure (`zod` only) so they cross the client/server boundary safely.

## Phases at a Glance

| Phase                                     | What it delivers                                                                                | Key risk                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1. Form Foundation & Dependencies         | Deps, shadcn `form`, `ApiResult` types, `useZodForm` + `submitJson`, reconciled leaf components | Reconciling custom `FormField`/`SubmitButton` with shadcn `Form*`. |
| 2. Shared Schemas & JSON API Contract     | `src/lib/validation/auth.ts`; signin/signup routes return structured JSON                       | API contract change; keeping schema module server-import-free.     |
| 3. Migrate Auth Forms & Future-Form Guide | RHF-based `SignInForm`/`SignUpForm`; "add a new form" guide                                     | Error-mapping + nav UX; proving file/array fit by design.          |

**Prerequisites:** none (independent of S-01/S-02; builds on existing auth pages).
**Estimated effort:** ~1–2 sessions across 3 phases.

## Open Risks & Assumptions

- Dropping the no-JS progressive-enhancement fallback is acceptable for this MVP audience.
- shadcn's reconciliation with the existing custom `FormField` (icon + endContent + hint) stays visually identical.
- Zod v4 + `@hookform/resolvers` resolver auto-detection works as documented in the Astro React island.

## Success Criteria (Summary)

- Both auth forms validate inline (client) and on the server via the **same** Zod schema; invalid input never reaches Supabase.
- A new form can be added by defining a schema + rendering `FormField`s + calling `submitJson`, per the guide.
- `npm run lint`, `astro check`, and `npm run build` all pass; the manual checklist passes for both forms.
