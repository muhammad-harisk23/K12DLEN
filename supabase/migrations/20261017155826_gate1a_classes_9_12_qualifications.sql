/*
# Gate 1A — Classes 9-12 and ICSE/ISC qualification accuracy

1. Purpose
   Expand the curated curriculum from Class 10 only to Classes 9, 10, 11
   and 12, and record which qualification applies (ICSE for Classes 9-10,
   ISC for Classes 11-12) so the UI can label them accurately.

2. Modified Tables
   - `classes`: new nullable column `qualification` (text). Values:
     'icse' for Classes 9-10 under the ICSE board, 'isc' for Classes
     11-12 under the ICSE board, NULL for CBSE and UP Board (their board
     name alone is unambiguous). A CHECK constraint limits values to
     'icse' / 'isc'.

3. Data Changes
   - Inserts Class 9, 11 and 12 rows for every existing syllabus version
     (idempotent via ON CONFLICT DO NOTHING). NO subjects, chapters,
     teachers or verification records are created for these new classes —
     verified content does not exist yet and must not be fabricated.
   - Updates the qualification value on existing ICSE Class 10 rows.

4. Security
   - None. Row Level Security and all policies are untouched; classes
     remain world-readable and client-write-protected.

5. Notes
   - Existing user profiles referencing Class 10 rows are unaffected.
   - The `syllabus_versions.published` flag is unchanged; ICSE/UP Board
     versions remain unpublished until the operator verifies content.
*/

ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS qualification text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'classes_qualification_check'
  ) THEN
    ALTER TABLE public.classes
      ADD CONSTRAINT classes_qualification_check
      CHECK (qualification IN ('icse', 'isc'));
  END IF;
END $$;

COMMENT ON COLUMN public.classes.qualification IS
  'Qualification label for Indian curricula: icse (Classes 9-10) or isc (Classes 11-12) under the ICSE board; NULL where the board name is unambiguous.';

INSERT INTO public.classes (syllabus_version_id, level, label, qualification)
SELECT
  sv.id,
  l.level,
  'Class ' || l.level,
  CASE
    WHEN b.code = 'icse' AND l.level <= 10 THEN 'icse'
    WHEN b.code = 'icse' THEN 'isc'
  END
FROM public.syllabus_versions sv
JOIN public.boards b ON b.id = sv.board_id
CROSS JOIN (VALUES (9), (11), (12)) AS l(level)
ON CONFLICT (syllabus_version_id, level) DO NOTHING;

UPDATE public.classes c
SET qualification = 'icse'
FROM public.syllabus_versions sv
JOIN public.boards b ON b.id = sv.board_id
WHERE c.syllabus_version_id = sv.id
  AND b.code = 'icse'
  AND c.level <= 10
  AND c.qualification IS DISTINCT FROM 'icse';

UPDATE public.classes c
SET qualification = 'isc'
FROM public.syllabus_versions sv
JOIN public.boards b ON b.id = sv.board_id
WHERE c.syllabus_version_id = sv.id
  AND b.code = 'icse'
  AND c.level >= 11
  AND c.qualification IS DISTINCT FROM 'isc';
