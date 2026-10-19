/*
# Gate 2B — Revoke remaining TRUNCATE/REFERENCES on room_messages

1. Purpose
   Defense in depth follow-up: authenticated kept implicit TRUNCATE and
   REFERENCES grants on room_messages. TRUNCATE would let any member wipe a
   room's conversation history; it must not be grantable to clients.
   service_role and postgres are unaffected.

2. Changes
   - Revoke TRUNCATE and REFERENCES on room_messages from anon and
     authenticated. authenticated retains only SELECT (RLS-gated).
*/

REVOKE TRUNCATE, REFERENCES ON public.room_messages FROM anon, authenticated;