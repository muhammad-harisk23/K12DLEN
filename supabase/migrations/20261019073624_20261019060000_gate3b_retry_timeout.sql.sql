/*
# Gate 3B Phase 1: Retake after failure + honest timeout

1. Plain-English summary
The Gate 3A model made the first graded answer final forever: a student who
scored under 80% could never complete that mission, because
practice_attempts enforced UNIQUE(user_id, question_id) and
complete_mission_secure counted every all-time attempt as one pool. Separately,
when the per-question timer expired the UI called submit_practice_attempt with
selected_index = -1, which failed the 0-3 CHECK and recorded NO attempt row —
so a timed-out question silently stayed unanswered and blocked completion,
while the UI told the student it "counted as missed."

This migration introduces a narrow, auditable retry design and makes timeouts
real:

- A new parent table `practice_quiz_attempts` groups one deliberate practice
  pass through a topic. The server assigns attempt_number; the client cannot.
- Per-question answers in `practice_attempts` now reference a quiz attempt.
  Prior attempts are preserved exactly — nothing is deleted or overwritten.
- A student may start a NEW deliberate attempt only when no attempt is
  already in_progress for that topic (no parallel grinding), and every
  attempt is graded server-side and finalized by `finish_practice_attempt`,
  which computes score_correct / score_total / is_passing from that one
  attempt's rows only — never a best-of across attempts.
- `complete_mission_secure` now completes a mission only when a genuinely
  completed, passing quiz attempt exists for the mission's topic. No
  combination of answers across attempts can qualify.
- Timeouts are recorded as skipped (selected_index NULL, is_correct false)
  via the new submit signature, so they count as incorrect and can never
  inflate achievement.
- Brute-force resistance: only one in_progress attempt per topic per user;
  duplicate answers within an attempt are rejected by a partial unique index;
  score / is_passing / status / completed_at columns are revoked from browsers
  and written only by the SECURITY DEFINER grader.

2. New tables
- `practice_quiz_attempts`
  - id (uuid, primary key)
  - user_id (uuid, defaults to auth.uid(), FK auth.users ON DELETE CASCADE)
  - topic_slug (text) — which practice set this attempt covers
  - attempt_number (int) — server-assigned, 1-based per (user, topic)
  - status ('in_progress' | 'completed' | 'abandoned')
  - started_at, completed_at (timestamptz)
  - score_correct, score_total (int, nullable) — set only on completion
  - is_passing (boolean, nullable) — set only on completion
  - UNIQUE (user_id, topic_slug, attempt_number)

3. Modified tables
- `practice_attempts`
  - Added `quiz_attempt_id` (uuid, nullable FK to practice_quiz_attempts ON
    DELETE CASCADE). Legacy rows keep NULL; new rows reference a quiz attempt.
  - Added `skipped` (boolean, NOT NULL, default false). True means the
    timer expired with no answer selected.
  - `selected_index` is now nullable (DROP NOT NULL). When skipped=true it
    is NULL; otherwise it is a validated 0-3 index.
  - Dropped the legacy UNIQUE(user_id, question_id) constraint — retries
    require multiple rows per (user, question).
  - New CHECK: either skipped+NULL selected_index, or not-skipped+valid 0-3.
  - New partial UNIQUE index on (quiz_attempt_id, question_id) where
    quiz_attempt_id IS NOT NULL — no duplicate answers within one attempt.

4. Security changes
- RLS enabled on `practice_quiz_attempts`; owner-only SELECT policy;
  INSERT/UPDATE/DELETE revoked from anon/authenticated. All writes go
  through SECURITY DEFINER functions.
- Column-level: INSERT revoked on (status, completed_at, score_correct,
  score_total, is_passing, attempt_number) for anon/authenticated, so even a
  crafted REST payload cannot forge a completed/passing attempt or pick an
  attempt number.
- `practice_attempts` continues to reject all client writes (INSERT/UPDATE/
  DELETE revoked); only the grader function writes rows.
- All new/updated functions pin search_path = public and check auth.uid().
- `practice_questions_for` now scopes key/explanation reveal to the supplied
  quiz attempt only, so a fresh retry is not spoiled by old answers.

5. Notes
- No existing rows are deleted or rewritten. Legacy practice_attempts rows
  (quiz_attempt_id NULL) are preserved as audit history. The summary
  function counts them in `attempts`/`correct` (all-time audit totals) while
  `quizAttempts`/`bestPassingAttempt`/`lastAttempt` reflect the new model.
- Idempotent: uses IF NOT EXISTS for the table, columns, indexes, and
  DROP IF EXISTS for policies/constraints before re-creating.
*/

