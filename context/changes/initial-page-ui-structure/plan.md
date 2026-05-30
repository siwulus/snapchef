# Initial Page UI Structure Implementation Plan

## Overview

Replace the "cosmic" Astro-starter scaffold with the project's real design system and the page/layout
structure locked in `context/foundation/ui-architecture.md`. This is a **cleanup + restructure** pass:
strip the starter chrome, stand up the two token-based layout shells and the toast mechanism, rebuild
the landing and auth surfaces on shadcn primitives + design tokens, and wire `/recipes` as an empty
authenticated-home placeholder with corrected route protection.

No feature slices (S-01–S-04) and **no F-02 email-verification gate** are built here — those are
separate changes. This change only delivers the shared structure they will plug into.

## Current State Analysis

- **The real design system already exists in code** (`src/styles/global.css` + `src/components/ui/button.tsx`):
  shadcn `radix-lyra` style, neutral **oklch** tokens, **JetBrains Mono** as the global font
  (`--font-mono`, `--font-heading`), `rounded-none` buttons, a light `:root` and a `.dark` variant.
  `global.css:120` also defines a scaffold-only `@utility bg-cosmic` (dark gradient) — not part of the product theme.
- **The scaffold ignores the design system.** `Welcome.astro`, `dashboard.astro`, the three auth pages,
  and `Topbar.astro` hardcode a purple/blue glassmorphism look (`bg-cosmic`, `bg-white/10 backdrop-blur-xl`,
  `text-blue-100/80`, `bg-purple-600`, gradient `bg-clip-text` headings) — none use the tokens or shadcn primitives.
- **Auth forms work but are off-spec.** `src/components/auth/*` (`SignInForm`, `SignUpForm`, `FormField`,
  `SubmitButton`, `ServerError`, `PasswordToggle`) have working client validation + `useFormStatus` + native
  `<form method="POST">` → `/api/auth/*`, but hardcode cosmic colors and use raw `<input>` instead of shadcn
  `Input`/`Label`. `SubmitButton` overrides the shadcn `Button` with custom purple classes.
- **One layout today.** `src/layouts/Layout.astro` is imported by all five pages; the architecture wants a
  minimal **`PublicLayout`** (`/`, `/auth/*`) and an **`AppLayout`** (`/recipes*`, with top bar + toast slot).
  `Layout.astro` also renders the config-status `Banner`.
- **Middleware** (`src/middleware.ts`) protects only `/dashboard`; architecture wants `/recipes`. API routes:
  `signin` → `/`, `signout` → `/`, `signup` → `/auth/confirm-email`.
- **`sonner` is not installed**; `src/components/ui/` has only `button.tsx` (+ scaffold `LibBadge.astro`).
- **Config-status Banner**: `Banner.astro` (inline `<style>` custom CSS) + `src/lib/config-status.ts`
  (`missingConfigs`), rendered in `Layout.astro`. The owner chose to **remove it entirely**.

### Key Discoveries:

- Design tokens & font are already wired in `src/styles/global.css` — restyling = using token utility classes
  (`bg-background`, `text-foreground`, `bg-primary`, `text-muted-foreground`, `border-border`, etc.), not inventing CSS.
- `npx ripgrep` confirms cleanup is safe: `LibBadge` has **zero** references; `phosphor` has **zero** code
  references (only `components.json`, already updated to `lucide`); `bg-cosmic` is used only by files being
  deleted/repointed; `layouts/Layout.astro` is imported by exactly the five pages this plan rewrites.
- `src/lib/config-status.ts` is cited as a teaching example in `src/lib/CLAUDE.md` (5 places) — deleting the
  module requires updating that doc to avoid dangling references.
