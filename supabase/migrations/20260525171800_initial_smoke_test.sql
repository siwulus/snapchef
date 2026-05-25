-- Initial smoke-test migration.
-- Purpose: exercise the migration pipeline (supabase db push -> production project)
-- end-to-end before any domain tables exist. Does NOT create user-facing schema.
-- Domain tables (with RLS + per-operation policies) ship in follow-up migrations.

comment on schema public is 'snapchef: production schema (smoke-test migration applied)';
