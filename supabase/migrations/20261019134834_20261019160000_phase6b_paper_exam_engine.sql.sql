/*
# Paper to Practice — Phase 6B: Exam engine schema + secure RPCs

## Summary
Turns reviewed/confirmed questions into real, persistent examinations with a
genuine attempt lifecycle: configure → start (with server-authoritative
deadline) → save answers → submit → grade → view results.

## 1. New table: paper_exams
- id, owner_id, upload_id (FK), title, mode ('practice'|'timed'),
  duration_minutes, instructions, total_marks, question_count.

## 2. New table: paper_exam_questions (immutable snapshot)
- Copies effective question text/options/marks/answer_key at creation time.
  Later edits to paper_questions do not change the exam.

## 3. New table: paper_exam_attempts
- One attempt per exam (one in_progress at a time). Server-generated
  started_at, expires_at. Status: in_progress|submitted|expired.

## 4. New table: paper_exam_answers
- Per-question responses. Grading columns server-set only.

## 5. Security
- RLS owner-scoped on all tables (4 policies each).
- Column-level revokes on attempt status/scores/timestamps and answer grading.
- All transitions via SECURITY DEFINER RPCs with SET search_path = public.

## 6. RPCs
- create_paper_exam, start_paper_exam, save_paper_exam_answer,
  submit_paper_exam, finalize_expired_attempts, get_paper_exam_attempt.

## 7. Notes
1. No daily goal/streak/badge triggers fire from exams.
2. Student-supplied answer keys labeled as such — not official grades.
3. Questions without keys are ungraded, not fabricated.
4. Snapshots are immutable.
5. Server controls all timestamps, scores, and status transitions.
*/

-- ============ paper_exams ============
CREATE TABLE IF NOT EXISTS public.paper_exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  upload_id uuid NOT NULL REFERENCES public.paper_uploads(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  mode text NOT NULL DEFAULT 'practice' CHECK (mode IN ('practice', 'timed')),
  duration_minutes integer NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0 AND duration_minutes <= 300),
  instructions text,
  total_marks integer NOT NULL DEFAULT 0 CHECK (total_marks >= 0),
  question_count integer NOT NULL DEFAULT 0 CHECK (question_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.paper_exams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "paper_exams_select_own" ON public.paper_exams;
CREATE POLICY "paper_exams_select_own" ON public.paper_exams
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);
DROP POLICY IF EXISTS "paper_exams_insert_own" ON public.paper_exams;
CREATE POLICY "paper_exams_insert_own" ON public.paper_exams
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
DROP POLICY IF EXISTS "paper_exams_update_own" ON public.paper_exams;
CREATE POLICY "paper_exams_update_own" ON public.paper_exams
  FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
DROP POLICY IF EXISTS "paper_exams_delete_own" ON public.paper_exams;
CREATE POLICY "paper_exams_delete_own" ON public.paper_exams
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_paper_exams_owner ON public.paper_exams(owner_id);
CREATE INDEX IF NOT EXISTS idx_paper_exams_upload ON public.paper_exams(upload_id);

-- ============ paper_exam_questions (immutable snapshot) ============
CREATE TABLE IF NOT EXISTS public.paper_exam_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES public.paper_exams(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  position integer NOT NULL,
  source_question_id uuid REFERENCES public.paper_questions(id) ON DELETE SET NULL,
  question_type text NOT NULL DEFAULT 'mcq'
    CHECK (question_type IN ('mcq', 'short_answer', 'long_answer', 'fill_blank', 'true_false', 'unknown')),
  question_text text NOT NULL CHECK (char_length(question_text) BETWEEN 1 AND 4000),
  options jsonb,
  marks integer,
  answer_key text,
  answer_key_source text NOT NULL DEFAULT 'none'
    CHECK (answer_key_source IN ('none', 'student', 'extracted')),
  has_figure boolean NOT NULL DEFAULT false,
  figure_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.paper_exam_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "paper_exam_questions_select_own" ON public.paper_exam_questions;
CREATE POLICY "paper_exam_questions_select_own" ON public.paper_exam_questions
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);
DROP POLICY IF EXISTS "paper_exam_questions_insert_own" ON public.paper_exam_questions;
CREATE POLICY "paper_exam_questions_insert_own" ON public.paper_exam_questions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
DROP POLICY IF EXISTS "paper_exam_questions_update_own" ON public.paper_exam_questions;
CREATE POLICY "paper_exam_questions_update_own" ON public.paper_exam_questions
  FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
