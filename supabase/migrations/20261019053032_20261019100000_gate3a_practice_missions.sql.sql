/*
# Gate 3A: Real practice, mission completion and progress

1. Plain-English summary
Students practice what they learn through a timed quiz runner. Questions live
server-side with answer keys hidden from browsers; grading happens in the
database. Missions tie practice to studying, and can only be marked complete
by server-side validation of real, persisted attempt data.

2. New tables
- `practice_questions`
  - `id` (uuid, primary key)
  - `topic_slug` (text) — stable topic key, e.g. 'photosynthesis'
  - `topic_label`, `subject_name` (text) — human-readable scoping
  - `prompt` (text, 1-600 chars) — the question text
  - `options` (jsonb) — array of 4 answer strings
  - `correct_index` (int, 0-3) — SECRET: never returned to browsers
  - `explanation` (text, 1-1200) — revealed only after graded submission
  - `verification_status` (text) — 'draft' | 'verified' | 'published'
  - `source_note` (text) — explicit content provenance
  - `display_order` (int), `created_at` (timestamptz)
- `practice_attempts`
  - `id` (uuid, primary key), `user_id` (uuid, defaults to auth.uid())
  - `question_id` (uuid, FK to practice_questions)
  - `selected_index` (int, 0-3), `is_correct` (boolean), `submitted_at`
  - UNIQUE (user_id, question_id): first graded submission is final — no
    grinding and no duplicate rewards.
- `student_missions`
  - `id` (uuid, primary key), `user_id` (uuid, defaults to auth.uid())
  - `mission_text` (text, 1-280) — the concrete study mission
  - `topic_slug` (text) — which practice set validates completion
  - `resource_id` (uuid, nullable FK to user_resources) — linked lesson
  - `status` ('active' | 'completed'), `completed_at`, timestamps
  - UPDATE privilege is REVOKED from browsers: missions complete only via the
    validating function, never by client-side edits (no forged completion).

3. Security
- RLS enabled on all three tables.
- `practice_questions`: no policies at all and all privileges revoked from
  anon/authenticated — browsers can NEVER read rows or keys directly.
  Access only through `practice_questions_for` (SECURITY DEFINER), which
  withholds correct_index/explanation for unattempted questions.
- `practice_attempts`: owner-only SELECT policy; INSERT/UPDATE/DELETE
  revoked — attempts are written only by `submit_practice_attempt`
  (SECURITY DEFINER), which grades server-side.
- `student_missions`: owner-only SELECT/INSERT/DELETE policies; UPDATE
  revoked (completion via `complete_mission_secure`).
- All SECURITY DEFINER functions pin `search_path = public` and check
  ownership via auth.uid(). Only verified questions are served.

4. Seed content
10 human-authored photosynthesis questions, verified against the NCERT
Class 9-10 Biology curriculum, shipped with verification_status='verified'
and an explicit source note. NOT AI-generated; no claim of coverage for
imported YouTube videos.
*/

-- ------------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS practice_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_slug text NOT NULL,
  topic_label text NOT NULL,
  subject_name text NOT NULL,
  prompt text NOT NULL CHECK (char_length(btrim(prompt)) >= 1 AND char_length(btrim(prompt)) <= 600),
  options jsonb NOT NULL,
  correct_index int NOT NULL CHECK (correct_index >= 0 AND correct_index <= 3),
  explanation text NOT NULL CHECK (char_length(btrim(explanation)) >= 1 AND char_length(btrim(explanation)) <= 1200),
  verification_status text NOT NULL DEFAULT 'draft' CHECK (verification_status = ANY (ARRAY['draft'::text, 'verified'::text, 'published'::text])),
  source_note text NOT NULL DEFAULT '' CHECK (char_length(source_note) <= 300),
  display_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT practice_questions_options_shape CHECK (
    jsonb_typeof(options) = 'array'
    AND jsonb_array_length(options) = 4
  )
);

CREATE TABLE IF NOT EXISTS practice_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES practice_questions(id) ON DELETE CASCADE,
  selected_index int NOT NULL CHECK (selected_index >= 0 AND selected_index <= 3),
  is_correct boolean NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, question_id)
);