-- ------------------------------------------------------------------
-- 1. Parent table: practice_quiz_attempts
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS practice_quiz_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  topic_slug text NOT NULL CHECK (char_length(btrim(topic_slug)) >= 1 AND char_length(btrim(topic_slug)) <= 80),
  attempt_number int NOT NULL CHECK (attempt_number >= 1),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status = ANY (ARRAY['in_progress'::text, 'completed'::text, 'abandoned'::text])),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  score_correct int CHECK (score_correct IS NULL OR score_correct >= 0),
  score_total int CHECK (score_total IS NULL OR score_total >= 0),
  is_passing boolean,
  UNIQUE (user_id, topic_slug, attempt_number)
);

CREATE INDEX IF NOT EXISTS practice_quiz_attempts_user_topic_idx
  ON practice_quiz_attempts (user_id, topic_slug, attempt_number DESC);

ALTER TABLE practice_quiz_attempts ENABLE ROW LEVEL SECURITY;

-- Browsers cannot write any of this table directly; only the grader does.
REVOKE INSERT, UPDATE, DELETE ON practice_quiz_attempts FROM anon, authenticated;

-- Owner may read their own quiz attempts (audit transparency).
DROP POLICY IF EXISTS "quiz_attempts_select_own" ON practice_quiz_attempts;
CREATE POLICY "quiz_attempts_select_own" ON practice_quiz_attempts
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Column-level: even if a write somehow reached the table, these columns
-- cannot be set by a browser — only the SECURITY DEFINER grader sets them.
REVOKE INSERT (status, completed_at, score_correct, score_total, is_passing, attempt_number)
  ON practice_quiz_attempts FROM anon, authenticated;

-- ------------------------------------------------------------------
-- 2. practice_attempts: add quiz_attempt_id + skipped, allow retry
-- ------------------------------------------------------------------

ALTER TABLE practice_attempts
  ADD COLUMN IF NOT EXISTS quiz_attempt_id uuid REFERENCES practice_quiz_attempts(id) ON DELETE CASCADE;

ALTER TABLE practice_attempts
  ADD COLUMN IF NOT EXISTS skipped boolean NOT NULL DEFAULT false;

-- Allow NULL selected_index (timed-out / skipped questions).
ALTER TABLE practice_attempts ALTER COLUMN selected_index DROP NOT NULL;

-- Replace the column CHECK with one that understands skipped vs answered.
ALTER TABLE practice_attempts DROP CONSTRAINT IF EXISTS practice_attempts_selected_index_check;
ALTER TABLE practice_attempts DROP CONSTRAINT IF EXISTS practice_attempts_selected_index_check1;
ALTER TABLE practice_attempts ADD CONSTRAINT practice_attempts_selected_index_skipped_check CHECK (
  (skipped = true AND selected_index IS NULL) OR
  (skipped = false AND selected_index IS NOT NULL AND selected_index >= 0 AND selected_index <= 3)
);

-- Drop the legacy UNIQUE(user_id, question_id) so retries can add rows.
ALTER TABLE practice_attempts DROP CONSTRAINT IF EXISTS practice_attempts_user_id_question_id_key;

