-- Add the off-list-ingredients toggle to recipe_sessions for provenance.
--
-- ADDITIVE / NULLABLE / NON-DESTRUCTIVE (CLAUDE.md hard rule): a single nullable
-- column with no default and no NOT NULL constraint. A Worker rollback leaves the
-- DB valid, and existing rows read as NULL (→ domain `null`). Existing per-row RLS
-- policies on recipe_sessions already cover the new column, so no policy change.

alter table public.recipe_sessions
  add column if not exists allow_extra_ingredients boolean;
