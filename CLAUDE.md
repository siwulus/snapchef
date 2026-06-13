# Repository Guidelines

Snapchef is an Astro 6 SSR app (React 19 islands, Tailwind 4, Supabase auth, shadcn/ui) deployed to Cloudflare Workers via `@astrojs/cloudflare`.

## Hard Rules

- API routes (`src/pages/api/**`) must `export const prerender = false`. The app runs `output: "server"` — see `@astro.config.mjs`.
- Server-only env access goes through `astro:env/server`. `SUPABASE_URL` / `SUPABASE_KEY` are declared in the `env.schema` of `@astro.config.mjs` — do not read `import.meta.env.*` or `process.env.*` for them.
- New Supabase tables require RLS enabled with granular per-operation, per-role policies in the same migration. Migration filenames follow `YYYYMMDDHHmmss_short_description.sql` under `supabase/migrations/`.
- Every Supabase migration must be **additive / nullable / non-destructive** (backward-compatible) for at least one Worker version. A dashboard rollback of the Worker does **not** roll back the DB.
- Production deploys are owned by **Cloudflare Workers Builds** (watches `main`, deploys on push). **Do not run `pnpm exec wrangler deploy`** against production
- No Next.js directives (`"use client"`, `"use server"`) — this is Astro, not Next.
- **No AI attribution in commits** — strip `Co-Authored-By: Claude …`, `Generated with …`, model names (`ChatGPT`, `Copilot`, etc.), and robot emojis from subject, body, and footer. The commit author is the human engineer; tooling does not belong in version history. Remove these lines before committing even if added by default templates.

## Project Structure

- `src/pages/` Astro routes; `src/pages/api/` endpoints.
- `src/components/ui/` shadcn/ui ("new-york" variant); `src/components/auth/` auth UI; `src/components/api/` client HTTP layer (transport errors, envelope validation, fetch core); extract React hooks to `src/components/hooks/`.
- `src/lib/core/` — framework-free domain layer (imports `zod` and `effect` only, no runtime Astro/Supabase — adapter contracts enter `core/uc` as `import type` only): `core/boundry/<domain>/` holds the contracts shared across the hexagon, split by direction — `ports.ts` (driven-side port interfaces + their payload DTOs), `commands.ts` (driving-side input schemas shared by React forms and API routes, e.g. `UserCredentials`), `responses.ts` (driving-side response schemas, e.g. `RedirectTarget`), and `dto.ts` (genuinely shared constants); `core/model/<domain>/` holds domain models (e.g. `SnapchefUser`, `UserId`); `core/uc/<domain>/` holds use-case classes (`<Name>UC`) — the central point for business logic, constructor-injected with adapters and exposed to routes via `context.locals` (see `docs/reference/conventions/use-cases.md`). Replaces the old `src/types.ts`.
- `src/lib/infrastructure/` — framework/IO adapters: `infrastructure/db/supabase.ts` (Supabase SSR client factory), `infrastructure/db/types/index.ts` (generated DB types — regenerate via `pnpm db:types`; excluded from ESLint and Prettier), `infrastructure/api/types/` (API contracts: `ApiResponsePayload`).
- `src/lib/utils/` — only modules importable from both `core` and `infrastructure` without violating dependency direction (currently just `effect.ts`, the zod→Effect `decodeWith` bridge). Supabase/DB/domain-specific helpers do not belong here — see `src/lib/CLAUDE.md`.
- `src/middleware.ts` — the single DI composition root: instantiates `core/uc` use cases onto `context.locals` (each declared on `App.Locals` in `src/env.d.ts`), attaches `context.locals.user`; gate paths via `PROTECTED_ROUTES`.
- `supabase/` — local stack config + migrations. See `@README.md` for `pnpm exec supabase init/start`.

## Commands

- See scripts in `@package.json` (`dev`, `build`, `preview`, `lint`, `lint:fix`, `format`). Lint uses type-checked rules from `@eslint.config.js`; format runs Prettier with the Astro + Tailwind plugins.
- Wrangler is for local dev + diagnostics only: `pnpm exec wrangler dev` (local), `pnpm exec wrangler tail` (live logs), `pnpm exec wrangler deployments list` / `versions list` (read-only). Production deploys happen via Cloudflare Workers Builds on push to `main`.

## Coding Style

- TypeScript strict-type-checked + stylistic-type-checked via `typescript-eslint` (`@eslint.config.js`). Prefix intentionally unused vars with `_`.
- Path alias `@/*` → `./src/*`. Prefer it over deep relative imports.
- Merge Tailwind classes with `cn()` from `@/styles/utils` — never concatenate class strings manually.
- Astro components for static/layout; React only when interactivity is needed. Add shadcn primitives via `pnpm dlx shadcn@latest add <name>`.
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

## 10xDevs AI Toolkit - Module 3, Lesson 4 (E2E Tests)

**For E2E tests, use the `/10x-e2e` skill.** It is the single source of truth
for the workflow — risk → seed test + rules → generate → review against the five
anti-patterns → re-prompt → verify. The skill's `references/` carry the full
rules, anti-patterns, seed pattern, and prompt-template.

A few hard rules that hold even before you invoke the skill:

- **Locators:** `getByRole` / `getByLabel` / `getByText` first; `getByTestId`
  only when accessibility attributes are ambiguous. Never CSS selectors, XPath,
  or DOM structure.
- **Never `page.waitForTimeout()`.** Wait for state: `toBeVisible()`,
  `waitForURL()`, `waitForResponse()`.
- **Test independence + cleanup.** Each test runs standalone — its own setup,
  action, assertion, and cleanup; unique ids (timestamp suffix) so parallel runs
  and re-runs don't collide.

Two boundaries to keep straight:

- **DOM (snapshot) is the default.** Vision (`--caps=vision`) is a supplement for
  visual-only risks (layout, z-index, animation); for pixel regression prefer
  deterministic tools (`toMatchSnapshot`, Argos, Lost Pixel). VLM model
  selection/cost is a debugging topic (Lesson 5), not testing.
- **Healer helps on selectors, harms on logic.** A changed selector → healer
  re-finds it (route through PR review). A changed business behavior → healer
  masks the bug; that failing-test-to-fix case is Lesson 5.

<!-- END @przeprogramowani/10x-cli -->
