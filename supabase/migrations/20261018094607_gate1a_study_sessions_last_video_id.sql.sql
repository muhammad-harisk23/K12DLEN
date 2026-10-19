/*
# Track which video owns the saved playback position

1. Plain-English summary
   - Today, `study_sessions` saves one playback position per (user, resource)
     row, but does not record WHICH video inside a playlist the position
     belongs to. When a learner switches from one playlist video to another,
     the app cannot tell whether the saved timestamp still applies, and risks
     resuming the new video at the previous video's timestamp.
   - This migration adds a nullable `last_video_id` text column recording the
     YouTube video id the saved position belongs to. It is populated by the
     app whenever progress is saved.

2. Modified tables
   - `study_sessions`: adds `last_video_id text NULL`. Nullable so existing
     rows (and single-video resources) remain valid; no backfill is required.

3. Security changes
   - None. Row Level Security and the existing owner-scoped policies on
     `study_sessions` are unchanged. No new privileges are granted.

4. Important notes
   - Additive, non-destructive change: no data is dropped or altered.
   - The column is safe to re-run (guarded with IF NOT EXISTS).
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'study_sessions'
      AND column_name = 'last_video_id'
  ) THEN
    ALTER TABLE public.study_sessions
      ADD COLUMN last_video_id text;
  END IF;
END
$$;
