# Domain Schema and Storage Implementation Plan

## Overview

Lay the persistence foundation for Snapchef: two per-user domain tables (`recipe_sessions`, `recipes`), one private Storage bucket (`session-photos`), per-operation RLS on both tables and the bucket, a drift-prevention trigger on the denormalized `recipes.user_id`, and an `updated_at` trigger on `recipe_sessions`. Output is a single additive migration plus a TypeScript types regeneration that downstream slices (S-01, S-02, S-03, S-04) will consume.

## Current State Analysis

- The repo runs Astro SSR on Cloudflare Workers with Supabase auth wired through `@/lib/supabase.ts`; no domain tables exist yet.
- Only `supabase/migrations/20260525171800_initial_smoke_test.sql` is applied — a no-op comment that proves the migration pipeline reaches production.
- `supabase/config.toml` is locally enabled (`[storage]` block present, all bucket entries commented out). The file is currently modified (project id renamed to `snapchef`, plus auth defaults) — uncommitted but unrelated to this change; this plan will add a bucket block on top.
- No `src/db/` directory exists; the app has no typed Supabase client yet.
- No automated DB tests exist; CLAUDE.md mandates RLS in the same migration as new tables but does not impose a test framework.

### Key Discoveries

- The full schema, RLS posture, Storage path convention, delete semantics, drift trigger, and migration shape are already locked in `context/changes/domain-schema-and-storage/change.md`. This plan is execution, not design.
- CLAUDE.md hard rule: "every Supabase migration must be additive / nullable / non-destructive (backward-compatible) for at least one Worker version" — satisfied here because nothing yet reads or writes these tables.
- CLAUDE.md hard rule: "new Supabase tables require RLS enabled with granular per-operation, per-role policies in the same migration" — the change.md design enumerates exactly that (4 policies per table × 2 tables = 8, plus 4 storage policies).
- Storage bucket creation in Supabase requires `insert into storage.buckets ... on conflict do nothing` inside the migration to reach production; `supabase/config.toml` `[storage.buckets.session-photos]` only governs local `supabase db reset` / `supabase start`.
- `gen_random_uuid()` is available without extension on Postgres 17 (config.toml: `major_version = 17`).

## Desired End State

After this plan:

1. `supabase db reset` applies cleanly against local Supabase and yields `recipe_sessions`, `recipes`, the `session-photos` bucket, all RLS enabled, and all policies present.
2. An ad-hoc SQL verification script demonstrates that two distinct `authenticated` JWT subjects cannot read each other's session rows, recipe rows, or storage objects — and that the `recipes.user_id` drift trigger rejects mismatched inserts.
3. `src/db/database.types.ts` exists and matches the new schema; `npm run lint` (which type-checks) passes against it.
4. An `npm run db:types` script regenerates the types from the local Supabase instance.
5. Production deployment is unblocked: pushing the migration through Cloudflare Workers Builds + Supabase migration pipeline is safe (additive, no live consumers).

## What We're NOT Doing

- No API routes, services, or UI — those land in S-01 / S-02 / S-03 / S-04.
- No JSONB / structured ingredient or step tables — `change.md` explicitly chose markdown.
- No `session_photos` child table; photos live as `text[]` on `recipe_sessions`.
- No soft-delete / undo / per-photo metadata.
- No image transformation, signed-URL helper, or upload service — slice work.
- No pgTAP / Vitest test harness — verification is documented SQL-session impersonation, not CI.
- No regeneration of `src/lib/supabase.ts` shape — it stays untyped at the client level for this change (types are imported on use sites).

## Implementation Approach

Three sequential phases. Phase 1 writes one migration file plus the local config mirror, and applies it via `supabase db reset`. Phase 2 verifies RLS with a checked-in SQL script that any future agent can rerun. Phase 3 regenerates and commits the TypeScript types and adds the regeneration script. The migration is the load-bearing artifact; phases 2 and 3 protect against silent drift.

## Critical Implementation Details

- **Migration must be one file.** `change.md` mandates a single migration containing both `create table`, `enable rls`, all 12 policies, the bucket insert, both triggers, and both trigger functions. Filename pattern: `YYYYMMDDHHmmss_domain_schema_and_storage.sql` per CLAUDE.md.
- **Storage RLS keys on the first path segment.** All four storage policies use `auth.uid()::text = (storage.foldername(name))[1]` and filter `bucket_id = 'session-photos'`. The path convention `{user_id}/{session_id}/{uuid}.{ext}` is load-bearing — no policy works if a slice ever writes to a different layout.
- **Denormalized `recipes.user_id` requires the drift trigger.** Without `BEFORE INSERT OR UPDATE ... assert NEW.user_id = (select user_id from recipe_sessions where id = NEW.session_id)`, RLS becomes spoofable by anyone with `INSERT` on `recipes`. The trigger is part of the security boundary, not a nicety.
- **Bucket insert must be idempotent.** Production may already have the bucket from a prior partial deploy; use `on conflict (id) do nothing` to keep the migration replayable.

