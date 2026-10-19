/*
# Gate 0 audit fix — owner-column defaults for room creation flow

1. Purpose
   After tightening room policies, legitimate owner room creation failed:
   `study_rooms.owner_id` and `room_members.user_id` had no defaults, so
   client inserts that omit them arrived as NULL and failed the
   WITH CHECK (owner_id = auth.uid()) / bootstrap predicates.

2. Modified Tables
   - `study_rooms.owner_id`: now DEFAULT auth.uid() — the room creator is
     always the authenticated caller; a forged owner_id still fails the
     INSERT policy (WITH CHECK owner_id = auth.uid()).
   - `room_members.user_id`: now DEFAULT auth.uid() — owner bootstrap row
     and invite-gated self-join both bind the row to the caller.

3. Security
   - No broadening: defaults bind rows to the caller more tightly; explicit
     forged values still fail policy checks.
*/

ALTER TABLE public.study_rooms
  ALTER COLUMN owner_id SET DEFAULT auth.uid();

ALTER TABLE public.room_members
  ALTER COLUMN user_id SET DEFAULT auth.uid();