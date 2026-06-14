-- Photos table + JSON item columns: normalize per-photo recognition results.
--
-- DESTRUCTIVE / NON-ADDITIVE BY DESIGN. This migration drops `photo_paths`,
-- `recognized_items_md`, and `corrected_items_md` from `recipe_sessions` and
-- retypes the item data to jsonb, plus introduces a child `photos` table.
-- It intentionally OVERRIDES the CLAUDE.md additive-only / backward-compatible
-- migration rule, authorized explicitly by the change brief
-- (context/changes/photo-upload-and-recognition): there is no production data,
-- the local/CI DB is fully reset, and no deployed Worker depends on the old shape.
-- A Worker rollback would NOT restore the dropped columns — accepted for this change.

-- ────────────────────────────────────────────────────────────────────────────
-- photos table (1:n with recipe_sessions)
-- ────────────────────────────────────────────────────────────────────────────

create table public.photos (
  id                 uuid        not null default gen_random_uuid() primary key,
  session_id         uuid        not null references public.recipe_sessions(id) on delete cascade,
  user_id            uuid        not null references auth.users(id) on delete cascade,
  storage_path       text        not null,
  storage_object_id  text,
  content_type       text,
  size_bytes         bigint,
  original_filename  text,
  recognized_items   jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index photos_session_id_idx on public.photos (session_id);
create index photos_user_id_idx on public.photos (user_id);

-- ────────────────────────────────────────────────────────────────────────────
-- Row Level Security — mirror recipes: direct user_id + 4 per-operation policies
-- ────────────────────────────────────────────────────────────────────────────

alter table public.photos enable row level security;

create policy "photos_select" on public.photos
  for select to authenticated
  using (auth.uid() = user_id);

create policy "photos_insert" on public.photos
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "photos_update" on public.photos
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "photos_delete" on public.photos
  for delete to authenticated
  using (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────────────────────
-- Triggers
-- ────────────────────────────────────────────────────────────────────────────

-- updated_at maintenance reuses the shared function from the base migration.
create trigger photos_set_updated_at
  before update on public.photos
  for each row
  execute function public.set_updated_at();

-- Drift-prevention: photos.user_id must always match recipe_sessions.user_id.
-- This is part of the security boundary, not a nicety (copied from recipes).
create or replace function public.photos_assert_user_id_matches_session()
  returns trigger
  language plpgsql
as $$
begin
  if new.user_id <> (select user_id from public.recipe_sessions where id = new.session_id) then
    raise exception
      'photos.user_id (%) must match recipe_sessions.user_id for session %',
      new.user_id, new.session_id;
  end if;
  return new;
end;
$$;

create trigger photos_user_id_drift_guard
  before insert or update on public.photos
  for each row
  execute function public.photos_assert_user_id_matches_session();

-- ────────────────────────────────────────────────────────────────────────────
-- recipe_sessions reshape: drop denormalized photo_paths + md columns,
-- add jsonb item columns
-- ────────────────────────────────────────────────────────────────────────────

-- Drop the column-length / cardinality checks before dropping their columns.
alter table public.recipe_sessions
  drop constraint if exists recipe_sessions_photo_paths_length;

alter table public.recipe_sessions
  drop constraint if exists recipe_sessions_recognized_items_md_length;

alter table public.recipe_sessions
  drop constraint if exists recipe_sessions_corrected_items_md_length;

alter table public.recipe_sessions
  drop column if exists photo_paths;

alter table public.recipe_sessions
  drop column if exists recognized_items_md;

alter table public.recipe_sessions
  drop column if exists corrected_items_md;

alter table public.recipe_sessions
  add column recognized_items jsonb;

alter table public.recipe_sessions
  add column corrected_items jsonb;
