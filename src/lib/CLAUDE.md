# Repository Guidelines

Rules for `src/lib/`. See `@AGENTS.md` at the repo root for repo-wide rules.

## Local Rules

- **Server-only by default.** Modules here may import `astro:env/server` (`@./supabase.ts:3`) and run during SSR. Never import from `src/lib/` into a React component (`.tsx`) — if a helper is needed on the client, move it to `src/components/` or pass it in as a prop.
- **Named exports only.** No `export default` (see `@./supabase.ts`, `@./utils.ts`).
- **Fail soft on missing secrets.** When a factory depends on optional env (`SUPABASE_URL`, `SUPABASE_KEY` — declared optional in `@astro.config.mjs`), return `null` rather than throwing, matching `@./supabase.ts:6-8`. Callers (`@src/middleware.ts`) branch on the null.
- **Top-level `src/lib/` is for thin clients (`supabase.ts`) and pure helpers (`utils.ts`).** Create the `services/` subdirectory the first time you extract a service.
- **User-facing strings stay in Polish** when the existing sibling already uses Polish. Do not silently translate.

## File Layout & Naming

- `kebab-case.ts` for all files (`supabase.ts`, `utils.ts`). No `.tsx`, no `.astro` here.
- One responsibility per file; the filename names that responsibility.
- No barrel `index.ts` — import via the `@/lib/<name>` alias.

## Adding a New Module

1. Filename: `kebab-case.ts` naming the responsibility.
2. Use `interface` for exported object shapes (see `@./supabase.ts`); reserve `type` for unions / aliases.
3. Side-effect-free helpers: `export function <name>` (`@./utils.ts:4`).