-- Within one quiz attempt, a question can be answered at most once.
CREATE UNIQUE INDEX IF NOT EXISTS practice_attempts_quiz_question_uniq
  ON practice_attempts (quiz_attempt_id, question_id)
  WHERE quiz_attempt_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS practice_attempts_quiz_idx
  ON practice_attempts (quiz_attempt_id);

-- ------------------------------------------------------------------
-- 3. start_practice_attempt: server assigns the next attempt number
-- ------------------------------------------------------------------
-- Refuses to start a new attempt while one is already in_progress for the
-- same topic+user — no parallel grinding. Returns the in_progress attempt
-- if one exists so the UI can resume it.

CREATE OR REPLACE FUNCTION start_practice_attempt(p_topic_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_next int;
  v_id uuid;
  v_in_progress practice_quiz_attempts%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthenticated');
  END IF;
  IF p_topic_slug IS NULL OR char_length(btrim(p_topic_slug)) = 0 THEN
    RETURN jsonb_build_object('status', 'invalid_topic');
  END IF;

  SELECT * INTO v_in_progress
    FROM practice_quiz_attempts
    WHERE user_id = v_user AND topic_slug = p_topic_slug AND status = 'in_progress'
    ORDER BY attempt_number DESC
    LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'in_progress_exists',
      'quizAttemptId', v_in_progress.id,
      'attemptNumber', v_in_progress.attempt_number
    );
  END IF;

  SELECT COALESCE(MAX(attempt_number), 0) + 1 INTO v_next
    FROM practice_quiz_attempts
    WHERE user_id = v_user AND topic_slug = p_topic_slug;

  INSERT INTO practice_quiz_attempts (user_id, topic_slug, attempt_number)
    VALUES (v_user, p_topic_slug, v_next)
    RETURNING id INTO v_id;

  RETURN jsonb_build_object('status', 'started', 'quizAttemptId', v_id, 'attemptNumber', v_next);
END;
$$;

-- ------------------------------------------------------------------
-- 4. submit_practice_attempt: grades one answer (or skip) within an attempt
-- ------------------------------------------------------------------
-- New signature: (quiz_attempt_id, question_id, selected_index, skipped).
-- - skipped=true records a timed-out question as incorrect with NULL index.
-- - Refuses if the quiz attempt is not in_progress or not owned by caller.
-- - Refuses duplicate answers within the same attempt (partial unique index).
-- - Always grades server-side against the hidden correct_index.

CREATE OR REPLACE FUNCTION submit_practice_attempt(
  p_quiz_attempt_id uuid,
  p_question_id uuid,
  p_selected_index int,
  p_skipped boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_quiz practice_quiz_attempts%ROWTYPE;
  v_correct_index int;
  v_explanation text;
  v_is_correct boolean;
  v_existing practice_attempts%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthenticated');
  END IF;

  SELECT * INTO v_quiz FROM practice_quiz_attempts
    WHERE id = p_quiz_attempt_id AND user_id = v_user;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF v_quiz.status <> 'in_progress' THEN
    RETURN jsonb_build_object('status', 'attempt_closed');
  END IF;

  SELECT q.correct_index, q.explanation INTO v_correct_index, v_explanation
    FROM practice_questions q
    WHERE q.id = p_question_id AND q.verification_status = 'verified'
      AND q.topic_slug = v_quiz.topic_slug;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  -- Validate the selection / skipped combination.
  IF p_skipped IS NULL THEN p_skipped := false; END IF;
  IF p_skipped THEN
    IF p_selected_index IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'invalid_selection');
    END IF;
  ELSE
    IF p_selected_index IS NULL OR p_selected_index < 0 OR p_selected_index > 3 THEN
      RETURN jsonb_build_object('status', 'invalid_selection');
    END IF;
  END IF;

  -- Duplicate within this attempt?
  SELECT * INTO v_existing FROM practice_attempts
    WHERE quiz_attempt_id = p_quiz_attempt_id AND question_id = p_question_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'already_answered',
      'selectedIndex', v_existing.selected_index,
      'skipped', v_existing.skipped,
      'isCorrect', v_existing.is_correct,
      'correctIndex', v_correct_index,
      'explanation', v_explanation
    );
  END IF;

  v_is_correct := CASE WHEN p_skipped THEN false ELSE (p_selected_index = v_correct_index) END;

  INSERT INTO practice_attempts (user_id, quiz_attempt_id, question_id, selected_index, is_correct, skipped)
    VALUES (v_user, p_quiz_attempt_id, p_question_id, p_selected_index, v_is_correct, p_skipped);

  RETURN jsonb_build_object(
    'status', 'graded',
    'selectedIndex', p_selected_index,
    'skipped', p_skipped,
    'isCorrect', v_is_correct,
    'correctIndex', v_correct_index,
    'explanation', v_explanation
  );
