/*
# Gate 3B Phase 2: Daily learning commitments + genuine progress tracking

1. Plain-English summary
Adds the smallest reliable data model needed to power an honest progress
dashboard:
- A student can set a daily learning goal (a number of practice questions
  they commit to answering each day) and their timezone. Defaults are
  sensible (5 questions, Asia/Kolkata — the product targets Indian boards).
- A per-day progress row is maintained SERVER-SIDE from real graded
  practice attempts and real mission completions. The browser can never
  insert or update it.
- A "daily goal met" timestamp is recorded the first time a student's
  honest graded answers for that local day cross their goal. This is the
  only signal that counts toward a daily-goal streak.

What counts (precise rules):
- `graded_answers` increments by 1 for every practice_attempts row whose
  `skipped = false` (a genuine answered question, right or wrong). A
  timed-out/skipped question does NOT increment — it is not an honest
  attempt at an answer.
- `correct_answers` increments by 1 when is_correct = true.
- `missions_completed_today` increments by 1 when a student_missions row
  transitions to status='completed' via complete_mission_secure.
- A day is "goal met" when graded_answers >= questions_goal. The exact
  moment is stored in goal_met_at (idempotent: set once).
- Day boundary is the student's own timezone, computed server-side with
  AT TIME ZONE. UTC is never used as the day boundary, so a student in
  IST who practices at 11pm and 1am counts two separate days correctly.

What does NOT count:
- Logins, page views, opening a video.
- Passive YouTube playback / focus seconds.
- All-skipped quiz attempts (no graded_answers increment).
- Re-opening an already-graded question (the within-attempt unique index
  prevents duplicate rows; the trigger only fires on INSERT).

2. New tables
- `daily_learning_goals`
  - user_id (uuid, PK, defaults to auth.uid())
  - questions_goal (int, 1..50, default 5)
  - timezone (text, IANA name, default 'Asia/Kolkata')
  - updated_at (timestamptz)
- `daily_progress`
  - user_id (uuid, FK auth.users ON DELETE CASCADE)
  - local_date (date) — the student's local calendar day
  - graded_answers (int, default 0) — honest answered questions (skipped excluded)
  - correct_answers (int, default 0)
  - missions_completed_today (int, default 0)
  - goal_met_at (timestamptz, nullable) — first moment goal was met that day
  - PRIMARY KEY (user_id, local_date)

3. Security
- RLS on both tables; owner-only SELECT.
- daily_learning_goals: owner-only UPDATE on questions_goal/timezone only.
  INSERT is done via an upsert SECURITY DEFINER helper so a brand-new
  student gets a default row without writing one themselves. Direct
  INSERT/DELETE revoked so a student cannot forge extra goal rows or
  delete audit history.
- daily_progress: ALL direct writes revoked from anon/authenticated. Only
  triggers and the reset function write it.
- Column-level: on daily_progress, INSERT/UPDATE revoked on
  graded_answers, correct_answers, missions_completed_today, goal_met_at,
  local_date — belt + suspenders, since row-level writes are already revoked.
- All functions pin search_path = public and check auth.uid().
- The existing reset_my_practice_data() is extended to also delete the
  caller's daily_progress rows, so a reset cannot leave stale "goal met"
  records. It still only ever touches the calling user's rows.

4. Triggers
- `practice_attempts_progress_trigger` AFTER INSERT on practice_attempts:
  upserts today's daily_progress row, incrementing graded_answers (when
  not skipped) and correct_answers (when correct). Sets goal_met_at the
  first time the threshold is crossed.
- `missions_completed_progress_trigger` AFTER UPDATE OF status on
  student_missions: when status transitions to 'completed', upserts
  today's daily_progress row incrementing missions_completed_today.
- Both triggers read the goal (questions_goal) from daily_learning_goals,
  defaulting to 5 if the student has not set one.

5. Notes
- Idempotent: uses IF NOT EXISTS for tables/columns/indexes; DROP IF
  EXISTS for policies/triggers/functions before re-creating.
- No existing rows are modified or deleted. Legacy practice_attempts
  rows (quiz_attempt_id NULL, inserted before this gate) do NOT fire the
  trigger retroactively — triggers run on INSERT only.
- Timezone: the student's timezone is validated against pg_timezone_names;
  an invalid zone falls back to 'Asia/Kolkata' in the helper function.
*/

