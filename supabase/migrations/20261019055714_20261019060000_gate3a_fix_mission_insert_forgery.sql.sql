/*
# Gate 3A security fix: prevent forged mission completions

1. Plain-English summary
The original INSERT policy on `student_missions` only checked that the row
belonged to the signing-in student. It did NOT check the mission's status,
so an authenticated student could insert a mission directly with
status='completed' and completed_at=now() — a forged completion that would
inflate their "missions completed" record without answering any practice
questions. This migration closes that hole.

2. Security changes
- `student_missions` INSERT policy now requires status='active' and
  completed_at IS NULL: students can only create fresh, active missions
  through the REST API. Completion remains exclusively the job of
  complete_mission_secure, which validates real graded attempts.
- Column-level privilege revoke: direct INSERT permission is removed for
  the `status` and `completed_at` columns for anon and authenticated, so
  even a crafted REST payload cannot set completion state.
- Re-applies idempotently (DROP POLICY IF EXISTS first).

3. Notes
- No data is changed. Existing missions keep their state.
- The RLS ownership policies (select/insert/delete own) are unchanged.
*/

DROP POLICY IF EXISTS "missions_insert_own" ON student_missions;

CREATE POLICY "missions_insert_own" ON student_missions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND status = 'active' AND completed_at IS NULL);

REVOKE INSERT (status, completed_at) ON student_missions FROM anon, authenticated;