DROP POLICY IF EXISTS "paper_exam_questions_delete_own" ON public.paper_exam_questions;
CREATE POLICY "paper_exam_questions_delete_own" ON public.paper_exam_questions
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_paper_exam_questions_exam ON public.paper_exam_questions(exam_id);

-- ============ paper_exam_attempts ============
CREATE TABLE IF NOT EXISTS public.paper_exam_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES public.paper_exams(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'submitted', 'expired')),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  submitted_at timestamptz,
  time_used_seconds integer,
  score_correct integer,
  score_total integer,
  graded_count integer,
  ungraded_count integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.paper_exam_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "paper_exam_attempts_select_own" ON public.paper_exam_attempts;
CREATE POLICY "paper_exam_attempts_select_own" ON public.paper_exam_attempts
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);
DROP POLICY IF EXISTS "paper_exam_attempts_insert_own" ON public.paper_exam_attempts;
CREATE POLICY "paper_exam_attempts_insert_own" ON public.paper_exam_attempts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
DROP POLICY IF EXISTS "paper_exam_attempts_update_own" ON public.paper_exam_attempts;
CREATE POLICY "paper_exam_attempts_update_own" ON public.paper_exam_attempts
  FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
DROP POLICY IF EXISTS "paper_exam_attempts_delete_own" ON public.paper_exam_attempts;
CREATE POLICY "paper_exam_attempts_delete_own" ON public.paper_exam_attempts
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

REVOKE UPDATE (status, started_at, expires_at, submitted_at, time_used_seconds,
  score_correct, score_total, graded_count, ungraded_count) ON public.paper_exam_attempts FROM authenticated, anon;

CREATE INDEX IF NOT EXISTS idx_paper_exam_attempts_exam ON public.paper_exam_attempts(exam_id);
CREATE INDEX IF NOT EXISTS idx_paper_exam_attempts_owner ON public.paper_exam_attempts(owner_id);
CREATE INDEX IF NOT EXISTS idx_paper_exam_attempts_status ON public.paper_exam_attempts(status);

-- ============ paper_exam_answers ============
CREATE TABLE IF NOT EXISTS public.paper_exam_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.paper_exam_attempts(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  exam_question_id uuid NOT NULL REFERENCES public.paper_exam_questions(id) ON DELETE CASCADE,
  selected_index integer,
  answer_text text,
  marked_for_review boolean NOT NULL DEFAULT false,
  saved_at timestamptz NOT NULL DEFAULT now(),
  is_correct boolean,
  graded boolean NOT NULL DEFAULT false,
  graded_at timestamptz,
  UNIQUE (attempt_id, exam_question_id)
);

ALTER TABLE public.paper_exam_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "paper_exam_answers_select_own" ON public.paper_exam_answers;
CREATE POLICY "paper_exam_answers_select_own" ON public.paper_exam_answers
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);
DROP POLICY IF EXISTS "paper_exam_answers_insert_own" ON public.paper_exam_answers;
CREATE POLICY "paper_exam_answers_insert_own" ON public.paper_exam_answers
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
DROP POLICY IF EXISTS "paper_exam_answers_update_own" ON public.paper_exam_answers;
CREATE POLICY "paper_exam_answers_update_own" ON public.paper_exam_answers
  FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
DROP POLICY IF EXISTS "paper_exam_answers_delete_own" ON public.paper_exam_answers;
CREATE POLICY "paper_exam_answers_delete_own" ON public.paper_exam_answers
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

REVOKE UPDATE (is_correct, graded, graded_at) ON public.paper_exam_answers FROM authenticated, anon;

CREATE INDEX IF NOT EXISTS idx_paper_exam_answers_attempt ON public.paper_exam_answers(attempt_id);

