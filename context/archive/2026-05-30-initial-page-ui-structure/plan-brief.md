# Initial Page UI Structure — Plan Brief

> Full plan: `context/changes/initial-page-ui-structure/plan.md`
> Source of truth: `context/foundation/ui-architecture.md`

## What & Why

Replace the "cosmic" Astro-starter scaffold with the project's real design system and the page/layout
structure locked in the UI architecture doc. The starter chrome (purple glassmorphism, gradient headings,
generic copy) ignores the design tokens already shipped in `global.css`; this change makes the app actually
use them and stands up the shared shells every feature slice will plug into.

## Starting Point

One `Layout.astro` (with a config-status `Banner`) serves all five pages, which hardcode a `bg-cosmic` dark
theme and raw HTML instead of shadcn primitives. Auth works (native-POST + client validation) but is
off-spec stylistically. Middleware protects only `/dashboard`. The real design system (shadcn `radix-lyra`,
neutral oklch tokens, JetBrains Mono, light `:root`) already exists in `global.css` — just unused.

## Desired End State

A light, token-themed app with no cosmic remnants: a basic Snapchef landing at `/`, token-styled auth pages
on shadcn primitives, two layout shells (`PublicLayout`, `AppLayout`), a sonner toast slot in `AppLayout`, and
an empty `/recipes` authenticated-home placeholder behind corrected route protection. No feature logic, no
email-verification gate.

## Key Decisions Made

| Decision             | Choice                                              | Why (1 sentence)                                                                           | Source       |
| -------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------ |
| Default theme        | Light (shipped `:root` tokens)                      | It's what `global.css` already declares; zero new token work.                              | Plan         |
| Icon library         | lucide (updated `components.json`)                  | Auth code already uses lucide; aligned config to reality (done in planning).               | Plan         |
| Auth-gate scope      | Session-only swap; defer verified gate to F-02      | Architecture §5 defers verified tier + signed-in redirects to `email-verification-gating`. | Architecture |
| Toast/messaging      | `Toaster` slot in `AppLayout` + thin `toast` helper | Delivers the §4 mechanism without inventing triggers owned by S-01–S-04.                   | Plan         |
| Config-status Banner | Remove entirely                                     | Owner decision — starter cruft using non-token inline CSS.                                 | Plan         |
| Landing depth        | Hero + 2–3 value-prop cards                         | Communicates the product while staying basic and on-system.                                | Plan         |
| Auth restyle depth   | Rebuild on shadcn `Input`/`Label`/`Button`          | Fully satisfies "remove custom styles"; keeps native-POST form (no react-hook-form).       | Plan         |

## Scope

**In scope:** scaffold deletion (`dashboard`, `Welcome`, `Banner`, `LibBadge`, `config-status`, old `Layout`);
`PublicLayout` + `AppLayout`; reworked `Topbar`; shadcn `input`/`label`/`card`/`sonner`; toast slot; basic
landing; token-restyled auth pages + components; `/recipes` placeholder; middleware → `["/recipes"]`; signin
redirect → `/recipes`; prune `@phosphor-icons/react` + `bg-cosmic` utility; update `src/lib/CLAUDE.md`.

**Out of scope:** F-02 email-verification / verified-only gate + signed-in redirects; feature slices (upload,
wizard `/recipes/new`, detail `/recipes/[id]`, saved-list logic); `textarea`/`dialog`/`progress` primitives;
toast triggers / server→toast bridge; theme toggle; any data/schema change.

## Architecture / Approach

Two Astro layout shells over the existing token system: `PublicLayout` (minimal) for `/` + `/auth/*`,
`AppLayout` (top bar + sonner `Toaster` island + main) for `/recipes*`. Restyling = swapping cosmic classes
for token utilities and composing shadcn primitives; the native `<form method="POST">` → `/api/auth/*` SSR
pattern with `useFormStatus` is preserved (no react-hook-form). Phases ordered so the build stays green: build
the new shells beside the old `Layout` first, migrate + delete second, wire the authed home + protection last.

## Phases at a Glance

| Phase                       | What it delivers                                                              | Key risk                                                            |
| --------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1. Design-system foundation | Primitives + `PublicLayout`/`AppLayout` + reworked `Topbar` + toast slot      | sonner `Toaster` must mount as a `client:load` island.              |
| 2. Public surface + cleanup | Landing, token-restyled auth, scaffold deleted, dep/utility/doc pruned        | Delete-order: remove every importer before deleting a file.         |
| 3. Authed home + protection | `/recipes` placeholder, `/dashboard` gone, middleware + signin redirect fixed | Keep middleware session-only (don't pre-empt F-02's verified gate). |

**Prerequisites:** none (no data layer touched; F-01 already landed, F-02 not required).
**Estimated effort:** ~1–2 sessions across 3 phases.

## Open Risks & Assumptions

- Light theme is assumed correct for MVP; if the product wants dark/brand later, the layouts revisit (tokens already support `.dark`).
- shadcn `form` is intentionally avoided to protect the native-POST auth pattern — if a future form needs RHF, it's an isolated, additive choice.
- `confirm-email`'s DEV/prod branch is kept as-is; F-02 owns revalidating it against the real verification flow.
- Removing the config-status Banner drops the "Supabase not configured" dev warning — a misconfigured local env now shows broken auth instead of a hint.

## Success Criteria (Summary)

- No cosmic styling anywhere; app builds + lints clean on the light token theme.
- Landing → signup → confirm → signin → `/recipes` works end-to-end; anonymous `/recipes` redirects to signin; `/dashboard` 404s.
- The toast mechanism is installed and ready for feature slices to fire.