END;
$$;

-- ------------------------------------------------------------------
-- 5. finish_practice_attempt: grade + lock one whole attempt
-- ------------------------------------------------------------------
-- Validates that every verified question in the topic has a graded row in
-- this attempt, computes score_correct/score_total/is_passing from THIS
-- attempt only, and marks the attempt completed. Refuses double finish.

CREATE OR REPLACE FUNCTION finish_practice_attempt(p_quiz_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_quiz practice_quiz_attempts%ROWTYPE;
  v_total int;
  v_answered int;
  v_correct int;
  v_pass boolean;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthenticated');
  END IF;

  SELECT * INTO v_quiz FROM practice_quiz_attempts
    WHERE id = p_quiz_attempt_id AND user_id = v_user;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF v_quiz.status = 'completed' THEN
    RETURN jsonb_build_object(
      'status', 'already_finished',
      'correct', v_quiz.score_correct,
      'total', v_quiz.score_total,
      'isPassing', v_quiz.is_passing
    );
  END IF;
  IF v_quiz.status = 'abandoned' THEN
    RETURN jsonb_build_object('status', 'attempt_closed');
  END IF;

  SELECT count(*) INTO v_total FROM practice_questions
    WHERE topic_slug = v_quiz.topic_slug AND verification_status = 'verified';
  IF v_total = 0 THEN
    RETURN jsonb_build_object('status', 'no_practice_set');
  END IF;

  SELECT count(*), count(*) FILTER (WHERE is_correct)
    INTO v_answered, v_correct
    FROM practice_attempts
    WHERE quiz_attempt_id = p_quiz_attempt_id;

  IF v_answered < v_total THEN
    RETURN jsonb_build_object(
      'status', 'criteria_not_met',
      'reason', 'Answer every question (or let each one time out) before finishing.',
      'answered', v_answered,
      'total', v_total
    );
  END IF;

  v_pass := (v_correct::numeric / v_total) >= 0.8;

  UPDATE practice_quiz_attempts
    SET status = 'completed', completed_at = now(),
        score_correct = v_correct, score_total = v_total, is_passing = v_pass
    WHERE id = p_quiz_attempt_id AND user_id = v_user;

  RETURN jsonb_build_object(
    'status', 'completed',
    'correct', v_correct,
    'total', v_total,
    'isPassing', v_pass
  );
END;
$$;

-- ------------------------------------------------------------------
-- 6. abandon_practice_attempt: release an in_progress attempt
-- ------------------------------------------------------------------
-- Lets a student discard an in_progress attempt so they can start a fresh
-- one. Only allowed on in_progress rows; never on completed/abandoned.

CREATE OR REPLACE FUNCTION abandon_practice_attempt(p_quiz_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_status text;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthenticated');
  END IF;
  SELECT status INTO v_status FROM practice_quiz_attempts
    WHERE id = p_quiz_attempt_id AND user_id = v_user;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF v_status <> 'in_progress' THEN
    RETURN jsonb_build_object('status', 'attempt_closed');
  END IF;
  UPDATE practice_quiz_attempts SET status = 'abandoned', completed_at = now()
    WHERE id = p_quiz_attempt_id AND user_id = v_user;
  RETURN jsonb_build_object('status', 'abandoned');
END;
$$;

-- ------------------------------------------------------------------
-- 7. practice_questions_for: scope key reveal to the current attempt
-- ------------------------------------------------------------------
-- New optional p_quiz_attempt_id. When provided, a question is "attempted"
-- only if it has a graded row in THIS attempt, and keys/explanation are
-- revealed only then. A fresh retry therefore sees no spoilers from past
-- attempts.

CREATE OR REPLACE FUNCTION practice_questions_for(
  p_topic_slug text,
  p_quiz_attempt_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    jsonb_agg(
      CASE
        WHEN a.id IS NULL THEN
          jsonb_build_object(
            'id', q.id,
            'prompt', q.prompt,
            'options', q.options,
            'displayOrder', q.display_order,
            'attempted', false
          )
        ELSE
          jsonb_build_object(
            'id', q.id,
            'prompt', q.prompt,
            'options', q.options,
            'displayOrder', q.display_order,
            'attempted', true,
            'selectedIndex', a.selected_index,
            'skipped', a.skipped,
            'isCorrect', a.is_correct,
            'correctIndex', q.correct_index,
            'explanation', q.explanation
          )
      END
      ORDER BY q.display_order, q.created_at
    ),
    '[]'::jsonb
  )
  FROM practice_questions q
  LEFT JOIN practice_attempts a
    ON a.question_id = q.id
   AND a.user_id = auth.uid()
   AND (p_quiz_attempt_id IS NOT NULL AND a.quiz_attempt_id = p_quiz_attempt_id)
  WHERE q.topic_slug = p_topic_slug
    AND q.verification_status = 'verified'
$$;

-- ------------------------------------------------------------------
-- 8. complete_mission_secure: now completes against ONE passing attempt
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION complete_mission_secure(p_mission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_topic text;
  v_status text;
  v_pass practice_quiz_attempts%ROWTYPE;
  v_any_completed int;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthenticated');
  END IF;

  SELECT m.topic_slug, m.status INTO v_topic, v_status
    FROM student_missions m
    WHERE m.id = p_mission_id AND m.user_id = v_user;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF v_status = 'completed' THEN
    RETURN jsonb_build_object('status', 'already_completed');
  END IF;

  -- A genuinely completed, passing attempt for this topic?
  SELECT * INTO v_pass
    FROM practice_quiz_attempts
    WHERE user_id = v_user AND topic_slug = v_topic
      AND status = 'completed' AND is_passing = true
    ORDER BY completed_at DESC
    LIMIT 1;

  IF NOT FOUND THEN
    SELECT count(*) INTO v_any_completed
      FROM practice_quiz_attempts
      WHERE user_id = v_user AND topic_slug = v_topic AND status = 'completed';
    IF v_any_completed > 0 THEN
      RETURN jsonb_build_object(
        'status', 'criteria_not_met',
        'reason', 'Finish a practice attempt with at least 80% to complete this mission. You can retry — start a new attempt.',
        'completedAttempts', v_any_completed
      );
    END IF;
    RETURN jsonb_build_object(
      'status', 'criteria_not_met',
      'reason', 'Complete a practice attempt with at least 80% on this topic first.',
      'completedAttempts', 0
    );
  END IF;

  UPDATE student_missions
    SET status = 'completed', completed_at = now(), updated_at = now()
    WHERE id = p_mission_id AND user_id = v_user AND status = 'active';

  RETURN jsonb_build_object(
    'status', 'completed',
    'correct', v_pass.score_correct,
    'total', v_pass.score_total,
    'attemptNumber', v_pass.attempt_number
  );
END;
$$;

-- ------------------------------------------------------------------
-- 9. practice_summary_secure: add quiz-attempt history, keep audit totals
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION practice_summary_secure()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT jsonb_build_object(
    'missionsCompleted', (
      SELECT count(*) FROM student_missions
      WHERE user_id = auth.uid() AND status = 'completed'
    ),
    'missionsActive', (
      SELECT count(*) FROM student_missions
      WHERE user_id = auth.uid() AND status = 'active'
    ),
    'activeMission', (
      SELECT COALESCE(jsonb_build_object(
        'id', m.id,
        'missionText', m.mission_text,
        'topicSlug', m.topic_slug,
        'resourceId', m.resource_id
      ), 'null'::jsonb)
      FROM student_missions m
      WHERE m.user_id = auth.uid() AND m.status = 'active'
      ORDER BY m.created_at DESC
      LIMIT 1
    ),
    'attempts', (
      SELECT count(*) FROM practice_attempts WHERE user_id = auth.uid()
    ),
    'correct', (
      SELECT count(*) FROM practice_attempts WHERE user_id = auth.uid() AND is_correct
    ),
    'quizAttempts', (
      SELECT count(*) FROM practice_quiz_attempts WHERE user_id = auth.uid()
    ),
    'passedAttempts', (
      SELECT count(*) FROM practice_quiz_attempts
      WHERE user_id = auth.uid() AND status = 'completed' AND is_passing = true
    ),
    'bestPassingAttempt', (
      SELECT COALESCE(jsonb_build_object(
        'topicSlug', q.topic_slug,
        'attemptNumber', q.attempt_number,
        'correct', q.score_correct,
        'total', q.score_total,
        'completedAt', q.completed_at
      ), 'null'::jsonb)
      FROM practice_quiz_attempts q
      WHERE q.user_id = auth.uid() AND q.status = 'completed' AND q.is_passing = true
      ORDER BY q.completed_at DESC
      LIMIT 1
    ),
    'lastAttempt', (
      SELECT COALESCE(jsonb_build_object(
        'topicSlug', q.topic_slug,
        'attemptNumber', q.attempt_number,
        'status', q.status,
        'correct', q.score_correct,
        'total', q.score_total,
        'isPassing', q.is_passing,
        'completedAt', q.completed_at
      ), 'null'::jsonb)
      FROM practice_quiz_attempts q
      WHERE q.user_id = auth.uid()
      ORDER BY q.started_at DESC
      LIMIT 1
    ),
    'mistakes', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'questionId', q.id,
        'prompt', q.prompt,
        'options', q.options,
        'selectedIndex', a.selected_index,
        'skipped', a.skipped,
        'correctIndex', q.correct_index,
        'explanation', q.explanation,
        'topicSlug', q.topic_slug,
        'topicLabel', q.topic_label,
        'subjectName', q.subject_name,
        'submittedAt', a.submitted_at
      ) ORDER BY a.submitted_at DESC), '[]'::jsonb)
      FROM practice_attempts a
      JOIN practice_questions q ON q.id = a.question_id
      WHERE a.user_id = auth.uid() AND a.is_correct = false
    ),
    'activeDays', (
      SELECT COALESCE(jsonb_agg(d ORDER BY d), '[]'::jsonb)
      FROM (
        SELECT DISTINCT date_trunc('day', submitted_at AT TIME ZONE 'utc')::date AS d
        FROM practice_attempts
        WHERE user_id = auth.uid()
          AND submitted_at >= now() - interval '14 days'
      ) days
    )
  )
$$;

-- ------------------------------------------------------------------
-- 10. Grant execute on the new functions to authenticated users
-- ------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION start_practice_attempt(text) TO authenticated;
GRANT EXECUTE ON FUNCTION submit_practice_attempt(uuid, uuid, int, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION finish_practice_attempt(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION abandon_practice_attempt(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION practice_questions_for(text, uuid) TO authenticated;
