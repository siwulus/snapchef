---
starter_id: 10x-astro-starter
package_manager: npm
project_name: snapchef
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
---

## Why this stack

Solo author building Snapchef as a 3-week after-hours MVP: a mobile-friendly
web app with email+password auth, per-user image upload, LLM-powered vision
(product recognition) and recipe generation, plus per-user private persistence
of saved recipes. The recommended default for `(web, js)` is 10x-astro-starter
— Astro 6 + React 19 + TypeScript + Tailwind 4 + Supabase + Cloudflare. It
directly covers the load-bearing FRs out of the box: Supabase Auth handles
FR-001/FR-002, Supabase Storage handles FR-003 image uploads, and Supabase
Postgres with row-level security gives the per-user data isolation called out
in the privacy guardrail and FR-009–012. TypeScript end-to-end clears all four
agent-friendly gates. Deployment lands on Cloudflare Pages/Workers (starter
default); the ~30s edge-runtime ceiling matches the PRD's 30s response-time
NFR for AI calls, with Vercel/Fly available as fallbacks if image-recognition
latency creeps past the ceiling. CI runs on GitHub Actions with
auto-deploy-on-merge — what the starter ships with, and the right shape for
solo + short timeline.

## UI component library

**Decision: shadcn/ui (new-york variant) on the Radix UI primitive base.**

Chosen on 2026-05-30 after evaluating shadcn/ui, Mantine v8, MUI v7, Chakra v3, HeroUI, and DaisyUI against the project's constraints.

### Why shadcn/ui wins for this stack

The three hard constraints eliminate every alternative before feature comparison:

1. **Astro island hydration** — libraries that require a global runtime or `<Provider>` wrapper (Mantine, MUI, Chakra) force boilerplate inside every island and pay hydration cost on a framework that ships zero JS by default.
2. **Tailwind 4 is the single styling system** — mixing a second styling approach (Emotion, Panda CSS, CSS Modules) creates bundle bloat, visual drift, and two mental models. shadcn components _are_ Tailwind classes.
3. **Cloudflare edge + mobile-first** — smallest possible bundle; shadcn copies source into the repo so the bundle impact is only the Radix primitives you actually use (~10–35 KB) vs. 60–200 KB for packaged alternatives.

Additional factors: React 19 + Tailwind 4 are fully supported (all deps — radix-ui, lucide-react, CVA, sonner, cmdk, react-hook-form — confirmed ✅). AI tooling (Claude Code) generates shadcn/Tailwind output reliably. Official Astro install guide exists for the exact stack.

### Rejected alternatives (and why)

| Library    | Reason rejected                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mantine v8 | Requires Provider per island; CSS Modules coexist with Tailwind but don't integrate natively; ~60 KB baseline                                    |
| MUI v7     | Emotion CSS-in-JS runtime; Material Design requires heavy re-theming; 100–200 KB                                                                 |
| Chakra v3  | Provider wrapper required; Panda CSS is a second styling system; v2→v3 migration fragmented ecosystem                                            |
| HeroUI     | Tailwind-native but ships CSS-in-JS runtime on top; ~80 KB                                                                                       |
| DaisyUI    | Zero-runtime Tailwind plugin, good for static markup — but no behavioral primitives (no focus traps, ARIA, keyboard nav); viable supplement only |

### Primitive base note (2026)

Radix UI was acquired by WorkOS and update velocity slowed on complex components. shadcn now supports **three primitive bases**: Radix (default), **Base UI** (MUI-maintained, more active), and **Ark UI** (added early 2026). Staying on the Radix default for Snapchef — best documented, what AI tooling expects. If a Radix combobox/multi-select limitation is hit, Base UI can replace that one component without leaving shadcn.

### Component strategy

- Add via CLI: `npx shadcn@latest add button card dialog input form sonner`
- Static layout in `.astro` files; reserve `.tsx` + `client:visible`/`client:load` for interactive islands (upload widget, recipe save)
- Toasts: use `sonner` (shadcn deprecated the old `toast`)
- Data tables (if needed): TanStack Table via shadcn's data-table pattern — not MUI
