DROP FUNCTION IF EXISTS public.submit_paper_exam(uuid);

CREATE OR REPLACE FUNCTION public.submit_paper_exam(p_attempt_id uuid)
RETURNS TABLE (
  out_status text,
  out_score_correct integer,
  out_score_total integer,
  out_graded_count integer,
  out_ungraded_count integer,
  out_time_used_seconds integer
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

  SELECT a.* INTO v_attempt FROM public.paper_exam_attempts a WHERE a.id = p_attempt_id AND a.owner_id = v_owner;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attempt not found.'; END IF;

  IF v_attempt.status = 'submitted' THEN RAISE EXCEPTION 'This exam has already been submitted.'; END IF;
  IF v_attempt.status = 'expired' THEN
    RETURN QUERY SELECT 'expired'::text, v_attempt.score_correct, v_attempt.score_total,
      v_attempt.graded_count, v_attempt.ungraded_count, v_attempt.time_used_seconds;
    RETURN;
  END IF;

  FOR v_eq IN SELECT q.* FROM public.paper_exam_questions q WHERE q.exam_id = v_attempt.exam_id ORDER BY q.position LOOP
    SELECT an.* INTO v_ans FROM public.paper_exam_answers an WHERE an.attempt_id = p_attempt_id AND an.exam_question_id = v_eq.id;

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
