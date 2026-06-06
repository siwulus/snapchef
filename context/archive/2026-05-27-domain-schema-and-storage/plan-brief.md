# Domain Schema and Storage — Plan Brief

> Full plan: `context/changes/domain-schema-and-storage/plan.md`
> Change identity: `context/changes/domain-schema-and-storage/change.md`

## What & Why

Lay the persistence foundation for Snapchef — two per-user domain tables, a private Storage bucket for session photos, and per-operation RLS on both — so every downstream slice (S-01 through S-04) inherits a correct privacy boundary instead of bolting one on later. The privacy NFR is launch-gating; sequencing this change before any consumer slice prevents cross-user data leaks at the cheapest possible time.

## Starting Point

The repo has Astro SSR on Cloudflare Workers with Supabase auth wired up and one applied smoke-test migration that proves the migration pipeline reaches production. No domain tables, no buckets, no typed Supabase client (`src/db/` doesn't exist yet).

## Desired End State

`recipe_sessions` and `recipes` tables exist with RLS enabled and 4 per-operation policies each; a private `session-photos` bucket exists with 4 storage policies keyed on the first path segment; a drift trigger prevents `recipes.user_id` from disagreeing with its session's owner; `src/db/database.types.ts` reflects the schema for type-safe consumption in upcoming slices; an `npm run db:types` script lets future changes regenerate it.

## Key Decisions Made

| Decision                   | Choice                                                 | Why                                                                                                             | Source |
| -------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ------ |
| Recognition / recipe shape | Markdown text columns (no JSONB, no child tables)      | LLM-friendly natural language; matches mobile-first single-textarea editing UX                                  | Change |
| Persist raw and corrected  | Both `recognized_items_md` and `corrected_items_md`    | Raw for audit/debug; corrected as actual input to recipe generation                                             | Change |
| Photo paths storage        | `text[]` on `recipe_sessions`, no child table          | Bounded 1–5 by CHECK; avoids a join for a fixed-small list                                                      | Change |
| Recipe ↔ session           | 1:1, `recipes.session_id UNIQUE`, cascade delete       | Single source of truth; deleting the session removes the recipe                                                 | Change |
| `recipes.user_id` denorm   | Denormalized owner + `BEFORE INSERT OR UPDATE` trigger | Flat RLS per row, no joins on listings; trigger asserts agreement with the session's owner                      | Change |
| Storage path convention    | `{user_id}/{session_id}/{uuid}.{ext}`                  | Load-bearing for RLS — first segment is matched via `(storage.foldername(name))[1]`                             | Change |
| Migration shape            | Single additive file containing all DDL + policies     | CLAUDE.md hard rule + change.md explicit decision; replayable via `on conflict do nothing` and `if not exists`  | Change |
| Bucket creation            | Migration SQL + `config.toml` mirror                   | Migration owns production; config.toml mirror gives `supabase db reset` parity locally                          | Plan   |
| RLS verification           | Checked-in `rls-verification.sql` impersonation script | Catches the launch-gating privacy risk without standing up a test framework yet; rerunnable by any future agent | Plan   |
| TypeScript types           | Generate `src/db/database.types.ts` in this change     | First consumer slice (S-01) gets a typed client out of the box; sets the project convention                     | Plan   |

## Scope

**In scope:**

- One additive migration creating `recipe_sessions`, `recipes`, the `session-photos` bucket, 12 RLS policies, and 2 triggers.
- `supabase/config.toml` bucket mirror for local dev.
- Ad-hoc SQL impersonation script proving cross-user isolation + drift-trigger behavior.
- `npm run db:types` script and committed `src/db/database.types.ts`.

**Out of scope:**

- Any API route, service, or UI (S-01+).
- pgTAP / Vitest test harness.
- Image transformation, signed URLs, upload service.
- Soft-delete, undo, per-photo metadata.
- Production migration deployment automation (handled separately by the existing Supabase + Workers Builds pipeline).

## Architecture / Approach

Three sequential phases, all local-only until merge:

```
Phase 1 (build)      Phase 2 (verify)         Phase 3 (consume)
─────────────────    ────────────────────     ──────────────────────
migration SQL  ───►  rls-verification.sql ──► npm run db:types
config.toml          rls-verification.md      src/db/database.types.ts
supabase db reset    (impersonate 2 users)    npm run build
```

The migration is the load-bearing artifact; phases 2 and 3 are guardrails — phase 2 proves the security boundary works before any consumer reaches it, phase 3 surfaces schema drift to TypeScript so slices fail fast on column mismatches.

## Phases at a Glance

| Phase                        | What it delivers                                                                 | Key risk                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1. Migration + bucket mirror | Single migration file + `config.toml` bucket entry; applies cleanly              | A malformed policy or missing `with check` silently allows cross-user writes                       |
| 2. RLS verification          | `rls-verification.sql` + log proving 2-user isolation and drift-trigger behavior | False sense of security if the script's seed users aren't actually subject to `authenticated` role |
| 3. TypeScript types          | `db:types` script + committed `database.types.ts`; build passes                  | Generated file conflicts with lint rules; first-time `src/db/` directory wiring                    |

**Prerequisites:** Docker running for local Supabase; `npx supabase start` healthy.
**Estimated effort:** One session across three phases (~1–2 hours including manual verification gates).

## Open Risks & Assumptions

- Production migration deployment assumes the Supabase migration pipeline (e.g. `supabase db push` in a deploy step or manual run) is wired separately. CLAUDE.md mentions Cloudflare Workers Builds for the Worker but is silent on the DB side; confirm with the operator before pushing.
- The `config.toml` bucket mirror is local-only — production bucket existence depends entirely on the migration insert succeeding.
- Storage path convention is enforced by policy, not by the schema. Any future slice that writes to `session-photos` outside the `{user_id}/...` prefix will be blocked silently (zero rows affected) — this is intentional but worth flagging to S-01's plan.

## Success Criteria (Summary)

- `npx supabase db reset` applies the migration cleanly and produces both tables, the bucket, all 12 policies, and both triggers.
- The RLS verification script exits 0 and demonstrates cross-user isolation across reads, writes, deletes, the drift trigger, and storage.
- `npm run build` passes against the regenerated `src/db/database.types.ts`.
