# Repository Guidelines

Rules for `src/lib/`. See `@AGENTS.md` at the repo root for repo-wide rules.

## Layer Access Matrix

These rules govern what each layer may import from `src/lib/`. They override the old "server-only" rule, which predated the restructuring.

### `src/components/**` (browser / React islands)

May import from `src/lib/` **only**:

- **Types** from `infrastructure/api/types` (e.g. `ApiResponsePayload`)
- **Types and zod schemas** from `core/model/**` (domain models; e.g. the `ErrorCode` enum schema)
- **Command and response schemas** from `core/boundry/**` (zod schemas shared with React forms, per root CLAUDE.md)

Every other `src/lib/` reference from components is forbidden. Client-side HTTP plumbing lives in `src/components/api/` (`http.ts`, `errors.ts`), not here.

### `src/pages/api/**` (Astro API routes — server-only)

May import:

- `core/boundry/**` (command schemas in)
- `core/model/**` (domain models)
- `core/uc/**` (use-case classes — but routes consume the **instances** from `context.locals`, wired by `src/middleware.ts`; import the class only for types. See `docs/reference/conventions/use-cases.md`)
- `infrastructure/**` (all adapters: db, api, …)

### `infrastructure/db/**`

Strictly server-only. Never reachable from client code (`src/components/**`).

### `utils/**`

May contain **only** modules importable from both `core` and `infrastructure` without violating dependency direction — currently exactly `effect.ts` (`decodeWith`, the zod→Effect bridge). Anything Supabase-, DB-, or domain-specific is misplaced: Supabase `{ data, error }` lifting lives in `infrastructure/db/supabase-effect.ts`, row→model decoders in `infrastructure/db/`, and domain rules (e.g. markdown serialization) in `core/model/**`. When unsure where a helper goes, it almost certainly does **not** belong in `utils/`.

## Local Rules

- **Named exports only.** No `export default`.
- **Fail soft in factories, fail fast at the composition root.** When a factory depends on optional env (`SUPABASE_URL`, `SUPABASE_KEY`), return `null` rather than throwing — see `infrastructure/db/supabase.ts`. The composition root (`injectDependencies` in `src/middleware.ts`) is the one place that turns the null into a hard failure: it throws `ExternalSystemError` so every downstream consumer may assume `context.locals` is fully populated.
- **User-facing strings stay in Polish** when the existing sibling already uses Polish.

## File Layout & Naming

- File naming follows the repo-wide rule (`docs/reference/conventions/generic.md`): files whose primary export is a class are `PascalCase.ts` matching the class (e.g. `core/uc/auth/AuthenticatorUC.ts`); all other modules are `kebab-case.ts`. No `.tsx`, no `.astro` here.
- One responsibility per file; the filename names that responsibility.
- Per-domain `index.ts` barrel files are the established pattern under `core/*` (e.g. `core/boundry/auth/index.ts`, `core/model/auth/index.ts`). Top-level `src/lib/` modules do not use barrel files — import via the `@/lib/<path>` alias directly.

## Adding a New Module

1. Module name folow the kebab-case style. Naming the files folow the PascalCase (`PascalCase.ts`)
2. Use `interface` for exported object shapes; reserve `type` for unions / aliases.
3. Arrow functions throughout (`const fn = () => …`) — see root CLAUDE.md conventions.
