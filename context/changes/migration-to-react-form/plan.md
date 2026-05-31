# Migration to React Form (react-hook-form + Zod) Implementation Plan

## Overview

Snapchef's two forms today (`SignInForm`, `SignUpForm`) are hand-rolled React islands: per-field `useState`, bespoke `validate()` functions with inline regex/length checks, a manual `errors` object, native progressive-enhancement POST to an API route that validates nothing and redirects with `?error=` on failure. This pattern does not scale to the forms the roadmap demands next — photo upload (1–5 files, S-01), an editable recognized-items list (dynamic array, S-01), and a free-text meal-context field (S-02).

This change establishes **react-hook-form (RHF) + Zod + the shadcn `form` primitive** as the single standard for all current and future forms, with **Zod schemas shared between client and server** as the one source of validation truth. It migrates the two auth forms as the reference implementation and proves (by design, not speculative code) that the foundation absorbs file-upload and dynamic-array forms later.

## Current State Analysis

- **Form components** live in `src/components/auth/`:
  - `SignInForm.tsx` (`src/components/auth/SignInForm.tsx`) and `SignUpForm.tsx` (`src/components/auth/SignUpForm.tsx`) — `useState` per field, manual `validate()`, manual `clearError()`, native `<form method="POST" action="/api/auth/...">` with `onSubmit` that only calls `e.preventDefault()` when client validation fails.
  - Leaf components: `FormField.tsx` (controlled `value`/`onChange` Input + label + error/hint), `PasswordToggle.tsx`, `SubmitButton.tsx` (reads `useFormStatus()` — native-form pending state), `ServerError.tsx` (renders `serverError` string).
- **API routes** (`src/pages/api/auth/signin.ts`, `signup.ts`, `signout.ts`): `await request.formData()`, `form.get("email") as string` with **no validation**, call Supabase, and `context.redirect("/auth/signin?error=...")` on failure or `context.redirect("/recipes")` / `/auth/confirm-email` on success. `export const prerender = false` is present (hard rule).
- **Pages** (`src/pages/auth/signin.astro`, `signup.astro`): read `Astro.url.searchParams.get("error")`, pass it as `serverError` prop to the island mounted with `client:load`.
- **Dependencies**: `react@19.2`, `react-dom@19.2`, `@radix-ui/react-slot`, `radix-ui`, shadcn primitives `button/card/input/label/sonner` only. **No `react-hook-form`, no `@hookform/resolvers`, no `zod`, no shadcn `form` primitive.** `sonner` (toast) IS installed and wired (`src/components/ui/sonner.tsx`).
- **shadcn config** (`components.json`): `style: radix-lyra`, `tsx: true`, `ui` alias `@/components/ui`, `lib` alias `@/lib`. `hooks` alias points at `@/hooks` (note: project convention per `src/components/CLAUDE.md` is `src/components/hooks/` — see Key Discoveries).
- **`src/types.ts` does not exist yet** — the implementer creates it as the home for the shared API contract types (CLAUDE.md designates `src/types.ts` for shared entities and DTOs).
- **`sonner` `<Toaster/>` is mounted only in `src/layouts/AppLayout.astro`** (line 26). The auth pages render under `PublicLayout.astro`, which has **no** `<Toaster/>` — so any toast fired from an auth form would silently no-op until one is mounted (see Phase 3).
- **No test runner** is configured; CI (`.github/workflows/ci.yml`) runs lint + build only. `npm run lint` = `eslint .` (type-checked rules), and `astro check` is available via `@astrojs/check`.

### Key Discoveries:

