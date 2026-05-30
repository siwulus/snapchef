---
change_id: domain-schema-and-storage
title: Domain schema and storage
status: implemented
created: 2026-05-27
updated: 2026-05-30
archived_at: null
---

## Notes

### DB schema decisions (pre-plan)

Outcome of a planning discussion on 2026-05-27. Locks the data-model shape so `/10x-plan` does not re-litigate it.

**Core decision:** everything user-facing is **markdown free text**. Recognition output, user-edited corrections, and the generated recipe are all stored as markdown strings. No JSONB, no structured arrays for content. Rationale: matches the planned UX (single multiline textarea for recognized-items review; mobile-friendly editing with voice/typing instead of jumping between form fields) and the LLM-friendly principle (let the model produce its strongest natural-language output; quality > strict structure).

**Both raw and corrected recognition are persisted** on the session row — the raw LLM output for audit/debug, the user-edited markdown as the actual input to recipe generation.

#### `recipe_sessions` (input side — FR-009)

| Column                | Type                                                     | Notes                                                                                                                      |
| --------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | `uuid` PK, default `gen_random_uuid()`                   | Session identity; reused as `{session_id}` segment in Storage path.                                                        |
| `user_id`             | `uuid` NOT NULL, FK → `auth.users(id) ON DELETE CASCADE` | Owner; RLS gates on `auth.uid() = user_id`.                                                                                |
| `recognized_items_md` | `text` NOT NULL                                          | Raw markdown returned by recognition LLM (S-01), verbatim. Never edited after write.                                       |
| `corrected_items_md`  | `text` NOT NULL                                          | User's edited markdown after FR-005; input to recipe generation (S-02). On first write may equal `recognized_items_md`.    |
| `meal_context`        | `text` NOT NULL                                          | Free-text meal context (FR-006).                                                                                           |
| `photo_paths`         | `text[]` NOT NULL                                        | Ordered Storage object paths (`{user_id}/{session_id}/{uuid}.{ext}`). CHECK `cardinality BETWEEN 1 AND 5` enforces FR-003. |
| `created_at`          | `timestamptz` NOT NULL default `now()`                   |                                                                                                                            |
| `updated_at`          | `timestamptz` NOT NULL default `now()`                   | Trigger-maintained; bumped on `corrected_items_md` edits.                                                                  |

Length guards: `CHECK (length(recognized_items_md) <= 8000)`, same for `corrected_items_md`; `CHECK (length(meal_context) <= 2000)`. Tunable.

Indexes: `recipe_sessions (user_id, created_at desc)`.

#### `recipes` (output side — FR-007, FR-008)

| Column       | Type                                                                 | Notes                                                                                                                      |
| ------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `id`         | `uuid` PK, default `gen_random_uuid()`                               | S-04 detail screen deep-links to this.                                                                                     |
| `session_id` | `uuid` NOT NULL UNIQUE, FK → `recipe_sessions(id) ON DELETE CASCADE` | Enforces 1:1; deleting the session cascades to the recipe.                                                                 |
| `user_id`    | `uuid` NOT NULL, FK → `auth.users(id) ON DELETE CASCADE`             | Denormalized owner so RLS is flat per-row and S-04 listing needs no join. Drift prevented by trigger.                      |
| `name`       | `text` NOT NULL                                                      | Dish name. Extracted at save time (LLM side-output or first `#` heading). Avoids parsing markdown on every listing render. |
| `content_md` | `text` NOT NULL                                                      | Full recipe markdown — intro, ingredients, steps, tips, summary, whatever the LLM emits. Rendered as markdown on detail.   |
| `created_at` | `timestamptz` NOT NULL default `now()`                               | Ordering for S-04 listings.                                                                                                |

Length guard: `CHECK (length(content_md) <= 16000)`. Tunable.

Indexes: `recipes (user_id, created_at desc)` — covers S-04 listing.

#### Storage

- Single private bucket (proposed id: `session-photos`, `public = false`).
- Object key convention: `{user_id}/{session_id}/{uuid}.{ext}` — load-bearing for RLS.
- Storage RLS: 4 policies (select/insert/update/delete) on `storage.objects` keyed on `auth.uid()::text = (storage.foldername(name))[1]`.
- `recipe_sessions.photo_paths` stores these object keys verbatim.

#### RLS posture

For each of `recipe_sessions` and `recipes`:

- `enable row level security`.
- 4 policies (SELECT/INSERT/UPDATE/DELETE), `authenticated` role, `auth.uid() = user_id` as both `USING` and `WITH CHECK`.
- No `anon` policies — anonymous gets nothing.

#### Drift-prevention trigger

`BEFORE INSERT OR UPDATE` on `recipes` asserts `NEW.user_id = (SELECT user_id FROM recipe_sessions WHERE id = NEW.session_id)`. Defense in depth for the denormalized `user_id`.

#### Delete semantics

- S-04 delete (FR-012) deletes the **session** row.
- `ON DELETE CASCADE` removes the recipe.
- Same API endpoint deletes Storage objects under `{user_id}/{session_id}/` (app-level — Postgres doesn't reach Storage).
- One delete path; no soft-delete (PRD Non-Goals).

#### Migration shape

Single migration file `supabase/migrations/<timestamp>_domain_schema_and_storage.sql`. Additive / non-destructive per CLAUDE.md hard rule. Contains: both `create table`, `enable rls` on both, 8 table RLS policies, bucket insert, 4 Storage RLS policies, drift-prevention trigger + function, `updated_at` trigger.

#### Explicitly chosen against

- JSONB for items/ingredients/steps — everything is markdown text.
- A `recognized_items` child table — two text columns on the session instead.
- A `session_photos` table — `text[]` on the session instead.
- Soft-delete / undo (PRD Non-Goals).
- Per-photo metadata (mime, size).
