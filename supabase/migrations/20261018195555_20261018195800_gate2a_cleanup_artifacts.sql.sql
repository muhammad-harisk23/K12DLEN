/*
# Gate 2A cleanup — remove leftover recovery-audit harness

1. Purpose
   The recovery audit left `public.audit_probe()`, a SECURITY DEFINER
   harness with hardcoded user IDs, executable by every role (security
   linter WARN). It is a test artifact, not an app function. ADDITIVE
   cleanup only: nothing else is dropped or modified.

2. Changes
   - Drop function public.audit_probe() and revoke its grants.
   - Drop the unused duplicate index idx_room_invites_room (identical to
     room_invites_room_id_idx, linter WARN).
   - Add missing covering indexes for linter INFO findings on invite
     creator and room resource lookups.
*/
REVOKE ALL ON FUNCTION public.audit_probe() FROM anon, authenticated, public;
DROP FUNCTION IF EXISTS public.audit_probe();

DROP INDEX IF EXISTS public.idx_room_invites_room;
CREATE INDEX IF NOT EXISTS idx_room_invites_creator ON public.room_invites (created_by);
CREATE INDEX IF NOT EXISTS idx_study_rooms_resource ON public.study_rooms (resource_id);