- **RHF + Zod + React 19 are fully compatible**: `react-hook-form@7.66`, `@hookform/resolvers@3.x`, `zod@4` (current stable). `zodResolver` import is unchanged (`@hookform/resolvers/zod`) and auto-detects Zod v3 vs v4 at runtime — no flag needed.
- **`npx shadcn@latest add form`** emits a single file `src/components/ui/form.tsx` exporting `Form` (=`FormProvider`), `FormField` (wraps RHF `Controller`), `FormItem`, `FormLabel`, `FormControl` (a `Slot` that auto-injects `aria-invalid` + `aria-describedby`), `FormDescription`, `FormMessage` (auto-renders `fieldState.error.message`), and `useFormField`. It installs `react-hook-form` as a dependency. The classic RHF-coupled component is what this command produces (shadcn's newer non-RHF `Field` system is separate — we want the RHF one).
- **Astro island gotchas** (`client:load`): all `Form*` components rely on React context, so the entire form must live in one island (already true). `defaultValues` must be fully specified (`""`, not `undefined`) or React warns about uncontrolled→controlled. No `"use client"` (Astro, not Next — hard rule). `handleSubmit` is client-side → submit via `fetch` to the API route.
- **Project rule** (`src/components/CLAUDE.md`): interactive components must extend shadcn primitives, not hand-roll — this directly endorses adopting the shadcn `form` primitive. `.tsx` only when interactivity is needed; `interface <Name>Props` above the component; named exports for leaves, `export default` for page-mounted features.
- **Server-only import boundary** (`src/components/CLAUDE.md` + root CLAUDE.md): `.tsx` files must not import `@/lib/supabase`, `astro:env/server`, or `@/lib/services/*`. Therefore shared Zod schemas in `src/lib/validation/` **must stay framework-agnostic** (import only `zod`) so both the client island and the server route can import them without dragging server-only code into the client bundle.
- **Reusable hooks** go in `src/components/hooks/` (per `src/components/CLAUDE.md`), even though `components.json` `hooks` alias says `@/hooks`. Follow the CLAUDE.md convention: `useZodForm` lives in `src/components/hooks/`.

## Desired End State

After this plan:

- `react-hook-form`, `@hookform/resolvers`, `zod` are dependencies; `src/components/ui/form.tsx` (shadcn) exists.
- A reusable `useZodForm` helper and a shared `apiClient`/submit helper exist so a new form is "define a Zod schema + render `FormField`s + call the submit helper."
- `src/lib/validation/auth.ts` holds the canonical sign-in / sign-up Zod schemas, imported by **both** the React islands (via `zodResolver`) and the API routes (via `safeParse`).
- `src/types.ts` defines the JSON API response contract (`ApiResult` / `FieldErrors`) used by every form-backed endpoint.
- `signin.ts` / `signup.ts` validate with the shared schema and return **structured JSON** (`200 {ok:true, redirect}` or `400 {ok:false, fieldErrors|message}`), not redirects.
- `SignInForm` / `SignUpForm` are rebuilt on RHF + shadcn `Form`: client `fetch` submission, inline per-field errors (`FormMessage`), a `sonner` toast for unexpected server/network faults, and `window.location` navigation on success.
- A short **"How to add a new form"** guide documents the pattern and shows how file-upload (`z.instanceof(File)` / `FileList`) and dynamic-array (`useFieldArray`) forms fit — so S-01/S-02 build on this without redesign.

**Verification of end state**: `npm run lint` (eslint, type-checked) passes, `astro check` passes, `npm run build` succeeds, and the manual checklist (valid submit → redirect, invalid submit → inline errors, server error → field error or toast, no-JS not required) passes for both auth forms.

## What We're NOT Doing

- **Not** building the S-01 photo-upload form, the recognized-items array form, or the S-02 meal-context form. We design the foundation to fit them and document how, but implement only the two auth forms.
- **Not** shipping generic `FileField` / `ArrayField` components now (speculative without real S-01 requirements).
- **Not** preserving the no-JS progressive-enhancement fallback. Forms now require JS (acceptable for an MVP targeting the author + a few users).
- **Not** introducing a test runner (Vitest / Testing Library). Verification is lint + typecheck + build + a manual checklist, matching current project infra. (A test-runner decision is its own change.)
- **Not** touching `signout.ts` (no user input → nothing to validate; it stays a redirect endpoint).
- **Not** changing Supabase auth behavior, middleware, or the email-verification flow (F-02).

## Implementation Approach

Three sequential phases, each independently verifiable:

1. **Foundation** — install deps, add the shadcn `form` primitive, define the shared JSON API contract types, and build the thin reusable layer (`useZodForm` + a `submitJson` fetch helper). Reconcile the existing custom leaf components with shadcn's `Form*` family so there's one field idiom.
2. **Schemas + API contract** — author the shared Zod schemas and rewrite the two API routes to `safeParse` and return structured JSON. This is the server-authority layer the forms depend on.
3. **Migrate forms + guide** — rebuild the two auth forms on the new stack and write the "how to add a new form" guide that proves future-form fit.

The submission model is **client `fetch` + JSON API**: RHF's `handleSubmit` posts JSON; the API returns `{ok, redirect}` or `{ok:false, fieldErrors, message}`; the client maps `fieldErrors` onto RHF fields via `setError`, shows a `sonner` toast for non-field faults, and navigates on success.

## Critical Implementation Details

- **Shared-schema import boundary**: `src/lib/validation/*.ts` must import only `zod` (no `astro:env`, no Supabase, no server modules), because the client island imports the same file. Keep these schemas pure.
- **`defaultValues` are mandatory** for every RHF field (`""` for the auth text fields) to avoid the uncontrolled→controlled React warning in the hydrated island. `confirmPassword` is a client-only field — it lives in the client schema's `.refine()` but is **not** sent to or validated by the server (server only needs `email` + `password`).
- **Field-error mapping contract**: server `fieldErrors` keys must exactly match RHF field names (`email`, `password`) so `Object.entries(fieldErrors).forEach(([k,v]) => form.setError(k, {message: v}))` works without a translation layer.
- **Auth-cookie persistence across fetch → navigation** (linchpin): the old flow returned a `302` whose `Set-Cookie` the browser applied during the redirect. The new flow returns `200` JSON from a same-origin `fetch`, then the client runs `window.location.href = redirect`. For the destination to be authenticated, the Supabase auth cookie set via `context.cookies` must (a) be emitted on the JSON `Response` (build the response so Astro's cookie serialization still runs — don't bypass it), and (b) be persisted by the browser from the fetched response before navigation (same-origin fetch with default `credentials: "same-origin"` does this). If either fails, login "succeeds" but middleware bounces the user back to `/auth/signin`. Verify on Cloudflare Workers, where cookie handling on JSON responses is not yet confirmed.

## Phase 1: Form Foundation & Dependencies

### Overview

Install the form stack, add the shadcn `form` primitive, define the JSON API contract types, and build the thin reusable layer every future form uses. Reconcile the existing custom leaf components with shadcn's `Form*` components so there is a single field idiom.

### Changes Required:

#### 1. Dependencies

**File**: `package.json`

**Intent**: Add the form stack so RHF, the Zod resolver, and Zod itself are available. Prefer letting `shadcn add form` pull `react-hook-form`, then add the resolver and zod explicitly.

**Contract**: New dependencies `react-hook-form@^7.66`, `@hookform/resolvers@^3`, `zod@^4`. No version pin conflicts with React 19. Run via the project's package manager (npm).

#### 2. shadcn form primitive

**File**: `src/components/ui/form.tsx` (generated)

**Intent**: Add the canonical RHF-coupled shadcn `form` component as the accessible field foundation, per the project rule to extend shadcn primitives.

**Contract**: `npx shadcn@latest add form` generates `src/components/ui/form.tsx` exporting `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage`, `useFormField`. Do not hand-edit beyond what reconciliation in change #5 requires.

**Variant guard** (this project is on `shadcn@^4.8.3` with `style: radix-lyra`): shadcn v4 also ships a newer `Field`/`FieldLabel`/`FieldError` system that is **not** react-hook-form-coupled. Immediately after running `add form`, verify `form.tsx` is the **classic RHF variant** — `FormField` wraps RHF `Controller` and a `useFormField` hook is exported (SC 1.2). If `add form` instead emits the non-RHF `Field` system, fall back to building the field layer directly on react-hook-form's `<Controller>` inside the `useZodForm`/`IconField` seam (change #4/#5 already isolates the field internals), or pull the classic `form` registry item explicitly. Do not proceed to Phase 3 with the wrong variant.

#### 3. Shared API response contract types

**File**: `src/types.ts` (currently empty)

**Intent**: Define the JSON shape every form-backed endpoint returns and every form consumes, so client/server agree on success, redirect, field errors, and general message.

**Contract**: Export `FieldErrors<T>` (a partial map of field name → message string) and a discriminated `ApiResult` union — success `{ ok: true; redirect?: string }` and failure `{ ok: false; message?: string; fieldErrors?: FieldErrors }`. Field-error keys are plain strings matching RHF field names.

#### 4. Reusable form layer (`useZodForm` + `submitJson`)

**File**: `src/components/hooks/useZodForm.ts` and `src/lib/submitJson.ts`

**Intent**: Collapse the boilerplate so a new form is "schema in, typed form out" and "post JSON, get a typed `ApiResult` back." `useZodForm(schema, defaults)` wraps `useForm({ resolver: zodResolver(schema), defaultValues })` with inferred types. `submitJson(url, data)` POSTs JSON and parses the `ApiResult`, throwing only on network/non-JSON faults (so the caller can toast).

**Contract**:

- `useZodForm` lives in `src/components/hooks/` (per `src/components/CLAUDE.md`), imports `zod`, `react-hook-form`, `@hookform/resolvers/zod`; returns the `UseFormReturn` typed via `z.infer`.
- `submitJson` lives in `src/lib/` (client-safe, no server imports); signature `submitJson<T>(url: string, data: T): Promise<ApiResult>`; resolves with the parsed `ApiResult` for 200 and 400, rejects only on transport failure.

#### 5. Reconcile existing leaf components with shadcn `Form*`

**File**: `src/components/auth/FormField.tsx`, `src/components/auth/ServerError.tsx`, `src/components/auth/SubmitButton.tsx`, `src/components/auth/PasswordToggle.tsx`

**Intent**: Eliminate the duplicate field idiom. The custom controlled `FormField` (value/onChange/error props) is replaced by composing shadcn `FormItem`/`FormControl`/`FormMessage` inside the RHF `FormField` `render` prop, keeping the existing visual affordances (leading icon, `endContent` for the password toggle, hint text). `SubmitButton` switches from `useFormStatus()` (native-form state) to an explicit `isSubmitting` prop (RHF `formState.isSubmitting`). `PasswordToggle` is unchanged. `ServerError` is retained for any non-field form-level message but field errors now flow through `FormMessage`.

**Contract**:

- Provide a small `IconField` (or refactored `FormField`) wrapper that renders a leading icon + `Input` + optional `endContent`, designed to be dropped inside a shadcn `FormField` `render={({ field }) => ...}` and spread `{...field}` onto the `Input`. No more `value`/`onChange`/`error` props — RHF owns those.
- `SubmitButton` new prop: `isSubmitting: boolean` (replaces `useFormStatus`). Keeps `pendingText`, `icon`, `children`.
- Decision: keep these in `src/components/auth/` for now; promote to a shared location only when a second feature needs them (avoid premature generalization).

### Success Criteria:

#### Automated Verification:

- Dependencies install cleanly: `npm install` exits 0 and `react-hook-form`, `@hookform/resolvers`, `zod` appear in `package.json`.
- `src/components/ui/form.tsx` exists and exports `Form`, `FormField`, `FormItem`, `FormControl`, `FormMessage`.
- Type checking passes: `npx astro check` reports no errors.
- Linting passes: `npm run lint`.
- Build succeeds: `npm run build`.

#### Manual Verification:

- The reconciled `IconField`/`FormField` renders identically (leading icon, password toggle, hint) when mounted in a throwaway story or the existing page.
- No uncontrolled→controlled React warning appears in the browser console for the foundation field.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 2.

---

## Phase 2: Shared Schemas & JSON API Contract

### Overview

Author the canonical Zod schemas (one source of truth) and rewrite the two auth API routes to validate with `safeParse` and return the structured JSON contract instead of redirecting.

### Changes Required:

#### 1. Shared auth schemas

**File**: `src/lib/validation/auth.ts`

**Intent**: Define `signInSchema` and `signUpSchema` once, imported by both client (`zodResolver`) and server (`safeParse`). The sign-up schema includes the `confirmPassword`-match rule for the client; the server payload schema validates only the fields the server needs.

**Contract**:

- `signInSchema`: `{ email: z.email(), password: z.string().min(1) }`. Use the Zod v4 top-level `z.email()` — the string-level `z.string().email()` is deprecated in v4 and may trip the type-checked eslint rules.
- `signUpSchema`: extends sign-in with `password: z.string().min(6)` and `confirmPassword`, plus a `.refine()` enforcing `password === confirmPassword` with error path `["confirmPassword"]`.
- Export inferred types (`SignInInput`, `SignUpInput`).
- The server route may use `signUpSchema.pick({ email: true, password: true })` (or a dedicated server schema) so `confirmPassword` is not required server-side. **Pure module: imports only `zod`.**
- Email regex/length rules match or tighten the current inline checks (current min password = 6).

#### 2. Rewrite sign-in API route

**File**: `src/pages/api/auth/signin.ts`

**Intent**: Parse JSON body, `safeParse` with the shared schema, return `400` + `fieldErrors` on validation failure, call Supabase, return `400` + `message` on auth failure, and return `200 { ok: true, redirect: "/recipes" }` on success. Keep `export const prerender = false`.

**Contract**: Reads `await request.json()` (was `formData()`); returns `Response`/`Astro` JSON with the `ApiResult` shape from `src/types.ts`; maps Supabase error to `{ ok:false, message }` (not a field error); preserves the "Supabase not configured" guard as `{ ok:false, message }`. Status codes: 200 success, 400 validation/auth failure.

**fieldErrors shape**: `safeParse(...).error.flatten().fieldErrors` yields `Record<field, string[]>`, but the `FieldErrors` contract is `field → string`. Reduce each field's array to a single message (take `[0]`) when building the response so the client's `setError(field, { message })` mapping lines up without a translation layer.

#### 3. Rewrite sign-up API route

**File**: `src/pages/api/auth/signup.ts`

**Intent**: Same JSON-contract treatment as sign-in, validating with the server-side pick of `signUpSchema`; on success return `200 { ok: true, redirect: "/auth/confirm-email" }`.

**Contract**: Mirrors signin.ts; success redirect target `/auth/confirm-email`; `confirmPassword` not required in the server payload.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`.
- Linting passes: `npm run lint`.
- Build succeeds: `npm run build`.
- Schema module imports only `zod` (grep `src/lib/validation/auth.ts` shows no `astro:env`, `@/lib/supabase`, or service imports).

#### Manual Verification:

- `POST /api/auth/signin` with an invalid email body returns `400` with `fieldErrors.email`.
- `POST /api/auth/signin` with valid-but-wrong credentials returns `400` with a `message` (not a field error).
- `POST /api/auth/signup` with mismatched passwords is rejected (client) and, if forced, the server rejects missing/invalid fields.
- A successful sign-in returns `200 { ok:true, redirect:"/recipes" }`.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 3.

---

## Phase 3: Migrate Auth Forms & Future-Form Guide

### Overview

Rebuild `SignInForm` and `SignUpForm` on the new stack and write the guide that proves the foundation fits S-01/S-02 forms.

### Changes Required:

#### 1. Migrate `SignInForm`

**File**: `src/components/auth/SignInForm.tsx`

**Intent**: Replace `useState`/manual-validate with `useZodForm(signInSchema, { email: "", password: "" })`, render fields via shadcn `Form` + `FormField` + the reconciled `IconField`, submit through `submitJson("/api/auth/signin", data)`. On `{ ok:false, fieldErrors }` call `form.setError` per field; on `{ ok:false, message }` show `ServerError` (or a form-level message); on transport error fire a `sonner` toast; on `{ ok:true }` set `window.location.href = redirect`.

**Contract**: `export default`; keeps the `serverError?` prop only if still needed for first-paint SSR messaging (otherwise drop it since errors now arrive via fetch). Submit button driven by `formState.isSubmitting`. Password visibility toggle preserved via `endContent`.

#### 2. Migrate `SignUpForm`

**File**: `src/components/auth/SignUpForm.tsx`

**Intent**: Same migration with `signUpSchema`; `confirmPassword` validated client-side via the schema `.refine()`; the "characters needed" hint reads `form.watch("password")` instead of local state.

**Contract**: `export default`; three fields (`email`, `password`, `confirmPassword`); `confirmPassword` not sent to the server; success navigates to the `redirect` returned by the API (`/auth/confirm-email`).

#### 3. Update auth pages

**File**: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`

**Intent**: Since server errors now arrive via fetch JSON, the `?error=` query-param readback is obsolete. Decide whether to keep passing `serverError` (for any legacy/SSR-redirect path) or remove it. Default: remove the `?error=` read and the `serverError` prop unless a first-paint SSR message is still desired.

**Contract**: Island still mounted with `client:load`. If `serverError` is dropped, remove the `Astro.url.searchParams.get("error")` line and the prop.

#### 4. Mount `<Toaster/>` on the auth pages

**File**: `src/layouts/PublicLayout.astro`

**Intent**: The transport-fault toast path (Phase 3 #1/#2) requires a `sonner` `<Toaster/>` in the page tree. Today it lives only in `AppLayout.astro`; the auth pages use `PublicLayout.astro`, which has none — so toasts would silently no-op. Mount it so error toasts render on `/auth/signin` and `/auth/signup`.

**Contract**: Add `<Toaster client:load />` (imported from `@/components/ui/sonner`) to `PublicLayout.astro`, mirroring the `AppLayout.astro:26` usage. (If a shared base layout is later introduced, the Toaster belongs there instead — out of scope now.)

#### 5. "How to add a new form" guide

**File**: `docs/reference/forms.md` (new file; `docs/` does not exist yet — create it, consistent with the `docs/reference/` convention CLAUDE.md already references)

**Intent**: Document the standard so future forms (and agents) follow it without rediscovery, and explicitly show the two future shapes: file upload and dynamic array.

**Contract**: Covers (a) define a Zod schema in `src/lib/validation/`, (b) `useZodForm` + shadcn `Form`/`FormField`, (c) `submitJson` + `ApiResult` handling (fieldErrors → `setError`, message → form error, transport → toast), (d) the API-route `safeParse` template, (e) a short note that file inputs use `z.instanceof(File)` / `FileList` validation and multi-row inputs use RHF `useFieldArray` — demonstrating the foundation fits S-01 (upload + items list) and S-02 (textarea) without redesign. No new components shipped — guidance only.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`.
- Linting passes: `npm run lint`.
- Build succeeds: `npm run build`.
- No native-form artifacts remain: grep `src/components/auth/*.tsx` shows no `useFormStatus`, no `method="POST"` form action, no manual `validate()`.

#### Manual Verification:

- Sign-in: empty submit shows inline "required" errors; invalid email shows inline email error; valid+wrong credentials shows the server message; valid+correct redirects to `/recipes`.
- After a successful sign-in the `/recipes` landing is **authenticated** — middleware does not bounce back to `/auth/signin` (confirms the auth cookie was set on the JSON response and persisted by the browser before navigation).
- Sign-up: mismatched passwords shows inline `confirmPassword` error; the "N more characters" hint updates as you type; success redirects to `/auth/confirm-email`.
- Killing the API (or offline) on submit raises a `sonner` toast **that is visible on the auth page** (confirms `<Toaster/>` is mounted in `PublicLayout`) rather than a silent failure.
- Submit button shows the pending spinner/text while `isSubmitting` and is disabled.
- No uncontrolled→controlled console warnings.

**Implementation Note**: After completing this phase and all automated verification passes, pause for final manual confirmation from the human.

---

## Testing Strategy

### Unit Tests:

- None added this change (no test runner — see "What We're NOT Doing"). The shared Zod schemas are the natural first unit-test target if/when Vitest is introduced.

### Integration Tests:

- None automated. The manual checklist below stands in.

### Manual Testing Steps:

1. `npm run dev`, open `/auth/signin`. Submit empty → inline required errors on both fields.
2. Enter `not-an-email` → inline email format error.
3. Enter a valid email + wrong password → server `message` surfaces (form-level), not a field error.
4. Enter valid credentials → redirect to `/recipes`.
5. Open `/auth/signup`. Enter mismatched passwords → inline `confirmPassword` error. Type a short password → "N more characters" hint counts down.
6. Complete a valid sign-up → redirect to `/auth/confirm-email`.
7. Stop the dev server mid-submit (or go offline) → `sonner` toast appears.
8. Throughout: confirm no uncontrolled→controlled warnings and the submit button disables + shows pending state.

## Performance Considerations

Negligible. RHF is uncontrolled-first (fewer re-renders than the current per-keystroke `useState`). Adds `react-hook-form` + `zod` to the auth island bundle only (these pages are already `client:load` islands). Zod schemas are tiny.

## Migration Notes

- Submission model changes from native POST+redirect to client fetch+JSON. There is no DB migration. The only externally visible behavior change: forms now require JavaScript (no-JS fallback removed) and server errors render inline/as toast instead of via a full-page reload with `?error=`.
- API routes change their response contract (JSON instead of redirect). `signout.ts` is intentionally untouched and still redirects.

## References

- Roadmap: `context/foundation/roadmap.md` (S-01 upload + items list, S-02 meal-context — the future forms this foundation serves)
- Current forms: `src/components/auth/SignInForm.tsx`, `src/components/auth/SignUpForm.tsx`
- Current API: `src/pages/api/auth/signin.ts`, `src/pages/api/auth/signup.ts`
- Component rules: `src/components/CLAUDE.md` (extend shadcn primitives; server-import boundary; hooks location)
- shadcn `form`: generated `src/components/ui/form.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Form Foundation & Dependencies

#### Automated

- [x] 1.1 Dependencies install cleanly: `npm install` exits 0 with react-hook-form, @hookform/resolvers, zod in package.json — 5d71f9c
- [x] 1.2 `src/components/ui/form.tsx` exists and exports Form, FormField, FormItem, FormControl, FormMessage — 5d71f9c
- [x] 1.3 Type checking passes: `npx astro check` — 5d71f9c
- [x] 1.4 Linting passes: `npm run lint` — 5d71f9c
- [x] 1.5 Build succeeds: `npm run build` — 5d71f9c

#### Manual

- [x] 1.6 Reconciled IconField/FormField renders identically (icon, password toggle, hint) — 5d71f9c
- [x] 1.7 No uncontrolled→controlled React warning for the foundation field — 5d71f9c

### Phase 2: Shared Schemas & JSON API Contract

#### Automated

- [x] 2.1 Type checking passes: `npx astro check` — 920f7cf
- [x] 2.2 Linting passes: `npm run lint` — 920f7cf
- [x] 2.3 Build succeeds: `npm run build` — 920f7cf
- [x] 2.4 Schema module imports only `zod` (no astro:env / supabase / service imports) — 920f7cf

#### Manual

- [x] 2.5 POST /api/auth/signin invalid email → 400 with fieldErrors.email — 920f7cf
- [x] 2.6 POST /api/auth/signin valid-but-wrong credentials → 400 with message (not field error) — 920f7cf
- [x] 2.7 POST /api/auth/signup mismatched passwords rejected; server rejects missing/invalid fields — 920f7cf
- [x] 2.8 Successful sign-in → 200 { ok:true, redirect:"/recipes" } — 920f7cf

### Phase 3: Migrate Auth Forms & Future-Form Guide

#### Automated

- [x] 3.1 Type checking passes: `npx astro check`
- [x] 3.2 Linting passes: `npm run lint`
- [x] 3.3 Build succeeds: `npm run build`
- [x] 3.4 No native-form artifacts in src/components/auth/\*.tsx (no useFormStatus, no method="POST" action, no manual validate())

#### Manual

- [ ] 3.5 Sign-in: empty/invalid/wrong-creds/valid behaviors all correct
- [ ] 3.6 Successful sign-in lands authenticated on /recipes (middleware does not bounce to /auth/signin — auth cookie persisted across fetch→navigation)
- [ ] 3.7 Sign-up: confirmPassword mismatch error, char-count hint, success redirect to /auth/confirm-email
- [ ] 3.8 API offline/killed on submit → sonner toast visible on the auth page (Toaster mounted in PublicLayout; no silent failure)
- [ ] 3.9 Submit button shows pending state and disables while isSubmitting
- [ ] 3.10 No uncontrolled→controlled console warnings
