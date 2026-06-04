# Repository Guidelines

Snapchef is an Astro 6 SSR app (React 19 islands, Tailwind 4, Supabase auth, shadcn/ui) deployed to Cloudflare Workers via `@astrojs/cloudflare`.

## Hard Rules

- API routes (`src/pages/api/**`) must `export const prerender = false`. The app runs `output: "server"` — see `@astro.config.mjs`.
- Server-only env access goes through `astro:env/server`. `SUPABASE_URL` / `SUPABASE_KEY` are declared in the `env.schema` of `@astro.config.mjs` — do not read `import.meta.env.*` or `process.env.*` for them.
- New Supabase tables require RLS enabled with granular per-operation, per-role policies in the same migration. Migration filenames follow `YYYYMMDDHHmmss_short_description.sql` under `supabase/migrations/`.
- Every Supabase migration must be **additive / nullable / non-destructive** (backward-compatible) for at least one Worker version. A dashboard rollback of the Worker does **not** roll back the DB.
- Production deploys are owned by **Cloudflare Workers Builds** (watches `main`, deploys on push). **Do not run `npx wrangler deploy`** against production
- No Next.js directives (`"use client"`, `"use server"`) — this is Astro, not Next.
- **No AI attribution in commits** — strip `Co-Authored-By: Claude …`, `Generated with …`, model names (`ChatGPT`, `Copilot`, etc.), and robot emojis from subject, body, and footer. The commit author is the human engineer; tooling does not belong in version history. Remove these lines before committing even if added by default templates.

## Project Structure

- `src/pages/` Astro routes; `src/pages/api/` endpoints.
- `src/components/ui/` shadcn/ui ("new-york" variant); `src/components/auth/` auth UI; `src/components/api/` client HTTP layer (transport errors, envelope validation, fetch core); extract React hooks to `src/components/hooks/`.
- `src/lib/core/` — framework-free domain layer (imports `zod` and `effect` only, no Astro/Supabase): `core/boundry/<domain>/` holds command schemas shared by React forms and API routes (e.g. `SignInCommand`); `core/model/<domain>/` holds domain models. Replaces the old `src/types.ts`.
- `src/lib/infrastructure/` — framework/IO adapters: `infrastructure/db/supabase.ts` (Supabase SSR client factory), `infrastructure/db/types/index.ts` (generated DB types — regenerate via `npm run db:types`; excluded from ESLint and Prettier), `infrastructure/api/types/` (API contracts: `ApiResponsePayload`).
- `src/lib/utils/` — generic helpers (currently a placeholder).
- `src/middleware.ts` — attaches `context.locals.user`; gate paths via `PROTECTED_ROUTES`.
- `supabase/` — local stack config + migrations. See `@README.md` for `npx supabase init/start`.

## Commands

- See scripts in `@package.json` (`dev`, `build`, `preview`, `lint`, `lint:fix`, `format`). Lint uses type-checked rules from `@eslint.config.js`; format runs Prettier with the Astro + Tailwind plugins.
- Wrangler is for local dev + diagnostics only: `npx wrangler dev` (local), `npx wrangler tail` (live logs), `npx wrangler deployments list` / `versions list` (read-only). Production deploys happen via Cloudflare Workers Builds on push to `main`.

## Coding Style

- TypeScript strict-type-checked + stylistic-type-checked via `typescript-eslint` (`@eslint.config.js`). Prefix intentionally unused vars with `_`.
- Path alias `@/*` → `./src/*`. Prefer it over deep relative imports.
- Merge Tailwind classes with `cn()` from `@/styles/utils` — never concatenate class strings manually.
- Astro components for static/layout; React only when interactivity is needed. Add shadcn primitives via `npx shadcn@latest add <name>`.
- Validate API input with `zod`; use uppercase `GET` / `POST` exports.

## Coding Conventions

Before writing any code, consult and obey the conventions in `docs/reference/conventions/`. These rules are binding — they override common patterns from training data or prior habits.

