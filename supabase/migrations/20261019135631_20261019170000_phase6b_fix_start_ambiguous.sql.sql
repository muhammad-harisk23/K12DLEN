-- Fix: column reference "status" is ambiguous in start_paper_exam
-- (RETURNS TABLE column clashes with paper_exam_attempts.status).
-- Qualify with table alias.

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
  v_now timestamptz := now();
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
    v_expires := v_now + (v_exam.duration_minutes || ' minutes')::interval;
  END IF;

  INSERT INTO public.paper_exam_attempts (exam_id, owner_id, status, started_at, expires_at)
  VALUES (p_exam_id, v_owner, 'in_progress', v_now, v_expires)
  RETURNING id INTO v_attempt_id;

  RETURN QUERY SELECT v_attempt_id, 'in_progress'::text, v_now, v_expires;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_paper_exam TO authenticated;
