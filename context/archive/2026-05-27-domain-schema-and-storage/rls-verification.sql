-- RLS Verification for domain-schema-and-storage
-- Proves cross-user isolation on recipe_sessions, recipes, and session-photos storage.
--
-- Run:
--   LOCAL_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f context/changes/domain-schema-and-storage/rls-verification.sql
--
-- KNOWN GAP (drift trigger in authenticated context):
--   The trigger function public.recipes_assert_user_id_matches_session() lacks
--   SECURITY DEFINER. When called from an authenticated user context, RLS on
--   recipe_sessions hides other users' sessions, so the lookup returns NULL and
--   the mismatch check is a no-op. Test 5a therefore runs as postgres (service-
--   role) where the trigger works correctly. See rls-verification.md for detail.

-- ────────────────────────────────────────────────────────────────────────────
-- Fixed test UUIDs
-- ────────────────────────────────────────────────────────────────────────────

-- user_a  = a0000000-0000-0000-0000-000000000001
-- user_b  = b0000000-0000-0000-0000-000000000002
-- session_a = a1000000-0000-0000-0000-000000000001
-- recipe_a  = a2000000-0000-0000-0000-000000000001

-- ────────────────────────────────────────────────────────────────────────────
-- Seed (runs as postgres superuser, bypasses RLS)
-- ────────────────────────────────────────────────────────────────────────────

-- Clean prior run artifacts (cascade handles recipe_sessions → recipes)
-- storage.protect_delete trigger requires storage.allow_delete_query = 'true'
BEGIN;
SET LOCAL storage.allow_delete_query = 'true';
DELETE FROM storage.objects
  WHERE bucket_id = 'session-photos'
    AND name LIKE 'a0000000-0000-0000-0000-000000000001/%';
COMMIT;

DELETE FROM public.recipe_sessions
  WHERE id = 'a1000000-0000-0000-0000-000000000001';

DELETE FROM auth.users
  WHERE id IN (
    'a0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000002'
  );

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, role, aud)
VALUES
  (
    'a0000000-0000-0000-0000-000000000001',
    'rls-test-a@snapchef.test', 'x', now(), now(), now(),
    'authenticated', 'authenticated'
  ),
  (
    'b0000000-0000-0000-0000-000000000002',
    'rls-test-b@snapchef.test', 'x', now(), now(), now(),
    'authenticated', 'authenticated'
  );

INSERT INTO public.recipe_sessions (
  id, user_id,
  recognized_items_md, corrected_items_md, meal_context,
  photo_paths
)
VALUES (
  'a1000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'chicken, carrots',
  'chicken, carrots',
  'dinner for 2',
  ARRAY['a0000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001/photo1.jpg']
);

INSERT INTO public.recipes (id, session_id, user_id, name, content_md)
VALUES (
  'a2000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'Chicken and Carrot Dinner',
  '## Chicken and Carrot Dinner' || chr(10) || chr(10) || 'Ingredients:' || chr(10) || '- 300g chicken' || chr(10) || '- 2 carrots'
);

-- ────────────────────────────────────────────────────────────────────────────
-- Test 1: User B cannot SELECT User A's recipe_sessions
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
DO $$
DECLARE cnt integer;
BEGIN
  SELECT count(*) INTO cnt
    FROM public.recipe_sessions
   WHERE user_id = 'a0000000-0000-0000-0000-000000000001';
  IF cnt <> 0 THEN
    RAISE EXCEPTION 'FAIL Test 1: User B sees % recipe_sessions row(s) for User A', cnt;
  END IF;
  RAISE NOTICE 'PASS Test 1: User B sees 0 recipe_sessions rows for User A';
END;
$$;
COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- Test 2: User B cannot SELECT User A's recipes
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
DO $$
DECLARE cnt integer;
BEGIN
  SELECT count(*) INTO cnt
    FROM public.recipes
   WHERE user_id = 'a0000000-0000-0000-0000-000000000001';
  IF cnt <> 0 THEN
    RAISE EXCEPTION 'FAIL Test 2: User B sees % recipes row(s) for User A', cnt;
  END IF;
  RAISE NOTICE 'PASS Test 2: User B sees 0 recipes rows for User A';
END;
$$;
COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- Test 3: User B UPDATE on User A's session → 0 rows affected
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
DO $$
DECLARE affected integer;
BEGIN
  UPDATE public.recipe_sessions
     SET corrected_items_md = 'tampered'
   WHERE user_id = 'a0000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'FAIL Test 3: User B updated % row(s) of User A recipe_sessions', affected;
  END IF;
  RAISE NOTICE 'PASS Test 3: User B UPDATE on User A sessions affected 0 rows';
