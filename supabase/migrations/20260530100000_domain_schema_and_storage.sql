-- Domain schema and storage: recipe_sessions, recipes, session-photos bucket.
-- Additive migration — no destructive changes. All tables/policies new.

-- ────────────────────────────────────────────────────────────────────────────
-- Tables
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.recipe_sessions (
  id                   uuid        not null default gen_random_uuid() primary key,
  user_id              uuid        not null references auth.users(id) on delete cascade,
  recognized_items_md  text        not null,
  corrected_items_md   text        not null,
  meal_context         text        not null,
  photo_paths          text[]      not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint recipe_sessions_photo_paths_length
    check (cardinality(photo_paths) between 1 and 5),
  constraint recipe_sessions_recognized_items_md_length
    check (length(recognized_items_md) <= 8000),
  constraint recipe_sessions_corrected_items_md_length
    check (length(corrected_items_md) <= 8000),
  constraint recipe_sessions_meal_context_length
    check (length(meal_context) <= 2000)
);

create index if not exists recipe_sessions_user_id_created_at_idx
  on public.recipe_sessions (user_id, created_at desc);

create table if not exists public.recipes (
  id          uuid        not null default gen_random_uuid() primary key,
  session_id  uuid        not null unique references public.recipe_sessions(id) on delete cascade,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  name        text        not null,
  content_md  text        not null,
  created_at  timestamptz not null default now(),
  constraint recipes_content_md_length
    check (length(content_md) <= 16000)
);

create index if not exists recipes_user_id_created_at_idx
  on public.recipes (user_id, created_at desc);

-- ────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ────────────────────────────────────────────────────────────────────────────

alter table public.recipe_sessions enable row level security;
alter table public.recipes enable row level security;

-- recipe_sessions: 4 per-operation policies for authenticated users only
create policy "recipe_sessions_select" on public.recipe_sessions
  for select to authenticated
  using (auth.uid() = user_id);

create policy "recipe_sessions_insert" on public.recipe_sessions
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "recipe_sessions_update" on public.recipe_sessions
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "recipe_sessions_delete" on public.recipe_sessions
  for delete to authenticated
  using (auth.uid() = user_id);

-- recipes: 4 per-operation policies for authenticated users only
create policy "recipes_select" on public.recipes
  for select to authenticated
  using (auth.uid() = user_id);

create policy "recipes_insert" on public.recipes
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "recipes_update" on public.recipes
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "recipes_delete" on public.recipes
  for delete to authenticated
  using (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────────────────────
-- Trigger functions
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.set_updated_at()
  returns trigger
  language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger recipe_sessions_set_updated_at
  before update on public.recipe_sessions
  for each row
  execute function public.set_updated_at();

-- Drift-prevention: recipes.user_id must always match recipe_sessions.user_id.
-- This is part of the security boundary, not a nicety.
create or replace function public.recipes_assert_user_id_matches_session()
  returns trigger
  language plpgsql
as $$
begin
  if new.user_id <> (select user_id from public.recipe_sessions where id = new.session_id) then
    raise exception
      'recipes.user_id (%) must match recipe_sessions.user_id for session %',
      new.user_id, new.session_id;
  end if;
  return new;
end;
$$;

create trigger recipes_user_id_drift_guard
  before insert or update on public.recipes
  for each row
  execute function public.recipes_assert_user_id_matches_session();

-- ────────────────────────────────────────────────────────────────────────────
-- Storage bucket
-- ────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
  values ('session-photos', 'session-photos', false)
  on conflict (id) do nothing;

-- Storage RLS: path convention {user_id}/{session_id}/{uuid}.{ext}
-- First path segment is the owner's user_id — all 4 policies key on it.

create policy "session_photos_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'session-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "session_photos_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'session-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "session_photos_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'session-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "session_photos_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'session-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
