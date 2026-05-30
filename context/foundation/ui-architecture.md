---
project: snapchef
updated: 2026-05-30
status: draft
derived_from: prd.md (v1), roadmap.md (v2), tech-stack.md, src/db/database.types.ts (F-01 landed)
---

# UI Architecture

> Structural map of the app: which pages exist, how the user moves between them, what chrome
> is shared, which routes are protected, and where interactivity (islands) lives. **Not** visual
> design, copy, spacing, or per-component prop contracts — those are refined per-change under
> `context/changes/<change-id>/`. Edit-in-place as slices land.

## 1. Purpose & scope

- **In scope:** page inventory, the route map, the session-wizard flow, persistent navigation,
  shared layout/chrome, route protection (incl. the F-02 verified-only tier), and the
  island-vs-static placement convention per screen.
- **Out of scope:** visual/brand design, typography & spacing, final copy, per-component prop
  contracts, prompt design for the LLM calls, and the data layer (schema/RLS — see roadmap F-01).

### Decisions locked for this version (confirmed with product owner 2026-05-30)

1. **Single-route session wizard.** The whole create flow lives on one route, `/recipes/new`,
   as a client-managed multi-step island. No full-page navigation between steps.
2. **`/recipes` is the authenticated home** (= saved-recipes list). The generic starter
   `/dashboard` is **retired**. `/` is the public landing and redirects signed-in users to `/recipes`.
3. **In-memory session, no drafts.** An in-progress session is held in React state only and is
   discarded on refresh / navigation away. A browser leave-guard warns before losing unsaved work.
   Nothing persists until the explicit Save step (roadmap S-03).

## 2. Page inventory

Backbone of this doc. Access values: **public** (no session) · **protected** (valid session
required) · **verified-only** (session **and** confirmed email — gated by F-02).

| Route                 | Purpose                                                             | Access        | Slice     | Status     |
| --------------------- | ------------------------------------------------------------------- | ------------- | --------- | ---------- |
| `/`                   | Public landing — explains the product; CTAs to sign up / in         | public        | —         | reshape    |
| `/auth/signup`        | Register (email + password)                                         | public        | F-02      | revalidate |
| `/auth/signin`        | Sign in (email + password)                                          | public        | F-02      | revalidate |
| `/auth/confirm-email` | "Check your email" / activation-result screen                       | public        | F-02      | revalidate |
| `/recipes`            | **Authenticated home** — list of saved recipes + "New" CTA          | verified-only | S-04      | not built  |
| `/recipes/new`        | Session wizard: upload → review list → meal context → recipe → save | verified-only | S-01–S-03 | not built  |
| `/recipes/[id]`       | Saved recipe detail (+ delete with confirm dialog)                  | verified-only | S-04      | not built  |
| ~~`/dashboard`~~      | Generic starter placeholder — **remove**; superseded by `/recipes`  | —             | —         | to delete  |

Notes:

- The four session steps (S-01 upload+review, S-02 context+recipe, S-03 save) are **one route**
  (`/recipes/new`), not four. Steps are island state, not URLs — see §3.
- S-03 (save) is an **action** on the wizard's final step, not its own route.
- `recipe_sessions` rows are written only on save; there is no standalone "session" route or
  read-back of raw sessions in the MVP UI (the session input is shown inside the recipe detail).

## 3. Navigation model

### a) Session flow — single-route wizard (`/recipes/new`)

One React island owns the flow and its state. Steps advance in-place (no page reload):

```
Step 1  Upload        1–5 photos, ≤5 MB each → trigger recognition (~30s, FR-003/004)
Step 2  Review list   edit name/qty, delete, add manual item (FR-005)
Step 3  Meal context  single free-text field (FR-006)
Step 4  Recipe        generated recipe shown (~30s, FR-007/008) → Save or Discard (S-03)
```

- **Forward/back within the island** (Back/Next), not browser history per step. The browser URL
  stays `/recipes/new` for the whole flow.
- **State is in-memory** (photos, recognized + corrected list, context, generated recipe). Refresh
  or leaving the route discards it — a `beforeunload` leave-guard fires when unsaved progress
  exists. This matches the roadmap's in-memory-until-S-03 model; no draft persistence in MVP.
- **Long operations (recognition, generation)** each take ~30s. The step that triggers them enters
  a blocking in-step loading state with continuous progress feedback (NFR >2s). On failure the step
  shows an inline error with **Retry** — the user does not lose earlier steps.
- **On Save success** → redirect to `/recipes/[id]` (the new detail page) with a success toast.
  On **Discard** → return to `/recipes`.

### b) Persistent navigation

- **Top bar** (all verified pages): app name links to `/recipes` (home); account area shows the
  signed-in email and **Sign out**. "New recipe" is a **primary CTA on `/recipes`** and the top bar,
  not a separate nav section — there are only two real destinations (home list, new session).
- Recipe detail is reached by tapping a card in the list (`/recipes` → `/recipes/[id]`); back returns
  to the list.

### c) Mobile considerations (NFR: kitchen phone)

- Mobile-first single-column layout; no horizontal scroll; key actions reachable without zoom.
- No bottom tab bar — the destination set is too small to justify it. A compact top bar with the
  account/sign-out collapsed into a menu on narrow widths is enough.
- The upload step uses a standard file `<input>` (gallery/file picker). **No in-app camera capture**
  (PRD Non-Goal) — file upload only.

## 4. Shared chrome & layout

Two layout shells:

- **`PublicLayout`** — used by `/` and `/auth/*`. Minimal: product name, no authed nav. The current
  `Layout.astro` is the starting point but must be reshaped (drop the generic "cosmic" starter title
  and the unused branding).
