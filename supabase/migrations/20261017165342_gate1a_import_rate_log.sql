/*
# Gate 1A (YouTube API) — per-user import rate limiting

1. Purpose
   Server-side, quota-safe per-user rate limit for YouTube imports performed
   through the youtube-import edge function. The function counts a user's
   imports in a rolling window before calling the YouTube Data API, so a
   runaway or abusive client cannot burn API quota.

2. New Tables
   - `import_rate_log`: one row per successful import attempt.
     - `user_id` (uuid, NOT NULL, default auth.uid()): the importer.
     - `created_at` (timestamptz, default now()): window anchor.
     No PII beyond the user id. Rows are tiny and append-only.

3. Security
   - RLS ENABLED. No SELECT/INSERT/UPDATE/DELETE policies for client roles:
     clients cannot read or write this table at all. The youtube-import
     function uses the service role (which bypasses RLS) to insert rows and
     count the window. This is intentional deny-by-default.

4. Notes
   - Bounded by index on (user_id, created_at) for fast window counts.
   - Existing tables and policies are untouched.
*/

CREATE TABLE IF NOT EXISTS public.import_rate_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.import_rate_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_import_rate_log_window
  ON public.import_rate_log(user_id, created_at);

COMMENT ON TABLE public.import_rate_log IS
  'Append-only per-user import log used by the youtube-import edge function to enforce rolling-window rate limits. No client-role policies by design.';