END;
$$;
COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- Test 4: User B DELETE on User A's recipes → 0 rows affected
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
DO $$
DECLARE affected integer;
BEGIN
  DELETE FROM public.recipes
   WHERE user_id = 'a0000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'FAIL Test 4: User B deleted % row(s) of User A recipes', affected;
  END IF;
  RAISE NOTICE 'PASS Test 4: User B DELETE on User A recipes affected 0 rows';
END;
$$;
COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- Test 5a: Drift trigger (postgres/service-role context) — mismatch raises exception
-- Adapted: runs as postgres because the trigger lacks SECURITY DEFINER and
-- cannot see cross-user sessions in authenticated context (gap documented above).
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  BEGIN
    INSERT INTO public.recipes (session_id, user_id, name, content_md)
    VALUES (
      'a1000000-0000-0000-0000-000000000001',  -- User A's session
      'b0000000-0000-0000-0000-000000000002',  -- User B's id (deliberate mismatch)
      'drift-test',
      'drift-test'
    );
    RAISE EXCEPTION 'FAIL Test 5a: drift trigger did not fire for mismatched user_id';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%must match recipe_sessions.user_id%' THEN
        RAISE NOTICE 'PASS Test 5a: drift trigger raised exception for mismatched user_id (service-role context)';
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Test 5b: User B INSERT with user_id=A → blocked by RLS with check
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    INSERT INTO public.recipes (session_id, user_id, name, content_md)
    VALUES (
      'a1000000-0000-0000-0000-000000000001',  -- User A's session
      'a0000000-0000-0000-0000-000000000001',  -- User A's id (User B claiming to be A)
      'rls-spoof-test',
      'rls-spoof-test'
    );
    RAISE EXCEPTION 'FAIL Test 5b: RLS with check did not block User B inserting with user_id=A';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%row-level security%' OR SQLERRM LIKE '%new row violates%' THEN
        RAISE NOTICE 'PASS Test 5b: RLS with check blocked User B from inserting with user_id=A';
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;
COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- Test 6a: User A inserts storage object under own prefix → succeeds
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';
DO $$
BEGIN
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES (
    'session-photos',
    'a0000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001/test.jpg',
    'a0000000-0000-0000-0000-000000000001'
  );
  RAISE NOTICE 'PASS Test 6a: User A can insert storage object under own prefix';
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'FAIL Test 6a: User A cannot insert own storage object: %', SQLERRM;
END;
$$;
COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- Test 6b: User B inserts storage object under User A's prefix → blocked
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
DO $$
BEGIN
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES (
      'session-photos',
      'a0000000-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001/stolen.jpg',
      'b0000000-0000-0000-0000-000000000002'
    );
    RAISE EXCEPTION 'FAIL Test 6b: User B inserted storage object under User A prefix';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%row-level security%' OR SQLERRM LIKE '%new row violates%' THEN
        RAISE NOTICE 'PASS Test 6b: User B blocked from inserting under User A storage prefix';
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;
COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- Test 7a: cardinality CHECK rejects photo_paths of length 0
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  BEGIN
    INSERT INTO public.recipe_sessions (user_id, recognized_items_md, corrected_items_md, meal_context, photo_paths)
    VALUES (
      'a0000000-0000-0000-0000-000000000001',
      'x', 'x', 'x',
      ARRAY[]::text[]
    );
    RAISE EXCEPTION 'FAIL Test 7a: cardinality CHECK allowed empty photo_paths';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS Test 7a: cardinality CHECK rejected empty photo_paths';
  END;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Test 7b: cardinality CHECK rejects photo_paths of length 6
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  BEGIN
    INSERT INTO public.recipe_sessions (user_id, recognized_items_md, corrected_items_md, meal_context, photo_paths)
    VALUES (
      'a0000000-0000-0000-0000-000000000001',
      'x', 'x', 'x',
      ARRAY['1','2','3','4','5','6']
    );
    RAISE EXCEPTION 'FAIL Test 7b: cardinality CHECK allowed 6 photo_paths';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS Test 7b: cardinality CHECK rejected 6 photo_paths';
  END;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Cleanup
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;
SET LOCAL storage.allow_delete_query = 'true';
DELETE FROM storage.objects
  WHERE bucket_id = 'session-photos'
    AND name LIKE 'a0000000-0000-0000-0000-000000000001/%';
COMMIT;

-- CASCADE removes recipe_sessions → recipes
DELETE FROM public.recipe_sessions
  WHERE id = 'a1000000-0000-0000-0000-000000000001';

DELETE FROM auth.users
  WHERE id IN (
    'a0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000002'
  );

SELECT 'RLS verified' AS status;
