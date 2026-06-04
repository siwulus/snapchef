# Repository Guidelines

Rules for `src/lib/`. See `@AGENTS.md` at the repo root for repo-wide rules.

## Layer Access Matrix

These rules govern what each layer may import from `src/lib/`. They override the old "server-only" rule, which predated the restructuring.

### `src/components/**` (browser / React islands)

May import from `src/lib/` **only**:

- **Types** from `infrastructure/api/types` (e.g. `ApiResponsePayload`)
- **Types and zod schemas** from `core/model/**` (domain models; e.g. the `ErrorCode` enum schema)
- **Command and response schemas** from `core/boundry/**` (zod schemas shared with React forms, per root CLAUDE.md)

Every other `src/lib/` reference from components is forbidden. Client-side HTTP plumbing lives in `src/components/api/` (`http.ts`, `contract.ts`, `errors.ts`), not here.

### `src/pages/api/**` (Astro API routes — server-only)

May import:

- `core/boundry/**` (command schemas in)
- `core/model/**` (domain models)
- `core/uc/**` (use cases — directory created when the first use case lands)
- `infrastructure/**` (all adapters: db, api, …)

### `infrastructure/db/**`

Strictly server-only. Never reachable from client code (`src/components/**`).

## Local Rules

- **Named exports only.** No `export default`.
- **Fail soft on missing secrets.** When a factory depends on optional env (`SUPABASE_URL`, `SUPABASE_KEY`), return `null` rather than throwing — see `infrastructure/db/supabase.ts`. Callers (`src/middleware.ts`) branch on the null.
- **User-facing strings stay in Polish** when the existing sibling already uses Polish.

## File Layout & Naming

- `kebab-case.ts` for all files. No `.tsx`, no `.astro` here.
- One responsibility per file; the filename names that responsibility.
- Per-domain `index.ts` barrel files are the established pattern under `core/*` (e.g. `core/boundry/auth/index.ts`, `core/model/auth/index.ts`). Top-level `src/lib/` modules do not use barrel files — import via the `@/lib/<path>` alias directly.

## Adding a New Module

1. Filename: `kebab-case.ts` naming the responsibility.
2. Use `interface` for exported object shapes; reserve `type` for unions / aliases.
3. Arrow functions throughout (`const fn = () => …`) — see root CLAUDE.md conventions.