## Phase 1: Migration + bucket mirror

### Overview

Author the single migration file containing schema, RLS, triggers, and storage bucket setup. Mirror the bucket in `supabase/config.toml` so `supabase db reset` recreates it locally. Apply locally and confirm schema appears with `\dt` + storage objects visible.

### Changes Required:

#### 1. Migration file

**File**: `supabase/migrations/<timestamp>_domain_schema_and_storage.sql`

**Intent**: Create the entire data layer described in `change.md` in one additive migration. Order: tables → enable RLS → table policies (4 per table, per role `authenticated`) → trigger functions → triggers → bucket insert → storage policies. Every policy is `to authenticated`; no `anon` policies. The migration must replay cleanly (use `if not exists` on tables and `on conflict do nothing` on the bucket insert; policies are dropped-if-exist then recreated, or guarded via `do $$ ... if not exists ... $$`).

**Contract**:

- `recipe_sessions(id uuid pk default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, recognized_items_md text not null, corrected_items_md text not null, meal_context text not null, photo_paths text[] not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now())` with CHECKs: `cardinality(photo_paths) between 1 and 5`, `length(recognized_items_md) <= 8000`, `length(corrected_items_md) <= 8000`, `length(meal_context) <= 2000`.
- `recipes(id uuid pk default gen_random_uuid(), session_id uuid not null unique references recipe_sessions(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade, name text not null, content_md text not null, created_at timestamptz not null default now())` with CHECK `length(content_md) <= 16000`.
- Indexes: `recipe_sessions(user_id, created_at desc)`, `recipes(user_id, created_at desc)`.
- RLS: `alter table ... enable row level security` on both. 4 policies per table for role `authenticated` with `using (auth.uid() = user_id)` (and same `with check` for `insert`/`update`).
- Trigger function `public.set_updated_at()` returning trigger; trigger `recipe_sessions_set_updated_at before update on recipe_sessions for each row execute function public.set_updated_at()`.
- Trigger function `public.recipes_assert_user_id_matches_session()` returning trigger; raises exception if mismatch. Trigger `recipes_user_id_drift_guard before insert or update on recipes for each row execute function public.recipes_assert_user_id_matches_session()`.
- `insert into storage.buckets (id, name, public) values ('session-photos', 'session-photos', false) on conflict (id) do nothing`.
- 4 policies on `storage.objects` for role `authenticated`, each restricted to `bucket_id = 'session-photos'` and `auth.uid()::text = (storage.foldername(name))[1]`. Names: `session_photos_select`, `session_photos_insert`, `session_photos_update`, `session_photos_delete`.

#### 2. Local bucket mirror

**File**: `supabase/config.toml`

**Intent**: Replace the commented `[storage.buckets.images]` example block with a real `[storage.buckets.session-photos]` block so `supabase start` / `supabase db reset` provisions the bucket locally in addition to the migration insert. Mirrors production semantics for developer ergonomics.

**Contract**:

```toml
[storage.buckets.session-photos]
public = false
file_size_limit = "5MiB"
allowed_mime_types = ["image/jpeg", "image/png", "image/webp", "image/heic"]
```

The `file_size_limit` and MIME list are local-dev hints reflecting PRD FR-003 (≤5 MB). Production enforcement happens at the API/edge layer in S-01; this config does not gate prod.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset` exits 0.
- Schema present: `psql "$LOCAL_DB_URL" -c "\\dt public.*"` lists `recipe_sessions` and `recipes`.
- RLS enabled: `psql "$LOCAL_DB_URL" -c "select relname, relrowsecurity from pg_class where relname in ('recipe_sessions','recipes');"` shows `t` for both.
- Policy count: `psql "$LOCAL_DB_URL" -c "select count(*) from pg_policies where schemaname='public' and tablename in ('recipe_sessions','recipes');"` returns 8; `... where schemaname='storage' and tablename='objects' and policyname like 'session_photos_%'` returns 4.
- Bucket present: `psql "$LOCAL_DB_URL" -c "select id, public from storage.buckets where id='session-photos';"` returns one row, `public = f`.
- Lint passes: `npm run lint`.
- Format clean: `npm run format -- --check`.

#### Manual Verification:

- Open Supabase Studio (`http://127.0.0.1:54323`) → Table Editor shows both tables with the expected columns and CHECK constraints.
- Studio → Storage shows the `session-photos` bucket marked private.
- Re-running `npx supabase db reset` a second time still exits 0 (idempotency check).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: RLS verification

### Overview

