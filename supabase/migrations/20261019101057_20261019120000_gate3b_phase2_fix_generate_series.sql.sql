/*
# Gate 3B Phase 2 fix: generate_series interval for date type

1. Summary
The progress_overview_secure function used generate_series(date, date, 1)
which fails — Postgres requires `integer` step only for integer ranges,
not dates. For date ranges the step must be an interval. This replaces
the call with generate_series(v_today - 13, v_today, interval '1 day')
and casts d.day back to date for the join.

2. Changes
- Replaces progress_overview_secure with a corrected version.
- No schema, policy, or data changes.

3. Notes
- Idempotent (CREATE OR REPLACE).
*/

CREATE OR REPLACE FUNCTION progress_overview_secure()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_goal int;
  v_tz text;
  v_today date;
  v_today_row daily_progress%ROWTYPE;
  v_today_met boolean;
  v_last14 jsonb;
  v_streak int;
  v_practice jsonb;
  v_met boolean;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthenticated');
  END IF;

  SELECT questions_goal, timezone INTO v_goal, v_tz FROM daily_learning_goals WHERE user_id = v_user;
  IF v_goal IS NULL THEN
    v_goal := 5;
    v_tz := 'Asia/Kolkata';
  END IF;

  v_today := local_date_for(v_user, v_tz);

  SELECT * INTO v_today_row FROM daily_progress
    WHERE user_id = v_user AND local_date = v_today;
  v_today_met := v_today_row.goal_met_at IS NOT NULL;

  -- Build the last 14 local days, left-joined to daily_progress.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', d.day::text,
    'gradedAnswers', COALESCE(p.graded_answers, 0),
    'correctAnswers', COALESCE(p.correct_answers, 0),
    'missionsCompleted', COALESCE(p.missions_completed_today, 0),
    'goalMet', p.goal_met_at IS NOT NULL
  ) ORDER BY d.day), '[]'::jsonb) INTO v_last14
  FROM generate_series(v_today - 13, v_today, interval '1 day') AS d(day)
  LEFT JOIN daily_progress p ON p.user_id = v_user AND p.local_date = d.day::date;

  -- Streak: count back from today while goal_met_at IS NOT NULL.
  -- If today is not yet met, start from yesterday (so a streak isn't
  -- broken just because the student hasn't practiced yet today).
  v_streak := 0;
  FOR i IN 0..13 LOOP
    SELECT goal_met_at IS NOT NULL INTO v_met
      FROM daily_progress
      WHERE user_id = v_user AND local_date = v_today - i;
    IF v_met IS NULL THEN
      IF i = 0 THEN
        CONTINUE;
      ELSE
        EXIT;
      END IF;
    END IF;
    IF v_met THEN
      v_streak := v_streak + 1;
    ELSE
      IF i = 0 THEN
        CONTINUE;
      ELSE
        EXIT;
      END IF;
    END IF;
  END LOOP;

  SELECT * INTO v_practice FROM practice_summary_secure();

  RETURN jsonb_build_object(
    'status', 'ok',
    'goal', jsonb_build_object('questionsGoal', v_goal, 'timezone', v_tz),
    'today', jsonb_build_object(
      'date', v_today::text,
      'gradedAnswers', COALESCE(v_today_row.graded_answers, 0),
      'correctAnswers', COALESCE(v_today_row.correct_answers, 0),
      'missionsCompleted', COALESCE(v_today_row.missions_completed_today, 0),
      'goalMet', v_today_met
    ),
    'last14', v_last14,
    'streak', v_streak,
    'practice', v_practice
  );
END;
$$;

GRANT EXECUTE ON FUNCTION progress_overview_secure() TO authenticated;
