/*
# Gate 1A — Learning resources with original URL + solo study sessions

1. Purpose
   Make "Bring Your Own Lesson" real: store the original YouTube URL the
   learner pasted (not just the parsed video/playlist ID), an optional
   personal topic/study goal, and per-resource solo study session progress.

2. Modified Tables
   - `user_resources`: new columns
     - `source_url` (text): the exact normalized original URL the user
       submitted (https, youtube.com or youtu.be host). Nullable because
       legacy/curated rows may only have a parsed id.
     - `topic` (text, nullable): user-defined study topic or goal,
       max 120 chars (CHECK).
     - `last_opened_at` (timestamptz, nullable): set when the learner
       opens the workspace, powers "Resume learning".
     The UNIQUE constraint (owner_id, source_type, youtube_id) already
     prevents duplicate imports of the same resource per user.

3. New Tables
   - `study_sessions`: one row per (user, resource). Tracks accumulated
     focus seconds `focus_seconds` (integer, >= 0, capped at 24h), the
     furthest playback position reported by the official YouTube player
     `last_position_seconds` (numeric, >= 0, capped at 24h), and
     timestamps. Server-side CHECK constraints bound values so the client
     cannot write absurd progress.

4. Security
   - RLS ENABLED on `study_sessions`.
   - study_sessions: full owner-scoped CRUD, TO authenticated, keyed on
     user_id DEFAULT auth.uid() so client inserts without user_id succeed.
   - Existing user_resources RLS policies untouched. The new nullable
     columns require no policy changes.
   - Room attachment support already exists: study_rooms.resource_id
     references user_resources; nothing permissive is added here.

5. Integrity & Indexes
   - UNIQUE (user_id, resource_id) on study_sessions: one progress row
     per user per resource (upsert target).
   - CHECKs bound focus_seconds and last_position_seconds to [0, 86400].
   - Index on user_resources.last_opened_at for resume queries.

6. Notes
   - No metadata is fabricated: title/channel remain NULL until a real
     YouTube Data API integration fills them (see server boundary note in
     app code). import_state stays 'ready' immediately because playback
     uses the official IFrame player and does not depend on metadata.
*/

ALTER TABLE public.user_resources
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS topic text,
  ADD COLUMN IF NOT EXISTS last_opened_at timestamptz;

ALTER TABLE public.user_resources
  DROP CONSTRAINT IF EXISTS user_resources_topic_len_check;
ALTER TABLE public.user_resources
  ADD CONSTRAINT user_resources_topic_len_check
  CHECK (char_length(topic) <= 120);

DO $$
BEGIN
  IF to_regclass('public.study_sessions') IS NULL THEN
    CREATE TABLE public.study_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
      resource_id uuid NOT NULL REFERENCES public.user_resources(id) ON DELETE CASCADE,
      focus_seconds integer NOT NULL DEFAULT 0
        CHECK (focus_seconds BETWEEN 0 AND 86400),
      last_position_seconds numeric NOT NULL DEFAULT 0
        CHECK (last_position_seconds >= 0 AND last_position_seconds <= 86400),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, resource_id)
    );
  END IF;
END $$;

ALTER TABLE public.study_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sessions_select_own" ON public.study_sessions;
CREATE POLICY "sessions_select_own" ON public.study_sessions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "sessions_insert_own" ON public.study_sessions;
CREATE POLICY "sessions_insert_own" ON public.study_sessions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "sessions_update_own" ON public.study_sessions;
CREATE POLICY "sessions_update_own" ON public.study_sessions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "sessions_delete_own" ON public.study_sessions;
CREATE POLICY "sessions_delete_own" ON public.study_sessions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_study_sessions_user
  ON public.study_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_study_sessions_resource
  ON public.study_sessions(resource_id);
CREATE INDEX IF NOT EXISTS idx_user_resources_last_opened
  ON public.user_resources(last_opened_at);

COMMENT ON COLUMN public.user_resources.source_url IS
  'The normalized original YouTube URL the learner submitted (watch, youtu.be short link, or playlist URL).';
COMMENT ON COLUMN public.user_resources.topic IS
  'Optional user-defined study topic or goal for this resource (max 120 chars).';
