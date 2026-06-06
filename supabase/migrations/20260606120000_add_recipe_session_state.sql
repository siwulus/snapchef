-- Add state lifecycle column to recipe_sessions; relax NOT NULL constraints
-- that block inserting an empty session row before recognition completes.
-- Additive + backward-compatible: old Worker code never reads `state` and always
-- writes the md columns, so DROP NOT NULL + a defaulted new column are safe on rollback.

-- 1. New state column with CHECK constraint
alter table public.recipe_sessions
  add column if not exists state text not null default 'created'
  constraint recipe_sessions_state_check
    check (state in ('created', 'photos_uploaded', 'products_recognized', 'recipe_generated', 'saved'));

-- 2. Relax NOT NULL on columns that don't exist at session creation time
alter table public.recipe_sessions
  alter column recognized_items_md drop not null;

alter table public.recipe_sessions
  alter column corrected_items_md drop not null;

alter table public.recipe_sessions
  alter column meal_context drop not null;

-- 3. Allow empty photo_paths array (created state has no photos yet)
alter table public.recipe_sessions
  alter column photo_paths set default '{}';

-- 4. Replace the 1–5 cardinality check with a ≤5 check (empty is now valid)
alter table public.recipe_sessions
  drop constraint if exists recipe_sessions_photo_paths_length;

alter table public.recipe_sessions
  add constraint recipe_sessions_photo_paths_length
    check (cardinality(photo_paths) <= 5);
