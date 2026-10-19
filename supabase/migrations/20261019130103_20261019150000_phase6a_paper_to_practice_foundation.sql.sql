/*
# Paper to Practice — Phase 6A: private PDF storage + extraction schema

## Summary
Creates the foundation for "Paper to Practice": students upload their own
legitimately-obtained question paper PDFs, and the app extracts genuine
questions from them for interactive practice.

## 1. Storage bucket
- `paper-uploads` — private bucket, 15 MB limit, PDF only.

## 2. New table: paper_uploads
- Tracks uploaded PDFs, extraction status, detection results.
- Owner-scoped RLS (4 policies).

## 3. New table: paper_questions
- Extracted questions pending student review.
- Owner-scoped RLS (4 policies).

## Security
- Storage bucket is private (not public). Owner-only access via storage
  policies that match the user's UUID folder prefix.
- No daily goal/streak/badge triggers fire from uploads.
- Extracted document text is NOT persisted — only structured questions.
- Answer keys are student-supplied, never fabricated.
*/

-- ============ Storage bucket ============
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'paper-uploads',
  'paper-uploads',
  false,
  15728640,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- ============ paper_uploads ============
CREATE TABLE IF NOT EXISTS public.paper_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  original_filename text NOT NULL
    CHECK (char_length(original_filename) BETWEEN 1 AND 255),
  file_size_bytes bigint NOT NULL
    CHECK (file_size_bytes > 0 AND file_size_bytes <= 15728640),
  page_count integer,
  status text NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'processing', 'extracted', 'rejected', 'failed')),
  detection_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  detection_message text,
  error_message text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.paper_uploads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "paper_uploads_select_own" ON public.paper_uploads;
CREATE POLICY "paper_uploads_select_own" ON public.paper_uploads
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "paper_uploads_insert_own" ON public.paper_uploads;
CREATE POLICY "paper_uploads_insert_own" ON public.paper_uploads
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "paper_uploads_update_own" ON public.paper_uploads;
CREATE POLICY "paper_uploads_update_own" ON public.paper_uploads
  FOR UPDATE TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "paper_uploads_delete_own" ON public.paper_uploads;
CREATE POLICY "paper_uploads_delete_own" ON public.paper_uploads
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_paper_uploads_owner ON public.paper_uploads(owner_id);
CREATE INDEX IF NOT EXISTS idx_paper_uploads_status ON public.paper_uploads(status);

-- ============ paper_questions ============
CREATE TABLE IF NOT EXISTS public.paper_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL REFERENCES public.paper_uploads(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  position integer NOT NULL,
  section_label text,
  question_text text NOT NULL
    CHECK (char_length(question_text) BETWEEN 1 AND 4000),
  question_type text NOT NULL DEFAULT 'mcq'
    CHECK (question_type IN ('mcq', 'short_answer', 'long_answer', 'fill_blank', 'true_false', 'unknown')),
  options jsonb,
  marks integer,
  instruction_text text,
  extraction_confidence text NOT NULL DEFAULT 'high'
    CHECK (extraction_confidence IN ('high', 'medium', 'low')),
  has_figure boolean NOT NULL DEFAULT false,
  figure_note text,
  answer_key text,
  answer_key_source text NOT NULL DEFAULT 'none'
    CHECK (answer_key_source IN ('none', 'student', 'extracted')),
  review_status text NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'confirmed', 'edited', 'removed')),
  edited_text text,
  edited_options jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (upload_id, position)
);

ALTER TABLE public.paper_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "paper_questions_select_own" ON public.paper_questions;
CREATE POLICY "paper_questions_select_own" ON public.paper_questions
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "paper_questions_insert_own" ON public.paper_questions;
CREATE POLICY "paper_questions_insert_own" ON public.paper_questions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "paper_questions_update_own" ON public.paper_questions;
CREATE POLICY "paper_questions_update_own" ON public.paper_questions
  FOR UPDATE TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "paper_questions_delete_own" ON public.paper_questions;
CREATE POLICY "paper_questions_delete_own" ON public.paper_questions
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS idx_paper_questions_upload ON public.paper_questions(upload_id);
CREATE INDEX IF NOT EXISTS idx_paper_questions_owner ON public.paper_questions(owner_id);
CREATE INDEX IF NOT EXISTS idx_paper_questions_review ON public.paper_questions(review_status);

-- ============ Storage RLS policies (owner-only, path = <uuid>/... ) ============
-- Files are stored as "<owner_uuid>/<upload_uuid>.pdf" so the first path
-- segment is the owner's UUID, which we match against auth.uid().
DROP POLICY IF EXISTS "paper_uploads_storage_select_own" ON storage.objects;
CREATE POLICY "paper_uploads_storage_select_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'paper-uploads' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "paper_uploads_storage_insert_own" ON storage.objects;
CREATE POLICY "paper_uploads_storage_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'paper-uploads' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "paper_uploads_storage_update_own" ON storage.objects;
CREATE POLICY "paper_uploads_storage_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'paper-uploads' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'paper-uploads' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "paper_uploads_storage_delete_own" ON storage.objects;
CREATE POLICY "paper_uploads_storage_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'paper-uploads' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ============ updated_at trigger ============
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS paper_uploads_touch ON public.paper_uploads;
CREATE TRIGGER paper_uploads_touch BEFORE UPDATE ON public.paper_uploads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS paper_questions_touch ON public.paper_questions;
CREATE TRIGGER paper_questions_touch BEFORE UPDATE ON public.paper_questions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