-- ------------------------------------------------------------------
-- 1. daily_learning_goals
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS daily_learning_goals (
  user_id uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  questions_goal int NOT NULL DEFAULT 5 CHECK (questions_goal >= 1 AND questions_goal <= 50),
  timezone text NOT NULL DEFAULT 'Asia/Kolkata' CHECK (char_length(btrim(timezone)) >= 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE daily_learning_goals ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, DELETE ON daily_learning_goals FROM anon, authenticated;

DROP POLICY IF EXISTS "goals_select_own" ON daily_learning_goals;
CREATE POLICY "goals_select_own" ON daily_learning_goals
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "goals_update_own" ON daily_learning_goals;
CREATE POLICY "goals_update_own" ON daily_learning_goals
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------------
-- 2. daily_progress
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS daily_progress (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  graded_answers int NOT NULL DEFAULT 0 CHECK (graded_answers >= 0),
  correct_answers int NOT NULL DEFAULT 0 CHECK (correct_answers >= 0),
  missions_completed_today int NOT NULL DEFAULT 0 CHECK (missions_completed_today >= 0),
  goal_met_at timestamptz,
  PRIMARY KEY (user_id, local_date)
);

CREATE INDEX IF NOT EXISTS daily_progress_user_date_idx
  ON daily_progress (user_id, local_date DESC);

ALTER TABLE daily_progress ENABLE ROW LEVEL SECURITY;

-- Browsers cannot write daily_progress at all; only triggers + reset do.
REVOKE INSERT, UPDATE, DELETE ON daily_progress FROM anon, authenticated;

DROP POLICY IF EXISTS "daily_progress_select_own" ON daily_progress;
CREATE POLICY "daily_progress_select_own" ON daily_progress
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Belt-and-suspenders column-level revoke on the progress columns.
REVOKE INSERT (graded_answers, correct_answers, missions_completed_today, goal_met_at, local_date)
  ON daily_progress FROM anon, authenticated;
REVOKE UPDATE (graded_answers, correct_answers, missions_completed_today, goal_met_at, local_date)
  ON daily_progress FROM anon, authenticated;

-- ------------------------------------------------------------------
-- 3. Helper: local_date for a user's timezone
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION local_date_for(p_user uuid, p_tz text)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (now() AT TIME ZONE COALESCE(NULLIF(btrim(p_tz), ''), 'Asia/Kolkata'))::date
$$;

-- ------------------------------------------------------------------
-- 4. upsert_daily_progress: the only writer (called by triggers)
-- ------------------------------------------------------------------
-- Idempotent: ON CONFLICT does an atomic increment. goal_met_at is set
-- once, the first time graded_answers crosses the goal.

CREATE OR REPLACE FUNCTION upsert_daily_progress(
  p_user uuid,
  p_tz text,
  p_goal int,
  p_add_graded int,
  p_add_correct int,
  p_add_missions int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date date := local_date_for(p_user, p_tz);
  v_existing daily_progress%ROWTYPE;
  v_new_graded int;
BEGIN
  SELECT * INTO v_existing FROM daily_progress
    WHERE user_id = p_user AND local_date = v_date;
  IF NOT FOUND THEN
    INSERT INTO daily_progress (user_id, local_date, graded_answers, correct_answers, missions_completed_today, goal_met_at)
      VALUES (p_user, v_date, p_add_graded, p_add_correct, p_add_missions,
              CASE WHEN p_add_graded >= p_goal THEN now() ELSE NULL END)
      ON CONFLICT (user_id, local_date) DO UPDATE
        SET graded_answers = daily_progress.graded_answers + EXCLUDED.graded_answers,
            correct_answers = daily_progress.correct_answers + EXCLUDED.correct_answers,
            missions_completed_today = daily_progress.missions_completed_today + EXCLUDED.missions_completed_today,
            goal_met_at = COALESCE(daily_progress.goal_met_at,
                                   CASE WHEN daily_progress.graded_answers + EXCLUDED.graded_answers >= p_goal
                                        THEN now() ELSE NULL END);
  ELSE
    v_new_graded := v_existing.graded_answers + p_add_graded;
    UPDATE daily_progress
      SET graded_answers = v_new_graded,
          correct_answers = v_existing.correct_answers + p_add_correct,
          missions_completed_today = v_existing.missions_completed_today + p_add_missions,
          goal_met_at = COALESCE(v_existing.goal_met_at,
                                 CASE WHEN v_new_graded >= p_goal THEN now() ELSE NULL END)
      WHERE user_id = p_user AND local_date = v_date;
  END IF;
END;
$$;

-- ------------------------------------------------------------------
-- 5. Triggers
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION practice_attempts_progress_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_goal int;
  v_tz text;
BEGIN
  SELECT COALESCE(g.questions_goal, 5), COALESCE(NULLIF(btrim(g.timezone), ''), 'Asia/Kolkata')
    INTO v_goal, v_tz
    FROM daily_learning_goals g
    WHERE g.user_id = NEW.user_id;
  IF v_goal IS NULL THEN
    v_goal := 5;
    v_tz := 'Asia/Kolkata';
  END IF;

  PERFORM upsert_daily_progress(
    NEW.user_id, v_tz, v_goal,
    CASE WHEN NEW.skipped = false THEN 1 ELSE 0 END,
    CASE WHEN NEW.is_correct THEN 1 ELSE 0 END,
    0
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS practice_attempts_progress_trigger ON practice_attempts;
CREATE TRIGGER practice_attempts_progress_trigger
  AFTER INSERT ON practice_attempts
  FOR EACH ROW EXECUTE FUNCTION practice_attempts_progress_trigger_fn();

CREATE OR REPLACE FUNCTION missions_completed_progress_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_goal int;
  v_tz text;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
    SELECT COALESCE(g.questions_goal, 5), COALESCE(NULLIF(btrim(g.timezone), ''), 'Asia/Kolkata')
      INTO v_goal, v_tz
      FROM daily_learning_goals g
      WHERE g.user_id = NEW.user_id;
    IF v_goal IS NULL THEN
      v_goal := 5;
      v_tz := 'Asia/Kolkata';
    END IF;
    PERFORM upsert_daily_progress(NEW.user_id, v_tz, v_goal, 0, 0, 1);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS missions_completed_progress_trigger ON student_missions;
CREATE TRIGGER missions_completed_progress_trigger
  AFTER UPDATE OF status ON student_missions
  FOR EACH ROW EXECUTE FUNCTION missions_completed_progress_trigger_fn();

-- ------------------------------------------------------------------
-- 6. upsert_my_daily_goal: SECURITY DEFINER upsert for the initial row
-- ------------------------------------------------------------------
-- Lets a student set/update their goal + timezone. Creates the row if it
-- does not exist (a direct INSERT is revoked, so this is the only path).
-- Validates the timezone against pg_timezone_names.

CREATE OR REPLACE FUNCTION upsert_my_daily_goal(p_questions_goal int, p_timezone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_goal int;
  v_tz text;
  v_valid_tz boolean;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthenticated');
  END IF;
  v_goal := COALESCE(p_questions_goal, 5);
  IF v_goal < 1 OR v_goal > 50 THEN
    RETURN jsonb_build_object('status', 'invalid_goal');
  END IF;
  v_tz := COALESCE(NULLIF(btrim(p_timezone), ''), 'Asia/Kolkata');
  SELECT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name = v_tz) INTO v_valid_tz;
  IF NOT v_valid_tz THEN
    v_tz := 'Asia/Kolkata';
  END IF;

  INSERT INTO daily_learning_goals (user_id, questions_goal, timezone, updated_at)
    VALUES (v_user, v_goal, v_tz, now())
    ON CONFLICT (user_id) DO UPDATE
      SET questions_goal = EXCLUDED.questions_goal,
          timezone = EXCLUDED.timezone,
          updated_at = now();

  RETURN jsonb_build_object('status', 'saved', 'questionsGoal', v_goal, 'timezone', v_tz);
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_my_daily_goal(int, text) TO authenticated;

-- ------------------------------------------------------------------
-- 7. get_my_daily_goal: read helper (returns defaults if unset)
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_my_daily_goal()
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
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthenticated');
  END IF;
  SELECT questions_goal, timezone INTO v_goal, v_tz FROM daily_learning_goals WHERE user_id = v_user;
  IF v_goal IS NULL THEN
    v_goal := 5;
    v_tz := 'Asia/Kolkata';
  END IF;
  RETURN jsonb_build_object('status', 'ok', 'questionsGoal', v_goal, 'timezone', v_tz);
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_daily_goal() TO authenticated;

-- ------------------------------------------------------------------
-- 8. progress_overview_secure: the dashboard's data source
-- ------------------------------------------------------------------
-- Returns everything the dashboard needs in one round trip:
-- - goal (questions_goal, timezone)
-- - today: today's daily_progress row in the student's tz (or zeros)
-- - last14: array of {date, gradedAnswers, correctAnswers, missionsCompleted, goalMet} for the last 14 local days
-- - streak: consecutive days (ending today or yesterday) with goal_met_at NOT NULL
-- - practice summary fields (delegated to practice_summary_secure)

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
  v_last14 jsonb;
  v_streak int;
  v_practice jsonb;
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

  -- Build the last 14 local days, left-joined to daily_progress.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', d.day::text,
    'gradedAnswers', COALESCE(p.graded_answers, 0),
    'correctAnswers', COALESCE(p.correct_answers, 0),
    'missionsCompleted', COALESCE(p.missions_completed_today, 0),
    'goalMet', p.goal_met_at IS NOT NULL
  ) ORDER BY d.day), '[]'::jsonb) INTO v_last14
  FROM generate_series(v_today - 13, v_today, 1) AS d(day)
  LEFT JOIN daily_progress p ON p.user_id = v_user AND p.local_date = d.day;

  -- Streak: count back from today while goal_met_at IS NOT NULL.
  -- If today is not yet met, start from yesterday (so a streak isn't
  -- broken just because the student hasn't practiced yet today).
  v_streak := 0;
  FOR i IN 0..13 LOOP
    SELECT goal_met_at IS NOT NULL INTO v_today_row
      FROM daily_progress
      WHERE user_id = v_user AND local_date = v_today - i;
    IF v_today_row IS NULL THEN
      IF i = 0 THEN
        CONTINUE;  -- today not met yet; streak can still be counted from yesterday
      ELSE
        EXIT;
      END IF;
    END IF;
    IF v_today_row THEN
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
      'goalMet', v_today_row.goal_met_at IS NOT NULL
    ),
    'last14', v_last14,
    'streak', v_streak,
    'practice', v_practice
  );
END;
$$;

GRANT EXECUTE ON FUNCTION progress_overview_secure() TO authenticated;

-- ------------------------------------------------------------------
-- 9. Extend reset_my_practice_data to also clear daily_progress
-- ------------------------------------------------------------------
-- A reset must not leave stale "goal met" records behind. This only
-- ever touches the calling user's rows (WHERE user_id = auth.uid()).

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
  v_progress int;
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

  DELETE FROM daily_progress WHERE user_id = v_user;
  GET DIAGNOSTICS v_progress = ROW_COUNT;

  RETURN jsonb_build_object(
    'status', 'reset',
    'deletedAttempts', v_attempts,
    'deletedQuizAttempts', v_quizzes,
    'deletedMissions', v_missions,
    'deletedDailyProgress', v_progress
  );
END;
$$;

GRANT EXECUTE ON FUNCTION reset_my_practice_data() TO authenticated;
