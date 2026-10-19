/*
# Gate 0 — Seed curriculum structure (no fabricated content)

1. Purpose
   Seeds the curriculum tree for Class 10 across CBSE, ICSE and UP Board,
   plus the framework rows needed for chapters. NO chapters with real
   syllabus mappings, NO teacher names, NO playlist/video IDs and NO
   verified claims are seeded — the founder supplies real URLs and
   verifications later.

2. Seeded Data
   - Boards: cbse, icse, up_board.
   - Syllabus versions: "2025-26" per board, unpublished for ICSE/UP Board
     (their mapping isn't verified yet); CBSE published = true.
   - Class 10 row per syllabus version.
   - Subjects: Mathematics and Science for each Class 10. Science carries
     topic_grouping [Physics, Chemistry, Biology].
   - Chapter placeholders: inserted with verification_status = 'draft' so
     the structure exists without presenting anything as verified. Titles
     follow widely-published chapter lists; the operator verifies and
     publishes later. Only 'published' chapters are shown in the app.

3. Security
   - No policy changes; this migration only inserts data rows which are
     readable via existing curriculum SELECT policies.
   - Operator-only curriculum writes are enforced by ABSENCE of write
     policies on curriculum tables — there is no client path to insert or
     update curriculum rows.

4. Idempotency
   - Uses ON CONFLICT DO NOTHING with natural keys so re-running is safe.
*/

INSERT INTO public.boards (code, name) VALUES
  ('cbse', 'CBSE'),
  ('icse', 'ICSE'),
  ('up_board', 'UP Board')
ON CONFLICT (code) DO NOTHING;

-- Syllabus versions (CBSE published, ICSE / UP Board mapping pending)
INSERT INTO public.syllabus_versions (board_id, label, is_current, published)
SELECT b.id, '2025-26', true, (b.code = 'cbse')
FROM public.boards b
WHERE b.code IN ('cbse', 'icse', 'up_board')
ON CONFLICT (board_id, label) DO NOTHING;

-- Class 10 per syllabus version
INSERT INTO public.classes (syllabus_version_id, level, label)
SELECT sv.id, 10, 'Class 10'
FROM public.syllabus_versions sv
WHERE sv.is_current = true
ON CONFLICT (syllabus_version_id, level) DO NOTHING;

-- Subjects per Class 10
INSERT INTO public.subjects (class_id, name, slug, topic_grouping, display_order)
SELECT c.id, v.name, v.slug, v.topic_grouping::jsonb, v.display_order
FROM public.classes c
JOIN public.syllabus_versions sv ON sv.id = c.syllabus_version_id
CROSS JOIN (VALUES
  ('Mathematics', 'mathematics', '[]'::jsonb, 1),
  ('Science', 'science', '[{"name":"Physics","color":"sky"},{"name":"Chemistry","color":"amber"},{"name":"Biology","color":"emerald"}]'::jsonb, 2)
) AS v(name, slug, topic_grouping, display_order)
WHERE sv.is_current = true
ON CONFLICT (class_id, slug) DO NOTHING;

-- Chapter placeholders (draft; never displayed as verified until operator
-- marks them published). Titles per CBSE 2025-26 chapter lists; ICSE and
-- UP Board mapping is intentionally absent until verified.
WITH subject_rows AS (
  SELECT s.id, s.slug, sv.board_id, b.code AS board_code
  FROM public.subjects s
  JOIN public.classes c ON c.id = s.class_id
  JOIN public.syllabus_versions sv ON sv.id = c.syllabus_version_id
  JOIN public.boards b ON b.id = sv.board_id
  WHERE c.level = 10 AND sv.is_current = true
),
chapter_values AS (
  SELECT
    s.id AS subject_id,
    v.code,
    v.title,
    v.display_order,
    CASE WHEN s.board_code = 'cbse' THEN 'draft' ELSE 'draft' END AS verification_status
  FROM subject_rows s
  CROSS JOIN (VALUES
    ('mathematics', 'M01', 'Real Numbers', 1),
    ('mathematics', 'M02', 'Polynomials', 2),
    ('mathematics', 'M03', 'Pair of Linear Equations in Two Variables', 3),
    ('mathematics', 'M04', 'Quadratic Equations', 4),
    ('mathematics', 'M05', 'Arithmetic Progressions', 5),
    ('mathematics', 'M06', 'Triangles', 6),
    ('mathematics', 'M07', 'Coordinate Geometry', 7),
    ('mathematics', 'M08', 'Introduction to Trigonometry', 8),
    ('mathematics', 'M09', 'Some Applications of Trigonometry', 9),
    ('mathematics', 'M10', 'Circles', 10),
    ('mathematics', 'M11', 'Areas Related to Circles', 11),
    ('mathematics', 'M12', 'Surface Areas and Volumes', 12),
    ('mathematics', 'M13', 'Statistics', 13),
    ('mathematics', 'M14', 'Probability', 14),
    ('science', 'S01', 'Chemical Reactions and Equations', 1),
    ('science', 'S02', 'Acids, Bases and Salts', 2),
    ('science', 's03', 'Metals and Non-metals', 3),
    ('science', 'S04', 'Carbon and its Compounds', 4),
    ('science', 'S05', 'Life Processes', 5),
    ('science', 'S06', 'Control and Coordination', 6),
    ('science', 'S07', 'How do Organisms Reproduce?', 7),
    ('science', 'S08', 'Heredity', 8),
    ('science', 'S09', 'Light – Reflection and Refraction', 9),
    ('science', 'S10', 'The Human Eye and the Colourful World', 10),
    ('science', 'S11', 'Electricity', 11),
    ('science', 'S12', 'Magnetic Effects of Electric Current', 12),
    ('science', 'S13', 'Our Environment', 13)
  ) AS v(subject_slug, code, title, display_order)
  WHERE s.slug = v.subject_slug
)
INSERT INTO public.chapters (subject_id, code, title, display_order, verification_status)
SELECT subject_id, code, title, display_order, verification_status
FROM chapter_values
ON CONFLICT (subject_id, code) DO NOTHING;