- **`AppLayout`** — used by `/recipes`, `/recipes/new`, `/recipes/[id]`. Wraps the top bar + a
  toast slot + the main content region.

Global conventions:

- **Top bar:** app name → `/recipes`; signed-in email + **Sign out** (POST `/api/auth/signout`).
  The existing `Topbar.astro` is the seed — currently unused and starter-styled; rework it into the
  `AppLayout` top bar and delete the stray markup in `dashboard.astro`.
- **Loading (>2s):** every operation over ~2s shows continuous visual feedback (NFR). In the wizard
  this is the in-step blocking loader for recognition/generation; elsewhere, button spinners.
- **Toasts:** `sonner` (per tech-stack.md) for transient success/error — save succeeded, recipe
  deleted, upload rejected (too large / wrong count). One global toast slot in `AppLayout`.
- **Errors:** inline field errors on forms (auth already does this via `ServerError.tsx`); in-step
  error + Retry in the wizard; toast for transient/global failures.
- **Empty state:** `/recipes` with zero saved recipes shows an explainer + primary "Create your
  first recipe" CTA → `/recipes/new`.

## 5. Route protection rules

Current implementation (`src/middleware.ts`): `PROTECTED_ROUTES = ["/dashboard"]`; any path under a
protected prefix without a session redirects to `/auth/signin`. Flat role model — no admin/user
split (PRD §Access Control). Per-user data isolation is enforced at the data layer by RLS (roadmap
F-01), independent of these route checks.

Target rules for this architecture:

| Condition                                  | Behavior                                                       |
| ------------------------------------------ | -------------------------------------------------------------- |
| No session → protected route (`/recipes*`) | redirect to `/auth/signin`                                     |
| Session but **email unverified** → app     | block; show "konto nieaktywne / verify your email" gate (F-02) |
| Session **+ verified** → `/auth/*`         | redirect to `/recipes` (already signed in)                     |
| Session **+ verified** → `/`               | redirect to `/recipes` (landing is for anonymous visitors)     |
| Anonymous → `/`                            | render landing                                                 |

Implementation notes:

- Replace `PROTECTED_ROUTES = ["/dashboard"]` with `["/recipes"]` (covers `/recipes`, `/recipes/new`,
  `/recipes/[id]`).
- The middleware currently checks **session only**. F-02 adds the **verified-only** tier — gate on
  the user's confirmed-email status (e.g. `email_confirmed_at`), not just presence of a session. The
  "account inactive" gate screen and the signed-in/landing redirects are wired when F-02 lands.
- `/auth/confirm-email` already branches DEV auto-confirm vs prod "check your email" — revalidate it
  against the real F-02 flow.

## 6. Component placement conventions

Anchored to repo layout (CLAUDE.md / tech-stack.md): `.astro` for static/layout, `.tsx` + `client:*`
only for interactive islands. shadcn primitives in `src/components/ui/`, auth UI in
`src/components/auth/`, feature components elsewhere (e.g. `src/components/recipes/`), hooks in
`src/components/hooks/`.

| Screen / area     | Static (`.astro`)                        | Island (`.tsx` + `client:*`)                                                                  |
| ----------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| `/` landing       | whole page                               | — (links only)                                                                                |
| `/auth/*`         | page shell                               | existing auth forms (`SignInForm`, `SignUpForm`) — revalidate                                 |
| `/recipes` (list) | page shell + server-rendered card list   | per-card delete trigger + confirm dialog (small island)                                       |
| `/recipes/new`    | page shell                               | **the wizard** — one island owning upload, list editor, context, recipe, save (`client:load`) |
| `/recipes/[id]`   | page shell + server-rendered recipe body | delete button + confirm dialog                                                                |

- **Wizard island** holds all four steps and the in-memory session state. Upload widget, list
  editor (add/edit/delete rows), context textarea, recipe view, and save all live inside it.
- **Destructive delete (FR-012):** hard delete behind a shadcn **confirm `Dialog`**; success toast
  via sonner. No soft-delete/undo (PRD Non-Goal). Used on both the list card and the detail page.
- **Data shapes** (from F-01, `src/db/database.types.ts`): recognized/corrected items and recipe
  body are **markdown strings** (`recognized_items_md`, `corrected_items_md`, `content_md`), not
  structured rows. The list editor presents editable `[name, quantity]` rows in the UI and
  serializes to markdown on save; recipe detail renders `content_md`.
- **shadcn primitives to add** (only `button` exists today): `card input textarea form label dialog
sonner` plus a progress/spinner for the long-op loaders — add via `npx shadcn@latest add <name>`.

## 7. Cleanup implied by this architecture

Scaffold artifacts to remove/rework as slices land (the owner confirmed the scaffold is not load-bearing):

- **Delete** `/dashboard` (`src/pages/dashboard.astro`) — superseded by `/recipes`.
- **Reshape** `/` (`src/pages/index.astro` + `Welcome.astro`) into the real product landing.
- **Rework** `Topbar.astro` into the `AppLayout` top bar (currently unused) and reshape `Layout.astro`
  into `PublicLayout` / `AppLayout`.
- **Revalidate** the auth pages/forms against the real F-02 verified-only flow (they are
  scaffolding-grade today).

## 8. Open questions

- F-02 verification-status check in middleware: exact field/mechanism (`email_confirmed_at` vs a
  Supabase helper) — decided in the F-02 plan, back-filled into §5.
- "Account inactive" gate: standalone screen vs inline banner on the sign-in page — decided in F-02.
- Recipe detail: how much of the saved **session input** (photos, recognized vs corrected list,
  context) to surface alongside the recipe — decided in the S-04 plan (FR-009 stores it all).