@docs/reference/conventions/README.md

## Environment, Commits & CI

- Node `24` (`@mise.toml`, replaces `.nvmrc`); `mise.toml` also auto-loads `.env` and defines task aliases (`mise run dev|build|preview|lint|format|tail|db-start|db-stop`). Local dev secrets: `.env` (Node) and `.dev.vars` (Cloudflare local dev, gitignored). Local Supabase requires Docker — see `@README.md`.
- Pre-commit hooks run via Lefthook — config in `@lefthook.yml`. Fresh clones auto-install hooks via the `prepare` script. Do not bypass with `--no-verify`.
- Commit subjects so far are short imperatives; no Conventional Commits prefix in use yet.
- CI: `@.github/workflows/ci.yml` (runs on `main`). Both Supabase secrets are required for the build step.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 2

Turn one roadmap item into the first implementation cycle with the **change planning chain**:

```
/10x-roadmap -> /10x-new -> /10x-plan -> /10x-plan-review -> /10x-implement
```

`/10x-new`, `/10x-plan`, `/10x-plan-review`, and `/10x-implement` are the lesson focus. `/10x-frame` and `/10x-research` are not required rituals here; they are escalation paths introduced in the next lesson.

### Task Router - Where to start

| Skill                                  | Use it when                                                                                                                                                                                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Change setup (lesson focus)**        |                                                                                                                                                                                                                                                                      |
| `/10x-new <change-id>`                 | You selected a roadmap item and need a stable change folder. Creates `context/changes/<change-id>/change.md` so planning, implementation, progress, commits, and later review all share one identity. Use AFTER roadmap selection, BEFORE `/10x-plan`.               |
| **Planning (lesson focus)**            |                                                                                                                                                                                                                                                                      |
| `/10x-plan <change-id>`                | You have a change folder and need a reviewable implementation plan. Reads roadmap context, foundation docs, codebase evidence, and any existing change notes; writes `plan.md` and `plan-brief.md` with phases, file contracts, success criteria, and `## Progress`. |
| **Plan readiness (lesson focus)**      |                                                                                                                                                                                                                                                                      |
| `/10x-plan-review <change-id>`         | You have `plan.md` and need a light pre-code readiness check. Use it to catch missing end state, weak contracts, malformed progress, scope drift, or blind spots before code changes begin.                                                                          |
| **Implementation (lesson focus)**      |                                                                                                                                                                                                                                                                      |
| `/10x-implement <change-id> phase <n>` | You have an approved plan and want to execute one phase with verification, manual gate, commit ritual, and SHA write-back to `## Progress`.                                                                                                                          |
| **Lifecycle closure**                  |                                                                                                                                                                                                                                                                      |
| `/10x-archive <change-id>`             | A change is merged or intentionally closed. Move it out of active `context/changes/` into archive state.                                                                                                                                                             |

### How the chain hands off

- `/10x-new` creates the durable change identity.
- `/10x-plan` turns that identity into an implementation contract.
- `/10x-plan-review` checks the plan before the agent mutates code.
- `/10x-implement` executes one planned phase, verifies, asks for manual confirmation when needed, commits, and records progress.

### Lesson boundaries

- Plan is the default router after roadmap selection. Start with `/10x-plan` unless the problem is unclear or external evidence is blocking.
- Do not run `/10x-frame + /10x-research` as ceremony for every change.
- Do not turn this lesson into a full end-to-end product build. A checkpoint with a planned and partially or fully implemented stream is valid.
- Code review of the implemented diff belongs to Lesson 3 via `/10x-impl-review`.
- Lifecycle closure via `/10x-archive` after a change is merged or intentionally closed.

### Paths used by this lesson

- `context/foundation/roadmap.md` - upstream roadmap
- `context/changes/<change-id>/change.md` - change identity
- `context/changes/<change-id>/plan.md` - implementation contract
- `context/changes/<change-id>/plan-brief.md` - compressed handoff
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