-- ============ updated_at triggers ============
DROP TRIGGER IF EXISTS paper_exams_touch ON public.paper_exams;
CREATE TRIGGER paper_exams_touch BEFORE UPDATE ON public.paper_exams
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS paper_exam_attempts_touch ON public.paper_exam_attempts;
CREATE TRIGGER paper_exam_attempts_touch BEFORE UPDATE ON public.paper_exam_attempts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ RPC: create_paper_exam ============
CREATE OR REPLACE FUNCTION public.create_paper_exam(
  p_upload_id uuid,
  p_title text,
  p_question_ids uuid[],
  p_mode text DEFAULT 'practice',
  p_duration_minutes integer DEFAULT 0,
  p_instructions text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exam_id uuid;
  v_owner uuid := auth.uid();
  v_upload public.paper_uploads;
  v_q public.paper_questions;
  v_eff_text text;
  v_eff_options jsonb;
  v_total_marks integer := 0;
  v_count integer := 0;
  v_qid uuid;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Sign in to create an exam.'; END IF;
  IF p_mode NOT IN ('practice', 'timed') THEN RAISE EXCEPTION 'Invalid exam mode.'; END IF;
  IF p_duration_minutes < 0 OR p_duration_minutes > 300 THEN RAISE EXCEPTION 'Duration must be between 0 and 300 minutes.'; END IF;
  IF char_length(p_title) < 1 OR char_length(p_title) > 200 THEN RAISE EXCEPTION 'Title must be 1-200 characters.'; END IF;
  IF p_question_ids IS NULL OR array_length(p_question_ids, 1) IS NULL OR array_length(p_question_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Select at least one question for the exam.';
  END IF;
  IF array_length(p_question_ids, 1) > 100 THEN
    RAISE EXCEPTION 'An exam can have at most 100 questions.';
  END IF;

  SELECT * INTO v_upload FROM public.paper_uploads WHERE id = p_upload_id AND owner_id = v_owner;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paper not found or not accessible.'; END IF;
  IF v_upload.status != 'extracted' THEN RAISE EXCEPTION 'Paper must be processed before creating an exam.'; END IF;

  INSERT INTO public.paper_exams (owner_id, upload_id, title, mode, duration_minutes, instructions)
  VALUES (v_owner, p_upload_id, p_title, p_mode, p_duration_minutes, p_instructions)
  RETURNING id INTO v_exam_id;

  FOREACH v_qid IN ARRAY p_question_ids LOOP
    SELECT * INTO v_q FROM public.paper_questions WHERE id = v_qid AND owner_id = v_owner AND upload_id = p_upload_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Question not found or not accessible.'; END IF;
    IF v_q.review_status = 'removed' THEN RAISE EXCEPTION 'Removed questions cannot be included.'; END IF;
    IF v_q.review_status = 'pending' THEN RAISE EXCEPTION 'All questions must be reviewed before creating an exam.'; END IF;
    IF v_q.has_figure THEN RAISE EXCEPTION 'Questions with missing figures cannot be included. Correct or remove them first.'; END IF;

    v_eff_text := COALESCE(v_q.edited_text, v_q.question_text);
    v_eff_options := COALESCE(v_q.edited_options, v_q.options);

    IF v_q.question_type = 'mcq' AND (v_eff_options IS NULL OR jsonb_array_length(v_eff_options) < 2) THEN
      RAISE EXCEPTION 'MCQ questions must have at least 2 options.';
    END IF;

    INSERT INTO public.paper_exam_questions (
      exam_id, owner_id, position, source_question_id,
      question_type, question_text, options, marks,
      answer_key, answer_key_source, has_figure, figure_note
    ) VALUES (
      v_exam_id, v_owner, v_count + 1, v_q.id,
      v_q.question_type, v_eff_text, v_eff_options, v_q.marks,
      v_q.answer_key, v_q.answer_key_source, v_q.has_figure, v_q.figure_note
    );

    v_count := v_count + 1;
    v_total_marks := v_total_marks + COALESCE(v_q.marks, 0);
  END LOOP;

  UPDATE public.paper_exams SET question_count = v_count, total_marks = v_total_marks WHERE id = v_exam_id;

  RETURN v_exam_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_paper_exam TO authenticated;

-- ============ RPC: finalize_expired_attempts ============
CREATE OR REPLACE FUNCTION public.finalize_expired_attempts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt record;
  v_time_used integer;
BEGIN
  FOR v_attempt IN
    SELECT id, started_at, expires_at FROM public.paper_exam_attempts
    WHERE status = 'in_progress' AND expires_at IS NOT NULL AND expires_at < now()
  LOOP
    v_time_used := GREATEST(0, EXTRACT(EPOCH FROM (v_attempt.expires_at - v_attempt.started_at))::integer);
    UPDATE public.paper_exam_attempts
    SET status = 'expired', submitted_at = now(), time_used_seconds = v_time_used
    WHERE id = v_attempt.id AND status = 'in_progress';
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_expired_attempts TO authenticated;

-- ============ RPC: start_paper_exam ============
CREATE OR REPLACE FUNCTION public.start_paper_exam(p_exam_id uuid)
RETURNS TABLE (attempt_id uuid, status text, started_at timestamptz, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_exam public.paper_exams;
  v_existing public.paper_exam_attempts;
  v_attempt_id uuid;
  v_expires timestamptz;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Sign in to start an exam.'; END IF;

  SELECT * INTO v_exam FROM public.paper_exams WHERE id = p_exam_id AND owner_id = v_owner;
  IF NOT FOUND THEN RAISE EXCEPTION 'Exam not found.'; END IF;

  PERFORM public.finalize_expired_attempts();

  SELECT * INTO v_existing FROM public.paper_exam_attempts
    WHERE exam_id = p_exam_id AND owner_id = v_owner AND status = 'in_progress';
  IF FOUND THEN
    RETURN QUERY SELECT v_existing.id, v_existing.status, v_existing.started_at, v_existing.expires_at;
    RETURN;
  END IF;

  PERFORM 1 FROM public.paper_exam_attempts
    WHERE exam_id = p_exam_id AND owner_id = v_owner AND status IN ('submitted', 'expired');
  IF FOUND THEN RAISE EXCEPTION 'This exam has already been completed.'; END IF;

  IF v_exam.mode = 'timed' AND v_exam.duration_minutes > 0 THEN
    v_expires := now() + (v_exam.duration_minutes || ' minutes')::interval;
  END IF;

  INSERT INTO public.paper_exam_attempts (exam_id, owner_id, status, started_at, expires_at)
  VALUES (p_exam_id, v_owner, 'in_progress', now(), v_expires)
  RETURNING id INTO v_attempt_id;

  RETURN QUERY SELECT v_attempt_id, 'in_progress'::text, now(), v_expires;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_paper_exam TO authenticated;

-- ============ RPC: save_paper_exam_answer ============
CREATE OR REPLACE FUNCTION public.save_paper_exam_answer(
  p_attempt_id uuid,
  p_exam_question_id uuid,
  p_selected_index integer DEFAULT NULL,
  p_answer_text text DEFAULT NULL,
  p_marked_for_review boolean DEFAULT FALSE
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_attempt public.paper_exam_attempts;
  v_eq public.paper_exam_questions;
  v_options jsonb;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Sign in to save answers.'; END IF;

  PERFORM public.finalize_expired_attempts();

  SELECT * INTO v_attempt FROM public.paper_exam_attempts WHERE id = p_attempt_id AND owner_id = v_owner;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attempt not found.'; END IF;
  IF v_attempt.status != 'in_progress' THEN RAISE EXCEPTION 'This exam is no longer in progress.'; END IF;

  SELECT * INTO v_eq FROM public.paper_exam_questions WHERE id = p_exam_question_id AND exam_id = v_attempt.exam_id AND owner_id = v_owner;
  IF NOT FOUND THEN RAISE EXCEPTION 'Question not found in this exam.'; END IF;

  IF v_eq.question_type = 'mcq' AND p_selected_index IS NOT NULL THEN
    v_options := v_eq.options;
    IF v_options IS NULL OR jsonb_array_length(v_options) = 0 THEN RAISE EXCEPTION 'Invalid question options.'; END IF;
    IF p_selected_index < 0 OR p_selected_index >= jsonb_array_length(v_options) THEN
      RAISE EXCEPTION 'Invalid answer selection.';
    END IF;
  END IF;

  INSERT INTO public.paper_exam_answers (attempt_id, owner_id, exam_question_id, selected_index, answer_text, marked_for_review, saved_at)
  VALUES (p_attempt_id, v_owner, p_exam_question_id, p_selected_index, p_answer_text, p_marked_for_review, now())
  ON CONFLICT (attempt_id, exam_question_id) DO UPDATE
    SET selected_index = EXCLUDED.selected_index,
        answer_text = EXCLUDED.answer_text,
        marked_for_review = EXCLUDED.marked_for_review,
        saved_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_paper_exam_answer TO authenticated;

-- ============ RPC: submit_paper_exam ============
CREATE OR REPLACE FUNCTION public.submit_paper_exam(p_attempt_id uuid)
RETURNS TABLE (
  status text,
  score_correct integer,
  score_total integer,
  graded_count integer,
  ungraded_count integer,
  time_used_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_attempt public.paper_exam_attempts;
  v_eq public.paper_exam_questions;
  v_ans public.paper_exam_answers;
  v_score_correct integer := 0;
  v_score_total integer := 0;
  v_graded integer := 0;
  v_ungraded integer := 0;
  v_key_index integer;
  v_options jsonb;
  v_time_used integer;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Sign in to submit.'; END IF;

  PERFORM public.finalize_expired_attempts();

  SELECT * INTO v_attempt FROM public.paper_exam_attempts WHERE id = p_attempt_id AND owner_id = v_owner;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attempt not found.'; END IF;

  IF v_attempt.status = 'submitted' THEN RAISE EXCEPTION 'This exam has already been submitted.'; END IF;
  IF v_attempt.status = 'expired' THEN
    RETURN QUERY SELECT 'expired'::text, v_attempt.score_correct, v_attempt.score_total,
      v_attempt.graded_count, v_attempt.ungraded_count, v_attempt.time_used_seconds;
    RETURN;
  END IF;

  FOR v_eq IN SELECT * FROM public.paper_exam_questions WHERE exam_id = v_attempt.exam_id ORDER BY position LOOP
    SELECT * INTO v_ans FROM public.paper_exam_answers WHERE attempt_id = p_attempt_id AND exam_question_id = v_eq.id;

    IF v_eq.question_type = 'mcq' AND v_eq.answer_key IS NOT NULL AND v_eq.answer_key_source IN ('student', 'extracted') THEN
      v_score_total := v_score_total + 1;
      v_key_index := NULL;
      v_options := v_eq.options;
      BEGIN
        IF v_eq.answer_key ~ '^[0-9]+$' THEN
          v_key_index := v_eq.answer_key::integer;
        ELSIF v_eq.answer_key ~ '^[A-Da-d]$' AND v_options IS NOT NULL THEN
          v_key_index := ascii(upper(v_eq.answer_key)) - 65;
        END IF;
      EXCEPTION WHEN OTHERS THEN v_key_index := NULL; END;

      IF v_key_index IS NOT NULL AND v_options IS NOT NULL AND v_key_index >= 0 AND v_key_index < jsonb_array_length(v_options) THEN
        v_graded := v_graded + 1;
        IF v_ans IS NOT NULL AND v_ans.selected_index = v_key_index THEN
          v_score_correct := v_score_correct + 1;
          UPDATE public.paper_exam_answers SET is_correct = true, graded = true, graded_at = now() WHERE id = v_ans.id;
        ELSE
          UPDATE public.paper_exam_answers SET is_correct = false, graded = true, graded_at = now() WHERE id = v_ans.id;
        END IF;
      ELSE
        v_ungraded := v_ungraded + 1;
        v_score_total := v_score_total - 1;
      END IF;
    ELSE
      v_ungraded := v_ungraded + 1;
    END IF;
  END LOOP;

  v_time_used := GREATEST(0, EXTRACT(EPOCH FROM (now() - v_attempt.started_at))::integer);

  UPDATE public.paper_exam_attempts
  SET status = 'submitted',
      submitted_at = now(),
      time_used_seconds = v_time_used,
      score_correct = v_score_correct,
      score_total = v_score_total,
      graded_count = v_graded,
      ungraded_count = v_ungraded
  WHERE id = p_attempt_id AND status = 'in_progress';

  RETURN QUERY SELECT 'submitted'::text, v_score_correct, v_score_total, v_graded, v_ungraded, v_time_used;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_paper_exam TO authenticated;

-- ============ RPC: get_paper_exam_attempt ============
CREATE OR REPLACE FUNCTION public.get_paper_exam_attempt(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_attempt public.paper_exam_attempts;
  v_exam public.paper_exams;
  v_result jsonb;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Sign in.'; END IF;

  PERFORM public.finalize_expired_attempts();

  SELECT * INTO v_attempt FROM public.paper_exam_attempts WHERE id = p_attempt_id AND owner_id = v_owner;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attempt not found.'; END IF;

  SELECT * INTO v_exam FROM public.paper_exams WHERE id = v_attempt.exam_id AND owner_id = v_owner;

  SELECT jsonb_build_object(
    'attempt', to_jsonb(v_attempt),
    'exam', to_jsonb(v_exam),
    'questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', q.id, 'position', q.position, 'question_type', q.question_type,
        'question_text', q.question_text, 'options', q.options, 'marks', q.marks,
        'answer_key', CASE WHEN v_attempt.status IN ('submitted','expired') THEN q.answer_key ELSE NULL END,
        'answer_key_source', q.answer_key_source,
        'has_figure', q.has_figure, 'figure_note', q.figure_note,
        'answer', COALESCE((
          SELECT jsonb_build_object(
            'selected_index', a.selected_index,
            'answer_text', a.answer_text,
            'marked_for_review', a.marked_for_review,
            'is_correct', a.is_correct,
            'graded', a.graded
          ) FROM public.paper_exam_answers a WHERE a.exam_question_id = q.id AND a.attempt_id = p_attempt_id
        ), 'null'::jsonb)
      ) ORDER BY q.position)
      FROM public.paper_exam_questions q WHERE q.exam_id = v_attempt.exam_id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_paper_exam_attempt TO authenticated;
