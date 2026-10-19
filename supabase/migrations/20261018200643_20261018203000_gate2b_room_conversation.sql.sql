/*
# Gate 2B — Persistent shared academic conversation for study rooms

1. Purpose
   Backing store for the shared AI study tutor inside private study rooms.
   Questions are moderated BEFORE publication; only approved question/answer
   pairs are visible to room members. Author-only drafts are kept when a
   question is blocked so the student can see what happened without the
   content ever being broadcast. ADDITIVE ONLY: no existing table, column,
   policy, or function is modified or dropped.

2. New table: `room_messages`
   - `id` (uuid, PK): message identity.
   - `seq` (bigint, identity): immutable, monotonic ordering for pagination
     and stable realtime ordering. Never reused.
   - `room_id` (uuid, NOT NULL, FK study_rooms ON DELETE CASCADE): the room
     the conversation belongs to. Deleting a room deletes its history.
   - `sender_id` (uuid, NOT NULL, FK auth.users ON DELETE CASCADE): the
     student who asked. For AI answer rows this is the student whose
     question is being answered (attribution), not an AI identity.
   - `role` (text, NOT NULL, CHECK 'student'|'ai'): who produced the body.
   - `status` (text, NOT NULL, DEFAULT 'approved', CHECK 'approved'|'blocked'):
     'approved' rows are published to room members; 'blocked' rows are
     author-only drafts preserved after moderation rejection.
   - `body` (text, NOT NULL, CHECK 1..4000 chars after trim): the question
     or the approved AI answer.
   - `in_reply_to` (uuid, NULL, FK room_messages ON DELETE CASCADE): links an
     AI answer row to its question row.
   - `client_request_id` (text, NOT NULL, CHECK 8..64 chars): idempotency key
     supplied by the client; a UNIQUE index on (room_id, sender_id,
     client_request_id) makes duplicate submissions return the stored result
     instead of triggering duplicate provider inference.
   - `context` (jsonb, NOT NULL, DEFAULT '{}'): learning metadata snapshot
     (subject name, class level, chapter title, lesson title/source type,
     room mission excerpt). Metadata only — never credentials.
   - `metadata` (jsonb, NOT NULL, DEFAULT '{}'): system metadata (provider
     model name, moderation verdict label). No secrets, no provider keys.
   - `created_at` (timestamptz, NOT NULL, DEFAULT now()).

3. New table: `room_ai_request_log`
   One row per tutor attempt for server-side rate limiting and provider
   budget accounting: `id` (identity PK), `room_id` (FK study_rooms CASCADE),
   `user_id` (FK auth.users CASCADE), `outcome` (text: 'mod_blocked' |
   'rate_limited' | 'provider_error' | 'succeeded'), `created_at`.
   RLS enabled with NO client policies — fully locked for browsers, same
   pattern as `room_redemption_log`.

4. Security (RLS)
   - `room_messages`: RLS enabled. One SELECT policy for authenticated users:
     a user sees their own rows in any status (author-only drafts), and sees
     'approved' rows of rooms they currently belong to via the existing
     `is_room_member()` helper. Outsiders see nothing.
   - INSERT/UPDATE/DELETE on `room_messages` are revoked from anon and
     authenticated at the grant level AND have no policies (deny by default):
     clients cannot forge AI messages, edit approved answers, or bypass
     moderation through direct table writes. All persistence happens through
     the server-side edge function using the service role after moderation.
   - `room_ai_request_log`: RLS enabled, no policies (deny-all).

5. Realtime
   - `room_messages` is added to the `supabase_realtime` publication so
     approved messages stream to authorized members' browsers. Delivery
     honors the RLS policy above.

6. Indexes
   - `room_messages(room_id, seq)` for ordered pagination per room.
   - UNIQUE (room_id, sender_id, client_request_id) for idempotency.
   - `room_ai_request_log(room_id, created_at)` and
     `room_ai_request_log(user_id, created_at)` for rate-limit counting.

7. Retention, deletion and backup policy (documentation, not code)
   - Conversation history lives as long as its room: deleting the room
     (owner action) cascades to all messages and request-log rows.
   - There is no automatic purge and no infinite-retention promise in this
     gate; platform-managed database backups apply per the Supabase project
     schedule.
   - Message bodies are plain academic text; no provider credentials are
     ever stored in these tables.
*/

CREATE TABLE IF NOT EXISTS public.room_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  room_id uuid NOT NULL REFERENCES public.study_rooms(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('student', 'ai')),
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'blocked')),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
  in_reply_to uuid REFERENCES public.room_messages(id) ON DELETE CASCADE,
  client_request_id text NOT NULL CHECK (char_length(client_request_id) BETWEEN 8 AND 64),
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.room_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_select_members_approved" ON public.room_messages;
CREATE POLICY "messages_select_members_approved" ON public.room_messages
FOR SELECT
TO authenticated
USING (
  sender_id = auth.uid()
  OR (
    status = 'approved'
    AND public.is_room_member(room_id)
  )
);

REVOKE INSERT, UPDATE, DELETE ON public.room_messages FROM anon, authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS room_messages_idempotency_key
  ON public.room_messages (room_id, sender_id, client_request_id);
CREATE INDEX IF NOT EXISTS room_messages_room_seq_idx
  ON public.room_messages (room_id, seq);

CREATE TABLE IF NOT EXISTS public.room_ai_request_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES public.study_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.room_ai_request_log ENABLE ROW LEVEL SECURITY;
-- No client policies: locked for browsers.

CREATE INDEX IF NOT EXISTS room_ai_request_log_room_created_idx
  ON public.room_ai_request_log (room_id, created_at);
CREATE INDEX IF NOT EXISTS room_ai_request_log_user_created_idx
  ON public.room_ai_request_log (user_id, created_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'room_messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.room_messages';
  END IF;
END $$;