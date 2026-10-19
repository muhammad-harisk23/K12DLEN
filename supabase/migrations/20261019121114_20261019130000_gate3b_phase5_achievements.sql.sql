/*
# Gate 3B Phase 5: Achievement Badges — server-derived eligibility

## Summary
Adds a SECURITY DEFINER function `my_achievements_secure()` that derives
three launch badges from existing authoritative records. No new badge
table is created — earned status and timestamps are computed live from
the same server-graded data the application already trusts.

## Badges
1. **First Mission** — earned when the student has ≥1 completed mission
   in `student_missions` (status='completed'). Earned_at = earliest
   completed_at timestamp.

2. **Practice Finisher** — earned when the student has ≥1 completed
   practice quiz attempt in `practice_quiz_attempts` (status='completed',
   all questions answered including skipped ones per finish_practice_attempt
   logic). Earned_at = earliest completed_at timestamp.

3. **Personal Best** — earned when the student has ≥2 completed attempts
   for the same topic and a later attempt scored strictly higher
   (score_correct) than all earlier completed attempts for that topic.
   Earned_at = completed_at of the first attempt that exceeded the prior best.

## Security
- SECURITY DEFINER, search_path = public — runs with the function owner's
  privileges, not the caller's, so it can read the user's own rows.
- Only queries rows WHERE user_id = auth.uid() — no cross-user access.
- Returns badge definitions as a static array; earned status/timestamps
  are derived, never user-insertable.
- GRANT EXECUTE TO authenticated only — anon cannot call it.
- reset_my_practice_data() deletes the underlying records, so all derived
  badges automatically re-lock — consistent by design.

## No new tables
This migration creates no new tables and modifies no existing tables.
It only adds one function. Badge earned status is always a live computation
from authoritative records, making forgery impossible from the client.
*/

CREATE OR REPLACE FUNCTION my_achievements_secure()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_first_mission_at timestamptz;
  v_first_practice_at timestamptz;
  v_personal_best_at timestamptz;
  v_personal_best_topic text;
  v_personal_best_score int;
  v_personal_best_total int;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthenticated');
  END IF;

  -- Badge 1: First Mission — earliest completed mission timestamp
  SELECT MIN(completed_at) INTO v_first_mission_at
    FROM student_missions
    WHERE user_id = v_user AND status = 'completed';

  -- Badge 2: Practice Finisher — earliest completed quiz attempt
  SELECT MIN(completed_at) INTO v_first_practice_at
    FROM practice_quiz_attempts
    WHERE user_id = v_user AND status = 'completed';

  -- Badge 3: Personal Best — find the first attempt that strictly beat
  -- all earlier completed attempts for the same topic.
  -- We scan completed attempts ordered by completed_at; for each, check
  -- whether its score_correct exceeds the max of all earlier completed
  -- attempts for the same topic. The first such row earns the badge.
  SELECT qa.completed_at, qa.topic_slug, qa.score_correct, qa.score_total
    INTO v_personal_best_at, v_personal_best_topic, v_personal_best_score, v_personal_best_total
    FROM practice_quiz_attempts qa
    WHERE qa.user_id = v_user
      AND qa.status = 'completed'
      AND qa.completed_at IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM practice_quiz_attempts earlier
        WHERE earlier.user_id = v_user
          AND earlier.status = 'completed'
          AND earlier.topic_slug = qa.topic_slug
          AND earlier.completed_at < qa.completed_at
      )
      AND qa.score_correct > COALESCE(
        (
          SELECT MAX(earlier.score_correct)
          FROM practice_quiz_attempts earlier
          WHERE earlier.user_id = v_user
            AND earlier.status = 'completed'
            AND earlier.topic_slug = qa.topic_slug
            AND earlier.completed_at < qa.completed_at
        ),
        -1
      )
    ORDER BY qa.completed_at ASC
    LIMIT 1;

  RETURN jsonb_build_object(
    'status', 'ok',
    'badges', jsonb_build_array(
      jsonb_build_object(
        'slug', 'first_mission',
        'name', 'First Mission',
        'description', 'Completed your first validated study mission.',
        'earned', v_first_mission_at IS NOT NULL,
        'earnedAt', v_first_mission_at
      ),
      jsonb_build_object(
        'slug', 'practice_finisher',
        'name', 'Practice Finisher',
        'description', 'Finished a complete practice attempt — every question answered.',
        'earned', v_first_practice_at IS NOT NULL,
        'earnedAt', v_first_practice_at
      ),
      jsonb_build_object(
        'slug', 'personal_best',
        'name', 'Personal Best',
        'description', 'Beat your previous best score on the same topic.',
        'earned', v_personal_best_at IS NOT NULL,
        'earnedAt', v_personal_best_at,
        'topicSlug', v_personal_best_topic,
        'bestScore', v_personal_best_score,
        'bestTotal', v_personal_best_total
      )
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION my_achievements_secure() TO authenticated;