- `src/components/CLAUDE.md` cites `Topbar.astro` as the canonical `.astro` example — **keep and rework**
  `Topbar.astro` (don't delete it) so the reference stays valid and the architecture's "rework Topbar into the
  AppLayout top bar" instruction is honored.
- `components.json` `iconLibrary` is now `lucide` (updated during planning), matching the auth components' actual imports.

## Desired End State

- The app builds, type-checks, and lints clean with **no `bg-cosmic`, no cosmic color classes, and no
  starter copy** anywhere. The default theme is **light**, driven by the shipped `:root` tokens.
- `/` is a basic Snapchef landing (product name + tagline + Sign in / Sign up CTAs + 2–3 token `Card`
  value props) on `PublicLayout`.
- `/auth/signin`, `/auth/signup`, `/auth/confirm-email` render on `PublicLayout` using shadcn `Input`/`Label`/
  `Button` and design tokens; client validation and native-POST auth still work end-to-end.
- `/recipes` exists as a minimal authenticated-home placeholder on `AppLayout` (top bar + sonner `Toaster` slot).
- `/dashboard` is gone (404). `PROTECTED_ROUTES = ["/recipes"]`; anonymous access to `/recipes*` redirects to
  `/auth/signin`; a successful sign-in lands on `/recipes`.
- The toast mechanism is installed (`sonner` `Toaster` in `AppLayout` + a thin `toast` helper); no triggers
  yet — feature slices fire them later.

**Verification:** `npm run build` + `npm run lint` pass; manual click-through of landing → signup → confirm
→ signin → `/recipes`; anonymous `/recipes` redirect; `/dashboard` 404; `rg "bg-cosmic|text-blue-100|bg-purple-6|backdrop-blur" src` returns nothing.

## What We're NOT Doing

- **No F-02**: no email-verification / verified-only tier, no "account inactive" gate, no signed-in→`/recipes`
  redirects from `/auth/*` or `/`. Architecture §5 explicitly defers these to the `email-verification-gating` change.
- **No feature slices**: no upload, no recipe wizard (`/recipes/new`), no recipe detail (`/recipes/[id]`), no
  saved-recipes list logic. `/recipes` is a static placeholder only.
- **No new feature components** (`src/components/recipes/`), **no `textarea`/`dialog`/`progress` primitives** —
  those belong to S-01–S-04.
- **No react-hook-form / shadcn `form` primitive** — see Critical Implementation Details.
- **No toast triggers / no `?toast=` server→toast bridge** — only the mechanism is installed.
- **No theme toggle / system-preference wiring** — light is the fixed default for MVP.

## Implementation Approach

Three phases ordered so the build stays green after each:

1. **Foundation first** — add the primitives and both layout shells alongside the existing `Layout.astro`
   (which the pages still import), so nothing breaks while the new shells are created.
2. **Migrate the public surface and delete scaffold** — repoint all public pages to `PublicLayout`, rebuild
   auth on primitives, then delete `Welcome`/`Banner`/`LibBadge`/`config-status`/old `Layout` once nothing
   imports them, and prune the now-dead dep + utility.
3. **Authed home + protection** — add `/recipes`, delete `/dashboard`, flip middleware and the sign-in redirect.

Restyling = swapping hardcoded cosmic classes for token utility classes (`bg-background`, `text-foreground`,
`bg-primary`, `text-muted-foreground`, `border-border`, `text-destructive`, …) and composing shadcn primitives.

## Critical Implementation Details

- **Keep the native-POST auth form; do NOT add shadcn `form`.** The auth flow relies on
  `<form method="POST" action="/api/auth/*">` with server-side redirect responses and React `useFormStatus`
  for the pending state — a progressive-enhancement pattern that works under Astro SSR. shadcn's `form`
  primitive is built around react-hook-form's client-side `useForm`/`handleSubmit` and does not drive native
  navigation. Rebuild `FormField` on shadcn `Input` + `Label` only; keep the existing form element, manual
  `validate()` logic, and `useFormStatus`-based `SubmitButton`.
- **`AppLayout` toast slot must be an island.** `sonner`'s `<Toaster />` is a React client component; mount it
  in `AppLayout.astro` with `client:load` (it owns no SSR markup). Place exactly one slot, per architecture §4.
- **Light theme = do nothing extra.** The shipped `:root` is already light; simply removing the `bg-cosmic`
  wrappers and not adding a `dark` class on `<html>` yields the light token theme. Do not add a theme script.
- **Delete order matters.** Remove every importer of a scaffold file before deleting it (repoint pages →
  delete `Layout.astro`; rebuild landing → delete `Welcome.astro`; remove Banner usage → delete `Banner.astro`
  - `config-status.ts`). Otherwise the build breaks mid-phase.

## Phase 1: Design-System Foundation (primitives, layouts, top bar, toasts)

### Overview

Add the shadcn primitives this change needs, create both token-based layout shells, rework `Topbar` into the
`AppLayout` top bar, and install the toast mechanism. The old `Layout.astro` stays in place (pages still import
it) so the build remains green.

### Changes Required:

#### 1. shadcn primitives

**File**: `src/components/ui/input.tsx`, `src/components/ui/label.tsx`, `src/components/ui/card.tsx`, `src/components/ui/sonner.tsx` (generated)

**Intent**: Add the primitives required by this change's surfaces — `input` + `label` for auth, `card` for
landing value props and the `/recipes` placeholder, `sonner` for the toast slot.

**Contract**: Add via `npx shadcn@latest add input label card sonner` (uses `components.json` → `radix-lyra`,
`lucide`). Do **not** add `form`, `textarea`, `dialog`, or `progress`. Confirm `sonner` is added to
`package.json` by the CLI.

#### 2. PublicLayout

**File**: `src/layouts/PublicLayout.astro` (new)

**Intent**: Minimal shell for `/` and `/auth/*` — token base, light theme, JetBrains Mono, no authed nav.

**Contract**: `Props { title?: string }`. Renders `<!doctype html>` + `<head>` (charset, viewport, favicon,
`<title>`) and a `<body>` using token classes (`bg-background text-foreground`, font already global via
`html { @apply font-mono }`). Imports `../styles/global.css`. Single `<slot />` for page content. No `Banner`,
no `bg-cosmic`, no inline `<style>` color overrides.

#### 3. Topbar (reworked)

**File**: `src/components/Topbar.astro`

**Intent**: Convert the cosmic, dual-state starter top bar into the token-styled `AppLayout` top bar: app
name links to `/recipes`; account area shows the signed-in email + a **Sign out** button (POST
`/api/auth/signout`).

**Contract**: Reads `Astro.locals.user`. Rendered only inside `AppLayout` (authed context) — drop the
"Not signed in" branch and the "Dashboard" link. Use token classes (`border-border`, `bg-background`/`bg-card`,
`text-foreground`, `text-muted-foreground`) and the shadcn `Button` for Sign out. Mobile-first compact bar
(architecture §3c) — no bottom tab bar.

#### 4. AppLayout

**File**: `src/layouts/AppLayout.astro` (new)

**Intent**: Shell for `/recipes*` — wraps the top bar, the global toast slot, and the main content region.

**Contract**: `Props { title?: string }`. Same `<head>` baseline as `PublicLayout`. `<body>` renders
`<Topbar />`, a `<main>` with `<slot />`, and the sonner `<Toaster client:load />` slot. Token classes only.

#### 5. Toast helper

**File**: `src/lib/toast.ts` (new) — or re-export from the generated `sonner` module

**Intent**: Provide a single import surface for firing toasts so feature slices don't import `sonner` directly all over.

**Contract**: Thin re-export of `toast` from `sonner`. No triggers wired in this change. (If a client-only
helper is preferred over `src/lib/`, place it under `src/components/` per `src/lib/CLAUDE.md`'s "never import
`src/lib/` into `.tsx`" rule — `sonner`'s `toast` is client-side, so prefer a `src/components/` location or
import `sonner` directly in islands.)

### Success Criteria:

#### Automated Verification:

- [ ] Primitives exist: `input.tsx`, `label.tsx`, `card.tsx`, `sonner.tsx` under `src/components/ui/`
- [ ] `sonner` present in `package.json`
- [ ] Type checking passes: `npm run build` (Astro `astro check`/build) or `npx tsc --noEmit`
- [ ] Linting passes: `npm run lint`

#### Manual Verification:

- [ ] `PublicLayout` and `AppLayout` render with light token theme (no cosmic background) in `npm run dev`
- [ ] `AppLayout` top bar shows app name → `/recipes` and Sign out; sonner `Toaster` mounts without console errors

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation
before proceeding to Phase 2.

---

## Phase 2: Public Surface + Scaffold Deletion (landing, auth restyle, cleanup)

### Overview

Rebuild the landing page and migrate/destyle the three auth pages onto `PublicLayout`, rebuild the auth
components on shadcn primitives, then delete the now-unused scaffold and prune the dead dependency, utility,
and doc references.

### Changes Required:

#### 1. Landing page

**File**: `src/pages/index.astro`

**Intent**: Replace the `Welcome` cosmic hero with a basic Snapchef landing on `PublicLayout`: product name +
one-line tagline + Sign in / Sign up CTAs, plus a row of 2–3 token `Card` value props explaining the product.

**Contract**: Imports `PublicLayout` (not `Layout`). Uses shadcn `Button` (via `asChild` anchors or styled
`<a>`) for CTAs to `/auth/signin` and `/auth/signup`, and `Card` for value props. Token classes only;
mobile-first single column. No `bg-cosmic`, no gradient `bg-clip-text`, no SVG starter icons.

#### 2. Auth pages

**File**: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`, `src/pages/auth/confirm-email.astro`

**Intent**: Repoint to `PublicLayout`; strip the `bg-cosmic` wrapper, glass card, and gradient headings; render
the (restyled) forms on a token-based centered card. Keep `confirm-email`'s DEV-auto-confirm vs prod branch
(F-02 revalidates the real flow later).

**Contract**: Each page imports `PublicLayout`. Centered container uses token classes
(`bg-card`/`bg-background`, `border-border`, `text-foreground`). Headings use `text-foreground` (no
`bg-clip-text` gradient). `signin`/`signup` still pass `serverError={error}` from `Astro.url.searchParams` to
the form islands. Cross-links (`Sign up`/`Sign in`) use token link styling.

#### 3. Auth components rebuilt on primitives

**File**: `src/components/auth/FormField.tsx`, `SubmitButton.tsx`, `ServerError.tsx`, `PasswordToggle.tsx`, `SignInForm.tsx`, `SignUpForm.tsx`

**Intent**: Remove all hardcoded cosmic colors and raw inputs; compose shadcn `Input` + `Label` in `FormField`;
make `SubmitButton` use the shadcn `Button` (drop the custom purple classes, keep `useFormStatus` pending
state); restyle `ServerError` with `text-destructive`/`border-destructive` tokens and `PasswordToggle` with
`text-muted-foreground`. Keep the native `<form method="POST">`, the `validate()` logic, and lucide icons.

**Contract**: `FormField` renders shadcn `<Label htmlFor>` + `<Input>` (preserving `id`/`name`/`type`/`value`/
`onChange`/`placeholder`/`error`/`hint`/`icon`/`endContent` props and the `error`-vs-`hint` display), using
`aria-invalid` + token classes for the error state instead of `border-red-400`. `SubmitButton` keeps its
`pendingText`/`icon`/`children` props and the spinner-while-pending behavior, rendered through `Button`
(`variant="default"`, `className="w-full"`). `SignInForm`/`SignUpForm` keep their existing `action`, validation,
and field structure — only styling/primitive usage changes. **Do not introduce react-hook-form / shadcn `form`**
(see Critical Implementation Details).

#### 4. Remove config-status Banner

**File**: delete `src/components/Banner.astro`, delete `src/lib/config-status.ts`

**Intent**: Remove the starter "Supabase not configured" banner entirely (owner decision). Its only renderer
was `Layout.astro`, which is removed in this phase.

**Contract**: No remaining imports of `Banner` or `config-status`/`missingConfigs` (verify with `rg`).

#### 5. Update `src/lib/CLAUDE.md`

**File**: `src/lib/CLAUDE.md`

**Intent**: `config-status.ts` is deleted but cited as an example in 5 places — update the doc so references
don't dangle.

**Contract**: Replace `config-status.ts` example citations with surviving modules (`supabase.ts`, `utils.ts`).
Preserve the doc's rules (named exports, server-only, kebab-case, Polish strings, `interface` for shapes) — only
swap the example file. Note: the "user-facing strings stay in Polish" rule loses its only live example; keep the
rule, drop the dead line reference.

#### 6. Delete scaffold + old layout

**File**: delete `src/components/Welcome.astro`, `src/components/ui/LibBadge.astro`, `src/layouts/Layout.astro`

**Intent**: Remove starter components and the old single layout now that all pages import `PublicLayout`/`AppLayout`.

**Contract**: Delete only after `rg` confirms no importers remain. `Welcome` (after #1), `LibBadge` (already
orphaned), `Layout.astro` (after auth pages + landing repointed; `/recipes` in Phase 3 uses `AppLayout`).

#### 7. Prune dead dependency + utility

**File**: `package.json`, `src/styles/global.css`

**Intent**: Remove the unused `@phosphor-icons/react` dependency (zero code references; `components.json` now
uses `lucide`) and the scaffold-only `@utility bg-cosmic` (no remaining users after this phase).

**Contract**: Drop `@phosphor-icons/react` from `package.json` `dependencies` and refresh the lockfile
(`npm install`). Remove the `@utility bg-cosmic { … }` block from `global.css`. Leave all `:root`/`.dark`
tokens, `@theme inline`, and the JetBrains Mono `@layer base` rules untouched.

### Success Criteria:

#### Automated Verification:

- [ ] No cosmic styling remains: `rg "bg-cosmic|text-blue-100|bg-purple-6|backdrop-blur|bg-clip-text" src` returns nothing
- [ ] No dangling imports: `rg "Welcome|Banner|LibBadge|config-status|layouts/Layout|phosphor" src` returns only doc/comment-free results (none in `.astro`/`.ts`/`.tsx`)
- [ ] Deleted files absent: `Welcome.astro`, `Banner.astro`, `LibBadge.astro`, `config-status.ts`, `layouts/Layout.astro`
- [ ] `@phosphor-icons/react` not in `package.json`; `@utility bg-cosmic` not in `global.css`
- [ ] Type checking passes (`npm run build` / `npx tsc --noEmit`); Linting passes (`npm run lint`)

#### Manual Verification:

- [ ] `/` landing renders on light token theme with working Sign in / Sign up CTAs and value-prop cards
- [ ] `/auth/signin`, `/auth/signup`, `/auth/confirm-email` render token-styled; forms use shadcn Input/Label/Button
- [ ] Sign-up → confirm-email → sign-in flow works end-to-end; client validation + server error display still function
- [ ] No visual cosmic remnants; no console errors

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation
before proceeding to Phase 3.

---

## Phase 3: Authenticated Home + Route Protection

### Overview

Add the `/recipes` placeholder on `AppLayout`, delete `/dashboard`, and correct route protection + the sign-in
redirect target.

### Changes Required:

#### 1. `/recipes` placeholder

**File**: `src/pages/recipes/index.astro` (new)

**Intent**: Minimal authenticated-home placeholder — proves `AppLayout` + protection end-to-end without
building the S-04 list. Simple heading + placeholder copy (a token `Card` is fine); keep it intentionally empty.

**Contract**: Imports `AppLayout`. Reads `Astro.locals.user` if needed for a greeting. No recipe data, no
queries. Directory form `recipes/index.astro` to leave room for future `/recipes/new` and `/recipes/[id]`.

#### 2. Delete dashboard

**File**: delete `src/pages/dashboard.astro`

**Intent**: Superseded by `/recipes` (architecture §2, §7).

**Contract**: Removed; `rg "dashboard" src` returns no route/link references.

#### 3. Middleware protection

**File**: `src/middleware.ts`

**Intent**: Protect the app routes instead of the retired dashboard.

**Contract**: `PROTECTED_ROUTES = ["/recipes"]` (covers `/recipes`, `/recipes/new`, `/recipes/[id]` via the
existing `startsWith` prefix check). Keep the session-only behavior (anonymous → `/auth/signin`). **Do not** add
the email-verified check or signed-in redirects — those are F-02.

#### 4. Sign-in redirect target

**File**: `src/pages/api/auth/signin.ts`

**Intent**: Land a signed-in user on the authenticated home.

**Contract**: On success, `context.redirect("/recipes")` (was `/`). Leave `signout` → `/` and `signup` →
`/auth/confirm-email` unchanged.

### Success Criteria:

#### Automated Verification:

- [ ] `src/pages/recipes/index.astro` exists; `src/pages/dashboard.astro` deleted
- [ ] `PROTECTED_ROUTES` equals `["/recipes"]` in `src/middleware.ts`
- [ ] `signin.ts` redirects to `/recipes` on success
- [ ] Type checking passes (`npm run build` / `npx tsc --noEmit`); Linting passes (`npm run lint`)

#### Manual Verification:

- [ ] Anonymous visit to `/recipes` redirects to `/auth/signin`
- [ ] After successful sign-in, user lands on `/recipes` (placeholder renders on `AppLayout` with top bar + Sign out)
- [ ] `/dashboard` returns 404
- [ ] Sign out from `/recipes` returns to `/` landing

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation.
This completes the change.

---

## Testing Strategy

### Unit Tests:

- No unit-test harness exists in this repo (no test runner in `package.json`). This change adds none — it is
  structure/styling. Verification is build + lint + manual click-through.

### Integration Tests:

- N/A for this change (no test infrastructure). Covered by the manual flow below.

### Manual Testing Steps:

1. `npm run dev`; load `/` — light theme, Snapchef name/tagline, Sign in / Sign up CTAs, value-prop cards.
2. Click **Sign up** → fill the form (client validation: invalid email, short password, mismatch) → submit →
   `/auth/confirm-email` renders the DEV/prod branch correctly.
3. **Sign in** with valid credentials → lands on `/recipes` placeholder on `AppLayout` (top bar shows email + Sign out).
4. **Sign out** → returns to `/` landing.
5. While signed out, visit `/recipes` directly → redirected to `/auth/signin`.
6. Visit `/dashboard` → 404.
7. Confirm no console errors and no cosmic/glassmorphism remnants on any page.

## Performance Considerations

- Bundle stays minimal: only the shadcn primitives actually used (`input`, `label`, `card`, `sonner`) are
  added; the unused `@phosphor-icons/react` dep is removed. The sole island on authed pages is the sonner
  `Toaster` (`client:load`) plus the existing auth-form islands. Landing and `/recipes` are otherwise static.

## Migration Notes

- No data/schema changes — this is UI structure only; no Supabase migration.
- `/dashboard` is removed; any bookmark to it 404s (acceptable — it was starter scaffold, never a product route).

## References

- UI architecture (source of truth): `context/foundation/ui-architecture.md` (§2 page inventory, §4 layouts/toasts,
  §5 protection, §6 component placement, §7 cleanup)
- Roadmap: `context/foundation/roadmap.md` (F-02 = separate `email-verification-gating` change; S-01–S-04 feature slices)
- Design system: `src/styles/global.css`, `src/components/ui/button.tsx`
- Auth flow today: `src/pages/api/auth/*.ts`, `src/components/auth/*`, `src/middleware.ts`
- Repo conventions: `src/components/CLAUDE.md`, `src/lib/CLAUDE.md`, root `CLAUDE.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Design-System Foundation

#### Automated

- [x] 1.1 Primitives exist: `input.tsx`, `label.tsx`, `card.tsx`, `sonner.tsx` under `src/components/ui/` — c417e7a
- [x] 1.2 `sonner` present in `package.json` — c417e7a
- [x] 1.3 Type checking passes (`npm run build` / `npx tsc --noEmit`) — c417e7a
- [x] 1.4 Linting passes (`npm run lint`) — c417e7a

#### Manual

- [ ] 1.5 `PublicLayout` and `AppLayout` render with light token theme (no cosmic background)
- [ ] 1.6 `AppLayout` top bar shows app name → `/recipes` + Sign out; sonner `Toaster` mounts without console errors

### Phase 2: Public Surface + Scaffold Deletion

#### Automated

- [x] 2.1 `rg "bg-cosmic|text-blue-100|bg-purple-6|backdrop-blur|bg-clip-text" src` returns nothing — 450908b
- [x] 2.2 No dangling imports of `Welcome`/`Banner`/`LibBadge`/`config-status`/`layouts/Layout`/`phosphor` in `.astro`/`.ts`/`.tsx` — 450908b
- [x] 2.3 Deleted files absent: `Welcome.astro`, `Banner.astro`, `LibBadge.astro`, `config-status.ts`, `layouts/Layout.astro` — 450908b
- [x] 2.4 `@phosphor-icons/react` not in `package.json`; `@utility bg-cosmic` not in `global.css` — 450908b
- [x] 2.5 Type checking passes (`npm run build` / `npx tsc --noEmit`) — 450908b
- [x] 2.6 Linting passes (`npm run lint`) — 450908b

#### Manual

- [x] 2.7 `/` landing renders on light token theme with working CTAs and value-prop cards
- [x] 2.8 Auth pages render token-styled; forms use shadcn Input/Label/Button
- [x] 2.9 Sign-up → confirm-email → sign-in flow works; client validation + server error display still function
- [x] 2.10 No cosmic remnants; no console errors

### Phase 3: Authenticated Home + Route Protection

#### Automated

- [x] 3.1 `src/pages/recipes/index.astro` exists; `src/pages/dashboard.astro` deleted — 8c0eea7
- [x] 3.2 `PROTECTED_ROUTES` equals `["/recipes"]` in `src/middleware.ts` — 8c0eea7
- [x] 3.3 `signin.ts` redirects to `/recipes` on success — 8c0eea7
- [x] 3.4 Type checking passes (`npm run build` / `npx tsc --noEmit`) — 8c0eea7
- [x] 3.5 Linting passes (`npm run lint`) — 8c0eea7

#### Manual

- [x] 3.6 Anonymous visit to `/recipes` redirects to `/auth/signin` — 8c0eea7
- [x] 3.7 After sign-in, user lands on `/recipes` placeholder on `AppLayout` — 8c0eea7
- [x] 3.8 `/dashboard` returns 404 — 8c0eea7
- [x] 3.9 Sign out from `/recipes` returns to `/` landing — 8c0eea7