CREATE TABLE IF NOT EXISTS student_missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  mission_text text NOT NULL CHECK (char_length(btrim(mission_text)) >= 1 AND char_length(btrim(mission_text)) <= 280),
  topic_slug text NOT NULL CHECK (char_length(btrim(topic_slug)) >= 1 AND char_length(btrim(topic_slug)) <= 80),
  resource_id uuid REFERENCES user_resources(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status = ANY (ARRAY['active'::text, 'completed'::text])),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS practice_attempts_user_submitted_idx ON practice_attempts (user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS practice_questions_topic_idx ON practice_questions (topic_slug, display_order);
CREATE INDEX IF NOT EXISTS student_missions_user_idx ON student_missions (user_id, status);

-- ------------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------------

ALTER TABLE practice_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_missions ENABLE ROW LEVEL SECURITY;

-- practice_questions: browsers get nothing; access via definer function only.
REVOKE ALL ON practice_questions FROM anon, authenticated;

-- practice_attempts: read own rows; all writes go through the grader.
REVOKE INSERT, UPDATE, DELETE ON practice_attempts FROM anon, authenticated;

DROP POLICY IF EXISTS "attempts_select_own" ON practice_attempts;
CREATE POLICY "attempts_select_own" ON practice_attempts
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- student_missions: owner read/create/delete; completion is server-validated.
REVOKE UPDATE ON student_missions FROM anon, authenticated;

DROP POLICY IF EXISTS "missions_select_own" ON student_missions;
CREATE POLICY "missions_select_own" ON student_missions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "missions_insert_own" ON student_missions;
CREATE POLICY "missions_insert_own" ON student_missions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "missions_delete_own" ON student_missions;
CREATE POLICY "missions_delete_own" ON student_missions
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ------------------------------------------------------------------
-- Server-side question access (keys withheld until graded)
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION practice_questions_for(p_topic_slug text)
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
    ON a.question_id = q.id AND a.user_id = auth.uid()
  WHERE q.topic_slug = p_topic_slug
    AND q.verification_status = 'verified'
$$;

-- ------------------------------------------------------------------
-- Server-side grading (idempotent: first submission is final)
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION submit_practice_attempt(p_question_id uuid, p_selected_index int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_correct_index int;
  v_explanation text;
  v_is_correct boolean;
  v_existing practice_attempts;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthenticated');
  END IF;
  IF p_selected_index IS NULL OR p_selected_index < 0 OR p_selected_index > 3 THEN
    RETURN jsonb_build_object('status', 'invalid_selection');
  END IF;

  SELECT q.correct_index, q.explanation
    INTO v_correct_index, v_explanation
  FROM practice_questions q
  WHERE q.id = p_question_id
    AND q.verification_status = 'verified';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  SELECT * INTO v_existing FROM practice_attempts
  WHERE user_id = v_user AND question_id = p_question_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'already_attempted',
      'selectedIndex', v_existing.selected_index,
      'isCorrect', v_existing.is_correct,
      'correctIndex', v_correct_index,
      'explanation', v_explanation
    );
  END IF;

  v_is_correct := (p_selected_index = v_correct_index);

  INSERT INTO practice_attempts (user_id, question_id, selected_index, is_correct)
  VALUES (v_user, p_question_id, p_selected_index, v_is_correct);

  RETURN jsonb_build_object(
    'status', 'graded',
    'selectedIndex', p_selected_index,
    'isCorrect', v_is_correct,
    'correctIndex', v_correct_index,
    'explanation', v_explanation
  );
END;
$$;

-- ------------------------------------------------------------------
-- Mission completion: explicit, validated, non-forgeable criteria
-- ------------------------------------------------------------------
-- Criteria: every verified question in the mission topic has a graded
-- attempt AND overall accuracy >= 80%. Duplicate completion is refused.

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
  v_total int;
  v_attempted int;
  v_correct int;
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

  SELECT count(*) INTO v_total
  FROM practice_questions q
  WHERE q.topic_slug = v_topic AND q.verification_status = 'verified';
  IF v_total = 0 THEN
    RETURN jsonb_build_object('status', 'no_practice_set');
  END IF;

  SELECT
    count(a.id),
    count(a.id) FILTER (WHERE a.is_correct)
  INTO v_attempted, v_correct
  FROM practice_questions q
  LEFT JOIN practice_attempts a
    ON a.question_id = q.id AND a.user_id = v_user
  WHERE q.topic_slug = v_topic AND q.verification_status = 'verified';

  IF v_attempted < v_total THEN
    RETURN jsonb_build_object(
      'status', 'criteria_not_met',
      'reason', 'Answer every practice question in this topic first.',
      'attempted', v_attempted,
      'total', v_total
    );
  END IF;
  IF (v_correct::numeric / v_total) < 0.8 THEN
    RETURN jsonb_build_object(
      'status', 'criteria_not_met',
      'reason', 'Score at least 80% on this topic practice set.',
      'correct', v_correct,
      'total', v_total
    );
  END IF;

  UPDATE student_missions
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE id = p_mission_id AND user_id = v_user AND status = 'active';

  RETURN jsonb_build_object('status', 'completed', 'correct', v_correct, 'total', v_total);
END;
$$;

-- ------------------------------------------------------------------
-- Dashboard summary (real persisted events only)
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
    'mistakes', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'questionId', q.id,
        'prompt', q.prompt,
        'options', q.options,
        'selectedIndex', a.selected_index,
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
-- Seed: 10 human-authored photosynthesis questions (verified)
-- ------------------------------------------------------------------

INSERT INTO practice_questions
  (topic_slug, topic_label, subject_name, prompt, options, correct_index, explanation, verification_status, source_note, display_order)
VALUES
  ('photosynthesis', 'Photosynthesis', 'Biology',
   'Which gas do plants take in from the air for photosynthesis?',
   '["Oxygen","Nitrogen","Carbon dioxide","Hydrogen"]'::jsonb,
   2,
   'Plants absorb carbon dioxide through their leaves. Its carbon atoms become part of the glucose they build, and oxygen is released as a by-product.',
   'verified',
   'Human-authored set, checked against NCERT Class 9-10 Science (Biology) chapters on photosynthesis.',
   1),
  ('photosynthesis', 'Photosynthesis', 'Biology',
   'In which part of a plant cell does photosynthesis mainly happen?',
   '["Mitochondria","Chloroplast","Nucleus","Ribosome"]'::jsonb,
   1,
   'Chloroplasts contain chlorophyll and carry out photosynthesis. Mitochondria do the opposite job: releasing energy from food during respiration.',
   'verified',
   'Human-authored set, checked against NCERT Class 9-10 Science (Biology) chapters on photosynthesis.',
   2),
  ('photosynthesis', 'Photosynthesis', 'Biology',
   'Which is the primary pigment that absorbs light energy for photosynthesis?',
   '["Chlorophyll","Hemoglobin","Melanin","Collagen"]'::jsonb,
   0,
   'Chlorophyll, inside chloroplasts, absorbs mainly red and blue light and reflects green - which is why most leaves look green.',
   'verified',
   'Human-authored set, checked against NCERT Class 9-10 Science (Biology) chapters on photosynthesis.',
   3),
  ('photosynthesis', 'Photosynthesis', 'Biology',
   'Which two substances are the raw materials (inputs) of photosynthesis?',
   '["Glucose and oxygen","Carbon dioxide and water","Oxygen and water","Nitrogen and water"]'::jsonb,
   1,
   'The plant takes in carbon dioxide from the air and water from the soil. Light energy converts them into glucose and oxygen.',
   'verified',
   'Human-authored set, checked against NCERT Class 9-10 Science (Biology) chapters on photosynthesis.',
   4),
  ('photosynthesis', 'Photosynthesis', 'Biology',
   'What are the products of photosynthesis?',
   '["Carbon dioxide and water","Glucose and oxygen","Glucose and nitrogen","Only oxygen"]'::jsonb,
   1,
   'Photosynthesis builds glucose (a sugar the plant uses for energy and growth) and releases oxygen into the air.',
   'verified',
   'Human-authored set, checked against NCERT Class 9-10 Science (Biology) chapters on photosynthesis.',
   5),
  ('photosynthesis', 'Photosynthesis', 'Biology',
   'Where do the light-dependent reactions of photosynthesis take place?',
   '["In the stroma","In the thylakoid membranes","In the cytoplasm","In the vacuole"]'::jsonb,
   1,
   'The thylakoid membranes inside chloroplasts hold the chlorophyll that captures light, so the light-dependent reactions happen there.',
   'verified',
   'Human-authored set, checked against NCERT Class 9-10 Science (Biology) chapters on photosynthesis.',
   6),
  ('photosynthesis', 'Photosynthesis', 'Biology',
   'The Calvin cycle (light-independent reactions) takes place in the:',
   '["Thylakoid membranes","Stroma","Cell wall","Nucleus"]'::jsonb,
   1,
   'The stroma is the fluid around the thylakoids. That is where carbon dioxide is fixed into sugar using the energy carried from the light reactions.',
   'verified',
   'Human-authored set, checked against NCERT Class 9-10 Science (Biology) chapters on photosynthesis.',
   7),
  ('photosynthesis', 'Photosynthesis', 'Biology',
   'A potted plant is kept in complete darkness for several days. What happens to its photosynthesis?',
   '["It speeds up to store more light","It stops, and the plant lives off stored food","It continues using moonlight","It switches to absorbing oxygen for energy"]'::jsonb,
   1,
   'Without light there is no energy source for photosynthesis, so it stops. The plant respires stored starch to stay alive until light returns.',
   'verified',
   'Human-authored set, checked against NCERT Class 9-10 Science (Biology) chapters on photosynthesis.',
   8),
  ('photosynthesis', 'Photosynthesis', 'Biology',
   'What is the main role of stomata in photosynthesis?',
   '["Pumping water up the stem","Letting gases move in and out of the leaf","Storing glucose for later","Reflecting excess light"]'::jsonb,
   1,
   'Stomata are tiny pores, mostly on the underside of leaves. Carbon dioxide enters and oxygen exits through them; they also release water vapour.',
   'verified',
   'Human-authored set, checked against NCERT Class 9-10 Science (Biology) chapters on photosynthesis.',
   9),
  ('photosynthesis', 'Photosynthesis', 'Biology',
   'Which word equation correctly represents photosynthesis?',
   '["Glucose + oxygen -> carbon dioxide + water","Carbon dioxide + water -> glucose + oxygen","Water + oxygen -> glucose + carbon dioxide","Carbon dioxide + glucose -> water + oxygen"]'::jsonb,
   1,
   'Carbon dioxide and water are converted into glucose and oxygen using light energy captured by chlorophyll - the reverse of respiration.',
   'verified',
   'Human-authored set, checked against NCERT Class 9-10 Science (Biology) chapters on photosynthesis.',
   10);
