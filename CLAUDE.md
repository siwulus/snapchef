# Repository Guidelines

Snapchef is an Astro 6 SSR app (React 19 islands, Tailwind 4, Supabase auth, shadcn/ui) deployed to Cloudflare Workers via `@astrojs/cloudflare`.

## Hard Rules

- API routes (`src/pages/api/**`) must `export const prerender = false`. The app runs `output: "server"` — see `@astro.config.mjs`.
- Server-only env access goes through `astro:env/server`. `SUPABASE_URL` / `SUPABASE_KEY` are declared in the `env.schema` of `@astro.config.mjs` — do not read `import.meta.env.*` or `process.env.*` for them.
- New Supabase tables require RLS enabled with granular per-operation, per-role policies in the same migration. Migration filenames follow `YYYYMMDDHHmmss_short_description.sql` under `supabase/migrations/`.
- No Next.js directives (`"use client"`, `"use server"`) — this is Astro, not Next.

## Project Structure

- `src/pages/` Astro routes; `src/pages/api/` endpoints.
- `src/components/ui/` shadcn/ui ("new-york" variant); `src/components/auth/` auth UI; extract React hooks to `src/components/hooks/`.
- `src/lib/` helpers and services (`src/lib/services/` for business logic). Supabase SSR client: `@src/lib/supabase.ts`.
- `src/middleware.ts` — attaches `context.locals.user`; gate paths via `PROTECTED_ROUTES`.
- `src/types.ts` — shared entities and DTOs.
- `supabase/` — local stack config + migrations. See `@README.md` for `npx supabase init/start`.

## Commands

- See scripts in `@package.json` (`dev`, `build`, `preview`, `lint`, `lint:fix`, `format`). Lint uses type-checked rules from `@eslint.config.js`; format runs Prettier with the Astro + Tailwind plugins.
- `npx wrangler deploy` — deploy to Cloudflare. Secrets via `npx wrangler secret put`.

## Coding Style

- TypeScript strict-type-checked + stylistic-type-checked via `typescript-eslint` (`@eslint.config.js`). Prefix intentionally unused vars with `_`.
- Path alias `@/*` → `./src/*`. Prefer it over deep relative imports.
- Merge Tailwind classes with `cn()` from `@/lib/utils` — never concatenate class strings manually.
- Astro components for static/layout; React only when interactivity is needed. Add shadcn primitives via `npx shadcn@latest add <name>`.
- Validate API input with `zod`; use uppercase `GET` / `POST` exports.

## Environment, Commits & CI

- Node `24` (`@mise.toml`, replaces `.nvmrc`); `mise.toml` also auto-loads `.env` and defines task aliases (`mise run dev|build|lint|format|deploy|db-start|db-stop`). Local dev secrets: `.env` (Node) and `.dev.vars` (Cloudflare local dev, gitignored). Local Supabase requires Docker — see `@README.md`.
- Pre-commit hooks run via Husky + lint-staged — see `@package.json`. Do not bypass with `--no-verify`.
- Commit subjects so far are short imperatives; no Conventional Commits prefix in use yet.
- CI: `@.github/workflows/ci.yml` (runs on `main`). Both Supabase secrets are required for the build step.
