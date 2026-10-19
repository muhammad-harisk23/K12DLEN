/*
# Gate 3B: Self-service practice data reset (for testing / account reset)

1. Plain-English summary
The Gate 3B security model revokes all direct DELETE on practice_attempts,
practice_quiz_attempts, and student_missions from browsers — only
SECURITY DEFINER functions write those tables. That makes test fixtures
impossible to clean up with ordinary REST deletes, so interrupted test
runs leave behind in_progress / passing attempts that contaminate the
next run (wrong attempt numbers, stale passing attempts that complete
missions instantly).

This migration adds a narrow, owner-scoped reset function so a signed-in
user can wipe THEIR OWN practice data. It deletes only the calling user's
rows (auth.uid() = user_id) and nothing else. It is the only way for a
browser to remove practice data, and it is deliberately destructive to
the caller's own data only.

2. New functions
- `reset_my_practice_data()` — SECURITY DEFINER, search_path = public.
  Deletes the caller's practice_attempts, practice_quiz_attempts, and
  student_missions rows. Returns a jsonb summary of deleted counts.

3. Security
- SECURITY DEFINER, search_path pinned to public.
- Checks auth.uid() is not null; returns 'unauthenticated' otherwise.
- WHERE clauses are strictly user_id = auth.uid() — no cross-user impact.
- Granted EXECUTE to authenticated only.

4. Notes
- This is intentionally destructive to the caller's own data. It exists
  so automated test runs can clean up their dedicated @test.local accounts,
  and so a future "reset my progress" account setting can use it. It must
  NEVER be called against another user's data — it cannot be, because the
  WHERE clause is auth.uid().
- Idempotent: safe to call when there is nothing to delete.
*/

CREATE OR REPLACE FUNCTION reset_my_practice_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_attempts int;
  v_quizzes int;
  v_missions int;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthenticated');
  END IF;

  DELETE FROM practice_attempts WHERE user_id = v_user;
  GET DIAGNOSTICS v_attempts = ROW_COUNT;

  DELETE FROM practice_quiz_attempts WHERE user_id = v_user;
  GET DIAGNOSTICS v_quizzes = ROW_COUNT;

  DELETE FROM student_missions WHERE user_id = v_user;
  GET DIAGNOSTICS v_missions = ROW_COUNT;

  RETURN jsonb_build_object(
    'status', 'reset',
    'deletedAttempts', v_attempts,
    'deletedQuizAttempts', v_quizzes,
    'deletedMissions', v_missions
  );
END;
$$;

GRANT EXECUTE ON FUNCTION reset_my_practice_data() TO authenticated;