Prove the security boundary works before any application code starts using it. Author a checked-in SQL script under the change folder that impersonates two distinct `authenticated` subjects via `set local request.jwt.claims` and demonstrates: (a) cross-user reads on both tables return zero rows; (b) cross-user inserts/updates/deletes fail or affect zero rows; (c) the drift trigger rejects mismatched `recipes.user_id`; (d) cross-user storage path access is blocked. Document the run output inline.

### Changes Required:

#### 1. Verification script

**File**: `context/changes/domain-schema-and-storage/rls-verification.sql`

**Intent**: One self-contained `.sql` file runnable via `psql "$LOCAL_DB_URL" -f rls-verification.sql`. Seeds two auth users via `auth.admin_create_user` equivalent (or direct `insert into auth.users` with synthetic UUIDs), then in successive transactions impersonates each (`set local role authenticated; set local "request.jwt.claims" = '{"sub":"<uuid>","role":"authenticated"}'`) and runs the cross-user matrix. Uses `do $$ ... raise exception if ... $$` blocks so the script exits non-zero on any failure.

**Contract**: Script covers, at minimum:

- User A inserts a `recipe_sessions` row; User B `select` returns zero rows.
- User A inserts a `recipes` row referencing their session; User B `select` returns zero.
- User B's `update recipe_sessions set corrected_items_md='x' where user_id=<A>` reports 0 rows affected.
- User B's `delete from recipes where user_id=<A>` reports 0 rows affected.
- User B's `insert into recipes (..., user_id=<B>, session_id=<A's session>)` raises the drift-trigger exception.
- User B's `insert into recipes (..., user_id=<A>, session_id=<A's session>)` is blocked by RLS `with check`.
- User A inserts a `storage.objects` row under their `{user_id}/...` path → succeeds; same insert under User B's prefix → blocked.
- `cardinality` CHECK rejects an insert with `photo_paths` of length 0 and length 6.
- Final block: cleanup deletes seeded rows.

#### 2. Verification log

**File**: `context/changes/domain-schema-and-storage/rls-verification.md`

**Intent**: One-page log capturing the date, the command run, and the script's final output (a `select 'RLS verified' as status` row or equivalent). Future agents/reviewers can rerun the script anytime; this log is the "we did run it" record for this change.

**Contract**: Plain markdown — header, fenced code block with the full script output, single-paragraph "what this proves" summary referencing the privacy NFR.

### Success Criteria:

#### Automated Verification:

- Script runs to completion: `psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f context/changes/domain-schema-and-storage/rls-verification.sql` exits 0.
- Final assertion row prints: the script's last `select` emits `'RLS verified'`.
- Re-running the script after `npx supabase db reset` still passes (seed/cleanup is self-contained).

#### Manual Verification:

- Visually inspect the verification log to confirm every assertion case from the Contract is exercised in the run output.
- Confirm script does not leave residual rows: `select count(*) from recipe_sessions` + `recipes` + `storage.objects where bucket_id='session-photos'` are all 0 after a clean run.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: TypeScript types

### Overview

Make the new schema visible to the TypeScript compiler so future slices get autocompletion and type errors on column drift. Add an `npm run db:types` script that regenerates from the local Supabase instance; commit the output as `src/db/database.types.ts`.

### Changes Required:

#### 1. Types regeneration script

**File**: `package.json`

**Intent**: Add a `db:types` npm script invoking `npx supabase gen types typescript --local --schema public --schema storage > src/db/database.types.ts`. Use the local DB as the source of truth (requires `supabase start` first; document this).

**Contract**: One new line in `"scripts"`: `"db:types": "supabase gen types typescript --local --schema public > src/db/database.types.ts"`. (Storage types live in a separate generated file in practice — keep this scoped to `public` only; downstream code uses `@supabase/storage-js`'s own types for storage clients.)

#### 2. Generated types file

**File**: `src/db/database.types.ts`

**Intent**: Run `npm run db:types` and commit the output verbatim. This file is generated, not hand-edited — future updates regenerate it.

**Contract**: A file beginning with `export type Json = ...` and exporting `Database` with `Tables.recipe_sessions`, `Tables.recipes`, their Row/Insert/Update variants reflecting the column set from Phase 1. No manual edits.

#### 3. Lint config carve-out (only if needed)

**File**: `eslint.config.js`

**Intent**: If linting flags the generated file (style violations, unused types), add a minimal ignore pattern for `src/db/database.types.ts`. Skip this step if `npm run lint` passes as-is.

**Contract**: At most one entry added to the `ignores` array. If unnecessary, leave the file untouched.

### Success Criteria:

#### Automated Verification:

- Script runs: `npm run db:types` exits 0 and writes `src/db/database.types.ts`.
- File contains expected tables: `grep -q 'recipe_sessions' src/db/database.types.ts && grep -q 'recipes' src/db/database.types.ts`.
- Build passes: `npm run build` exits 0 (Astro check + Vite build).
- Lint + format pass: `npm run lint` and `npm run format -- --check`.

#### Manual Verification:

- Open `src/db/database.types.ts` and confirm `recipe_sessions.Row` includes `recognized_items_md`, `corrected_items_md`, `meal_context`, `photo_paths` typed as `string[]`, and `recipes.Row` includes `name`, `content_md`.
- Confirm `package.json` `db:types` script is documented (a one-line README mention or AGENTS.md entry is sufficient — defer if neither file currently lists scripts).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before considering the change complete.

---

## Testing Strategy

### Unit Tests

- None for this change — there is no application code to unit-test. Schema correctness is asserted via the Phase 2 SQL script.

### Integration Tests

- Phase 2's `rls-verification.sql` is the integration test. It exercises the full RLS surface against a real Postgres instance, which is exactly the regression net CLAUDE.md's "RLS in the same migration" rule asks for. Future slices may promote this into a CI job; out of scope here.

### Manual Testing Steps

1. `npx supabase start` → wait for "Started supabase local development setup".
2. `npx supabase db reset` → migration applies.
3. Open Studio, eyeball schema + bucket.
4. `psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f context/changes/domain-schema-and-storage/rls-verification.sql` → exits 0, prints final assertion row.
5. `npm run db:types && npm run build` → both exit 0.
6. `git diff` → review migration SQL, verify policies are `to authenticated` only (no `anon`).

## Performance Considerations

- Both per-user indexes (`(user_id, created_at desc)`) cover the only listing query slice S-04 will run; no further indexing needed at this stage.
- Length CHECKs are cheap (PG evaluates them per row on write); not a hot path concern at MVP scale.
- The drift trigger does one indexed lookup per insert/update on `recipes` — negligible.

## Migration Notes

- Forward-only: dropping these tables in production requires a separate, explicitly-authored destructive migration. Not part of this change.
- Rollback path: revert the Worker; the DB stays. CLAUDE.md guarantees a Worker rollback does not roll back the DB, which is the whole reason this migration is additive.
- Cloudflare Workers Builds deploys on push to `main`. Supabase migrations run via the CLI pipeline (typically `supabase db push` in a Supabase deploy step) — confirm that pipeline is wired before merging, or coordinate a manual `supabase db push` against the production project.

## References

- Change identity: `context/changes/domain-schema-and-storage/change.md`
- Roadmap entry: `context/foundation/roadmap.md:64` (F-01)
- PRD constraints: FR-003 (1–5 photos, ≤5 MB), FR-009 (session persistence), NFR-Prywatność, Access Control
- Schema decisions (locked): `context/changes/domain-schema-and-storage/change.md` "DB schema decisions (pre-plan)"
- Hard rules: `CLAUDE.md` "Hard Rules" — RLS in same migration, additive migrations, no `wrangler deploy`
- Existing pipeline migration: `supabase/migrations/20260525171800_initial_smoke_test.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Migration + bucket mirror

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db reset` exits 0 — c5724d2
- [x] 1.2 Schema present: `\dt public.*` lists `recipe_sessions` and `recipes` — c5724d2
- [x] 1.3 RLS enabled on both tables — c5724d2
- [x] 1.4 Policy count: 8 table policies + 4 storage policies — c5724d2
- [x] 1.5 Bucket `session-photos` present and `public = false` — c5724d2
- [x] 1.6 Lint passes: `npm run lint` — c5724d2
- [x] 1.7 Format clean: `npm run format -- --check` — c5724d2

#### Manual

- [x] 1.8 Studio Table Editor shows both tables with expected columns and CHECKs — c5724d2
- [x] 1.9 Studio Storage shows `session-photos` bucket marked private — c5724d2
- [x] 1.10 Second `npx supabase db reset` still exits 0 (idempotency) — c5724d2

### Phase 2: RLS verification

#### Automated

- [x] 2.1 Verification script exits 0 under `psql -v ON_ERROR_STOP=1` — 90206e1
- [x] 2.2 Final assertion row prints `'RLS verified'` — 90206e1
- [x] 2.3 Re-run after `supabase db reset` still passes — 90206e1

#### Manual

- [x] 2.4 Verification log captures every assertion case from Contract — 90206e1
- [x] 2.5 No residual rows after clean run — 90206e1

### Phase 3: TypeScript types

#### Automated

- [x] 3.1 `npm run db:types` exits 0 and writes `src/db/database.types.ts`
- [x] 3.2 Generated file contains `recipe_sessions` and `recipes`
- [x] 3.3 `npm run build` exits 0
- [x] 3.4 Lint and format pass

#### Manual

- [x] 3.5 `recipe_sessions.Row` and `recipes.Row` shapes match Phase 1 schema
- [x] 3.6 `db:types` script discoverable to future contributors
